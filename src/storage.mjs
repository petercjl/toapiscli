import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
export class CliError extends Error { constructor(code,message,details={}){super(message);this.code=code;this.details=details;} }
export const configDir=()=>path.resolve(process.env.TOAPISCLI_CONFIG_DIR || path.join(os.homedir(),'.config','toapiscli'));
export const exists=async p=>!!(await fs.lstat(p).catch(e=>{if(e.code==='ENOENT')return null;throw e;}));
export async function readJson(p){return JSON.parse(await fs.readFile(p,'utf8'));}
export async function newFile(p,data,{privateFile=false}={}){
  if(await exists(p))throw new CliError('PATH_EXISTS','Target exists; choose a new path.',{path:p});
  await fs.mkdir(path.dirname(p),{recursive:true,mode:privateFile?0o700:0o755});
  await fs.writeFile(p,data,{flag:'wx',mode:privateFile?0o600:0o644});
  return p;
}
export const newJson=(p,data,opts)=>newFile(p,JSON.stringify(data,null,2)+'\n',opts);
export async function replaceBackedUp(p,data,{privateFile=false}={}){
  let backup=null;
  if(await exists(p)){
    const s=await fs.lstat(p);if(!s.isFile()||s.isSymbolicLink())throw new CliError('UNSAFE_PATH','Refusing a non-regular target.',{path:p});
    backup=p+'.backup-'+crypto.randomUUID();await fs.copyFile(p,backup,fs.constants.COPYFILE_EXCL);if(privateFile)await fs.chmod(backup,0o600);
  }
  const tmp=p+'.new-'+crypto.randomUUID();await newFile(tmp,data,{privateFile});await fs.rename(tmp,p);
  return {path:p,backup};
}
export async function credential(){
  const p=path.join(configDir(),'credentials.json');
  if(process.env.TOAPISCLI_API_KEY)return {apiKey:process.env.TOAPISCLI_API_KEY,site:process.env.TOAPISCLI_SITE||'cn',source:'environment'};
  if(!await exists(p))throw new CliError('AUTH_REQUIRED','Ask the current Agent to open toapiscli configuration.');
  const s=await fs.lstat(p);if(s.isSymbolicLink()||!s.isFile())throw new CliError('UNSAFE_CREDENTIAL_PATH','Credential path must be a regular file.');
  if(process.platform!=='win32'&&(s.mode&0o077))throw new CliError('CREDENTIAL_PERMISSIONS','Credential file must be accessible only to its owner.');
  return {...await readJson(p),source:'local-protected-file'};
}
export async function authStatus(){try{const c=await credential();return {configured:true,site:c.site,source:c.source};}catch(e){if(e.code==='AUTH_REQUIRED')return {configured:false};throw e;}}
export function redact(value,key){return String(value).split(key||'\u0000').join('[REDACTED]').replace(/sk-[A-Za-z0-9_-]{12,}/g,'[REDACTED]');}
