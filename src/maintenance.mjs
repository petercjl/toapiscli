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
 const recoveryFile=statePath(target,'.recovery.json');if(await exists(recoveryFile))base.recovery={required:true,receipt:recoveryFile};
 if(!await exists(target))return base;const st=await fs.lstat(target);if(!st.isDirectory()||st.isSymbolicLink())throw new CliError('UNSAFE_TARGET','Target must be a physical directory.');
 base.installed=true;const rp=path.join(target,receiptName);if(!await exists(rp))return base;
 const r=await readJson(rp);if(r.package!==PACKAGE||r.target!==target)return base;base.managed=true;
 const metadata=path.join('agents','openai.yaml');
 const actual=await inventory(target);base.edited=Object.entries(r.hashes).some(([f,h])=>f!==metadata&&actual[f]!==undefined&&actual[f]!==h);
 const desired=await inventory(await source());base.current=!base.edited&&r.version===VERSION&&Object.entries(desired).every(([f,h])=>f===metadata?!!actual[f]:actual[f]===h)&&Object.keys(r.hashes).every(f=>f in desired);
 base.verification.verified=base.current;base.installedVersion=r.version;base.runtimeEntry=path.join(target,'.runtime','dist','cli.mjs');return base;
}
async function syncSkill(o){
 const s=await skillStatus(o);if(s.installed&&!s.managed)throw new CliError('UNMANAGED_TARGET','Target is user-owned; choose an unused directory.');if(s.edited)throw new CliError('LOCAL_EDITS','Managed files were edited; preserve and resolve edits before update.');
 if(s.current)return {...s,changed:false,backup:null};
 const canonical=await source();const hashes=await inventory(canonical);let backup=null;
 if(s.installed){backup=path.join(configDir(),'skill-backups',s.agent,crypto.randomUUID());if(await exists(backup))throw new CliError('PATH_EXISTS','Backup exists.');await fs.mkdir(path.dirname(backup),{recursive:true,mode:0o700});await fs.cp(s.target,backup,{recursive:true,errorOnExist:true,force:false});}
 try{
  const recovery=statePath(s.target,'.recovery.json');if(await exists(recovery))await replaceBackedUp(recovery,JSON.stringify({target:s.target,backup,phase:'sync-writing'}),{privateFile:true});
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
  if(backup){try{for(const rel of Object.keys(hashes)){if(!await exists(path.join(backup,rel))&&await exists(path.join(s.target,rel)))await fs.unlink(path.join(s.target,rel));}await fs.cp(backup,s.target,{recursive:true,force:true});}catch{throw new CliError('RECOVERY_REQUIRED','Update rollback failed; stop tasks and restore the saved backup.',{backup,target:s.target});}}
  throw new CliError('SKILL_SYNC_FAILED',e.message,{backup,target:s.target,recovery:{required:!backup}});
 }
}
// Locks live outside host discovery directories and are shared by every runtime version.
const statePath=(target,suffix)=>path.join(configDir(),'updates',sha(path.resolve(target))+suffix);
async function lock(file){
 await fs.mkdir(path.dirname(file),{recursive:true,mode:0o700});
 try{const h=await fs.open(file,'wx',0o600);await h.writeFile(String(process.pid));return async()=>{await h.close();await fs.unlink(file);};}
 catch(e){if(e.code!=='EEXIST')throw e;const pid=Number(await fs.readFile(file,'utf8').catch(()=>''));if(Number.isInteger(pid)&&pid>0){try{process.kill(pid,0);}catch(error){if(error.code==='ESRCH'){await fs.unlink(file).catch(()=>{});return lock(file);}}}return null;}
}
export function versionInfo(v){const m=/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.exec(v||'');return m?m.slice(1).map(Number):null;}
export function newer(v,current=VERSION){const a=versionInfo(v),b=versionInfo(current);return !!(a&&b&&a.some((n,i)=>n>b[i]&&a.slice(0,i).every((x,j)=>x===b[j])));}
export function compatible(v,current=VERSION){const a=versionInfo(v),b=versionInfo(current);return !!(a&&b&&a[0]===b[0]&&(a[0]!==0||a[1]===b[1]));}
export async function updatePolicy(o){
 const {target,agent}=targetOptions(o);const file=statePath(target,'.policy.json');
 if(o.mode!==undefined){
  if(!['auto','off'].includes(o.mode))throw new CliError('INVALID_POLICY','Use --mode auto or off.');
  const st=await skillStatus({target,agent});if(!st.managed||st.edited)throw new CliError('UNSAFE_TARGET','Policy requires an unedited managed installation.');
  const policy={schemaVersion:1,target,agent,mode:o.mode,compatibility:'same-major; same-minor for 0.x',authorizedAt:new Date().toISOString()};
  await replaceBackedUp(file,JSON.stringify(policy,null,2)+'\n',{privateFile:true});
 }
 if(!await exists(file))return {ok:true,target,mode:'off',reason:'installation-upgrade-required'};
 let p;try{p=await readJson(file);}catch{throw new CliError('INVALID_POLICY','Policy is malformed; existing file preserved.');}
 if(p.schemaVersion!==1||p.target!==target||!['auto','off'].includes(p.mode))throw new CliError('INVALID_POLICY','Policy does not match this installation.');
 return {ok:true,...p};
}
export async function installSkill(o){
 const {target}=targetOptions(o);const release=await lock(statePath(target,'.sync.lock'));
 if(!release)throw new CliError('UPDATE_BUSY','Another update owns this target; retry later.');
 const recovery=statePath(target,'.recovery.json');
 try{
  if(await exists(recovery))throw new CliError('RECOVERY_REQUIRED','Previous synchronization was interrupted; inspect the saved recovery receipt before continuing.',{recovery});
  const before=await skillStatus(o);if(before.installed&&!before.managed)throw new CliError('UNMANAGED_TARGET','Target is user-owned.');if(before.edited)throw new CliError('LOCAL_EDITS','Resolve local edits first.');
  // Durable marker prevents a killed writer from leaving tasks on mixed versions.
  await newJson(recovery,{target,version:VERSION,phase:'sync-pending',backups:path.join(configDir(),'skill-backups',before.agent)},{privateFile:true});
  let result;try{result=await syncSkill(o);}catch(e){if(e.code!=='RECOVERY_REQUIRED')await fs.unlink(recovery);throw e;}
  await fs.unlink(recovery);
  const policyFile=statePath(target,'.policy.json');if(!await exists(policyFile))await updatePolicy({...o,mode:'auto'});
  return {...result,recovery:{required:false},automaticUpdates:await updatePolicy(o)};
 }finally{await release();}
}
export async function checkUpdate({force=false}={}){
 if(process.env.TOAPISCLI_UPDATE_CHECK==='0')return {enabled:false,automaticInstall:false};
 const cache=path.join(configDir(),'update-cache.json');let old;
 try{old=await readJson(cache);}catch(e){if(await exists(cache))return {available:false,reason:'invalid-cache-preserved'};}
 const normalized=r=>({...r,current:VERSION,available:newer(r.latest),compatible:compatible(r.latest),automaticInstall:true});
 if(!force&&old&&Number.isFinite(old.checkedAt)&&Date.now()-old.checkedAt>=0&&Date.now()-old.checkedAt<(old.offline?3600000:86400000))return {...normalized(old),cached:true};
 const release=await lock(cache+'.lock');if(!release)return {available:false,reason:'check-busy'};
 try{
 let result;try{const r=await fetch('https://registry.npmjs.org/@petercjl%2ftoapiscli/latest',{signal:AbortSignal.timeout(1200)});if(r.status===404)result={available:false,registryPublished:false};else{if(!r.ok)throw Error('Registry unavailable');const d=await r.json();if(!versionInfo(d.version))throw Error('Invalid stable version');result={latest:d.version,registryPublished:true};}}catch{result={available:false,offline:true};}
 result=normalized({...result,checkedAt:Date.now()});
 await replaceBackedUp(cache,JSON.stringify(result),{privateFile:true});return result;
 }finally{await release();}
}
export function runProcess(file,args,{inherit=false,timeoutMs=120000,acceptFailure=false}={}){return new Promise((resolve,reject)=>{
 const p=spawn(file,args,{stdio:inherit?'inherit':['ignore','pipe','pipe'],shell:false,env:{...process.env,TOAPISCLI_UPDATE_CHECK:'0'}});
 const timer=setTimeout(()=>{p.kill();reject(new CliError('PACKAGE_UPDATE_TIMEOUT','Update timed out; inspect its durable receipt.'));},timeoutMs);timer.unref();
 let out='';if(!inherit){p.stdout.on('data',b=>{out+=b});p.stderr.on('data',()=>{});}
 p.on('error',e=>{clearTimeout(timer);reject(e)});p.on('close',code=>{clearTimeout(timer);(code===0||acceptFailure)?resolve({code,stdout:out}):reject(new CliError('PACKAGE_UPDATE_FAILED','Package operation failed.',{exitCode:code}));});
 });}
