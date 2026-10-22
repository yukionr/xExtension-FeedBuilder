<?php
declare(strict_types=1);
$root = getenv('FRESHRSS_TEST_ROOT');
if (!$root || !is_file($root . '/.feed-builder-test')) throw new RuntimeException('A disposable test environment is required');
$language = $argv[1] ?? '';
if (!in_array($language, ['ja', 'en', 'fr'], true)) throw new InvalidArgumentException('Unsupported test language');
$path = $root . '/data/users/tester/config.php';
$config = include $path;
$config['language'] = $language;
file_put_contents($path, '<?php return ' . var_export($config, true) . ';');
