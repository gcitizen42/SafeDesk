import fs from 'node:fs';
import path from 'node:path';
import {ethers} from 'ethers';
import {safeTxTypes} from '../prepare-safe-service-proposal.mjs';

export const CHAINS={
 1:{name:'Ethereum',short:'eth',rpc:'https://ethereum.publicnode.com',service:'https://safe-transaction-mainnet.safe.global',explorer:'https://etherscan.io'},
 10:{name:'Optimism',short:'oeth',rpc:'https://mainnet.optimism.io',service:'https://safe-transaction-optimism.safe.global',explorer:'https://optimistic.etherscan.io'},
 137:{name:'Polygon',short:'matic',rpc:'https://polygon-bor-rpc.publicnode.com',service:'https://safe-transaction-polygon.safe.global',explorer:'https://polygonscan.com'},
 42161:{name:'Arbitrum',short:'arb1',rpc:'https://arb1.arbitrum.io/rpc',service:'https://safe-transaction-arbitrum.safe.global',explorer:'https://arbiscan.io'},
 8453:{name:'Base',short:'base',rpc:'https://base-rpc.publicnode.com',service:'https://safe-transaction-base.safe.global',explorer:'https://basescan.org'},
 60808:{name:'BOB',short:'bob',rpc:'https://rpc.gobob.xyz',service:'https://transaction.safe.gobob.xyz',explorer:'https://explorer.gobob.xyz'}
};
export const SAFE_ABI=new ethers.Interface([
 'function getOwners() view returns(address[])','function getThreshold() view returns(uint256)','function nonce() view returns(uint256)',
 'function getTransactionHash(address,uint256,bytes,uint8,uint256,uint256,uint256,address,address,uint256) view returns(bytes32)',
 'function execTransaction(address,uint256,bytes,uint8,uint256,uint256,uint256,address,address,bytes) returns(bool)'
]);
const FIELDS=['to','value','data','operation','safeTxGas','baseGas','gasPrice','gasToken','refundReceiver','nonce'];
export const safeId=id=>{if(!/^[a-z0-9][a-z0-9-]{0,63}$/.test(id))throw Error('Invalid operation name');return id;};
const read=file=>JSON.parse(fs.readFileSync(file,'utf8'));
const optional=file=>fs.existsSync(file)?read(file):null;
const eqSet=(a,b)=>a.map(x=>x.toLowerCase()).sort().join()===b.map(x=>x.toLowerCase()).sort().join();
export function normalizeSigning(input){
 const domain={chainId:Number(input.domain?.chainId),verifyingContract:ethers.getAddress(input.domain?.verifyingContract)};
 if(!CHAINS[domain.chainId])throw Error('Unsupported chain');
 const src=input.message;if(!src)throw Error('Import full signing-data.json, not a hash alone');
 const message=Object.fromEntries(FIELDS.map(k=>{if(src[k]===undefined)throw Error(`Missing ${k}`);return[k,src[k]];}));
 for(const k of ['to','gasToken','refundReceiver'])message[k]=ethers.getAddress(message[k]);
 for(const k of ['value','safeTxGas','baseGas','gasPrice','nonce']){const n=BigInt(message[k]);if(n<0n)throw Error('Negative transaction value');message[k]=String(n);}
 message.operation=Number(message.operation);if(![0,1].includes(message.operation))throw Error('Invalid operation');
 if(!ethers.isHexString(message.data))throw Error('Invalid calldata');
 const types=safeTxTypes(),safeTxHash=ethers.TypedDataEncoder.hash(domain,types,message);
 if(input.safeTxHash&&input.safeTxHash.toLowerCase()!==safeTxHash.toLowerCase())throw Error('Imported hash does not match full transaction');
 return{domain,types,primaryType:'SafeTx',message,safeTxHash};
}
export function recoverSignature(signing,sender,signature){
 sender=ethers.getAddress(sender);
 if(!/^0x[\da-fA-F]{130}$/.test(signature))throw Error('Signature must be 65 bytes');
 const v=parseInt(signature.slice(-2),16);if(![0,1,27,28,31,32].includes(v))throw Error('Unsupported signature type');
 const normalized=signature.slice(0,-2)+(v>=31?v-4:v<27?v+27:v).toString(16).padStart(2,'0');
 if(v<31){try{if(ethers.verifyTypedData(signing.domain,signing.types,signing.message,normalized).toLowerCase()===sender.toLowerCase())return{sender,signature:normalized,mode:'EIP-712'};}catch{}}
 try{if(ethers.verifyMessage(ethers.getBytes(signing.safeTxHash),normalized).toLowerCase()===sender.toLowerCase())return{sender,signature:normalized.slice(0,-2)+(parseInt(normalized.slice(-2),16)+4).toString(16),mode:'Safe personal_sign'};}catch{}
 throw Error('Signature does not recover this owner for this Safe transaction');
}
export function simulationMatch(document,signing){
 const hash=signing.safeTxHash.toLowerCase();
 // Local reports explicitly bind their result to the exact SafeTx hash.
 if(document.safeTxHash?.toLowerCase()===hash&&document.status==='PASSED')return{matched:true,kind:document.kind||'Imported hash-bound result',assumptions:document.approvalAssumption||'Imported report; provenance supplied by operator'};
 const tx=document.transaction||document.simulation?.transaction;
 if(!tx)throw Error('Result needs a hash-bound PASSED report or a full Safe execTransaction with receipt logs');
 if(String(tx.to||'').toLowerCase()!==signing.domain.verifyingContract.toLowerCase())throw Error('Simulation executed a different Safe');
 const decoded=SAFE_ABI.decodeFunctionData('execTransaction',tx.input||tx.data);
 for(let i=0;i<9;i++){const k=FIELDS[i],a=String(decoded[i]).toLowerCase(),b=String(signing.message[k]).toLowerCase();if(a!==b)throw Error(`Simulation differs in ${k}`);}
 const receipt=document.receipt||tx.receipt||document;
 const successTopic=ethers.id('ExecutionSuccess(bytes32,uint256)').toLowerCase();
 const success=(receipt.logs||document.logs||tx.logs||[]).some(log=>{
  if(String(log.address||'').toLowerCase()!==signing.domain.verifyingContract.toLowerCase()||log.topics?.[0]?.toLowerCase()!==successTopic)return false;
  try{return ethers.AbiCoder.defaultAbiCoder().decode(['bytes32','uint256'],log.data)[0].toLowerCase()===hash;}catch{return false;}
 });
 if(!success)throw Error('No ExecutionSuccess event for this SafeTx hash. A transaction hash alone cannot verify the Safe nonce/domain.');
 return{matched:true,kind:'Imported Safe execution and success event',assumptions:'Simulation approvals are assumed; report provenance supplied by operator'};
}
function simulationUrl(value){if(!value)return'';const u=new URL(value);if(u.protocol!=='https:'||u.hostname!=='dashboard.tenderly.co'||u.username||u.password)throw Error('Use a dashboard.tenderly.co simulation link');return u.href;}
export class BatchStore{
 constructor(root,{fetcher=fetch}={}){
  this.root=path.resolve(root);this.fetcher=fetcher;this.secretDir=path.join(this.root,'secrets');
  fs.mkdirSync(this.secretDir,{recursive:true,mode:0o700});fs.chmodSync(this.secretDir,0o700);
  this.state=optional(path.join(this.secretDir,'batch-state.json'))||{signatures:[],simulations:{},results:{}};
  this.state.simulations??={};this.state.results??={};
 }
 refresh(){if(!this.locked){const saved=optional(path.join(this.secretDir,'batch-state.json'));if(saved)this.state=saved;}}
 async withLock(fn){
  const file=path.join(this.secretDir,'batch.lock');let fd;
  try{fd=fs.openSync(file,'wx',0o600);}catch(e){if(e.code==='EEXIST')throw Error('Another UI/CLI command is using this batch; wait and retry. If interrupted, inspect secrets/batch.lock before removing it.');throw e;}
  try{fs.writeFileSync(fd,JSON.stringify({pid:process.pid,startedAt:new Date().toISOString()}));this.refresh();this.locked=true;return await fn();}
  finally{this.locked=false;fs.closeSync(fd);fs.unlinkSync(file);}
 }
 save(){const file=path.join(this.secretDir,'batch-state.json'),temp=file+'.tmp';fs.writeFileSync(temp,JSON.stringify(this.state,null,2),{mode:0o600});fs.renameSync(temp,file);fs.chmodSync(file,0o600);}
 ids(){const b=read(path.join(this.root,'batch.json'));return b.operations.filter(x=>!x.error).map(x=>safeId(x.id));}
 operation(id){
  safeId(id);if(!this.ids().includes(id))throw Error('Unknown operation');
  const dir=path.join(this.root,id),op=read(path.join(dir,'operation.json')),signing=normalizeSigning(read(path.join(dir,'signing-data.json'))),before=read(path.join(dir,'current-owners.json'));
  if(op.chainId!==signing.domain.chainId||op.safe.toLowerCase()!==signing.domain.verifyingContract.toLowerCase()||op.safeTxHash!==signing.safeTxHash)throw Error('Operation and signing data disagree');
  const local=optional(path.join(dir,'local-simulation.json'));let simulation=null;
  if(local?.status==='PASSED'){simulation=simulationMatch(local,signing);simulation.source='Local fork';}
  const attached=this.state.simulations[id];if(attached?.hash===signing.safeTxHash&&attached.match)simulation={...attached.match,source:'Imported result',url:attached.url};
  if(attached?.hash===signing.safeTxHash&&attached.failed)simulation=null;
  return{...op,id,name:CHAINS[op.chainId].name,signing,before,simulation,simulationUrl:attached?.url||'',rpc:CHAINS[op.chainId].rpc,service:CHAINS[op.chainId].service};
 }
 signatures(op){return this.state.signatures.filter(s=>s.id===op.id&&s.safeTxHash===op.safeTxHash);}
 list(){this.refresh();return this.ids().map(id=>{const op=this.operation(id),sigs=this.signatures(op);return{id,chainId:op.chainId,chain:op.name,safe:op.safe,nonce:op.signing.message.nonce,hash:op.safeTxHash,draft:!!op.draft,currentThreshold:op.before.threshold,proposedThreshold:op.threshold,newOwners:op.newOwners,owners:op.before.owners,signing:op.signing,simulation:op.simulation,simulationUrl:op.simulationUrl,tenderlyJob:this.state.tenderlyJobs?.[id]||null,signatures:sigs.map(s=>({sender:s.sender,mode:s.mode})),result:this.state.results[id]||null};});}
 async json(url,options={}){const r=await this.fetcher(url,{...options,signal:AbortSignal.timeout(25000)});if(!r.ok)throw Error(`Service request failed (${r.status})`);return r.json();}
 async rpc(op,method,params=[]){const j=await this.json(op.rpc,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id:1,method,params})});if(j.error)throw Error(j.error.message||'RPC rejected request');return j.result;}
 async check(id,{ready=false}={}){
  const op=this.operation(id),m=op.signing.message;
  if(Number(BigInt(await this.rpc(op,'eth_chainId')))!==op.chainId)throw Error('RPC chain differs');
  const block=await this.rpc(op,'eth_blockNumber');const call=async(name,args=[])=>SAFE_ABI.decodeFunctionResult(name,await this.rpc(op,'eth_call',[{to:op.safe,data:SAFE_ABI.encodeFunctionData(name,args)},block]))[0];
  const owners=[...await call('getOwners')],threshold=Number(await call('getThreshold')),nonce=String(await call('nonce'));
  if(!eqSet(owners,op.before.owners)||threshold!==op.before.threshold||nonce!==String(m.nonce))throw Error('Safe owners, threshold or nonce changed; rebuild the payload and collect new signatures');
  const chainHash=await call('getTransactionHash',[m.to,m.value,m.data,m.operation,m.safeTxGas,m.baseGas,m.gasPrice,m.gasToken,m.refundReceiver,m.nonce]);if(chainHash.toLowerCase()!==op.safeTxHash.toLowerCase())throw Error('Onchain Safe hash differs');
  let url=`${op.service}/api/v1/safes/${op.safe}/multisig-transactions/?executed=false&nonce=${nonce}&limit=100`,pages=0;
  while(url){if(new URL(url).origin!==new URL(op.service).origin)throw Error('Unexpected queue pagination origin');const q=await this.json(url);if(q.results?.some(t=>String(t.nonce)===nonce&&t.safeTxHash?.toLowerCase()!==op.safeTxHash.toLowerCase()))throw Error('Another proposed transaction uses this nonce');if(++pages>10)throw Error('Queue too large for this review');url=q.next;}
  if(ready){if(op.draft)throw Error('Threshold decision outstanding for this draft');if(!op.simulation?.matched)throw Error('Attach a matching successful simulation before signing/proposing');}
  return{checkedAt:new Date().toISOString(),owners,threshold,nonce,hash:chainHash,block:Number(BigInt(block))};
 }
 async collect(id,sender,signature){const op=this.operation(id),live=await this.check(id,{ready:true});const s=recoverSignature(op.signing,sender,signature);if(!live.owners.some(o=>o.toLowerCase()===s.sender.toLowerCase()))throw Error('Signer is not a current owner');this.state.signatures=this.state.signatures.filter(x=>!(x.id===id&&x.safeTxHash===op.safeTxHash&&x.sender.toLowerCase()===s.sender.toLowerCase()));this.state.signatures.push({id,chainId:op.chainId,safe:op.safe,safeTxHash:op.safeTxHash,...s,collectedAt:new Date().toISOString()});this.save();return{sender:s.sender,mode:s.mode,hash:op.safeTxHash};}
 attach(id,url,document){const op=this.operation(id);const link=simulationUrl(url);const match=document?simulationMatch(document,op.signing):null;this.state.simulations[id]={url:link,hash:op.safeTxHash,match};this.save();return{url:link,match};}
 export(){this.refresh();return{version:1,exportedAt:new Date().toISOString(),operations:this.ids().map(id=>{const op=this.operation(id);return{id,signing:op.signing,signatures:this.signatures(op),simulation:this.state.simulations[id]||null};})};}
 async importSignatures(data){if(data.version!==1||!Array.isArray(data.operations))throw Error('Unknown collection format');let count=0;for(const item of data.operations){const op=this.operation(item.id);if(normalizeSigning(item.signing).safeTxHash!==op.safeTxHash)throw Error('Collection transaction differs');for(const sig of item.signatures||[]){await this.collect(item.id,sig.sender,sig.signature);count++;}}return{imported:count};}
 async add(id,input){
  safeId(id);if(this.ids().includes(id)||fs.existsSync(path.join(this.root,id)))throw Error('Name already exists');const s=normalizeSigning(input);
  for(const old of this.list())if(old.chainId===s.domain.chainId&&old.safe.toLowerCase()===s.domain.verifyingContract.toLowerCase()&&String(old.nonce)===s.message.nonce)throw Error('Safe/nonce is already in this batch');
  const chain=CHAINS[s.domain.chainId],op={id,chainId:s.domain.chainId,safe:s.domain.verifyingContract,safeTxHash:s.safeTxHash,nonce:Number(s.message.nonce),...chain};
  if(!Number.isSafeInteger(op.nonce))throw Error('Nonce outside supported range');
  if(Number(BigInt(await this.rpc(op,'eth_chainId')))!==op.chainId)throw Error('RPC chain differs');
  const block=await this.rpc(op,'eth_blockNumber');
  const call=async(name,args=[])=>SAFE_ABI.decodeFunctionResult(name,await this.rpc(op,'eth_call',[{to:op.safe,data:SAFE_ABI.encodeFunctionData(name,args)},block]))[0];
  const owners=[...await call('getOwners')],threshold=Number(await call('getThreshold'));if(String(await call('nonce'))!==s.message.nonce)throw Error('Imported nonce is not current');
  const m=s.message;if((await call('getTransactionHash',[m.to,m.value,m.data,m.operation,m.safeTxGas,m.baseGas,m.gasPrice,m.gasToken,m.refundReceiver,m.nonce])).toLowerCase()!==s.safeTxHash.toLowerCase())throw Error('Onchain Safe hash differs');
  const dir=path.join(this.root,id);fs.mkdirSync(dir);for(const [name,value]of Object.entries({'operation.json':{...op,threshold:null,newOwners:[],draft:false,imported:true},'signing-data.json':s,'current-owners.json':{owners,threshold,nonce:op.nonce,safe:op.safe,chainId:op.chainId}}))fs.writeFileSync(path.join(dir,name),JSON.stringify(value,null,2));
  const file=path.join(this.root,'batch.json'),batch=read(file);batch.operations.push(op);fs.writeFileSync(file,JSON.stringify(batch,null,2));return{id,hash:s.safeTxHash};
 }
 async review(ids){if(!Array.isArray(ids)||!ids.length||new Set(ids).size!==ids.length)throw Error('Select at least one unique operation');const out=[];for(const id of ids){const op=this.operation(id),live=await this.check(id,{ready:true}),sigs=this.signatures(op);if(!sigs.length)throw Error(`${id}: no collected signatures`);for(const sig of sigs){recoverSignature(op.signing,sig.sender,sig.signature);if(!live.owners.some(x=>x.toLowerCase()===sig.sender.toLowerCase()))throw Error('Collected signer is no longer owner');}out.push({id,safe:op.safe,chain:op.name,hash:op.safeTxHash,nonce:live.nonce,signers:sigs.map(x=>x.sender),signatures:sigs.length,threshold:live.threshold});}return out;}
 async propose(ids){
  await this.review(ids);const results=[];
  for(const id of ids){const op=this.operation(id),sigs=this.signatures(op),m=op.signing.message;let result;
   try{
    await this.check(id,{ready:true});
    const url=`${op.service}/api/v1/multisig-transactions/${op.safeTxHash}/`;let existing=null;
    const found=await this.fetcher(url,{signal:AbortSignal.timeout(25000)});if(found.ok){existing=await found.json();if(existing.isExecuted)throw Error('Transaction already executed');}else if(found.status!==404)throw Error(`Proposal lookup failed (${found.status})`);
    const first=sigs[0];
    if(!existing){const payload={...m,nonce:Number(m.nonce),safeTxGas:Number(m.safeTxGas),baseGas:Number(m.baseGas),contractTransactionHash:op.safeTxHash,sender:first.sender,signature:first.signature,origin:'Threshold Safe batch console'};for(const k of ['nonce','safeTxGas','baseGas'])if(!Number.isSafeInteger(payload[k]))throw Error('Unsafe numeric field');await this.post(`${op.service}/api/v1/safes/${op.safe}/multisig-transactions/`,payload);existing=await this.json(url);}
    const confirmed=new Set((existing.confirmations||[]).map(c=>c.owner.toLowerCase()));
    for(const sig of sigs)if(!confirmed.has(sig.sender.toLowerCase()))await this.post(`${url}confirmations/`,{signature:sig.signature});
    result={status:'proposed',safeTxHash:op.safeTxHash,at:new Date().toISOString(),safeUrl:`https://app.safe.global/transactions/queue?safe=${CHAINS[op.chainId].short}:${op.safe}`};
   }catch(e){result={status:'needs-check',message:e.message,safeTxHash:op.safeTxHash,at:new Date().toISOString()};}
   this.state.results[id]=result;this.save();results.push({id,...result});
   // A network failure may follow an accepted POST. Preserve progress and stop for reconciliation.
   if(result.status!=='proposed')break;
  }
  return results;
 }
 async post(url,data){const r=await this.fetcher(url,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(data),signal:AbortSignal.timeout(30000)});if(!r.ok)throw Error(`Safe service rejected submission (${r.status})`);}
}
