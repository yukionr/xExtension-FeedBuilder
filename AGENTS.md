# 開発・検証

- 対応する FreshRSS は 1.29.1 と 1.30.4。標準フィードの動作を変える場合は `tests/browser.mjs` で登録から更新まで両版を確認する。PHP がない環境では `npm run test:container` と `FRESHRSS_TEST_IMAGE` を使える（詳細は README）。
- 実装・テスト・実行設定の変更では `npm test` と `php tests/core.php` を実行する。PHP がない場合は未実施とし、構文確認だけで実装検証を完了にしない。文書のみの変更は記載・参照先と `git diff --check` を確認する。
- `scripts/setup-test.sh` は未インストールの使い捨て FreshRSS 専用。本番の data、認証情報、ユーザープロファイルはテストに使わない。
- 外部 URL の取得は `renderer/network.mjs` の検証・DNS 固定経路を使う。Chromium の sandbox とプロキシを無効にする fallback は追加しない。
- 登録・更新・プレビューの XPath 評価は PHP DOMXPath に統一する。プレビュー用属性を保存する記事本文へ混入させない。
- 本体の fork、DB スキーマ変更、外部サービスへの公開を既定にしない。コンテナーイメージの公開と本番配置には別途承認が必要。
