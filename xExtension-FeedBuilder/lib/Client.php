<?php
declare(strict_types=1);
namespace FeedBuilder;
final class Client {
    public function page(string $url, bool $render = false, string $wait = '', bool $preview = false): array {
        $base = getenv('FEED_BUILDER_SERVICE') ?: 'http://127.0.0.1:3000';
        $ch = curl_init(rtrim($base, '/') . ($render ? '/render' : '/fetch'));
        curl_setopt_array($ch, [CURLOPT_POST=>true, CURLOPT_POSTFIELDS=>json_encode(['url'=>$url,'waitXPath'=>$wait,'preview'=>$preview], JSON_THROW_ON_ERROR), CURLOPT_HTTPHEADER=>['Content-Type: application/json'], CURLOPT_RETURNTRANSFER=>true, CURLOPT_CONNECTTIMEOUT=>3, CURLOPT_TIMEOUT=>35, CURLOPT_FOLLOWLOCATION=>false]);
        $body = curl_exec($ch); $status = curl_getinfo($ch, CURLINFO_RESPONSE_CODE);
        if (!is_string($body)) throw new \RuntimeException(_t('feed_builder.service_unavailable'));
        $result = json_decode($body, true, 32, JSON_THROW_ON_ERROR);
        if ($status !== 200 || !is_array($result) || !isset($result['html'],$result['url'])) {
            $message = $result['error'] ?? _t('feed_builder.fetch_failed');
            if (isset($result['errorCode'])) {
                $key = 'feed_builder.' . $result['errorCode'];
                $translated = _t($key, ...($result['errorArgs'] ?? []));
                if ($translated !== $key) $message = $translated;
            }
            throw new \RuntimeException($message);
        }
        return $result;
    }
}
