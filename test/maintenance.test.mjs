import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {spawnSync} from 'node:child_process';
import {checkUpdate,installSkill,skillStatus,prepareUpdate,updatePolicy,newer,compatible} from '../src/maintenance.mjs';
import {VERSION} from '../src/constants.mjs';
const cli=path.resolve('bin/toapiscli.mjs');
const run=(entry,args)=>{const r=spawnSync(process.execPath,[entry,...args],{encoding:'utf8',env:{...process.env,TOAPISCLI_UPDATE_CHECK:'0'}});assert.equal(r.status,0,r.stdout+'\n'+r.stderr);return JSON.parse(r.stdout);};
test('structured help, source, doctor and version support real maintenance consumers',()=>{
 const help=run(cli,['--help','--json']);assert.equal(help.discoveryContract.schemaVersion,1);
 const source=run(cli,['skill','source','--json']);assert.equal(source.maintenanceContract.schemaVersion,1);assert.equal(source.items[0].ok,true);
 const statusHelp=run(cli,['skill','status','--help','--json']);assert.equal(statusHelp.options['--target'].type,'string');
 assert.equal(run(cli,['doctor','--json']).runtimePresent,true);
});
test('same-version update repairs missing runtime, preserves UI metadata, runs with bootstrap and sibling removed',async()=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'toapiscli-isolation-'));const a=path.join(root,'a','toapiscli'),b=path.join(root,'b','toapiscli');
 await installSkill({target:a,agent:'unnamed-agent'});await installSkill({target:b,agent:'generic'});
 const metadata=path.join(b,'agents','openai.yaml');await fs.writeFile(metadata,'interface:\n  display_name: Custom\n');
 await fs.unlink(path.join(b,'.runtime','dist','cli.mjs'));const updated=await installSkill({target:b,agent:'generic'});assert.ok(updated.backup);assert.ok(!updated.backup.startsWith(path.dirname(b)+path.sep),'Backup must not become another discoverable Skill');assert.match(await fs.readFile(metadata,'utf8'),/Custom/);assert.equal((await skillStatus({target:b})).current,true);
 await fs.rm(a,{recursive:true});
 const c=path.join(root,'bootstrap');await fs.mkdir(c);await fs.writeFile(path.join(c,'placeholder'),'test-only bootstrap');await fs.rm(c,{recursive:true});
 const entry=path.join(b,'.runtime','dist','cli.mjs');assert.equal(run(entry,['version','--json']).version,VERSION);assert.equal(run(entry,['doctor','--json']).runtimePresent,true);
 const manifest=run(entry,['capabilities','--json']);assert.equal(manifest.models.length,3);
});
test('automatic update detection is bounded, cached, opt-out and offline safe',async()=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'toapiscli-updates-'));const env=process.env.TOAPISCLI_CONFIG_DIR,off=process.env.TOAPISCLI_UPDATE_CHECK,original=globalThis.fetch;process.env.TOAPISCLI_CONFIG_DIR=root;delete process.env.TOAPISCLI_UPDATE_CHECK;let calls=0;
 try{
 globalThis.fetch=async()=>{calls++;return {ok:true,status:200,json:async()=>({version:'0.1.0-next.1'})};};
 await checkUpdate();assert.equal((await checkUpdate()).cached,true);assert.equal(calls,1);
 process.env.TOAPISCLI_UPDATE_CHECK='0';assert.equal((await checkUpdate()).enabled,false);assert.equal(calls,1);delete process.env.TOAPISCLI_UPDATE_CHECK;
 globalThis.fetch=async()=>{throw Error('offline');};assert.equal((await checkUpdate({force:true})).offline,true);
 }finally{globalThis.fetch=original;if(env===undefined)delete process.env.TOAPISCLI_CONFIG_DIR;else process.env.TOAPISCLI_CONFIG_DIR=env;if(off===undefined)delete process.env.TOAPISCLI_UPDATE_CHECK;else process.env.TOAPISCLI_UPDATE_CHECK=off;}
});

