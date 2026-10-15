import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import {Ed25519PublicKey} from '@mysten/sui/keypairs/ed25519';
import {Transaction} from '@mysten/sui/transactions';
import {SuiOperations, SUI_MAINNET, normalizePolicy, suiAddress, hashRecord} from '../other-chains/sui.mjs';
import {createOtherChainsHandler} from '../other-chains/http.mjs';
import {runOtherChains} from '../other-chains/cli.mjs';

const publicKey = n => new Ed25519PublicKey(new Uint8Array(32).fill(n)).toSuiPublicKey();
const sourceInput = {threshold: 2, members: [{publicKey: publicKey(1), weight: 1}, {publicKey: publicKey(2), weight: 1}]};
const targetInput = {threshold: 2, members: [{publicKey: publicKey(1), weight: 1}, {publicKey: publicKey(3), weight: 1}]};
const source = normalizePolicy(sourceInput), target = normalizePolicy(targetInput);
const digest = '11111111111111111111111111111111';
const now = Date.parse('2026-10-12T16:00:00Z');
const object = (id, type) => ({objectId: suiAddress(id), version: '1', digest, type, owner: {$kind: 'AddressOwner', AddressOwner: source.address}});
const asset = object('0x10', '0x2::coin::Coin<0x3::token::TOKEN>');
const cap = object('0x11', '0x2::package::UpgradeCap');
const gas = {...object('0x12', '0x2::coin::Coin<0x2::sui::SUI>'), balance: '500000000'};
function fixture(changes = {}) {
  const calls = [];
  const client = {
    getChainIdentifier: async () => ({chainIdentifier: SUI_MAINNET}),
    listOwnedObjects: async () => ({objects: [asset, cap, gas], hasNextPage: false, cursor: null}),
    listBalances: async () => ({balances: [{coinType: '0x2::sui::SUI', balance: '500000000', coinBalance: '500000000', addressBalance: '0'}], hasNextPage: false, cursor: null}),
    listTransactions: async () => ({transactions: [], hasNextPage: false}),
    getObjects: async ({objectIds}) => ({objects: objectIds.map(id => [asset, cap, gas].find(o => o.objectId === id))}),
    listCoins: async () => ({objects: [gas], hasNextPage: false, cursor: null}),
    getReferenceGasPrice: async () => ({referenceGasPrice: '1000'}),
    getCurrentSystemState: async () => ({systemState: {epoch: '100'}}),
    simulateTransaction: async input => {
      calls.push(input);
      const tx = Transaction.from(input.transaction).getData();
      return {Transaction: {status: {success: true}, effects: {gasUsed: {computationCost: '1000'}, changedObjects: [...tx.inputs.filter(x => x.Object).map(x => ({objectId: x.Object.ImmOrOwnedObject.objectId, outputOwner: {$kind: 'AddressOwner', AddressOwner: target.address}, outputVersion: '2'})), {objectId: gas.objectId, outputOwner: {$kind: 'AddressOwner', AddressOwner: source.address}, outputVersion: '2'}]}, balanceChanges: []}, gasPaymentMocked: false};
    },
    executeTransaction: () => {throw Error('Execution is forbidden');},
    signAndExecuteTransaction: () => {throw Error('Signing is forbidden');},
    ...changes,
  };
  const operations = new SuiOperations({client, archiveClient: client, now: () => now});
  const request = {vault: source.address, sourcePolicy: sourceInput, targetPolicy: targetInput, objectIds: [asset.objectId], ackDestination: true};
  return {operations, client, request, calls};
}

