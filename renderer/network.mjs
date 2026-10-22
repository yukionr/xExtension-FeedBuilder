import dns from 'node:dns/promises';
import net from 'node:net';
import http from 'node:http';
import https from 'node:https';
const denied = new net.BlockList();
for (const [a,p] of [['0.0.0.0',8],['10.0.0.0',8],['100.64.0.0',10],['127.0.0.0',8],['169.254.0.0',16],['172.16.0.0',12],['192.0.0.0',24],['192.0.2.0',24],['192.168.0.0',16],['198.18.0.0',15],['198.51.100.0',24],['203.0.113.0',24],['224.0.0.0',3]]) denied.addSubnet(a,p);
const global6 = new net.BlockList(); global6.addSubnet('2000::',3,'ipv6');
for (const [a,p] of [['2001::',23],['2001:db8::',32],['2002::',16],['3fff::',20]]) denied.addSubnet(a,p,'ipv6');
export function isPublicAddress(ip) {
 const family=net.isIP(ip);
 return family===4 ? !denied.check(ip,'ipv4') : family===6 && global6.check(ip,'ipv6') && !denied.check(ip,'ipv6');
}
export async function resolveTarget(input,lookup=(host)=>dns.lookup(host,{all:true})) {
 const url=new URL(input);
 if (!['http:','https:'].includes(url.protocol) || url.username || url.password || url.port) throw Error('公開 HTTP(S) URL（標準ポート）を指定してください');
 const host=url.hostname.replace(/^\[|\]$/g,'');
 const addresses=net.isIP(host) ? [{address:host,family:net.isIP(host)}] : await lookup(host);
 if (!addresses.length || addresses.some(x=>!isPublicAddress(x.address))) throw Error('内部・予約アドレスには接続できません');
 return {url,...addresses[0]};
}
export function pinnedLookup(target) {
 return (_host,options,callback)=>callback(null,options?.all?[{address:target.address,family:target.family}]:target.address,target.family);
}
async function readResponse(res, target, {limit,timeout,redirects,deadline}) {
 if ([301,302,303,307,308].includes(res.statusCode) && res.headers.location) {
  res.resume();
  if(redirects<=0) throw Error('リダイレクトが多すぎます');
  return fetchPublic(new URL(res.headers.location,target.url).href,{limit,timeout,redirects:redirects-1,deadline});
 }
 return new Promise((resolve,reject)=>{
  let size=0; const chunks=[];
  res.on('data',chunk=>{size+=chunk.length;if(size>limit){res.destroy(Error('応答サイズの上限を超えました'));}else chunks.push(chunk);});
  res.on('error',reject);
  res.on('end',()=>{ if(res.statusCode<200 || res.statusCode>=300) reject(Error(`取得先 HTTP ${res.statusCode}`)); else resolve({url:target.url.href,status:res.statusCode,type:res.headers['content-type']||'',body:Buffer.concat(chunks)});});
 });
}
export async function fetchPublic(input, {limit=5*1024*1024,timeout=30000,redirects=5,deadline=Date.now()+timeout}={}) {
 const target=await resolveTarget(input);
 timeout=Math.min(timeout,deadline-Date.now());
 if(timeout<=0)throw Error('取得タイムアウト');
 return new Promise((resolve,reject)=>{
  const transport=target.url.protocol==='https:'?https:http;
  const req=transport.request(target.url,{method:'GET',headers:{'user-agent':'FreshRSS-FeedBuilder/0.1','accept':'*/*'},lookup:pinnedLookup(target)},res=>{
   readResponse(res,target,{limit,timeout,redirects,deadline}).then(resolve,reject);
  });
  const timer=setTimeout(()=>req.destroy(Error('取得タイムアウト')),timeout);
  req.on('close',()=>clearTimeout(timer)); req.on('error',reject); req.end();
 });
}
// All Chromium traffic passes through this loopback-only, DNS-pinning proxy.
export async function startProxy() {
 const sockets=new Set();
 const server=http.createServer(async(req,res)=>{
  try {
   const target=await resolveTarget(req.url);
   if(target.url.protocol!=='http:') throw Error('CONNECT required');
   const upstream=http.request(target.url,{method:req.method,headers:{...req.headers,host:target.url.host},lookup:pinnedLookup(target)},response=>{res.writeHead(response.statusCode,response.headers);response.pipe(res);});
   upstream.setTimeout(30000,()=>upstream.destroy());upstream.on('error',()=>{if(!res.headersSent)res.writeHead(502);res.end();});req.pipe(upstream);
  } catch {res.writeHead(403);res.end();}
 });
 server.on('connection',s=>{sockets.add(s);s.on('close',()=>sockets.delete(s));});
 server.on('connect',async(req,client,head)=>{
  try {
   const target=await resolveTarget(`https://${req.url}`);
   if(client.destroyed)return;
   const remote=net.connect({host:target.address,port:443,family:target.family},()=>{client.write('HTTP/1.1 200 Connection Established\r\n\r\n');if(head.length)remote.write(head);client.pipe(remote);remote.pipe(client);});
   remote.setTimeout(30000,()=>remote.destroy());remote.on('error',()=>client.destroy());client.on('error',()=>remote.destroy());client.on('close',()=>remote.destroy());remote.on('close',()=>client.destroy());
  } catch {client.end('HTTP/1.1 403 Forbidden\r\n\r\n');}
 });
 await new Promise(r=>server.listen(0,'127.0.0.1',r));
 return {url:`http://127.0.0.1:${server.address().port}`,close:()=>{for(const s of sockets)s.destroy();server.close();}};
}
