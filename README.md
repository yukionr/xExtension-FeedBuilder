# FreshRSS Feed Builder

FreshRSS 1.29.1 / 1.30.4 のフィード登録を補助する拡張です。公開 URL から RSS / Atom を探し、
見つからないページでは記事の枠、タイトル、リンク、日付、画像、本文をクリックして
XPath を生成します。JavaScript の描画には内部の Playwright / Chromium サービスを使います。

## 使い方

1. 拡張を有効にして、通常の「フィードを追加」に Web ページの URL を入力します。
   登録・保存の結果はボタンの近くにも表示します。保存後は「保存済み設定」に登録した
   フィードを選択し、画面上の新規・編集状態と送信する対象を一致させます。
   標準の RSS 設定で登録すると検出画面へ進みます。認証・HTTP オプションを指定した
   登録や他のフィード種別は標準の処理を使います。
2. 検出されたフィードを選んで標準の登録を完了するか、「ページから作成」を選びます。
3. 内容が JavaScript で表示されるページでは「一覧を JavaScript で描画」を有効にして
   再取得します。「記事の枠を選ぶ」を押して記事をクリックすると、同じ構造の枠を
   まとめて選択します。親・子ボタンや別の要素のクリックで範囲を修正できます。
4. タイトルとリンクを指定します。概要・日付・画像は任意です。生成した XPath は
   手動でも修正でき、「抽出結果を確認」で一致件数と記事を確認できます。
   記事ページを開いた後に一覧用の項目を選ぶと、一覧プレビューに戻ります。
5. 全文が必要なら抽出結果から記事ページを開き、「記事リンク先の本文を選ぶ」で
   本文範囲をクリックします。本文側の JavaScript 描画も独立して選択できます。
6. フィード名・カテゴリーを指定して保存します。保存前に一覧と代表記事を再取得・再評価します。全記事の取り込みは次回の通常更新で行います。
   保存済み設定は画面上部の一覧から編集できます。編集時の URL 変更はできません。

プレビューは元ページのスクリプトを実行しない隔離された表示です。描画モードでは
レイアウトと最大16画像を取り込みます。画像は1枚256 KiBまでで、画像本体を永続保存しません。
取り込めない画像は代替表示になります。通常 HTML モードは簡略表示です。

## 構成と更新

- `xExtension-FeedBuilder/`: PHP 拡張、UI、XPath 1.0 の生成・評価。
- `renderer/`: Node.js と Playwright。PHP からだけ利用する内部 HTTP API。
- 通常 HTML の一覧だけなら標準の `HTML+XPath` を使用します。JavaScript または
  全文取得を使う設定は `feedBuilder` フィード属性へ保存し、拡張が RSS を生成して
  FreshRSS の通常の更新処理へ渡します。DB スキーマ変更はありません。
- 記事 URL を識別子に使い、タイトル・本文の変更で重複記事を作らないようにします。
  本文の成功結果はユーザー・フィード・設定ごとに24時間キャッシュします。失敗時は
  直前の本文か概要を保持して次回更新で再試行します。
- 本文取得は1回の更新で約180秒の予算を設け、残りは次回へ回します。一覧は最大100記事、
  描画は同時2ページ・1ページ30秒です。一致ゼロや取得失敗はエラーとして扱います。
- 日付は PHP の `strtotime` で解釈できる形式を使います。解釈できない日付は RSS へ
  出力せず、FreshRSS の標準動作に委ねます。

初期表示の一覧が対象です。追加読み込み、ページ巡回、ログイン、CAPTCHA、Shadow DOM、
異なるレイアウトごとの本文ルールは対象外です。DOM 構造が変わった場合は再選択してください。
CSS Modules の末尾ハッシュを固定しない XPath を生成しますが、任意のサイト変更への追従を
保証するものではありません。

## 起動・配置

Node.js 22 以降と FreshRSS 1.29.1 または 1.30.4 が必要です。拡張ディレクトリを FreshRSS の
`extensions/` 配下へ配置し、設定の拡張機能から **Feed Builder** を有効にします。

```fish
npm ci --ignore-scripts
npx playwright install chromium
npm start
```

