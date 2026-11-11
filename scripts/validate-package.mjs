import fs from 'node:fs/promises';
import {VERSION} from '../src/constants.mjs';
const pkg=JSON.parse(await fs.readFile('package.json'));if(pkg.version!==VERSION)throw Error('Version drift');
const skill=await fs.readFile('skills/toapiscli/SKILL.md','utf8');if(!skill.includes('version: '+VERSION)||skill.includes('[TODO'))throw Error('Skill version or scaffold drift');
for(const f of ['dist/cli.mjs','skills/toapiscli/.runtime/dist/cli.mjs','INSTALL.md','UPDATE.md','capabilities.json'])await fs.access(f);
if((await fs.readFile('dist/cli.mjs','utf8'))!==(await fs.readFile('skills/toapiscli/.runtime/dist/cli.mjs','utf8')))throw Error('Runtime drift');
console.log('Package identity and isolated runtime verified.');
