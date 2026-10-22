import {ServiceError,errorResponse} from './errors.mjs';
import http from 'node:http';
import {createRenderer,fetchDocument} from './render.mjs';
const port=Number(process.env.PORT || 3000);
let renderer;
let starting;
let active=0;
const server=http.createServer(async(req,res)=>{
 res.setHeader('content-type','application/json; charset=utf-8');
 res.setHeader('cache-control','no-store');
 if(req.method==='GET' && req.url==='/ready') {
  try {if(!renderer){starting ??= createRenderer().finally(()=>{starting=undefined;});renderer=await starting;}res.end('{"ok":true}');}
  catch {res.writeHead(503);res.end('{"error":"Chromium sandbox is unavailable"}');}return;
 }
 if(req.method==='GET' && req.url==='/health') {res.end('{"ok":true}');return;}
 if(req.method!=='POST' || !['/fetch','/render'].includes(req.url)) {res.writeHead(404);res.end('{}');return;}
 if(active>=2) {res.writeHead(503);res.end(JSON.stringify(errorResponse(new ServiceError('service_busy'))));return;}
 active++;
 try {
  let body='';for await(const chunk of req){body+=chunk;if(body.length>16384)throw new ServiceError('request_large');}
  const input=JSON.parse(body);
  if(typeof input.url!=='string' || input.url.length>4096 || (input.waitXPath!==undefined && (typeof input.waitXPath!=='string' || input.waitXPath.length>4096)))throw new ServiceError('url_invalid');
  let result;
  if(req.url==='/fetch') result=await fetchDocument(input.url);
  else {
   if(!renderer){starting ??= createRenderer().finally(()=>{starting=undefined;});renderer=await starting;}
   result=await renderer.render(input.url,{waitXPath:input.waitXPath||'',preview:input.preview===true});
  }
  res.end(JSON.stringify(result));
 } catch(e){res.writeHead(422);res.end(JSON.stringify(errorResponse(e)));}
 finally{active--;}
});
server.requestTimeout=35000;
server.headersTimeout=5000;
server.listen(port,process.env.BIND || '127.0.0.1');
async function close(){server.close();server.closeAllConnections();if(starting)renderer=await starting.catch(()=>undefined);await renderer?.close();}
process.once('SIGTERM',()=>close());process.once('SIGINT',()=>close());
