import {ethers} from 'ethers';

export function canonicalHashes(values) {
  if (!Array.isArray(values)) throw Error('Replacement hashes must be an array');
  const hashes = values.map(value => {
    if (typeof value !== 'string' || !/^0x[0-9a-fA-F]{64}$/.test(value) || value.toLowerCase() === ethers.ZeroHash) throw Error('Replacement requires full nonzero transaction hashes');
    return value.toLowerCase();
  });
  if (new Set(hashes).size !== hashes.length) throw Error('Duplicate replacement hash');
  return hashes.sort();
}

export const equalHashes = (a,b) => JSON.stringify(a) === JSON.stringify(b);
export const sameOwnerOrder = (a,b) => Array.isArray(a) && Array.isArray(b) && a.length === b.length &&
  a.every((owner,index)=>owner.toLowerCase() === b[index].toLowerCase());

export function verifyServiceTransaction(raw, identity, normalizeSigning) {
  if (!raw || typeof raw !== 'object' || ethers.getAddress(raw.safe) !== ethers.getAddress(identity.safe)) throw Error('Safe queue transaction belongs to a different Safe');
  if (typeof raw.isExecuted !== 'boolean' || (!identity.allowExecuted && raw.isExecuted !== false)) throw Error('Safe queue transaction is not pending');
  const hash = canonicalHashes([raw.safeTxHash])[0];
  if (identity.hash && hash !== identity.hash.toLowerCase()) throw Error('Service transaction hash differs');
  for (const key of ['nonce','value','safeTxGas','baseGas','gasPrice']) {
    if (!['number','string'].includes(typeof raw[key]) || !/^\d+$/.test(String(raw[key])) ||
        (typeof raw[key] === 'number' && !Number.isSafeInteger(raw[key])) || BigInt(raw[key]) >= 2n**256n) throw Error('Unsafe service transaction numeric field');
  }
  if (![0,1].includes(raw.operation)) throw Error('Invalid service transaction operation');
  if (raw.data === undefined) throw Error('Missing service transaction calldata');
  const signing = normalizeSigning({domain:{chainId:identity.chainId,verifyingContract:identity.safe},
    message:{...raw,data:raw.data === null ? '0x' : raw.data},safeTxHash:hash});
  if (identity.nonce !== undefined && signing.message.nonce !== String(identity.nonce)) throw Error('Safe queue transaction has a different nonce');
  if (!Array.isArray(raw.confirmations)) throw Error('Safe queue confirmations are unreadable');
  return {...raw,...signing.message,safe:signing.domain.verifyingContract,safeTxHash:hash};
}

export function queueSummary(transaction) {
  return {hash:transaction.safeTxHash,nonce:transaction.nonce,to:transaction.to,
    confirmations:transaction.confirmations.length,executed:false};
}

export async function verifiedQueue(store, context, safe, nonce, normalizeSigning) {
  safe = ethers.getAddress(safe);
  const base = new URL(context.service), pathname = `${base.pathname.replace(/\/$/,'')}/api/v1/safes/${safe}/multisig-transactions/`;
  let url = new URL(`${pathname}?executed=false&nonce=${nonce}&limit=100`,base), pages = 0;
  const seen = new Set(), transactions = new Map();
  while (url) {
    if (url.origin !== base.origin || url.username || url.password || url.hash || url.pathname.toLowerCase() !== pathname.toLowerCase() ||
        ['executed','nonce','limit'].some(key=>url.searchParams.getAll(key).length !== 1) ||
        url.searchParams.get('executed') !== 'false' || url.searchParams.get('nonce') !== String(nonce) ||
        !/^\d+$/.test(url.searchParams.get('limit') || '') || Number(url.searchParams.get('limit')) < 1 || Number(url.searchParams.get('limit')) > 100) throw Error('Unexpected queue pagination origin, Safe path or query');
    if (seen.has(url.href) || ++pages > 10) throw Error('Safe queue too large or cyclic to verify');
    seen.add(url.href);
    const response = await store.json(url.href);
    if (!Array.isArray(response.results) || response.results.length > 100 || !(response.next === null || typeof response.next === 'string')) throw Error('Safe queue response is unreadable');
    for (const raw of response.results) {
      const tx = verifyServiceTransaction(raw,{...context,safe,nonce},normalizeSigning);
      transactions.set(tx.safeTxHash,tx);
    }
    url = response.next ? new URL(response.next,url) : null;
  }
  return [...transactions.values()].sort((a,b)=>a.safeTxHash.localeCompare(b.safeTxHash));
}

export function localOperations(store, chainId, safe, nonce) {
  return store.ids().map(id=>store.operation(id)).filter(op=>op.chainId === Number(chainId) &&
    op.safe.toLowerCase() === safe.toLowerCase() && op.signing.message.nonce === String(nonce))
    .map(op=>({id:op.id,hash:op.safeTxHash.toLowerCase(),nonce:op.signing.message.nonce})).sort((a,b)=>a.id.localeCompare(b.id));
}

export function competingHashes(queue, local, candidate) {
  return canonicalHashes([...new Set([...queue.map(tx=>tx.hash || tx.safeTxHash),...local.map(op=>op.hash)]
    .map(hash=>hash.toLowerCase()).filter(hash=>hash !== candidate?.toLowerCase()))]);
}

export function replacementApproval(input, current, candidate, candidatePresent=false) {
  if (input === undefined) {
    if (current.length) throw Error('A transaction is already queued or prepared at this nonce; explicit replacement review is required');
    return [];
  }
  if (!input || input.confirm !== 'REPLACE') throw Error('Confirm the intentional replacement with REPLACE');
  const acknowledged = canonicalHashes(input.acknowledgedHashes);
  if (acknowledged.includes(candidate?.toLowerCase()) && !candidatePresent) throw Error('Replacement contains an extraneous candidate hash');
  const hashes = acknowledged.filter(hash=>hash !== candidate?.toLowerCase());
  if (!equalHashes(hashes,current)) throw Error('Replacement review changed or is incomplete; review every current competing hash again');
  return hashes;
}

export function classifyConflicts(op, queue, local) {
  const replaces = canonicalHashes(op.replaces || []);
  if (replaces.includes(op.safeTxHash.toLowerCase())) throw Error('Replacement cannot acknowledge its own hash');
  const hashes = competingHashes(queue,local,op.safeTxHash);
  const conflicts = hashes.map(hash=>{
    const tx=queue.find(tx=>(tx.hash || tx.safeTxHash).toLowerCase() === hash);
    return tx ? {...(tx.hash ? tx : queueSummary(tx)),localIds:local.filter(x=>x.hash === hash).map(x=>x.id)} :
      {hash,nonce:op.signing.message.nonce,to:null,confirmations:0,executed:false,localIds:local.filter(x=>x.hash === hash).map(x=>x.id)};
  });
  return {replaces,replacementReviewStale:!equalHashes(replaces,hashes),conflictingHashes:hashes,conflicts,reviewedConflicts:conflicts.filter(x=>replaces.includes(x.hash)),
    unreviewedConflicts:conflicts.filter(x=>!replaces.includes(x.hash))};
}
