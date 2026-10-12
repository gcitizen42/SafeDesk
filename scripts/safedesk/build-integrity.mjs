import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {pathToFileURL} from 'node:url';

const project=path.resolve(import.meta.dirname,'../..');
const defaultDist=path.join(project,'apps/plainsafe/dist');
const digest=value=>createHash('sha256').update(value).digest('hex');
const aggregate=files=>digest(JSON.stringify(Object.entries(files).sort(([a],[b])=>a.localeCompare(b,'en'))));
function buildFiles(dist){
 const files={};
 const visit=dir=>{for(const name of fs.readdirSync(dir).sort()){
  const file=path.join(dir,name),stat=fs.lstatSync(file);
  if(stat.isSymbolicLink())throw Error('Build contains a symlink; rebuild SafeDesk');
  if(stat.isDirectory())visit(file);
  else if(stat.isFile()){
   const relative=path.relative(dist,file).split(path.sep).join('/');
   if(relative!=='integrity.json')files[relative]=digest(fs.readFileSync(file));
  }
 }};visit(dist);return files;
}
function sourceIdentity(root){
 try{
  const git=(...args)=>execFileSync('git',args,{cwd:root,encoding:'utf8',stdio:['ignore','pipe','pipe'],maxBuffer:16*1024*1024});
  const paths=git('ls-files','-z').split('\0').filter(Boolean).sort();
  const files=Object.fromEntries(paths.map(name=>[name,digest(fs.readFileSync(path.join(root,name)))]));
  return{commit:git('rev-parse','HEAD').trim(),hash:aggregate(files),dirty:git('status','--porcelain').trim()!==''};
 }catch{return null;}
}
export function recordBuild(dist=defaultDist,{sourceRoot=project}={}){
 const files=buildFiles(dist);
 if(!files['index.html'])throw Error('Build SafeDesk before recording its fingerprint');
 const manifest={version:1,algorithm:'SHA-256',files,contentHash:aggregate(files),source:sourceIdentity(sourceRoot)};
 fs.writeFileSync(path.join(dist,'integrity.json'),JSON.stringify(manifest,null,2)+'\n',{mode:0o600});
 return manifest;
}
export function verifyBuild(dist=defaultDist,{sourceRoot=project}={}){
 let manifest;
 try{manifest=JSON.parse(fs.readFileSync(path.join(dist,'integrity.json'),'utf8'));}
 catch{throw Error('SafeDesk build fingerprint is missing. Run npm run build:manager.');}
 const actual=buildFiles(dist);
 if(manifest.version!==1||manifest.algorithm!=='SHA-256'||aggregate(actual)!==manifest.contentHash||JSON.stringify(Object.entries(actual).sort())!==JSON.stringify(Object.entries(manifest.files||{}).sort()))throw Error('SafeDesk build fingerprint mismatch. Rebuild before starting.');
 const source=sourceIdentity(sourceRoot);
 if(manifest.source&&source&&manifest.source.hash!==source.hash)throw Error('SafeDesk source changed after this build. Run npm run build:manager.');
 const hashes=new Map(Object.entries(actual));
 return{
  summary:{algorithm:'SHA-256',contentHash:manifest.contentHash,sourceHash:manifest.source?.hash||null,commit:manifest.source?.commit||null,sourceDirty:manifest.source?.dirty??null,sourceChecked:Boolean(manifest.source&&source),fileCount:hashes.size},
  matches:(name,bytes)=>hashes.get(name)===digest(bytes),
 };
}
if(process.argv[1]&&pathToFileURL(path.resolve(process.argv[1])).href===import.meta.url){
 try{const result=process.argv.includes('--record')?recordBuild():verifyBuild().summary;console.log(JSON.stringify(process.argv.includes('--record')?{recorded:true,contentHash:result.contentHash}:result,null,2));}
 catch(error){console.error(error.message);process.exitCode=1;}
}