描画サービスは既定で `127.0.0.1:3000` に待ち受けます。PHP と同じ Pod の sidecar として
配置する構成を推奨します。別の配置では PHP プロセスの `FEED_BUILDER_SERVICE` を設定します。
このサービスは FreshRSS のユーザー認証を持たないため、外部に公開しないでください。

`POST /fetch` と `POST /render` は `url`、任意の `waitXPath`、`preview` を受け取り、
`url`（最終 URL）、`html`、`status` を返します。失敗は非200応答と `error` です。
`GET /health` はプロセス、`GET /ready` は Chromium 起動を確認します。
取得対象は公開 HTTP(S) の標準ポートのみです。DNS 解決結果を接続先へ固定し、
Chromium の副資源・リダイレクトも loopback の検証プロキシを通します。

イメージ定義は `deploy/Renderer.Containerfile` と `deploy/Extension.Containerfile` です。
両方に同じ Git commit を `SOURCE_REVISION` build argument で指定します。公開・本番配置は
別の作業です。Kubernetes の候補定義は `wonder2-infra` の任意 Component を使用します。
Chromium sandbox が使えない環境では readiness が失敗します。sandbox を無効にして
運用する fallback はありません。

拡張を無効にすると管理対象フィードの自動更新は止まります。記事と設定は削除しません。
既存記事を維持したまま拡張を再び有効にすると更新を再開できます。

## 検証

```fish
npm test
php tests/core.php
npm run test:render
npm audit --omit=dev
```

ブラウザー結合テストは、公式 FreshRSS **1.29.1** を展開した未インストールの一時ディレクトリ
を使います。本番の source / data は指定しないでください。

```fish
set -x FRESHRSS_TEST_ROOT /tmp/freshrss-feed-builder-test
# 上記のディレクトリへ FreshRSS 1.29.1 を展開した後に実行
./scripts/setup-test.sh
npm run test:browser
```

`PHP_BINARY` と `PHP_INI` でテスト専用 PHP を指定できます。結合テストは localhost:18473 と
一時的な取得サービスを起動し、合成ページを使って通常の登録から設定の再編集、
更新時の重複防止・本文保持・復旧、CSRF、表示幅を確認します。終了時に自分のプロセスを停止します。
`TEST_BROWSER=firefox` と Playwright の Firefox を使う検証も可能です。これは利用者の
Firefox Nightly / Wayland の実 GUI 確認とは別です。

ホストに PHP がない場合は、rootless Podman とインストール済みの Node.js / Playwright
を使って一式を実行できます。公式 FreshRSS 1.29.1 の digest 固定イメージから新しい
一時環境を作り、Node.js・PHP・描画・ブラウザー結合テストを実行して終了時に削除します。
本番の data やユーザープロファイルは使いません。コンテナー内の PHP からホスト上の
合成取得サービスに接続するため host network を使い、リポジトリは読み取り専用で渡します。
localhost:18473 を使うため同時実行はできません。

```fish
npm run test:container
```

別の FreshRSS 版を検証する場合は `FRESHRSS_TEST_IMAGE` にイメージ名と digest を指定します。
この経路はコンテナー内の PHP 設定を使うため、ホストの `PHP_INI` は引き継ぎません。
1.30.4 での実行例は次のとおりです。両版で登録・再編集・更新の結合テストを確認しています。

```fish
env FRESHRSS_TEST_IMAGE=docker.io/freshrss/freshrss:1.30.4@sha256:af44385229541bee24aa9148d0ff8f3b40e095373c63a2c0f74e09a27d3c59df npm run test:container
```

`node tests/gundam.mjs` は明示実行する実ページ確認です。ガンダム公式ニュースへ読み取りアクセスし、
クリック操作で XPath を作り、一時 FreshRSS に登録・再更新します。localhost:18473/18474 を使用します。
2026-09-06 の実ページ確認では18記事を登録・再更新し、本文は13記事で取得できました。
残る5記事は作品別ページなど異なるレイアウトのため、選択した本文ルールに一致しませんでした。
確認画像・生成 XPath は `.test-output/` に出力し、Git には含めません。

SimplePie の `set_raw_data()` だけでは設定済み URL のネットワーク取得を止められないため、
管理対象ではフック内で `feed_url` を null にします。この取り込み経路は FreshRSS を
更新する際の結合テスト対象です。

ライセンス: AGPL-3.0-or-later。Playwright の依存バージョンとイメージ digest は固定しています。
