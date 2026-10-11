import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {ethers} from 'ethers';
import {BatchStore,SAFE_ABI,normalizeSigning} from './core.mjs';
import {SafeWorkflow,ChainCatalog,generateFromSnapshot,verifyOwnerChanges,desiredOwners,desiredThreshold} from './workflow.mjs';
import {privateConfig,publicSettings,validateRpcUrl} from './settings.mjs';
import {TenderlyRunner} from './tenderly.mjs';
import {createServer} from './server.mjs';
const owner=ethers.Wallet.createRandom(),other=ethers.Wallet.createRandom(),replacement=ethers.Wallet.createRandom();
const safe='0x1111111111111111111111111111111111111111';
const signing=normalizeSigning({domain:{chainId:60808,verifyingContract:safe},message:{to:safe,value:'0',data:'0x1234',operation:0,safeTxGas:'0',baseGas:'0',gasPrice:'0',gasToken:ethers.ZeroAddress,refundReceiver:ethers.ZeroAddress,nonce:'3'}});
const typed=await owner.signTypedData(signing.domain,signing.types,signing.message),typedOther=await other.signTypedData(signing.domain,signing.types,signing.message);
function fixture({empty=false}={}){
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'safedesk-workflow-'));
 const state={nonce:3,threshold:2,owners:[owner.address,other.address],queue:[],transaction:null,revert:false,gasBalance:'0xde0b6b3a7640000',wrongChain:false,serviceUnavailable:false,code:'0x1234'};
 const calls=[];
 const fetcher=async(url,options={})=>{
  const body=options.body?JSON.parse(options.body):null;calls.push({url,body,method:options.method||'GET'});
  if(body?.jsonrpc){let result;
   if(body.method==='eth_chainId')result=state.wrongChain?'0x1':'0xed88';
   else if(body.method==='eth_blockNumber')result='0x100';
   else if(body.method==='eth_getCode')result=state.code;
   else if(body.method==='eth_getBalance')result=state.gasBalance;
   else if(body.method==='eth_estimateGas')result='0x186a0';
   else if(body.method==='eth_gasPrice')result='0x3b9aca00';
   else if(body.method==='eth_call'){
    const parsed=SAFE_ABI.parseTransaction({data:body.params[0].data});
    if(parsed.name==='execTransaction'&&state.revert)return Response.json({error:{message:'secret endpoint detail must not escape'}});
    const values={getOwners:[state.owners],getThreshold:[state.threshold],nonce:[state.nonce],execTransaction:[true],approvedHashes:[0]};
    if(parsed.name==='getTransactionHash'){
     const fields=['to','value','data','operation','safeTxGas','baseGas','gasPrice','gasToken','refundReceiver','nonce'];
     const s=normalizeSigning({domain:{chainId:60808,verifyingContract:safe},message:Object.fromEntries(fields.map((k,i)=>[k,parsed.args[i]]))});
     result=SAFE_ABI.encodeFunctionResult(parsed.name,[s.safeTxHash]);
    }else result=SAFE_ABI.encodeFunctionResult(parsed.name,values[parsed.name]);
   }else throw Error('Unexpected RPC method '+body.method);
   return Response.json({result});
  }
  if(state.serviceUnavailable)return new Response('',{status:503});
  if(url.includes('?executed='))return Response.json({results:state.queue,next:null});
  return state.transaction?Response.json(state.transaction):Response.json({}, {status:404});
 };
 const store=new BatchStore(root,{fetcher});store.init();
 if(!empty){fs.mkdirSync(path.join(root,'example'));for(const[name,data]of Object.entries({'operation.json':{id:'example',chainId:60808,safe,safeTxHash:signing.safeTxHash,nonce:3,newOwners:[owner.address,replacement.address],threshold:2},'signing-data.json':signing,'current-owners.json':{owners:state.owners,threshold:2,nonce:3},'local-simulation.json':{status:'PASSED',safeTxHash:signing.safeTxHash}}))fs.writeFileSync(path.join(root,'example',name),JSON.stringify(data));fs.writeFileSync(path.join(root,'batch.json'),JSON.stringify({operations:[{id:'example'}]}));}
 const workflow=new SafeWorkflow(store,{urlValidator:async x=>x});
 return{root,store,state,workflow,calls};
}
const serviceTx=confirmations=>({safe,...signing.message,safeTxHash:signing.safeTxHash,isExecuted:false,confirmations});
test('Chainlist catalogue filters placeholders, untrusted protocols and unsupported chains, then caches',async()=>{
 let calls=0;const catalog=new ChainCatalog(async()=>{calls++;return Response.json([{chainId:60808,rpc:[{url:'https://public.example/rpc'},{url:'http://localhost:9000'},{url:'https://example/${KEY}'},{url:'wss://example/ws'}]},{chainId:999,rpc:['https://other.example']}]);});
 const result=await catalog.get();assert.equal(result.source,'chainlist.org');assert.equal(result.chains.length,6);assert.ok(result.chains.find(x=>x.chainId===60808).rpcs.includes('https://public.example/rpc'));assert.ok(!JSON.stringify(result).includes('${KEY}'));await catalog.get();assert.equal(calls,1);
 const fallback=await new ChainCatalog(async()=>{throw Error('Offline');}).get();assert.equal(fallback.source,'Built-in fallback');assert.equal(fallback.chains.length,6);
});
test('RPC validation rejects local, private, login, placeholder and private DNS endpoints',async()=>{
 for(const url of ['http://rpc.example','https://localhost','https://127.0.0.1','https://[::1]','https://user:pass@rpc.example','https://rpc.example/${KEY}'])await assert.rejects(validateRpcUrl(url,async()=>[{address:'8.8.8.8'}]));
 await assert.rejects(validateRpcUrl('https://rpc.example',async()=>[{address:'192.168.1.2'}]),/Private/);
 assert.equal(await validateRpcUrl('https://rpc.example/path',async()=>[{address:'8.8.8.8'}]),'https://rpc.example/path');
});
test('settings are private environment files, redacted publicly, and never copied into imported operation files',async()=>{
 const f=fixture({empty:true});await f.workflow.configure({chainId:60808,rpcUrl:'https://custom.example/private-token',tenderly:{enabled:true,account:'account',project:'project',key:'test-private-key'}});
 assert.equal(privateConfig(f.root).SAFEDESK_RPC_60808,'https://custom.example/private-token');
 assert.deepEqual(publicSettings(f.root).rpcChains,[60808]);assert.ok(!JSON.stringify(publicSettings(f.root)).includes('private-token'));assert.ok(!JSON.stringify(publicSettings(f.root)).includes('test-private-key'));
 assert.equal(fs.statSync(path.join(f.root,'secrets/safedesk.env')).mode&0o777,0o600);
 await f.store.add('imported',signing);assert.ok(!fs.readFileSync(path.join(f.root,'imported/operation.json'),'utf8').includes('private-token'));assert.ok(!fs.readFileSync(path.join(f.root,'batch.json'),'utf8').includes('private-token'));
 assert.equal(f.store.operation('imported').rpc,'https://custom.example/private-token');
 await f.workflow.configure({tenderly:{enabled:false}});assert.equal(new TenderlyRunner(f.store).status().enabled,false);
 assert.equal(privateConfig(f.root).TENDERLY_ACCESS_KEY,'test-private-key');
});
test('RPC chain identity, Safe contract and complete target roster are validated',async()=>{
 const f=fixture();f.state.wrongChain=true;await assert.rejects(f.workflow.inspect({chainId:60808,safe}),/different chain/);f.state.wrongChain=false;f.state.code='0x';await assert.rejects(f.workflow.inspect({chainId:60808,safe}),/No Safe contract/);
 assert.throws(()=>desiredOwners([owner.address,owner.address],safe),/Duplicate/);assert.throws(()=>desiredOwners([safe],safe),/cannot/);assert.throws(()=>desiredOwners([ethers.ZeroAddress],safe),/cannot/);assert.throws(()=>desiredThreshold(3,2),/Threshold/);assert.throws(()=>desiredThreshold(1.5,2),/Threshold/);
});
test('actual safe-owner-manager generates swaps, adds, removals and threshold-only changes with verified predecessors',async()=>{
 const before={safe,chainId:60808,owners:[owner.address,other.address],threshold:2};
 for(const [owners,threshold]of [[[replacement.address,other.address],2],[[owner.address,other.address,replacement.address],2],[[owner.address],1],[[owner.address,other.address],1]]){
  const builder=await generateFromSnapshot(before,owners,threshold);assert.ok(builder.transactions.length);verifyOwnerChanges(builder,before,owners,threshold);
 }
 const builder=await generateFromSnapshot(before,[replacement.address,other.address],2);builder.transactions[0].contractInputsValues.prevOwner=replacement.address;assert.throws(()=>verifyOwnerChanges(builder,before,[replacement.address,other.address],2),/predecessor/);
});
test('wizard preparation uses the reviewed snapshot and local library, binds the onchain hash and requires later simulation',async()=>{
 const f=fixture({empty:true}),input={id:'new-safe',chainId:60808,safe,rpcUrl:'https://rpc.example/secret',newOwners:[owner.address,replacement.address],threshold:2,tenderly:{enabled:false}};
 input.snapshot=await f.workflow.inspect(input);const result=await f.workflow.prepare(input);assert.equal(result.hash,f.store.operation('new-safe').safeTxHash);assert.equal(f.store.list()[0].simulation,null);assert.equal(f.store.list()[0].draft,false);
 assert.equal(f.store.list()[0].proposedThreshold,2);assert.deepEqual(f.store.list()[0].newOwners,input.newOwners);
 for(const file of ['operation.json','signing-data.json','rotation.json'])assert.ok(!fs.readFileSync(path.join(f.root,'new-safe',file),'utf8').includes('/secret'));
 assert.ok(f.calls.every(c=>!['eth_sendTransaction','eth_sendRawTransaction'].includes(c.body?.method)));assert.ok(f.calls.filter(c=>c.method==='POST').every(c=>c.body?.jsonrpc));
 await assert.rejects(f.store.collect('new-safe',owner.address,await owner.signTypedData(f.store.operation('new-safe').signing.domain,f.store.operation('new-safe').signing.types,f.store.operation('new-safe').signing.message)),/simulation/);
});
test('no-op, stale snapshot and queued nonce block preparation without overwriting any files',async()=>{
 const f=fixture({empty:true}),input={id:'new-safe',chainId:60808,safe,newOwners:[owner.address,replacement.address],threshold:2};input.snapshot=await f.workflow.inspect(input);
 await assert.rejects(f.workflow.prepare({...input,newOwners:[owner.address,other.address]}),/No owner/);
 f.state.nonce=4;await assert.rejects(f.workflow.prepare(input),/state changed/);f.state.nonce=3;
 f.state.queue=[{nonce:3,safeTxHash:ethers.ZeroHash}];await assert.rejects(f.workflow.prepare(input),/already queued/);assert.equal(f.store.ids().length,0);assert.equal(fs.existsSync(path.join(f.root,'new-safe')),false);
});
test('status separates local from published approvals, validates signatures and only makes read-only execution checks',async()=>{
 const f=fixture();f.store.state.signatures=[{id:'example',safeTxHash:signing.safeTxHash,sender:owner.address,signature:typed}];f.state.transaction=serviceTx([{owner:other.address,signature:typedOther}]);
 const status=await f.workflow.transactionStatus('example',{account:replacement.address,walletChainId:60808});assert.equal(status.publishedApprovals,1);assert.equal(status.localSignatures,1);assert.equal(status.usableSignatures,2);assert.equal(status.wallet.canSign,false);
 assert.equal(status.execution.canExecute,true);assert.equal(status.wallet.currentOwner,false);assert.equal(status.execution.checked,true);
 assert.ok(f.calls.every(c=>!['eth_sendTransaction','eth_sendRawTransaction'].includes(c.body?.method)));
 assert.ok(!JSON.stringify(status).includes(typed));assert.ok(!JSON.stringify(status).includes(typedOther));
 f.state.gasBalance='0x0';assert.equal((await f.workflow.transactionStatus('example',{account:owner.address,walletChainId:60808})).execution.canExecute,false);
 f.state.revert=true;const failure=await f.workflow.transactionStatus('example',{account:owner.address,walletChainId:60808});assert.match(failure.execution.status,/failed/);assert.ok(!JSON.stringify(failure).includes('secret endpoint'));
});
test('bad service approvals, unavailable queue, wrong wallet chain and stale nonce are never shown ready',async()=>{
 const f=fixture();f.state.transaction=serviceTx([{owner:owner.address,signature:typedOther},{owner:other.address,signature:'0x1234'}]);
 let status=await f.workflow.transactionStatus('example',{account:owner.address,walletChainId:1});assert.equal(status.unverifiableApprovals,2);assert.equal(status.publishedApprovals,0);assert.equal(status.wallet.canSign,false);assert.equal(status.execution.canExecute,false);
 f.state.serviceUnavailable=true;status=await f.workflow.transactionStatus('example',{account:owner.address,walletChainId:60808});assert.equal(status.serviceKnown,false);assert.equal(status.wallet.canSign,false);assert.equal(status.execution.canExecute,false);
 f.state.serviceUnavailable=false;f.state.transaction=null;f.state.queue=[{nonce:3,safeTxHash:ethers.ZeroHash}];status=await f.workflow.transactionStatus('example',{account:owner.address,walletChainId:60808});assert.equal(status.conflicts.length,1);assert.equal(status.wallet.canSign,false);
 f.state.queue=[];f.state.nonce=4;status=await f.workflow.transactionStatus('example',{account:owner.address,walletChainId:60808});assert.equal(status.unchanged,false);assert.equal(status.execution.canExecute,false);
});
test('service transaction payload mismatch and unapproved v=1 signatures cannot count toward readiness',async()=>{
 const f=fixture();f.state.transaction={...serviceTx([]),value:'10'};assert.equal((await f.workflow.transactionStatus('example')).serviceKnown,false);
 const approved=ethers.concat([ethers.zeroPadValue(owner.address,32),ethers.ZeroHash,'0x01']);f.state.transaction=serviceTx([{owner:owner.address,signature:approved}]);const status=await f.workflow.transactionStatus('example');assert.equal(status.publishedApprovals,0);assert.equal(status.unverifiableApprovals,1);
});
test('the same local/published owner is counted once and an executed transaction is not signable',async()=>{
 const f=fixture();f.store.state.signatures=[{id:'example',safeTxHash:signing.safeTxHash,sender:owner.address,signature:typed}];f.state.transaction=serviceTx([{owner:owner.address,signature:typed}]);
 let status=await f.workflow.transactionStatus('example',{account:owner.address,walletChainId:60808});assert.equal(status.usableSignatures,1);assert.equal(status.execution.canExecute,false);assert.equal(status.wallet.alreadyPublished,true);
 f.state.transaction.isExecuted=true;status=await f.workflow.transactionStatus('example',{account:owner.address,walletChainId:60808});assert.equal(status.wallet.canSign,false);assert.equal(status.execution.canExecute,false);assert.equal(status.execution.status,'Already executed');
});
test('a batch disable switch blocks Tenderly planning before any spending or lookup',async()=>{
 const f=fixture();await f.workflow.configure({tenderly:{enabled:false}});let requested=false;
 const runner=new TenderlyRunner(f.store,{config:()=>({configured:true,account:'account',project:'project',key:'test'}),fetcher:async()=>{requested=true;throw Error('Must not request');}});
 await assert.rejects(runner.plan('example'),/disabled/);assert.equal(requested,false);
});
test('new installation boots with setup required; settings and status endpoints stay token protected',async()=>{
 const f=fixture({empty:true}),port=31000+Math.floor(Math.random()*1000);const server=createServer(f.root,{store:f.store,workflow:f.workflow,port,catalog:new ChainCatalog(async()=>{throw Error('Offline');})});await new Promise(r=>server.listen(port,'127.0.0.1',r));
 try{const base=`http://127.0.0.1:${port}`,batch=await fetch(base+'/api/batch').then(r=>r.json());assert.equal(batch.setupRequired,true);assert.equal(batch.operations.length,0);assert.equal((await fetch(base+'/api/chains')).status,403);
 const headers={'content-type':'application/json','x-batch-token':batch.token};assert.equal((await fetch(base+'/api/chains',{headers})).status,200);
 assert.equal((await fetch(base+'/api/settings',{method:'POST',headers:{'content-type':'application/json'},body:'{}'})).status,403);
 assert.equal((await fetch(base+'/api/settings',{method:'POST',headers,body:JSON.stringify({tenderly:{enabled:false}})})).status,200);
 assert.equal((await fetch(base+'/secrets/safedesk.env')).status,404);assert.ok((await fetch(base).then(r=>r.text())).includes('<title>SafeDesk</title>'));
 }finally{await new Promise(r=>server.close(r));}
});
