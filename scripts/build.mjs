import fs from 'node:fs/promises';
import {build} from 'esbuild';
import {capabilities} from '../src/maintenance.mjs';
import {VERSION} from '../src/constants.mjs';
import path from 'node:path';
import crypto from 'node:crypto';
// Build outputs are generated. Preserve prior outputs before replacement.
const backupRoot=path.resolve('../output/toapiscli-build-backup-'+crypto.randomUUID());
async function output(p,data){try{await fs.lstat(p);const b=path.join(backupRoot,p);await fs.mkdir(path.dirname(b),{recursive:true});await fs.copyFile(p,b,fs.constants.COPYFILE_EXCL);}catch(e){if(e.code!=='ENOENT')throw e;}await fs.mkdir(path.dirname(p),{recursive:true});await fs.writeFile(p,data);}
const skillPath='skills/toapiscli/SKILL.md';
const oldSkill=await fs.readFile(skillPath,'utf8');
const synchronizedSkill=oldSkill.replace(/(  version: )[0-9][^\n]*/,`$1${VERSION}`).replace(/(版本为 `)[^`]+(`)/,`$1${VERSION}$2`);
if(synchronizedSkill!==oldSkill)await output(skillPath,synchronizedSkill);
await fs.mkdir('dist',{recursive:true});
const result=await build({entryPoints:['src/cli.mjs'],bundle:true,platform:'node',format:'esm',target:'node22',write:false,banner:{js:"import { createRequire as __createRequire } from 'node:module'; const require = __createRequire(import.meta.url);"}});
await output('dist/cli.mjs',result.outputFiles[0].contents);
await output('capabilities.json',JSON.stringify(capabilities(),null,2)+'\n');
await fs.mkdir('skills/toapiscli/.runtime/dist',{recursive:true});
await output('skills/toapiscli/.runtime/dist/cli.mjs',result.outputFiles[0].contents);
await output('skills/toapiscli/.runtime/package.json',JSON.stringify({name:'@petercjl/toapiscli',version:VERSION,type:'module'},null,2)+'\n');
await output('skills/toapiscli/.runtime/capabilities.json',JSON.stringify(capabilities(),null,2)+'\n');
console.log('Built',VERSION,'with independent bundled MCP runtime.');
