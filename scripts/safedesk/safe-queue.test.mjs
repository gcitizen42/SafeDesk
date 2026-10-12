import {test} from 'node:test';
import assert from 'node:assert/strict';
import {ethers} from 'ethers';
import {safeTxTypes} from '../prepare-safe-service-proposal.mjs';
import {SafeQueueReader} from './safe-queue.mjs';

const safe='0x1111111111111111111111111111111111111111',other='0x2222222222222222222222222222222222222222';
const args={chainId:1,safe,nonce:'7'};
function row(nonce=7,change={}){const tx={to:other,value:'0',data:'0x',operation:1,safeTxGas:'123',baseGas:'456',gasPrice:'0',gasToken:ethers.ZeroAddress,refundReceiver:other,nonce};return{safe,...tx,safeTxHash:ethers.TypedDataEncoder.hash({chainId:1,verifyingContract:safe},safeTxTypes(),tx),isExecuted:false,confirmations:[],...change};}
const response=value=>new Response(JSON.stringify(value),{headers:{'content-type':'application/json'}});
test('pending reader uses the pinned current Safe endpoint, GET only, and preserves all fields',async()=>{
 const calls=[],reader=new SafeQueueReader({fetcher:async(url,opts)=>{calls.push({url,opts});return response({results:[row(),row(8),row(6),row(9,{isExecuted:true})],next:null});}});
 const result=await reader.get(args);assert.equal(result.status,'ok');assert.equal(result.complete,true);assert.equal(result.transactions.length,2);assert.equal(result.transactions[0].tx.operation,1);assert.equal(result.transactions[0].tx.baseGas,'456');assert.equal(result.transactions[0].tx.refundReceiver,other);
 assert.equal(calls[0].opts.method,'GET');assert.equal(calls[0].opts.redirect,'error');assert.equal(calls[0].opts.credentials,'omit');assert.equal(calls[0].opts.headers.authorization,undefined);assert.equal(new URL(calls[0].url).origin,'https://api.safe.global');assert.equal(new URL(calls[0].url).searchParams.get('nonce__gte'),'7');assert.match(calls[0].url,/\/tx-service\/eth\/api\/v1\/safes\//);
});
test('unsupported chains and malformed inputs perform no service requests',async()=>{
 let requests=0;const reader=new SafeQueueReader({fetcher:async()=>{requests++;throw Error();}});
 assert.equal((await reader.get({...args,chainId:999999})).status,'unsupported');
 for(const change of [{chainId:0},{safe:'https://localhost'},{nonce:'-1'},{nonce:'1.1'},{nonce:'1'.repeat(79)}])await assert.rejects(reader.get({...args,...change}));assert.equal(requests,0);
});
test('hash mismatches, foreign Safes, unsafe numbers and unknown execution state are rejected, never an empty verified queue',async()=>{
 const reader=new SafeQueueReader({fetcher:async()=>response({results:[row(7,{safeTxHash:ethers.ZeroHash}),row(7,{safe:other}),row(7,{nonce:9007199254740992}),row(7,{isExecuted:null})],next:null})});
 const result=await reader.get(args);assert.equal(result.status,'partial');assert.equal(result.complete,false);assert.equal(result.rejected,4);assert.equal(result.transactions.length,0);
});
test('pagination deduplicates hashes and cannot leave this Safe, service origin or pending filter',async()=>{
 for(const next of ['https://evil.example/steal','http://127.0.0.1/private','https://api.safe.global/tx-service/base/api/v1/safes/'+safe+'/multisig-transactions/?executed=false&nonce__gte=7','?executed=true&nonce__gte=7']){
  let calls=0;const reader=new SafeQueueReader({fetcher:async()=>{calls++;return response({results:[row()],next});}});const result=await reader.get(args);assert.equal(result.status,'partial');assert.equal(calls,1);assert.equal(result.transactions.length,1);
 }
 let calls=0;const reader=new SafeQueueReader({fetcher:async(url)=>{calls++;return response({results:[row()],next:calls===1?url+'&offset=50':null});}});assert.equal((await reader.get(args)).transactions.length,1);assert.equal(calls,2);
});
test('service outages, malformed or oversized bodies and HTTP errors are unknown rather than no pending',async()=>{
 for(const fetcher of [async()=>{throw Error('no network');},async()=>new Response('',{status:429}),async()=>response({bad:true}),async()=>new Response('{}',{headers:{'content-length':String(5*1024*1024)}})]){
  const result=await new SafeQueueReader({fetcher}).get(args);assert.equal(result.status,'unavailable');assert.equal(result.complete,false);assert.ok(result.warning);
 }
});
test('bounded pagination returns explicit partial status when limit is reached',async()=>{
 let calls=0;const reader=new SafeQueueReader({fetcher:async(url)=>{calls++;const next=new URL(url);next.searchParams.set('offset',String(calls*50));return response({results:[row(6+calls)],next:next.href});}});const result=await reader.get(args);assert.equal(calls,5);assert.equal(result.status,'partial');assert.equal(result.transactions.length,5);
});
test('session cache and inflight dedup avoid repeat external requests',async()=>{
 let calls=0,now=0;const reader=new SafeQueueReader({now:()=>now,fetcher:async()=>{calls++;await new Promise(r=>setTimeout(r,5));return response({results:[row()],next:null});}});
 await Promise.all([reader.get(args),reader.get(args)]);await reader.get(args);assert.equal(calls,1);now=16000;await reader.get(args);assert.equal(calls,2);
});