async function npmInstall(stage,spec){
 // npm-cli.js avoids Windows .cmd shell quoting and command injection.
 if(process.platform==='win32'){
  const candidates=[process.env.npm_execpath,path.join(path.dirname(process.execPath),'node_modules','npm','bin','npm-cli.js')].filter(Boolean);
  for(const entry of candidates)if(await exists(entry))return runProcess(process.execPath,[entry,'install','--ignore-scripts','--no-audit','--no-fund','--prefix',stage,spec]);
  throw new CliError('NPM_REQUIRED','npm-cli.js must be installed beside Node.js on Windows.');
 }
 return runProcess('npm',['install','--ignore-scripts','--no-audit','--no-fund','--prefix',stage,spec]);
}
export async function updateInstall(o){
 if(!o.yes)throw new CliError('CONFIRM_REQUIRED','Explicit update authorization requires --yes.');const state=await skillStatus(o);if(state.installed&&(!state.managed||state.edited))throw new CliError('UNSAFE_TARGET','Resolve target ownership and edits before package installation.');
 const version=o.version||'latest';if(!/^(latest|next|\d+\.\d+\.\d+(?:-[A-Za-z0-9.-]+)?)$/.test(version))throw new CliError('INVALID_VERSION','Invalid version selector.');
 const stage=path.join(configDir(),'packages',crypto.randomUUID());await fs.mkdir(stage,{recursive:true,mode:0o700});await npmInstall(stage,PACKAGE+'@'+version);
 const root=path.join(stage,'node_modules','@petercjl','toapiscli');const pkg=await readJson(path.join(root,'package.json'));
 if(pkg.name!==PACKAGE||(versionInfo(version)&&pkg.version!==version))throw new CliError('PACKAGE_IDENTITY','Staged package identity did not match the requested version.');
 const r=await runProcess(process.execPath,[path.join(root,'bin','toapiscli.mjs'),'skill','update','--target',state.target,'--agent',state.agent,'--json']);
 let child;try{child=JSON.parse(r.stdout);}catch{throw new CliError('UPDATE_RESULT_INVALID','Cannot verify installer result.');}
 if(!child.ok||!child.current||child.version!==pkg.version)throw new CliError('UPDATE_RESULT_INVALID','Installer did not verify the selected target.');
 return {ok:true,target:state.target,version:pkg.version,backup:child.backup,updatedEntry:path.join(state.target,'.runtime','dist','cli.mjs'),bootstrapPackageUnchanged:true,packageStage:stage,skillReloadRequired:true,hostDiscovery:{status:'pending',authority:'host'}};
}
export async function prepareUpdate({target,agent,check=checkUpdate,install=updateInstall}={}){
 // Self-owned standalone entry only. Bootstrap/source callers must select a host explicitly.
 if(!target){const candidate=await source();if(path.basename(ROOT)!=='.runtime')return {ok:true,status:'bootstrap-use-selected-runtime'};const receipt=await readJson(path.join(candidate,receiptName)).catch(()=>null);if(!receipt?.target||await fs.realpath(receipt.target)!==await fs.realpath(candidate))return {ok:true,status:'deferred',reason:'target-identity-unresolved'};target=receipt.target;}
 const o={target,agent:agent||'generic'};const recovery=statePath(target,'.recovery.json');
 if(await exists(recovery))throw new CliError('RECOVERY_REQUIRED','Interrupted update requires recovery before tasks.',{recovery});
 let policy;try{policy=await updatePolicy(o);}catch(e){return {ok:true,status:'deferred',reason:e.code};}
 if(policy.mode!=='auto'||process.env.TOAPISCLI_AUTO_UPDATE==='0'||process.env.TOAPISCLI_UPDATE_CHECK==='0')return {ok:true,status:'disabled'};
 o.agent=policy.agent;const release=await lock(statePath(target,'.auto.lock'));if(!release)return {ok:true,status:'deferred',reason:'update-busy'};
 try{
 const s=await skillStatus(o);if(!s.managed||s.edited)return {ok:true,status:'deferred',reason:'local-edits-or-ownership'};
 const result=await check();if(!result.available||!result.compatible)return {ok:true,status:result.available?'incompatible-update-available':'unchanged',...result};
 const attempt=statePath(target,'.attempt.json');let previous;try{previous=await readJson(attempt);}catch{if(await exists(attempt))return {ok:true,status:'deferred',reason:'invalid-attempt-preserved'};}
 if(previous?.version===result.latest&&Date.now()-previous.at<3600000)return {ok:true,status:'deferred',reason:'retry-backoff',...result};
 await replaceBackedUp(attempt,JSON.stringify({version:result.latest,at:Date.now(),phase:'installing'}),{privateFile:true});
 try{const updated=await install({...o,version:result.latest,yes:true});await replaceBackedUp(attempt,JSON.stringify({version:result.latest,at:Date.now(),phase:'complete',...updated}),{privateFile:true});return {...updated,status:'updated',previousVersion:VERSION};}
 catch(e){if(await exists(recovery)||e.code==='RECOVERY_REQUIRED')throw new CliError('RECOVERY_REQUIRED','Update state requires recovery before tasks.',{recovery});
 const after=await skillStatus(o);if(!after.current)throw new CliError('RECOVERY_REQUIRED','Previous runtime could not be verified after update failure.',{target});
 return {ok:true,status:'deferred',reason:e.code||'update-failed',...result};}
 }finally{await release();}
}
export function capabilities(){
 const flags={json:'boolean',help:'boolean'};const def=(args,sideEffects)=>({options:{...flags,...args},sideEffects});
 const commands={
  version:def({},[]),capabilities:def({},[]),doctor:def({},[]),
  'auth import':def({file:'string',replace:'boolean'},['credential-copy','free-network-validation']),
  'auth status':def({},[]),'models list':def({},['free-network','update-cache','automatic-compatible-update']),
  'models docs':def({model:'string'},['free-network']),
  'image generate':def({model:'string',prompt:'string','prompt-file':'string',resolution:'string',aspect:'string',reference:'string[]','out-directory':'string',submit:'boolean',wait:'boolean',timeout:'number'},['paid-generation','reference-upload','task-files','automatic-compatible-update']),
  'task get':def({directory:'string'},['free-network','task-snapshot']),
  'task wait':def({directory:'string',timeout:'number'},['free-network','task-snapshot','download']),
  'usage':def({start:'string',end:'string'},['free-network']),
  'balance':def({},['free-network']),
  'skill source':def({name:'string'},[]),'skill list':def({},[]),
  'skill status':def({target:'string',agent:'string'},[]),
  'skill install':def({target:'string',agent:'string','credentials-file':'string'},['selected-target-write','optional-credential-import']),
  'skill update':def({target:'string',agent:'string'},['selected-target-write','backup']),
  'prepare':def({},['registry-read','automatic-compatible-update','backup']),
  'update policy':def({target:'string',agent:'string',mode:'string'},['installation-policy']),
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
  automaticUpdates:{trigger:'prepare, models list and image generate; selected target-owned runtime',timeoutMs:1200,cacheHours:24,optOut:'TOAPISCLI_UPDATE_CHECK=0',automaticInstall:true,installCommand:'update install --target <exact-directory> --yes',scope:'selected Agent runtime and Skill; global bootstrap unchanged'},
  discoveryContract:{schemaVersion:1,entryPoints:[{argv:['capabilities','--json'],result:'json'}],commandsField:'commandContracts',version:{command:'version',argv:['version','--json'],fields:{package:'package',version:'version'}},skillCollection:{namesField:'skills',default:'toapiscli',selector:{option:'--name',type:'string'},enumeration:{argv:['skill','list','--json'],itemsField:'items',completeField:'complete'},namedSource:{argv:['skill','source','--name','{skill}','--json']}}},
  maintenanceContract:{schemaVersion:1,agentEligibility:'valid-name-with-generic-fallback',hostDiscoveryAuthority:'host',targetOptions:[{option:'--target',kind:'skill-directory',required:true}],source:{command:['skill','source','--json'],fields:{name:field('name'),package:field('package'),version:field('version'),path:field('path')}},status:{command:['skill','status','--target','{target}','--agent','{agent}','--json'],fields:{name:field('name'),package:field('package'),version:field('version'),target:field('target'),installed:field('installed','boolean'),managed:field('managed','boolean'),current:field('current','boolean'),edited:field('edited','boolean'),verification:field('verification','object'),recovery:field('recovery','object')}}}
 };
 for(const [name,c] of Object.entries(commands)){
  c.options=Object.fromEntries(Object.entries(c.options).map(([k,v])=>['--'+k,{type:v==='boolean'?'boolean':'string',...(v==='string[]'?{repeatable:true}:{})}]));
  c.effects=c.sideEffects;c.sideEffects=['update install','prepare','models list','image generate'].includes(name)?'package-and-skill-update':(['skill install','skill update','auth import','image generate','task get','task wait'].includes(name)?'local-write':'none');
 }
 manifest.installationLifecycle={...manifest.installationLifecycle,agentNeutral:true,targetRequired:true,hostRegistrationRequired:true,installationMode:'copy',sharedLinksAllowed:false,isolatedRuntimeRequired:true};
 manifest.automaticUpdates={...manifest.automaticUpdates,enabledByDefault:true,intervalHours:24,configuration:'TOAPISCLI_UPDATE_CHECK',disable:'TOAPISCLI_UPDATE_CHECK=0',policyCommand:'update policy --target <exact-directory> --mode auto|off',policyStorage:'outside package, scoped by exact target',compatibility:'stable same major; for 0.x same minor',disableInstall:'TOAPISCLI_AUTO_UPDATE=0',recovery:'Offline/failure uses verified previous runtime; interrupted sync blocks tasks until recovery.'};
 manifest.discoveryContract.entryPoints[0].result='manifest';
 manifest.discoveryContract.version.fields={package:field('package'),version:field('version')};
 manifest.discoveryContract.skillCollection.namedSource=['skill','source','--name','{skill}','--json'];
 manifest.maintenanceContract.source=manifest.maintenanceContract.source.fields;
 manifest.maintenanceContract.status=manifest.maintenanceContract.status.fields;
 manifest.maintenanceContract.targetOptions={'--target':{kind:'skill-directory',required:true}};
 return manifest;
}
