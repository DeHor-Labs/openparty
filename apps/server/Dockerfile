# apps/server/Dockerfile
FROM node:22-alpine AS base
RUN corepack enable && corepack prepare pnpm@latest --activate

WORKDIR /app

# Copiar apenas arquivos de dependencias primeiro para cache de camadas
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./
COPY packages/protocol/package.json ./packages/protocol/
COPY apps/server/package.json ./apps/server/

RUN pnpm install --frozen-lockfile --filter @openparty/server... --filter @openparty/protocol

# Copiar fontes
COPY packages/protocol ./packages/protocol
COPY apps/server ./apps/server
COPY tsconfig.base.json ./

# Build do protocolo e depois do servidor
RUN pnpm --filter @openparty/protocol build
RUN pnpm --filter @openparty/server build

# Imagem de producao
FROM node:22-alpine AS runner
RUN corepack enable && corepack prepare pnpm@latest --activate

WORKDIR /app

COPY --from=base /app/package.json ./
COPY --from=base /app/pnpm-workspace.yaml ./
COPY --from=base /app/pnpm-lock.yaml ./
COPY --from=base /app/packages/protocol/package.json ./packages/protocol/
COPY --from=base /app/apps/server/package.json ./apps/server/

RUN pnpm install --frozen-lockfile --prod --filter @openparty/server... --filter @openparty/protocol

COPY --from=base /app/packages/protocol/dist ./packages/protocol/dist
COPY --from=base /app/apps/server/dist ./apps/server/dist

ENV NODE_ENV=production
ENV PORT=3000

EXPOSE 3000

CMD ["node", "apps/server/dist/index.js"]
