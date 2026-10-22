import {chromium,firefox} from 'playwright';
import http from 'node:http';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
const root=process.env.FRESHRSS_TEST_ROOT,php=process.env.PHP_BINARY||'php';
if(!root)throw Error('FRESHRSS_TEST_ROOT に使い捨て FreshRSS のパスを指定してください');
await fs.access(`${root}/.feed-builder-test`);
const listing=`<!doctype html><html><head><title>Fixture</title></head><body><main><article class="news"><h2><a href="/news/1">First</a></h2><time datetime="2026-09-01">9/1</time><p>Summary 1</p></article><article class="news"><h2><a href="/news/2">Second</a></h2><p>Summary 2</p></article></main><script>parent.injected=true</script></body></html>`;
let failFull=false,fullRevision="",fullFetches=0;
const fixture=http.createServer(async(req,res)=>{
 let body='';for await(const c of req)body+=c;
 try{const data=JSON.parse(body);let html;
 if(data.url==='https://example.test/service-error'){res.writeHead(422);res.end(JSON.stringify({error:'Private and reserved addresses are not allowed',errorCode:'private_address',errorArgs:[]}));return;}
 if(data.url==='https://example.test/feed.xml')html='<?xml version="1.0"?><rss version="2.0"><channel><title>Native feed</title><link>https://example.test/</link><description>Example</description><item><title>News</title><link>https://example.test/news/1</link><guid>1</guid></item></channel></rss>';
 else if(data.url==='https://example.test/discover')html='<html><head><link rel="alternate" type="application/rss+xml" href="/feed.xml"></head><body>Source</body></html>';
 else if(data.url.includes('/news/')){fullFetches++;if(failFull)throw Error('fixture article unavailable');html='<html><body><nav>Exclude navigation</nav><main><div class="body"><p>Full article '+data.url.slice(-1)+fullRevision+'</p><img src="/image.png"></div></main></body></html>';}
 else html=req.url==='/render'||data.url.includes('/static')?listing:'<html><body><div>Loading</div></body></html>';
 res.setHeader('content-type','application/json');res.end(JSON.stringify({html,url:data.url,status:200}));
 }catch(e){res.writeHead(422);res.end(JSON.stringify({error:e.message}));}
});
fixture.listen(0,'127.0.0.1');await once(fixture,'listening');
const server=spawn(php,[...(process.env.PHP_INI?['-c',process.env.PHP_INI]:[]),'-S','127.0.0.1:18473','-t',`${root}/p`],{env:{...process.env,FEED_BUILDER_SERVICE:`http://127.0.0.1:${fixture.address().port}`},stdio:['ignore','ignore','pipe']});
let logs='';server.stderr.on('data',b=>{logs+=b.toString();});
const title='Fixture '+Date.now();
let browser;
try {
 for(let i=0;i<40;i++){try{await fetch('http://127.0.0.1:18473/');break;}catch{await new Promise(r=>setTimeout(r,100));}}
 browser=await (process.env.TEST_BROWSER==='firefox'?firefox:chromium).launch({headless:true,...(process.env.TEST_BROWSER==='firefox'?{}:{chromiumSandbox:true})});
 const page=await browser.newPage({viewport:{width:1440,height:1000}});

 const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto('http://127.0.0.1:18473/i/?c=subscription&a=add');
 const addForm=page.locator('form').filter({has:page.locator('#url_rss')});
 assert.equal(await addForm.locator('a.fb-link').count(),1,'Feed Builder must attach to the subscription form');
 await page.locator('#url_rss').fill('https://example.test/discover');await addForm.locator('button[type=submit]').click();
 await page.locator('#fb-candidates a').waitFor();assert.match(await page.locator('#fb-candidates').innerText(),/Native feed/);console.log('ok native discovery');
 await page.locator('#fb-url').fill('https://example.test/news?run='+Date.now());
 await page.locator('#fb-create').click();await page.locator('#fb-status').filter({hasText:'ページ内をクリック'}).waitFor();
 await page.locator('#fb-render').check();await page.locator('#fb-refresh').click();
 const frame=page.frameLocator('#fb-frame');await frame.locator('article').first().waitFor();
 await frame.locator('h2').first().click();
 await page.waitForFunction(()=>document.querySelector('[data-xpath=item]').value.includes('article'));
 await page.locator('[data-field=itemTitle]').click();await frame.locator('h2').nth(1).click();await page.waitForFunction(()=>document.querySelector('[data-xpath=itemTitle]').value.length>0);
 await page.locator('[data-field=itemUri]').click();await frame.locator('a').first().click();await page.waitForFunction(()=>document.querySelector('[data-xpath=itemUri]').value.includes('@href'));
 await page.locator('#fb-check').click();await page.locator('#fb-results article').nth(1).waitFor();assert.equal(await page.locator('#fb-results article').count(),2);assert.equal(await page.evaluate(()=>window.injected),undefined);console.log('ok selection, preview, inert script');
 await page.locator('#fb-open-article').click();await frame.locator('.body').waitFor();await frame.locator('.body').click();await page.waitForFunction(()=>document.querySelector('[data-xpath=fullContent]').value.length>0);
 await page.locator('[data-field=itemContent]').click();await frame.locator('article p').nth(1).click();
 await page.waitForFunction(()=>document.querySelector('[data-xpath=itemContent]').value.length>0);
 assert.doesNotMatch(await page.locator('#fb-status').innerText(),/一覧ページへ戻って/);
 await page.locator('#fb-title').fill(title);await page.locator('#fb-check').click();await page.locator('#fb-results').filter({hasText:'Full article 1'}).waitFor();
 assert.match(await page.locator('#fb-results article').nth(1).innerText(),/Summary 2/);
 const savedResponse=page.waitForResponse(r=>r.url().includes('c=builder') && r.request().postData()?.includes('%22op%22%3A%22save%22'));
 const beforeSaveFetches=fullFetches;await page.locator('#fb-save').click();await page.locator('#fb-status').filter({hasText:'保存しました'}).waitFor({timeout:30000});assert.equal(fullFetches-beforeSaveFetches,1,'saving validates one article without fetching all full articles synchronously');console.log('ok full content and registration');
 const saved=await (await savedResponse).json();
 assert.equal(await page.locator('#fb-existing').inputValue(),String(saved.id),'saved subscription must be reflected in the selection instead of displaying new');
 assert.match(await page.locator('#fb-save-status').innerText(),/保存しました/);
 await page.route('**/*c=builder*a=api*',async route=>{const data=JSON.parse(new URLSearchParams(route.request().postData()).get('payload'));if(data.op==='save'){await route.fulfill({status:422,contentType:'application/json',body:JSON.stringify({error:'編集対象が不正です'})});}else await route.continue();});
 await page.locator('#fb-save').click();await page.locator('#fb-save-status').filter({hasText:'編集対象が不正です'}).waitFor();
 const feedback=await page.locator('#fb-save-status').boundingBox();assert.ok(feedback && feedback.y>=0 && feedback.y+feedback.height<=1000,'save errors must be visible next to the button');
 await page.unroute('**/*c=builder*a=api*');
 console.log('ok save state and visible error feedback');
 await page.reload();await page.locator('#fb-existing').selectOption({label:title});await page.waitForFunction(()=>document.querySelector('[data-xpath=fullContent]').value.length>0);assert.equal(await page.locator('#fb-title').inputValue(),title);console.log('ok re-edit');
 const feedId=await page.locator('#fb-existing').inputValue();
 async function refresh(expire=false){
  const child=spawn(php,[...(process.env.PHP_INI?['-c',process.env.PHP_INI]:[]),'tests/refresh.php',feedId,expire?'expire':'refresh'],{env:{...process.env,FEED_BUILDER_SERVICE:`http://127.0.0.1:${fixture.address().port}`},stdio:['ignore','pipe','pipe']});
  let out='',err='';child.stdout.on('data',b=>out+=b);child.stderr.on('data',b=>err+=b);const [code]=await once(child,'exit');assert.equal(code,0,err || out.slice(-1200));return JSON.parse(out);
 }
 const before=await refresh();assert.equal(before.length,2);assert.match(before[0].content,/Full article 1/);
 failFull=true;const failed=await refresh(true);assert.deepEqual(failed,before);console.log('ok refresh deduplication and full-content retention');
 failFull=false;fullRevision=' revised';const recovered=await refresh(true);assert.equal(recovered.length,2);assert.match(recovered[0].content,/Full article 1 revised/);console.log('ok full-content retry recovery');
 await page.setViewportSize({width:600,height:900});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth+1),true);console.log('ok narrow viewport');
 const csrf=await page.locator('#feed-builder').getAttribute('data-csrf');
 const denied=await page.request.post('http://127.0.0.1:18473/i/?c=builder&a=api',{form:{payload:JSON.stringify({op:'load',id:1})}});assert.equal(denied.status(),403);console.log('ok CSRF rejection');
 const invalid=await page.request.post('http://127.0.0.1:18473/i/?c=builder&a=api',{form:{_csrf:csrf,payload:JSON.stringify({op:'select',slot:'list',key:'invalid',node:'1',field:'item'})}});assert.equal(invalid.status(),422);console.log('ok snapshot ownership check');
 const native=await page.request.post('http://127.0.0.1:18473/i/?c=builder&a=api',{form:{_csrf:csrf,payload:JSON.stringify({op:'save',url:'https://example.test/static?run='+Date.now(),title:'Static fixture',category:1,config:{xpath:{item:'//article',itemTitle:'.//h2',itemUri:'.//a/@href'},render:false,fullRender:false,fullContent:''}})}});assert.equal(native.status(),200,await native.text());
 const nativeId=(await native.json()).id;
 const loaded=await page.request.post('http://127.0.0.1:18473/i/?c=builder&a=api',{form:{_csrf:csrf,payload:JSON.stringify({op:'load',id:nativeId})}});assert.equal((await loaded.json()).config.render,false);console.log('ok native HTML+XPath save and reload');
 await fs.mkdir('.test-output',{recursive:true});await page.screenshot({path:'.test-output/builder.png',fullPage:true});
 for(const language of ['en','fr','ja']) {
  const change=spawn(php,[...(process.env.PHP_INI?['-c',process.env.PHP_INI]:[]),'tests/language.php',language],{env:process.env,stdio:'inherit'});
  assert.equal((await once(change,'exit'))[0],0);
  const japanese=language==='ja';
  await page.goto('http://127.0.0.1:18473/i/?c=subscription&a=add');
  assert.equal(await page.locator('a.fb-link').innerText(),japanese?'フィードを探す・ページから作成':'Find feeds or build from a page');
  await page.locator('a.fb-link').click();
  assert.equal(await page.locator('#feed-builder h1').innerText(),japanese?'ページからフィードを作成':'Build a feed from a page');
  assert.equal(await page.locator('#fb-create').innerText(),japanese?'ページから作成':'Build from page');
  assert.equal(await page.locator('#fb-frame').getAttribute('title'),japanese?'クリックして抽出範囲を選ぶページ':'Page for selecting extraction elements');
  await page.locator('#fb-url').fill('https://example.test/static?lang='+language);
  await page.locator('#fb-create').click();
  await page.locator('#fb-status').filter({hasText:japanese?'ページ内をクリック':'Click the page'}).waitFor();
  await page.frameLocator('#fb-frame').locator('h2').first().click();
  await page.locator('#fb-selection').filter({hasText:japanese?'一致 2 件':'2 matches'}).waitFor();
  const token=await page.locator('#feed-builder').getAttribute('data-csrf');
  const bad=await page.request.post('http://127.0.0.1:18473/i/?c=builder&a=api',{form:{_csrf:token,payload:JSON.stringify({op:'select',key:'invalid',field:'item'})}});
  assert.equal(bad.status(),422);
  assert.equal((await bad.json()).error,japanese?'プレビューの期限が切れました。再取得してください':'The preview has expired. Fetch the page again.');
  const created=await page.request.post('http://127.0.0.1:18473/i/?c=builder&a=api',{form:{_csrf:token,payload:JSON.stringify({op:'save',url:'https://example.test/static?language='+language+'&run='+Date.now(),title:'Language fixture '+language,category:1,config:{xpath:{item:'//article',itemTitle:'.//h2',itemUri:'.//a/@href'},render:false,fullRender:false,fullContent:''}})}});
  assert.equal(created.status(),200);
  assert.equal((await created.json()).message,japanese?'設定を保存しました。記事は FreshRSS の更新処理で取得します。':'Settings saved. Articles will be fetched during FreshRSS refresh.');
  await page.locator('#fb-url').fill('https://example.test/service-error');
  await page.locator('#fb-create').click();
  await page.locator('#fb-status').filter({hasText:japanese?'内部・予約アドレスには接続できません':'Private and reserved addresses are not allowed'}).waitFor();
  if(!japanese)for(const text of await page.locator('#feed-builder button, #feed-builder h1, #fb-status, #fb-selection').allTextContents())assert.doesNotMatch(text,/[ぁ-んァ-ヶ一-龠]/);
  await page.screenshot({path:'.test-output/builder-'+language+'.png',fullPage:true});
  console.log('ok language '+language+(japanese?'':' (English)'));
 }
 assert.deepEqual(errors,[]);console.log('ok browser errors: 0');
} catch(e){console.error(logs.split('\n').filter(line=>/Warning|Fatal|Deprecated|Error/.test(line)).slice(-10).join('\n'));throw e;}
finally{await browser?.close();server.kill();await once(server,'exit');fixture.closeAllConnections();await new Promise(r=>fixture.close(r));}
