import {test} from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {EventEmitter} from 'node:events';
import {chromium} from 'playwright';
import {createRenderer,fetchDocument} from '../renderer/render.mjs';
import {HostPacing,hostPacing} from '../renderer/pacing.mjs';
test('static fetch refuses localhost before connecting',()=>assert.rejects(fetchDocument('http://127.0.0.1/')));

import {ServiceError,errorResponse} from '../renderer/errors.mjs';
test('service errors expose a translation key and interpolation arguments',()=>{
 assert.deepEqual(errorResponse(new ServiceError('upstream_status',404)),{error:'Upstream HTTP 404',errorCode:'upstream_status',errorArgs:[404]});
 assert.deepEqual(errorResponse(new Error('fixture failure')),{error:'fixture failure'});
});
test('network errors retain their translation key',()=>assert.rejects(fetchDocument('http://127.0.0.1/'),error=>error.errorCode==='private_address'));

// Exercise the renderer's route/response wiring without contacting a website.
async function rendererFixture(t,status=200,redirect) {
 let time=100000,routeHandler,currentURL,aborted=false,navigations=0,paused,redirecting=false;
 const waits=[],frame={};
 const pacing=new HostPacing({now:()=>time,sleep:async ms=>{waits.push(ms);time+=ms;}});
 for(const method of ['acquire','check','observe'])t.mock.method(hostPacing,method,pacing[method].bind(pacing));
 const server=new EventEmitter();
 server.listen=(_port,_host,callback)=>callback();server.address=()=>({port:12345});server.close=()=>{};
 t.mock.method(http,'createServer',()=>server);
 const page=new EventEmitter();
 const response={url:()=>currentURL,status:()=>status,headers:()=>({'retry-after':'120'}),ok:()=>status===200};
 async function request(url,navigation=true) {
  aborted=false;
  await routeHandler({
   request:()=>({url:()=>url,resourceType:()=>navigation?'document':'script',isNavigationRequest:()=>navigation,frame:()=>frame}),
   continue:async()=>{if(navigation){navigations++;page.emit('response',response);}},
   abort:async()=>{aborted=true;}
  });
 }
 page.mainFrame=()=>frame;
 const session={on:(_event,handler)=>{paused=handler;},send:async(method)=>{
  if(method==='Page.getFrameTree')return {frameTree:{frame:{id:'main'}}};
  if(method==='Fetch.continueRequest') {
   if(redirecting){navigations++;page.emit('response',response);}
   else await request(currentURL);
  }
  if(method==='Fetch.failRequest')aborted=true;
 }};
 page.goto=async url=>{
  currentURL=url;aborted=false;
  if(paused)await paused({requestId:'first',request:{url},frameId:'main',resourceType:'Document'});
  else await request(url);
  if(aborted)throw Error('navigation aborted');
  // Chromium does not invoke Playwright routes again for HTTP redirects.
  if(redirect){
   currentURL=redirect;redirecting=true;
   await paused({requestId:'redirect',request:{url:redirect},frameId:'main',resourceType:'Document'});
   if(aborted)throw Error('redirect aborted');
  }
  return response;
 };
 page.url=()=>currentURL;page.waitForLoadState=async()=>{};page.waitForTimeout=async()=>{};
 page.evaluate=async()=>'<html><body>Article</body></html>';
 const context={route:async(_pattern,handler)=>{routeHandler=handler;},newPage:async()=>page,newCDPSession:async()=>session,close:async()=>{}};
 t.mock.method(chromium,'launch',async()=>({version:()=> '123',newContext:async()=>context,close:async()=>{}}));
 const renderer=await createRenderer();t.after(()=>renderer.close());
 return {renderer,pacing,request,waits,page,aborted:()=>aborted,navigations:()=>navigations};
}
for(const status of [429,503]) test(`rendered HTTP ${status} blocks subsequent render and plain fetches`,async t=>{
 const {renderer,navigations}=await rendererFixture(t,status);
 await assert.rejects(renderer.render('https://8.8.8.8/'),new RegExp(`HTTP ${status}`));
 await assert.rejects(renderer.render('http://8.8.8.8/next'),new RegExp(`HTTP ${status}`));
 await assert.rejects(fetchDocument('http://8.8.8.8/next'),new RegExp(`HTTP ${status}`));
 assert.equal(navigations(),1);
});
test('browser redirects acquire another request slot even when Playwright routing is skipped',async t=>{
 const {renderer,waits,navigations}=await rendererFixture(t,200,'https://8.8.8.8/redirected');
 await renderer.render('https://8.8.8.8/');
 assert.deepEqual(waits,[2000]);assert.equal(navigations(),2);
});
test('browser redirects cannot contact a host in cooldown',async t=>{
 const {renderer,pacing,navigations}=await rendererFixture(t,200,'https://1.1.1.1/redirected');
 pacing.observe('https://1.1.1.1/',503,'120');
 await assert.rejects(renderer.render('https://8.8.8.8/'),/HTTP 503/);
 assert.equal(navigations(),1);
});
test('Chromium navigation shares pacing while subresources respect host cooldown',async t=>{
 const {renderer,pacing,request,waits,aborted}=await rendererFixture(t);
 await renderer.render('https://8.8.8.8/');
 await request('https://8.8.8.8/script.js',false);
 assert.deepEqual(waits,[]);
 await renderer.render('https://8.8.8.8/next');
 assert.deepEqual(waits,[2000]);
 pacing.observe('https://8.8.8.8/',503);
 await request('https://8.8.8.8/script.js',false);
 assert.equal(aborted(),true);
 await request('https://1.1.1.1/script.js',false);
 assert.equal(aborted(),false);
});
