import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {ethers} from 'ethers';
import {BatchStore,SAFE_ABI,normalizeSigning,recoverSignature,simulationMatch} from './core.mjs';
import {createServer} from './server.mjs';
const wallet=ethers.Wallet.createRandom(),second=ethers.Wallet.createRandom();
const signing=normalizeSigning({domain:{chainId:60808,verifyingContract:'0x1111111111111111111111111111111111111111'},message:{to:'0x2222222222222222222222222222222222222222',value:'0',data:'0x1234',operation:1,safeTxGas:'0',baseGas:'0',gasPrice:'0',gasToken:ethers.ZeroAddress,refundReceiver:ethers.ZeroAddress,nonce:'11'}});
const typed=await wallet.signTypedData(signing.domain,signing.types,signing.message);
const raw=await wallet.signMessage(ethers.getBytes(signing.safeTxHash));
function fixture(){
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'safe-batch-test-'));const dir=path.join(root,'fixture');fs.mkdirSync(dir);
 for(const [name,value]of Object.entries({'batch.json':{operations:[{id:'fixture'}]},'fixture/signing-data.json':signing,'fixture/operation.json':{id:'fixture',chainId:60808,safe:signing.domain.verifyingContract,safeTxHash:signing.safeTxHash,threshold:2,newOwners:[wallet.address,second.address]},'fixture/current-owners.json':{owners:[wallet.address,second.address],threshold:2,nonce:11},'fixture/local-simulation.json':{status:'PASSED',safeTxHash:signing.safeTxHash}}))fs.writeFileSync(path.join(root,name),JSON.stringify(value));
 const calls=[],state={nonce:11,queue:[],existing:false,failAfterAcceptance:false};
 const result=(data,status=200)=>new Response(JSON.stringify(data),{status});
 const fetcher=async(url,opt={})=>{
  const body=opt.body?JSON.parse(opt.body):null;calls.push({url,method:opt.method||'GET',body});
  if(url==='https://rpc.gobob.xyz'){
   let value;if(body.method==='eth_chainId')value='0xed88';else if(body.method==='eth_blockNumber')value='0x100';else if(body.method==='eth_call'){
    const parsed=SAFE_ABI.parseTransaction({data:body.params[0].data});const outputs={getOwners:[[wallet.address,second.address]],getThreshold:[2],nonce:[state.nonce],getTransactionHash:[signing.safeTxHash]};value=SAFE_ABI.encodeFunctionResult(parsed.name,outputs[parsed.name]);
   }else throw Error('Unexpected RPC method');return result({jsonrpc:'2.0',id:1,result:value});
  }
  if(url.includes('?executed='))return result({results:state.queue,next:null});
  if(opt.method==='POST'){state.existing=true;if(state.failAfterAcceptance){state.failAfterAcceptance=false;throw Error('Connection lost after acceptance');}return new Response('',{status:201});}
  return state.existing?result({isExecuted:false,confirmations:[{owner:wallet.address}]}):result({},404);
 };
 return{root,calls,state,store:new BatchStore(root,{fetcher})};
}
test('chain, nonce and calldata determine the hash; imports cannot override it',()=>{
 assert.throws(()=>normalizeSigning({...signing,safeTxHash:ethers.ZeroHash}),/hash/);
 assert.notEqual(normalizeSigning({...signing,safeTxHash:undefined,message:{...signing.message,nonce:'12'}}).safeTxHash,signing.safeTxHash);
 assert.notEqual(normalizeSigning({...signing,safeTxHash:undefined,domain:{...signing.domain,chainId:10}}).safeTxHash,signing.safeTxHash);
});
test('typed and Ledger signatures recover correctly; wrong owner/hash rejected',()=>{
 assert.equal(recoverSignature(signing,wallet.address,typed).mode,'EIP-712');const eth=recoverSignature(signing,wallet.address,raw);assert.equal(eth.mode,'Safe personal_sign');assert.ok([31,32].includes(parseInt(eth.signature.slice(-2),16)));
 assert.throws(()=>recoverSignature(signing,second.address,typed),/recover/);
 const other=normalizeSigning({...signing,safeTxHash:undefined,message:{...signing.message,nonce:'12'}});assert.throws(()=>recoverSignature(other,wallet.address,typed),/recover/);
});
test('full simulation checks payload plus ExecutionSuccess hash, not outer transaction hash',()=>{
 const m=signing.message,data=SAFE_ABI.encodeFunctionData('execTransaction',[m.to,m.value,m.data,m.operation,m.safeTxGas,m.baseGas,m.gasPrice,m.gasToken,m.refundReceiver,'0x']);
 const doc={transaction:{to:signing.domain.verifyingContract,input:data},receipt:{logs:[{address:signing.domain.verifyingContract,topics:[ethers.id('ExecutionSuccess(bytes32,uint256)')],data:ethers.AbiCoder.defaultAbiCoder().encode(['bytes32','uint256'],[signing.safeTxHash,0])}]}};
 assert.equal(simulationMatch(doc,signing).matched,true);
 assert.throws(()=>simulationMatch({...doc,receipt:{logs:[]}},signing),/ExecutionSuccess/);
 assert.throws(()=>simulationMatch({status:'PASSED',safeTxHash:ethers.ZeroHash},signing));
 const modified=normalizeSigning({...signing,safeTxHash:undefined,message:{...m,value:1}});assert.throws(()=>simulationMatch(doc,modified),/value/);
});
test('collect persists privately, deduplicates signer and permits one-signature proposals',async()=>{
 const f=fixture();await f.store.collect('fixture',wallet.address,typed);await f.store.collect('fixture',wallet.address,raw);assert.equal(f.store.export().operations[0].signatures.length,1);
 assert.equal(fs.statSync(path.join(f.root,'secrets/batch-state.json')).mode&0o777,0o600);
 assert.equal(f.store.list()[0].signatures.length,1);assert.equal(f.store.list()[0].signatures[0].signature,undefined);
 assert.equal((await f.store.propose(['fixture']))[0].status,'proposed');assert.equal(f.calls.filter(x=>x.method==='POST'&&!x.url.includes('rpc.gobob')).length,1);
});
test('stale nonce, draft or conflicting queue block collection and publication',async()=>{
 const f=fixture();f.state.nonce=12;await assert.rejects(f.store.collect('fixture',wallet.address,typed),/changed/);assert.equal(f.store.state.signatures.length,0);f.state.nonce=11;
 f.state.queue=[{nonce:11,safeTxHash:ethers.ZeroHash}];await assert.rejects(f.store.check('fixture'),/Another/);f.state.queue=[];
 const file=path.join(f.root,'fixture/operation.json'),op=JSON.parse(fs.readFileSync(file));op.draft=true;fs.writeFileSync(file,JSON.stringify(op));await assert.rejects(f.store.collect('fixture',wallet.address,typed),/decision/);
 assert.equal(f.calls.filter(x=>x.method==='POST'&&!x.url.includes('rpc.gobob')).length,0);
});
test('restart preserves collection; collection for another hash cannot be imported',async()=>{
 const f=fixture();await f.store.collect('fixture',wallet.address,typed);const restarted=new BatchStore(f.root,{fetcher:f.store.fetcher});assert.equal(restarted.list()[0].signatures.length,1);const data=f.store.export();data.operations[0].signing.message.nonce='13';await assert.rejects(restarted.importSignatures(data),/hash/);
});
test('two owners publish one proposal plus one confirmation; rerun does not repropose',async()=>{
 const f=fixture();await f.store.collect('fixture',wallet.address,typed);await f.store.collect('fixture',second.address,await second.signTypedData(signing.domain,signing.types,signing.message));
 await f.store.propose(['fixture']);const posts=f.calls.filter(x=>x.method==='POST'&&!x.url.includes('rpc.gobob'));
 assert.equal(posts.length,2);assert.ok(posts[1].url.endsWith('/confirmations/'));assert.equal(posts[0].body.contractTransactionHash,signing.safeTxHash);
 await f.store.propose(['fixture']);assert.equal(f.calls.filter(x=>x.method==='POST'&&x.url.includes('/safes/')).length,1);
});
test('ambiguous submission records progress and stops the batch; retry reconciles existing proposal',async()=>{
 const f=fixture();await f.store.collect('fixture',wallet.address,typed);
 const other=normalizeSigning({...signing,safeTxHash:undefined,domain:{...signing.domain,verifyingContract:'0x3333333333333333333333333333333333333333'}});
 const dir=path.join(f.root,'other');fs.mkdirSync(dir);for(const [name,data]of Object.entries({'operation.json':{chainId:60808,safe:other.domain.verifyingContract,safeTxHash:other.safeTxHash,threshold:2,newOwners:[wallet.address,second.address]},'signing-data.json':other,'current-owners.json':{owners:[wallet.address,second.address],threshold:2,nonce:11},'local-simulation.json':{status:'PASSED',safeTxHash:other.safeTxHash}}))fs.writeFileSync(path.join(dir,name),JSON.stringify(data));
 fs.writeFileSync(path.join(f.root,'batch.json'),JSON.stringify({operations:[{id:'fixture'},{id:'other'}]}));
 f.store.state.signatures.push({id:'other',chainId:60808,safe:other.domain.verifyingContract,safeTxHash:other.safeTxHash,sender:wallet.address,signature:await wallet.signTypedData(other.domain,other.types,other.message)});f.store.save();
 const original=f.store.rpc.bind(f.store);f.store.rpc=async(op,method,params)=>method==='eth_call'&&SAFE_ABI.parseTransaction({data:params[0].data}).name==='getTransactionHash'?SAFE_ABI.encodeFunctionResult('getTransactionHash',[op.safeTxHash]):original(op,method,params);
 f.state.failAfterAcceptance=true;const results=await f.store.propose(['fixture','other']);assert.equal(results.length,1);assert.equal(results[0].status,'needs-check');assert.equal(f.store.state.results.other,undefined);assert.equal(new BatchStore(f.root,{fetcher:f.store.fetcher}).list()[0].result.status,'needs-check');
 assert.equal((await f.store.propose(['fixture']))[0].status,'proposed');assert.equal(f.calls.filter(x=>x.method==='POST'&&x.url.includes('/safes/')).length,1);
});
test('UI and CLI writers are serialized and reread saved collection before changes',async()=>{
 const f=fixture(),other=new BatchStore(f.root,{fetcher:f.store.fetcher});
 await f.store.withLock(async()=>{await assert.rejects(other.withLock(async()=>{}),/Another/);await f.store.collect('fixture',wallet.address,typed);});
 assert.equal(other.list()[0].signatures.length,1);
 await other.withLock(async()=>{await other.collect('fixture',second.address,await second.signTypedData(signing.domain,signing.types,signing.message));});
 assert.equal(f.store.list()[0].signatures.length,2);assert.equal(fs.existsSync(path.join(f.root,'secrets/batch.lock')),false);
});
test('adding a Safe needs full current signing data and matching evidence before collection',async()=>{
 const f=fixture();await assert.rejects(f.store.add('duplicate',signing),/already in this batch/);
 const imported=normalizeSigning({...signing,safeTxHash:undefined,domain:{...signing.domain,verifyingContract:'0x4444444444444444444444444444444444444444'}});
 await assert.rejects(f.store.add('imported',imported),/Onchain Safe hash/);assert.equal(fs.existsSync(path.join(f.root,'imported')),false);
 const original=f.store.rpc.bind(f.store);f.store.rpc=async(op,method,params)=>method==='eth_call'&&SAFE_ABI.parseTransaction({data:params[0].data}).name==='getTransactionHash'?SAFE_ABI.encodeFunctionResult('getTransactionHash',[op.safeTxHash]):original(op,method,params);
 await f.store.add('imported',{...imported,service:'https://untrusted.example'});assert.equal(f.store.operation('imported').service,'https://transaction.safe.gobob.xyz');assert.equal(f.store.list()[1].proposedThreshold,null);
 const sig=await wallet.signTypedData(imported.domain,imported.types,imported.message);await assert.rejects(f.store.collect('imported',wallet.address,sig),/matching successful simulation/);
 f.store.attach('imported','https://dashboard.tenderly.co/example',{status:'PASSED',safeTxHash:imported.safeTxHash});await f.store.collect('imported',wallet.address,sig);assert.equal(f.store.list()[1].signatures.length,1);
});
test('HTTP rejects cross-origin mutation, missing session token and secret file reads',async()=>{
 const f=fixture(),port=29000+Math.floor(Math.random()*1000),server=createServer(f.root,{store:f.store,port});await new Promise(r=>server.listen(port,'127.0.0.1',r));
 try{
  const base=`http://127.0.0.1:${port}`;assert.equal((await fetch(base+'/secrets/batch-state.json')).status,404);
  assert.equal((await fetch(base+'/api/check',{method:'POST',headers:{'content-type':'application/json'},body:'{}'})).status,403);
  assert.equal((await fetch(base+'/api/batch',{headers:{origin:'https://other.example'}})).status,403);
  assert.equal((await fetch(base+'/api/export')).status,403);
  const init=await fetch(base+'/api/batch').then(r=>r.json());assert.equal((await fetch(base+'/api/export',{headers:{'x-batch-token':init.token}})).status,200);assert.equal((await fetch(base+'/api/check',{method:'POST',headers:{'content-type':'application/json','x-batch-token':init.token},body:JSON.stringify({id:'fixture'})})).status,200);
 }finally{await new Promise(r=>server.close(r));}
});
