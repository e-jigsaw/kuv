# kuv web SSR 化 設計

## 背景・目的

kuv の web（`packages/web`）は現在 vike + vike-react の静的 SPA（`ssr: false` + `prerender: { partial: true }`）。Caddy が `dist/client` を静的配信し、web は Node プロセスを持たない。データは各コンポーネントが mount 後にクライアント fetch する。

この構成には既知の問題がある: 動的ルート `/image/@id` は prerender 不能なため Caddy の `try_files {path} /index.html` で index.html がフォールバック配信され、vike が埋め込み pageContext（`pageId=/pages/index`）を信じて URL に関係なく index を hydrate してしまう（vikejs/vike#1476）。新タブ・リロード・URL 直アクセスで画像 view ページが開けない。これは `hack` ブランチの未マージコミット `13a2e18` で onHydrationEnd の乗せ直しによりパッチされていたが、main には入っていない。

別プロジェクト rill が vike SSR + cookie 転送 + `vike/abort` の確立したパターンを持つ。**kuv をこの構成に揃える**ことで、プロジェクト間の保守性・頭の切り替えコストを下げ、同時に上記の誤 hydrate 問題を構造的に解消する（SSR ならサーバが URL に対応した正しいページを返すため、SPA fallback 自体が不要になる）。

rill は Bun ランタイムだが、kuv は Node 24 + pnpm（api / shared も Node、mise 管理）。**ランタイムは揃えず Node を維持**し、揃えるのは構成パターン（SSR サーバ + 別 api プロセス + Caddy 振り分け、cookie 転送、`vike/abort` redirect）とする。

## スコープ

単一の実装プランで収まる規模。対象は `packages/web` と、デプロイ周り（`packages/web/Dockerfile` / `docker-compose.yml` / `Caddyfile` / `deploy/MIGRATION.md`）。api（`packages/api`）と shared（`packages/shared`）には触らない。

## アーキテクチャ

web を静的 SPA → vike SSR（Node プロセス）に変える。

- `packages/web/pages/+config.ts`: `ssr: true` に変更、`prerender` 設定を削除（partial prerender 廃止）。`vike-react` の extends は維持
- `packages/web/server/index.ts`（新規）: Hono + `@hono/node-server`。`/assets/*` 等の静的アセットは `@hono/node-server/serve-static`（または Hono の serveStatic）で `dist/client` から配信、それ以外のリクエストを vike の `renderPage`（`vike/server`）に流して SSR HTTP レスポンスを返す。dev は vite（`vike/plugin` が dev SSR middleware を提供）、本番はこの server を `node server/index.js` で起動
- web が Node プロセス（port 3000）になる。Caddy は静的配信をやめて `web:3000` へ `reverse_proxy`

dev の単一オリジン化（`/api` `/i` の proxy）は現状の `vite.config.ts` の `server.proxy` を維持する。

## データ取得と認証

各保護ページに `+data.ts`（`PageContextServer`）を置き、サーバ側で cookie を転送して初期データを取得する:

- `pages/index/+data.ts` → 画像一覧（`GET /api/image/list`）
- `pages/image/@id/+data.ts` → 画像メタ（一覧 API か個別 API。実装プランで確定）
- `pages/settings/+data.ts` → 設定（`GET /api/settings`）+ apikey 一覧（`GET /api/apikey`）

各 `+data` は `pageContext.headers?.["cookie"]` を読んで API クライアントに渡す。401 は `Unauthorized` を catch して `vike/abort` の `redirect("/login")` を throw する。

- **`pages/+guard.ts` は廃止**（各 `+data` が認証を兼任する。rill と同形）
- `pages/login` は `+data` を持たず未認証で開ける
- ミューテーション（画像アップロード / 設定更新 / apikey 発行・削除 / パスワード変更）は従来どおりクライアント側で `lib/api.ts` 経由。これらの 401 は既存の `UnauthorizedError` で扱い、クライアントで `/login` 遷移（現状の挙動を維持）

## API ベース URL 解決（`lib/api.ts` 拡張）

`lib/api.ts` の `request` がベース URL を解決するよう拡張する:

