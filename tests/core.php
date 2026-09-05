<?php
declare(strict_types=1);
require __DIR__ . '/../xExtension-FeedBuilder/lib/Document.php';
use FeedBuilder\Document;
function check(bool $ok, string $name): void { if (!$ok) throw new RuntimeException($name); echo "ok $name\n"; }
$html='<html><head><link rel="alternate" type="application/rss+xml" href="../feed.xml"></head><body><nav><a href="/">home</a></nav><main><article class="news"><h2><a href="/news/1">First</a></h2><time datetime="2026-09-01">9/1</time><p>Summary</p></article><article class="news"><h2><a href="/news/2">Second</a></h2><p>Other</p></article></main><script>alert(1)</script></body></html>';
$d=new Document($html,'https://example.test/news/');
check($d->candidates()===['https://example.test/feed.xml'],'relative discovery');
$settings=['item'=>'//article','itemTitle'=>'.//h2','itemUri'=>'.//a/@href','itemContent'=>'.//p','itemTimestamp'=>'.//time/@datetime'];
$items=$d->items($settings);
check(count($items)===2 && $items[0]['link']==='https://example.test/news/1','relative extraction');
check($items[0]['guid']===$d->items($settings)[0]['guid'],'stable guid');
check($items[1]['timestamp']==='','optional date');
$xpath=$d->selector($d->nodeId('//article/h2/a'),$d->nodeId('//article'),false);
check($xpath!=='' && $d->evaluate($xpath,$d->nodeId('//article'))==='First','relative selector');
$group=$d->selector($d->nodeId('//article'),null,true);
check(count($d->items(array_replace($settings,['item'=>$group])))===2,'group selector');
$preview=$d->preview();
check(!str_contains($preview,'<script') && !str_contains($preview,'href="/"'),'inert preview');
check(Document::absolute('../a?x=1','https://example.test/news/latest/')==='https://example.test/news/a?x=1','dot segments');
try {$d->items(['item'=>'//*[']); throw new LogicException('invalid accepted');} catch (InvalidArgumentException $e) {echo "ok invalid xpath\n";}
$changed=new Document(str_replace(['First','Summary'],['Changed','Updated'],$html),'https://example.test/news/');
check($items[0]['guid']===$changed->items($settings)[0]['guid'],'guid survives title and content changes');
$q=new Document('<html><body><article><a href="/one">One</a></article><article><a href="/one">Again</a></article></body></html>','https://example.test/');
check(count($q->items(['item'=>'//article','itemTitle'=>'.//a','itemUri'=>'.//a/@href']))===1,'deduplicate article URLs');
$evil=new Document('<html><head><base href="https://example.test/sub/"></head><body onload="alert(1)"><img src="http://127.0.0.1/a" onerror="alert(1)"><a href="javascript:alert(1)">bad</a><div style="background:url(http://127.0.0.1)">X</div><iframe srcdoc="x"></iframe></body></html>','https://example.test/');
check(!preg_match('/onload|onerror|127\.0\.0\.1|javascript:|<iframe/',$evil->preview()),'preview blocks active and network content');
check(Document::absolute('javascript:alert(1)','https://example.test/')==='','non HTTP links rejected');
try{$d->items(array_replace($settings,['item'=>'//missing']));throw new LogicException('zero accepted');}catch(InvalidArgumentException $e){echo "ok zero matches\n";}
$quote="a'b\"c";
check($d->evaluate(Document::literal($quote))===$quote,'XPath literal escaping');
$old=new Document('<html><body><main><div class="MuiGrid-root NewsList_item__abc12 css-xyz"><a href="/a">A</a></div><div class="MuiGrid-root NewsList_item__abc12 css-uvw"><a href="/b">B</a></div></main></body></html>','https://example.test/');
$generated=$old->selector($old->nodeId('//main/div'),null,true);
$new=new Document('<html><body><main><div class="NewsList_item__def34"><a href="/a">A</a></div><div class="NewsList_item__def34"><a href="/b">B</a></div></main></body></html>','https://example.test/');
check(count($new->items(['item'=>$generated,'itemTitle'=>'.//a','itemUri'=>'.//a/@href']))===2,'CSS module hash changes');
$semantic=new Document('<html><body><div class="bodyL Story_contents__abcde"><p>Body</p></div></body></html>','https://example.test/');
check(str_contains($semantic->selector($semantic->nodeId('//div')),'Story_contents__'),'prefer semantic class over typography');
check($d->contextFor($d->nodeId('(//article//a)[2]'),'//article')===$d->nodeId('(//article)[2]'),'select fields in any matched article');
