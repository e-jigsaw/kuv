# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

> **⚠️ 全面書き直し進行中（2026-06）。** このリポジトリは Hono + Drizzle + Vike の新スタックへ移行中。
> 旧 NestJS/Angular 実装は `archive/` に退避済み（参照専用）。新コードは `packages/{shared,api,web}` の pnpm workspace。
> 設計は `docs/superpowers/specs/2026-06-03-picsur-rewrite-design.md`、足場計画は `docs/superpowers/plans/2026-06-03-picsur-foundation.md` を参照。
> 以下の旧アーキテクチャ記述は `archive/` のコードについての説明。

## What this is

Picsur is a self-hosted image host (Imgur/Pastebin hybrid). It's a Yarn (Berry, `yarn@3.2.2`) monorepo with three workspaces under `package.json` `workspaces`: `shared`, `backend`, `frontend`. Node `v18.8` (`.nvmrc`).

## Workspace layout & build order

- `shared/` (`picsur-shared`) — DTOs, entity interfaces, Zod validators, the `Failable` error type, and util helpers used by **both** backend and frontend. Compiled to `shared/dist`.
- `backend/` (`picsur-backend`) — NestJS 9 on Fastify, TypeORM + Postgres.
- `frontend/` (`picsur-frontend`) — Angular 15 + Angular Material + Bootstrap.

**Critical:** backend and frontend import from the *compiled* output `picsur-shared/dist/...`, not source. `shared` must be built before (or watched alongside) the other two, or imports break. There is no top-level script that orchestrates all three — run each workspace's dev process separately.

## Common commands

Run from repo root unless noted. Dev database (Postgres 14, db/user/pass all `picsur`, port 5432):

```bash
yarn devdb:start      # docker-compose up -d the dev postgres
yarn devdb:stop
yarn devdb:remove     # also drops the volume
```

Per workspace (`cd shared|backend|frontend` first, or `yarn workspace <name> <script>`):

```bash
# shared
yarn build            # tsc once
yarn start            # tsc-watch (rebuild on change — keep running during dev)

# backend (NestJS)
yarn start:dev        # nest start --watch (depends on shared/dist + devdb)
yarn build            # nest build
yarn lint             # eslint --fix
yarn migrate          # generate a TypeORM migration from entity changes (PICSUR_PRODUCTION=true)

# frontend (Angular)
yarn start            # ng serve --host 0.0.0.0
yarn build            # ng build
```

Formatting is Prettier from root: `yarn format`. There is no test runner wired up (no `test` scripts beyond Nest scaffolding).

Production build/release is a two-stage Docker buildx via `support/build.sh alpha|stable` (pushes to `ghcr.io/rubikscraft/picsur`). It builds version from root `package.json`; bump versions with `yarn setversion`.

## Architecture

### The `Failable` pattern (shared/src/types/failable.ts)

This is the core error-handling convention across the **entire** backend and frontend — used in ~40+ files. Functions that can fail return `AsyncFailable<T>` / `Failable<T>` (= `T | Failure`) instead of throwing. Callers check with `HasFailed(result)` (narrows to `Failure`) before using the value. Construct failures with `Fail(FT.NotFound, ...)` where `FT` is the failure-type enum (each maps to an HTTP code). Use `ThrowIfFailed(...)` in controllers to convert a `Failure` into a thrown error the exception filter handles. **Do not `throw` for expected error conditions — return a `Fail(...)`.**

### Backend request pipeline (backend/src/main.ts, layers/)

Global, applied in `main.ts`: `MainExceptionFilter` → `SuccessInterceptor` (wraps responses in the standard API envelope) → `ZodValidationPipe` → guards `PicsurThrottlerGuard` then `MainAuthGuard`. Everything routes through these — new endpoints get validation, throttling, auth, and response wrapping for free.