- SSR 実行時（`typeof window === "undefined"`）: `process.env.KUV_API_BASE ?? "http://api:3001"`
- クライアント実行時: 空文字（Caddy 経由の相対パス。現状どおり）

SSR の `+data` から cookie を明示的に渡せるよう、cookie を受け取る経路を追加する（rill の `apiFor({ cookie })` 相当）。具体的には `request` がオプションで `cookie` と baseUrl を受け取り、SSR 時は `Cookie` ヘッダを付与する。既存の `apiGet/apiPost/apiPut/apiDelete/uploadImage` のクライアント呼び出しシグネチャは変えない（baseUrl は内部で解決、クライアントでは空なので無影響）。

## コンポーネント

`HomePage` / `ImageView` / settings 系コンポーネントを「`useData()`（`vike-react/useData`）で初期データを受け取る」形にリファクタする。現状 mount 後にクライアント fetch している初期表示データを、`+data` 由来の props/data 起点に置き換える。ミューテーション操作（フォーム送信・削除等）の実装はそのまま残す。

この data 起点リファクタの広がりが web 側の主な変更量になる。各コンポーネントは「初期データは props で受ける / 操作は従来の api 関数を呼ぶ」という単一の責務境界に整理する。

## デプロイ（Phase 5 成果物の一部を作り直し）

- `packages/web/Dockerfile`: caddy 焼き込みを廃止し、node:24-alpine の build ステージ → runtime ステージ構成に変更。`pnpm deploy` で web + server の本番依存を集め、`dist`（client + server）と `server` をコピー、`CMD ["node", "server/index.js"]`。`packages/api/Dockerfile` と同じ workspace パターン
- `docker-compose.yml`: `web` サービスを追加（`build: packages/web/Dockerfile`、`environment: KUV_API_BASE=http://api:3001` / `PORT=3000`、`depends_on: api`）。`caddy` は web 焼き込みイメージの build をやめ、`caddy:2-alpine` イメージに戻して `web:3000` へ `reverse_proxy`
- `Caddyfile`: 静的配信の `handle`（`root * /srv/web` + `try_files` + `file_server`）を `reverse_proxy web:3000` に置き換え。`/api/*` `/i/*` の reverse_proxy は維持
- `deploy/MIGRATION.md`: §3 スモークの期待値（`curl /` が SSR HTML を返す）と、compose に web サービスが増えたことを反映

Phase 5（Vikunja task #8 / id=332）はまだ実 CT 移行前。今 SSR 化して構成を固めてから移行するのが好都合で、二度手間にならない。

## エラー処理

- `+data` の 401 → `vike/abort` の `redirect("/login")`（302）。その他の API エラーは throw し、vike のエラーページに委ねる
- SSR で `KUV_API_BASE` 未設定なら `http://api:3001`（compose の内部ネットワーク既定）にフォールバック

## テスト

- `lib/api.ts` の baseUrl 解決 + cookie 転送をユニットテスト（SSR / client の両分岐、`process.env` と `window` の有無で切り替わること）
- `+data.ts` の 401→redirect をユニットテスト（api クライアントをモックし、`Unauthorized` で `redirect` が throw されることを検証）
- 既存コンポーネントテスト（19 本）は data 起点リファクタに追従して調整（初期データを props で注入する形に）
- SSR の end-to-end 確認は実機: compose で起動し `/image/:id` を新タブ・リロードで開いて誤 hydrate しないこと、保護ページ未認証アクセスが `/login` にリダイレクトされることを確認

## 後始末

- `hack` の `13a2e18`（onHydrationEnd による誤 hydrate 乗せ直し）は SSR 化で構造的に不要になるため**破棄**する（`hack` ブランチをローカル + origin から削除）。このコミットは他のどこにもマージされていないため、削除でこのコードは失われる（reflog には残る）
- 本作業は main 基点の `feat/web-ssr` ブランチで行い、PR で main にマージする

## 非対象（やらないこと）

- ランタイムの Bun 化（Node 維持）
- api / shared の変更
- ミューテーション系のサーバアクション化（クライアント fetch のまま）
- SEO / メタタグ最適化（自家用のため不要）
- vike-node 等の追加アダプタ導入（Hono + @hono/node-server で手書き）
