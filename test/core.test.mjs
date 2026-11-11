import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {parseCredentialFile,importCredentials} from '../src/auth.mjs';
import {imageParams,generate,query} from '../src/images.mjs';
import {MODELS} from '../src/constants.mjs';
import {unpack} from '../src/mcp.mjs';
import {installSkill,skillStatus,targetOptions} from '../src/maintenance.mjs';
test('credential file is data only; malformed and executable options rejected',()=>{
 const d={schemaVersion:1,site:'cn',apiKey:'sk-'+'x'.repeat(25),label:'employee'};assert.equal(parseCredentialFile(d).label,'employee');
 for(const v of [{...d,command:'echo test'},{...d,site:'attacker'},{...d,apiKey:42},{apiKey:d.apiKey}])assert.throws(()=>parseCredentialFile(v));
});
test('import protects existing credentials, never truncates supplied file',async()=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'toapiscli-auth-'));const old=process.env.TOAPISCLI_CONFIG_DIR;process.env.TOAPISCLI_CONFIG_DIR=path.join(root,'config');
 try{const file=path.join(root,'employee.json');const content=JSON.stringify({schemaVersion:1,site:'cn',apiKey:'sk-'+'x'.repeat(25)});await fs.writeFile(file,content);await importCredentials(file,{verify:false});await assert.rejects(importCredentials(file,{verify:false}),e=>e.code==='CREDENTIALS_EXIST');const r=await importCredentials(file,{verify:false,replace:true});assert.ok(r.backup);assert.equal(await fs.readFile(file,'utf8'),content);if(process.platform!=='win32')assert.equal((await fs.stat(r.path)).mode&0o777,0o600);}finally{if(old===undefined)delete process.env.TOAPISCLI_CONFIG_DIR;else process.env.TOAPISCLI_CONFIG_DIR=old;}
});
test('explicit approved model and 2K parameters preserved; disallowed model cannot submit',()=>{
 assert.equal(imageParams({model:MODELS[0],prompt:'test',resolution:'2K'}).size,'2048x2048');
 assert.equal(imageParams({model:MODELS[1],prompt:'test',resolution:'2K'}).metadata.resolution,'2K');
 assert.equal(imageParams({model:MODELS[2],prompt:'test',resolution:'2K'}).quality,'high');
 assert.throws(()=>imageParams({model:'gpt-image-2.6-sunburst-official',prompt:'test'}),e=>e.code==='MODEL_NOT_ALLOWED');
 assert.throws(()=>imageParams({model:MODELS[0],prompt:'test',resolution:'4K'}));
});
test('unknown paid submission is journaled, query resumes original ID without resubmit',async()=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'toapiscli-task-'));const out=path.join(root,'task');let submits=0;let original;
 const m={call:async(name,args)=>{if(name==='list_models')return {models:MODELS.map(id=>({id})),has_more:false};if(name==='get_model_docs')return {markdown:'docs'};if(name==='generate_image'){submits++;original=args.client_request_id;throw Error('lost response');}if(name==='get_generation'){assert.equal(args.client_request_id,original);return {state:'running',client_request_id:original};}throw Error(name);}};
 await assert.rejects(generate(m,{model:MODELS[0],prompt:'test',submit:true,outDirectory:out}),e=>e.code==='SUBMISSION_UNCERTAIN');assert.ok((await fs.readFile(path.join(out,'request.json'),'utf8')).includes(original));await query(m,out);assert.equal(submits,1);
});
test('explicit provider failure remains failed rather than an unknown resubmission',()=>{assert.equal(unpack({isError:true,structuredContent:{state:'failed',error:{message:'denied'}}}).state,'failed');});
test('generic host install requires exact target; protects edits, repairs missing runtime, remains isolated',async()=>{
 assert.throws(()=>targetOptions({agent:'arbitrary-agent'}),e=>e.code==='TARGET_REQUIRED');assert.throws(()=>targetOptions({agent:'../bad',target:'/tmp/toapiscli'}));
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'toapiscli-install-'));const one=path.join(root,'one','toapiscli');const two=path.join(root,'two','toapiscli');
 for(const target of [one,two])assert.equal((await installSkill({target,agent:'arbitrary-agent'})).current,true);
 const before=(await fs.stat(path.join(two,'SKILL.md'))).mtimeMs;assert.equal((await installSkill({target:two})).changed,false);assert.equal((await fs.stat(path.join(two,'SKILL.md'))).mtimeMs,before);
 await fs.unlink(path.join(two,'.runtime','dist','cli.mjs'));assert.equal((await skillStatus({target:two})).current,false);assert.equal((await installSkill({target:two})).current,true);
 await fs.appendFile(path.join(one,'SKILL.md'),'\nlocal edit');await assert.rejects(installSkill({target:one}),e=>e.code==='LOCAL_EDITS');
 const unmanaged=path.join(root,'unmanaged','toapiscli');await fs.mkdir(unmanaged,{recursive:true});await fs.writeFile(path.join(unmanaged,'SKILL.md'),'mine');await assert.rejects(installSkill({target:unmanaged}),e=>e.code==='UNMANAGED_TARGET');
 assert.notEqual((await fs.stat(path.join(two,'.runtime','dist','cli.mjs'))).ino,(await fs.stat(path.join(one,'.runtime','dist','cli.mjs'))).ino);
});
