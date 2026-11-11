import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {StreamableHTTPClientTransport} from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import {PACKAGE,VERSION,ENDPOINTS,MODELS} from './constants.mjs';
import {CliError,redact} from './storage.mjs';
export function unpack(result){
 const data=result.structuredContent || JSON.parse(result.content?.find(c=>c.type==='text')?.text||'{}');
 if((result.isError||data.error)&&data.state!=='failed')throw new CliError(data.error?.code||'PROVIDER_ERROR',data.error?.message||'MCP operation failed.',{provider:data});
 return data;
}
export async function connect(credential){
 const endpoint=ENDPOINTS[credential.site];if(!endpoint)throw new CliError('INVALID_SITE','Site must be cn or com.');
 const client=new Client({name:PACKAGE,version:VERSION});
 const transport=new StreamableHTTPClientTransport(new URL(endpoint),{requestInit:{headers:{Authorization:'Bearer '+credential.apiKey}}});
 try{await client.connect(transport,{timeout:20000});}catch(e){await transport.close().catch(()=>{});throw new CliError('MCP_CONNECTION_FAILED',redact(e.message,credential.apiKey));}
 return {close:()=>client.close(),async call(name,args={}){try{return unpack(await client.callTool({name,arguments:args},undefined,{timeout:45000}));}catch(e){if(e instanceof CliError)throw e;throw new CliError('MCP_REQUEST_UNKNOWN',redact(e.message,credential.apiKey),{tool:name});}}};
}
export async function models(mcp){
 const items=[];let after;let pages=0;
 do{const d=await mcp.call('list_models',{type:'image',limit:100,...(after?{after}:{})});items.push(...(d.models||[]));after=d.has_more?d.next_after:undefined;if(d.has_more&&!after)throw new CliError('PAGINATION_ERROR','Missing model cursor.');if(++pages>20)throw new CliError('PAGINATION_ERROR','Too many model pages.');}while(after);
 return items.filter(m=>MODELS.includes(m.id));
}
export function allowed(model){if(!MODELS.includes(model))throw new CliError('MODEL_NOT_ALLOWED','This image tool supports only its approved image models.',{allowedModels:MODELS});}
