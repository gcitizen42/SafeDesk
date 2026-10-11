import fs from 'node:fs';
import path from 'node:path';
import {parseEnv} from 'node:util';
import {randomUUID} from 'node:crypto';
import {ethers} from 'ethers';
import {SAFE_ABI,simulationMatch} from './core.mjs';
import {privateConfig,preferences} from './settings.mjs';

const project=path.resolve(import.meta.dirname,'../..');
const APPROVE=new ethers.Interface(['function approveHash(bytes32)']);
const sameOwners=(a,b)=>a.map(x=>x.toLowerCase()).sort().join()===b.map(x=>x.toLowerCase()).sort().join();
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
export function loadTenderlyConfig(root){
 const candidates=process.env.SAFE_BATCH_TENDERLY_ENV_FILE?[path.resolve(process.env.SAFE_BATCH_TENDERLY_ENV_FILE)]:[path.join(project,'.env'),path.join(project,'../Tenderly_simulations/.env')];
 const file=candidates.find(p=>fs.existsSync(p));const env={...(file?parseEnv(fs.readFileSync(file,'utf8')):{}),...process.env,...(root?privateConfig(root):{})};
 const config={account:env.TENDERLY_ACCOUNT_SLUG,project:env.TENDERLY_PROJECT_SLUG,key:env.TENDERLY_ACCESS_KEY||env.TENDERLY_ACCESS_TOKEN};
 config.configured=!!(config.account&&config.project&&config.key);
 if(config.configured&&!/^[\w-]+$/.test(config.account+config.project))throw Error('Invalid Tenderly account/project slug');
 return config;
}
export function loadPolicy(){
 const p=JSON.parse(fs.readFileSync(path.join(project,'config/batch-tenderly-policy.json'),'utf8'));
 for(const [key,max]of Object.entries({maxEnvironments:20,maxRunsPerDay:5,maxApprovers:10,receiptAttempts:60}))if(!Number.isInteger(p[key])||p[key]<1||p[key]>max)throw Error(`Invalid Tenderly safety limit: ${key}`);
 return p;
}
export function assertVirtualRpc(value){
 const u=new URL(value);
 if(u.protocol!=='https:'||!u.hostname.startsWith('virtual.')||!u.hostname.endsWith('.rpc.tenderly.co')||u.username||u.password||u.port)throw Error('Tenderly returned an unexpected virtual RPC; refusing simulation writes');
 return u.href;
}
export class TenderlyRunner{
 constructor(store,{fetcher=fetch,config=()=>loadTenderlyConfig(store.root),policy=loadPolicy,wait=pause}={}){this.store=store;this.fetcher=fetcher;this.config=config;this.policy=policy;this.wait=wait;}
 status(){const c=this.config(),p=this.policy();return{configured:c.configured,enabled:p.enabled&&preferences(this.store.root).tenderlyEnabled!==false,maxEnvironments:p.maxEnvironments,maxRunsPerDay:p.maxRunsPerDay};}
 async request(url,options={},timeout=30000){
  let r;try{r=await this.fetcher(url,{...options,redirect:'error',signal:AbortSignal.timeout(timeout)});}catch{throw Error('Tenderly request failed or timed out. No automatic retry was made.');}
  if(!r.ok)throw Error(`Tenderly request rejected (HTTP ${r.status})`);
  try{return await r.json();}catch{throw Error('Tenderly returned an unreadable response');}
 }
 base(config){return`https://api.tenderly.co/api/public/v1/account/${encodeURIComponent(config.account)}/project/${encodeURIComponent(config.project)}`;}
 async environments(config){
  const data=await this.request(this.base(config)+'/environments',{headers:{'X-Access-Key':config.key}});
  if(!Array.isArray(data))throw Error('Cannot verify Tenderly environment capacity');return data;
 }
 async plan(id,{publicExplorer=false}={}){
  const config=this.config(),policy=this.policy();if(!config.configured)throw Error('Configure Tenderly account, project and access key in SafeDesk settings');if(policy.enabled!==true||preferences(this.store.root).tenderlyEnabled===false)throw Error('Tenderly simulation is disabled in settings or by the project safety policy');
  const live=await this.store.check(id),op=this.store.operation(id);
  const networks=await this.request('https://api.tenderly.co/api/v1/supported-networks');
  if(!Array.isArray(networks)||!networks.some(n=>Number(n.chain_id)===op.chainId&&n.supported_features?.virtual_testnet===true))throw Error('Tenderly does not list Virtual Environment support for this chain');
  const count=(await this.environments(config)).length;if(count>=policy.maxEnvironments)throw Error(`Environment safety limit reached (${count}/${policy.maxEnvironments}). Review existing environments in Tenderly; this tool never deletes them.`);
  const today=new Date().toISOString().slice(0,10),runs=(this.store.state.tenderlyAttempts||[]).filter(r=>r.at.startsWith(today)).length;
  if(runs>=policy.maxRunsPerDay)throw Error(`Daily simulation limit reached (${policy.maxRunsPerDay} attempts per batch)`);
  if(live.threshold<1||live.threshold>policy.maxApprovers||live.threshold>live.owners.length)throw Error('Approval count outside simulation safety limits');
  if(!Number.isSafeInteger(live.block))throw Error('Fork block outside supported range');
  return{id,safe:op.safe,chain:op.name,chainId:op.chainId,hash:op.safeTxHash,nonce:live.nonce,threshold:live.threshold,block:live.block,owners:live.owners,environmentCount:count,environmentLimit:policy.maxEnvironments,runsToday:runs,dailyLimit:policy.maxRunsPerDay,publicExplorer:publicExplorer===true,draft:!!op.draft,estimatedTransactions:live.threshold+1};
 }
 async rpc(url,method,params=[]){
  assertVirtualRpc(url);const j=await this.request(url,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id:1,method,params})});
  if(j.error)throw Error(`Virtual RPC ${method} rejected the request`);if(j.result===undefined)throw Error(`Virtual RPC ${method} returned no result`);return j.result;
 }
 async call(url,safe,name,args=[]){return SAFE_ABI.decodeFunctionResult(name,await this.rpc(url,'eth_call',[{to:safe,data:SAFE_ABI.encodeFunctionData(name,args)},'latest']))[0];}
 async safeState(url,safe){return{owners:[...await this.call(url,safe,'getOwners')],threshold:Number(await this.call(url,safe,'getThreshold')),nonce:String(await this.call(url,safe,'nonce'))};}
 async send(url,tx){
  const hash=await this.rpc(url,'eth_sendTransaction',[tx]);
  if(!ethers.isHexString(hash,32))throw Error('Virtual RPC returned an invalid transaction hash');
  for(let i=0;i<this.policy().receiptAttempts;i++){const receipt=await this.rpc(url,'eth_getTransactionReceipt',[hash]);if(receipt){if(BigInt(receipt.status)!==1n)throw Error('Virtual transaction reverted');return{hash,receipt};}await this.wait(1000);}
  throw Error('Virtual transaction receipt timed out; inspect the environment before running again');
 }
 update(id,job){this.store.state.tenderlyJobs??={};this.store.state.tenderlyJobs[id]=job;this.store.save();}
 async run(plan,{confirm}={}){
  if(confirm!=='SIMULATE')throw Error('Explicit SIMULATE confirmation required');
  const current=await this.plan(plan.id,{publicExplorer:plan.publicExplorer});
  for(const key of ['id','safe','chainId','hash','nonce','threshold'])if(current[key]!==plan[key])throw Error('Simulation plan changed; review again');
  if(!sameOwners(current.owners,plan.owners))throw Error('Owners changed; review again');
  const op=this.store.operation(plan.id),config=this.config(),policy=this.policy(),runId=randomUUID(),at=new Date().toISOString();
  const dir=path.join(this.store.secretDir,'tenderly-runs',runId);fs.mkdirSync(dir,{recursive:true,mode:0o700});
  const job={runId,status:'RUNNING',stage:'Creating one isolated environment',hash:op.safeTxHash,at,chainId:op.chainId,safe:op.safe,publicExplorer:plan.publicExplorer};
  this.store.state.tenderlyAttempts??=[];this.store.state.tenderlyAttempts.push({runId,at,id:op.id,hash:op.safeTxHash});this.update(op.id,job);
  const savePrivate=(name,value)=>fs.writeFileSync(path.join(dir,name),JSON.stringify(value,null,2),{mode:0o600});
  let created=false;
  try{
   const approvers=[...current.owners].sort((a,b)=>BigInt(a)<BigInt(b)?-1:1).slice(0,current.threshold),executor=approvers[0];
   const environment=await this.request(this.base(config)+'/environments',{method:'POST',headers:{'X-Access-Key':config.key,'content-type':'application/json'},body:JSON.stringify({display_name:`Safe ${op.id} ${at}`,slug:`safe-batch-${runId}`,network_configs:[{network_id:String(op.chainId),block_number:ethers.toQuantity(current.block),chain_config_overrides:{chain_id:String(op.chainId)},explorer_config:{enabled:plan.publicExplorer,verification_visibility:'bytecode'},accounts:approvers.map(address=>({address,balance:ethers.toQuantity(10n*10n**18n)}))}]})},120000);
   created=true;savePrivate('environment.json',environment);
   const vnet=environment.active_instance?.vnets?.[0];if(!environment.id||!vnet?.id)throw Error('Created environment has no virtual network; inspect Tenderly');
   const rpc=assertVirtualRpc(vnet.rpcs?.find(r=>r.name==='Admin RPC')?.url);
   job.url=`https://dashboard.tenderly.co/${encodeURIComponent(config.account)}/${encodeURIComponent(config.project)}/virtual-environments/${encodeURIComponent(environment.id)}`;job.environmentId=environment.id;job.stage='Checking fork chain, Safe state and transaction hash';this.update(op.id,job);
   if(Number(BigInt(await this.rpc(rpc,'eth_chainId')))!==op.chainId)throw Error('Virtual chain ID differs from the signing domain');
   const before=await this.safeState(rpc,op.safe),m=op.signing.message;
   if(before.nonce!==m.nonce||before.threshold!==current.threshold||!sameOwners(before.owners,current.owners))throw Error('Fork Safe state differs from the prepared transaction');
   const forkHash=await this.call(rpc,op.safe,'getTransactionHash',[m.to,m.value,m.data,m.operation,m.safeTxGas,m.baseGas,m.gasPrice,m.gasToken,m.refundReceiver,m.nonce]);if(forkHash.toLowerCase()!==op.safeTxHash.toLowerCase())throw Error('Fork Safe hash differs');
   const approvals=[];for(const [index,owner]of approvers.entries()){
    job.stage=`Simulating owner approval ${index+1}/${approvers.length}`;this.update(op.id,job);
    approvals.push({owner,...await this.send(rpc,{from:owner,to:op.safe,data:APPROVE.encodeFunctionData('approveHash',[op.safeTxHash]),gas:ethers.toQuantity(300000),gasPrice:'0x0',value:'0x0'})});
   }
   // Safe's preapproved-hash signatures reference fork-only approveHash calls, not real wallet signatures.
   const assumedSignatures='0x'+approvers.map(owner=>ethers.zeroPadValue(owner,32).slice(2)+ethers.ZeroHash.slice(2)+'01').join('');
   const input=SAFE_ABI.encodeFunctionData('execTransaction',[m.to,m.value,m.data,m.operation,m.safeTxGas,m.baseGas,m.gasPrice,m.gasToken,m.refundReceiver,assumedSignatures]);
   job.stage='Executing the exact Safe transaction on the virtual network';this.update(op.id,job);
   const transaction={from:executor,to:op.safe,data:input,gas:ethers.toQuantity(12000000),gasPrice:'0x0',value:'0x0'},execution=await this.send(rpc,transaction);
   const document={transaction,receipt:execution.receipt};simulationMatch(document,op.signing);
   job.stage='Checking final owners, threshold and nonce';this.update(op.id,job);const after=await this.safeState(rpc,op.safe);
   if(BigInt(after.nonce)!==BigInt(before.nonce)+1n)throw Error('Final Safe nonce did not advance exactly once');
   if(op.newOwners?.length&&(!sameOwners(after.owners,op.newOwners)||after.threshold!==op.threshold))throw Error('Final owners or threshold differ from the prepared rotation');
   const result={status:'PASSED',safeTxHash:op.safeTxHash,kind:'Tenderly exact Safe execution',approvalAssumption:'Current owners approveHash on the virtual network only. Approvals are assumed; real Ledger signatures and owner consent are not validated.',before,after,forkBlock:current.block,transactionHash:execution.hash,gasUsed:String(BigInt(execution.receipt.gasUsed)),url:job.url,publicExplorer:plan.publicExplorer,runId,createdAt:at};
   savePrivate('result.json',result);savePrivate('execution.json',document);
   fs.writeFileSync(path.join(dir,'REPORT.md'),`# Safe virtual simulation\n\n- Safe: ${op.safe}\n- Chain: ${op.chainId}\n- SafeTx hash: ${op.safeTxHash}\n- Result: PASSED\n- Fork block: ${current.block}\n- Tenderly: ${job.url}\n- Explorer public: ${plan.publicExplorer}\n\nApprovals assumed on the fork; no real signatures or onchain transactions.\n\n## Before\n\n\`\`\`json\n${JSON.stringify(before,null,2)}\n\`\`\`\n\n## After\n\n\`\`\`json\n${JSON.stringify(after,null,2)}\n\`\`\`\n`,{mode:0o600});
   this.store.attach(op.id,job.url,result);job.status='PASSED';job.stage='Exact execution and final state matched';job.result=result;this.update(op.id,job);
   return result;
  }catch(error){
   job.status='FAILED';job.stage='Simulation stopped';job.message=error.message;job.environmentCreated=created;
   // A newer failed execution must not be hidden by an older passing local report.
   if(created){this.store.state.simulations[op.id]={hash:op.safeTxHash,url:job.url||'',failed:true,match:null};}
   this.update(op.id,job);savePrivate('result.json',job);throw Error(`${job.message}${job.url?' Inspect the new environment in Tenderly.':' Check Tenderly before retrying if creation timed out.'}`);
  }
 }
}
