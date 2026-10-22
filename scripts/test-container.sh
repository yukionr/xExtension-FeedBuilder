#!/usr/bin/env bash
# Run PHP and browser checks against a disposable FreshRSS tree.
set -euo pipefail
repo_root=$(cd "$(dirname "$0")/.." && pwd)
cd "$repo_root"
image=${FRESHRSS_TEST_IMAGE:-docker.io/freshrss/freshrss:1.29.1@sha256:ab6b363102ccdbc39f6a62db926f567c61a5289bf25ba460f1c34423d8cc1a4d}
command -v podman >/dev/null
podman info >/dev/null
work=$(mktemp -d "${TMPDIR:-/tmp}/feed-builder-test.XXXXXXXX")
export FEED_BUILDER_TEST_CONTAINER="feed-builder-test-${work##*.}"
cleanup() {
 podman rm --force "$FEED_BUILDER_TEST_CONTAINER" >/dev/null 2>&1 || true
 rm -r -- "$work"
}
trap cleanup EXIT
export FRESHRSS_TEST_ROOT="$work/freshrss"
export PHP_BINARY="$work/php"
# Use the container's PHP configuration, not a host-specific ini path.
unset PHP_INI
podman run --detach --rm --name "$FEED_BUILDER_TEST_CONTAINER" \
 --network host --userns keep-id \
 --volume "$repo_root:$repo_root:ro" --volume "$work:$work:rw" \
 --workdir "$repo_root" --entrypoint sleep "$image" infinity >/dev/null
podman exec "$FEED_BUILDER_TEST_CONTAINER" cp -R /var/www/FreshRSS "$FRESHRSS_TEST_ROOT"
cat > "$PHP_BINARY" <<'PHP_WRAPPER'
#!/usr/bin/env bash
set -euo pipefail
exec podman exec --env FRESHRSS_TEST_ROOT --env FEED_BUILDER_SERVICE \
 "$FEED_BUILDER_TEST_CONTAINER" php "$@"
PHP_WRAPPER
chmod +x "$PHP_BINARY"
"$PHP_BINARY" --version
npm test
"$PHP_BINARY" tests/core.php
./scripts/setup-test.sh
npm run test:render
npm run test:browser
