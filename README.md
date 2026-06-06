# kuv

Self-hosted image host。Imgur と Pastebin のあいのこ。

[Picsur](https://github.com/CaramelFur/Picsur) の fork を Hono + Drizzle + Vike で全面的に書き直したもの（旧名 Picsur、2026-06 に改名）。

## Stack

- **API**: Hono + Drizzle ORM (Node 24)
- **Web**: Vike + React SPA + Tailwind CSS
- **DB**: Postgres（画像バイナリも DB に格納）
- **Deploy**: docker-compose（Caddy + api + postgres）
- **Tooling**: mise + pnpm workspace

## Development

```bash
mise install                    # Node 24 / pnpm
pnpm install
docker compose up -d postgres   # 開発用 DB
pnpm dev:api                    # Hono API (tsx watch)
pnpm dev:web                    # Vike dev server
```

テスト・型チェック・ビルド:

```bash
pnpm test
pnpm typecheck
pnpm build
```

## Environment

| 変数 | 必須 | デフォルト |
|---|---|---|
| `KUV_JWT_SECRET` | ✓ | — |
| `KUV_DB_HOST` | | `localhost` |
| `KUV_DB_PORT` | | `5432` |
| `KUV_DB_USER` | | `kuv` |
| `KUV_DB_PASSWORD` | | `kuv` |
| `KUV_DB_DATABASE` | | `kuv` |

## Deployment

`KUV_JWT_SECRET` を渡して `docker compose up -d`。構成と blue-green 移行手順は `docs/superpowers/specs/` を参照。

## License

AGPL-3.0（upstream Picsur 由来）
