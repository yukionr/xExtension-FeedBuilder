import {chromium} from 'playwright';
import {snapshotPage} from '../renderer/render.mjs';
import assert from 'node:assert/strict';
const browser=await chromium.launch({chromiumSandbox:true});
try {
 const page=await browser.newPage();
 await page.setContent('<html><head><style>.backdrop{position:fixed;visibility:hidden;opacity:0;pointer-events:none}</style></head><body><div class="backdrop">Hidden overlay</div><main></main><script>setTimeout(()=>document.querySelector("main").innerHTML="<article><h2>Async title</h2></article>",20)</script></body></html>');
 await page.locator('article').waitFor();
 const html=await snapshotPage(page,{preview:true,deadline:Date.now()+30000});
 assert.match(html,/Async title/);assert.match(html,/visibility:hidden/);assert.match(html,/pointer-events:none/);console.log('ok rendered content and hidden-layer visibility');
} finally {await browser.close();}
