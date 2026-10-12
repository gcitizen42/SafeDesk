import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {ethers} from 'ethers';
import {BatchStore,SAFE_ABI,normalizeSigning} from './core.mjs';
import {TenderlyRunner,assertVirtualRpc} from './tenderly.mjs';
import {createServer} from './server.mjs';

const owner=ethers.Wallet.createRandom().address,second=ethers.Wallet.createRandom().address,incoming=ethers.Wallet.createRandom().address;
const signing=normalizeSigning({domain:{chainId:60808,verifyingContract:'0x1111111111111111111111111111111111111111'},message:{to:'0x2222222222222222222222222222222222222222',value:'0',data:'0x1234',operation:1,safeTxGas:'0',baseGas:'0',gasPrice:'0',gasToken:ethers.ZeroAddress,refundReceiver:ethers.ZeroAddress,nonce:'11'}});
const config={configured:true,account:'test-account',project:'test-project',key:'mock-api-secret'},virtualRpc='https://virtual.bob.rpc.tenderly.co/mock-admin-secret';
const policy={enabled:true,maxEnvironments:20,maxRunsPerDay:5,maxApprovers:10,receiptAttempts:2};
function fixture(){
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'safe-tenderly-test-'));fs.mkdirSync(path.join(root,'fixture'));
 for(const [file,data]of Object.entries({'batch.json':{operations:[{id:'fixture'}]},'fixture/operation.json':{id:'fixture',safe:signing.domain.verifyingContract,chainId:60808,safeTxHash:signing.safeTxHash,threshold:2,newOwners:[owner,incoming]},'fixture/signing-data.json':signing,'fixture/current-owners.json':{owners:[owner,second],threshold:2,nonce:11},'fixture/local-simulation.json':{status:'PASSED',safeTxHash:signing.safeTxHash}}))fs.writeFileSync(path.join(root,file),JSON.stringify(data));
 const store=new BatchStore(root);store.check=async()=>({owners:[owner,second],threshold:2,nonce:'11',hash:signing.safeTxHash,block:100});
 const state={capacity:12,supported:true,executed:false,mode:'',sends:0,receipts:new Map()},calls=[];
 const response=data=>new Response(JSON.stringify(data),{status:200});
 const fetcher=async(url,options={})=>{
  const body=options.body?JSON.parse(options.body):null;calls.push({url,method:options.method||'GET',body});
  if(url.endsWith('/supported-networks'))return response([{chain_id:'60808',supported_features:{virtual_testnet:state.supported}}]);
  if(url.endsWith('/environments')){
   if(options.method!=='POST')return response(Array.from({length:state.capacity},(_,i)=>({id:String(i)})));
   if(state.mode==='creation-timeout')throw Error('Sensitive '+virtualRpc);
   return response({id:'mock-environment',active_instance:{id:'mock-instance',vnets:[{id:'mock-vnet',rpcs:[{name:'Admin RPC',url:state.mode==='unsafe-rpc'?'https://rpc.gobob.xyz':virtualRpc}]}]}});
  }
  assert.equal(url,virtualRpc);
  let result;
  if(body.method==='eth_chainId')result=state.mode==='wrong-chain'?'0x1':'0xed88';
  else if(body.method==='eth_call'){
   const tx=SAFE_ABI.parseTransaction({data:body.params[0].data});
   const values={getOwners:[state.executed&&state.mode!=='wrong-owners'?[owner,incoming]:[owner,second]],getThreshold:[2],nonce:[state.executed?12:11],getTransactionHash:[signing.safeTxHash]};
   result=SAFE_ABI.encodeFunctionResult(tx.name,values[tx.name]);
  }else if(body.method==='eth_sendTransaction'){
   state.sends++;result=ethers.zeroPadValue(ethers.toBeHex(state.sends),32);const data=body.params[0].data;
   if(data.startsWith(SAFE_ABI.getFunction('execTransaction').selector))state.executed=true;
   const logs=state.executed&&state.mode!=='missing-success'?[{address:signing.domain.verifyingContract,topics:[ethers.id('ExecutionSuccess(bytes32,uint256)')],data:ethers.AbiCoder.defaultAbiCoder().encode(['bytes32','uint256'],[signing.safeTxHash,0])}]:[];
   state.receipts.set(result,{status:'0x1',gasUsed:'0x1234',logs});
  }else if(body.method==='eth_getTransactionReceipt')result=state.receipts.get(body.params[0])||null;
  else throw Error('Unexpected method '+body.method);
  return response({jsonrpc:'2.0',id:1,result});
 };
 const runner=new TenderlyRunner(store,{fetcher,config:()=>config,policy:()=>policy,wait:async()=>{}});
 return{root,store,state,calls,runner};
}
test('simulation writes only allow Tenderly virtual RPC hosts',()=>{
 assert.equal(assertVirtualRpc(virtualRpc),virtualRpc);
 for(const url of ['https://rpc.gobob.xyz','https://mainnet.rpc.tenderly.co/secret','https://virtual.bob.rpc.tenderly.co.attacker.example/','http://virtual.bob.rpc.tenderly.co/','https://u:p@virtual.bob.rpc.tenderly.co/'])assert.throws(()=>assertVirtualRpc(url));
});
test('simulation planning is read-only and respects capacity, support and daily limits',async()=>{
 const f=fixture(),plan=await f.runner.plan('fixture');assert.equal(plan.environmentCount,12);assert.equal(plan.publicExplorer,false);assert.equal(f.calls.filter(c=>c.method==='POST').length,0);
 f.state.capacity=20;await assert.rejects(f.runner.plan('fixture'),/limit reached/);f.state.capacity=12;f.state.supported=false;await assert.rejects(f.runner.plan('fixture'),/does not list/);f.state.supported=true;
 f.store.state.tenderlyAttempts=Array.from({length:5},()=>({at:new Date().toISOString()}));await assert.rejects(f.runner.plan('fixture'),/Daily/);
});
test('explicit simulation confirmation required before resource creation',async()=>{
 const f=fixture(),plan=await f.runner.plan('fixture');await assert.rejects(f.runner.run(plan),/confirmation required/);assert.equal(f.calls.filter(c=>c.method==='POST').length,0);
});
test('exact virtual execution checks hash, success event and final owners; secrets stay private',async()=>{
 const f=fixture(),plan=await f.runner.plan('fixture');const result=await f.store.withLock(()=>f.runner.run(plan,{confirm:'SIMULATE'}));
 assert.equal(result.status,'PASSED');assert.equal(f.store.list()[0].simulation.matched,true);assert.equal(f.store.state.signatures.length,0);assert.equal(result.forkBlock,100);
 const creation=f.calls.find(c=>c.url.endsWith('/environments')&&c.method==='POST');assert.equal(creation.body.network_configs[0].block_number,'0x64');assert.equal(creation.body.network_configs[0].chain_config_overrides.chain_id,'60808');assert.equal(creation.body.network_configs[0].explorer_config.enabled,false);assert.equal(creation.body.network_configs[0].accounts.length,2);
 const sends=f.calls.filter(c=>c.body?.method==='eth_sendTransaction');assert.equal(sends.length,3);assert.ok(sends.every(c=>c.url===virtualRpc));assert.ok(!f.calls.some(c=>c.body?.method==='tenderly_setStorageAt'));
 const exec=SAFE_ABI.decodeFunctionData('execTransaction',sends[2].body.params[0].data);assert.equal(exec[2],signing.message.data);assert.equal(Number(exec[3]),1);assert.equal(ethers.getBytes(exec[9]).length,130);
 const file=path.join(f.root,'secrets/tenderly-runs',result.runId,'environment.json');if(process.platform!=='win32')assert.equal(fs.statSync(file).mode&0o777,0o600);assert.equal(JSON.stringify(f.store.list()).includes('mock-admin-secret'),false);assert.equal(JSON.stringify(f.store.list()).includes('mock-api-secret'),false);
});
test('public explorer is explicitly part of the confirmed plan',async()=>{
 const f=fixture(),plan=await f.runner.plan('fixture',{publicExplorer:true});await f.runner.run(plan,{confirm:'SIMULATE'});assert.equal(f.calls.find(c=>c.method==='POST'&&c.url.endsWith('/environments')).body.network_configs[0].explorer_config.enabled,true);
});
test('wrong chain or returned production RPC stops before any simulation transaction',async()=>{
 for(const mode of ['wrong-chain','unsafe-rpc']){const f=fixture();f.state.mode=mode;const plan=await f.runner.plan('fixture');await assert.rejects(f.runner.run(plan,{confirm:'SIMULATE'}));assert.equal(f.state.sends,0);assert.equal(f.store.state.tenderlyJobs.fixture.status,'FAILED');}
});
test('missing success or wrong final owners fails and supersedes older passing local evidence',async()=>{
 for(const mode of ['missing-success','wrong-owners']){const f=fixture();f.state.mode=mode;const plan=await f.runner.plan('fixture');await assert.rejects(f.runner.run(plan,{confirm:'SIMULATE'}));assert.equal(f.store.list()[0].simulation,null);assert.equal(f.store.state.tenderlyJobs.fixture.status,'FAILED');assert.ok(f.store.state.tenderlyJobs.fixture.url);}
});
test('ambiguous creation failure records an attempt, redacts endpoints and never retries',async()=>{
 const f=fixture();f.state.mode='creation-timeout';const plan=await f.runner.plan('fixture');await assert.rejects(f.runner.run(plan,{confirm:'SIMULATE'}),/No automatic retry/);assert.equal(f.calls.filter(c=>c.method==='POST'&&c.url.endsWith('/environments')).length,1);assert.equal(f.store.state.tenderlyAttempts.length,1);assert.equal(JSON.stringify(f.store.state.tenderlyJobs).includes('mock-admin-secret'),false);
});
test('HTTP simulation requires a fresh reviewed one-use plan and confirmation',async()=>{
 const f=fixture(),port=31000+Math.floor(Math.random()*1000),server=createServer(f.root,{store:f.store,runner:f.runner,port});await new Promise(r=>server.listen(port,'127.0.0.1',r));
 try{
  const base=`http://127.0.0.1:${port}`,init=await fetch(base+'/api/batch').then(r=>r.json());const post=(route,body)=>fetch(base+'/api/'+route,{method:'POST',headers:{'content-type':'application/json','x-batch-token':init.token},body:JSON.stringify(body)});
  assert.equal((await post('tenderly-run',{confirm:'SIMULATE'})).status,400);
  const prepared=await post('tenderly-plan',{id:'fixture'}).then(r=>r.json());assert.equal((await post('tenderly-run',{simulationToken:prepared.result.simulationToken})).status,400);assert.equal(f.calls.filter(c=>c.method==='POST').length,0);
  assert.equal((await post('tenderly-run',{simulationToken:prepared.result.simulationToken,confirm:'SIMULATE'})).status,200);assert.equal((await post('tenderly-run',{simulationToken:prepared.result.simulationToken,confirm:'SIMULATE'})).status,400);
  assert.equal((await fetch(base+'/api/tenderly-progress?id=fixture')).status,403);assert.equal((await fetch(base+'/secrets/tenderly-runs')).status,404);
 }finally{await new Promise(r=>server.close(r));}
});