- **Validation:** DTOs are Zod schemas in `shared/src/dto`, turned into Nest DTO classes via `createZodDto`. The same schemas validate on the frontend. Add/change a request or response shape in `shared`, not in the controller.
- **Auth:** permission-based. `Permission` enum (`shared/src/dto/permissions.enum.ts`) gates routes via the `@RequiredPermissions(...)` decorator; roles bundle permissions. Passport strategies: JWT, local, and header API key. The guest role's permissions control anonymous access (e.g. whether registration/anonymous upload is allowed).

### Backend layers (backend/src)

- `routes/` — controllers, grouped `routes/api/*` (JSON API under `/api`) and `routes/image/*` (image upload + the public `/i` image-serving route, which has its own permissive CORS set in `app.module.ts`).
- `managers/` — business logic (`auth`, `image`, `usage`, `demo`). The image manager (`managers/image`) splits into `image.service` (orchestration), `image-processor.service` (ingest processing — exif strip etc.), `image-converter.service` (format/edit conversion via `sharp`), and `webpinfo` (animated-WebP detection).
- `collections/` — `*-db.service.ts` data-access layer wrapping TypeORM repositories (users, roles, images, apikeys, preferences, system-state).
- `config/early` & `config/late` — config services reading `PICSUR_*` env vars (prefix in `config.static.ts`). Defaults: host `0.0.0.0`, port `8080`. Notable vars: `PICSUR_PRODUCTION`, `PICSUR_DEMO`, `PICSUR_DEMO_INTERVAL`, `PICSUR_TELEMETRY`, `PICSUR_STATIC_FRONTEND_ROOT`. In production the backend also serves the built frontend statically.
- `workers/sharp` — image transforms run via `sharp`. Supported/processed formats also include QOI and BMP via dedicated libs.
- `database/` — TypeORM entities (`entities/`) and `migrations/` (named `<timestamp>-V_x_y_z.ts`). `datasource.ts` bootstraps a Nest app just to build the `DataSource` for the TypeORM CLI. **Note:** there are two generations of image entities. The original `image*.entity.ts` are legacy (still listed in `entities/index.ts` `EntityList` for back-compat), but the live code path uses the `*.entity.v2.ts` set (`EImageBackendV2` / `EImageFileBackendV2` / `EImageDerivativeBackendV2`), added in migration `V_0_6_0_a`. When changing image storage, edit the **v2** entities.

### Image storage & derivative cache (backend/src/managers/image, collections/image-db)

Images are stored as binary (`bytea`) **directly in Postgres**, not on disk:

- An image's `id` is the **SHA-256 hash of the uploaded buffer** (content-addressed, so identical uploads dedupe). `EImageBackendV2` holds metadata (`user_id`, `created`, `file_name`, `expires_at`, optional `delete_key`).
- `EImageFileBackendV2` holds the actual file bytes per `ImageEntryVariant`: `MASTER` (the processed/ingested version, always present) and optionally `ORIGINAL` (kept only when the user's `KeepOriginal` preference is on).
- `EImageDerivativeBackendV2` is an **on-demand conversion cache**: when a client requests a format/edit, `getConverted` computes a `converted_key = sha256(JSON.stringify(options))`, looks up a cached derivative, and only runs `sharp` conversion on a miss. `last_read` tracks freshness for cache eviction. Edit operations (resize/rotate/etc.) are gated by the `AllowEditing` system preference.
- Concurrent identical conversions are de-duplicated via `MutexFallBack` (`util/mutex-fallback.ts`) so the same derivative isn't generated twice in parallel.

### ESM note

Backend is pure ESM (`"type": "module"`). It runs with `node --es-module-specifier-resolution=node` (see backend `start*` scripts) because imports are extensionless. Keep that flag when adding run commands.

### Frontend (frontend/src/app)

Standard Angular 15 module structure: `routes/`, `components/`, `services/` (`services/api/*` wrap the backend, built on `services/api/api.service.ts`), `guards/`, `pipes/`. It shares DTOs/validators with the backend via `picsur-shared`. Custom webpack config (`custom-webpack.config.js`) trims moment.js locales.
