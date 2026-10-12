import {ethers} from 'ethers';
export function mountRotations(root,{apiBase='/api/rotations/',renderIcons=()=>window.lucide?.createIcons(),onBusy=()=>{}}={}){
let active=true;const abort=new AbortController(),timers=new Set();
let token,operations=[],chains={},tenderly={},settings={},simulationToken=null,simulationId=null,selectedId=null,account=null,reviewToken=null,busy=false;
const selected=new Set(),checks=new Map();
let setupMode=null,setupStep=1,snapshot=null,catalog=null,loadedSafeInput=null;
let networkFilter='all',signingMethod='eip712';
const $=selector=>root.querySelector(selector);
const icons=()=>{if(active)renderIcons(root);};
const text=(tag,value,cls)=>{const e=document.createElement(tag);e.textContent=value;if(cls)e.className=cls;return e;};
const short=a=>a.slice(0,8)+'...'+a.slice(-6);
function status(message,error=false){if(!active)return;$('#status').textContent=message;$('#status').className=error?'error':'';}
function assertActive(){if(!active)throw Error('Rotation workspace closed; no further actions were requested');}
function walletRequest(input){assertActive();if(!window.ethereum)throw Error('Open SafeDesk in a wallet-enabled browser');return window.ethereum.request(input);}
async function api(route,data){assertActive();const r=await fetch(apiBase+route,{signal:abort.signal,...(data===undefined?{headers:token?{'x-batch-token':token}:{}}:{method:'POST',headers:{'content-type':'application/json','x-batch-token':token},body:JSON.stringify(data)})});const j=await r.json();if(!r.ok)throw Error(j.error||'Request failed');assertActive();return j;}
async function perform(fn){if(busy||!active)return;busy=true;onBusy(true);render();try{await fn();}catch(e){status(e.message,true);}finally{busy=false;onBusy(false);render();}}
async function load(){const b=await api('batch');token=b.token;operations=b.operations;chains=b.chains;tenderly=b.tenderly;settings=b.settings;checks.clear();if(!selectedId||!operations.some(x=>x.id===selectedId))selectedId=operations[0]?.id;render();if(b.setupRequired&&!setupMode)await beginSetup('first');}
function button(label,icon,fn,disabled=false){const b=text('button',label);if(icon){const i=document.createElement('i');i.dataset.lucide=icon;b.prepend(i);}b.disabled=disabled||busy;b.onclick=()=>perform(fn);return b;}
const op=()=>operations.find(x=>x.id===selectedId);
const visibleOperations=()=>operations.filter(x=>networkFilter==='all'||x.chainId===Number(networkFilter));
function render(){
 if(!active)return;
 $('#batchCount').textContent=operations.length?operations.length+' operations':'Setup';$('#selectedCount').textContent=selected.size?'('+selected.size+')':'';$('#review').disabled=busy||!selected.size;
 $('#batchToolbar').hidden=!!setupMode;$('#batchWorkspace').hidden=!!setupMode;$('#setup').hidden=!setupMode;
 $('#settings').disabled=busy||!!setupMode;$('#add').disabled=busy;$('#preparedImport').disabled=busy;
 if(setupMode)renderSetup();
 const network=$('#networkFilter');network.replaceChildren(text('option','All networks'));network.options[0].value='all';for(const id of [...new Set(operations.map(x=>x.chainId))]){const option=text('option',chains[id].name);option.value=id;network.append(option);}network.value=networkFilter;network.disabled=busy||!!setupMode;
 const list=$('#operations');list.replaceChildren();
 for(const item of visibleOperations()){const row=document.createElement('div');row.className='operation'+(item.id===selectedId?' active':'');const check=document.createElement('input');check.type='checkbox';check.setAttribute('aria-label','Select '+item.id);check.checked=selected.has(item.id);check.disabled=busy||item.draft||!item.simulation||!item.signatures.length;check.onchange=()=>{check.checked?selected.add(item.id):selected.delete(item.id);render();};const detail=document.createElement('div');detail.append(text('strong',item.id),text('small',item.chain+' · '+short(item.safe)));const tag=text('span',item.result?.status==='proposed'?'Proposed':item.draft?'Draft':item.signatures.length?item.signatures.length+' collected':item.simulation?'Ready to sign':'Simulation needed','tag '+(item.draft?'pending':item.simulation?'good':''));detail.append(tag);row.append(check,detail);detail.onclick=()=>{selectedId=item.id;render();};list.append(row);}
 const item=op(),detail=$('#detail');detail.replaceChildren();if(!item)return;
 const head=document.createElement('div');head.className='detail-head';const heading=document.createElement('div');heading.append(text('h2',item.id),text('address',item.safe));head.append(heading,button('Refresh transaction','refresh-cw',()=>refreshTransaction(item)));detail.append(head);
 const checked=checks.get(item.id),facts=document.createElement('dl');facts.className='facts';for(const [name,value]of[['Network',item.chain+' · '+item.chainId],['Prepared nonce',item.nonce],['Current approvals',(checked?.threshold||item.currentThreshold)+' / '+(checked?.owners||item.owners).length],['Proposed approvals',item.proposedThreshold===null?'See payload':item.proposedThreshold+' / '+(item.newOwners?.length||'?')]]){const wrap=document.createElement('div');wrap.className='fact';wrap.append(text('dt',name),text('dd',value));facts.append(wrap);}detail.append(facts);
 const hashSection=document.createElement('section');hashSection.className='section';const top=document.createElement('div');top.className='section-top';top.append(text('span','Safe transaction hash','section-label'),button('Copy','copy',()=>navigator.clipboard.writeText(item.hash)));hashSection.append(top,text('div',item.hash,'hash'));detail.append(hashSection);
 detail.append(transactionSection(item));
 const sim=document.createElement('section');sim.className='section';const simtop=document.createElement('div');simtop.className='section-top';
 const simActions=document.createElement('div');simActions.className='tools';
 simActions.append(button('Simulate on Tenderly','flask-conical',async()=>{simulationId=item.id;$('#publicExplorer').checked=false;await prepareTenderly(false);$('#tenderlyDialog').showModal();},!tenderly.configured||!tenderly.enabled),button('Attach result','link',()=>{$('#simulationForm').reset();$('#simulationForm').elements.url.value=item.simulationUrl||'';$('#simulationNote').textContent='A link is a reference. Import the execution JSON to match the payload and Safe transaction hash.';$('#simulationDialog').showModal();}));
 simtop.append(text('span','Simulation','section-label'),simActions);sim.append(simtop,text('div',item.simulation?item.simulation.source+' · exact hash matched':'No matching successful result'));if(item.simulation?.assumptions)sim.append(text('p',item.simulation.assumptions,'note'));
 if(!tenderly.configured)sim.append(text('p','Tenderly credentials not configured','note'));else if(!tenderly.enabled)sim.append(text('p','Tenderly disabled by project safety policy','note'));
 if(item.tenderlyJob)sim.append(text('p',item.tenderlyJob.status+' · '+item.tenderlyJob.stage+(item.tenderlyJob.message?' · '+item.tenderlyJob.message:''),'note'));
 const simulationUrl=item.tenderlyJob?.url||item.simulationUrl;if(simulationUrl){const a=text('a','Open Tenderly');a.href=simulationUrl;a.target='_blank';a.rel='noopener noreferrer';sim.append(a);}detail.append(sim);
 const owners=document.createElement('section');owners.className='section owner-grid';for(const [title,addresses]of[['Current owners',checked?.owners||item.owners],['Proposed owners',item.newOwners||[]]]){const column=document.createElement('div');column.append(text('h3',title));for(const a of addresses){const row=text('div',a,'owner');if(title==='Current owners'&&checked?.publishedOwners.some(x=>x.toLowerCase()===a.toLowerCase()))row.append(text('span','Published approval','tag good'));column.append(row);}if(!addresses.length)column.append(text('p','See transaction payload','note'));owners.append(column);}detail.append(owners);
 const signatures=document.createElement('section');signatures.className='section';signatures.append(text('span','Collected signatures','section-label'));for(const sig of item.signatures)signatures.append(text('p',sig.sender+' · '+sig.mode,'signers'));if(!item.signatures.length)signatures.append(text('p','No signature collected','note'));if(item.draft)signatures.append(text('p','Threshold decision outstanding','note'));
 const live=checks.get(item.id),owner=account&&(live?.owners||item.owners).some(a=>a.toLowerCase()===account.toLowerCase());if(account&&!owner)signatures.append(text('p','The connected account is not a current owner. An existing owner must sign this operation.','note'));
 const changed=live&&(!live.unchanged||live.executed||!live.hashMatches||live.conflicts.length||!live.serviceKnown);
 const methodLabel=text('label','Signing method','sign-method'),method=document.createElement('select');method.setAttribute('aria-label','Signing method');for(const [value,label]of[['eip712','EIP-712 typed data'],['eth_sign','Ledger hash / personal_sign']]){const option=text('option',label);option.value=value;method.append(option);}method.value=signingMethod;method.disabled=busy;method.onchange=()=>{signingMethod=method.value;};methodLabel.append(method);signatures.append(methodLabel);
 const actions=document.createElement('div');actions.className='sign-actions';actions.append(button('Sign and collect',signingMethod==='eip712'?'pen-line':'usb',()=>sign(item,signingMethod),!owner||changed||item.draft||!item.simulation),button('Paste signature','clipboard',()=>{$('#pasteForm').reset();$('#pasteForm').elements.sender.value=account||'';$('#pasteDialog').showModal();},changed||item.draft||!item.simulation),button('Next Safe','arrow-right',()=>{const visible=visibleOperations();selectedId=visible[(visible.findIndex(x=>x.id===item.id)+1)%visible.length]?.id;render();}));signatures.append(actions);detail.append(signatures);
 const payload=document.createElement('details');payload.append(text('summary','Transaction payload'));payload.append(text('pre',JSON.stringify(item.signing.message,null,2),'payload'));detail.append(payload);
 if(item.result){detail.append(text('p',item.result.status==='proposed'?'Proposal published':item.result.message,'note'));if(item.result.safeUrl){const a=text('a','Open Safe queue');a.href=item.result.safeUrl;a.target='_blank';a.rel='noopener noreferrer';detail.append(a);}}
 icons();
}
async function sign(item,method){
 assertActive();
 if(!['eip712','eth_sign'].includes(method))throw Error('Choose a supported signing method');
 const checked=await api('check',{id:item.id});if(!checked.result.owners.some(a=>a.toLowerCase()===account.toLowerCase()))throw Error('Connected account is not a current owner');
 const target='0x'+item.chainId.toString(16);if((await walletRequest({method:'eth_chainId'})).toLowerCase()!==target){
  try{await walletRequest({method:'wallet_switchEthereumChain',params:[{chainId:target}]});}catch(e){
   if(e.code!==4902)throw e;const chain=chains[item.chainId];
   await walletRequest({method:'wallet_addEthereumChain',params:[{chainId:target,chainName:chain.name,nativeCurrency:{name:item.chainId===137?'POL':'Ether',symbol:item.chainId===137?'POL':'ETH',decimals:18},rpcUrls:[chain.rpc],blockExplorerUrls:[chain.explorer]}]});
  }
 }
 if((await walletRequest({method:'eth_chainId'})).toLowerCase()!==target)throw Error('Select the correct wallet network before signing');
 const accounts=await walletRequest({method:'eth_accounts'});if(accounts[0]?.toLowerCase()!==account.toLowerCase())throw Error('Wallet account changed; reconnect');
 const computed=ethers.TypedDataEncoder.hash(item.signing.domain,item.signing.types,item.signing.message);if(computed!==item.hash)throw Error('Hash mismatch');
 assertActive();
 status('Confirm '+item.id+' on your Ledger...');
 const payload=ethers.TypedDataEncoder.getPayload(item.signing.domain,item.signing.types,item.signing.message);
 const raw=await walletRequest(method==='eth_sign'?{method:'personal_sign',params:[item.hash,account]}:{method:'eth_signTypedData_v4',params:[account,JSON.stringify(payload)]});
 await api('collect',{id:item.id,sender:account,signature:raw,method});selected.add(item.id);await load();status('Signature verified and collected for '+item.id+'.');
}
$('#networkFilter').onchange=e=>{networkFilter=e.target.value;selectedId=visibleOperations()[0]?.id;checks.clear();render();};
$('#connect').onclick=()=>perform(async()=>{if(!window.ethereum)throw Error('Open this URL in Chrome or Brave with MetaMask and your Ledger account.');[account]=await walletRequest({method:'eth_requestAccounts'});assertActive();if(!account)throw Error('No wallet account was returned');$('#connect').querySelector('span').textContent=short(account);checks.clear();render();if(op())await refreshTransaction(op());else status('Wallet connected.');});
const accountsChanged=accounts=>{if(!active)return;account=accounts[0]||null;checks.clear();$('#connect').querySelector('span').textContent=account?short(account):'Connect Ledger wallet';render();};
const chainChanged=()=>{if(!active)return;checks.clear();render();};
window.ethereum?.on?.('accountsChanged',accountsChanged);
window.ethereum?.on?.('chainChanged',chainChanged);
window.ethereum?.request({method:'eth_accounts'}).then(accountsChanged).catch(()=>{});
$('#refresh').onclick=()=>perform(async()=>{await load();status('Batch reloaded.');});
$('#add').onclick=()=>perform(()=>beginSetup('add'));
$('#settings').onclick=()=>perform(()=>beginSetup('settings'));
$('#preparedImport').onclick=()=>{$('#addForm').reset();$('#addDialog').showModal();};
$('#addForm').onsubmit=e=>{e.preventDefault();perform(async()=>{const f=e.target;await api('add',{id:f.elements.id.value,signing:JSON.parse(await f.elements.file.files[0].text())});$('#addDialog').close();selectedId=f.elements.id.value;await load();status('Prepared transaction added.');});};
$('#simulationForm').onsubmit=e=>{e.preventDefault();perform(async()=>{const f=e.target,file=f.elements.file.files[0];await api('simulation',{id:selectedId,url:f.elements.url.value,document:file?JSON.parse(await file.text()):null});$('#simulationDialog').close();await load();status(file?'Simulation matched to the prepared transaction.':'Simulation link attached.');});};
$('#pasteForm').onsubmit=e=>{e.preventDefault();perform(async()=>{const f=e.target;await api('collect',{id:selectedId,sender:f.elements.sender.value.trim(),signature:f.elements.signature.value.trim()});selected.add(selectedId);f.elements.signature.value='';$('#pasteDialog').close();await load();status('Signature verified and collected.');});};
$('#export').onclick=()=>perform(async()=>{const collection=await api('export'),blob=new Blob([JSON.stringify(collection,null,2)],{type:'application/json'}),a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download='safe-signature-collection.json';a.click();URL.revokeObjectURL(a.href);status('Collection exported.');});
$('#import').onclick=()=>$('#collectionFile').click();$('#collectionFile').onchange=e=>perform(async()=>{await api('import',{collection:JSON.parse(await e.target.files[0].text())});await load();status('Collection imported and signatures checked.');});
$('#review').onclick=()=>perform(async()=>{status('Checking selected proposals...');const data=await api('review',{ids:[...selected]});reviewToken=data.result.reviewToken;const list=$('#reviewList');list.replaceChildren();for(const item of data.result.items){const row=document.createElement('div');row.className='review-item';row.append(text('strong',item.id+' · '+item.chain),text('code',item.safe),text('code',item.hash),text('p','Nonce '+item.nonce+' · '+item.signatures+' collected / '+item.threshold+' required for execution','note'));list.append(row);}$('#reviewDialog').showModal();status('Selected proposals checked.');});
$('#propose').onclick=()=>perform(async()=>{status('Publishing selected proposals...');const result=await api('propose',{reviewToken,confirm:'PROPOSE'});$('#reviewDialog').close();await load();status(result.result.map(x=>x.id+': '+x.status+(x.message?' ('+x.message+')':'')).join(' · '));});
root.querySelectorAll('[data-close]').forEach(b=>b.onclick=()=>b.closest('dialog').close());
async function prepareTenderly(publicExplorer){
 simulationToken=null;$('#runTenderly').disabled=true;
 status('Checking Tenderly support and capacity...');const data=await api('tenderly-plan',{id:simulationId,publicExplorer});simulationToken=data.result.simulationToken;$('#runTenderly').disabled=false;
 const p=data.result.plan,list=$('#tenderlyPlan');list.replaceChildren();list.append(text('strong',p.id+' · '+p.chain),text('p',p.safe,'signers'),text('code',p.hash,'hash'),text('p','Nonce '+p.nonce+' · '+p.threshold+' assumed approvals · fork block '+p.block,'note'),text('p','Environments '+p.environmentCount+'/'+p.environmentLimit+' · daily attempts '+p.runsToday+'/'+p.dailyLimit,'note'));if(p.draft)list.append(text('p','Draft: simulation does not approve the threshold decision.','note'));status('Simulation plan ready; no environment created.');
}
$('#publicExplorer').onchange=e=>perform(()=>prepareTenderly(e.target.checked));
$('#runTenderly').onclick=()=>perform(async()=>{
 const runButton=$('#runTenderly');runButton.disabled=true;status('Tenderly simulation running...');let polling=false,active=true;
 const timer=setInterval(async()=>{if(polling)return;polling=true;try{const data=await api('tenderly-progress?id='+encodeURIComponent(simulationId));if(active&&data.job?.status==='RUNNING')status(data.job.stage);}catch{}finally{polling=false;}},1500);
 timers.add(timer);
 try{await api('tenderly-run',{simulationToken,confirm:'SIMULATE'});status('Tenderly passed: exact Safe execution and final state matched.');}
 finally{active=false;clearInterval(timer);timers.delete(timer);simulationToken=null;runButton.disabled=true;$('#tenderlyDialog').close();await load();}
});
async function refreshTransaction(item){
 checks.delete(item.id);render();
 status('Fetching the current Safe transaction and approvals...');
 const walletChainId=account&&window.ethereum?Number(await walletRequest({method:'eth_chainId'})):null;
 const result=await api('transaction-status',{id:item.id,account,walletChainId});checks.set(item.id,result.result);render();
 status(result.result.serviceError||'Transaction status checked at block '+result.result.block+'.',!!result.result.serviceError);
}
function transactionSection(item){
 const section=document.createElement('section');section.className='section transaction-section';section.append(text('h3','Current transaction & wallet'));
 const live=checks.get(item.id);
 if(!live){section.append(text('p','Not checked','note'),button('Fetch status','activity',()=>refreshTransaction(item)));return section;}
 const facts=document.createElement('dl');facts.className='facts live-facts';
 for(const [label,value]of[['Chain nonce',live.liveNonce],['Prepared nonce',live.preparedNonce],['Published approvals',live.serviceKnown?live.publishedApprovals+' / '+live.threshold:'Unknown'],['Locally collected',live.localSignatures],['Usable signatures',live.usableSignatures+' / '+live.threshold],['Proposal',!live.serviceKnown?'Unknown':live.executed?'Executed':live.proposed?'Published':'Not published']]){const wrap=document.createElement('div');wrap.className='fact';wrap.append(text('dt',label),text('dd',value));facts.append(wrap);}section.append(facts);
 const walletRow=document.createElement('div');walletRow.className='readiness';
 const signText=!account?'Connect wallet':!live.wallet.currentOwner?'Not a current owner':!live.wallet.networkMatches?'Switch wallet network':live.wallet.alreadyPublished?'Approval already published':live.wallet.canSign?'Can sign':'Signing blocked';
 for(const [label,value,good]of[['Signing',signText,live.wallet.canSign],['Execution',live.execution.status,live.execution.canExecute]]){const row=document.createElement('div');row.append(text('span',label,'section-label'),text('strong',value,good?'positive':''));walletRow.append(row);}section.append(walletRow);
 if(!live.unchanged)section.append(text('p','Owners, threshold or nonce changed since preparation.','warning'));
 if(live.conflicts.length)section.append(text('p','Another transaction is queued at the current nonce.','warning'));
 if(live.serviceError)section.append(text('p',live.serviceError,'warning'));
 if(live.unverifiableApprovals)section.append(text('p',live.unverifiableApprovals+' service approvals could not be verified; not counted.','warning'));
 if(live.execution.estimatedNativeCost!==null){const symbol=item.chainId===137?'POL':'ETH';section.append(text('p','Estimated gas: '+Number(live.execution.estimatedNativeCost).toPrecision(4)+' '+symbol+' · wallet: '+Number(live.execution.walletBalance).toPrecision(4)+' '+symbol,'note'));}
 if(live.usableSignatures>live.publishedApprovals)section.append(text('p','Some usable signatures are local only; publish approvals before execution through Safe.','note'));
 if(live.currentQueue.length){const queue=document.createElement('details');queue.append(text('summary','Current nonce queue ('+live.currentQueue.length+')'));for(const tx of live.currentQueue)queue.append(text('div',tx.hash||'Unknown hash','hash'));section.append(queue);}
 const footer=document.createElement('div');footer.className='section-top';footer.append(text('p','Block '+live.block+' · '+new Date(live.checkedAt).toLocaleString(),'note'));const a=text('a','Open in Safe');a.href=live.safeUrl;a.target='_blank';a.rel='noopener noreferrer';footer.append(a);section.append(footer);
 return section;
}
async function beginSetup(mode){
 setupMode=mode;setupStep=1;snapshot=null;loadedSafeInput=null;$('#setupForm').reset();$('#setupError').textContent='';$('#safeSnapshot').replaceChildren();
 const select=$('#setupChain');select.replaceChildren();for(const [id,chain]of Object.entries(chains)){const option=text('option',chain.name+' · '+id);option.value=id;select.append(option);}select.value=mode==='first'?'1':String(op()?.chainId||1);
 $('#setupTenderly').checked=mode==='first'?false:tenderly.configured&&tenderly.enabled;
 $('#setupAccount').value=settings.tenderlyAccount||'';$('#setupProject').value=settings.tenderlyProject||'';
 $('#keyStatus').textContent=tenderly.configured?'Credentials configured; a blank key keeps the existing configuration.':'No complete Tenderly configuration found.';
 render();
 if(!catalog)catalog=await api('chains');rpcChoices();renderSetup();status(mode==='settings'?'Connection settings.':'Configure the Safe rotation.');
}
function rpcChoices(){
 const id=Number($('#setupChain').value),chain=catalog?.chains.find(x=>x.chainId===id),choice=$('#rpcChoice');choice.replaceChildren();
 if(settings.rpcChains?.includes(id)){const option=text('option','Keep configured RPC');option.value='saved';choice.append(option);}
 for(const url of chain?.rpcs||[chains[id].rpc]){const option=text('option',url);option.value=url;choice.append(option);}
 const custom=text('option','Custom HTTPS RPC');custom.value='custom';choice.append(custom);
 $('#catalogSource').textContent=catalog?.source==='chainlist.org'?'Chainlist catalogue loaded':'Built-in public RPC fallback';
 $('#customRpc').value='';$('#customRpcLabel').hidden=true;snapshot=null;loadedSafeInput=null;
}
const setupRpc=()=>$('#rpcChoice').value==='saved'?undefined:$('#rpcChoice').value==='custom'?$('#customRpc').value.trim():$('#rpcChoice').value;
const setupTenderly=()=>({enabled:$('#setupTenderly').checked,account:$('#setupAccount').value.trim(),project:$('#setupProject').value.trim(),key:$('#setupKey').value.trim()});
function setupOwners(){const a=$('#setupOwners').value.split(/[\s,;]+/).filter(Boolean).map(x=>ethers.getAddress(x));if(!a.length||new Set(a.map(x=>x.toLowerCase())).size!==a.length)throw Error('Enter a unique complete final owner list');if(a.some(x=>x===ethers.ZeroAddress||x.toLowerCase()==='0x0000000000000000000000000000000000000001'||x.toLowerCase()===snapshot.safe.toLowerCase()))throw Error('Invalid owner address');return a;}
function setupTarget(){const owners=setupOwners(),threshold=Number($('#setupThreshold').value);if(!Number.isInteger(threshold)||threshold<1||threshold>owners.length)throw Error('Required approvals must be between 1 and the final owner count');return{owners,threshold};}
function renderSetup(){
 const steps=setupMode==='settings'?[[1,'Network'],[4,'Tenderly']]:[[1,'Network'],[2,'Safe'],[3,'Owners'],[4,'Tenderly'],[5,'Review']];
 $('#setupTitle').textContent=setupMode==='settings'?'Connection settings':setupMode==='first'?'Set up your first Safe':'Add a Safe rotation';
 $('#setupSteps').replaceChildren(...steps.map(([step,label],index)=>{const li=text('li',(index+1)+'. '+label,step===setupStep?'current':step<setupStep?'complete':'');if(step===setupStep)li.setAttribute('aria-current','step');return li;}));
 root.querySelectorAll('[data-step]').forEach(section=>section.hidden=Number(section.dataset.step)!==setupStep);
 $('#cancelSetup').hidden=setupMode==='first';$('#cancelSetup').disabled=busy;$('#setupBack').hidden=setupStep===1;$('#setupBack').disabled=busy;
 $('#setupNext').disabled=busy;$('#loadSafe').disabled=busy;$('#setupNext').replaceChildren(text('span',setupStep===5?'Prepare rotation':setupMode==='settings'&&setupStep===4?'Save settings':'Continue'));
 const i=document.createElement('i');i.dataset.lucide=setupStep===5?'file-check':setupMode==='settings'&&setupStep===4?'save':'arrow-right';$('#setupNext').append(i);
 $('#tenderlyFields').hidden=!$('#setupTenderly').checked;icons();
}
async function loadSafe(){
 const id=$('#setupId').value.trim();if(!/^[a-z0-9][a-z0-9-]{0,63}$/.test(id))throw Error('Use a short lowercase operation name with hyphens');
 if(operations.some(x=>x.id===id))throw Error('Operation name already exists');
 status('Reading current Safe owners, threshold and nonce...');
 const input={chainId:Number($('#setupChain').value),safe:$('#setupSafe').value.trim(),rpcUrl:setupRpc()};
 const result=await api('inspect',input);snapshot=result.result;loadedSafeInput=JSON.stringify(input);
 $('#setupSafe').value=snapshot.safe;loadedSafeInput=JSON.stringify({...input,safe:snapshot.safe});
 $('#setupOwners').value=snapshot.owners.join('\n');$('#setupThreshold').value=snapshot.threshold;updateOwnerCount();
 const view=$('#safeSnapshot');view.replaceChildren(text('strong',snapshot.threshold+' / '+snapshot.owners.length+' approvals · nonce '+snapshot.nonce),text('p','Block '+snapshot.block,'note'));
 for(const owner of snapshot.owners)view.append(text('div',owner,'owner'));status('Safe loaded.');
}
function updateOwnerCount(){const n=$('#setupOwners').value.split(/[\s,;]+/).filter(Boolean).length;$('#ownerCount').textContent=n+' final owners';$('#setupThreshold').max=n;}
function renderSetupReview(){
 const {owners,threshold}=setupTarget(),view=$('#setupReview');view.replaceChildren();
 view.append(text('strong',$('#setupId').value.trim()+' · '+chains[snapshot.chainId].name),text('address',snapshot.safe),text('p','Nonce '+snapshot.nonce+' · approvals '+snapshot.threshold+'/'+snapshot.owners.length+' → '+threshold+'/'+owners.length,'note'));
 const grid=document.createElement('div');grid.className='owner-grid';for(const [name,list]of[['Current owners',snapshot.owners],['Final owners',owners]]){const col=document.createElement('div');col.append(text('h3',name));for(const owner of list)col.append(text('div',owner,'owner'));grid.append(col);}view.append(grid);
 view.append(text('p',$('#setupTenderly').checked?'Tenderly enabled · no environment will be created yet':'Tenderly disabled · attach an external matching simulation before signing','note'));
}
$('#setupForm').onsubmit=e=>{e.preventDefault();perform(async()=>{
 $('#setupError').textContent='';
 try{
  if(setupStep===1){if($('#rpcChoice').value==='custom'&&!setupRpc())throw Error('Enter your custom HTTPS RPC URL');await api('rpc-check',{chainId:Number($('#setupChain').value),rpcUrl:setupRpc()});setupStep=setupMode==='settings'?4:2;}
  else if(setupStep===2){const input=JSON.stringify({chainId:Number($('#setupChain').value),safe:$('#setupSafe').value.trim(),rpcUrl:setupRpc()});if(!snapshot||input!==loadedSafeInput)await loadSafe();setupStep=3;}
  else if(setupStep===3){setupTarget();setupStep=4;}
  else if(setupStep===4&&setupMode!=='settings'){renderSetupReview();setupStep=5;}
  else{
   let result;
   if(setupMode==='settings')await api('settings',{chainId:Number($('#setupChain').value),rpcUrl:setupRpc(),tenderly:setupTenderly()});
   else{const {owners,threshold}=setupTarget();result=await api('prepare',{id:$('#setupId').value.trim(),chainId:snapshot.chainId,safe:snapshot.safe,rpcUrl:setupRpc(),snapshot,newOwners:owners,threshold,tenderly:setupTenderly(),confirm:'PREPARE'});selectedId=result.result.id;}
   const wasSettings=setupMode==='settings';setupMode=null;$('#setupForm').reset();snapshot=null;checks.clear();await load();status(wasSettings?'Settings saved.':'Rotation prepared; review the payload and simulate before signing.');
  }
 }catch(error){$('#setupError').textContent=error.message;throw error;}
 renderSetup();
});};
$('#setupBack').onclick=()=>{setupStep=setupMode==='settings'?1:Math.max(1,setupStep-1);$('#setupError').textContent='';renderSetup();};
$('#cancelSetup').onclick=()=>{setupMode=null;$('#setupForm').reset();snapshot=null;render();status('Prepared operations loaded.');};
$('#setupChain').onchange=rpcChoices;$('#rpcChoice').onchange=()=>{$('#customRpcLabel').hidden=$('#rpcChoice').value!=='custom';snapshot=null;};
$('#setupTenderly').onchange=renderSetup;$('#setupOwners').oninput=updateOwnerCount;
$('#loadSafe').onclick=()=>perform(async()=>{try{await loadSafe();$('#setupError').textContent='';}catch(e){$('#setupError').textContent=e.message;throw e;}});
load().then(()=>{if(!setupMode)status('Prepared operations loaded.');}).catch(e=>status(e.message,true));
return()=>{active=false;abort.abort();for(const timer of timers)clearInterval(timer);window.ethereum?.removeListener?.('accountsChanged',accountsChanged);window.ethereum?.removeListener?.('chainChanged',chainChanged);root.querySelectorAll('dialog[open]').forEach(dialog=>dialog.close());};
}
