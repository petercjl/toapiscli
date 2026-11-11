import {readFileSync} from 'node:fs';
export const PACKAGE = '@petercjl/toapiscli';
export const VERSION = JSON.parse(readFileSync(new URL('../package.json',import.meta.url),'utf8')).version;
export const MODELS = ['doubao-seedream-5-5', 'gemini-nano-banana-2.1', 'gpt-image-2.6-sunburst'];
export const ENDPOINTS = {cn:'https://api.toapis.cn/mcp',com:'https://api.toapis.com/mcp'};
