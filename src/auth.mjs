import fs from 'node:fs/promises';
import path from 'node:path';
import {CliError,configDir,exists,readJson,newJson,replaceBackedUp} from './storage.mjs';
import {connect,models} from './mcp.mjs';
export function parseCredentialFile(d){
 if(!d||typeof d!=='object'||Array.isArray(d)||d.schemaVersion!==1||typeof d.apiKey!=='string'||!/^sk-[A-Za-z0-9_-]{12,}$/.test(d.apiKey)||!['cn','com'].includes(d.site))throw new CliError('INVALID_CREDENTIAL_FILE','Expected schemaVersion:1, site:cn|com and a valid apiKey.');
 if(Object.keys(d).some(k=>!['schemaVersion','site','apiKey','label'].includes(k)))throw new CliError('INVALID_CREDENTIAL_FILE','Unknown credential field.');
 if(d.label!==undefined&&(typeof d.label!=='string'||d.label.length>100))throw new CliError('INVALID_CREDENTIAL_FILE','label must be a short string.');
 return {schemaVersion:1,site:d.site,apiKey:d.apiKey,...(d.label?{label:d.label}:{})};
}
export async function importCredentials(file,{replace=false,verify=true}={}){
 if(!file)throw new CliError('CREDENTIAL_FILE_REQUIRED','Specify the administrator-provided file using --file.');
 const source=path.resolve(file);const stat=await fs.lstat(source);if(!stat.isFile()||stat.isSymbolicLink()||stat.size>16384)throw new CliError('INVALID_CREDENTIAL_FILE','Expected a small regular JSON file.');
 let raw;try{raw=await readJson(source);}catch{throw new CliError('INVALID_CREDENTIAL_FILE','Credential file is not valid JSON.');}
 const data=parseCredentialFile(raw);const target=path.join(configDir(),'credentials.json');
 if(await exists(target)&&!replace)throw new CliError('CREDENTIALS_EXIST','A local credential file exists. Use --replace only when replacing it is authorized; a backup will be retained.');
 let available=[];
 if(verify){const m=await connect(data);try{available=await models(m);if(!available.length)throw new CliError('NO_ALLOWED_MODELS','This Key exposes none of the approved image models.');}finally{await m.close();}}
 await fs.mkdir(configDir(),{recursive:true,mode:0o700});
 const result=await exists(target)?await replaceBackedUp(target,JSON.stringify(data,null,2)+'\n',{privateFile:true}):{path:await newJson(target,data,{privateFile:true}),backup:null};
 const saved=await fs.stat(target);return {configured:true,site:data.site,label:data.label||null,models:available.map(m=>m.id),credentialSource:'administrator-file',path:result.path,backup:result.backup,permissions:process.platform==='win32'?'user-profile ACL; verify local policy':(saved.mode&0o777).toString(8),sourceFilePreserved:true};
}
