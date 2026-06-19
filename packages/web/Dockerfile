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
RUN pnpm --filter @kuv/web deploy --prod --legacy /deploy

FROM node:24-alpine AS runtime
WORKDIR /app
COPY --from=build /deploy ./
ENV NODE_ENV=production
ENV PORT=3000
EXPOSE 3000
CMD ["node", "server/index.ts"]
