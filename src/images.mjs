import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import {CliError,exists,newJson,newFile,readJson} from './storage.mjs';
import {allowed,models} from './mcp.mjs';
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
export function imageParams(o){
 allowed(o.model);if(!o.prompt)throw new CliError('PROMPT_REQUIRED','Provide --prompt or --prompt-file.');
 const resolution=o.resolution||'2K',aspect=o.aspect||'1:1';
 if(!['1K','1.5K','2K','4K'].includes(resolution))throw new CliError('INVALID_RESOLUTION','Unsupported resolution.');
 let p={prompt:o.prompt,n:1};
 if(o.model==='doubao-seedream-5-5'){
  if(!['1K','1.5K','2K'].includes(resolution))throw new CliError('INVALID_RESOLUTION','Seedream supports 1K, 1.5K and 2K.');
  const sides=aspect.split(':').map(Number);if(sides.length!==2||sides.some(x=>!Number.isFinite(x)||x<=0))throw new CliError('INVALID_ASPECT','Invalid aspect ratio.');
  const ratio=sides[0]/sides[1];if(ratio<1/16||ratio>16)throw new CliError('INVALID_ASPECT','Seedream ratio is out of range.');
  const pixels=({'1K':1048576,'1.5K':2359296,'2K':4194304})[resolution];
  p.size=`${Math.round(Math.sqrt(pixels*ratio)/16)*16}x${Math.round(Math.sqrt(pixels/ratio)/16)*16}`;
 }else{
  const common=['1:1','3:2','2:3','4:3','3:4','16:9','9:16','5:4','4:5','21:9'];
  const aspects=o.model==='gemini-nano-banana-2.1'?[...common,'1:4','4:1','1:8','8:1']:common;
  if(!aspects.includes(aspect)||resolution==='1.5K')throw new CliError('INVALID_IMAGE_OPTIONS','Aspect ratio or resolution is unsupported.');
  p.size=aspect;
  if(o.model==='gemini-nano-banana-2.1')p.metadata={resolution};
  else {p.resolution=resolution;p.quality='high';p.output_format='png';}
 }
 return p;
}
export async function upload(mcp,file){
 const p=path.resolve(file);const s=await fs.stat(p);if(!s.isFile()||s.size>10*1024*1024||!['.png','.jpg','.jpeg','.webp'].includes(path.extname(p).toLowerCase()))throw new CliError('INVALID_REFERENCE','Reference must be PNG/JPEG/WebP, at most 10 MB.');
 const d=await mcp.call('create_upload',{});const url=new URL(d.upload_url);if(url.protocol!=='https:')throw new CliError('INVALID_UPLOAD_URL','Upload URL must use HTTPS.');
 const form=new FormData();form.append('file',new Blob([await fs.readFile(p)]),path.basename(p));
 const r=await fetch(url,{method:'POST',body:form,signal:AbortSignal.timeout(60000)});if(!r.ok)throw new CliError('UPLOAD_FAILED','Reference upload failed.',{status:r.status});
 const v=await r.json();const uploaded=v.url||v.data?.url;if(!uploaded||!/^https:\/\//.test(uploaded))throw new CliError('UPLOAD_FAILED','Upload returned no HTTPS URL.');return uploaded;
}
export async function record(dir,name,data){return newJson(path.join(dir,name+'-'+crypto.randomUUID()+'.json'),data);}
export async function generate(mcp,o){
 if(!o.submit)throw new CliError('SUBMIT_REQUIRED','Generation spends credits; pass --submit only for a user-authorized request.');
 const params=imageParams(o);const available=await models(mcp);if(!available.some(m=>m.id===o.model))throw new CliError('KEY_MODEL_DENIED','The configured Key does not expose this model.');
 const docs=await mcp.call('get_model_docs',{model:o.model});if(!docs.markdown)throw new CliError('MODEL_DOCS_UNAVAILABLE','Current model parameter documentation is unavailable.');
 const dir=path.resolve(o.outDirectory||'toapiscli-'+crypto.randomUUID());if(await exists(dir))throw new CliError('PATH_EXISTS','Use a new output directory.',{path:dir});
 const refs=o.reference||[];const max=o.model==='gemini-nano-banana-2.1'?14:10;if(refs.length>max)throw new CliError('TOO_MANY_REFERENCES',`At most ${max} references.`);
 // Validate every local input before creating uploads or a billable request.
 for(const ref of refs){const s=await fs.stat(ref);if(!s.isFile()||s.size>10*1024*1024)throw new CliError('INVALID_REFERENCE','Invalid reference file.');}
 await fs.mkdir(dir,{recursive:false});await newJson(path.join(dir,'model-docs.json'),docs);
 if(refs.length){const urls=[];for(const ref of refs)urls.push(await upload(mcp,ref));if(o.model==='gpt-image-2.6-sunburst')params.reference_images=urls;else params.image_urls=urls;}
 const request={client_request_id:crypto.randomUUID(),model:o.model,params};await newJson(path.join(dir,'request.json'),request);
 let result;try{result=await mcp.call('generate_image',request);}catch(e){await record(dir,'submission-error',{state:'unknown',code:e.code,message:e.message,client_request_id:request.client_request_id});throw new CliError('SUBMISSION_UNCERTAIN','Submission failed or response was lost. Query the saved request before any new generation.',{outputDirectory:dir,client_request_id:request.client_request_id});}
 await record(dir,'generation',result);
 return {outputDirectory:dir,result,request};
}
export async function query(mcp,dir){
 const request=await readJson(path.join(dir,'request.json'));allowed(request.model);
 const result=await mcp.call('get_generation',{client_request_id:request.client_request_id});await record(dir,'generation',result);return result;
}
export async function download(dir,result){
 const files=[];let i=0;
 for(const r of result.results||[]){if(r.type!=='image')continue;const u=new URL(r.url);if(u.protocol!=='https:')throw new CliError('INVALID_RESULT_URL','Expected HTTPS image URL.');
  const extension=path.extname(u.pathname).toLowerCase();const file=path.join(dir,`image-${++i}${['.png','.jpg','.jpeg','.webp'].includes(extension)?extension:'.png'}`);
  if(await exists(file)){files.push({path:file,url:r.url,existing:true});continue;}
  const response=await fetch(u,{signal:AbortSignal.timeout(60000)});if(!response.ok)throw new CliError('DOWNLOAD_FAILED','Result download failed.',{status:response.status,url:r.url});
  const buffer=Buffer.from(await response.arrayBuffer());await newFile(file,buffer);files.push({path:file,url:r.url,bytes:buffer.length});
 }
 return files;
}
export async function waitFor(mcp,dir,{timeout=300,initial}={}){
 let result=initial||await query(mcp,dir);const start=Date.now();
 while(result.state==='running'&&(Date.now()-start)<timeout*1000){await sleep(Math.max(1,result.poll_after_seconds||5)*1000);result=await query(mcp,dir);}
 const files=result.state==='succeeded'?await download(dir,result):[];
 return {outputDirectory:dir,result,artifacts:files,task_id:result.task_id||null,cost:result.billing||null,warnings:result.state==='running'?['Still running. Resume with task wait; do not regenerate.']:[]};
}
