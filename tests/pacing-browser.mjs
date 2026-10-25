import assert from 'node:assert/strict';
import {mock} from 'node:test';
import http from 'node:http';
import dns from 'node:dns/promises';
import {createRenderer,fetchDocument} from '../renderer/render.mjs';

// Only the synthetic public hostnames below resolve; all upstream HTTP goes to
// the local fixture. Exercise real Chromium, its proxy, and redirect handling.
const requests=[];
const fixture=http.createServer((req,res)=>{
 requests.push({path:req.url,time:Date.now()});
 if(req.url==='/redirect')res.writeHead(302,{location:'/article'});
 else if(req.url==='/redirect-busy')res.writeHead(302,{location:'http://source.test/article'});
 else if(req.url==='/redirect-private')res.writeHead(302,{location:'http://127.0.0.1/'});
 else if(req.url==='/resource-redirect')res.writeHead(302,{location:'http://source.test/resource-target'});
 else if(req.url==='/busy')res.writeHead(503,{'retry-after':'120'});
 else res.setHeader('content-type','text/html');
 res.end('<html><body><article>Fixture article</article>'+(req.url==='/with-script'?'<script src="/resource-redirect"></script>':'')+'</body></html>');
});
await new Promise(resolve=>fixture.listen(0,'127.0.0.1',resolve));
const upstreamRequest=http.request;
mock.method(dns,'lookup',async host=>{
 assert.ok(['source.test','other.test'].includes(host),`Unexpected DNS lookup: ${host}`);
 return [{address:'8.8.8.8',family:4}];
});
mock.method(http,'request',(url,options,callback)=>{
 assert.ok(['source.test','other.test'].includes(url.hostname),`Unexpected upstream: ${url.hostname}`);
 const local=new URL(url.pathname+url.search,`http://127.0.0.1:${fixture.address().port}`);
 return upstreamRequest(local,{...options,lookup:undefined},callback);
});
let renderer;
try {
 renderer=await createRenderer();
 const rendered=await renderer.render('http://source.test/redirect',{waitXPath:'//article'});
 assert.equal(rendered.url,'http://source.test/article');
 assert.match(rendered.html,/Fixture article/);
 const initial=requests.filter(r=>['/redirect','/article'].includes(r.path));
 assert.equal(initial.length,2);
 assert.ok(initial[1].time-initial[0].time>=1900,'redirect must respect the two-second pacing interval');
 console.log('ok real Chromium redirect pacing through the DNS-pinning proxy');

 await assert.rejects(renderer.render('http://source.test/busy'),/HTTP 503/);
 const count=requests.length;
 await assert.rejects(renderer.render('http://source.test/article'),/HTTP 503/);
 await assert.rejects(fetchDocument('http://source.test/article'),/HTTP 503/);
 assert.equal(requests.length,count,'cooldown must prevent actual upstream requests');
 console.log('ok real Chromium 503 cooldown shared with plain fetch');

 await renderer.render('http://other.test/article',{waitXPath:'//article'});
 const beforeRedirect=requests.length;
 await assert.rejects(renderer.render('http://other.test/redirect-busy'),/HTTP 503/);
 assert.equal(requests.length,beforeRedirect+1,'redirect into cooldown must not contact its target');
 await assert.rejects(renderer.render('http://other.test/redirect-private'),/Private and reserved/);
 await renderer.render('http://other.test/with-script',{waitXPath:'//article'});
 assert.ok(requests.some(r=>r.path==='/resource-redirect'));
 assert.equal(requests.some(r=>r.path==='/resource-target'),false,'subresource redirects must also respect cooldown');
 console.log('ok other hosts remain available and redirects cannot bypass cooldown or address validation');
} finally {
 await renderer?.close();
 fixture.closeAllConnections();await new Promise(resolve=>fixture.close(resolve));
 mock.restoreAll();
}
