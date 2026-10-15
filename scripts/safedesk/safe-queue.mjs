import {ethers} from 'ethers';
import {safeTxTypes} from '../prepare-safe-service-proposal.mjs';

const prefixes={1:'eth',10:'oeth',56:'bnb',100:'gno',137:'matic',42161:'arb1',43114:'avax',8453:'base',11155111:'sep'};
const services=Object.fromEntries(Object.entries(prefixes).map(([id,prefix])=>[id,`https://api.safe.global/tx-service/${prefix}`]));
services[60808]='https://transaction.safe.gobob.xyz';prefixes[60808]='bob';
const hash=/^0x[\da-f]{64}$/i;
const uint=value=>{
 if(typeof value==='number'&&!Number.isSafeInteger(value))throw Error('Unsafe number');
 const s=String(value);if(!/^(0|[1-9]\d{0,77})$/.test(s)||BigInt(s)>=2n**256n)throw Error('Invalid unsigned value');return s;
};
const address=value=>{if(typeof value!=='string')throw Error('Invalid address');return ethers.getAddress(value);};
function normalizeRow(raw,chainId,safe,nonce){
 if(!raw||typeof raw!=='object'||Array.isArray(raw))throw Error('Invalid transaction');
 if(address(raw.safe)!==safe)throw Error('Different Safe');
 const n=uint(raw.nonce);
 if(raw.isExecuted===true||BigInt(n)<BigInt(nonce))return null;
 if(raw.isExecuted!==false)throw Error('Unknown execution state');
 const operation=Number(raw.operation);if(![0,1].includes(operation)||![0,1,'0','1'].includes(raw.operation))throw Error('Invalid operation');
 const data=raw.data??'0x';if(!/^0x([\da-f]{2})*$/i.test(data)||data.length>2+256*1024*2)throw Error('Invalid calldata');
 const tx={to:address(raw.to),value:uint(raw.value),data,operation,safeTxGas:uint(raw.safeTxGas),baseGas:uint(raw.baseGas),gasPrice:uint(raw.gasPrice),gasToken:address(raw.gasToken??ethers.ZeroAddress),refundReceiver:address(raw.refundReceiver??ethers.ZeroAddress),nonce:n};
 const computed=ethers.TypedDataEncoder.hash({chainId,verifyingContract:safe},safeTxTypes(),tx);
 if(typeof raw.safeTxHash!=='string'||!hash.test(raw.safeTxHash)||raw.safeTxHash.toLowerCase()!==computed.toLowerCase())throw Error('Transaction hash mismatch');
 if(!Array.isArray(raw.confirmations)||raw.confirmations.length>128)throw Error('Invalid confirmations');
 const confirmations=[];
 for(const confirmation of raw.confirmations){
  try{
   const owner=address(confirmation.owner),signature=typeof confirmation.signature==='string'&&/^0x([\da-f]{2})*$/i.test(confirmation.signature)&&confirmation.signature.length<=2+16*1024*2?confirmation.signature:null;
   confirmations.push({owner,signature});
  }catch{confirmations.push({owner:ethers.ZeroAddress,signature:null});}
 }
 return{safeTxHash:computed,tx,confirmations,reportedConfirmations:raw.confirmations.length};
}
async function boundedJson(response){
 const max=4*1024*1024;
 if(Number(response.headers.get('content-length')||0)>max)throw Error('Oversized service response');
 const reader=response.body?.getReader();if(!reader)throw Error('Unreadable service response');
 const chunks=[];let total=0;
 try{for(;;){const{done,value}=await reader.read();if(done)break;total+=value.length;if(total>max)throw Error('Oversized service response');chunks.push(value);}}
 catch(error){await reader.cancel().catch(()=>{});throw error;}
 return JSON.parse(Buffer.concat(chunks,total).toString('utf8'));
}
export class SafeQueueReader{
 constructor({fetcher=fetch,now=()=>Date.now(),timeoutMs=20000}={}){this.fetcher=fetcher;this.now=now;this.timeoutMs=timeoutMs;this.cache=new Map();this.inflight=new Map();}
 async get(input){
  const chainId=Number(input.chainId);if(!Number.isSafeInteger(chainId)||chainId<1)throw Error('Invalid chain ID');
  const safe=address(input.safe),nonce=uint(input.nonce),service=services[chainId]||null;
  const base={chainId,safe,checkedAt:new Date(this.now()).toISOString(),service,safeUrl:service?`${chainId===60808?'https://safe.gobob.xyz':'https://app.safe.global'}/transactions/queue?safe=${prefixes[chainId]}:${safe}`:null,rejected:0,transactions:[]};
  if(!service)return{...base,status:'unsupported',complete:false,warning:'No trusted Safe transaction service is configured for this network. Published queue is unknown.'};
  const key=`${chainId}:${safe.toLowerCase()}:${nonce}`,cached=this.cache.get(key);
  if(cached&&this.now()-cached.at<15000)return cached.value;
  if(this.inflight.has(key))return this.inflight.get(key);
  if(this.inflight.size>=8)return{...base,status:'unavailable',complete:false,warning:'Queue reader is busy. Try Refresh shortly.'};
  const pending=this.read(base,nonce).then(value=>{if(this.cache.size>=100)this.cache.delete(this.cache.keys().next().value);this.cache.set(key,{at:this.now(),value});return value;}).finally(()=>this.inflight.delete(key));
  this.inflight.set(key,pending);return pending;
 }
 async read(base,nonce){
  const{chainId,safe,service}=base,origin=new URL(service).origin;
  const expectedPath=`${new URL(service).pathname}/api/v1/safes/${safe}/multisig-transactions/`.replace(/^\/\//,'/');
  const first=new URL(service+`/api/v1/safes/${safe}/multisig-transactions/`);
  first.search=new URLSearchParams({executed:'false',nonce__gte:nonce,ordering:'nonce',limit:'50'}).toString();
  let url=first.href,rejected=0,warning;const transactions=[],seen=new Set(),visited=new Set(),controller=new AbortController();
  const timeout=setTimeout(()=>controller.abort(),this.timeoutMs);
  try{
   for(let page=0;url&&page<5;page++){
    const u=new URL(url);
    if(u.origin!==origin||u.pathname.toLowerCase()!==expectedPath.toLowerCase()||u.username||u.password||u.hash||u.searchParams.get('executed')!=='false'||u.searchParams.get('nonce__gte')!==nonce||visited.has(u.href))throw Error('Unsafe service pagination');
    visited.add(u.href);
    const response=await this.fetcher(u.href,{method:'GET',redirect:'error',credentials:'omit',signal:controller.signal,headers:{accept:'application/json'}});
    if(!response.ok){warning=response.status===429?'Safe service rate limit reached. Published queue is incomplete; try Refresh later.':response.status===401||response.status===403?'Safe service access denied. Published queue is unknown; check your service access or use Open in Safe.':'Safe service is unavailable. Published queue is unknown.';throw Error('Service unavailable');}
    const document=await boundedJson(response);
    if(!document||!Array.isArray(document.results)||document.results.length>50||(document.next!==null&&typeof document.next!=='string'))throw Error('Invalid service page');
    for(const row of document.results){try{const item=normalizeRow(row,chainId,safe,nonce);if(item&&!seen.has(item.safeTxHash)){seen.add(item.safeTxHash);transactions.push(item);}}catch{rejected++;}}
    url=document.next?new URL(document.next,u).href:null;
   }
   if(url)warning='Only the first 250 service entries were checked. Published queue is incomplete.';
   if(rejected&&!warning)warning=`${rejected} service transaction(s) failed validation. Published queue is incomplete.`;
   return{...base,transactions,rejected,status:warning?'partial':'ok',complete:!warning,...(warning?{warning}:{})};
  }catch{return{...base,transactions,rejected,status:transactions.length?'partial':'unavailable',complete:false,warning:warning||'Safe service could not be fully checked. Published queue is unknown; try Refresh or Open in Safe.'};}
  finally{clearTimeout(timeout);}
 }
}
