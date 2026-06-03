# Picsur 全面書き直し設計 (DB 引き継ぎ / Hono + Drizzle + Vike)

- 日付: 2026-06-03
- 対象 repo: `e-jigsaw/Picsur`（据え置き、旧コードは `archive/` へ退避）
- ステータス: 設計承認済み → 実装計画(writing-plans)へ

## 背景と目的

Picsur は jigsaw の**自家用**（self-hosted, 個人利用）image host。約3年放置され Node18 / Angular15 / NestJS9 / Fastify4 / TypeORM / yarn が軒並み EOL もしくはメジャー数世代落ち。部分アップグレードを積むより、**Postgres のスキーマとデータだけ引き継いで新スタックで全面書き直す**方が総コスト・保守性で勝ると判断した。

ゴール: 既存のアップ済み画像・管理者アカウント・ShareX 用 apikey を**生かしたまま**、モダンで軽量な自家用プライベート image store に作り替える。

## スコープ方針（自家用最小限）

公開サービス前提の機能を大幅にトリムする。

**残す**: 画像アップロード / exif strip / オンデマンド形式変換 + derivative キャッシュ / 画像配信 / 自分の画像一覧 / 管理者ログイン / ShareX 用 apikey 発行・失効 / `keep_original` 設定 / パスワード変更。

**撤去**: RBAC（role / permission）/ 複数ユーザー / 匿名ユーザという概念そのもの / 匿名登録 / demo モード / guest 権限制御 / `delete_key` / expiry（期限切れ）/ telemetry（phone-home と Ackee proxy の両系統）/ rate limiting / `system_state` / QOI・TIFF・BMP 対応 / 画像編集（resize/rotate/flip/negative/greyscale）。

**プライバシーモデル（重要）**: public ルートは存在しない。`/i/*`（画像配信）を含め**全ルートが認証必須**。未認証アクセスは 401 で、画像も一切見えない。「匿名ユーザ」をエンティティとしてモデル化しない（admin 1人のみ、未認証＝拒否）。

> 注: 全ルート認証必須のため、チャット unfurl 用の og:image SSR は原理的に成立しない（外部 bot は認証不可）。よってフロントは SSR 不要・全ページ SPA とする。

## スタック

| レイヤー | 採用 | 備考 |
|---|---|---|
| runtime | Node 24 (mise 管理) | `.nvmrc` 廃止、`mise.toml` |
| パッケージ管理 | pnpm (workspace) | yarn / `.yarn` / `.yarnrc.yml` 廃止 |
| api | Hono | エラーは `app.onError` に集約 |
| ORM | Drizzle | 既存 v2 スキーマを introspect→prune、DTO は `drizzle-zod` |
| web | Vike (SPA モード, ssr 全オフ) + React | Tailwind でスタイル |
| 前段 | Caddy | リバプロで単一オリジン化 |
| テスト | Vitest | 画像は characterization、API は `app.request()` |

## モノレポ構成

```
Picsur/ (pnpm workspace, Node24/mise)
├─ packages/
│   ├─ shared/   … Drizzle schema + drizzle-zod DTO + 共有型・定数
│   ├─ api/      … Hono サーバ。/api/* (JSON) + /i/* (画像 bytea 配信)
│   │              src/{routes,services,db,middleware}/
│   └─ web/      … Vike(SPA) + React + Tailwind。ビルド成果物は静的 dist
├─ archive/      … 旧 backend/frontend/shared/support を退避（参照用）
├─ docs/superpowers/specs/
├─ docker-compose.yml      … caddy + api + postgres
├─ Caddyfile
├─ packages/api/Dockerfile
├─ drizzle.config.ts
└─ mise.toml
```

- `shared` の Drizzle schema を api（クエリ）と web（フォーム検証・レスポンス型）の両方が import する。
- `web` は静的 SPA なので runtime プロセスを持たない。Caddy が `web/dist` を直接配信する。

## アーキテクチャ / データフロー

```
ブラウザ ──▶ Caddy ──┬─ /api/*, /i/*  ──▶ api (Hono) ──▶ Drizzle ──▶ Postgres
                     └─ それ以外       ──▶ web/dist 静的配信 (SPA fallback)
```

- front/back を分離（pnpm 3パッケージ）するが、前段 Caddy が `/api/*` `/i/*` を api に、それ以外を web 静的配信に振るため、**ブラウザからは単一オリジンに見え CORS が不要**。
- 画像 bytea は api が Postgres から直接ストリームする。

## データモデル（Drizzle schema）

既存 prod DB を `drizzle-kit introspect` で取り込み、スコープ外をプルーニングした最終形。

| テーブル | 旧名 | カラム（最終形） |
|---|---|---|
| `image` | `e_image_backend_v2` | `id`(sha256), `user_id`, `created`, `file_name` |
| `image_file` | `e_image_file_backend_v2` | `id`, `image_id`, `variant`(master/original), `filetype`, `data`(bytea) |
| `image_derivative` | `e_image_derivative_backend_v2` | `id`, `image_id`, `key`(=sha256(形式)), `filetype`, `last_read`, `data`(bytea) |
| `user` | users 系 | `id`, `username`, `password`(bcrypt)。1行=admin |
| `apikey` | apikey 系 | `id`, `user_id`, `name`, `key` |
| `settings` | sys/usr preferences 統合 | `keep_original`(bool) 等の単一行 |

