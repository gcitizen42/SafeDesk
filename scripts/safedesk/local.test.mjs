import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import {createManagerServer,validPort} from './manager-server.mjs';
import {startDesk} from './start.mjs';

async function freePort() {
  const s = http.createServer();await new Promise(r => s.listen(0,'127.0.0.1',r));
  const port = s.address().port;await new Promise(r => s.close(r));return port;
}
function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(),'safedesk-isolation-'));
  const dist = path.join(root,'dist');fs.mkdirSync(path.join(dist,'assets'),{recursive:true});
  fs.writeFileSync(path.join(dist,'index.html'),'<!doctype html><html><head></head><body>Manager</body></html>');
  fs.writeFileSync(path.join(dist,'assets','boot-123.js'),'export const test = true;');
  fs.writeFileSync(path.join(root,'secret.env'),'PRIVATE TEST VALUE');
  t.after(() => fs.rmSync(root,{recursive:true,force:true}));return {root,dist};
}
test('only isolated localhost ports can be selected', () => {
  for(const p of [0,65536,-1,1.5,'junk'])assert.throws(() => validPort(p));
  assert.equal(validPort('8772'),8772);
  assert.throws(() => createManagerServer({port:8770,rotationPort:8770}),/separate/);
});
test('management serves only built assets, rejects other origins and keeps wallet actions off', async t => {
  const {root,dist} = fixture(t),port = await freePort(),rotationPort = await freePort();
  let catalogueReads=0;const catalogue={source:'built-in',fetchedAt:new Date().toISOString(),chains:[{chainId:1,name:'Ethereum',rpcs:['https://ethereum.publicnode.com'],rotationSupported:true}]};
  const server = createManagerServer({dist,port,rotationPort,catalog:{get:async()=>{catalogueReads++;return catalogue;}}});
  await new Promise(r => server.listen(port,'127.0.0.1',r));t.after(() => new Promise(r => server.close(r)));
  const base = `http://127.0.0.1:${port}`;
  const res = await fetch(base),html = await res.text();
  assert.match(html,/safedesk-wallet-actions" content="disabled/);assert.ok(html.includes(`http://127.0.0.1:${rotationPort}`));
  assert.match(res.headers.get('content-security-policy'),/frame-ancestors 'none'/);
  assert.equal(res.headers.get('access-control-allow-origin'),null);
  assert.equal((await fetch(base+'/assets/boot-123.js')).status,200);
  for(const p of ['/api/batch','/api/export','/secrets/batch-state.json','/secret.env','/assets/%2e%2e%2fsecret.env','/src/main.tsx'])assert.equal((await fetch(base+p)).status,404);
  assert.equal((await fetch(base,{headers:{origin:`http://127.0.0.1:${rotationPort}`}})).status,403);
  const badHost = await new Promise((resolve,reject) => {const req = http.get(base,{headers:{host:'evil.example'}},res => {res.resume();resolve(res.statusCode);});req.on('error',reject);});
  assert.equal(badHost,403);
  assert.equal((await fetch(base,{method:'POST'})).status,405);
  fs.symlinkSync(path.join(root,'secret.env'),path.join(dist,'assets','escape.js'));
  assert.equal((await fetch(base+'/assets/escape.js')).status,404);
  assert.equal((await (await fetch(base+'/.well-known/safedesk-manager')).json()).walletActions,false);
  const publicCatalogue=await fetch(base+'/api/chains');assert.equal(publicCatalogue.status,200);assert.deepEqual(await publicCatalogue.json(),catalogue);assert.equal(catalogueReads,1);assert.equal(publicCatalogue.headers.get('access-control-allow-origin'),null);
  assert.equal((await fetch(base+'/api/chains',{headers:{origin:`http://127.0.0.1:${rotationPort}`}})).status,403);assert.equal(catalogueReads,1);
});
test('launcher starts both origins without granting cross-origin batch access or collecting signatures', async t => {
  const {root,dist} = fixture(t),port = await freePort(),managerPort = await freePort();
  const batch = path.join(root,'batch');fs.mkdirSync(batch);
  const desk = await startDesk({root:batch,dist,port,managerPort,walletActions:true});t.after(desk.close);
  const rotation = `http://127.0.0.1:${port}`,manager = `http://127.0.0.1:${managerPort}`;
  assert.match(await (await fetch(manager)).text(),/safedesk-wallet-actions" content="enabled/);
  assert.ok((await (await fetch(rotation)).text()).includes(manager+'/'));
  assert.equal((await fetch(rotation+'/api/batch',{headers:{origin:manager}})).status,403);
  const batchData = await (await fetch(rotation+'/api/batch')).json();
  assert.deepEqual(batchData.operations,[]);assert.equal(batchData.setupRequired,true);
  assert.equal((await fetch(rotation+'/api/export',{headers:{origin:manager,'x-batch-token':batchData.token}})).status,403);
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(batch,'batch.json'))).operations,[]);
});
test('failed second bind closes the first origin and never takes over an occupied port', async t => {
  const {root,dist} = fixture(t),port = await freePort(),managerPort = await freePort();
  const occupied = http.createServer();await new Promise(r => occupied.listen(port,'127.0.0.1',r));t.after(() => new Promise(r => occupied.close(r)));
  const batch = path.join(root,'batch');fs.mkdirSync(batch);
  await assert.rejects(startDesk({root:batch,dist,port,managerPort}),/EADDRINUSE/);
  const replacement = http.createServer();await new Promise((resolve,reject) => {replacement.once('error',reject);replacement.listen(managerPort,'127.0.0.1',resolve);});
  await new Promise(r => replacement.close(r));
});
