FROM node:24-alpine AS build
RUN corepack enable
WORKDIR /app
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml ./
COPY packages/shared/package.json packages/shared/
COPY packages/web/package.json packages/web/
# pnpm の --frozen-lockfile は workspace 全体の manifest を要求するため api の package.json も必要
COPY packages/api/package.json packages/api/
RUN pnpm install --frozen-lockfile --filter @kuv/web...
COPY tsconfig.base.json ./
COPY packages/shared packages/shared
COPY packages/web packages/web
RUN pnpm --filter @kuv/web build

FROM caddy:2-alpine
# Caddyfile は compose で bind-mount する（設定変更でリビルドしないため）
COPY --from=build /app/packages/web/dist/client /srv/web
