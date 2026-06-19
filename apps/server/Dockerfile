# apps/server/Dockerfile
# Stage de build: oven/bun inclui Node.js e npm; adicionamos pnpm para workspaces
FROM oven/bun:1-alpine AS base

RUN npm install -g pnpm

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

# Imagem de producao: apenas Bun para rodar o servidor compilado
FROM oven/bun:1-alpine AS runner

WORKDIR /app

COPY --from=base /app/packages/protocol/dist ./packages/protocol/dist
COPY --from=base /app/apps/server/dist ./apps/server/dist
COPY --from=base /app/apps/server/package.json ./apps/server/package.json
COPY --from=base /app/packages/protocol/package.json ./packages/protocol/package.json

ENV NODE_ENV=production
ENV PORT=3000

EXPOSE 3000

CMD ["bun", "run", "apps/server/dist/index.js"]