test('stable versions only upgrade forwards within compatibility boundary',()=>{
 assert.equal(newer('0.1.1','0.1.0'),true);assert.equal(newer('0.1.0','0.1.1'),false);
 assert.equal(newer('0.1.2-next.1','0.1.0'),false);assert.equal(newer('garbage','0.1.0'),false);
 assert.equal(compatible('0.2.0','0.1.0'),false);assert.equal(compatible('0.1.9','0.1.0'),true);
 assert.equal(compatible('1.9.0','1.0.0'),true);assert.equal(compatible('2.0.0','1.9.0'),false);
});
test('automatic installation honors target policy, locks, edits, backoff and recovery',async()=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'toapiscli-auto-'));
 const saved={config:process.env.TOAPISCLI_CONFIG_DIR,check:process.env.TOAPISCLI_UPDATE_CHECK};
 process.env.TOAPISCLI_CONFIG_DIR=path.join(root,'config');delete process.env.TOAPISCLI_UPDATE_CHECK;
 const a=path.join(root,'a','toapiscli'),b=path.join(root,'b','toapiscli');
 try{
 await installSkill({target:a,agent:'future-host'});await installSkill({target:b,agent:'generic'});
 const before=await fs.readFile(path.join(b,'.toapiscli-managed.json'),'utf8');
 assert.equal((await updatePolicy({target:a})).mode,'auto');let installs=0;
 const check=async()=>({available:true,compatible:true,latest:'0.1.99'});
 const install=async o=>{installs++;assert.equal(o.target,a);assert.equal(o.agent,'future-host');return {ok:true,updatedEntry:path.join(a,'.runtime/dist/cli.mjs')};};
 const one=await prepareUpdate({target:a,check,install});assert.equal(one.status,'updated');assert.equal(installs,1);
 assert.equal((await prepareUpdate({target:a,check,install})).reason,'retry-backoff');
 assert.equal(await fs.readFile(path.join(b,'.toapiscli-managed.json'),'utf8'),before);
 await updatePolicy({target:a,mode:'off'});assert.equal((await prepareUpdate({target:a,check,install})).status,'disabled');
 await updatePolicy({target:a,agent:'future-host',mode:'auto'});
 assert.equal((await prepareUpdate({target:a,check:async()=>({available:true,compatible:false}),install})).status,'incompatible-update-available');
 let release;const gate=new Promise(r=>release=r);const pending=prepareUpdate({target:a,check:async()=>{await gate;return {available:false}},install});
 await new Promise(r=>setTimeout(r,40));assert.equal((await prepareUpdate({target:a,check,install})).reason,'update-busy');release();await pending;
 await fs.appendFile(path.join(a,'SKILL.md'),'\nlocal change');assert.equal((await prepareUpdate({target:a,check,install})).reason,'local-edits-or-ownership');assert.equal(installs,1);
 // Malformed user policy is preserved and automatic work is deferred.
 const updates=path.join(process.env.TOAPISCLI_CONFIG_DIR,'updates');const files=await fs.readdir(updates);const policy=files.filter(x=>x.endsWith('.policy.json'));
 const ap=await Promise.all(policy.map(async f=>({file:path.join(updates,f),data:JSON.parse(await fs.readFile(path.join(updates,f),'utf8'))})));
 const pa=ap.find(p=>p.data.target===a).file;await fs.writeFile(pa,'{malformed');assert.equal((await prepareUpdate({target:a,check,install})).reason,'INVALID_POLICY');assert.equal(await fs.readFile(pa,'utf8'),'{malformed');
 }finally{for(const [key,value] of Object.entries({TOAPISCLI_CONFIG_DIR:saved.config,TOAPISCLI_UPDATE_CHECK:saved.check})){if(value===undefined)delete process.env[key];else process.env[key]=value;}}
});

test('failed synchronization rolls back with exact backup and interrupted receipt blocks new tasks',async()=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'toapiscli-rollback-'));const previous=process.env.TOAPISCLI_CONFIG_DIR;
 process.env.TOAPISCLI_CONFIG_DIR=path.join(root,'config');const target=path.join(root,'toapiscli');const copy=fs.copyFile;
 try{
 await installSkill({target});await fs.unlink(path.join(target,'.runtime/dist/cli.mjs'));
 const receipt=await fs.readFile(path.join(target,'.toapiscli-managed.json'),'utf8');
 fs.copyFile=async(from,to,...args)=>{if(to===path.join(target,'SKILL.md'))throw Error('simulated write denial');return copy(from,to,...args);};
 await assert.rejects(installSkill({target}),e=>e.code==='SKILL_SYNC_FAILED');fs.copyFile=copy;
 assert.equal(await fs.readFile(path.join(target,'.toapiscli-managed.json'),'utf8'),receipt);
 await installSkill({target});assert.equal((await skillStatus({target})).current,true);
 const u=path.join(process.env.TOAPISCLI_CONFIG_DIR,'updates');const policy=(await fs.readdir(u)).find(f=>f.endsWith('.policy.json'));const recovery=path.join(u,policy.replace('.policy.json','.recovery.json'));
 await fs.writeFile(recovery,JSON.stringify({target,phase:'sync-writing'}),{flag:'wx'});
 assert.equal((await skillStatus({target})).recovery.required,true);await assert.rejects(prepareUpdate({target}),e=>e.code==='RECOVERY_REQUIRED');
 }finally{fs.copyFile=copy;if(previous===undefined)delete process.env.TOAPISCLI_CONFIG_DIR;else process.env.TOAPISCLI_CONFIG_DIR=previous;}
});
