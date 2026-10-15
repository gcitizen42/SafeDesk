import test from 'node:test';
import assert from 'node:assert/strict';
import {safeIdentity,safeKey,workspaceSafes,operationsForSafe,preferredOperation,safeQueueHref,replacementHashes,requestReviewedSignature} from '../safe-batch/workspace.mjs';
import {ethers} from 'ethers';
import {normalizeSigning} from '../safe-batch/core.mjs';

const address='0x3266Ccd7857a6D00664540249aaD0f7830e71122';
const selected={chainId:60808,address,label:'Council BOB'};
const old={id:'old',chainId:60808,safe:address,nonce:'1',hash:'0x'+'11'.repeat(32)};
const next={...old,id:'replacement',hash:'0x'+'22'.repeat(32)};
test('Safe scope is chain-and-address bound and rejects malformed identities',()=>{
 assert.equal(safeKey(selected),safeKey({chainId:'60808',address:address.toLowerCase()}));
 assert.notEqual(safeKey(selected),safeKey({...selected,chainId:1}));
 assert.equal(safeIdentity({chainId:60808,address:'javascript:alert(1)'}),null);
 assert.equal(safeIdentity({chainId:0,address}),null);
 assert.equal(safeIdentity({chainId:60808,address:'0x'+'00'.repeat(20)}),null);
});

test('final wallet signing boundary rechecks readiness after network dialogs and binds scope, hash, account and chain',async()=>{
 const signing=normalizeSigning({domain:{chainId:60808,verifyingContract:address},message:{to:address,value:'0',data:'0x',operation:0,safeTxGas:'0',baseGas:'0',gasPrice:'0',gasToken:ethers.ZeroAddress,refundReceiver:ethers.ZeroAddress,nonce:'1'}});
 const item={chainId:60808,hash:signing.safeTxHash,signing},sender=ethers.Wallet.createRandom().address;
 for(const scenario of ['queue-arrival','nonce-change','wrong-hash','scope-change','account-change','chain-change','valid']) {
  const calls=[];let current=true;
  const request=async({method})=>{calls.push(method);if(method==='eth_chainId')return scenario==='chain-change'?'0x1':'0xed88';if(method==='eth_accounts')return[scenario==='account-change'?address:sender];return 'synthetic-signature';};
  const check=async()=>{calls.push('check-after-switch');if(['queue-arrival','nonce-change'].includes(scenario))throw Error('Review changed');if(scenario==='scope-change')current=false;return{hash:scenario==='wrong-hash'?'0x'+'11'.repeat(32):item.hash,owners:[sender]};};
  const run=()=>requestReviewedSignature({item,sender,method:'eip712',request,check,assertCurrent:()=>{if(!current)throw Error('Selection changed');}});
  if(scenario==='valid'){assert.equal(await run(),'synthetic-signature');assert.deepEqual(calls,['check-after-switch','eth_chainId','eth_accounts','eth_signTypedData_v4']);}
  else {await assert.rejects(run());assert.ok(!calls.includes('eth_signTypedData_v4'));assert.ok(!calls.includes('personal_sign'));}
 }
});
test('viewed Safe is first; My Safes, recent and prepared choices deduplicate without merging chains',()=>{
 const choices=workspaceSafes({selectedSafe:selected,safes:[{...selected,address:address.toLowerCase()}, {...selected,chainId:1}]},[old,next]);
 assert.equal(choices.length,2);assert.equal(choices[0].label,'Council BOB');assert.equal(choices[0].chainId,60808);assert.equal(choices[1].chainId,1);
 assert.deepEqual(operationsForSafe([old,{...next,chainId:1}],selected),[old]);
 assert.deepEqual(operationsForSafe([old],null),[]);
});
test('latest local alternative is preferred for a Safe without discarding the old operation',()=>{
 assert.equal(preferredOperation([old,next],selected).id,'replacement');
 assert.equal(preferredOperation([old,next,{...old,id:'new-nonce',nonce:'2'}],selected).id,'new-nonce');
 assert.equal(preferredOperation([old],{...selected,chainId:1}),undefined);
});
test('BOB navigation is constructed from verified identity, never saved result URLs',()=>{
 const chains={60808:{short:'bob'},1:{short:'eth'}};
 assert.equal(new URL(safeQueueHref(selected,chains)).origin,'https://safe.gobob.xyz');
 assert.equal(new URL(safeQueueHref({...selected,chainId:1},chains)).origin,'https://app.safe.global');
 assert.equal(safeQueueHref({...selected,chainId:999},chains),null);
 assert.equal(safeQueueHref(selected,{60808:{short:'bob&redirect=evil'}}),null);
});
test('replacement review binds all inspected queue/local hashes and rejects hash-only garbage',()=>{
 assert.deepEqual(replacementHashes({queuedTransactions:[{hash:next.hash},{hash:old.hash}],localOperations:[{hash:old.hash}]}),[old.hash,next.hash]);
 assert.throws(()=>replacementHashes({queuedTransactions:[{hash:'0x123'}]}),/invalid/);
});
