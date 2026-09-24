# kuv

Self-hosted image host

Forked from [Picsur](https://github.com/CaramelFur/Picsur)

## Stack

- **API**: Hono + Drizzle ORM (Node 24)
- **Web**: Vike + React SPA + Tailwind CSS
- **DB**: Postgres
- **Deploy**: docker-compose（Caddy + api + postgres）
- **Tooling**: mise + pnpm workspace

## Development

```bash
mise install                    # Node 24 / pnpm
pnpm install
docker compose up -d postgres
pnpm dev:api                    # Hono API (tsx watch)
pnpm dev:web                    # Vike dev server
```

test, typecheck, build:

```bash
pnpm test
pnpm typecheck
pnpm build
```

## Environment

| name | required | default |
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

AGPL-3.0
