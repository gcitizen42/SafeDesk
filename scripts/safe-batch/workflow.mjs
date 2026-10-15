import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import {ethers} from 'ethers';
import {generateTransactions} from 'safe-owner-manager';
import {buildSafeTx} from '../prepare-safe-service-proposal.mjs';
import {CHAINS, SAFE_ABI, normalizeSigning, recoverSignature, safeId} from './core.mjs';
import {rpcFor, validateRpcUrl, saveSettings} from './settings.mjs';
import {PublicChainCatalog} from '../safedesk/chain-catalog.mjs';
import {verifiedQueue, verifyServiceTransaction, queueSummary, localOperations, competingHashes, replacementApproval, classifyConflicts, equalHashes, canonicalHashes, sameOwnerOrder} from './replacement.mjs';

const OWNER_ABI = new ethers.Interface([
  'function swapOwner(address prevOwner,address oldOwner,address newOwner)',
  'function removeOwner(address prevOwner,address owner,uint256 _threshold)',
  'function addOwnerWithThreshold(address owner,uint256 _threshold)',
  'function changeThreshold(uint256 _threshold)'
]);
const SENTINEL = '0x0000000000000000000000000000000000000001';
const sameSet = (a,b) => a.map(x => x.toLowerCase()).sort().join() === b.map(x => x.toLowerCase()).sort().join();
export function desiredOwners(input, safe) {
  const raw = Array.isArray(input) ? input : String(input || '').split(/[\s,;]+/).filter(Boolean);
  const owners = raw.map(x => ethers.getAddress(x));
  if (!owners.length || owners.length > 50) throw Error('Provide between 1 and 50 final owner addresses');
  if (new Set(owners.map(x => x.toLowerCase())).size !== owners.length) throw Error('Duplicate final owner address');
  if (owners.some(x => [ethers.ZeroAddress, SENTINEL, safe].filter(Boolean).map(a => a.toLowerCase()).includes(x.toLowerCase()))) throw Error('The Safe, zero address and owner sentinel cannot be owners');
  return owners;
}
export function desiredThreshold(value, count) {
  const threshold = Number(value);
  if (!Number.isInteger(threshold) || threshold < 1 || threshold > count) throw Error('Threshold must be an integer between 1 and the final owner count');
  return threshold;
}
export class ChainCatalog {
  constructor(fetcher = fetch) { this.publicCatalog = fetcher instanceof PublicChainCatalog ? fetcher : new PublicChainCatalog(fetcher); }
  async get() {
    const value=await this.publicCatalog.get();
    return {...value,source:value.source==='built-in'?'Built-in fallback':value.source,chains:value.chains.filter(x=>x.rotationSupported).map(x=>({...x,defaultRpc:CHAINS[x.chainId].rpc}))};
  }
}
export class SafeWorkflow {
  constructor(store, {urlValidator = validateRpcUrl} = {}) { this.store = store; this.urlValidator = urlValidator; }
  async context(chainId, rpc) {
    chainId = Number(chainId);
    if (!CHAINS[chainId]) throw Error('This network is not supported by SafeDesk');
    const url = rpc ? await this.urlValidator(rpc) : rpcFor(this.store.root, chainId, CHAINS[chainId].rpc);
    const context = {chainId, rpc: url, service: CHAINS[chainId].service};
    if (Number(BigInt(await this.store.rpc(context, 'eth_chainId'))) !== chainId) throw Error('RPC belongs to a different chain');
    return context;
  }
  async configure(input) {
    if (input.rpcUrl) await this.context(input.chainId, input.rpcUrl);
    if (input.tenderly?.enabled) {
      const {loadTenderlyConfig} = await import('./tenderly.mjs');
      const saved = loadTenderlyConfig(this.store.root);
      if (!(input.tenderly.account || saved.account) || !(input.tenderly.project || saved.project) || !(input.tenderly.key || saved.key)) throw Error('Tenderly requires account, project and an access key when enabled');
    }
    return saveSettings(this.store.root, input);
  }
  async inspect({chainId, safe, rpcUrl: rpc}) {
    const context = await this.context(chainId, rpc);
    safe = ethers.getAddress(safe);
    const block = await this.store.rpc(context, 'eth_blockNumber');
    if ((await this.store.rpc(context, 'eth_getCode', [safe, block])) === '0x') throw Error('No Safe contract exists at this address on this chain');
    const call = async (name, args = []) => SAFE_ABI.decodeFunctionResult(name,
      await this.store.rpc(context, 'eth_call', [{to: safe, data: SAFE_ABI.encodeFunctionData(name, args)}, block]))[0];
    const owners = [...await call('getOwners')].map(x => ethers.getAddress(x));
    const threshold = Number(await call('getThreshold')), nonce = String(await call('nonce'));
    if (!owners.length || threshold < 1 || threshold > owners.length || !Number.isSafeInteger(Number(nonce))) throw Error('Invalid or unsupported Safe state');
    let queuedTransactions=[],queueKnown=false,queueError=null;
    try { queuedTransactions=(await this.queue(context,safe,nonce)).map(queueSummary);queueKnown=true; }
    catch { queueError='Safe queue could not be fully verified; pending transactions are unknown'; }
    return {safe, chainId: context.chainId, owners, threshold, nonce, block: Number(BigInt(block)), checkedAt: new Date().toISOString(),
      queueKnown,queueError,queuedTransactions,localOperations:localOperations(this.store,context.chainId,safe,nonce)};
  }
  async queue(context, safe, nonce) {
    return verifiedQueue(this.store,context,safe,nonce,normalizeSigning);
  }
  async prepare(input) {
    const id = safeId(input.id);
    const before = await this.inspect(input);
    if (!input.snapshot || input.snapshot.safe?.toLowerCase() !== before.safe.toLowerCase() ||
        Number(input.snapshot.chainId) !== before.chainId || input.snapshot.nonce !== before.nonce ||
        input.snapshot.threshold !== before.threshold || !sameOwnerOrder(input.snapshot.owners, before.owners)) throw Error('Safe state changed or was not reviewed; load the Safe again');
    if (!before.queueKnown || input.snapshot.queueKnown !== true) throw Error('Safe queue is unknown or already queued data could not be verified; load the Safe again');
    const reviewState = snapshot => JSON.stringify({queue:snapshot.queuedTransactions.map(tx=>tx.hash).sort(),local:snapshot.localOperations});
    if (!Array.isArray(input.snapshot.queuedTransactions) || !Array.isArray(input.snapshot.localOperations) || reviewState(input.snapshot) !== reviewState(before)) throw Error('Queue or local preparation review changed; load the Safe again');
    const owners = desiredOwners(input.newOwners, before.safe), threshold = desiredThreshold(input.threshold, owners.length);
    if (sameSet(before.owners, owners) && before.threshold === threshold) throw Error('No owner or threshold changes requested');
    const context = await this.context(input.chainId, input.rpcUrl);
    const builder = await generateFromSnapshot(before, owners, threshold);
    verifyOwnerChanges(builder, before, owners, threshold);
    const tx = buildSafeTx(builder, before.nonce);
    const signing = normalizeSigning({domain: {chainId: before.chainId, verifyingContract: before.safe}, message: tx});
    const competing=competingHashes(before.queuedTransactions,before.localOperations,signing.safeTxHash);
    const candidatePresent=[...before.queuedTransactions,...before.localOperations].some(x=>x.hash.toLowerCase() === signing.safeTxHash.toLowerCase());
    const replaces=replacementApproval(input.replacement,competing,signing.safeTxHash,candidatePresent);
    const block = ethers.toQuantity(before.block), m = signing.message;
    const hash = SAFE_ABI.decodeFunctionResult('getTransactionHash', await this.store.rpc(context, 'eth_call', [{to: before.safe,
      data: SAFE_ABI.encodeFunctionData('getTransactionHash', [m.to,m.value,m.data,m.operation,m.safeTxGas,m.baseGas,m.gasPrice,m.gasToken,m.refundReceiver,m.nonce])}, block]))[0];
    if (hash.toLowerCase() !== signing.safeTxHash.toLowerCase()) throw Error('Safe onchain hash differs from the prepared EIP-712 hash');
    // Recheck after generation, before persisting a signable payload.
    const fresh = await this.inspect(input);
    if (fresh.nonce !== before.nonce || fresh.threshold !== before.threshold || !sameOwnerOrder(fresh.owners, before.owners)) throw Error('Safe state changed during preparation; load it again');
    if (!fresh.queueKnown || reviewState(fresh) !== reviewState(before)) throw Error('Queue or local preparations changed during preparation; review again');
    const alreadyProposed=fresh.queuedTransactions.some(x=>x.hash === signing.safeTxHash.toLowerCase());
    const existing=fresh.localOperations.filter(x=>x.hash === signing.safeTxHash.toLowerCase());
    const matching=existing.map(x=>this.store.operation(x.id)).find(old=>{
      try {
        return !old.draft && !old.imported && old.generator === 'safe-owner-manager@1.0.4' && old.threshold === threshold &&
          Array.isArray(old.newOwners) && sameSet(old.newOwners,owners) && old.before.chainId === before.chainId &&
          old.before.safe?.toLowerCase() === before.safe.toLowerCase() && String(old.before.nonce) === before.nonce &&
          old.before.threshold === before.threshold && sameOwnerOrder(old.before.owners,before.owners) &&
          JSON.stringify(old.signing) === JSON.stringify(signing) && equalHashes(canonicalHashes(old.replaces || []),replaces);
      } catch { return false; }
    });
    const occupied=this.store.ids().includes(id) || fs.existsSync(path.join(this.store.root,id));
    if (occupied && matching?.id !== id) throw Error('Operation name already exists');
    if (matching) {
      const old=matching;
      if (alreadyProposed) {
        this.store.state.results[old.id]={status:'proposed',safeTxHash:signing.safeTxHash,verified:true,adopted:true,at:new Date().toISOString()};
        this.store.save();
      }
      return {id:old.id,hash:signing.safeTxHash,nonce:before.nonce,threshold,owners,alreadyProposed,replaces};
    }
    await this.configure({chainId: before.chainId, rpcUrl: input.rpcUrl, tenderly: input.tenderly});
    this.store.init();
    const dir = path.join(this.store.root, id);
    const operation = {id, chainId: before.chainId, safe: before.safe, nonce: Number(before.nonce), safeTxHash: signing.safeTxHash,
      newOwners: owners, threshold, draft: false, generator: 'safe-owner-manager@1.0.4',replaces};
    fs.mkdirSync(dir);
    const files = {'operation.json': operation, 'current-owners.json': before, 'signing-data.json': signing, 'rotation.json': builder,
      'owners-after.json': {owners, threshold}, 'decoded-inner-transactions.json': tx.innerTransactions};
    for (const [name, value] of Object.entries(files)) fs.writeFileSync(path.join(dir, name), JSON.stringify(value, null, 2));
    const file = path.join(this.store.root, 'batch.json'), batch = JSON.parse(fs.readFileSync(file, 'utf8'));
    batch.operations.push(operation);
    fs.writeFileSync(file, JSON.stringify(batch, null, 2));
    if (alreadyProposed) {
      this.store.state.results[id]={status:'proposed',safeTxHash:signing.safeTxHash,verified:true,adopted:true,at:new Date().toISOString()};
      this.store.save();
    }
    return {id, hash: signing.safeTxHash, nonce: before.nonce, threshold, owners,alreadyProposed,replaces};
  }
  async transactionStatus(id, {account, walletChainId} = {}) {
    this.store.refresh();
    const op = this.store.operation(id), live = await this.inspect({chainId: op.chainId, safe: op.safe});
    const context = {chainId: op.chainId, rpc: op.rpc, service: op.service};
    account = account ? ethers.getAddress(account) : null;
    const unchanged = live.nonce === op.signing.message.nonce && live.threshold === op.before.threshold && sameOwnerOrder(live.owners, op.before.owners);
    const onchainHash = SAFE_ABI.decodeFunctionResult('getTransactionHash', await this.store.rpc(context, 'eth_call', [{to: op.safe,
      data: SAFE_ABI.encodeFunctionData('getTransactionHash', Object.values(op.signing.message))}, ethers.toQuantity(live.block)]))[0];
    const hashMatches = onchainHash.toLowerCase() === op.safeTxHash.toLowerCase();
    let transaction = null, serviceError = null, queued = [], serviceKnown = false;
    try {
      const response = await this.store.fetcher(`${op.service}/api/v1/multisig-transactions/${op.safeTxHash}/`, {redirect: 'error', signal: AbortSignal.timeout(25000)});
      if (response.ok) {
        transaction = verifyServiceTransaction(await response.json(),{chainId:op.chainId,safe:op.safe,nonce:op.signing.message.nonce,hash:op.safeTxHash,allowExecuted:true},normalizeSigning);
      } else if (response.status !== 404) throw Error('Safe service unavailable');
      queued = await this.queue(context, op.safe, live.nonce);
      serviceKnown = true;
    } catch { serviceError = 'Safe service could not be verified; approvals and queue are unknown'; transaction = null; }
    const ownerSet = new Set(live.owners.map(x => x.toLowerCase())), published = new Map(), collected = new Map();
    let unverifiable = 0;
    for (const c of transaction?.confirmations || []) {
      try {
        if (!ownerSet.has(c.owner.toLowerCase())) throw Error('Former owner');
        let signature;
        if (/^0x[\da-fA-F]{130}$/.test(c.signature) && parseInt(c.signature.slice(-2), 16) === 1) {
          const encodedOwner = ethers.getAddress('0x' + c.signature.slice(26,66));
          if (encodedOwner.toLowerCase() !== c.owner.toLowerCase() || !/^0+$/.test(c.signature.slice(66,130))) throw Error('Invalid approved hash encoding');
          const approved = SAFE_ABI.decodeFunctionResult('approvedHashes', await this.store.rpc(context, 'eth_call', [{to:op.safe,
            data:SAFE_ABI.encodeFunctionData('approvedHashes',[c.owner,op.safeTxHash])},ethers.toQuantity(live.block)]))[0];
          if (approved === 0n) throw Error('Hash approval not present onchain');
          signature = c.signature;
        } else signature = recoverSignature(op.signing, c.owner, c.signature).signature;
        published.set(c.owner.toLowerCase(), {sender: ethers.getAddress(c.owner), signature});
      } catch { unverifiable++; }
    }
    for (const c of this.store.signatures(op)) {
      try { if (ownerSet.has(c.sender.toLowerCase())) collected.set(c.sender.toLowerCase(), recoverSignature(op.signing, c.sender, c.signature)); } catch { /* Stale/invalid local signatures are not counted. */ }
    }
    const combined = new Map([...published, ...collected]);
    const conflictState=classifyConflicts(op,serviceKnown ? queued : [],localOperations(this.store,op.chainId,op.safe,live.nonce));
    const {conflicts,reviewedConflicts,unreviewedConflicts,replaces,replacementReviewStale}=conflictState;
    const currentOwner = !!account && ownerSet.has(account.toLowerCase());
    const walletNetworkMatches = !!account && Number(walletChainId) === op.chainId;
    const eligible = unchanged && hashMatches && serviceKnown && !replacementReviewStale && !transaction?.isExecuted && !op.draft && !!op.simulation?.matched;
    const canSign = eligible && currentOwner && walletNetworkMatches;
    const execution = {canExecute:false, status:'Waiting for signatures', checked:false, gasUnits:null, estimatedNativeCost:null, walletBalance:null};
    if (transaction?.isExecuted) execution.status = transaction.isSuccessful === false ? 'Executed with failure' : 'Already executed';
    else if (!unchanged || !hashMatches) execution.status = 'Safe state changed; rebuild required';
    else if (!serviceKnown) execution.status = 'Safe service unavailable';
    else if (replaces.length) execution.status = replacementReviewStale ? 'Replacement review changed; prepare a new revision' : 'Replacement execution requires separate coordination';
    else if (conflicts.length) execution.status = 'Conflicting transaction at the current nonce';
    else if (op.draft || !op.simulation?.matched) execution.status = op.draft ? 'Draft decision outstanding' : 'Successful simulation required';
    else if (combined.size >= live.threshold) {
      execution.status = account ? (walletNetworkMatches ? 'Checking execution' : 'Switch wallet network') : 'Connect wallet for execution check';
      if (account && walletNetworkMatches) {
        try {
          const signatures = [...combined.values()].sort((a,b) => a.sender.toLowerCase().localeCompare(b.sender.toLowerCase())).slice(0, live.threshold);
          const m = op.signing.message, data = SAFE_ABI.encodeFunctionData('execTransaction', [m.to,m.value,m.data,m.operation,m.safeTxGas,m.baseGas,m.gasPrice,m.gasToken,m.refundReceiver,ethers.concat(signatures.map(s=>s.signature))]);
          const request = {from:account,to:op.safe,data,value:'0x0'}, block = ethers.toQuantity(live.block);
          const succeeds = SAFE_ABI.decodeFunctionResult('execTransaction', await this.store.rpc(context, 'eth_call', [request,block]))[0];
          if (!succeeds) throw Error('Execution would fail');
          const gas = BigInt(await this.store.rpc(context, 'eth_estimateGas', [request,block]));
          const gasPrice = BigInt(await this.store.rpc(context, 'eth_gasPrice'));
          const balance = BigInt(await this.store.rpc(context, 'eth_getBalance', [account,block]));
          const estimate = gas * gasPrice;
          execution.checked = true; execution.gasUnits = String(gas);
          execution.estimatedNativeCost = ethers.formatEther(estimate); execution.walletBalance = ethers.formatEther(balance);
          // Reserve headroom; gas price and state can still change before a real execution.
          execution.canExecute = balance >= estimate * 12n / 10n;
          execution.status = execution.canExecute ? 'Read-only execution check passed' : 'Wallet needs more gas funds';
        } catch { execution.status = 'Read-only execution check failed or RPC cannot estimate gas'; }
      }
    }
    return {checkedAt:live.checkedAt,block:live.block,liveNonce:live.nonce,preparedNonce:op.signing.message.nonce,threshold:live.threshold,
      owners:live.owners,unchanged,hashMatches,serviceKnown,serviceError,proposed:!!transaction,executed:!!transaction?.isExecuted,
      transactionId:transaction?.transactionHash || null,publishedApprovals:published.size,unverifiableApprovals:unverifiable,
      publishedOwners:[...published.values()].map(x=>x.sender),localSignatures:collected.size,usableSignatures:combined.size,
      currentQueue:serviceKnown ? queued.map(queueSummary) : [],conflicts,reviewedConflicts,unreviewedConflicts,replaces,replacementReviewStale,
      wallet:{account,currentOwner,networkMatches:walletNetworkMatches,canSign,alreadyPublished:!!account && published.has(account.toLowerCase())},
      execution,safeUrl:`${Number(op.chainId)===60808?'https://safe.gobob.xyz':'https://app.safe.global'}/transactions/queue?safe=${CHAINS[op.chainId].short}:${op.safe}`};
  }
}

