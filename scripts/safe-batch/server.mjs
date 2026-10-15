import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import {randomBytes} from 'node:crypto';
import {BatchStore,CHAINS} from './core.mjs';
import {TenderlyRunner} from './tenderly.mjs';
import {ChainCatalog,SafeWorkflow} from './workflow.mjs';
import {publicSettings} from './settings.mjs';
const here=import.meta.dirname,project=path.resolve(here,'../..');
export const createServer=(root,options={})=>http.createServer(createBatchHandler(root,options));
export function createBatchHandler(root,{store=new BatchStore(root),port=8770,managerPort=8772,runner=new TenderlyRunner(store),workflow=new SafeWorkflow(store),catalog=new ChainCatalog(),prefix=''}={}){
 if(!Number.isInteger(Number(managerPort))||Number(managerPort)<1||Number(managerPort)>65535)throw Error('Invalid manager port');
 store.init();
 const token=randomBytes(32).toString('hex'),reviews=new Map(),simulationPlans=new Map();let busy=false;
 const origins=new Set([`http://127.0.0.1:${port}`,`http://localhost:${port}`]);
 if(!['','/api/rotations'].includes(prefix))throw Error('Invalid batch route prefix');
 const publicFiles={'/':'dashboard.html','/dashboard.html':'dashboard.html','/dashboard.mjs':'dashboard.mjs','/dashboard-standalone.mjs':'dashboard-standalone.mjs','/workspace.mjs':'workspace.mjs','/dashboard.css':'dashboard.css'};
 const send=(res,status,obj)=>{res.writeHead(status,{'content-type':'application/json','cache-control':'no-store','x-content-type-options':'nosniff'});res.end(JSON.stringify(obj));};
 return async(req,res)=>{
  if(!origins.has(`http://${req.headers.host}`))return send(res,403,{error:'Unexpected host'});
  if(req.headers.origin&&!origins.has(req.headers.origin))return send(res,403,{error:'Unexpected origin'});
  const url=new URL(req.url,'http://localhost');
  if(prefix){
   if(!url.pathname.startsWith(prefix+'/'))return send(res,404,{error:'Not found'});
   url.pathname='/api/'+url.pathname.slice(prefix.length+1);
  }
  try{
   if(req.method==='GET'&&url.pathname==='/api/batch')return send(res,200,{token,operations:store.list(),chains:CHAINS,tenderly:runner.status(),settings:publicSettings(root),setupRequired:store.ids().length===0});
   if(req.method==='GET'&&url.pathname==='/api/chains'){
    if(req.headers['x-batch-token']!==token)return send(res,403,{error:'Session token required'});
    return send(res,200,await catalog.get());
   }
   if(req.method==='GET'&&url.pathname==='/api/tenderly-progress'){
    if(req.headers['x-batch-token']!==token)return send(res,403,{error:'Session token required'});
    store.operation(url.searchParams.get('id'));store.refresh();return send(res,200,{job:store.state.tenderlyJobs?.[url.searchParams.get('id')]||null});
   }
   if(req.method==='GET'&&url.pathname==='/api/export'){
    if(req.headers['x-batch-token']!==token)return send(res,403,{error:'Session token required'});
    return send(res,200,store.export());
   }
   if(url.pathname.startsWith('/api/')){
    if(req.method!=='POST'||req.headers['x-batch-token']!==token||!String(req.headers['content-type']).startsWith('application/json'))return send(res,403,{error:'Session token required'});
    if(busy)return send(res,409,{error:'Another operation is in progress'});
    busy=true;
    try{
     let body='';for await(const chunk of req){body+=chunk;if(Buffer.byteLength(body)>2*1024*1024)throw Error('Request too large');}const input=JSON.parse(body);
     let result=await store.withLock(async()=>{
     let result;
     switch(url.pathname){
      case '/api/check':result=await store.check(input.id,{ready:input.ready===true});break;
      case '/api/settings':result=await workflow.configure(input);break;
      case '/api/rpc-check':{const c=await workflow.context(input.chainId,input.rpcUrl);result={chainId:c.chainId,verified:true};break;}
      case '/api/inspect':result=await workflow.inspect(input);break;
      case '/api/prepare':if(input.confirm!=='PREPARE')throw Error('Review the complete final owner list and threshold first');result=await workflow.prepare(input);break;
      case '/api/transaction-status':result=await workflow.transactionStatus(input.id,{account:input.account,walletChainId:input.walletChainId});break;
      case '/api/collect':result=await store.collect(input.id,input.sender,input.signature,input.method);break;
      case '/api/simulation':result=store.attach(input.id,input.url,input.document);break;
      case '/api/add':result=await store.add(input.id,input.signing);break;
      case '/api/import':result=await store.importSignatures(input.collection);break;
      case '/api/tenderly-plan':{const plan=await runner.plan(input.id,{publicExplorer:input.publicExplorer===true}),simulationToken=randomBytes(24).toString('hex');simulationPlans.set(simulationToken,{plan,expires:Date.now()+10*60*1000});result={plan,simulationToken};break;}
      case '/api/tenderly-run':{const prepared=simulationPlans.get(input.simulationToken);if(!prepared||prepared.expires<Date.now()||input.confirm!=='SIMULATE')throw Error('Review and confirm one Tenderly simulation first');simulationPlans.delete(input.simulationToken);result=await runner.run(prepared.plan,{confirm:input.confirm});break;}
      case '/api/review':{const items=await store.review(input.ids),reviewToken=randomBytes(24).toString('hex');reviews.set(reviewToken,{items,ids:input.ids,expires:Date.now()+10*60*1000});result={items,reviewToken};break;}
      case '/api/propose':{const review=reviews.get(input.reviewToken);if(!review||review.expires<Date.now()||input.confirm!=='PROPOSE')throw Error('Review the selected proposals first');const now=await store.review(review.ids);if(JSON.stringify(now)!==JSON.stringify(review.items))throw Error('Review changed; review again');reviews.delete(input.reviewToken);result=await store.propose(review.ids,{confirm:input.confirm,reviewed:review.items});break;}
      default:throw Error('Unknown action');
     }
     return result;
     });
     return send(res,200,{result});
    }finally{busy=false;}
   }
   if(req.method!=='GET')return send(res,405,{error:'Method not allowed'});
   let file=publicFiles[url.pathname]?path.join(here,publicFiles[url.pathname]):null;
   if(url.pathname==='/ethers.js')file=path.join(project,'node_modules/ethers/dist/ethers.min.js');
   if(url.pathname==='/lucide.js')file=path.join(project,'node_modules/lucide/dist/umd/lucide.js');
   if(!file){const match=url.pathname.match(/^\/([a-z0-9-]+)\/(ledger-sign-safe-tx\.html|safe-custom-data-params\.json|current-owners\.json)$/);if(match&&store.ids().includes(match[1]))file=path.join(root,match[1],match[2]);}
   if(!file)return send(res,404,{error:'Not found'});
   const type=file.endsWith('.html')?'text/html; charset=utf-8':file.endsWith('.mjs')||file.endsWith('.js')?'text/javascript':file.endsWith('.css')?'text/css':'application/json';
   const contents=fs.readFileSync(file);const output=publicFiles[url.pathname]==='dashboard.html'?contents.toString().replace('id="managementTab" href="http://127.0.0.1:8772/"',`id="managementTab" href="http://127.0.0.1:${managerPort}/"`):contents;
   res.writeHead(200,{'content-type':type,'cache-control':'no-store','x-content-type-options':'nosniff','referrer-policy':'no-referrer','x-frame-options':'DENY'});res.end(output);
  }catch(e){send(res,400,{error:e.message});}
 };
}
