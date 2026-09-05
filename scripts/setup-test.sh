#!/usr/bin/env bash
# FreshRSS source must already be extracted into a disposable directory.
set -euo pipefail
: "${FRESHRSS_TEST_ROOT:?Set FRESHRSS_TEST_ROOT to an unused FreshRSS source directory}"
php_bin=${PHP_BINARY:-php}
php_args=()
if [[ -n ${PHP_INI:-} ]]; then php_args=(-c "$PHP_INI"); fi
if [[ -e $FRESHRSS_TEST_ROOT/data/config.php || ! -f $FRESHRSS_TEST_ROOT/cli/do-install.php ]]; then
  echo 'Refusing an installed or invalid FreshRSS tree' >&2
  exit 1
fi
repo_root=$(cd "$(dirname "$0")/.." && pwd)
"$php_bin" "${php_args[@]}" "$FRESHRSS_TEST_ROOT/cli/prepare.php"
"$php_bin" "${php_args[@]}" "$FRESHRSS_TEST_ROOT/cli/do-install.php" --default-user=tester --auth-type=none --db-type=sqlite --base-url=http://127.0.0.1:18473 --environment=development --language=ja --disable-update
"$php_bin" "${php_args[@]}" "$FRESHRSS_TEST_ROOT/cli/create-user.php" --user=tester --language=ja --no-default-feeds
ln -s "$repo_root/xExtension-FeedBuilder" "$FRESHRSS_TEST_ROOT/extensions/xExtension-FeedBuilder"
"$php_bin" "${php_args[@]}" -r '$p=getenv("FRESHRSS_TEST_ROOT")."/data/users/tester/config.php";$c=include $p;$c["extensions_enabled"]=["Feed Builder"=>true];file_put_contents($p,"<?php\nreturn ".var_export($c,true).";\n");'
printf '%s\n' 'Disposable Feed Builder test environment' > "$FRESHRSS_TEST_ROOT/.feed-builder-test"
