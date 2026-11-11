import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {spawn} from 'node:child_process';
import {PACKAGE,VERSION,MODELS,ENDPOINTS} from './constants.mjs';
import {CliError,configDir,exists,readJson,newJson,replaceBackedUp} from './storage.mjs';
export const ROOT=path.dirname(path.dirname(fileURLToPath(import.meta.url)));
export const source=async()=>await exists(path.join(ROOT,'skills','toapiscli','SKILL.md'))?path.join(ROOT,'skills','toapiscli'):path.dirname(ROOT);
const receiptName='.toapiscli-managed.json';
const sha=b=>crypto.createHash('sha256').update(b).digest('hex');
async function inventory(root,prefix=''){
 const files={};for(const e of await fs.readdir(path.join(root,prefix),{withFileTypes:true})){
  const rel=path.join(prefix,e.name);if(e.name===receiptName)continue;
  if(e.isSymbolicLink())throw new CliError('UNSAFE_PATH','Managed content cannot contain symlinks.');
  if(e.isDirectory())Object.assign(files,await inventory(root,rel));else if(e.isFile())files[rel]=sha(await fs.readFile(path.join(root,rel)));
 }return files;
}
export function targetOptions(o){
 const agent=o.agent||'generic';if(!/^[a-z][a-z0-9-]{0,63}$/.test(agent))throw new CliError('INVALID_AGENT','Use a lowercase Agent identifier.');
 if(!o.target)throw new CliError('TARGET_REQUIRED','Current Agent must resolve its own exact Skill directory and pass --target.');
 const target=path.resolve(o.target);if(path.basename(target)!=='toapiscli')throw new CliError('INVALID_TARGET','Exact Skill directory must end in toapiscli.');
 return {agent,target};
}
export async function skillSource(){return {...capabilities(),ok:true,name:'toapiscli',package:PACKAGE,version:VERSION,path:await source(),runtimeEntry:path.join(await source(),'.runtime','dist','cli.mjs'),complete:true,items:[{ok:true,name:'toapiscli',package:PACKAGE,version:VERSION,path:await source()}]};}
export async function skillStatus(o){
 const {target,agent}=targetOptions(o);const base={ok:true,name:'toapiscli',package:PACKAGE,version:VERSION,target,agent,installed:false,managed:false,current:false,edited:false,verification:{verified:false,algorithm:'sha256'},recovery:{required:false},hostDiscovery:{authority:'host',status:'pending'}};
 if(!await exists(target))return base;const st=await fs.lstat(target);if(!st.isDirectory()||st.isSymbolicLink())throw new CliError('UNSAFE_TARGET','Target must be a physical directory.');
 base.installed=true;const rp=path.join(target,receiptName);if(!await exists(rp))return base;
 const r=await readJson(rp);if(r.package!==PACKAGE||r.target!==target)return base;base.managed=true;
 const metadata=path.join('agents','openai.yaml');
 const actual=await inventory(target);base.edited=Object.entries(r.hashes).some(([f,h])=>f!==metadata&&actual[f]!==undefined&&actual[f]!==h);
 const desired=await inventory(await source());base.current=!base.edited&&r.version===VERSION&&Object.entries(desired).every(([f,h])=>f===metadata?!!actual[f]:actual[f]===h)&&Object.keys(r.hashes).every(f=>f in desired);
 base.verification.verified=base.current;base.installedVersion=r.version;base.runtimeEntry=path.join(target,'.runtime','dist','cli.mjs');return base;
}
export async function installSkill(o){
 const s=await skillStatus(o);if(s.installed&&!s.managed)throw new CliError('UNMANAGED_TARGET','Target is user-owned; choose an unused directory.');if(s.edited)throw new CliError('LOCAL_EDITS','Managed files were edited; preserve and resolve edits before update.');
 if(s.current)return {...s,changed:false,backup:null};
 const canonical=await source();const hashes=await inventory(canonical);let backup=null;
 if(s.installed){backup=path.join(configDir(),'skill-backups',s.agent,crypto.randomUUID());if(await exists(backup))throw new CliError('PATH_EXISTS','Backup exists.');await fs.mkdir(path.dirname(backup),{recursive:true,mode:0o700});await fs.cp(s.target,backup,{recursive:true,errorOnExist:true,force:false});}
 try{
  await fs.mkdir(s.target,{recursive:true});
  for(const rel of Object.keys(hashes)){
   const dest=path.join(s.target,rel);await fs.mkdir(path.dirname(dest),{recursive:true});
   if(rel===path.join('agents','openai.yaml')&&await exists(dest))continue;
   if(await exists(dest)){const st=await fs.lstat(dest);if(st.isSymbolicLink()||!st.isFile())throw new CliError('UNSAFE_PATH','Refusing non-regular managed file.');const old=await readJson(path.join(s.target,receiptName));if(!(rel in old.hashes))throw new CliError('USER_FILE_CONFLICT','An untracked file occupies a managed path.');await fs.unlink(dest);}
   await fs.copyFile(path.join(canonical,rel),dest,fs.constants.COPYFILE_EXCL);
  }
  const rp=path.join(s.target,receiptName);if(await exists(rp))await fs.unlink(rp);
  await newJson(rp,{schemaVersion:1,name:'toapiscli',package:PACKAGE,version:VERSION,target:s.target,agent:s.agent,hashes,installedAt:new Date().toISOString(),physicalCopy:true,backup});
  const result=await skillStatus(o);if(!result.current)throw new CliError('VERIFY_FAILED','Installed file hashes did not match.');
  return {...result,changed:true,backup};
 }catch(e){
  if(backup){await fs.cp(backup,s.target,{recursive:true,force:true});}
  throw new CliError('SKILL_SYNC_FAILED',e.message,{backup,target:s.target,recovery:{required:!backup}});
 }
}
export async function checkUpdate({force=false}={}){
 if(process.env.TOAPISCLI_UPDATE_CHECK==='0')return {enabled:false,automaticInstall:false};
 const cache=path.join(configDir(),'update-cache.json');const old=await readJson(cache).catch(()=>null);
 if(!force&&old&&Date.now()-old.checkedAt<86400000)return {...old,cached:true};
 let result;try{const r=await fetch('https://registry.npmjs.org/@petercjl%2ftoapiscli/latest',{signal:AbortSignal.timeout(1200)});if(r.status===404)result={available:false,registryPublished:false};else{if(!r.ok)throw Error('Registry unavailable');const d=await r.json();result={latest:d.version,available:d.version!==VERSION,registryPublished:true};}}catch{result={available:false,offline:true};}
 result={...result,current:VERSION,checkedAt:Date.now(),automaticInstall:false};
 await fs.mkdir(configDir(),{recursive:true,mode:0o700});const lock=cache+'.lock';let h;try{h=await fs.open(lock,'wx');if(await exists(cache))await replaceBackedUp(cache,JSON.stringify(result),{privateFile:true});else await newJson(cache,result,{privateFile:true});}catch(e){if(e.code!=='EEXIST')throw e;}finally{if(h){await h.close();await fs.unlink(lock);}}
 return result;
}
function exec(file,args){return new Promise((resolve,reject)=>{const p=spawn(file,args,{stdio:['ignore','pipe','pipe'],shell:process.platform==='win32',env:{...process.env,TOAPISCLI_UPDATE_CHECK:'0'}});let err='';p.stderr.on('data',b=>{err+=b});p.on('error',reject);p.on('close',code=>code===0?resolve():reject(new CliError('PACKAGE_UPDATE_FAILED','npm update failed; existing installation retained.',{exitCode:code})));});}
export async function updateInstall(o){
 if(!o.yes)throw new CliError('CONFIRM_REQUIRED','Explicit update authorization requires --yes.');const state=await skillStatus(o);if(state.installed&&(!state.managed||state.edited))throw new CliError('UNSAFE_TARGET','Resolve target ownership and edits before package installation.');
 const version=o.version||'latest';if(!/^(latest|next|\d+\.\d+\.\d+(?:-[A-Za-z0-9.-]+)?)$/.test(version))throw new CliError('INVALID_VERSION','Invalid version selector.');
 // Stage a full independent package first; update only the selected host runtime.
 const stage=path.join(configDir(),'packages',crypto.randomUUID());await fs.mkdir(stage,{recursive:true,mode:0o700});await exec(process.platform==='win32'?'npm.cmd':'npm',['install','--ignore-scripts','--prefix',stage,PACKAGE+'@'+version]);
 const entry=path.join(stage,'node_modules','@petercjl','toapiscli','bin','toapiscli.mjs');await exec(process.execPath,[entry,'skill','update','--target',state.target,'--agent',state.agent,'--json']);
 return {ok:true,target:state.target,updatedEntry:path.join(state.target,'.runtime','dist','cli.mjs'),bootstrapPackageUnchanged:true,packageStage:stage,hostDiscovery:{status:'pending',authority:'host'},message:'Selected Agent runtime and Skill updated; refresh host discovery. Global bootstrap package is unchanged.'};
}
export function capabilities(){
 const flags={json:'boolean',help:'boolean'};const def=(args,sideEffects)=>({options:{...flags,...args},sideEffects});
 const commands={
  version:def({},[]),capabilities:def({},[]),doctor:def({},[]),
  'auth import':def({file:'string',replace:'boolean'},['credential-copy','free-network-validation']),
  'auth status':def({},[]),'models list':def({},['free-network','update-cache']),
  'models docs':def({model:'string'},['free-network']),
  'image generate':def({model:'string',prompt:'string','prompt-file':'string',resolution:'string',aspect:'string',reference:'string[]','out-directory':'string',submit:'boolean',wait:'boolean',timeout:'number'},['paid-generation','reference-upload','task-files']),
  'task get':def({directory:'string'},['free-network','task-snapshot']),
  'task wait':def({directory:'string',timeout:'number'},['free-network','task-snapshot','download']),
  'usage':def({start:'string',end:'string'},['free-network']),
  'balance':def({},['free-network']),
  'skill source':def({name:'string'},[]),'skill list':def({},[]),
  'skill status':def({target:'string',agent:'string'},[]),
  'skill install':def({target:'string',agent:'string','credentials-file':'string'},['selected-target-write','optional-credential-import']),
  'skill update':def({target:'string',agent:'string'},['selected-target-write','backup']),
  'update check':def({},['registry-read','update-cache']),
  'update install':def({target:'string',agent:'string',version:'string',yes:'boolean'},['npm-stage','selected-target-update','backup']),
  'installation-notice':def({},[]),help:def({},[])
 };
 const field=(field,type='string')=>({field,type});
 const manifest={ok:true,schemaVersion:1,package:PACKAGE,version:VERSION,kind:'cli-skill',skills:['toapiscli'],models:MODELS,endpoints:ENDPOINTS,transport:'MCP Streamable HTTP',commandContracts:commands,agentEligibility:'capability-based; valid-name-with-generic-fallback',
  requiredCapabilities:['Node.js >=22','command execution','local files','HTTPS'],
  defaults:{resolution:'2K',aspect:'1:1',count:1,site:'cn'},
  credentials:{input:'administrator-provided JSON file',command:'auth import --file',schema:{schemaVersion:1,site:'cn|com',apiKey:'secret string',label:'optional string'},storage:'user-only file outside package; Windows inherits user profile ACL',neverIncludedInPackage:true},
  installationLifecycle:{skillRequired:true,updateRequiresSkillSync:true,required_components:['cli','skill'],install:'INSTALL.md',update:'UPDATE.md',verification:'skill status --target <exact-directory> --json; host verifies discovery',physicalIsolation:true},
  automaticUpdates:{trigger:'models list and image generate',timeoutMs:1200,cacheHours:24,optOut:'TOAPISCLI_UPDATE_CHECK=0',automaticInstall:false,installCommand:'update install --target <exact-directory> --yes',scope:'selected Agent runtime and Skill; global bootstrap unchanged'},
  discoveryContract:{schemaVersion:1,entryPoints:[{argv:['capabilities','--json'],result:'json'}],commandsField:'commandContracts',version:{command:'version',argv:['version','--json'],fields:{package:'package',version:'version'}},skillCollection:{namesField:'skills',default:'toapiscli',selector:{option:'--name',type:'string'},enumeration:{argv:['skill','list','--json'],itemsField:'items',completeField:'complete'},namedSource:{argv:['skill','source','--name','{skill}','--json']}}},
  maintenanceContract:{schemaVersion:1,agentEligibility:'valid-name-with-generic-fallback',hostDiscoveryAuthority:'host',targetOptions:[{option:'--target',kind:'skill-directory',required:true}],source:{command:['skill','source','--json'],fields:{name:field('name'),package:field('package'),version:field('version'),path:field('path')}},status:{command:['skill','status','--target','{target}','--agent','{agent}','--json'],fields:{name:field('name'),package:field('package'),version:field('version'),target:field('target'),installed:field('installed','boolean'),managed:field('managed','boolean'),current:field('current','boolean'),edited:field('edited','boolean'),verification:field('verification','object'),recovery:field('recovery','object')}}}
 };
 for(const [name,c] of Object.entries(commands)){
  c.options=Object.fromEntries(Object.entries(c.options).map(([k,v])=>['--'+k,{type:v==='boolean'?'boolean':'string',...(v==='string[]'?{repeatable:true}:{})}]));
  c.effects=c.sideEffects;c.sideEffects=name==='update install'?'package-and-skill-update':(['skill install','skill update','auth import','image generate','task get','task wait'].includes(name)?'local-write':'none');
 }
 manifest.installationLifecycle={...manifest.installationLifecycle,agentNeutral:true,targetRequired:true,hostRegistrationRequired:true,installationMode:'copy',sharedLinksAllowed:false,isolatedRuntimeRequired:true};
 manifest.automaticUpdates={...manifest.automaticUpdates,enabledByDefault:true,intervalHours:24,configuration:'TOAPISCLI_UPDATE_CHECK',disable:'TOAPISCLI_UPDATE_CHECK=0',recovery:'Offline keeps installed runtime; explicit update stages package and backs up selected Skill.'};
 manifest.discoveryContract.entryPoints[0].result='manifest';
 manifest.discoveryContract.version.fields={package:field('package'),version:field('version')};
 manifest.discoveryContract.skillCollection.namedSource=['skill','source','--name','{skill}','--json'];
 manifest.maintenanceContract.source=manifest.maintenanceContract.source.fields;
 manifest.maintenanceContract.status=manifest.maintenanceContract.status.fields;
 manifest.maintenanceContract.targetOptions={'--target':{kind:'skill-directory',required:true}};
 return manifest;
}
