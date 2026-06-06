FROM node:24-alpine AS build
RUN corepack enable
WORKDIR /app
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml ./
COPY packages/shared/package.json packages/shared/
COPY packages/api/package.json packages/api/
# pnpm の --frozen-lockfile は workspace 全体の manifest を要求するため web の package.json も必要
COPY packages/web/package.json packages/web/
RUN pnpm install --frozen-lockfile --filter @kuv/api...
COPY tsconfig.base.json ./
COPY packages/shared packages/shared
COPY packages/api packages/api
RUN pnpm --filter @kuv/api build
RUN pnpm --filter @kuv/api deploy --prod --legacy /deploy

FROM node:24-alpine AS runtime
WORKDIR /app
COPY --from=build /deploy ./
ENV NODE_ENV=production
ENV PORT=3001
EXPOSE 3001
CMD ["node", "dist/server.js"]
