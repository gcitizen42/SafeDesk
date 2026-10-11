#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import {createInterface} from 'node:readline/promises';
import {BatchStore} from './core.mjs';
import {createServer} from './server.mjs';
import {TenderlyRunner} from './tenderly.mjs';
import {SafeWorkflow,ChainCatalog} from './workflow.mjs';
import {publicSettings} from './settings.mjs';
const args=process.argv.slice(2),command=args[0];
const value=(name,fallback)=>{const i=args.indexOf(name);return i>=0?args[i+1]:fallback;};
const currentBatch=path.join(import.meta.dirname,'../../operations/2026-10-09-outstanding-rotations');
const root=path.resolve(value('--root',fs.existsSync(path.join(currentBatch,'batch.json'))?currentBatch:path.join(import.meta.dirname,'../../operations/batch')));
const store=new BatchStore(root);
const workflow=new SafeWorkflow(store);
const load=file=>JSON.parse(fs.readFileSync(file,'utf8'));
const print=obj=>console.log(JSON.stringify(obj,null,2));
async function ask(prompt){const rl=createInterface({input:process.stdin,output:process.stdout});try{return(await rl.question(prompt)).trim();}finally{rl.close();}}
async function main(){
 switch(command){
  case 'init':{fs.writeFileSync(path.join(root,'batch.json'),JSON.stringify({version:1,operations:[]},null,2),{flag:'wx'});console.log('Empty batch created:',root);return;}
  case 'serve':{const port=Number(value('--port',8770));const server=createServer(root,{store,port});server.listen(port,'127.0.0.1',()=>console.log(`SafeDesk: http://127.0.0.1:${port}/`));return;}
  case 'chains':print(await new ChainCatalog().get());return;
  case 'configure':{const file=value('--file');if(!file){print(publicSettings(root));return;}print(await workflow.configure(load(file)));return;}
  case 'inspect':{const file=value('--file');if(!file)throw Error('inspect requires --file safe-input.json (chainId, safe, optional rpcUrl)');print(await workflow.inspect(load(file)));return;}
  case 'prepare':{const file=value('--file');if(!file)throw Error('prepare requires --file rotation-input.json');const input=load(file);input.snapshot=await workflow.inspect(input);print({id:input.id,current:input.snapshot,finalOwners:input.newOwners,threshold:input.threshold});if(await ask('Prepare this exact final owner list and threshold? Type PREPARE: ')!=='PREPARE'){console.log('Cancelled');return;}print(await workflow.prepare(input));return;}
  case 'status':{print(await workflow.transactionStatus(args[1],{account:value('--account'),walletChainId:value('--wallet-chain')}));return;}
  case 'list':console.table(store.list().map(o=>({id:o.id,chain:o.chain,nonce:o.nonce,draft:o.draft,simulation:!!o.simulation,signatures:o.signatures.length,status:o.result?.status||'prepared'})));return;
  case 'check':{const ids=args[1]==='all'?store.ids():[args[1]];for(const id of ids){try{print({id,...await store.check(id)});}catch(e){print({id,error:e.message});process.exitCode=1;}}return;}
  case 'collect':{const file=value('--file'),input=file?load(file):{sender:await ask('Current owner address: '),signature:await ask('Paste 65-byte signature: ')};print(await store.collect(args[1],input.sender,input.signature));return;}
  case 'attach-simulation':{const file=value('--file');print(store.attach(args[1],value('--url',''),file?load(file):null));return;}
  case 'add':{const file=value('--file');if(!file)throw Error('add requires --file signing-data.json');print(await store.add(args[1],load(file)));return;}
  case 'export':{const out=value('--out');if(!out)throw Error('export requires --out; signatures will not be printed');if(fs.existsSync(out))throw Error('Export path already exists');fs.writeFileSync(out,JSON.stringify(store.export(),null,2),{mode:0o600});console.log('Exported:',path.resolve(out));return;}
  case 'import':{if(!args[1])throw Error('import requires collection file');print(await store.importSignatures(load(args[1])));return;}
  case 'review':case 'propose':{const ids=(value('--ids')||store.list().filter(o=>o.signatures.length&&!o.draft).map(o=>o.id).join(',')).split(',').filter(Boolean);print(await store.review(ids));if(command==='review')return;if(await ask('Publish these signatures to the Safe services? Type PROPOSE: ')!=='PROPOSE'){console.log('Cancelled');return;}print(await store.propose(ids));return;}
  case 'simulate':{const runner=new TenderlyRunner(store),plan=await runner.plan(args[1],{publicExplorer:args.includes('--public-explorer')});print(plan);console.log('Creates ONE Tenderly environment; consumes account resources. No mainnet transaction or real signature is sent.');if(plan.publicExplorer)console.log('Public explorer will expose simulated addresses and calldata.');if(await ask('Create and run this virtual simulation? Type SIMULATE: ')!=='SIMULATE'){console.log('Cancelled');return;}print(await runner.run(plan,{confirm:'SIMULATE'}));return;}
  default:console.log(`SafeDesk commands (batch remains a compatibility alias):
  npm start
  npm run safedesk -- chains
  npm run safedesk -- configure --file private-settings.json
  npm run safedesk -- inspect --file safe-input.json
  npm run safedesk -- prepare --file rotation-input.json
  npm run safedesk -- status ID --account 0x... --wallet-chain CHAIN_ID
  npm run batch -- serve
  npm run batch -- init --root /path/to/new-batch
  npm run batch -- list
  npm run batch -- check all
  npm run batch -- collect bob-3e61
  npm run batch -- attach-simulation bob-3e61 --url https://dashboard.tenderly.co/... --file result.json
  npm run batch -- add my-safe --file signing-data.json
  npm run batch -- simulate bob-3e61
  npm run batch -- export --out collection.json
  npm run batch -- import collection.json
  npm run batch -- review --ids bob-3e61,bob-694d,bob-3266
  npm run batch -- propose --ids bob-3e61,bob-694d,bob-3266

All commands accept --root /path/to/prepared-batch.
collect accepts --file signature.json with sender and signature fields.
No private key is required. Ledger signing is performed in the browser or your external signer.`);
 }
}
const mutating=new Set(['init','configure','prepare','collect','attach-simulation','add','import','propose','simulate']);
(mutating.has(command)?store.withLock(main):main()).catch(e=>{console.error(e.message);process.exitCode=1;});
