import {chromium} from 'playwright';
import {resolveTarget,fetchPublic,startProxy} from './network.mjs';
export async function createRenderer() {
 const proxy=await startProxy();
 let browser;
 try {browser=await chromium.launch({headless:true,chromiumSandbox:true,args:['--disable-quic','--force-webrtc-ip-handling-policy=disable_non_proxied_udp']});} catch(e){proxy.close();throw e;}
 let active=0;
 return {
  async render(url,{waitXPath='',preview=false}={}) {
   await resolveTarget(url);
   if(active>=2) throw Error('描画が混み合っています。再試行してください');
   active++;
   let context;
   const deadline=Date.now()+30000;
   try {
    context=await browser.newContext({userAgent:`Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${browser.version()} Safari/537.36`,viewport:{width:1280,height:900},locale:'ja-JP',serviceWorkers:'block',acceptDownloads:false,proxy:{server:proxy.url,bypass:'<-loopback>'}});
    const timer=setTimeout(()=>context.close().catch(()=>{}),30000);
    try {
     await context.route('**/*',async route=>{
      const request=route.request();
      if(!/^https?:/.test(request.url()) || ['media','font'].includes(request.resourceType())) return route.abort();
      try{await resolveTarget(request.url());await route.continue();}catch{await route.abort();}
     });
     const page=await context.newPage();
     page.on('popup',popup=>popup.close());
     const response=await page.goto(url,{waitUntil:'domcontentloaded',timeout:25000});
     if(!response || !response.ok()) throw Error(`取得先 HTTP ${response?.status() || 0}`);
     if(waitXPath) await page.locator(`xpath=${waitXPath}`).first().waitFor({state:'attached',timeout:Math.max(1,deadline-Date.now()-1000)});
     else {
      // Bounded settling of the initial view; persistent network connections are common.
      await page.waitForLoadState('networkidle',{timeout:8000}).catch(()=>{});
      await page.waitForTimeout(Math.min(1500,Math.max(0,deadline-Date.now()-1000)));
     }
     await resolveTarget(page.url());
     const html=await snapshotPage(page,{preview,deadline});
     if(Buffer.byteLength(html)>5*1024*1024) throw Error('描画 HTML の上限を超えました');
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
 let html;try{html=new TextDecoder(charset).decode(result.body);}catch{throw Error('未対応の文字コードです');}
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
