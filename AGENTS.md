# Development and verification

- Support FreshRSS 1.29.1 and 1.30.4. When changing standard feed behavior, use `tests/browser.mjs` to verify registration through refresh on both versions. Without host PHP, use `npm run test:container` and `FRESHRSS_TEST_IMAGE`; see [README](README.md#testing-without-host-php).
- For implementation, test, or runtime configuration changes, run `npm test` and `php tests/core.php`. If PHP checks cannot run, report them as unexecuted; syntax checks alone do not complete implementation verification. For documentation-only changes, check claims, references, and `git diff --check`.
- Use `scripts/setup-test.sh` only with a disposable, uninstalled FreshRSS tree. Never use production data, credentials, or user profiles for tests.
- Route external URL retrieval through the validation and DNS-pinning path in `renderer/network.mjs`. Do not add a fallback that disables Chromium's sandbox or proxy.
- Use PHP DOMXPath for XPath evaluation during registration, refresh, and preview. Keep preview-only attributes out of stored article content.
- Do not default to forking FreshRSS, changing its database schema, or exposing services publicly. Publishing container images and deploying to production require separate approval.
- Provide only Japanese (`ja`) and English (`en`) translations. Use FreshRSS's standard English fallback for every other language. When changing localized behavior, verify Japanese, English, and a third FreshRSS language in the disposable browser tests.
