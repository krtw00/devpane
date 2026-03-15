FROM node:22-slim AS builder
RUN corepack enable pnpm
WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY packages/shared/package.json packages/shared/
COPY packages/daemon/package.json packages/daemon/
COPY packages/web/package.json packages/web/
RUN pnpm install --frozen-lockfile
COPY tsconfig.json ./
COPY packages/ packages/
RUN pnpm build

FROM node:22-slim AS runtime
RUN corepack enable pnpm && apt-get update && apt-get install -y git && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY packages/shared/package.json packages/shared/
COPY packages/daemon/package.json packages/daemon/
COPY packages/web/package.json packages/web/
RUN pnpm install --frozen-lockfile --prod
COPY --from=builder /app/packages/shared/dist packages/shared/dist
COPY --from=builder /app/packages/daemon/dist packages/daemon/dist
COPY --from=builder /app/packages/web/dist packages/web/dist

EXPOSE 3001
CMD ["node", "packages/daemon/dist/index.js"]
