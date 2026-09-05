(() => {
 'use strict';
 function init(){
  if(document.documentElement.dataset.fbInitialized)return;
  document.documentElement.dataset.fbInitialized='1';
  // Keep the normal subscription form, and make its URL available to the wizard.
  const add=document.querySelector('#add_rss');
  if(add){
   const destination=()=>'?c=builder&a=index&auto=1&category='+encodeURIComponent(document.querySelector('#category')?.value||'1')+'&url='+encodeURIComponent(document.querySelector('#url_rss').value);
   const link=document.createElement('a');link.className='btn fb-link';link.textContent='フィードを探す・ページから作成';link.href='?c=builder&a=index';link.addEventListener('click',()=>{link.href=destination();});add.append(link);
   add.addEventListener('submit',event=>{
    const custom=['http_user','http_pass','curl_params_cookie','curl_params','http_headers','curl_fields','curl_params_useragent','curl_params_redirects'];
    if(document.querySelector('#feed_kind')?.value!=='0' || custom.some(name=>add.elements[name]?.value.trim()) || add.elements.curl_params_cookiefile?.checked || (add.elements.curl_method?.value && add.elements.curl_method.value!=='GET'))return;
    event.preventDefault();location.href=destination();
   });
  }
  const app=document.querySelector('#feed-builder');if(!app)return;
  const el=id=>document.getElementById('fb-'+id);
  let field='item',slot='list',selected='',context=null,id=0,busy=false;
  const snapshots={};let items=[];
  const status=(text,error=false)=>{el('status').textContent=text;el('status').classList.toggle('fb-error',error);};
  const config=()=>{const c={xpath:{},render:el('render').checked,fullRender:el('full-render').checked,fullContent:''};for(const t of app.querySelectorAll('[data-xpath]')){if(t.dataset.xpath==='fullContent')c.fullContent=t.value.trim();else c.xpath[t.dataset.xpath]=t.value.trim();}return c;};
  async function api(op,data={}) {
   const body=new URLSearchParams({_csrf:app.dataset.csrf,payload:JSON.stringify({op,...data})});
   const response=await fetch(app.dataset.api,{method:'POST',body,credentials:'same-origin'});
   const dataOut=await response.json();if(!response.ok)throw Error(dataOut.error||'処理に失敗しました');return dataOut;
  }
  async function run(work){if(busy)return;busy=true;app.setAttribute('aria-busy','true');for(const b of app.querySelectorAll('button'))b.disabled=true;try{await work();}catch(e){status(e.message,true);}finally{busy=false;app.removeAttribute('aria-busy');for(const b of app.querySelectorAll('button'))b.disabled=false;}}
  function choose(next){field=next;selected='';for(const b of app.querySelectorAll('[data-field]'))b.setAttribute('aria-pressed',String(b.dataset.field===field));el('selection').textContent=`${app.querySelector(`[data-field="${field}"]`).textContent}：ページ内をクリック` ;}
  function mark(ids){const doc=el('frame').contentDocument;if(!doc)return;for(const node of doc.querySelectorAll('[data-fb-node]'))node.style.outline=ids.includes(node.dataset.fbNode)?'3px solid #1675de':'';}
  function show(which){slot=which;const snap=snapshots[which];if(!snap)throw Error('先にページを取得してください');el('frame').srcdoc=snap.html;selected='';}
  async function snapshot(which,url){status('ページを取得しています…');const result=await api('snapshot',{slot:which,url,render:el(which==='list'?'render':'full-render').checked});snapshots[which]=result;show(which);status('ページ内をクリックして範囲を選べます');}
  async function pick(node,direction){
   if(field==='fullContent' && slot!=='full')throw Error('記事ページを開いて本文を選択してください');
   if(field!=='fullContent' && slot!=='list')throw Error('一覧ページへ戻って項目を選択してください');
   if(field!=='item' && field!=='fullContent' && !context)throw Error('先に記事の枠を選択してください');
   const r=await api('select',{slot,key:snapshots[slot].key,node,field,context,direction,itemXPath:config().xpath.item});
   app.querySelector(`[data-xpath="${field}"]`).value=r.xpath;selected=r.node;
   if(field==='item')context=r.node;else if(r.context)context=r.context;
   mark(r.ids);el('selection').textContent=`選択しました（一致 ${r.ids.length} 件）。別の要素をクリックして変更できます`;
  }
  el('frame').addEventListener('load',()=>{
   const doc=el('frame').contentDocument;if(!doc)return;
   doc.addEventListener('click',e=>{e.preventDefault();e.stopPropagation();const node=e.target.closest('[data-fb-node]');if(node)run(()=>pick(node.dataset.fbNode));},true);
   doc.addEventListener('submit',e=>e.preventDefault(),true);
  });
  for(const b of app.querySelectorAll('[data-field]'))b.addEventListener('click',()=>choose(b.dataset.field));
  async function preview(){
   if(!snapshots.list)throw Error('一覧を取得してください');status('抽出結果を確認しています…');
   const r=await api('preview',{slot:'list',key:snapshots.list.key,config:config()});items=r.items;
   el('results').replaceChildren();el('article').replaceChildren();
   for(const [i,item] of items.entries()){
    const option=new Option(item.title,String(i));el('article').add(option);
    const article=document.createElement('article'),a=document.createElement('a'),time=document.createElement('p'),content=document.createElement('div');
    a.textContent=item.title;a.href=item.link;a.target='_blank';a.rel='noreferrer noopener';time.textContent=item.timestamp;content.innerHTML=item.content;article.append(a,time,content);el('results').append(article);
   }
   if(slot==='list')mark(r.ids);
   status(`${items.length} 件を抽出しました${r.warnings.length?'。本文: '+r.warnings.join(' / '):''}`,r.warnings.length>0);
  }
  el('discover').addEventListener('click',()=>run(async()=>{
   status('フィードを探しています…');el('candidates').replaceChildren();const r=await api('discover',{url:el('url').value});
   for(const feed of r.candidates){const a=document.createElement('a');a.className='btn fb-link';a.textContent=`${feed.title} を登録`;a.href='?c=feed&a=add&category='+encodeURIComponent(el('category').value)+'&url_rss='+encodeURIComponent(feed.url);el('candidates').append(a);}
   if(!r.candidates.length){el('editor').hidden=false;el('render').checked=r.render;await snapshot('list',el('url').value);choose('item');}
   status(r.candidates.length?`${r.candidates.length} 件のフィードが見つかりました`:'フィードが見つかりませんでした。「ページから作成」で範囲を選べます。'+(r.errors?'一部候補は取得に失敗しました。':''));
  }));
  el('create').addEventListener('click',()=>run(async()=>{el('editor').hidden=false;await snapshot('list',el('url').value);choose('item');}));
  el('refresh').addEventListener('click',()=>run(async()=>{context=null;await snapshot('list',el('url').value);}));
  el('list').addEventListener('click',()=>run(async()=>{show('list');choose('item');}));
  el('open-article').addEventListener('click',()=>run(async()=>{if(!items.length)await preview();const item=items[Number(el('article').value)||0];await snapshot('full',item.link);choose('fullContent');}));
  for(const direction of ['parent','child'])el(direction).addEventListener('click',()=>run(async()=>{if(!selected)throw Error('先に要素をクリックしてください');await pick(selected,direction);}));
  el('check').addEventListener('click',()=>run(preview));
  el('save').addEventListener('click',()=>run(async()=>{status('再取得して設定を検証・保存しています…');const result=await api('save',{id,url:el('url').value,title:el('title').value,category:Number(el('category').value),config:config()});id=result.id;el('url').readOnly=true;status(result.message);}));
  el('existing').addEventListener('change',()=>run(async()=>{
   id=Number(el('existing').value);context=null;items=[];delete snapshots.list;delete snapshots.full;
   if(!id){el('url').readOnly=false;el('editor').hidden=true;return;}
   const r=await api('load',{id});el('url').value=r.url;el('url').readOnly=true;el('title').value=r.title;el('category').value=r.category;el('render').checked=r.config.render;el('full-render').checked=r.config.fullRender;
   for(const t of app.querySelectorAll('[data-xpath]'))t.value=t.dataset.xpath==='fullContent'?r.config.fullContent:(r.config.xpath[t.dataset.xpath]||'');
   el('editor').hidden=false;await snapshot('list',r.url);choose('item');
  }));
  const query=new URLSearchParams(location.search);el('url').value=query.get('url')||'';if(query.has('category'))el('category').value=query.get('category');choose('item');if(query.get('auto')==='1' && el('url').value)el('discover').click();
 }
 if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init);else init();
})();