- `image` から `expires_at` / `delete_key` は撤去。`user` から role 参照は撤去。`roles` / `permissions` / `system_state` テーブルは DROP。
- 定数（content-hash-id 規約 / variant enum / 対応 mime 一覧）は `shared` に置く。
- TypeORM の migration 履歴は捨て、Drizzle で「現状の最終形」をスナップショットした初期 migration 群に一本化する。

## 認証・認可

- **認可は二値**: 認証済み（admin の JWT or 有効な apikey）/ それ以外（401）。RBAC は無い。
- **Web ログイン**: `POST /api/auth/login` で username/password → bcrypt 照合（user 1行）→ JWT を httpOnly cookie で発行。
- **apikey**: ShareX 等が Authorization ヘッダ、または画像直リン用に `?key=` で送る。api middleware が `apikey` テーブルを照合し admin として認可。
- **JWT secret**: env `PICSUR_JWT_SECRET`（必須）。旧実装は `system_state` に保存していたが撤去したため env 一本化。
- **middleware**: `authMiddleware` が JWT cookie か apikey を解決して `c.set('user', …|null)`。各ルートで要否を判定。`/i/*` を含む全ルートで未認証は 401。
- パスワード変更・apikey 発行/失効は settings 画面 + `/api` 経由。

## 画像パイプライン

対応形式: **PNG / JPG / WebP(アニメ含む) / GIF**。

- **アップロード** `POST /api/image`（要認証）:
  1. Hono `c.req.parseBody()` で multipart → Buffer
  2. SHA-256 を算出して `image.id` とする（**content-hash dedupe**: 既存なら既存を返す）
  3. filetype 判定（`file-type` + WebP アニメ判定）
  4. exif strip（sharp。アニメは `{ animated: true }` でフレーム保持）
  5. master を `image_file` に保存（`keep_original` 設定時は original も保存）
  6. links を JSON で返却（ShareX 用に画像 URL を含む。deletion_url は無し）
     - 返す URL も認証必須（完全プライベート方針と整合）。ブラウザでは admin のログインセッションで、プログラム経由では apikey(`?key=`)で閲覧する。匿名閲覧可能な URL は発行しない
- **配信** `GET /i/:id` または `GET /i/:id.:ext`（要認証）:
  - ext 指定かつ master と異なる形式 → derivative を取得、それ以外は master を返す
  - content-type / cache ヘッダ / 埋め込み用に `Cross-Origin-Resource-Policy: cross-origin` を付与
- **オンデマンド変換 / derivative**:
  - `key = sha256(対象形式)`（編集オプションが無くなったので形式のみ）
  - `image_derivative` にキャッシュ、`last_read` を更新
  - 並行する同一変換は `MutexFallBack`（旧 util を移植、framework 非依存）で重複生成を防止
- **削除** `DELETE /api/image/:id`（要認証）のみ。delete_key 方式は撤去。
- expiry・期限切れ掃除ジョブは無し（基本ストアするだけ）。

## フロントエンド（Vike SPA + React + Tailwind）

- ルーティングは旧構成を参考に最低限の4ページ:
  - `/login` — admin ログイン
  - `/` — アップロード + 自分の画像一覧（要認証）
  - `/settings` — `keep_original` / apikey 発行・失効 / パスワード変更（要認証）
  - `/:id` — 画像 view ページ（要認証、SPA）
- Vike は全ページ `ssr: false` の SPA モード。認証ガードは Vike の guard フック（未認証 → `/login` へ）。
- データ取得は `/api` を fetch（SSR データ規約は使わない）。画像は `<img src="/i/...">`（cookie 認証）。
- UI は軽量方針。旧 Angular Material + Bootstrap は踏襲しない。Tailwind + 手書きコンポーネント。

## 移行 / データ引き継ぎ

1. `drizzle-kit introspect`（現 prod DB）で baseline を取り込む。
2. プルーニング後の最終 schema を定義し、`drizzle-kit generate` で移行 migration を生成:
   - DROP: `roles`, `permissions`, `system_state`
   - ALTER `image`: `expires_at` / `delete_key` 削除
   - `user`: role 参照削除（admin 1行に縮小）
   - sys/usr preferences → `settings`（`keep_original`）へ統合
   - `e_*_backend_v2` テーブルを `image` / `image_file` / `image_derivative` / `user` / `apikey` に RENAME（データ保持）
3. 既存の `image` / `image_file` の bytea 行は無傷。`user`(admin) + `apikey` を維持 → 既存アカウント・ShareX キー・アップ済み画像が生きる。
4. **derivative キャッシュは migration で TRUNCATE**（旧 key=`sha256(編集オプション込)` と新 key=`sha256(形式)` が非互換。再生成可能なので空にする）。
5. master / original は旧 sharp 処理済みバイトをそのまま配信（valid な画像なので再処理不要）。

