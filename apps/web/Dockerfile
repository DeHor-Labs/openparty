# apps/web/Dockerfile
FROM node:22-alpine AS base
RUN corepack enable && corepack prepare pnpm@latest --activate

WORKDIR /app

COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./
COPY packages/protocol/package.json ./packages/protocol/
COPY packages/ui/package.json ./packages/ui/
COPY apps/web/package.json ./apps/web/

RUN pnpm install --frozen-lockfile --filter @openparty/web... --filter @openparty/protocol --filter @openparty/ui

COPY packages/protocol ./packages/protocol
COPY packages/ui ./packages/ui
COPY apps/web ./apps/web
COPY tsconfig.base.json ./

ARG VITE_SERVER_URL=http://localhost:3000
ENV VITE_SERVER_URL=$VITE_SERVER_URL

RUN pnpm --filter @openparty/protocol build
RUN pnpm --filter @openparty/ui build
RUN pnpm --filter @openparty/web build

# Imagem de producao com serve
FROM node:22-alpine AS runner

RUN npm install -g serve@14

WORKDIR /app

COPY --from=base /app/apps/web/dist ./dist

ENV NODE_ENV=production

EXPOSE 5173

CMD ["serve", "-s", "dist", "-l", "5173"]
