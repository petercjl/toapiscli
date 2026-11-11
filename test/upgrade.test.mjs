import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import http from 'node:http';
import crypto from 'node:crypto';
import {spawn} from 'node:child_process';
import {VERSION,PACKAGE} from '../src/constants.mjs';

function run(file,args,options={}){return new Promise((resolve,reject)=>{const p=spawn(file,args,{...options,stdio:['ignore','pipe','pipe']});let stdout='',stderr='';p.stdout.on('data',b=>stdout+=b);p.stderr.on('data',b=>stderr+=b);p.on('error',reject);p.on('close',code=>resolve({code,stdout,stderr}));});}
async function npm(args,options={}){
 const entry=process.env.npm_execpath||path.join(path.dirname(process.execPath),'node_modules/npm/bin/npm-cli.js');
 return process.platform==='win32'?run(process.execPath,[entry,...args],options):run('npm',args,options);
}
test('real npm candidate auto-upgrade uses new isolated entry; published 0.1.0 updater remains compatible',{timeout:120000},async()=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'toapiscli-upgrade-'));const candidate=path.join(root,'candidate');
 await fs.mkdir(candidate);const pkg=JSON.parse(await fs.readFile('package.json','utf8'));
 for(const file of [...pkg.files,'package.json'])await fs.cp(path.resolve(file),path.join(candidate,file),{recursive:true});
 const parts=VERSION.split('.').map(Number);parts[2]++;const next=parts.join('.');
 const cp=path.join(candidate,'package.json');const original=await fs.readFile(cp,'utf8');await fs.copyFile(cp,cp+'.backup');
 const json=JSON.parse(original);json.version=next;delete json.scripts;await fs.writeFile(cp,JSON.stringify(json));
 const sp=path.join(candidate,'skills/toapiscli/SKILL.md');const skill=await fs.readFile(sp,'utf8');await fs.copyFile(sp,sp+'.backup');await fs.writeFile(sp,skill.replaceAll(VERSION,next));await fs.unlink(sp+'.backup');
 for(const file of ['capabilities.json','skills/toapiscli/.runtime/package.json','skills/toapiscli/.runtime/capabilities.json']){const f=path.join(candidate,file);const d=JSON.parse(await fs.readFile(f,'utf8'));await fs.copyFile(f,f+'.backup');d.version=next;await fs.writeFile(f,JSON.stringify(d));await fs.unlink(f+'.backup');}
 const packed=await npm(['pack','--ignore-scripts','--json','--pack-destination',root],{cwd:candidate});assert.equal(packed.code,0,packed.stderr);
 const archives=(await fs.readdir(root)).filter(f=>f.endsWith('.tgz'));assert.equal(archives.length,1,'npm must create exactly one candidate archive');const tarball=await fs.readFile(path.join(root,archives[0]));
 let registry;const server=http.createServer((req,res)=>{if(req.url.endsWith('.tgz')){res.end(tarball);return;}res.setHeader('content-type','application/json');res.end(JSON.stringify({name:PACKAGE,'dist-tags':{latest:next},versions:{[next]:{name:PACKAGE,version:next,dist:{tarball:registry+'/candidate.tgz',integrity:'sha512-'+crypto.createHash('sha512').update(tarball).digest('base64')}}}}));});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));registry='http://127.0.0.1:'+server.address().port;
 const npmrc=path.join(root,'npmrc');await fs.writeFile(npmrc,'@petercjl:registry='+registry+'\n',{flag:'wx'});
 const env={...process.env,npm_config_userconfig:npmrc,TOAPISCLI_CONFIG_DIR:path.join(root,'config'),TOAPISCLI_UPDATE_CHECK:'0',npm_config_registry:registry,npm_config_fetch_retries:'0'};delete env.TOAPISCLI_API_KEY;
 const entry=path.resolve('bin/toapiscli.mjs');const a=path.join(root,'a/toapiscli'),b=path.join(root,'b/toapiscli');
 try{
  for(const target of [a,b]){const r=await run(process.execPath,[entry,'skill','install','--target',target,'--agent','future-host','--json'],{env});assert.equal(r.code,0,r.stdout);}
  const before=await fs.readFile(path.join(b,'.toapiscli-managed.json'),'utf8');
  const cache=path.join(env.TOAPISCLI_CONFIG_DIR,'update-cache.json');await fs.writeFile(cache,JSON.stringify({latest:next,checkedAt:Date.now()}),{flag:'wx'});
  const actual=path.join(a,'.runtime/dist/cli.mjs');const autoEnv={...env};delete autoEnv.TOAPISCLI_UPDATE_CHECK;
  // No credential: a real business trigger upgrades, then the NEW entry reports auth.
  const triggered=await run(process.execPath,[actual,'models','list','--json'],{env:autoEnv});const result=JSON.parse(triggered.stdout);
  assert.equal(triggered.code,1);assert.equal(result.error.code,'AUTH_REQUIRED');assert.equal(result.update.status,'updated');assert.equal(result.update.version,next);
  assert.equal(JSON.parse((await run(process.execPath,[actual,'version','--json'],{env})).stdout).version,next);
  assert.equal(await fs.readFile(path.join(b,'.toapiscli-managed.json'),'utf8'),before);
  assert.ok(result.update.backup);assert.equal(JSON.parse(await fs.readFile(path.join(result.update.backup,'.toapiscli-managed.json'),'utf8')).version,VERSION);
  // Use the immutable old public updater against the exact candidate via real npm.
  const historic=path.join(root,'historical');const old=await npm(['install','--ignore-scripts','--no-audit','--no-fund','--prefix',historic,PACKAGE+'@0.1.0','--registry','https://registry.npmjs.org','--@petercjl:registry=https://registry.npmjs.org'],{env});assert.equal(old.code,0,old.stderr);
  const oldEntry=path.join(historic,'node_modules/@petercjl/toapiscli/bin/toapiscli.mjs');
  const upgraded=await run(process.execPath,[oldEntry,'update','install','--target',b,'--agent','future-host','--version',next,'--yes','--json'],{env});assert.equal(upgraded.code,0,upgraded.stdout);
  assert.equal(JSON.parse((await run(process.execPath,[path.join(b,'.runtime/dist/cli.mjs'),'version','--json'],{env})).stdout).version,next);
  await fs.rm(historic,{recursive:true});await fs.rm(a,{recursive:true});assert.equal(JSON.parse((await run(process.execPath,[path.join(b,'.runtime/dist/cli.mjs'),'doctor','--json'],{env})).stdout).runtimePresent,true);
 }finally{server.closeAllConnections();await new Promise(r=>server.close(r));}
});