**根拠**: 既存 bytea を無傷で運べるため、旧処理との byte 一致は不要。再実装が必要なのは新規アップロードの処理経路と認可のみ。

## テスト戦略（Vitest）

旧コードにはテストが1件も無い（実装コードが唯一の仕様）。`archive/` の旧コードを参照仕様とし、characterization で挙動を固定する。

- **画像パイプライン characterization**: fixture（PNG / JPG / 静止 + アニメ WebP / GIF）を配置。byte 一致は要求せず以下をアサート:
  - sha256 id が安定（同入力 → 同 id, dedupe）
  - master が期待形式の valid 画像
  - exif が除去されている
  - アニメのフレームが保持される
  - 形式変換が valid な対象形式を返す
  - 2回目の derivative 要求は cache hit（再変換しない）
  - 並行変換が `MutexFallBack` で重複しない
- **API**: Hono `app.request()` で — JWT / apikey 認証、**未認証は `/i` 含め 401**、upload→保存→配信 round-trip、削除（要認証のみ）、settings 操作。
- **Drizzle**: dev compose の Postgres（または testcontainers）相手にクエリ / リポジトリ層。
- **web**: スモーク程度（カバレッジは api 中心、YAGNI）。

## デプロイ

- `web` は静的 SPA のため runtime プロセスを持たない。Caddy が `web/dist` を SPA fallback 付きで配信する。
- `docker-compose.yml` の services = **caddy + api + postgres** の3つ:
  - **caddy**: 前段。`/api` `/i` → api、それ以外 → `web/dist` 静的配信
  - **api**: `packages/api/Dockerfile`（node24-alpine、Hono 起動）
  - **postgres**: 既存 DB
- env: `PICSUR_JWT_SECRET` / DB creds 等。dev は `mise.toml`（node24 + pnpm）。
- 旧 2-stage buildx / multi-arch / ghcr push は全廃止。

## 非対象（このスペックでやらないこと）

- 公開ギャラリー / アルバム / 複数ユーザー / 共有リンクの匿名閲覧
- 画像編集機能、QOI / TIFF / BMP
- telemetry / アナリティクス
- multi-arch ビルド・ghcr 配布パイプライン

## 実装フェーズ（概略、詳細は writing-plans で）

1. 足場: `archive/` 退避、pnpm workspace + mise + Tailwind + Vitest scaffold、Caddy/compose 雛形
2. shared: Drizzle schema（introspect→prune）+ drizzle-zod DTO + 定数、移行 migration
3. api: 認証 middleware / auth ルート / 画像パイプライン（upload・配信・変換・削除）/ settings / apikey、characterization テスト
4. web: Vike SPA 4ページ + 認証ガード + Tailwind UI
5. デプロイ: Dockerfile / Caddyfile / compose 仕上げ、移行を実 DB に適用

## 実装ノート: 画像パイプラインの分割（2026-06-03 追記、Plan 3b）

Phase 3 のうち認証（middleware / auth ルート）は Plan 3a で完了。画像パイプラインは規模が大きいため **ingest 系と serve 系で 2 分割**する。

- **Plan 3b-1（ingest + 削除）**: `POST /api/image` と `DELETE /api/image/:id`。
- **Plan 3b-2（配信 + 変換）**: `GET /i/:id` / `GET /i/:id.:ext` とオンデマンド変換 + derivative キャッシュ + MutexFallBack。
- settings / apikey 発行・失効は別 Plan（3c 想定）。

### Plan 3b-1 の決定事項

- **依存**: `sharp`（native, `onlyBuiltDependencies` に追加）と `file-type`。旧 `webpinfo` の手書き RIFF パーサは**移植しない** — アニメ判定は `sharp().metadata().pages > 1` で代替する。
- **filetype 判定**: 拡張子でなく `file-type` による実バイト検出 → `isSupportedMime` で検証。非対応は **415**。
- **master 形式**: 旧実装の QOI 正規化は撤去。**元形式を維持**し sharp で同形式に再エンコードして exif/metadata を除去（静止画 `sharp(buf)` / アニメ `sharp(buf, { animated: true })` でフレーム保持）。
- **content-hash**: `sha256(アップロード buffer)` = `image.id`。既存 id があれば**再処理せず既存メタを返す（dedupe）**。
- **original**: `settings.keep_original` が ON のときのみ、元 buffer を元 filetype のまま保存。
- **削除**: 要認証 + `image.user_id` 一致を確認。FK cascade で `image_file` / `image_derivative` も削除。不一致・不在は 404。
- **ユニット分割**: `services/filetype.ts`（検出 + アニメ判定）/ `services/image-ingest.ts`（buffer → `{id, master, original?}` の DB 非依存純粋処理）/ `db/image-queries.ts`（insert・dedupe・delete）/ `routes/image.ts`（配線）。
- **テスト**: PNG / JPG / 静止WebP / アニメWebP / GIF の fixture を使い、testcontainers + `app.request` で characterization（sha256 安定・dedupe / master が valid な元形式 / exif 除去 / アニメ pages 保持 / keep_original / 非対応 415 / 未認証 401 / delete）。
