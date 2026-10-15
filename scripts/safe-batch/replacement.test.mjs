import test from 'node:test';
import assert from 'node:assert/strict';
import {ethers} from 'ethers';
import {CHAINS,normalizeSigning} from './core.mjs';
import {verifiedQueue,verifyServiceTransaction,canonicalHashes,replacementApproval,competingHashes} from './replacement.mjs';

const safe='0x1111111111111111111111111111111111111111',context={chainId:60808,service:'https://transaction.safe.gobob.xyz'};
const signed=normalizeSigning({domain:{chainId:context.chainId,verifyingContract:safe},message:{to:safe,value:'0',data:'0x',operation:0,
 safeTxGas:'0',baseGas:'0',gasPrice:'0',gasToken:ethers.ZeroAddress,refundReceiver:ethers.ZeroAddress,nonce:'1'}});
const tx=()=>({safe,...signed.message,safeTxHash:signed.safeTxHash,isExecuted:false,confirmations:[]});
const other=normalizeSigning({...signed,safeTxHash:undefined,message:{...signed.message,value:'1'}}).safeTxHash;
const route=`${context.service}/api/v1/safes/${safe}/multisig-transactions/?executed=false&nonce=1&limit=100`;

test('full queue payload verification rejects wrong Safe, nonce, execution, missing fields and forged hash',()=>{
 assert.equal(verifyServiceTransaction(tx(),{...context,safe,nonce:'1'},normalizeSigning).safeTxHash,signed.safeTxHash);
 assert.equal(verifyServiceTransaction({...tx(),data:null},{...context,safe,nonce:'1'},normalizeSigning).data,'0x');
 for(const change of [{safe:ethers.ZeroAddress},{nonce:'2'},{isExecuted:true},{isExecuted:'false'},{isExecuted:undefined},
  {safeTxHash:other},{safeTxHash:ethers.ZeroHash},{data:undefined},{to:undefined},{gasToken:undefined},{refundReceiver:undefined},
  {value:undefined},{nonce:Number.MAX_SAFE_INTEGER+1},{value:'-1'},{value:String(2n**256n)},{operation:false},{operation:'0'}]) {
  assert.throws(()=>verifyServiceTransaction({...tx(),...change},{...context,safe,nonce:'1'},normalizeSigning));
 }
});
test('pagination follows only the same service/Safe/current-nonce path, with bounded pages and no cycles',async()=>{
 let calls=[];
 const store={json:async url=>{calls.push(url);return {results:[tx()],next:calls.length===1?'?executed=false&nonce=1&limit=100&offset=100':null};}};
 assert.equal((await verifiedQueue(store,context,safe,'1',normalizeSigning)).length,1);assert.equal(calls.length,2);
 const badNext=['https://evil.example'+new URL(route).pathname+'?executed=false&nonce=1&limit=100',
  '/api/v1/safes/0x2222222222222222222222222222222222222222/multisig-transactions/?executed=false&nonce=1&limit=100',
  '/api/v1/multisig-transactions/?executed=false&nonce=1&limit=100','?executed=true&nonce=1&limit=100',
  '?executed=false&nonce=2&limit=100','?executed=false&nonce=1&nonce=2&limit=100',
  '?executed=false&nonce=1&limit=1000',route,'https://user:pass@transaction.safe.gobob.xyz'+new URL(route).pathname+'?executed=false&nonce=1&limit=100'];
 for(const next of badNext) {
  calls=[];await assert.rejects(verifiedQueue({json:async url=>{calls.push(url);return {results:[tx()],next};}},context,safe,'1',normalizeSigning));
  assert.equal(calls.length,1);
 }
 calls=[];await assert.rejects(verifiedQueue({json:async url=>{calls.push(url);return {results:[],next:`?executed=false&nonce=1&limit=100&offset=${calls.length*100}`};}},context,safe,'1',normalizeSigning),/too large/);
 assert.equal(calls.length,10);
 for(const response of [{results:null,next:null},{results:[],next:{}},{results:[]},{results:Array(101).fill(tx()),next:null},
  {results:[{nonce:1,safeTxHash:signed.safeTxHash}],next:null}]) {
  await assert.rejects(verifiedQueue({json:async()=>response},context,safe,'1',normalizeSigning));
 }
});
test('replacement uses unique full nonzero hashes, excludes a present candidate on both sides and permits no wildcards',()=>{
 const current=competingHashes([{hash:signed.safeTxHash},{hash:other}],[{hash:other}],signed.safeTxHash);
 assert.deepEqual(current,[other]);
 assert.deepEqual(replacementApproval({confirm:'REPLACE',acknowledgedHashes:[signed.safeTxHash,other]},current,signed.safeTxHash,true),[other]);
 assert.deepEqual(replacementApproval(undefined,[],signed.safeTxHash,true),[]);
 assert.deepEqual(canonicalHashes([other.toUpperCase().replace('0X','0x')]),[other]);
 for(const values of [['*'],['0x1234'],[ethers.ZeroHash],[other,other],null,[other,other.toUpperCase().replace('0X','0x')]])assert.throws(()=>canonicalHashes(values));
 for(const approval of [{confirm:'REPLACE',acknowledgedHashes:[]},{confirm:'REPLACE',acknowledgedHashes:[other,signed.safeTxHash]},
  {confirm:'REPLACE',acknowledgedHashes:[other,ethers.id('extra')]},{confirm:'PROPOSE',acknowledgedHashes:[other]}]) {
  assert.throws(()=>replacementApproval(approval,current,signed.safeTxHash,false));
 }
 assert.throws(()=>replacementApproval(undefined,current,signed.safeTxHash),/explicit replacement/);
});

test('canonical service mappings retain BOB and prefix Ethereum pagination; another chain on the same origin is rejected',async()=>{
 for(const [chainId,prefix]of [[1,'eth'],[10,'oeth'],[137,'matic'],[42161,'arb1'],[8453,'base']])assert.equal(CHAINS[chainId].service,`https://api.safe.global/tx-service/${prefix}`);
 assert.equal(CHAINS[60808].service,context.service);
 const ethereum={chainId:1,service:CHAINS[1].service},ethereumSigning=normalizeSigning({...signed,safeTxHash:undefined,domain:{chainId:1,verifyingContract:safe}});
 const row={safe,...ethereumSigning.message,safeTxHash:ethereumSigning.safeTxHash,isExecuted:false,confirmations:[]};
 const first=`${ethereum.service}/api/v1/safes/${safe}/multisig-transactions/?executed=false&nonce=1&limit=100`;
 const second=first+'&offset=100';
 for(const service of [ethereum.service,ethereum.service+'/']) {
  const calls=[];
  const results=await verifiedQueue({json:async url=>{calls.push(url);return {results:[row],next:calls.length===1?second:null};}}, {...ethereum,service},safe,'1',normalizeSigning);
  assert.equal(results[0].safeTxHash,ethereumSigning.safeTxHash);assert.deepEqual(calls,[first,second]);
 }
 for(const next of [second.replace('/tx-service/eth/','/tx-service/base/'),second.replace('/tx-service/eth',''),
  second.replace('/tx-service/eth/','/tx-service/eth-extra/')]) {
  const calls=[];
  await assert.rejects(verifiedQueue({json:async url=>{calls.push(url);return {results:[row],next};}},ethereum,safe,'1',normalizeSigning),/pagination/);
  assert.deepEqual(calls,[first]);
 }
});
