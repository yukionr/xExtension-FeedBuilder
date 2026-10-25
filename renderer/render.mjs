import {ServiceError} from './errors.mjs';
import {chromium} from 'playwright';
import {resolveTarget,fetchPublic,startProxy} from './network.mjs';
import {hostPacing} from './pacing.mjs';
export async function createRenderer() {
 const proxy=await startProxy();
 let browser;
 try {browser=await chromium.launch({headless:true,chromiumSandbox:true,args:['--disable-quic','--force-webrtc-ip-handling-policy=disable_non_proxied_udp']});} catch(e){proxy.close();throw e;}
 let active=0;
 return {
  async render(url,{waitXPath='',preview=false}={}) {
   await resolveTarget(url);
   hostPacing.check(url);
   if(active>=2) throw new ServiceError('render_busy');
   active++;
   let context;
   const deadline=Date.now()+30000;
   try {
    context=await browser.newContext({userAgent:`Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${browser.version()} Safari/537.36`,viewport:{width:1280,height:900},locale:'ja-JP',serviceWorkers:'block',acceptDownloads:false,proxy:{server:proxy.url,bypass:'<-loopback>'}});
    const timer=setTimeout(()=>context.close().catch(()=>{}),30000);
    try {
     let navigationError;
     const page=await context.newPage();
     await context.route('**/*',async route=>{
      const request=route.request();
      if(!/^https?:/.test(request.url()) || ['media','font'].includes(request.resourceType())) return route.abort();
      try{
       await resolveTarget(request.url());
       if(request.isNavigationRequest() && request.frame()!==page.mainFrame())await hostPacing.acquire(request.url(),deadline);
       else hostPacing.check(request.url());
       await route.continue();
      }catch(error){
       if(request.isNavigationRequest() && request.frame()===page.mainFrame())navigationError=error;
       await route.abort();
      }
     });
     page.on('response',response=>hostPacing.observe(response.url(),response.status(),response.headers()['retry-after']));
     page.on('popup',popup=>popup.close());
     // Playwright routes skip HTTP redirect targets. Intercept requests in
     // Chromium as well, keeping DNS validation and the proxy on redirects.
     const session=await context.newCDPSession(page);
     const {frameTree}=await session.send('Page.getFrameTree');
     session.on('Fetch.requestPaused',async({requestId,request,frameId,resourceType})=>{
      const mainNavigation=frameId===frameTree.frame.id && resourceType==='Document';
      try {
       await resolveTarget(request.url);
       if(mainNavigation)await hostPacing.acquire(request.url,deadline);
       else hostPacing.check(request.url);
       await session.send('Fetch.continueRequest',{requestId});
      } catch(error) {
       if(mainNavigation)navigationError=error;
       await session.send('Fetch.failRequest',{requestId,errorReason:'Aborted'}).catch(()=>{});
      }
     });
     await session.send('Fetch.enable',{patterns:[{urlPattern:'*',requestStage:'Request'}]});
     const response=await page.goto(url,{waitUntil:'domcontentloaded',timeout:25000}).catch(error=>{throw navigationError || error;});
     if(!response || !response.ok()) throw new ServiceError('upstream_status',response?.status() || 0);
     if(waitXPath) await page.locator(`xpath=${waitXPath}`).first().waitFor({state:'attached',timeout:Math.max(1,deadline-Date.now()-1000)});
     else {
      // Bounded settling of the initial view; persistent network connections are common.
      await page.waitForLoadState('networkidle',{timeout:8000}).catch(()=>{});
      await page.waitForTimeout(Math.min(1500,Math.max(0,deadline-Date.now()-1000)));
     }
     await resolveTarget(page.url());
     const html=await snapshotPage(page,{preview,deadline});
     if(Buffer.byteLength(html)>5*1024*1024) throw new ServiceError('render_large');
     return {url:page.url(),html,status:response.status()};
    } finally {clearTimeout(timer);}
   } finally {if(context)await context.close().catch(()=>{});active--;}
  },
  async close(){await browser.close();proxy.close();}
 };
}
export async function fetchDocument(url) {
 const result=await fetchPublic(url);
 // HTML from this service is decoded once, before PHP DOM parsing.
 const charset=/charset\s*=\s*["']?([^\s;"']+)/i.exec(result.type)?.[1] || 'utf-8';
 let html;try{html=new TextDecoder(charset).decode(result.body);}catch{throw new ServiceError('charset_unsupported');}
 return {url:result.url,html,status:result.status,type:result.type};
}

export async function snapshotPage(page,{preview=false,deadline=Date.now()+30000}={}) {
     const images={};
     if(preview) {
      const sources=await page.locator('img').evaluateAll(nodes=>nodes.slice(0,16).map(n=>n.currentSrc || n.src));
      for(let i=0;i<sources.length && Date.now()<deadline-1500;i+=2) {
       await Promise.all(sources.slice(i,i+2).map(async(source,j)=>{
        try {const image=await fetchPublic(source,{limit:256*1024,timeout:Math.min(3000,Math.max(1,deadline-Date.now()-1000))});
         const type=image.type.split(';')[0];if(/^image\/(png|jpeg|gif|webp|avif)$/.test(type)) images[i+j]=`data:${type};base64,${image.body.toString('base64')}`;
        } catch {}
       }));
      }
     }
     return await page.evaluate(({preview,images})=>{
      const clone=document.documentElement.cloneNode(true);
      if(preview) {
       const originals=document.querySelectorAll('*');const copies=clone.querySelectorAll('*');
       const props=['display','visibility','opacity','pointer-events','z-index','position','box-sizing','width','max-width','min-height','height','margin','padding','gap','grid-template-columns','flex-direction','flex-wrap','align-items','justify-content','font-size','font-weight','line-height','color','background-color','border','border-radius','text-align','overflow'];
       // documentElement itself is excluded in both lists.
       const elements=[...originals].slice(1);
       copies.forEach((copy,i)=>{const style=getComputedStyle(elements[i]);copy.setAttribute('data-fb-style',props.map(p=>`${p}:${p==='position' && ['fixed','sticky'].includes(style[p])?'static':style.getPropertyValue(p)}`).join(';'));});
      }
      clone.querySelectorAll('img').forEach((n,i)=>{if(images[i])n.setAttribute('data-fb-image',images[i]);});
      return '<!doctype html>'+clone.outerHTML;
     },{preview,images});
}
