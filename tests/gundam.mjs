// Opt-in, read-only public-site acceptance check. Subscription writes are local fixtures only.
import {chromium} from 'playwright';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
const root=process.env.FRESHRSS_TEST_ROOT,php=process.env.PHP_BINARY||'php';
if(!root)throw Error('使い捨て FreshRSS の FRESHRSS_TEST_ROOT が必要です');
await fs.access(`${root}/.feed-builder-test`);
const service=spawn(process.execPath,['renderer/server.mjs'],{env:{...process.env,PORT:'18474'},stdio:['ignore','ignore','pipe']});
const server=spawn(php,[...(process.env.PHP_INI?['-c',process.env.PHP_INI]:[]),'-S','127.0.0.1:18473','-t',`${root}/p`],{env:{...process.env,FEED_BUILDER_SERVICE:'http://127.0.0.1:18474'},stdio:['ignore','ignore','pipe']});
let logs='';for(const p of [service,server])p.stderr.on('data',b=>logs+=b.toString());
let browser;
try {
 for(let i=0;i<50;i++){try{await fetch('http://127.0.0.1:18473/');await fetch('http://127.0.0.1:18474/health');break;}catch{await new Promise(r=>setTimeout(r,100));}}
 browser=await chromium.launch({chromiumSandbox:true});const page=await browser.newPage({viewport:{width:1600,height:1100}});
 page.setDefaultTimeout(45000);
 page.on('response',async r=>{if(r.url().includes('c=builder') && r.status()!==200)console.error('API',r.status(),await r.text());});
 await page.goto('http://127.0.0.1:18473/i/?c=builder&a=index');
 await page.locator('#fb-url').fill('https://gundam-official.com/news');
 // First show the static shell, then select rendering explicitly.
 await page.locator('#fb-create').click();await page.locator('#fb-status').filter({hasText:'ページ内をクリック'}).waitFor();
 await page.locator('#fb-render').check();await page.locator('#fb-refresh').click();
 const frame=page.frameLocator('#fb-frame');const title=frame.locator('[class*=NewsItem_newsItemContainer] .titleContainer').first();await title.waitFor();
 await title.click();await page.waitForFunction(()=>document.querySelector('[data-xpath=item]').value.includes('NewsList'));
 await page.locator('[data-field=itemTitle]').click();await title.click();await page.waitForFunction(()=>document.querySelector('[data-xpath=itemTitle]').value.length>0);
 await page.locator('[data-field=itemUri]').click();await title.click();await page.waitForFunction(()=>document.querySelector('[data-xpath=itemUri]').value.includes('@href'));
 await page.locator('[data-field=itemTimestamp]').click();await frame.locator('[class*=NewsItem_date]').first().click();await page.waitForFunction(()=>document.querySelector('[data-xpath=itemTimestamp]').value.length>0);
 await page.locator('#fb-check').click();await page.locator('#fb-results article').nth(1).waitFor();
 const count=await page.locator('#fb-results article').count();console.log(`ok live list: ${count} articles`);
 await page.locator('#fb-full-render').check();await page.locator('#fb-open-article').click();
 await frame.locator('[class*=NewsArticle_contents]').waitFor();await frame.locator('[class*=NewsArticle_contents]').click({position:{x:10,y:10}});
 await page.waitForFunction(()=>document.querySelector('[data-xpath=fullContent]').value.length>0);
 await page.locator('#fb-check').click();await page.locator('#fb-status').filter({hasText:'件を抽出しました'}).waitFor();
 assert.ok((await page.locator('#fb-results article').first().innerText()).length>400);console.log('ok live full content');
 await fs.mkdir('.test-output',{recursive:true});await page.screenshot({path:'.test-output/gundam-builder.png',fullPage:true});
 const settings=await page.locator('[data-xpath]').evaluateAll(nodes=>Object.fromEntries(nodes.map(n=>[n.dataset.xpath,n.value])));
 await fs.writeFile('.test-output/gundam-selectors.json',JSON.stringify(settings,null,2));
 const existing=page.locator('#fb-existing option').filter({hasText:'Gundam acceptance'});
 if(await existing.count()){await page.locator('#fb-existing').selectOption(await existing.last().getAttribute('value'));await page.locator('#fb-status').filter({hasText:'ページ内をクリック'}).waitFor();}
 else await page.locator('#fb-title').fill('Gundam acceptance');
 await page.locator('#fb-save').click();await page.locator('#fb-status').filter({hasText:'保存しました'}).waitFor({timeout:240000});console.log('ok live subscription saved in disposable FreshRSS');
 await page.reload();const option=page.locator('#fb-existing option').filter({hasText:'Gundam acceptance'}).last();const id=await option.getAttribute('value');
 async function refresh(){
  const child=spawn(php,[...(process.env.PHP_INI?['-c',process.env.PHP_INI]:[]),'tests/refresh.php',id],{env:{...process.env,FEED_BUILDER_SERVICE:'http://127.0.0.1:18474',FEED_BUILDER_LIVE_TEST:'1'},stdio:['ignore','pipe','pipe']});
  let out='',err='';child.stdout.on('data',b=>out+=b);child.stderr.on('data',b=>err+=b);const [code]=await once(child,'exit');assert.equal(code,0,err || out.slice(-1200));return JSON.parse(out);
 }
 console.log('refreshing live subscription…');const first=await refresh();assert.equal(first.length,count);console.log(`first refresh: ${first.length} articles; checking duplicates…`);const second=await refresh();assert.deepEqual(second.map(i=>i.guid),first.map(i=>i.guid));assert.ok(first.some(i=>i.content.length>400));console.log(`ok live refresh twice: ${first.length} articles, no duplicates`);
} catch(e){console.error(logs.split('\n').filter(l=>/Warning|Error|Fatal/.test(l)).slice(-10).join('\n'));throw e;}
finally {await browser?.close();for(const p of [server,service]){if(p.exitCode===null){p.kill();await once(p,'exit');}}}
