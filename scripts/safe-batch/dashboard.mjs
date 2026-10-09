import {ethers} from '/ethers.js';
let token,operations=[],chains={},tenderly={},simulationToken=null,simulationId=null,selectedId=null,account=null,reviewToken=null,busy=false;
const selected=new Set(),checks=new Map();
const $=selector=>document.querySelector(selector);
const icons=()=>window.lucide?.createIcons();
const text=(tag,value,cls)=>{const e=document.createElement(tag);e.textContent=value;if(cls)e.className=cls;return e;};
const short=a=>a.slice(0,8)+'...'+a.slice(-6);
function status(message,error=false){$('#status').textContent=message;$('#status').className=error?'error':'';}
async function api(route,data){const r=await fetch('/api/'+route,data===undefined?{headers:token?{'x-batch-token':token}:{}}:{method:'POST',headers:{'content-type':'application/json','x-batch-token':token},body:JSON.stringify(data)});const j=await r.json();if(!r.ok)throw Error(j.error||'Request failed');return j;}
async function perform(fn){if(busy)return;busy=true;render();try{await fn();}catch(e){status(e.message,true);}finally{busy=false;render();}}
async function load(){const b=await api('batch');token=b.token;operations=b.operations;chains=b.chains;tenderly=b.tenderly;if(!selectedId||!operations.some(x=>x.id===selectedId))selectedId=operations[0]?.id;render();}
function button(label,icon,fn,disabled=false){const b=text('button',label);if(icon){const i=document.createElement('i');i.dataset.lucide=icon;b.prepend(i);}b.disabled=disabled||busy;b.onclick=()=>perform(fn);return b;}
const op=()=>operations.find(x=>x.id===selectedId);
function render(){
 $('#batchCount').textContent=operations.length+' operations';$('#selectedCount').textContent=selected.size?'('+selected.size+')':'';$('#review').disabled=busy||!selected.size;
 const list=$('#operations');list.replaceChildren();
 for(const item of operations){const row=document.createElement('div');row.className='operation'+(item.id===selectedId?' active':'');const check=document.createElement('input');check.type='checkbox';check.setAttribute('aria-label','Select '+item.id);check.checked=selected.has(item.id);check.disabled=busy||item.draft||!item.simulation||!item.signatures.length;check.onchange=()=>{check.checked?selected.add(item.id):selected.delete(item.id);render();};const detail=document.createElement('div');detail.append(text('strong',item.id),text('small',item.chain+' · '+short(item.safe)));const tag=text('span',item.result?.status==='proposed'?'Proposed':item.draft?'Draft':item.signatures.length?item.signatures.length+' collected':item.simulation?'Ready to sign':'Simulation needed','tag '+(item.draft?'pending':item.simulation?'good':''));detail.append(tag);row.append(check,detail);detail.onclick=()=>{selectedId=item.id;render();};list.append(row);}
 const item=op(),detail=$('#detail');detail.replaceChildren();if(!item)return;
 const head=document.createElement('div');head.className='detail-head';const heading=document.createElement('div');heading.append(text('h2',item.id),text('address',item.safe));head.append(heading,button('Check current state','refresh-cw',async()=>{status('Checking owners, nonce and pending proposals...');const j=await api('check',{id:item.id});checks.set(item.id,j.result);status('Current owners, nonce and hash match.');},false));detail.append(head);
 const facts=document.createElement('dl');facts.className='facts';for(const [name,value]of[['Network',item.chain+' · '+item.chainId],['Nonce',item.nonce],['Current approvals',item.currentThreshold+' / '+item.owners.length],['Proposed approvals',item.proposedThreshold===null?'See payload':item.proposedThreshold+' / '+(item.newOwners?.length||'?')]]){const wrap=document.createElement('div');wrap.className='fact';wrap.append(text('dt',name),text('dd',value));facts.append(wrap);}detail.append(facts);
 const hashSection=document.createElement('section');hashSection.className='section';const top=document.createElement('div');top.className='section-top';top.append(text('span','Safe transaction hash','section-label'),button('Copy','copy',()=>navigator.clipboard.writeText(item.hash)));hashSection.append(top,text('div',item.hash,'hash'));detail.append(hashSection);
 const sim=document.createElement('section');sim.className='section';const simtop=document.createElement('div');simtop.className='section-top';
 const simActions=document.createElement('div');simActions.className='tools';
 simActions.append(button('Simulate on Tenderly','flask-conical',async()=>{simulationId=item.id;$('#publicExplorer').checked=false;await prepareTenderly(false);$('#tenderlyDialog').showModal();},!tenderly.configured||!tenderly.enabled),button('Attach result','link',()=>{$('#simulationForm').reset();$('#simulationForm').elements.url.value=item.simulationUrl||'';$('#simulationNote').textContent='A link is a reference. Import the execution JSON to match the payload and Safe transaction hash.';$('#simulationDialog').showModal();}));
 simtop.append(text('span','Simulation','section-label'),simActions);sim.append(simtop,text('div',item.simulation?item.simulation.source+' · exact hash matched':'No matching successful result'));if(item.simulation?.assumptions)sim.append(text('p',item.simulation.assumptions,'note'));
 if(!tenderly.configured)sim.append(text('p','Tenderly credentials not configured','note'));else if(!tenderly.enabled)sim.append(text('p','Tenderly disabled by project safety policy','note'));
 if(item.tenderlyJob)sim.append(text('p',item.tenderlyJob.status+' · '+item.tenderlyJob.stage+(item.tenderlyJob.message?' · '+item.tenderlyJob.message:''),'note'));
 const simulationUrl=item.tenderlyJob?.url||item.simulationUrl;if(simulationUrl){const a=text('a','Open Tenderly');a.href=simulationUrl;a.target='_blank';a.rel='noopener noreferrer';sim.append(a);}detail.append(sim);
 const owners=document.createElement('section');owners.className='section owner-grid';for(const [title,addresses]of[['Current owners',item.owners],['Proposed owners',item.newOwners||[]]]){const column=document.createElement('div');column.append(text('h3',title));for(const a of addresses)column.append(text('div',a,'owner'));if(!addresses.length)column.append(text('p','See transaction payload','note'));owners.append(column);}detail.append(owners);
 const signatures=document.createElement('section');signatures.className='section';signatures.append(text('span','Collected signatures','section-label'));for(const sig of item.signatures)signatures.append(text('p',sig.sender+' · '+sig.mode,'signers'));if(!item.signatures.length)signatures.append(text('p','No signature collected','note'));if(item.draft)signatures.append(text('p','Threshold decision outstanding','note'));
 const owner=account&&item.owners.some(a=>a.toLowerCase()===account.toLowerCase());if(account&&!owner)signatures.append(text('p','The connected account is not a current owner. An existing owner must sign this operation.','note'));
 const actions=document.createElement('div');actions.className='sign-actions';actions.append(button('Sign and collect','pen-line',()=>sign(item,false),!owner||item.draft||!item.simulation),button('Ledger hash signing','usb',()=>sign(item,true),!owner||item.draft||!item.simulation),button('Paste signature','clipboard',()=>{$('#pasteForm').reset();$('#pasteForm').elements.sender.value=account||'';$('#pasteDialog').showModal();},item.draft||!item.simulation),button('Next Safe','arrow-right',()=>{selectedId=operations[(operations.findIndex(x=>x.id===item.id)+1)%operations.length].id;render();}));signatures.append(actions);detail.append(signatures);
 const payload=document.createElement('details');payload.append(text('summary','Transaction payload'));payload.append(text('pre',JSON.stringify(item.signing.message,null,2),'payload'));detail.append(payload);
 if(item.result){detail.append(text('p',item.result.status==='proposed'?'Proposal published':item.result.message,'note'));if(item.result.safeUrl){const a=text('a','Open Safe queue');a.href=item.result.safeUrl;a.target='_blank';a.rel='noopener noreferrer';detail.append(a);}}
 icons();
}
async function sign(item,fallback){
 const checked=await api('check',{id:item.id});if(!checked.result.owners.some(a=>a.toLowerCase()===account.toLowerCase()))throw Error('Connected account is not a current owner');
 const target='0x'+item.chainId.toString(16);if((await window.ethereum.request({method:'eth_chainId'})).toLowerCase()!==target){
  try{await window.ethereum.request({method:'wallet_switchEthereumChain',params:[{chainId:target}]});}catch(e){
   if(e.code!==4902)throw e;const chain=chains[item.chainId];
   await window.ethereum.request({method:'wallet_addEthereumChain',params:[{chainId:target,chainName:chain.name,nativeCurrency:{name:item.chainId===137?'POL':'Ether',symbol:item.chainId===137?'POL':'ETH',decimals:18},rpcUrls:[chain.rpc],blockExplorerUrls:[chain.explorer]}]});
  }
 }
 if((await window.ethereum.request({method:'eth_chainId'})).toLowerCase()!==target)throw Error('Select the correct wallet network before signing');
 const accounts=await window.ethereum.request({method:'eth_accounts'});if(accounts[0]?.toLowerCase()!==account.toLowerCase())throw Error('Wallet account changed; reconnect');
 const computed=ethers.TypedDataEncoder.hash(item.signing.domain,item.signing.types,item.signing.message);if(computed!==item.hash)throw Error('Hash mismatch');
 status('Confirm '+item.id+' on your Ledger...');
 const payload=ethers.TypedDataEncoder.getPayload(item.signing.domain,item.signing.types,item.signing.message);
 const raw=await window.ethereum.request(fallback?{method:'personal_sign',params:[item.hash,account]}:{method:'eth_signTypedData_v4',params:[account,JSON.stringify(payload)]});
 await api('collect',{id:item.id,sender:account,signature:raw});selected.add(item.id);await load();status('Signature verified and collected for '+item.id+'.');
}
$('#connect').onclick=()=>perform(async()=>{if(!window.ethereum)throw Error('Open this URL in Chrome or Brave with MetaMask and your Ledger account.');[account]=await window.ethereum.request({method:'eth_requestAccounts'});$('#connect').querySelector('span').textContent=short(account);render();status('Wallet connected.');});
window.ethereum?.on?.('accountsChanged',accounts=>{account=accounts[0]||null;$('#connect').querySelector('span').textContent=account?short(account):'Connect Ledger wallet';render();});
$('#refresh').onclick=()=>perform(async()=>{await load();status('Batch reloaded.');});
$('#add').onclick=()=>{$('#addForm').reset();$('#addDialog').showModal();};
$('#addForm').onsubmit=e=>{e.preventDefault();perform(async()=>{const f=e.target;await api('add',{id:f.elements.id.value,signing:JSON.parse(await f.elements.file.files[0].text())});$('#addDialog').close();selectedId=f.elements.id.value;await load();status('Prepared transaction added.');});};
$('#simulationForm').onsubmit=e=>{e.preventDefault();perform(async()=>{const f=e.target,file=f.elements.file.files[0];await api('simulation',{id:selectedId,url:f.elements.url.value,document:file?JSON.parse(await file.text()):null});$('#simulationDialog').close();await load();status(file?'Simulation matched to the prepared transaction.':'Simulation link attached.');});};
$('#pasteForm').onsubmit=e=>{e.preventDefault();perform(async()=>{const f=e.target;await api('collect',{id:selectedId,sender:f.elements.sender.value.trim(),signature:f.elements.signature.value.trim()});selected.add(selectedId);f.elements.signature.value='';$('#pasteDialog').close();await load();status('Signature verified and collected.');});};
$('#export').onclick=()=>perform(async()=>{const collection=await api('export'),blob=new Blob([JSON.stringify(collection,null,2)],{type:'application/json'}),a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download='safe-signature-collection.json';a.click();URL.revokeObjectURL(a.href);status('Collection exported.');});
$('#import').onclick=()=>$('#collectionFile').click();$('#collectionFile').onchange=e=>perform(async()=>{await api('import',{collection:JSON.parse(await e.target.files[0].text())});await load();status('Collection imported and signatures checked.');});
$('#review').onclick=()=>perform(async()=>{status('Checking selected proposals...');const data=await api('review',{ids:[...selected]});reviewToken=data.result.reviewToken;const list=$('#reviewList');list.replaceChildren();for(const item of data.result.items){const row=document.createElement('div');row.className='review-item';row.append(text('strong',item.id+' · '+item.chain),text('code',item.safe),text('code',item.hash),text('p','Nonce '+item.nonce+' · '+item.signatures+' collected / '+item.threshold+' required for execution','note'));list.append(row);}$('#reviewDialog').showModal();status('Selected proposals checked.');});
$('#propose').onclick=()=>perform(async()=>{status('Publishing selected proposals...');const result=await api('propose',{reviewToken,confirm:'PROPOSE'});$('#reviewDialog').close();await load();status(result.result.map(x=>x.id+': '+x.status+(x.message?' ('+x.message+')':'')).join(' · '));});
document.querySelectorAll('[data-close]').forEach(b=>b.onclick=()=>b.closest('dialog').close());
async function prepareTenderly(publicExplorer){
 simulationToken=null;$('#runTenderly').disabled=true;
 status('Checking Tenderly support and capacity...');const data=await api('tenderly-plan',{id:simulationId,publicExplorer});simulationToken=data.result.simulationToken;$('#runTenderly').disabled=false;
 const p=data.result.plan,list=$('#tenderlyPlan');list.replaceChildren();list.append(text('strong',p.id+' · '+p.chain),text('p',p.safe,'signers'),text('code',p.hash,'hash'),text('p','Nonce '+p.nonce+' · '+p.threshold+' assumed approvals · fork block '+p.block,'note'),text('p','Environments '+p.environmentCount+'/'+p.environmentLimit+' · daily attempts '+p.runsToday+'/'+p.dailyLimit,'note'));if(p.draft)list.append(text('p','Draft: simulation does not approve the threshold decision.','note'));status('Simulation plan ready; no environment created.');
}
$('#publicExplorer').onchange=e=>perform(()=>prepareTenderly(e.target.checked));
$('#runTenderly').onclick=()=>perform(async()=>{
 const runButton=$('#runTenderly');runButton.disabled=true;status('Tenderly simulation running...');let polling=false,active=true;
 const timer=setInterval(async()=>{if(polling)return;polling=true;try{const data=await api('tenderly-progress?id='+encodeURIComponent(simulationId));if(active&&data.job?.status==='RUNNING')status(data.job.stage);}catch{}finally{polling=false;}},1500);
 try{await api('tenderly-run',{simulationToken,confirm:'SIMULATE'});status('Tenderly passed: exact Safe execution and final state matched.');}
 finally{active=false;clearInterval(timer);simulationToken=null;runButton.disabled=true;$('#tenderlyDialog').close();await load();}
});
load().then(()=>status('Prepared operations loaded.')).catch(e=>status(e.message,true));
