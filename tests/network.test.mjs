import {test,beforeEach} from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {EventEmitter} from 'node:events';
import {PassThrough} from 'node:stream';
import {isPublicAddress, resolveTarget, fetchPublic} from '../renderer/network.mjs';
import {HostPacing,hostPacing} from '../renderer/pacing.mjs';
// Existing transport tests do not need real pacing delays or shared cooldowns.
beforeEach(t=>{
 t.mock.method(hostPacing,'acquire',async()=>{});
 t.mock.method(hostPacing,'observe',()=>{});
});
for (const ip of ['127.0.0.1','10.0.0.1','192.168.1.1','172.16.0.2','169.254.169.254','100.100.100.100','0.0.0.0','224.1.1.1','198.18.0.1','::1','::ffff:8.8.8.8','fc00::1','fe80::1','2001:db8::1']) test(`reject ${ip}`,()=>assert.equal(isPublicAddress(ip),false));
for (const ip of ['8.8.8.8','1.1.1.1','2606:4700:4700::1111']) test(`public ${ip}`,()=>assert.equal(isPublicAddress(ip),true));
test('reject credentials, protocol, ports and mixed DNS',async()=>{
 for(const url of ['file:///etc/passwd','https://u:p@example.test','https://example.test:8443']) await assert.rejects(resolveTarget(url));
 await assert.rejects(resolveTarget('https://example.test',async()=>[{address:'8.8.8.8',family:4},{address:'127.0.0.1',family:4}]));
});
test('pin resolved public IP',async()=>assert.equal((await resolveTarget('https://example.test',async()=>[{address:'8.8.8.8',family:4}])).address,'8.8.8.8'));
test('pinned lookup supports Node dual-stack lookup contract',async()=>{
 const {pinnedLookup}=await import('../renderer/network.mjs');
 const lookup=pinnedLookup({address:'8.8.8.8',family:4});
 lookup('example.test',{all:true},(err,addresses)=>assert.deepEqual(addresses,[{address:'8.8.8.8',family:4}]));
 lookup('example.test',{},(err,address,family)=>{assert.equal(address,'8.8.8.8');assert.equal(family,4);});
});

function mockResponses(t, responses) {
 const urls=[];
 t.mock.method(http,'request',(url,options,callback)=>{
  urls.push(url.href);
  const spec=responses.shift();
  assert.ok(spec,'unexpected request');
  const req=new EventEmitter();
  req.end=()=>queueMicrotask(()=>{
   const res=new PassThrough();
   res.statusCode=spec.status ?? 200;
   res.headers=spec.headers ?? {};
   res.on('close',()=>req.emit('close'));
   callback(res);
   res.end(spec.body ?? 'page');
  });
  req.destroy=error=>{req.emit('error',error);req.emit('close');};
  return req;
 });
 return urls;
}
test('fetch preserves response data',async t=>{
 mockResponses(t,[{headers:{'content-type':'text/html'},body:'hello'}]);
 assert.deepEqual(await fetchPublic('http://8.8.8.8/'),{url:'http://8.8.8.8/',status:200,type:'text/html',body:Buffer.from('hello')});
});
test('fetch follows relative redirects',async t=>{
 const urls=mockResponses(t,[{status:302,headers:{location:'/next'}},{}]);
 assert.equal((await fetchPublic('http://8.8.8.8/')).url,'http://8.8.8.8/next');
 assert.deepEqual(urls,['http://8.8.8.8/','http://8.8.8.8/next']);
});
test('fetch enforces size and status limits',async t=>{
 mockResponses(t,[{body:'too large'},{status:404}]);
 await assert.rejects(fetchPublic('http://8.8.8.8/',{limit:3}),/Response exceeds/);
 await assert.rejects(fetchPublic('http://8.8.8.8/'),/HTTP 404/);
});
test('fetch validates redirect targets and count',async t=>{
 mockResponses(t,[{status:302,headers:{location:'http://127.0.0.1/'}},{status:302,headers:{location:'/next'}}]);
 await assert.rejects(fetchPublic('http://8.8.8.8/'),/Private and reserved/);
 await assert.rejects(fetchPublic('http://8.8.8.8/',{redirects:0}),/Too many redirects/);
});
test('fetch rejects malformed redirect without an uncaught exception',async t=>{
 mockResponses(t,[{status:302,headers:{location:'http://['}}]);
 await assert.rejects(fetchPublic('http://8.8.8.8/'),/Invalid URL/);
});
for(const status of [429,503]) test(`HTTP ${status} prevents subsequent upstream requests until Retry-After expires`,async t=>{
 let time=100000;
 const pacing=new HostPacing({now:()=>time,sleep:async ms=>{time+=ms;}});
 t.mock.method(hostPacing,'acquire',pacing.acquire.bind(pacing));
 t.mock.method(hostPacing,'observe',pacing.observe.bind(pacing));
 const urls=mockResponses(t,[{status,headers:{'retry-after':'120'}},{}]);
 await assert.rejects(fetchPublic('http://8.8.8.8/'),new RegExp(`HTTP ${status}`));
 await assert.rejects(fetchPublic('http://8.8.8.8/next'),new RegExp(`HTTP ${status}`));
 assert.equal(urls.length,1);
 time+=120000;
 await fetchPublic('http://8.8.8.8/next');
 assert.equal(urls.length,2);
});
test('redirects also acquire a host request slot',async t=>{
 const acquired=[];
 t.mock.method(hostPacing,'acquire',async url=>acquired.push(url));
 mockResponses(t,[{status:302,headers:{location:'/next'}},{}]);
 await fetchPublic('http://8.8.8.8/');
 assert.deepEqual(acquired,['http://8.8.8.8/','http://8.8.8.8/next']);
});
