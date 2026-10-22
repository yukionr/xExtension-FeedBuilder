# FreshRSS Feed Builder

Feed Builder helps you subscribe to public web pages in FreshRSS **1.29.1 and
1.30.4**. It discovers RSS and Atom feeds or builds XPath rules from elements you
select on a page. An internal Playwright/Chromium service renders pages that
need JavaScript.

## Installation

Use Node.js 22 or later and a supported FreshRSS version. Copy
`xExtension-FeedBuilder/` into FreshRSS's `extensions/` directory, then enable
**Feed Builder** in the extension settings. Install and start the rendering
service from this repository:

```fish
npm ci --ignore-scripts
npx playwright install chromium
npm start
```

The service listens on `127.0.0.1:3000` by default. A sidecar in the same Pod as
PHP is the recommended deployment. For another arrangement, set
`FEED_BUILDER_SERVICE` in the PHP process environment to the service's base URL.
The service has no FreshRSS user authentication; do not expose it publicly.

Container definitions are in `deploy/Renderer.Containerfile` and
`deploy/Extension.Containerfile`. Pass the same Git commit to both through the
`SOURCE_REVISION` build argument. Publishing images and deploying to production
require separate approval. Readiness fails if Chromium's sandbox is unavailable;
there is no fallback that disables it.

## Creating and editing a feed

The extension's controls currently use Japanese labels, quoted below to help
identify them.

1. Enter a web page URL in FreshRSS's usual Add feed form. A submission with the
   default RSS settings opens feed discovery. Submissions with authentication or
   HTTP options, and other feed types, keep FreshRSS's standard behavior.
2. Choose a detected feed to complete the standard subscription, or select
   **ページから作成** (create from page).
3. If the list needs JavaScript, enable **一覧を JavaScript で描画** and fetch it
   again. Click **記事の枠を選ぶ**, then an article to select similarly structured
   article containers. Adjust the range with the parent/child buttons or by
   clicking another element.
4. Select a title and link. Summary, date, and image are optional. You can edit
   the generated XPath manually and use **抽出結果を確認** to inspect matches and
   extracted articles. Selecting a list field after opening an article switches
   back to the list preview.
5. For full text, open an article from the extraction results and use
   **記事リンク先の本文を選ぶ** to select its content. JavaScript rendering for
   article pages is independent of list rendering.
6. Set the feed name and category, then save. Saving fetches and validates the
   list and one representative article again; the next regular refresh imports
   all articles. Success and error messages also appear near the save button.
   The saved feed becomes the selected entry in **保存済み設定**, keeping the
   displayed selection and subsequent save target aligned. Use that selector
   to edit a saved configuration; its URL cannot be changed.

The isolated preview does not execute the source page's scripts. Rendered
previews preserve layout and embed up to 16 images, each limited to 256 KiB,
without persisting the image bodies. Unavailable images use a placeholder.
Plain HTML mode provides a simplified preview.

## Refresh behavior and limits

`xExtension-FeedBuilder/` contains the PHP extension, UI, and XPath 1.0 generation
and evaluation. `renderer/` provides the internal Node.js/Playwright HTTP API
used by PHP.

Plain HTML lists without full-text extraction use FreshRSS's native
`HTML+XPath` feed type. Configurations using JavaScript or full-text extraction
are stored in the `feedBuilder` feed attribute. The extension generates RSS for
FreshRSS's normal refresh pipeline without changing the database schema.

- Article URLs provide stable identifiers, so title or content changes do not
  create duplicate articles.
- Successful full-text results are cached for 24 hours per user, feed, and
  configuration. Failures retain the previous full text or the summary and are
  retried on a later refresh.
- Full-text retrieval has an approximate 180-second budget per refresh; remaining
  work waits for the next refresh. Lists are limited to 100 articles. The service
  accepts two concurrent fetch/render requests, and rendering has a 30-second
  deadline per page. Empty matches and retrieval failures are errors.
- Dates must be parseable by PHP's `strtotime`. Unparseable dates are omitted
  from RSS and left to FreshRSS's standard behavior.

Only the initially displayed list is supported. Load-more controls, pagination,
login, CAPTCHA, Shadow DOM, and separate full-text rules for different layouts
are outside the supported scope. Reselect elements after structural changes.
Generated XPath avoids fixing CSS Modules' trailing hashes, but cannot adapt to
arbitrary site changes.

Disabling the extension stops automatic updates for feeds managed through its
`feedBuilder` attribute. It does not delete articles or settings. Re-enabling
it resumes updates with existing articles intact; native `HTML+XPath` feeds
continue to use FreshRSS's own refresh path.

### Internal service API

`POST /fetch` retrieves HTML from `url`. `POST /render` also accepts optional
`waitXPath` and `preview` fields. Successful responses contain the final `url`,
`html`, and `status`; failures return a non-200 response with an `error` field.
`GET /health` checks the process, and `GET /ready` checks Chromium startup.

Retrieval permits public HTTP(S) targets on standard ports only. DNS results are
pinned to connections. Chromium subresources and redirects also pass through a
validating loopback proxy.

## Verification

Run the local checks from the repository root:

```fish
npm test
php tests/core.php
npm run test:render
npm audit --omit=dev
```

### Browser integration tests

Use a disposable, uninstalled official FreshRSS source tree. Never point these
tests at production source, data, credentials, or user profiles. Changes to
standard subscription behavior must be checked from registration through refresh
on **both 1.29.1 and 1.30.4**.

```fish
set -x FRESHRSS_TEST_ROOT /tmp/freshrss-feed-builder-test
# Extract a supported FreshRSS version into that directory first.
./scripts/setup-test.sh
npm run test:browser
```

`PHP_BINARY` and `PHP_INI` can select a test-specific PHP executable and
configuration. The integration test starts a server on localhost:18473 and a
temporary fetch service. Synthetic pages exercise registration, re-editing,
duplicate prevention, content retention and recovery, CSRF protection, and
viewport widths. The test stops its own processes on exit.

Set `TEST_BROWSER=firefox` and install Playwright's Firefox to use that browser.
This does not verify a user's Firefox Nightly or native Wayland GUI session.

### Testing without host PHP

With rootless Podman and Node.js/Playwright already installed, run:

```fish
npm run test:container
```

The script creates a temporary environment from a digest-pinned official
FreshRSS 1.29.1 image, runs the Node.js, PHP, rendering, and browser checks, then
removes the environment. It mounts the repository read-only and uses host
networking so container PHP can reach the synthetic fetch service on the host.
Runs cannot overlap because they share localhost:18473.

Set `FRESHRSS_TEST_IMAGE` to an image name and digest for another version. The
container's PHP configuration is used; host `PHP_INI` is not inherited. For
FreshRSS 1.30.4:

```fish
env FRESHRSS_TEST_IMAGE=docker.io/freshrss/freshrss:1.30.4@sha256:af44385229541bee24aa9148d0ff8f3b40e095373c63a2c0f74e09a27d3c59df npm run test:container
```

### Optional live-site check

`npm run test:live` explicitly runs `tests/gundam.mjs` against the public Gundam
news site. It reads the site, generates XPath through click selection, and
registers and refreshes a feed in disposable FreshRSS. It uses
localhost:18473/18474. Pages with different article layouts may not match the
selected full-text rule. Screenshots and generated XPath go to the Git-ignored
`.test-output/` directory.

The managed-feed hook clears SimplePie's `feed_url` because `set_raw_data()`
alone does not prevent fetching the configured URL. Include this ingestion path
in integration testing when upgrading FreshRSS.

## License

[AGPL-3.0-or-later](LICENSE). The Playwright dependency version and container
image digests are pinned.
