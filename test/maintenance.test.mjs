import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {spawnSync} from 'node:child_process';
import {checkUpdate,installSkill,skillStatus} from '../src/maintenance.mjs';
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
