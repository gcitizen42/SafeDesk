#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {parseEnv} from 'node:util';

const root=path.resolve(import.meta.dirname,'../..');
const git=(...args)=>execFileSync('git',args,{cwd:root,maxBuffer:64*1024*1024});
const forbidden=/(^|\/)(operations|secrets|node_modules|dist|coverage)(\/|$)|(^|\/)\.env(?!\.example$)|\.(pem|p12|pfx|key|signature\.json)$/i;
const keyedRpc=/https?:\/\/rpc\.ankr\.com\/[^\s"'<>]*[a-f0-9]{32}/i;
const fingerprints=new Set();
for(const name of ['project.env','../Tenderly_simulations.env','operations/2026-10-09-outstanding-rotations/secrets/safedesk.env']){
 const file=path.resolve(root,name);if(!fs.existsSync(file))continue;
 for(const[key,value]of Object.entries(parseEnv(fs.readFileSync(file,'utf8')))){
  if(/KEY|TOKEN|SECRET|PASSWORD/i.test(key)&&value.length>12)fingerprints.add(value);
  if(/RPC/i.test(key)&&/([a-f0-9]{32}|[?&](key|token|apikey)=)/i.test(value))fingerprints.add(value);
 }
}
const state=path.join(root,'operations/2026-10-09-outstanding-rotations/secrets/batch-state.json');
function signatures(v){if(typeof v==='string'&&/^0x[0-9a-f]{130}$/i.test(v))fingerprints.add(v);else if(v&&typeof v==='object')Object.values(v).forEach(signatures);}
if(fs.existsSync(state))signatures(JSON.parse(fs.readFileSync(state,'utf8')));
const verify=(name,content)=>{if(forbidden.test(name))throw Error(`Private/generated file is tracked: ${name}`);const text=content.toString();if(keyedRpc.test(text)||[...fingerprints].some(value=>text.includes(value)))throw Error(`Sensitive value detected in: ${name}`);};
try{
 const files=git('ls-files','-z').toString().split('\0').filter(Boolean);
 for(const name of files)verify(name,git('show',`:${name}`));
 let blobs=0;
 if(process.argv.includes('--history')){
  const seen=new Set();for(const entry of git('rev-list','--objects','--all').toString().trim().split('\n')){
   const split=entry.indexOf(' ');if(split<0)continue;const sha=entry.slice(0,split),name=entry.slice(split+1);if(seen.has(sha))continue;seen.add(sha);
   if(git('cat-file','-t',sha).toString().trim()!=='blob')continue;
   verify(name,git('cat-file','blob',sha));blobs++;
  }
 }
 console.log(`Public-source check passed: ${files.length} tracked files${blobs?`, ${blobs} historical blobs`:''}. No known private values found.`);
}catch(error){console.error(error.message);process.exitCode=1;}
