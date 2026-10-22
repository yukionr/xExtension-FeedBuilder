<?php
declare(strict_types=1);
namespace FeedBuilder;
final class Builder {
    public function __construct(private Client $client = new Client()) {}
    public static function validate(array $config): array {
        $settings = $config['xpath'] ?? [];
        if (!is_array($settings)) throw new \InvalidArgumentException(_t('feed_builder.config_invalid'));
        $out = [];
        foreach (['item','itemTitle','itemUri','itemContent','itemTimestamp','itemThumbnail'] as $key) {
            $value = $settings[$key] ?? '';
            if (!is_string($value) || strlen($value)>4096) throw new \InvalidArgumentException(_t('feed_builder.xpath_long'));
            $out[$key] = trim($value);
        }
        foreach (['item','itemTitle','itemUri'] as $key) if ($out[$key] === '') throw new \InvalidArgumentException(_t('feed_builder.required_fields'));
        $full = $config['fullContent'] ?? '';
        if (!is_string($full) || strlen($full)>4096) throw new \InvalidArgumentException(_t('feed_builder.full_xpath_invalid'));
        return ['version'=>1,'xpath'=>$out,'render'=>($config['render'] ?? false) === true,'fullRender'=>($config['fullRender'] ?? false) === true,'fullContent'=>trim($full)];
    }
    public function extract(string $url, array $config): array {
        $data = $this->client->page($url, $config['render'], $config['render'] ? $config['xpath']['item'] : '');
        return (new Document($data['html'], $data['url']))->items($config['xpath']);
    }
    public function full(array $item, array $config): string {
        $page = $this->client->page($item['link'], $config['fullRender'], $config['fullRender'] ? $config['fullContent'] : '');
        $content = (new Document($page['html'], $page['url']))->content($config['fullContent']);
        if (trim(strip_tags($content)) === '' && !str_contains($content, '<img')) throw new \RuntimeException(_t('feed_builder.no_content'));
        return \FreshRSS_SimplePieCustom::sanitizeHTML($content, $page['url']);
    }
    public static function rss(string $title, string $url, array $items): string {
        $doc = new \DOMDocument('1.0','UTF-8'); $rss = $doc->appendChild($doc->createElement('rss')); $rss->setAttribute('version','2.0');
        $channel = $rss->appendChild($doc->createElement('channel'));
        $add = function(\DOMNode $parent, string $key, string $value) use ($doc): \DOMElement { $n=$doc->createElement($key); $n->appendChild($doc->createTextNode($value)); $parent->appendChild($n); return $n; };
        $add($channel,'title',$title);$add($channel,'link',$url);$add($channel,'description',$title);
        foreach ($items as $item) {
            $n = $channel->appendChild($doc->createElement('item'));
            $add($n,'title',$item['title']); $add($n,'link',$item['link']); $add($n,'guid',$item['guid'])->setAttribute('isPermaLink','false');
            $content = \FreshRSS_SimplePieCustom::sanitizeHTML($item['content'],$item['link']);
            if ($item['thumbnail'] !== '') $content = '<img src="' . htmlspecialchars($item['thumbnail'],ENT_QUOTES,'UTF-8') . '" alt="" />' . $content;
            $add($n,'description',$content);
            $timestamp = $item['timestamp'] === '' ? false : strtotime($item['timestamp']);
            if ($timestamp !== false) $add($n,'pubDate',gmdate(DATE_RSS,$timestamp));
        }
        return $doc->saveXML();
    }
}
