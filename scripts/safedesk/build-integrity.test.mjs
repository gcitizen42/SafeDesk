import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {recordBuild,verifyBuild} from './build-integrity.mjs';

function fixture(t){const root=fs.mkdtempSync(path.join(os.tmpdir(),'safedesk-integrity-'));fs.mkdirSync(path.join(root,'dist/assets'),{recursive:true});fs.writeFileSync(path.join(root,'dist/index.html'),'<html>SafeDesk</html>');fs.writeFileSync(path.join(root,'dist/assets/app.js'),'export const ready=true;');t.after(()=>fs.rmSync(root,{recursive:true,force:true}));return{root,dist:path.join(root,'dist')};}
test('build fingerprint covers every served file without storing source contents',t=>{const{root,dist}=fixture(t);recordBuild(dist,{sourceRoot:root});const result=verifyBuild(dist,{sourceRoot:root});assert.equal(result.summary.algorithm,'SHA-256');assert.equal(result.summary.fileCount,2);assert.equal(result.summary.sourceChecked,false);assert.ok(result.matches('index.html',fs.readFileSync(path.join(dist,'index.html'))));assert.equal(result.matches('assets/app.js',Buffer.from('changed')),false);assert.equal(result.matches('unknown.js',Buffer.from('')),false);});
test('missing, changed and extra build files block startup',t=>{const{root,dist}=fixture(t);assert.throws(()=>verifyBuild(dist,{sourceRoot:root}),/missing/);recordBuild(dist,{sourceRoot:root});fs.writeFileSync(path.join(dist,'assets/extra.js'),'unexpected');assert.throws(()=>verifyBuild(dist,{sourceRoot:root}),/mismatch/);fs.rmSync(path.join(dist,'assets/extra.js'));fs.writeFileSync(path.join(dist,'index.html'),'changed');assert.throws(()=>verifyBuild(dist,{sourceRoot:root}),/mismatch/);});
test('symlinked build files are never fingerprinted',t=>{if(process.platform==='win32')return;const{root,dist}=fixture(t);fs.writeFileSync(path.join(root,'private.txt'),'not served');fs.symlinkSync(path.join(root,'private.txt'),path.join(dist,'assets/linked.js'));assert.throws(()=>recordBuild(dist,{sourceRoot:root}),/symlink/);});
