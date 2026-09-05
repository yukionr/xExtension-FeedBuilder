<?php
declare(strict_types=1);
namespace FeedBuilder;

final class Document {
    private \DOMDocument $dom;
    private \DOMXPath $xp;
    /** @var array<string,\DOMElement> */
    private array $nodes = [];
    public function __construct(string $html, public string $url) {
        $this->dom = new \DOMDocument();
        if (!@$this->dom->loadHTML('<?xml encoding="utf-8" ?>' . $html, LIBXML_NONET | LIBXML_NOERROR | LIBXML_NOWARNING)) throw new \InvalidArgumentException('HTML を解析できません');
        $this->xp = new \DOMXPath($this->dom);
        $base = $this->xp->evaluate('string(//base/@href)');
        if (is_string($base) && $base !== '') $this->url = self::absolute($base, $url);
        foreach ($this->dom->getElementsByTagName('*') as $i => $node) {
            $id = (string)($i + 1);
            $node->setAttribute('data-fb-node', $id);
            $this->nodes[$id] = $node;
        }
    }
    public static function absolute(string $value, string $base): string {
        $value = trim(html_entity_decode($value, ENT_QUOTES | ENT_HTML5, 'UTF-8'));
        if ($value === '') return '';
        if (preg_match('~^[a-z][a-z0-9+.-]*:~i', $value)) return preg_match('~^https?://~i', $value) ? $value : '';
        $b = parse_url($base);
        if (!$b || !isset($b['scheme'], $b['host'])) return '';
        if (str_starts_with($value, '//')) return $b['scheme'] . ':' . $value;
        $origin = $b['scheme'] . '://' . $b['host'] . (isset($b['port']) ? ':' . $b['port'] : '');
        if ($value[0] === '#') return preg_replace('/#.*$/', '', $base) . $value;
        if ($value[0] === '?') return $origin . ($b['path'] ?? '/') . $value;
        $parts = preg_split('/(?=[?#])/', $value, 2);
        $path = $parts[0];
        if (!str_starts_with($path, '/')) $path = preg_replace('~/[^/]*$~', '/', $b['path'] ?? '/') . $path;
        $segments = [];
        foreach (explode('/', $path) as $s) { if ($s === '..') array_pop($segments); elseif ($s !== '.' && $s !== '') $segments[] = $s; }
        return $origin . '/' . implode('/', $segments) . (str_ends_with($path, '/') && $segments ? '/' : '') . ($parts[1] ?? '');
    }
    public static function literal(string $s): string {
        if (!str_contains($s, "'")) return "'" . $s . "'";
        if (!str_contains($s, '"')) return '"' . $s . '"';
        return 'concat(' . implode(',"\'",', array_map(fn($v) => "'$v'", explode("'", $s))) . ')';
    }
    public function nodeId(string $xpath): string { return $this->query($xpath)->item(0)?->attributes?->getNamedItem('data-fb-node')?->nodeValue ?? ''; }
    private function query(string $expr, ?\DOMNode $context = null): \DOMNodeList {
        $result = @$this->xp->query($expr, $context);
        if ($result === false) throw new \InvalidArgumentException('XPath の構文を確認してください');
        return $result;
    }
    public function evaluate(string $expr, ?string $context = null): string {
        $r = @$this->xp->evaluate('normalize-space(' . $expr . ')', $context === null ? null : ($this->nodes[$context] ?? null));
        if (!is_string($r)) throw new \InvalidArgumentException('XPath の構文を確認してください');
        return $r;
    }
    public function ids(string $expr): array {
        return array_values(array_map(fn($n) => $n instanceof \DOMElement ? $n->getAttribute('data-fb-node') : '', iterator_to_array($this->query($expr))));
    }
    public function candidates(): array {
        $urls = [];
        foreach ($this->query('//link[@href] | //a[@href]') as $node) {
            $href = $node->getAttribute('href');
            if (($node->tagName === 'link' && str_contains(strtolower($node->getAttribute('rel')), 'alternate') && preg_match('~(?:rss|atom|feed\+json)~i', $node->getAttribute('type'))) || ($node->tagName === 'a' && preg_match('~(?:\b(?:rss|atom|feed)\b|\.xml(?:[?#]|$))~i', $href))) {
                $url = self::absolute($href, $this->url); if ($url !== '') $urls[] = $url;
            }
        }
        return array_slice(array_values(array_unique($urls)), 0, 12);
    }
    private function step(\DOMElement $node): string {
        $tag = $node->tagName;
        $id = $node->getAttribute('id');
        if ($id !== '' && !preg_match('/[0-9]{3,}|[:]/', $id)) return $tag . '[@id=' . self::literal($id) . ']';
        $classes = preg_split('/\s+/', trim($node->getAttribute('class')));
        usort($classes, fn($a,$b) => (int)str_contains($b,'__') <=> (int)str_contains($a,'__'));
        foreach ($classes as $class) {
            if ($class === '' || preg_match('/^(active|selected|hover|focus|__|Mui|css-)/i', $class)) continue;
            if (preg_match('/^(.+__)[A-Za-z0-9_-]{5,}$/',$class,$match)) return $tag . '[contains(concat(" ",normalize-space(@class)),' . self::literal(' ' . $match[1]) . ')]';
            return $tag . '[contains(concat(" ",normalize-space(@class)," "),' . self::literal(' ' . $class . ' ') . ')]';
        }
        return $tag;
    }
    public function selector(string $id, ?string $context = null, bool $group = false): string {
        $node = $this->nodes[$id] ?? throw new \InvalidArgumentException('要素を選択してください');
        $root = $context !== null ? ($this->nodes[$context] ?? throw new \InvalidArgumentException('記事枠を選択してください')) : null;
        $parts = [];
        for ($current = $node; $current instanceof \DOMElement && $current !== $root; $current = $current->parentNode) {
            $step = $this->step($current);
            $siblings = $this->query('./' . $step, $current->parentNode);
            if (!($group && $current === $node) && $siblings->length > 1) {
                foreach ($siblings as $i => $sibling) if ($sibling === $current) $step .= '[' . ($i + 1) . ']';
            }
            array_unshift($parts, $step);
            if ($root === null && str_contains($step, '@') && !preg_match('/\]\[[0-9]+\]$/', $step)) {
                $global = $this->query('//' . $step);
                $sameGroup = $group && $current === $node && $global->length === $siblings->length;
                if ($sameGroup) foreach ($global as $match) if ($match->parentNode !== $current->parentNode) $sameGroup = false;
                if ($global->length === 1 || $sameGroup) return '//' . implode('/', $parts);
            }
        }
        if ($root !== null && $current !== $root) throw new \InvalidArgumentException('記事枠の内側を選択してください');
        return ($root !== null ? '.' : '') . ($parts ? '/' . implode('/', $parts) : '');
    }
    public function groupNode(string $id): string {
        $node = $this->nodes[$id] ?? throw new \InvalidArgumentException('要素を選択してください');
        for ($current = $node; $current instanceof \DOMElement && !in_array($current->tagName, ['body','html']); $current = $current->parentNode) {
            if ($this->query('./' . $this->step($current), $current->parentNode)->length > 1 && $this->query('.//a[@href] | self::a[@href]', $current)->length > 0) return $current->getAttribute('data-fb-node');
        }
        return $id;
    }
    public function related(string $id, string $direction): string {
        $node = $this->nodes[$id] ?? throw new \InvalidArgumentException('要素を選択してください');
        $other = $direction === 'parent' ? $node->parentNode : $node->firstElementChild;
        return $other instanceof \DOMElement ? $other->getAttribute('data-fb-node') : $id;
    }
    public function contextFor(string $id, string $items): string {
        $ids = $this->ids($items);
        for ($node = $this->nodes[$id] ?? null; $node instanceof \DOMElement; $node = $node->parentNode) {
            if (in_array($node->getAttribute('data-fb-node'), $ids, true)) return $node->getAttribute('data-fb-node');
        }
        throw new \InvalidArgumentException('記事枠の内側を選択してください');
    }
    public function fieldSelector(string $id, ?string $context, string $field): string {
        $node = $this->nodes[$id] ?? throw new \InvalidArgumentException('要素を選択してください');
        if ($field === 'itemUri') {
            while ($node->tagName !== 'a' && $node->parentNode instanceof \DOMElement && $node->getAttribute('data-fb-node') !== $context) $node = $node->parentNode;
            if (!$node->hasAttribute('href')) throw new \InvalidArgumentException('記事のリンクを選択してください');
            return $this->selector($node->getAttribute('data-fb-node'), $context) . '/@href';
        }
        $suffix = match ($field) { 'itemThumbnail' => $node->hasAttribute('src') ? '/@src' : '/@data-src', 'itemTimestamp' => $node->hasAttribute('datetime') ? '/@datetime' : '', default => '' };
        return $this->selector($id, $context) . $suffix;
    }
    public function content(string $expr, ?\DOMNode $context = null): string {
        $result = @$this->xp->evaluate($expr, $context);
        if ($result === false) throw new \InvalidArgumentException('XPath の構文を確認してください');
        if (!$result instanceof \DOMNodeList) return htmlspecialchars((string)$result, ENT_QUOTES, 'UTF-8');
        $out = '';
        foreach ($result as $node) $out .= $this->dom->saveHTML($node);
        $out = preg_replace('/\sdata-fb-(?:node|style|image)="[^"]*"/', '', $out);
        return $out;
    }
    public function items(array $settings): array {
        $nodes = $this->query($settings['item'] ?? '');
        if (!$nodes->length) throw new \InvalidArgumentException('記事が0件です。範囲または描画方法を確認してください');
        if ($nodes->length > 100) throw new \InvalidArgumentException('記事が100件を超えています。範囲を絞ってください');
        $items = [];
        foreach ($nodes as $node) {
            $text = function(string $key) use ($settings, $node): string {
                if (empty($settings[$key])) return '';
                $v = @$this->xp->evaluate('normalize-space(' . $settings[$key] . ')', $node);
                if (!is_string($v)) throw new \InvalidArgumentException('XPath の構文を確認してください');
                return $v;
            };
            $title = $text('itemTitle'); $link = self::absolute($text('itemUri'), $this->url);
            if ($title === '' || $link === '') throw new \InvalidArgumentException('全記事のタイトルと HTTP(S) リンクを指定してください');
            $items[$link] = ['title'=>$title,'link'=>$link,'guid'=>'urn:sha256:' . hash('sha256', $link),'content'=>empty($settings['itemContent']) ? '' : $this->content($settings['itemContent'], $node),'timestamp'=>$text('itemTimestamp'),'thumbnail'=>self::absolute($text('itemThumbnail'), $this->url)];
        }
        return array_values($items);
    }
    public function preview(): string {
        $copy = clone $this->dom; $xp = new \DOMXPath($copy);
        foreach (iterator_to_array($xp->query('//script|//style|//link|//base|//meta|//iframe|//object|//embed|//svg|//form|//input|//button|//textarea|//select')) as $node) $node->parentNode?->removeChild($node);
        foreach ($copy->getElementsByTagName('*') as $node) {
            foreach (iterator_to_array($node->attributes) as $attr) {
                if (!in_array($attr->name, ['data-fb-node','class','id','alt','title','width','height','colspan','rowspan','data-fb-style','data-fb-image'])) $node->removeAttribute($attr->name);
            }
            $style = $node->getAttribute('data-fb-style');
            if ($style !== '' && !preg_match('/url\s*\(|expression|@|[<>]/i', $style)) $node->setAttribute('style', $style);
            $node->removeAttribute('data-fb-style');
            if ($node->tagName === 'img') {
                $image = $node->getAttribute('data-fb-image');
                if (preg_match('~^data:image/(png|jpeg|gif|webp|avif);base64,[A-Za-z0-9+/=]+$~D',$image)) $node->setAttribute('src',$image);
                else { $node->setAttribute('alt',$node->getAttribute('alt') ?: '画像'); $node->setAttribute('style',$node->getAttribute('style') . ';min-width:80px;min-height:50px;background-color:#ddd'); }
            }
            $node->removeAttribute('data-fb-image');
        }
        $head = $copy->getElementsByTagName('head')->item(0);
        if ($head === null) { $head = $copy->createElement('head'); $copy->documentElement->insertBefore($head, $copy->documentElement->firstChild); }
        $policy = $copy->createElement('meta');
        $policy->setAttribute('http-equiv','Content-Security-Policy');
        $policy->setAttribute('content',"default-src 'none'; style-src 'unsafe-inline'; img-src data:; form-action 'none'; base-uri 'none'");
        $head->insertBefore($policy,$head->firstChild);
        return $copy->saveHTML();
    }
}