test('public policy derives native addresses, validates weights, order and claimed owner addresses', () => {
  assert.equal(source.members.length, 2); assert.equal(source.ownerCount, 2);
  assert.notEqual(normalizePolicy({...sourceInput, members: [...sourceInput.members].reverse()}).address, source.address);
  assert.throws(() => normalizePolicy({...sourceInput, threshold: 3}), /threshold/);
  assert.throws(() => normalizePolicy({...sourceInput, threshold: 0}), /threshold/);
  assert.throws(() => normalizePolicy({...sourceInput, members: [sourceInput.members[0], sourceInput.members[0]]}), /duplicate/i);
  assert.throws(() => normalizePolicy({...sourceInput, members: [{...sourceInput.members[0], address: '0x99'}, sourceInput.members[1]]}), /does not match/);
  assert.throws(() => normalizePolicy(sourceInput, target.address), /expected vault/);
  assert.throws(() => normalizePolicy({...sourceInput, privateKey: 'never-accepted'}), /Only public/);
  assert.throws(() => normalizePolicy({...sourceInput, members: [{publicKey: 'AA==', weight: 1}, sourceInput.members[1]]}), /public keys/);
  assert.throws(() => normalizePolicy({...sourceInput, members: [{address: source.members[0].address, weight: 1}, sourceInput.members[1]]}), /Addresses alone/);
});
test('MSafe nonce specifier is retained but not counted as an owner or reachable weight', () => {
  const msafe = normalizePolicy({...sourceInput, creationNonce: 0});
  assert.equal(msafe.ownerCount, 2); assert.equal(msafe.members.length, 3);
  assert.equal(msafe.members[2].role, 'msafe-specifier'); assert.equal(msafe.creationNonce, 0);
  assert.equal(normalizePolicy(msafe).address, msafe.address);
  assert.notEqual(msafe.address, normalizePolicy({...sourceInput, creationNonce: 1}).address);
  assert.throws(() => normalizePolicy({...msafe, threshold: 3}), /without the MSafe/);
  assert.throws(() => normalizePolicy({...msafe, creationNonce: 1}), /nonce differ/);
  assert.throws(() => normalizePolicy({...sourceInput, creationNonce: -1}), /nonce/);
  const nine = normalizePolicy({threshold: 9, members: Array.from({length: 9}, (_, i) => ({publicKey: publicKey(i + 1), weight: 1})), creationNonce: 0});
  assert.equal(nine.ownerCount, 9); assert.equal(nine.members.length, 10);
  assert.throws(() => normalizePolicy({...nine, threshold: 10, members: nine.members.map((member, index) => index === 9 ? {...member, weight: 2} : member)}), /specifier weight/);
  const bytes = Buffer.from(nine.members[9].publicKey, 'base64'); bytes[1] |= 0x80;
  const highBit = normalizePolicy({...nine, address: undefined, creationNonce: undefined, members: nine.members.map((member, index) => index === 9 ? {...member, address: undefined, publicKey: bytes.toString('base64')} : member)});
  assert.equal(highBit.ownerCount, 10); assert.equal(highBit.members[9].role, undefined);
});
test('kiosk, transfer-policy, legacy deny and unknown non-coin authority objects require acknowledgement', async () => {
  for (const type of ['0x2::kiosk::KioskOwnerCap', '0x2::transfer_policy::TransferPolicyCap<0x3::thing::Thing>', '0x2::coin::DenyCap<0x3::token::TOKEN>', '0x3::nft::Unknown']) {
    const authority = object('0x23', type);
    const {operations, request} = fixture({listOwnedObjects: async () => ({objects: [authority, gas], hasNextPage: false, cursor: null})});
    const inspected = await operations.inspect({vault: source.address, sourcePolicy: sourceInput});
    assert.equal(inspected.objects[0].kind, 'privileged');
    await assert.rejects(operations.plan({...request, objectIds: [authority.objectId]}), /acknowledgement/);
  }
});
test('inspection is explicit, preserves unknown policy and highlights capabilities and reserved gas', async () => {
  const {operations} = fixture();
  const known = await operations.inspect({vault: source.address, sourcePolicy: sourceInput, signer: source.members[0].address});
  assert.equal(known.complete, true); assert.equal(known.signerMember, true);
  assert.equal(known.objects.find(o => o.objectId === cap.objectId).kind, 'privileged');
  assert.equal(known.objects.find(o => o.objectId === gas.objectId).selectable, false);
  const unknown = await operations.inspect({vault: source.address});
  assert.equal(unknown.policy, null); assert.ok(unknown.warnings.some(w => w.includes('No migration export')));
});
test('wrong chain, foreign ownership and repeated inventory pagination fail closed', async () => {
  await assert.rejects(fixture({getChainIdentifier: async () => ({chainIdentifier: 'testnet'})}).operations.inspect({vault: source.address}), /mainnet/);
  await assert.rejects(fixture({listOwnedObjects: async () => ({objects: [{...asset, owner: {$kind: 'AddressOwner', AddressOwner: target.address}}], hasNextPage: false})}).operations.inspect({vault: source.address}), /not directly owned/);
  await assert.rejects(fixture({listOwnedObjects: async () => ({objects: [], hasNextPage: true, cursor: 'same'})}).operations.inspect({vault: source.address}), /pagination/);
});
test('planning cannot bypass policy, destination access, gas reservation or capability acknowledgement', async () => {
  const {operations, request} = fixture();
  for (const [change, pattern] of [
    [{sourcePolicy: undefined}, /source public policy/],
    [{ackDestination: false}, /destination keys/],
    [{objectIds: []}, /exact objects/],
    [{objectIds: [gas.objectId]}, /reserved SUI gas/],
    [{objectIds: [cap.objectId]}, /acknowledgement/],
    [{objectIds: [asset.objectId, asset.objectId]}, /Duplicate/],
    [{targetPolicy: sourceInput}, /unchanged/],
    [{gasBudgetMist: '100000001'}, /0.1 SUI/],
    [{signer: target.members[1].address}, /not in the source/],
  ]) await assert.rejects(operations.plan({...request, ...change}), pattern);
  const partial = fixture({listBalances: async ({cursor}) => ({balances: [], hasNextPage: true, cursor: `${cursor || ''}x`})});
  await assert.rejects(partial.operations.plan(partial.request), /complete inventory/);
});
test('fully assembled migration exports real Mysten V2 JSON, exact bytes and digest without a signer', async () => {
  const {operations, request} = fixture();
  const pkg = await operations.plan({...request, objectIds: [asset.objectId, cap.objectId], ackPrivileged: true});
  const tx = Transaction.from(pkg.transactionJson);
  assert.equal(tx.getData().version, 2); assert.equal(tx.getData().sender, source.address);
  assert.equal(tx.getData().commands.length, 1); assert.equal(pkg.destinationVault, target.address);
  assert.equal(await tx.getDigest(), pkg.transactionDigest);
  assert.equal(Buffer.from(await tx.build()).toString('base64'), pkg.transactionBytes);
  assert.ok(pkg.remainingObjectIds.includes(gas.objectId)); assert.equal(pkg.buildOnly, true);
});
test('native simulation uses enabled checks and real gas, verifies destination ownership, never authorization', async () => {
  const {operations, request, calls} = fixture();
  const pkg = await operations.plan(request);
  const result = await operations.simulate({package: pkg});
  assert.equal(result.status, 'passed'); assert.equal(result.authorizationVerified, false);
  assert.equal(calls.length, 1); assert.equal(calls[0].checksEnabled, true); assert.equal(calls[0].doGasSelection, false);
});
test('mocked gas and missing destination ownership are never successful proof', async () => {
  for (const gasPaymentMocked of [true, false]) {
    const {operations, request} = fixture({simulateTransaction: async () => ({Transaction: {status: {success: true}, effects: {changedObjects: []}}, gasPaymentMocked})});
    const result = await operations.simulate({package: await operations.plan(request)});
    assert.equal(result.status, 'failed');
  }
});
test('stale object refs, hash mismatches, stale timestamps and tampered destination stop before simulation', async () => {
  const {operations, request, client, calls} = fixture();
  const pkg = await operations.plan(request);
  await assert.rejects(operations.simulate({package: {...pkg, destinationVault: source.address}}), /hash/);
  const old = {...pkg, createdAt: '2026-10-12T15:00:00Z'}; delete old.packageHash; old.packageHash = hashRecord(old);
  await assert.rejects(operations.simulate({package: old}), /fresh/);
  client.getObjects = async () => ({objects: [{...asset, version: '2'}, gas]});
  await assert.rejects(operations.simulate({package: pkg}), /Object version/);
  client.getObjects = async () => ({objects: [asset, gas]});
  const malicious = {...pkg, targetPolicy: sourceInput, destinationVault: source.address}; delete malicious.packageHash; malicious.packageHash = hashRecord(malicious);
  await assert.rejects(operations.simulate({package: malicious}), /Invalid migration/);
  assert.equal(calls.length, 0);
});
test('fully rehashed capability substitution cannot retain coin metadata or omit exact capability acknowledgement', async () => {
  const {operations, request, calls} = fixture();
  const pkg = await operations.plan(request);
  const data = Transaction.from(pkg.transactionJson).getData();
  const tx = new Transaction(); tx.setSender(source.address); tx.setGasOwner(source.address);
  tx.setGasPrice(data.gasData.price); tx.setGasBudget(data.gasData.budget); tx.setGasPayment(data.gasData.payment); tx.setExpiration(data.expiration);
  tx.transferObjects([tx.objectRef({objectId: cap.objectId, version: cap.version, digest: cap.digest})], tx.pure.address(target.address));
  const json = await tx.toJSON(), bytes = await tx.build();
  const altered = {...pkg, selectedObjects: [{...pkg.selectedObjects[0], objectId: cap.objectId}], transactionJson: json, transaction: JSON.parse(json), transactionBytes: Buffer.from(bytes).toString('base64'), transactionDigest: await tx.getDigest()};
  delete altered.packageHash; altered.packageHash = hashRecord(altered);
  await assert.rejects(operations.simulate({package: altered}), /metadata does not match/);
  altered.selectedObjects[0] = {...altered.selectedObjects[0], type: '0x0000000000000000000000000000000000000000000000000000000000000002::package::UpgradeCap', kind: 'privileged'};
  altered.acknowledgements = {...altered.acknowledgements, capabilitySelectionHash: hashRecord({sourceVault: source.address, destinationVault: target.address, objects: altered.selectedObjects})};
  delete altered.packageHash; altered.packageHash = hashRecord(altered);
  await assert.rejects(operations.simulate({package: altered}), /acknowledgements/);
  assert.equal(calls.length, 0);
});
test('address-only owner lookup refuses unknown keys rather than guessing', async () => {
  const {operations, request} = fixture();
  await assert.rejects(operations.plan({...request, targetPolicy: {threshold: 2, members: target.members.map(({address, weight}) => ({address, weight}))}}), /could not be resolved/);
});
test('HTTP only exposes explicit same-origin read/build/simulate actions and sanitizes provider errors', async t => {
  let called = 0;
  const handler = createOtherChainsHandler({operations: {inspect: async () => {called++; return {readOnly: true};}, plan: async () => {throw Error('https://provider.invalid/private?key=hidden');}}});
  const server = http.createServer((req, res) => handler(req, res, new URL(req.url, 'http://localhost').pathname));
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => server.close());
  const url = `http://127.0.0.1:${server.address().port}/api/other-chains/sui/`;
  const headers = {'content-type': 'application/json', origin: 'http://localhost', 'x-safedesk-readonly': '1'};
  assert.equal((await fetch(url + 'inspect')).status, 405);
  assert.equal((await fetch(url + 'inspect', {method: 'POST', body: '{}'})).status, 403);
  assert.equal((await fetch(url + 'execute', {method: 'POST', headers, body: '{}'})).status, 404);
  assert.equal((await fetch(url + 'inspect', {method: 'POST', headers, body: '{}'})).status, 200); assert.equal(called, 1);
  const error = await fetch(url + 'plan', {method: 'POST', headers, body: '{}'});
  assert.equal(error.status, 400); assert.doesNotMatch(await error.text(), /provider\.invalid|hidden/);
});
test('CLI public-policy derivation is offline, never overwrites outputs and rejects submit mode', async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'safedesk-sui-cli-')); t.after(() => fs.rmSync(dir, {recursive: true}));
  const input = path.join(dir, 'policy.json'), out = path.join(dir, 'derived.json'); fs.writeFileSync(input, JSON.stringify(targetInput));
  const operations = new Proxy({}, {get: () => () => {throw Error('Network forbidden');}});
  await runOtherChains(['derive', '--input', input, '--out', out], {operations, write: () => {}});
  assert.equal(JSON.parse(fs.readFileSync(out)).address, target.address);
  await assert.rejects(runOtherChains(['derive', '--input', input, '--out', out], {operations}), /Nothing was overwritten/);
  await assert.rejects(runOtherChains(['submit', '--input', input, '--out', out], {operations}), /Unsupported/);
});
