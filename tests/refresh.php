<?php
declare(strict_types=1);
$root=getenv('FRESHRSS_TEST_ROOT');
if (!$root || !is_file($root.'/.feed-builder-test')) throw new RuntimeException('使い捨てテスト環境のマーカーが必要です');
require $root.'/cli/_cli.php';
cliInitUser('tester');
$id=(int)($argv[1]??0);
$feed=FreshRSS_Factory::createFeedDao()->searchById($id);
if($feed===null || (!str_starts_with($feed->url(),'https://example.test/') && !(getenv('FEED_BUILDER_LIVE_TEST')==='1' && $feed->url()==='https://gundam-official.com/news')))throw new RuntimeException('テストフィード以外は操作できません');
if(($argv[2]??'')==='expire') {
 $config=\FeedBuilder\Builder::validate($feed->attributeArray('feedBuilder'));
 $p=CACHE_PATH.'/feed-builder-'.hash('sha256','tester:'.$feed->url().':'.json_encode($config)).'.json';
 $cache=json_decode(file_get_contents($p),true);
 foreach($cache as &$entry)$entry['time']=0;unset($entry);
 file_put_contents($p,json_encode($cache));
}
FreshRSS_feed_Controller::actualizeFeedsAndCommit($id);
if(FreshRSS_Factory::createFeedDao()->searchById($id)->lastError()!==0)throw new RuntimeException('フィード更新に失敗しました');
$db=new PDO('sqlite:'.$root.'/data/users/tester/db.sqlite');
$q=$db->prepare('SELECT content, guid FROM entry WHERE id_feed=? ORDER BY link');$q->execute([$id]);
echo json_encode($q->fetchAll(PDO::FETCH_ASSOC),JSON_THROW_ON_ERROR);
