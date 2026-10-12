import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import {createManagerServer,validPort} from './manager-server.mjs';
import {startDesk} from './start.mjs';
import {recordBuild,verifyBuild} from './build-integrity.mjs';

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
test('only valid localhost ports can be selected', () => {
  for(const p of [0,65536,-1,1.5,'junk'])assert.throws(() => validPort(p));
  assert.equal(validPort('8772'),8772);
});
test('management serves only built assets, rejects other origins and keeps wallet actions off', async t => {
  const {root,dist} = fixture(t),port = await freePort(),rotationPort = await freePort();
  let catalogueReads=0;const catalogue={source:'built-in',fetchedAt:new Date().toISOString(),chains:[{chainId:1,name:'Ethereum',rpcs:['https://ethereum.publicnode.com'],rotationSupported:true}]};
  const server = createManagerServer({dist,port,catalog:{get:async()=>{catalogueReads++;return catalogue;}}});
  await new Promise(r => server.listen(port,'127.0.0.1',r));t.after(() => new Promise(r => server.close(r)));
  const base = `http://127.0.0.1:${port}`;
  const res = await fetch(base),html = await res.text();
  assert.match(html,/safedesk-wallet-actions" content="disabled/);assert.equal(html.includes('safedesk-rotation-origin'),false);
  assert.match(res.headers.get('content-security-policy'),/frame-ancestors 'none'/);
  assert.equal(res.headers.get('access-control-allow-origin'),null);
  assert.equal((await fetch(base+'/assets/boot-123.js')).status,200);
  for(const p of ['/api/batch','/api/export','/secrets/batch-state.json','/secret.env','/assets/%2e%2e%2fsecret.env','/src/main.tsx'])assert.equal((await fetch(base+p)).status,404);
  assert.equal((await fetch(base,{headers:{origin:`http://127.0.0.1:${rotationPort}`}})).status,403);
  const badHost = await new Promise((resolve,reject) => {const req = http.get(base,{headers:{host:'evil.example'}},res => {res.resume();resolve(res.statusCode);});req.on('error',reject);});
  assert.equal(badHost,403);
  assert.equal((await fetch(base,{method:'POST'})).status,405);
  if(process.platform!=='win32'){
    fs.symlinkSync(path.join(root,'secret.env'),path.join(dist,'assets','escape.js'));
    assert.equal((await fetch(base+'/assets/escape.js')).status,404);
  }
  assert.equal((await (await fetch(base+'/.well-known/safedesk-manager')).json()).walletActions,false);
  const publicCatalogue=await fetch(base+'/api/chains');assert.equal(publicCatalogue.status,200);assert.deepEqual(await publicCatalogue.json(),catalogue);assert.equal(catalogueReads,1);assert.equal(publicCatalogue.headers.get('access-control-allow-origin'),null);
  assert.equal((await fetch(base+'/api/chains',{headers:{origin:`http://127.0.0.1:${rotationPort}`}})).status,403);assert.equal(catalogueReads,1);
});
test('one origin serves management and namespaced guarded rotations without collecting signatures', async t => {
  const {root,dist} = fixture(t),port = await freePort();recordBuild(dist,{sourceRoot:root});
  const batch = path.join(root,'batch');fs.mkdirSync(batch);
  const desk = await startDesk({root:batch,dist,port,walletActions:true});t.after(desk.close);
  const manager = `http://127.0.0.1:${port}`;
  assert.match(await (await fetch(manager)).text(),/safedesk-wallet-actions" content="enabled/);
  const res=await fetch(manager+'/api/rotations/batch');assert.equal(res.status,200);assert.equal(res.headers.get('access-control-allow-origin'),null);assert.match(res.headers.get('content-security-policy'),/frame-ancestors 'none'/);
  const batchData = await res.json();
  assert.deepEqual(batchData.operations,[]);assert.equal(batchData.setupRequired,true);
  assert.equal((await fetch(manager+'/api/rotations/export')).status,403);
  assert.equal((await fetch(manager+'/api/rotations/export',{headers:{origin:'https://evil.example','x-batch-token':batchData.token}})).status,403);
  assert.equal((await fetch(manager+'/api/rotations/export',{headers:{origin:manager,'x-batch-token':batchData.token}})).status,200);
  assert.equal((await fetch(manager+'/api/batch')).status,404);
  assert.equal((await fetch(manager+'/api/rotations/settings',{method:'POST',headers:{'content-type':'application/json'},body:'{}'})).status,403);
  assert.equal((await fetch(manager+'/api/rotations/propose',{method:'POST',headers:{'content-type':'application/json','x-batch-token':batchData.token},body:'{}'})).status,400);
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(batch,'batch.json'))).operations,[]);
});
test('single-port startup never takes over an occupied port', async t => {
  const {root,dist} = fixture(t),port = await freePort();recordBuild(dist,{sourceRoot:root});
  const occupied = http.createServer();await new Promise(r => occupied.listen(port,'127.0.0.1',r));t.after(() => new Promise(r => occupied.close(r)));
  const batch = path.join(root,'batch');fs.mkdirSync(batch);
  await assert.rejects(startDesk({root:batch,dist,port}),/EADDRINUSE/);
});
test('server refuses assets changed after verified startup',async t=>{
  const{root,dist}=fixture(t),port=await freePort();recordBuild(dist,{sourceRoot:root});
  const server=createManagerServer({dist,port,integrity:verifyBuild(dist,{sourceRoot:root})});await new Promise(r=>server.listen(port,'127.0.0.1',r));t.after(()=>new Promise(r=>server.close(r)));
  const base=`http://127.0.0.1:${port}`;assert.equal((await fetch(base+'/assets/boot-123.js')).status,200);
  fs.writeFileSync(path.join(dist,'assets/boot-123.js'),'changed');assert.equal((await fetch(base+'/assets/boot-123.js')).status,503);
});