// The library reads a pinned, already verified snapshot through a temporary local RPC.
// No credential-bearing endpoint is handed to the library or written into its output.
export async function generateFromSnapshot(before, owners, threshold) {
  const server = http.createServer(async (req,res) => {
    try {
      let body = ''; for await (const chunk of req) { body += chunk; if (body.length > 65536) throw Error('Too large'); }
      const input = JSON.parse(body);
      const answer = q => {
        let result;
        if (q.method === 'eth_chainId') result = ethers.toQuantity(before.chainId);
        else if (q.method === 'eth_call' && q.params[0].to.toLowerCase() === before.safe.toLowerCase()) {
          const parsed = SAFE_ABI.parseTransaction({data:q.params[0].data});
          if (!['getOwners','getThreshold'].includes(parsed.name)) throw Error('Unexpected snapshot request');
          result = SAFE_ABI.encodeFunctionResult(parsed.name, [parsed.name === 'getOwners' ? before.owners : before.threshold]);
        } else throw Error('Unexpected snapshot request');
        return {jsonrpc:'2.0',id:q.id,result};
      };
      res.writeHead(200, {'content-type':'application/json'});
      res.end(JSON.stringify(Array.isArray(input) ? input.map(answer) : answer(input)));
    } catch { res.writeHead(400); res.end('{}'); }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    const builder = await generateTransactions({safeAddress:before.safe,newOwners:owners,chainId:before.chainId,newThreshold:threshold,rpcUrl:`http://127.0.0.1:${server.address().port}`});
    // v1.0.4 omits a threshold-only change; preserve its owner logic and add that explicit call.
    if (!builder.transactions.length && threshold !== before.threshold) {
      builder.transactions.push({to:before.safe,value:'0',operation:0,data:OWNER_ABI.encodeFunctionData('changeThreshold',[threshold])});
      delete builder.meta.checksum;
      builder.meta.description = 'SafeDesk threshold-only correction for safe-owner-manager 1.0.4';
    }
    return builder;
  } finally { await new Promise(resolve => server.close(resolve)); }
}
export function verifyOwnerChanges(builder, before, expectedOwners, expectedThreshold) {
  let owners = [...before.owners], threshold = before.threshold;
  const validThreshold = value => desiredThreshold(Number(value), owners.length);
  const previous = index => index === 0 ? SENTINEL : owners[index - 1];
  for (const tx of builder.transactions) {
    if (tx.to.toLowerCase() !== before.safe.toLowerCase() || BigInt(tx.value || 0) !== 0n || Number(tx.operation || 0) !== 0) throw Error('Owner-manager output contains a non-Safe call');
    const data = tx.data && tx.data !== '0x' ? tx.data : OWNER_ABI.encodeFunctionData(tx.contractMethod.name, tx.contractMethod.inputs.map(x=>tx.contractInputsValues[x.name]));
    const call = OWNER_ABI.parseTransaction({data}), a = call.args;
    if (call.name === 'swapOwner' || call.name === 'removeOwner') {
      const index = owners.findIndex(x=>x.toLowerCase()===a[1].toLowerCase());
      if (index < 0 || previous(index).toLowerCase() !== a[0].toLowerCase()) throw Error('Owner-manager predecessor does not match the linked list');
      if (call.name === 'swapOwner') { if (owners.some(x=>x.toLowerCase()===a[2].toLowerCase())) throw Error('Duplicate owner in generated swap'); owners[index] = a[2]; }
      else { owners.splice(index,1); threshold = validThreshold(a[2]); }
    } else if (call.name === 'addOwnerWithThreshold') {
      if (owners.some(x=>x.toLowerCase()===a[0].toLowerCase())) throw Error('Duplicate generated owner');
      owners.unshift(a[0]); threshold = validThreshold(a[1]);
    } else if (call.name === 'changeThreshold') threshold = validThreshold(a[0]);
    else throw Error('Unexpected owner-manager method');
  }
  if (!sameSet(owners,expectedOwners) || threshold !== expectedThreshold) throw Error('Generated calls do not produce the reviewed owners and threshold');
}
