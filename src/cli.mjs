import fs from 'node:fs/promises';
import path from 'node:path';
import {PACKAGE,VERSION} from './constants.mjs';
import {CliError,credential,authStatus,redact,exists} from './storage.mjs';
import {importCredentials} from './auth.mjs';
import {connect,models,allowed} from './mcp.mjs';
import {generate,query,waitFor} from './images.mjs';
import {capabilities,skillSource,skillStatus,installSkill,checkUpdate,updateInstall,ROOT,targetOptions} from './maintenance.mjs';
function parse(argv){
 const o={},words=[];for(let i=0;i<argv.length;i++){const a=argv[i];if(a.startsWith('--')){const k=a.slice(2);if(!k||k.includes('='))throw new CliError('INVALID_OPTION','Use --option value.');const booleans=['json','help','replace','submit','wait','yes'];let v=booleans.includes(k)?true:argv[++i];if(v===undefined||String(v).startsWith('--'))throw new CliError('MISSING_OPTION_VALUE',`Missing value for --${k}.`);if(k==='reference')(o[k]??=[]).push(v);else if(k in o)throw new CliError('DUPLICATE_OPTION',`Duplicate --${k}.`);else o[k]=v;}else words.push(a);}
 const key=words.join(' ')||'help';const contract=capabilities().commandContracts[key];if(!contract)throw new CliError('UNKNOWN_COMMAND','Unknown command.',{command:key});for(const k of Object.keys(o))if(!('--'+k in contract.options))throw new CliError('UNKNOWN_OPTION',`Unsupported option --${k}.`,{command:key});return {key,o};
}
function humanHelp(){return {ok:true,package:PACKAGE,version:VERSION,commandNames:Object.keys(capabilities().commandContracts),configuration:'Ask the current Agent: install @petercjl/toapiscli using the attached administrator configuration file.',developerUsage:{import:'toapiscli auth import --file <admin-config.json> --json',install:'toapiscli skill install --target <exact-skill-directory> --agent <current-agent> --credentials-file <admin-config.json> --json',generate:'toapiscli image generate --model <approved-model> --prompt <text> --resolution 2K --out-directory <new-directory> --submit --wait --json'}};}
async function main(){
 const args=process.argv.slice(2);if(args.length===1&&['--version','-v','-V'].includes(args[0]))return {ok:true,package:PACKAGE,version:VERSION};if(args.length===1&&['--help','-h'].includes(args[0]))return humanHelp();
 const {key,o}=parse(args);if(o.help||key==='help')return {...capabilities(),...humanHelp(),options:capabilities().commandContracts[key].options};
 if(key==='version')return {ok:true,package:PACKAGE,version:VERSION};if(key==='capabilities')return capabilities();
 if(key==='installation-notice'){process.stderr.write('toapiscli: CLI installed. Current Agent must complete INSTALL.md: import administrator configuration file, install the canonical Skill into its own explicit directory, and verify discovery.\n');return {ok:true,phase:'cli-installed',skillRequired:true};}
 if(key==='doctor')return {ok:true,package:PACKAGE,version:VERSION,node:process.version,runtimeEntry:process.argv[1],runtimePresent:await exists(path.join(ROOT,'dist','cli.mjs')),auth:await authStatus(),hostDiscovery:{authority:'host',status:'pending'},windowsPermissions:'User-profile ACL must restrict credentials to the user; POSIX mode is enforced on macOS/Linux.'};
 if(key==='auth status')return {ok:true,...await authStatus()};if(key==='auth import')return {ok:true,...await importCredentials(o.file,{replace:o.replace})};
 if(key==='skill source'||key==='skill list'){if(o.name&&o.name!=='toapiscli')throw new CliError('UNKNOWN_SKILL','Unknown Skill name.');return skillSource();}
 if(key==='skill status')return skillStatus(o);
 if(['skill install','skill update'].includes(key)){targetOptions(o);const s=await skillStatus(o);if(s.installed&&(!s.managed||s.edited))throw new CliError('TARGET_CONFLICT','Resolve existing target before installation.');let auth;if(o['credentials-file'])auth=await importCredentials(o['credentials-file']);return {...await installSkill(o),...(auth?{auth}:{})};}
 if(key==='update check')return {ok:true,...await checkUpdate({force:true})};if(key==='update install')return updateInstall(o);
 let update;if(['models list','image generate'].includes(key))update=await checkUpdate();
 const c=await credential();const m=await connect(c);
 try{
  if(key==='models list')return {ok:true,models:await models(m),update};
  if(key==='models docs'){allowed(o.model);return {ok:true,...await m.call('get_model_docs',{model:o.model})};}
  if(key==='balance'){const d=await m.call('get_balance',{});return {ok:true,key:d.key,credits_per_usd:d.credits_per_usd};}
  if(key==='usage'){if(!o.start||!o.end)throw new CliError('TIME_RANGE_REQUIRED','Provide RFC3339 --start and --end with offsets.');return {ok:true,...await m.call('get_usage',{start:o.start,end:o.end})};}
  if(key==='image generate'){
   if(o.prompt&&o['prompt-file'])throw new CliError('CONFLICTING_INPUT','Use --prompt or --prompt-file.');
   const prompt=o['prompt-file']?await fs.readFile(o['prompt-file'],'utf8'):o.prompt;
   const result=await generate(m,{...o,prompt,outDirectory:o['out-directory']});
   return {ok:true,...(o.wait?await waitFor(m,result.outputDirectory,{initial:result.result,timeout:timeout(o.timeout)}):result),update};
  }
  if(key.startsWith('task ')){if(!o.directory)throw new CliError('DIRECTORY_REQUIRED','Provide the existing task directory.');const dir=path.resolve(o.directory);return {ok:true,...(key==='task get'?{outputDirectory:dir,result:await query(m,dir)}:await waitFor(m,dir,{timeout:timeout(o.timeout)}))};}
 }finally{await m.close();}
}
function timeout(v){const n=v===undefined?300:Number(v);if(!Number.isFinite(n)||n<1||n>900)throw new CliError('INVALID_TIMEOUT','Timeout must be 1 to 900 seconds.');return n;}
try{const result=await main();process.stdout.write(JSON.stringify(result,null,2)+'\n');if(result?.result&&['failed','unknown'].includes(result.result.state))process.exitCode=1;}catch(e){const message=redact(e.message,process.env.TOAPISCLI_API_KEY);process.stdout.write(JSON.stringify({ok:false,error:{code:e.code||'INTERNAL_ERROR',message,details:e.details||{}}},null,2)+'\n');process.exitCode=1;}
