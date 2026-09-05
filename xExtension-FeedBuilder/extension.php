<?php
declare(strict_types=1);
require_once __DIR__ . '/lib/Document.php';
require_once __DIR__ . '/lib/Client.php';
require_once __DIR__ . '/lib/Builder.php';
final class FeedBuilderExtension extends Minz_Extension {
    public function init(): void {
        parent::init();
        $this->registerController('builder'); $this->registerViews();
        $this->registerHook(Minz_HookType::FreshrssInit, [$this,'assets']);
        $this->registerHook(Minz_HookType::MenuOtherEntry, [$this,'menu']);
        $this->registerHook(Minz_HookType::SimplepieBeforeInit, [$this,'load']);
    }
    public function menu(): string { return '<li class="item"><a href="' . _url('builder','index') . '">ページからフィードを作成</a></li>'; }
    public function assets(): void {
        Minz_View::appendScript($this->getFileUrl('builder.js'));
        Minz_View::appendStyle($this->getFileUrl('builder.css'));
    }
    public function load(FreshRSS_SimplePieCustom $simplePie, FreshRSS_Feed $feed): void {
        $config = $feed->attributeArray('feedBuilder');
        if ($config === null) return;
        try {
            $config = \FeedBuilder\Builder::validate($config);
            $builder = new \FeedBuilder\Builder();
            $items = $builder->extract($feed->url(),$config);
            $cacheFile = CACHE_PATH . '/feed-builder-' . hash('sha256',Minz_User::name() . ':' . $feed->url() . ':' . json_encode($config)) . '.json';
            $cache = is_file($cacheFile) ? json_decode(file_get_contents($cacheFile) ?: '{}',true) : [];
            if (!is_array($cache)) $cache=[];
            $deadline = microtime(true)+180;
            $warnings=0;
            foreach ($items as &$item) {
                if ($config['fullContent'] === '') continue;
                $previous=$cache[$item['link']] ?? null;
                if (is_array($previous) && ($previous['time'] ?? 0)>time()-86400) { $item['content']=$previous['content']; continue; }
                try {
                    if(microtime(true)>$deadline) throw new RuntimeException('本文取得は次回に継続します');
                    $item['content']=$builder->full($item,$config);
                    $cache[$item['link']]=['time'=>time(),'content'=>$item['content']];
                } catch (Throwable $e) {
                    $warnings++;
                    if (is_array($previous) && is_string($previous['content'] ?? null)) $item['content']=$previous['content'];
                }
            }
            unset($item);
            if ($config['fullContent'] !== '') {
                $cache=array_intersect_key($cache,array_fill_keys(array_column($items,'link'),true));
                file_put_contents($cacheFile,json_encode($cache,JSON_THROW_ON_ERROR),LOCK_EX);
                if ($warnings) Minz_Log::warning('Feed Builder: 本文取得 ' . $warnings . ' 件を次回再試行します (feed ' . $feed->id() . ')');
            }
            $simplePie->set_raw_data(\FeedBuilder\Builder::rss($feed->name(),$feed->url(),$items));
            // SimplePie otherwise fetches feed_url even when raw_data is set.
            $simplePie->feed_url = null;
            $simplePie->enable_cache(false);
        } catch (Throwable $e) { throw new FreshRSS_Feed_Exception('Feed Builder: ' . $e->getMessage()); }
    }
}
