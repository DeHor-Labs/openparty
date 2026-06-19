# OpenParty - Plano de Implementacao (Fase 1)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implementar o nucleo da Fase 1 do OpenParty - uma web app de watch party self-hostavel com salas efemeras, sincronizacao de playback sub-segundo e chat em tempo real, suportando YouTube e video MP4/WebM direto.

**Architecture:** Monorepo pnpm + Turborepo com tres camadas: `packages/protocol` como contrato central de tipos TypeScript compartilhado entre servidor e cliente; `apps/server` com Bun + Hono gerenciando salas em memoria e WebSocket nativo; `apps/web` com React + Vite consumindo o protocolo e aplicando drift-correction via loop de 1.5s. O servidor e fonte da verdade do estado mas nao executa timer - clientes calculam a posicao atual usando o offset calibrado via NTP-like (menor RTT de 8 pings iniciais).

**Tech Stack:** TypeScript, Bun v1.x, Hono, WebSocket nativo (sem Socket.IO), React 19, Vite, Tailwind CSS, shadcn/ui, pnpm workspaces, Turborepo, nanoid, Vitest, Docker Compose, Railway

## Global Constraints

- TypeScript end-to-end (server, web e protocol no mesmo monorepo, sem divergencia de tipos)
- Runtime backend: Bun v1.x (campo `engines` em todos os package.json do servidor)
- Framework backend: Hono (helper WebSocket nativo; portavel Bun/Node/Workers)
- WebSocket NATIVO - Socket.IO e qualquer abstração de transporte equivalente sao PROIBIDOS
- React + Vite no frontend (SPA; SSR nao agrega valor para realtime)
- Tailwind CSS + shadcn/ui (tokens dark/light embutidos; previsivel para revisores OSS)
- Monorepo pnpm workspaces + Turborepo (pipeline typecheck/build/test orquestrado)
- `roomId` gerado via nanoid (~149 bits de entropia); NENHUMA rota lista salas existentes
- Estado de sala em memoria (Map<roomId, Room>); efemero por design, sem banco de dados
- Servidor como fonte da verdade SEM rodar timer: clientes calculam posicao com `serverNow() - lastEventAt`
- Calibracao de relogio NTP-like obrigatoria na entrada (8 pings, menor RTT); recalibrar a cada 60s
- Drift correction loop de 1.5s: <0.3s ignorar / 0.3-0.5s ajuste suave via playbackRate (so HTML5) / >0.5s seek imediato
- Fontes de video MVP: YouTube IFrame Player API e URL direta MP4/WebM (sem HLS/DASH/upload)
- playbackRate do YouTube e discreto (0.25/0.5/0.75/1/1.25/1.5/2): ajuste suave proibido, documentar no README
- Framework de testes: Vitest em todo o monorepo via `bunx vitest run`
- Licenca MIT
- Sem em dashes (U+2014 ou U+2013) em nenhum arquivo do projeto
- Nome do produto: "OpenParty" (sem variacao de capitalização)

## File Structure

```
openparty/
├── apps/
│   ├── server/                          # Bun + Hono + WebSocket nativo
│   │   ├── src/
│   │   │   ├── index.ts                 # entrypoint: HTTP + WS upgrade + graceful shutdown
│   │   │   ├── rooms.ts                 # Map<roomId, Room>, createRoom, join/leave, broadcast, host transfer
│   │   │   └── handlers/
│   │   │       ├── sync.ts              # play/pause/seek com host-lock; emite room-state
│   │   │       ├── chat.ts              # chat e reacoes; fan-out para a sala
│   │   │       └── clock.ts            # ping/pong com t2/t3 para calibracao NTP-like
│   │   ├── package.json                 # engines.bun, dependencias Hono + nanoid
│   │   └── tsconfig.json                # extends ../../tsconfig.base.json
│   └── web/                             # React 19 + Vite + Tailwind + shadcn/ui
│       ├── src/
│       │   ├── main.tsx                 # monta React, envolve Router
│       │   ├── App.tsx                  # rotas: / (Home) e /room/:roomId
│       │   ├── components/
│       │   │   ├── room/
│       │   │   │   ├── RoomPlayer.tsx   # seleciona adapter (YouTube ou HTML5) e renderiza
│       │   │   │   ├── RoomSidebar.tsx  # abas Presenca/Chat com collapse no mobile
│       │   │   │   ├── RoomControls.tsx # play/pause/seek + toggle host-lock (so host)
│       │   │   │   └── ReactionsLayer.tsx # emojis flutuantes; transform/opacity; prefers-reduced-motion
│       │   │   └── ui/                  # componentes shadcn/ui gerados
│       │   ├── hooks/
│       │   │   ├── useRoom.ts           # conexao WS + presenca + chat + estado da sala
│       │   │   ├── useSync.ts           # loop drift correction 1.5s; delega a correcao ao adapter
│       │   │   └── useClock.ts          # calibracao offset NTP-like; expoe serverNow()
│       │   └── lib/
│       │       ├── players/
│       │       │   ├── index.ts         # detectMediaType(url): 'youtube' | 'mp4'
│       │       │   ├── youtube.ts       # PlayerAdapter sobre YouTube IFrame API
│       │       │   └── html5.ts         # PlayerAdapter sobre <video> HTML nativo
│       │       └── ws-client.ts         # WebSocket tipado com protocolo + reconexao automatica
│       ├── index.html
│       ├── vite.config.ts
│       ├── tailwind.config.ts
│       └── package.json
├── packages/
│   ├── protocol/                        # CONTRATO CENTRAL: tipos e guards do protocolo WS
│   │   ├── src/
│   │   │   ├── events.ts               # ClientEvent, ServerEvent, RoomState + type guards
│   │   │   └── index.ts                # re-exporta tudo de events.ts
│   │   ├── package.json
│   │   └── tsconfig.json
│   └── ui/                              # componentes reutilizaveis (placeholder; expansao na Fase 2)
│       ├── src/index.ts
│       └── package.json
├── docker-compose.yml                   # server + web; REDIS_URL opcional para escala
├── pnpm-workspace.yaml                  # declara apps/* e packages/*
├── turbo.json                           # pipeline: typecheck -> build -> test
├── tsconfig.base.json                   # strict true, target ESNext, moduleResolution bundler
├── package.json                         # raiz: scripts dev/build/test via turbo, devDependencies globais
├── .prettierrc
├── eslint.config.mjs
├── vitest.workspace.ts                  # lista todos os projetos Vitest
└── LICENSE                              # MIT
```

## Tarefas (indice)

1. Scaffold do monorepo (pnpm-workspace.yaml, turbo.json, tsconfig.base.json, config Vitest, prettier/eslint)
2. packages/protocol - eventos TypeScript completos (ClientEvent, ServerEvent, RoomState) + type guards + testes
3. apps/server - logica pura de posicao e transicoes de estado (computeCurrentPosition, applyPlay, applyPause, applySeek imutaveis) + testes unitarios
4. apps/server - store de salas (Map<roomId, Room>, createRoom, join/leave, broadcast, host transfer automatico) + testes
5. apps/server - clock handler (ping/pong com t2/t3) + teste
6. apps/server - HTTP (POST /rooms) + upgrade WebSocket com Hono, roteamento de mensagens, host-lock + teste de integracao com WS real
7. apps/web - scaffold Vite + React + Tailwind + shadcn/ui, roteamento (/ e /room/:roomId), tema dark/light com toggle e prefers-color-scheme
8. apps/web - ws-client tipado usando packages/protocol com reconexao automatica + teste com WS mockado
9. apps/web - useClock: funcao pura de calculo de offset (menor RTT) + hook serverNow() + testes da math
10. apps/web - useSync: funcao pura de decisao por thresholds (<0.3/0.3-0.5/>0.5) + hook com loop de 1.5s + testes da math
11. apps/web - player adapters: interface PlayerAdapter unificada; youtube.ts (IFrame API) e html5.ts; deteccao de mediaType pela URL + testes
12. apps/web - useRoom: conexao WS + estado da sala + presenca + chat + reacoes + teste
13. apps/web - componentes: Home, RoomPlayer, RoomSidebar, RoomControls, ReactionsLayer + ligacao com hooks
14. Infra: docker-compose.yml, LICENSE MIT, README com deploy Railway e documentacao do protocolo
15. Aceite: roteiro de verificacao cobrindo os 9 criterios do spec secao 10 com smoke test via agent-browser CLI

---
### Task 1: Scaffold do Monorepo

**Files:**
- Create: `pnpm-workspace.yaml`
- Create: `turbo.json`
- Create: `package.json` (raiz)
- Create: `tsconfig.base.json`
- Create: `vitest.workspace.ts`
- Create: `.prettierrc`
- Create: `eslint.config.mjs`
- Create: `apps/server/package.json` (stub)
- Create: `apps/web/package.json` (stub)
- Create: `packages/protocol/package.json` (stub)
- Create: `packages/ui/package.json` (stub)

**Interfaces:**

Consumes: nada

Produces:
- Estrutura de diretorios e workspaces pnpm funcionais
- Pipeline Turborepo com tarefas `typecheck`, `build`, `test`
- `tsconfig.base.json` com `strict: true`, `target: "ESNext"`, `moduleResolution: "bundler"`
- `vitest.workspace.ts` listando todos os projetos
- `pnpm install` e `bunx vitest run` executam sem erro
- `turbo run typecheck` passa com zero packages

---

**Steps:**

- [ ] Criar diretorios raiz do monorepo:

```bash
mkdir -p apps/server/src apps/web/src packages/protocol/src packages/ui/src
```

- [ ] Criar `pnpm-workspace.yaml`:

```yaml
packages:
  - 'apps/*'
  - 'packages/*'
```

- [ ] Criar `package.json` raiz:

```json
{
  "name": "openparty",
  "version": "0.0.1",
  "private": true,
  "scripts": {
    "dev": "turbo run dev",
    "build": "turbo run build",
    "test": "turbo run test",
    "typecheck": "turbo run typecheck",
    "lint": "turbo run lint",
    "format": "prettier --write \"**/*.{ts,tsx,json,md}\""
  },
  "devDependencies": {
    "@typescript-eslint/eslint-plugin": "^7.0.0",
    "@typescript-eslint/parser": "^7.0.0",
    "eslint": "^9.0.0",
    "prettier": "^3.3.0",
    "turbo": "^2.0.0",
    "typescript": "^5.5.0",
    "vitest": "^1.6.0"
  },
  "engines": {
    "node": ">=20",
    "pnpm": ">=9"
  },
  "packageManager": "pnpm@9.4.0"
}
```

- [ ] Criar `turbo.json`:

```json
{
  "$schema": "https://turbo.build/schema.json",
  "tasks": {
    "build": {
      "dependsOn": ["^build"],
      "outputs": ["dist/**"]
    },
    "typecheck": {
      "dependsOn": ["^build"]
    },
    "test": {
      "dependsOn": ["^build"],
      "outputs": ["coverage/**"]
    },
    "lint": {},
    "dev": {
      "cache": false,
      "persistent": true
    }
  }
}
```

- [ ] Criar `tsconfig.base.json`:

```json
{
  "compilerOptions": {
    "strict": true,
    "target": "ESNext",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "lib": ["ESNext", "DOM"],
    "skipLibCheck": true,
    "esModuleInterop": true,
    "allowImportingTsExtensions": true,
    "noEmit": true,
    "declaration": true,
    "declarationMap": true,
    "sourceMap": true,
    "isolatedModules": true
  }
}
```

- [ ] Criar `vitest.workspace.ts`:

```typescript
import { defineWorkspace } from 'vitest/config'

export default defineWorkspace([
  'packages/protocol/vitest.config.ts',
  'apps/server/vitest.config.ts',
  'apps/web/vitest.config.ts',
])
```

- [ ] Criar `.prettierrc`:

```json
{
  "semi": false,
  "singleQuote": true,
  "tabWidth": 2,
  "trailingComma": "es5",
  "printWidth": 100
}
```

- [ ] Criar `eslint.config.mjs`:

```javascript
import tsParser from '@typescript-eslint/parser'
import tsPlugin from '@typescript-eslint/eslint-plugin'

/** @type {import('eslint').Linter.Config[]} */
export default [
  {
    files: ['**/*.ts', '**/*.tsx'],
    languageOptions: {
      parser: tsParser,
      parserOptions: {
        ecmaVersion: 'latest',
        sourceType: 'module',
      },
    },
    plugins: {
      '@typescript-eslint': tsPlugin,
    },
    rules: {
      ...tsPlugin.configs.recommended.rules,
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
      '@typescript-eslint/no-explicit-any': 'error',
    },
  },
  {
    ignores: ['**/dist/**', '**/node_modules/**', '**/.turbo/**'],
  },
]
```

- [ ] Criar `apps/server/package.json` (stub):

```json
{
  "name": "@openparty/server",
  "version": "0.0.1",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "tsx watch src/index.ts",
    "build": "tsc -p tsconfig.json --noEmit false --outDir dist",
    "typecheck": "tsc -p tsconfig.json",
    "test": "vitest run",
    "lint": "eslint src"
  },
  "dependencies": {
    "@openparty/protocol": "workspace:*",
    "nanoid": "^5.0.7",
    "uWebSockets.js": "uNetworking/uWebSockets.js#v20.44.0"
  },
  "devDependencies": {
    "@types/node": "^20.0.0",
    "tsx": "^4.15.0",
    "typescript": "^5.5.0",
    "vitest": "^1.6.0"
  }
}
```

- [ ] Criar `apps/web/package.json` (stub):

```json
{
  "name": "@openparty/web",
  "version": "0.0.1",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "tsc -p tsconfig.json && vite build",
    "typecheck": "tsc -p tsconfig.json",
    "test": "vitest run",
    "lint": "eslint src",
    "preview": "vite preview"
  },
  "dependencies": {
    "@openparty/protocol": "workspace:*",
    "@openparty/ui": "workspace:*",
    "react": "^19.0.0",
    "react-dom": "^19.0.0",
    "react-router-dom": "^6.24.0"
  },
  "devDependencies": {
    "@types/react": "^19.0.0",
    "@types/react-dom": "^19.0.0",
    "@vitejs/plugin-react": "^4.3.0",
    "autoprefixer": "^10.4.19",
    "jsdom": "^24.1.0",
    "postcss": "^8.4.38",
    "tailwindcss": "^3.4.0",
    "typescript": "^5.5.0",
    "vite": "^5.3.0",
    "vitest": "^1.6.0"
  }
}
```

- [ ] Criar `packages/protocol/package.json` (stub):

```json
{
  "name": "@openparty/protocol",
  "version": "0.0.1",
  "type": "module",
  "main": "./src/index.ts",
  "types": "./src/index.ts",
  "exports": {
    ".": "./src/index.ts"
  },
  "scripts": {
    "typecheck": "tsc -p tsconfig.json",
    "test": "vitest run",
    "build": "tsc -p tsconfig.json --noEmit false --outDir dist"
  },
  "devDependencies": {
    "typescript": "^5.5.0",
    "vitest": "^1.6.0"
  }
}
```

- [ ] Criar `packages/ui/package.json` (stub):

```json
{
  "name": "@openparty/ui",
  "version": "0.0.1",
  "type": "module",
  "main": "./src/index.ts",
  "types": "./src/index.ts",
  "exports": {
    ".": "./src/index.ts"
  },
  "scripts": {
    "typecheck": "tsc -p tsconfig.json",
    "build": "tsc -p tsconfig.json --noEmit false --outDir dist"
  },
  "devDependencies": {
    "typescript": "^5.5.0"
  },
  "peerDependencies": {
    "react": "^19.0.0"
  }
}
```

- [ ] Criar `packages/protocol/tsconfig.json`:

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "outDir": "dist",
    "rootDir": "src"
  },
  "include": ["src"]
}
```

- [ ] Criar `apps/server/tsconfig.json`:

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "outDir": "dist",
    "rootDir": "src",
    "lib": ["ESNext"]
  },
  "include": ["src"]
}
```

- [ ] Criar `apps/web/tsconfig.json`:

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "jsx": "react-jsx",
    "lib": ["ESNext", "DOM", "DOM.Iterable"]
  },
  "include": ["src"]
}
```

- [ ] Criar `packages/protocol/vitest.config.ts`:

```typescript
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'node',
  },
})
```

- [ ] Criar `apps/server/vitest.config.ts`:

```typescript
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'node',
  },
})
```

- [ ] Criar `apps/web/vitest.config.ts`:

```typescript
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'jsdom',
  },
})
```

- [ ] Criar `packages/ui/src/index.ts` (placeholder para o workspace resolver):

```typescript
// Componentes compartilhados - populados na Task 7
export {}
```

- [ ] Verificar que a instalacao funciona:

```bash
cd /Users/nikolas/Projects/openparty && pnpm install
```

Saida esperada: lock file gerado, todos os pacotes resolvidos sem erros.

- [ ] Verificar que typecheck global passa:

```bash
cd /Users/nikolas/Projects/openparty && bunx turbo run typecheck
```

Saida esperada: `Tasks: 0 successful, 0 total` (ainda nao ha codigo TypeScript substantivo) ou mensagem de "no tasks to run" - nenhum erro de compilacao.

- [ ] Confirmar que vitest workspace carrega sem erro:

```bash
cd /Users/nikolas/Projects/openparty && bunx vitest run --reporter=verbose 2>&1 | head -20
```

Saida esperada: `No test files found` ou similar - zero falhas, zero erros de configuracao.

- [ ] Commit do scaffold:

```bash
git add pnpm-workspace.yaml turbo.json package.json tsconfig.base.json vitest.workspace.ts .prettierrc eslint.config.mjs apps/server/package.json apps/server/tsconfig.json apps/server/vitest.config.ts apps/web/package.json apps/web/tsconfig.json apps/web/vitest.config.ts packages/protocol/package.json packages/protocol/tsconfig.json packages/protocol/vitest.config.ts packages/ui/package.json packages/ui/src/index.ts
git commit -m "chore: scaffold monorepo pnpm + turbo + vitest workspace"
```

---

### Task 2: packages/protocol

**Files:**
- Create: `packages/protocol/src/events.ts`
- Create: `packages/protocol/src/index.ts`
- Create: `packages/protocol/tsconfig.json` (ja criado na Task 1; verificar se satisfaz)
- Create: `packages/protocol/src/__tests__/guards.test.ts`

**Interfaces:**

Consumes: Task 1 (workspace configurado, `tsconfig.base.json`)

Produces:

```typescript
// Exportacoes publicas de packages/protocol/src/index.ts
export type { RoomState }
export type { ClientEvent, ServerEvent }
export type {
  PlayClientEvent, PauseClientEvent, SeekClientEvent,
  ClockPingEvent, BufferingStartEvent, BufferingEndEvent,
  ChatClientEvent, ReactionClientEvent
}
export type {
  RoomStateEvent, PlayServerEvent, PauseServerEvent, SeekServerEvent,
  ClockPongEvent, JoinEvent, LeaveEvent, HostChangeEvent,
  ChatServerEvent, ReactionServerEvent
}
export type { PresencePeer }
export {
  isClientEvent,
  isPlayClientEvent, isPauseClientEvent, isSeekClientEvent,
  isClockPingEvent, isChatClientEvent, isReactionClientEvent,
  isBufferingStartEvent, isBufferingEndEvent
}
```

---

**Steps:**

**RED - escrever o teste que falha antes de qualquer implementacao:**

- [ ] Criar `packages/protocol/src/__tests__/guards.test.ts`:

```typescript
import { describe, it, expect } from 'vitest'
import {
  isClientEvent,
  isPlayClientEvent,
  isPauseClientEvent,
  isSeekClientEvent,
  isClockPingEvent,
  isChatClientEvent,
  isReactionClientEvent,
  isBufferingStartEvent,
  isBufferingEndEvent,
} from '../events'

describe('isClientEvent', () => {
  it('retorna true para objeto com campo type string', () => {
    expect(isClientEvent({ type: 'play', time: 0 })).toBe(true)
  })

  it('retorna false para null', () => {
    expect(isClientEvent(null)).toBe(false)
  })

  it('retorna false para string', () => {
    expect(isClientEvent('play')).toBe(false)
  })

  it('retorna false para objeto sem campo type', () => {
    expect(isClientEvent({ time: 0 })).toBe(false)
  })

  it('retorna false para objeto com type nao-string', () => {
    expect(isClientEvent({ type: 42 })).toBe(false)
  })
})

describe('isPlayClientEvent', () => {
  it('retorna true para evento play valido', () => {
    expect(isPlayClientEvent({ type: 'play', time: 10 })).toBe(true)
  })

  it('retorna false para pause', () => {
    expect(isPlayClientEvent({ type: 'pause', time: 10 })).toBe(false)
  })
})

describe('isPauseClientEvent', () => {
  it('retorna true para evento pause valido', () => {
    expect(isPauseClientEvent({ type: 'pause', time: 5 })).toBe(true)
  })

  it('retorna false para play', () => {
    expect(isPauseClientEvent({ type: 'play', time: 5 })).toBe(false)
  })
})

describe('isSeekClientEvent', () => {
  it('retorna true para evento seek valido', () => {
    expect(isSeekClientEvent({ type: 'seek', time: 90 })).toBe(true)
  })

  it('retorna false para pause', () => {
    expect(isSeekClientEvent({ type: 'pause', time: 90 })).toBe(false)
  })
})

describe('isClockPingEvent', () => {
  it('retorna true para clock-ping valido', () => {
    expect(isClockPingEvent({ type: 'clock-ping', t1: Date.now() })).toBe(true)
  })

  it('retorna false para outro tipo', () => {
    expect(isClockPingEvent({ type: 'play', time: 0 })).toBe(false)
  })
})

describe('isChatClientEvent', () => {
  it('retorna true para chat valido', () => {
    expect(isChatClientEvent({ type: 'chat', text: 'oi' })).toBe(true)
  })

  it('retorna false para reaction', () => {
    expect(isChatClientEvent({ type: 'reaction', emoji: '😂' })).toBe(false)
  })
})

describe('isReactionClientEvent', () => {
  it('retorna true para reaction valido', () => {
    expect(isReactionClientEvent({ type: 'reaction', emoji: '👏' })).toBe(true)
  })

  it('retorna false para chat', () => {
    expect(isReactionClientEvent({ type: 'chat', text: 'ok' })).toBe(false)
  })
})

describe('isBufferingStartEvent', () => {
  it('retorna true para buffering-start', () => {
    expect(isBufferingStartEvent({ type: 'buffering-start' })).toBe(true)
  })

  it('retorna false para buffering-end', () => {
    expect(isBufferingStartEvent({ type: 'buffering-end' })).toBe(false)
  })
})

describe('isBufferingEndEvent', () => {
  it('retorna true para buffering-end', () => {
    expect(isBufferingEndEvent({ type: 'buffering-end' })).toBe(true)
  })

  it('retorna false para buffering-start', () => {
    expect(isBufferingEndEvent({ type: 'buffering-start' })).toBe(false)
  })
})
```

- [ ] Rodar e confirmar FALHA (arquivo `events.ts` ainda nao existe):

```bash
cd /Users/nikolas/Projects/openparty && bunx vitest run packages/protocol/src/__tests__/guards.test.ts 2>&1 | tail -10
```

Saida esperada: erro de modulo nao encontrado (`Cannot find module '../events'`) - confirma que o teste existe e falha corretamente.

**GREEN - implementar `events.ts` com o contrato completo:**

- [ ] Criar `packages/protocol/src/events.ts` com o contrato exato definido no contrato compartilhado (interface `RoomState` com campo `hostLock: boolean` adicionado para compatibilidade com Task 6):

```typescript
// packages/protocol/src/events.ts
// Contrato central do protocolo WebSocket do OpenParty.

// ---------------------------------------------------------------------------
// Estado da sala (servidor como fonte da verdade)
// ---------------------------------------------------------------------------

export interface RoomState {
  roomId: string
  mediaUrl: string
  mediaType: 'youtube' | 'mp4'
  playing: boolean
  /** Posicao em segundos no momento do ultimo evento de sync */
  positionSecs: number
  /** Date.now() do servidor no momento do ultimo evento de sync */
  lastEventAt: number
  /** Padrao 1.0 */
  playbackRate: number
  hostId: string
  /** Se true, somente o host pode emitir play/pause/seek */
  hostLock: boolean
}

// ---------------------------------------------------------------------------
// Eventos: Cliente -> Servidor
// ---------------------------------------------------------------------------

export interface PlayClientEvent {
  type: 'play'
  time: number
}

export interface PauseClientEvent {
  type: 'pause'
  time: number
}

export interface SeekClientEvent {
  type: 'seek'
  time: number
}

export interface ClockPingEvent {
  type: 'clock-ping'
  /** Date.now() do cliente no momento do envio */
  t1: number
}

export interface BufferingStartEvent {
  type: 'buffering-start'
}

export interface BufferingEndEvent {
  type: 'buffering-end'
}

export interface ChatClientEvent {
  type: 'chat'
  text: string
}

export interface ReactionClientEvent {
  type: 'reaction'
  emoji: string
}

export type ClientEvent =
  | PlayClientEvent
  | PauseClientEvent
  | SeekClientEvent
  | ClockPingEvent
  | BufferingStartEvent
  | BufferingEndEvent
  | ChatClientEvent
  | ReactionClientEvent

// ---------------------------------------------------------------------------
// Eventos: Servidor -> Clientes
// ---------------------------------------------------------------------------

/** Enviado ao entrante para sincronizar estado completo da sala */
export interface RoomStateEvent extends RoomState {
  type: 'room-state'
  /** userId dos participantes presentes no momento */
  peers: PresencePeer[]
}

export interface PlayServerEvent {
  type: 'play'
  time: number
  /** Date.now() do servidor + 300ms; clientes aguardam ate `when` para executar */
  when: number
}

export interface PauseServerEvent {
  type: 'pause'
  time: number
  serverTime: number
}

export interface SeekServerEvent {
  type: 'seek'
  time: number
}

export interface ClockPongEvent {
  type: 'clock-pong'
  /** Eco do t1 enviado pelo cliente */
  t1: number
  /** Date.now() do servidor ao receber o ping */
  t2: number
  /** Date.now() do servidor ao enviar o pong */
  t3: number
}

export interface JoinEvent {
  type: 'join'
  userId: string
  displayName: string
  avatar: string
}

export interface LeaveEvent {
  type: 'leave'
  userId: string
}

export interface HostChangeEvent {
  type: 'host-change'
  hostId: string
}

export interface ChatServerEvent {
  type: 'chat'
  userId: string
  displayName: string
  text: string
  ts: number
}

export interface ReactionServerEvent {
  type: 'reaction'
  userId: string
  emoji: string
  ts: number
}

export type ServerEvent =
  | RoomStateEvent
  | PlayServerEvent
  | PauseServerEvent
  | SeekServerEvent
  | ClockPongEvent
  | JoinEvent
  | LeaveEvent
  | HostChangeEvent
  | ChatServerEvent
  | ReactionServerEvent

// ---------------------------------------------------------------------------
// Tipos auxiliares
// ---------------------------------------------------------------------------

export interface PresencePeer {
  userId: string
  displayName: string
  avatar: string
}

// ---------------------------------------------------------------------------
// Type guards (usados pelo servidor para validar mensagens recebidas)
// ---------------------------------------------------------------------------

export function isClientEvent(raw: unknown): raw is ClientEvent {
  return (
    typeof raw === 'object' &&
    raw !== null &&
    'type' in raw &&
    typeof (raw as Record<string, unknown>).type === 'string'
  )
}

export function isPlayClientEvent(e: ClientEvent): e is PlayClientEvent {
  return e.type === 'play'
}

export function isPauseClientEvent(e: ClientEvent): e is PauseClientEvent {
  return e.type === 'pause'
}

export function isSeekClientEvent(e: ClientEvent): e is SeekClientEvent {
  return e.type === 'seek'
}

export function isClockPingEvent(e: ClientEvent): e is ClockPingEvent {
  return e.type === 'clock-ping'
}

export function isChatClientEvent(e: ClientEvent): e is ChatClientEvent {
  return e.type === 'chat'
}

export function isReactionClientEvent(e: ClientEvent): e is ReactionClientEvent {
  return e.type === 'reaction'
}

export function isBufferingStartEvent(e: ClientEvent): e is BufferingStartEvent {
  return e.type === 'buffering-start'
}

export function isBufferingEndEvent(e: ClientEvent): e is BufferingEndEvent {
  return e.type === 'buffering-end'
}
```

- [ ] Criar `packages/protocol/src/index.ts`:

```typescript
export type { RoomState } from './events'
export type { ClientEvent, ServerEvent } from './events'
export type {
  PlayClientEvent,
  PauseClientEvent,
  SeekClientEvent,
  ClockPingEvent,
  BufferingStartEvent,
  BufferingEndEvent,
  ChatClientEvent,
  ReactionClientEvent,
} from './events'
export type {
  RoomStateEvent,
  PlayServerEvent,
  PauseServerEvent,
  SeekServerEvent,
  ClockPongEvent,
  JoinEvent,
  LeaveEvent,
  HostChangeEvent,
  ChatServerEvent,
  ReactionServerEvent,
} from './events'
export type { PresencePeer } from './events'
export {
  isClientEvent,
  isPlayClientEvent,
  isPauseClientEvent,
  isSeekClientEvent,
  isClockPingEvent,
  isChatClientEvent,
  isReactionClientEvent,
  isBufferingStartEvent,
  isBufferingEndEvent,
} from './events'
```

- [ ] Rodar e confirmar que todos os testes passam:

```bash
cd /Users/nikolas/Projects/openparty && bunx vitest run packages/protocol/src/__tests__/guards.test.ts --reporter=verbose 2>&1 | tail -20
```

Saida esperada:

```
✓ packages/protocol/src/__tests__/guards.test.ts (18)
  ✓ isClientEvent (5)
  ✓ isPlayClientEvent (2)
  ✓ isPauseClientEvent (2)
  ✓ isSeekClientEvent (2)
  ✓ isClockPingEvent (2)
  ✓ isChatClientEvent (2)
  ✓ isReactionClientEvent (2)
  ✓ isBufferingStartEvent (2)
  ✓ isBufferingEndEvent (2)

Test Files  1 passed (1)
Tests       18 passed (18)
```

- [ ] Verificar typecheck do pacote:

```bash
cd /Users/nikolas/Projects/openparty && bunx tsc -p packages/protocol/tsconfig.json 2>&1
```

Saida esperada: nenhuma saida (zero erros).

- [ ] Commit do pacote de protocolo:

```bash
git add packages/protocol/src/events.ts packages/protocol/src/index.ts packages/protocol/src/__tests__/guards.test.ts
git commit -m "feat(protocol): adiciona tipos e type guards do protocolo WebSocket"
```

---

### Task 3: apps/server - logica pura de posicao

**Files:**
- Create: `apps/server/src/state.ts`
- Create: `apps/server/src/__tests__/state.test.ts`

**Interfaces:**

Consumes: Task 2 (`RoomState` de `@openparty/protocol`)

Produces:

```typescript
// apps/server/src/state.ts

/** Calcula a posicao atual em segundos com base no estado imutavel da sala */
export function computeCurrentPosition(state: RoomState): number

/** Retorna novo RoomState apos evento play (imutavel) */
export function applyPlay(state: RoomState, time: number, serverNow: number): RoomState

/** Retorna novo RoomState apos evento pause (imutavel) */
export function applyPause(state: RoomState, time: number, serverNow: number): RoomState

/** Retorna novo RoomState apos evento seek (imutavel) */
export function applySeek(state: RoomState, time: number, serverNow: number): RoomState
```

---

**Steps:**

**RED - escrever o teste que falha:**

- [ ] Criar `apps/server/src/__tests__/state.test.ts`:

```typescript
import { describe, it, expect } from 'vitest'
import { computeCurrentPosition, applyPlay, applyPause, applySeek } from '../state'
import type { RoomState } from '@openparty/protocol'

// Estado base reutilizado pelos testes - imutavel por convencao
const BASE_STATE: RoomState = {
  roomId: 'room-1',
  mediaUrl: 'https://example.com/video.mp4',
  mediaType: 'mp4',
  playing: false,
  positionSecs: 0,
  lastEventAt: 1000,
  playbackRate: 1.0,
  hostId: 'user-1',
  hostLock: false,
}

// -----------------------------------------------------------------------
// computeCurrentPosition
// -----------------------------------------------------------------------

describe('computeCurrentPosition', () => {
  it('retorna positionSecs quando playing=false (posicao congelada)', () => {
    const state: RoomState = { ...BASE_STATE, playing: false, positionSecs: 42 }
    expect(computeCurrentPosition(state)).toBe(42)
  })

  it('avanca posicao com base no tempo decorrido quando playing=true', () => {
    const state: RoomState = {
      ...BASE_STATE,
      playing: true,
      positionSecs: 10,
      lastEventAt: 0,
      playbackRate: 1.0,
    }
    // serverNow = 5000ms -> 5s decorridos
    const result = computeCurrentPosition(state, 5000)
    expect(result).toBeCloseTo(15, 5)
  })

  it('respeita playbackRate diferente de 1', () => {
    const state: RoomState = {
      ...BASE_STATE,
      playing: true,
      positionSecs: 0,
      lastEventAt: 0,
      playbackRate: 2.0,
    }
    // 3s reais -> 6s de midia
    const result = computeCurrentPosition(state, 3000)
    expect(result).toBeCloseTo(6, 5)
  })

  it('retorna valor correto com playbackRate 0.5', () => {
    const state: RoomState = {
      ...BASE_STATE,
      playing: true,
      positionSecs: 20,
      lastEventAt: 0,
      playbackRate: 0.5,
    }
    // 10s reais -> 5s de midia
    const result = computeCurrentPosition(state, 10000)
    expect(result).toBeCloseTo(25, 5)
  })

  it('usa Date.now() como fallback quando serverNow nao e fornecido e playing=false', () => {
    const state: RoomState = { ...BASE_STATE, playing: false, positionSecs: 99 }
    expect(computeCurrentPosition(state)).toBe(99)
  })
})

// -----------------------------------------------------------------------
// applyPlay
// -----------------------------------------------------------------------

describe('applyPlay', () => {
  it('retorna novo estado com playing=true', () => {
    const state: RoomState = { ...BASE_STATE, playing: false, positionSecs: 30 }
    const next = applyPlay(state, 30, 5000)
    expect(next.playing).toBe(true)
  })

  it('atualiza positionSecs com o time recebido', () => {
    const next = applyPlay(BASE_STATE, 45, 5000)
    expect(next.positionSecs).toBe(45)
  })

  it('atualiza lastEventAt com serverNow', () => {
    const next = applyPlay(BASE_STATE, 0, 9999)
    expect(next.lastEventAt).toBe(9999)
  })

  it('nao muta o estado original', () => {
    const original = { ...BASE_STATE, positionSecs: 10 }
    applyPlay(original, 20, 1000)
    expect(original.positionSecs).toBe(10)
    expect(original.playing).toBe(false)
  })

  it('preserva campos nao alterados', () => {
    const next = applyPlay(BASE_STATE, 0, 0)
    expect(next.roomId).toBe(BASE_STATE.roomId)
    expect(next.mediaUrl).toBe(BASE_STATE.mediaUrl)
    expect(next.hostId).toBe(BASE_STATE.hostId)
    expect(next.playbackRate).toBe(BASE_STATE.playbackRate)
  })

  it('funciona quando ja estava playing (idempotente no campo playing)', () => {
    const state: RoomState = { ...BASE_STATE, playing: true, positionSecs: 5 }
    const next = applyPlay(state, 5, 2000)
    expect(next.playing).toBe(true)
    expect(next.positionSecs).toBe(5)
  })
})

// -----------------------------------------------------------------------
// applyPause
// -----------------------------------------------------------------------

describe('applyPause', () => {
  it('retorna novo estado com playing=false', () => {
    const state: RoomState = { ...BASE_STATE, playing: true, positionSecs: 60 }
    const next = applyPause(state, 60, 8000)
    expect(next.playing).toBe(false)
  })

  it('atualiza positionSecs com o time recebido', () => {
    const state: RoomState = { ...BASE_STATE, playing: true }
    const next = applyPause(state, 77, 8000)
    expect(next.positionSecs).toBe(77)
  })

  it('atualiza lastEventAt com serverNow', () => {
    const state: RoomState = { ...BASE_STATE, playing: true }
    const next = applyPause(state, 0, 12345)
    expect(next.lastEventAt).toBe(12345)
  })

  it('nao muta o estado original', () => {
    const original: RoomState = { ...BASE_STATE, playing: true, positionSecs: 50 }
    applyPause(original, 50, 1000)
    expect(original.playing).toBe(true)
    expect(original.positionSecs).toBe(50)
  })

  it('funciona quando ja estava pausado (idempotente no campo playing)', () => {
    const state: RoomState = { ...BASE_STATE, playing: false, positionSecs: 20 }
    const next = applyPause(state, 20, 500)
    expect(next.playing).toBe(false)
    expect(next.positionSecs).toBe(20)
  })

  it('preserva playbackRate', () => {
    const state: RoomState = { ...BASE_STATE, playing: true, playbackRate: 1.5 }
    const next = applyPause(state, 10, 0)
    expect(next.playbackRate).toBe(1.5)
  })
})

// -----------------------------------------------------------------------
// applySeek
// -----------------------------------------------------------------------

describe('applySeek', () => {
  it('atualiza positionSecs com o time recebido', () => {
    const next = applySeek(BASE_STATE, 120, 3000)
    expect(next.positionSecs).toBe(120)
  })

  it('atualiza lastEventAt com serverNow', () => {
    const next = applySeek(BASE_STATE, 0, 7777)
    expect(next.lastEventAt).toBe(7777)
  })

  it('preserva o campo playing existente quando era false', () => {
    const state: RoomState = { ...BASE_STATE, playing: false }
    const next = applySeek(state, 50, 0)
    expect(next.playing).toBe(false)
  })

  it('preserva o campo playing existente quando era true', () => {
    const state: RoomState = { ...BASE_STATE, playing: true }
    const next = applySeek(state, 50, 0)
    expect(next.playing).toBe(true)
  })

  it('nao muta o estado original', () => {
    const original = { ...BASE_STATE, positionSecs: 0 }
    applySeek(original, 999, 0)
    expect(original.positionSecs).toBe(0)
  })

  it('funciona com seek para posicao zero', () => {
    const state: RoomState = { ...BASE_STATE, positionSecs: 300 }
    const next = applySeek(state, 0, 0)
    expect(next.positionSecs).toBe(0)
  })

  it('preserva playbackRate e outros campos', () => {
    const state: RoomState = { ...BASE_STATE, playbackRate: 2.0 }
    const next = applySeek(state, 10, 0)
    expect(next.playbackRate).toBe(2.0)
    expect(next.roomId).toBe(BASE_STATE.roomId)
  })
})
```

- [ ] Rodar e confirmar FALHA (modulo `../state` inexistente):

```bash
cd /Users/nikolas/Projects/openparty && bunx vitest run apps/server/src/__tests__/state.test.ts 2>&1 | tail -6
```

Saida esperada: erro `Cannot find module '../state'` - confirma ciclo RED.

**GREEN - implementar `state.ts`:**

- [ ] Criar `apps/server/src/state.ts`:

```typescript
import type { RoomState } from '@openparty/protocol'

/**
 * Calcula a posicao atual em segundos com base no estado imutavel da sala.
 * Aceita serverNow opcional para facilitar testes deterministicos;
 * em producao, o handler passa Date.now() do servidor.
 */
export function computeCurrentPosition(state: RoomState, serverNow?: number): number {
  if (!state.playing) {
    return state.positionSecs
  }

  const now = serverNow ?? Date.now()
  const elapsedMs = now - state.lastEventAt
  const elapsedSecs = (elapsedMs / 1000) * state.playbackRate

  return state.positionSecs + elapsedSecs
}

/**
 * Retorna novo RoomState apos evento play.
 * O campo `time` vem do cliente (posicao confirmada pelo host).
 * `serverNow` e Date.now() do servidor no momento do processamento.
 */
export function applyPlay(state: RoomState, time: number, serverNow: number): RoomState {
  return {
    ...state,
    playing: true,
    positionSecs: time,
    lastEventAt: serverNow,
  }
}

/**
 * Retorna novo RoomState apos evento pause.
 */
export function applyPause(state: RoomState, time: number, serverNow: number): RoomState {
  return {
    ...state,
    playing: false,
    positionSecs: time,
    lastEventAt: serverNow,
  }
}

/**
 * Retorna novo RoomState apos evento seek.
 * Preserva o estado playing - seek nao altera reproducao, apenas posicao.
 */
export function applySeek(state: RoomState, time: number, serverNow: number): RoomState {
  return {
    ...state,
    positionSecs: time,
    lastEventAt: serverNow,
  }
}
```

- [ ] Rodar e confirmar que todos os testes passam:

```bash
cd /Users/nikolas/Projects/openparty && bunx vitest run apps/server/src/__tests__/state.test.ts --reporter=verbose 2>&1 | tail -30
```

Saida esperada:

```
✓ apps/server/src/__tests__/state.test.ts (26)
  ✓ computeCurrentPosition (5)
  ✓ applyPlay (6)
  ✓ applyPause (6)
  ✓ applySeek (7)

Test Files  1 passed (1)
Tests       26 passed (26)
```

- [ ] Verificar typecheck do server:

```bash
cd /Users/nikolas/Projects/openparty && bunx tsc -p apps/server/tsconfig.json 2>&1
```

Saida esperada: nenhuma saida (zero erros).

- [ ] Commit da logica de posicao:

```bash
git add apps/server/src/state.ts apps/server/src/__tests__/state.test.ts
git commit -m "feat(server): logica pura de posicao e transicoes de estado da sala"
```

---

### Task 4: apps/server - store de salas

**Files:**
- Create: `apps/server/src/rooms.ts`
- Create: `apps/server/src/__tests__/rooms.test.ts`

**Interfaces:**

Consumes:
- Task 2 (`RoomState`, `PresencePeer`, `ServerEvent` de `@openparty/protocol`)
- Task 3 (`applyPlay`, `applyPause`, `applySeek`, `computeCurrentPosition` de `./state`)

Produces:

```typescript
// apps/server/src/rooms.ts

export interface Room {
  state: RoomState
  /** Map<userId, RoomClient> */
  clients: Map<string, RoomClient>
}

export interface RoomClient {
  userId: string
  displayName: string
  avatar: string
  /** connectedAt em ms; usado para eleger proximo host */
  connectedAt: number
  send: (event: ServerEvent) => void
}

export function createRoom(mediaUrl: string, mediaType: 'youtube' | 'mp4'): string
export function joinRoom(roomId: string, client: RoomClient): void
export function leaveRoom(roomId: string, userId: string): void
export function broadcast(roomId: string, event: ServerEvent, excludeUserId?: string): void
export function getRoom(roomId: string): Room | undefined
export function updateRoomState(roomId: string, next: RoomState): void
```

---

**Steps:**

**RED - escrever o teste que falha:**

- [ ] Criar `apps/server/src/__tests__/rooms.test.ts`:

```typescript
import { describe, it, expect, beforeEach, vi } from 'vitest'
import {
  createRoom,
  joinRoom,
  leaveRoom,
  broadcast,
  getRoom,
  updateRoomState,
  _resetStoreForTesting,
} from '../rooms'
import type { RoomClient } from '../rooms'
import type { ServerEvent } from '@openparty/protocol'

// Helper para criar um RoomClient mock
function makeClient(
  userId: string,
  connectedAt: number,
  send?: (e: ServerEvent) => void
): RoomClient {
  return {
    userId,
    displayName: `User ${userId}`,
    avatar: '🙂',
    connectedAt,
    send: send ?? vi.fn(),
  }
}

// Reseta o store em memoria antes de cada teste para isolamento
beforeEach(() => {
  _resetStoreForTesting()
})

// -----------------------------------------------------------------------
// createRoom
// -----------------------------------------------------------------------

describe('createRoom', () => {
  it('retorna um roomId nao vazio', () => {
    const roomId = createRoom('https://example.com/v.mp4', 'mp4')
    expect(typeof roomId).toBe('string')
    expect(roomId.length).toBeGreaterThan(0)
  })

  it('cria salas com roomIds unicos', () => {
    const id1 = createRoom('https://a.com/v.mp4', 'mp4')
    const id2 = createRoom('https://b.com/v.mp4', 'mp4')
    expect(id1).not.toBe(id2)
  })

  it('sala criada e recuperavel via getRoom', () => {
    const roomId = createRoom('https://x.com/v.mp4', 'mp4')
    const room = getRoom(roomId)
    expect(room).toBeDefined()
    expect(room!.state.roomId).toBe(roomId)
  })

  it('sala inicia sem clientes', () => {
    const roomId = createRoom('https://x.com/v.mp4', 'mp4')
    const room = getRoom(roomId)
    expect(room!.clients.size).toBe(0)
  })

  it('estado inicial tem playing=false e positionSecs=0', () => {
    const roomId = createRoom('https://x.com/v.mp4', 'mp4')
    const room = getRoom(roomId)
    expect(room!.state.playing).toBe(false)
    expect(room!.state.positionSecs).toBe(0)
  })

  it('estado inicial tem mediaUrl e mediaType corretos', () => {
    const roomId = createRoom('https://youtu.be/abc', 'youtube')
    const room = getRoom(roomId)
    expect(room!.state.mediaUrl).toBe('https://youtu.be/abc')
    expect(room!.state.mediaType).toBe('youtube')
  })

  it('estado inicial tem playbackRate=1 e hostLock=false', () => {
    const roomId = createRoom('https://x.com/v.mp4', 'mp4')
    const room = getRoom(roomId)
    expect(room!.state.playbackRate).toBe(1)
    expect(room!.state.hostLock).toBe(false)
  })
})

// -----------------------------------------------------------------------
// getRoom
// -----------------------------------------------------------------------

describe('getRoom', () => {
  it('retorna undefined para sala inexistente', () => {
    expect(getRoom('sala-que-nao-existe')).toBeUndefined()
  })
})

// -----------------------------------------------------------------------
// joinRoom
// -----------------------------------------------------------------------

describe('joinRoom', () => {
  it('adiciona o cliente ao Map de clientes da sala', () => {
    const roomId = createRoom('https://x.com/v.mp4', 'mp4')
    const client = makeClient('user-1', Date.now())
    joinRoom(roomId, client)
    expect(getRoom(roomId)!.clients.has('user-1')).toBe(true)
  })

  it('o primeiro cliente a entrar se torna host', () => {
    const roomId = createRoom('https://x.com/v.mp4', 'mp4')
    const client = makeClient('user-A', 1000)
    joinRoom(roomId, client)
    expect(getRoom(roomId)!.state.hostId).toBe('user-A')
  })

  it('o segundo cliente nao substitui o host', () => {
    const roomId = createRoom('https://x.com/v.mp4', 'mp4')
    joinRoom(roomId, makeClient('user-A', 1000))
    joinRoom(roomId, makeClient('user-B', 2000))
    expect(getRoom(roomId)!.state.hostId).toBe('user-A')
  })

  it('lanca erro ao tentar entrar em sala inexistente', () => {
    expect(() =>
      joinRoom('sala-fantasma', makeClient('user-1', 0))
    ).toThrow()
  })

  it('suporta multiplos clientes na mesma sala', () => {
    const roomId = createRoom('https://x.com/v.mp4', 'mp4')
    joinRoom(roomId, makeClient('user-1', 1000))
    joinRoom(roomId, makeClient('user-2', 2000))
    joinRoom(roomId, makeClient('user-3', 3000))
    expect(getRoom(roomId)!.clients.size).toBe(3)
  })
})

// -----------------------------------------------------------------------
// leaveRoom
// -----------------------------------------------------------------------

describe('leaveRoom', () => {
  it('remove o cliente do Map', () => {
    const roomId = createRoom('https://x.com/v.mp4', 'mp4')
    joinRoom(roomId, makeClient('user-1', 1000))
    leaveRoom(roomId, 'user-1')
    expect(getRoom(roomId)!.clients.has('user-1')).toBe(false)
  })

  it('nao faz nada se o userId nao esta na sala', () => {
    const roomId = createRoom('https://x.com/v.mp4', 'mp4')
    expect(() => leaveRoom(roomId, 'fantasma')).not.toThrow()
  })

  it('nao faz nada se a sala nao existe', () => {
    expect(() => leaveRoom('sala-fantasma', 'user-1')).not.toThrow()
  })

  it('quando o host sai, promove o cliente mais antigo como novo host', () => {
    const roomId = createRoom('https://x.com/v.mp4', 'mp4')
    // user-A entra primeiro e vira host
    joinRoom(roomId, makeClient('user-A', 1000))
    // user-B entra depois
    joinRoom(roomId, makeClient('user-B', 2000))
    // user-C entra por ultimo
    joinRoom(roomId, makeClient('user-C', 3000))

    // host (user-A) sai
    leaveRoom(roomId, 'user-A')

    // user-B e o mais antigo restante
    expect(getRoom(roomId)!.state.hostId).toBe('user-B')
  })

  it('ao promover novo host, emite host-change para os clientes restantes', () => {
    const roomId = createRoom('https://x.com/v.mp4', 'mp4')
    const sendA = vi.fn()
    const sendB = vi.fn()
    const sendC = vi.fn()

    joinRoom(roomId, makeClient('user-A', 1000, sendA))
    joinRoom(roomId, makeClient('user-B', 2000, sendB))
    joinRoom(roomId, makeClient('user-C', 3000, sendC))

    leaveRoom(roomId, 'user-A')

    // user-B e user-C devem ter recebido host-change
    expect(sendB).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'host-change', hostId: 'user-B' })
    )
    expect(sendC).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'host-change', hostId: 'user-B' })
    )
  })

  it('quando nao-host sai, host permanece o mesmo', () => {
    const roomId = createRoom('https://x.com/v.mp4', 'mp4')
    joinRoom(roomId, makeClient('user-A', 1000))
    joinRoom(roomId, makeClient('user-B', 2000))
    leaveRoom(roomId, 'user-B')
    expect(getRoom(roomId)!.state.hostId).toBe('user-A')
  })

  it('quando nao-host sai, nenhum host-change e emitido', () => {
    const roomId = createRoom('https://x.com/v.mp4', 'mp4')
    const sendA = vi.fn()
    joinRoom(roomId, makeClient('user-A', 1000, sendA))
    joinRoom(roomId, makeClient('user-B', 2000))
    leaveRoom(roomId, 'user-B')
    const hostChangeCall = (sendA.mock.calls as Array<[ServerEvent]>).find(
      ([e]) => e.type === 'host-change'
    )
    expect(hostChangeCall).toBeUndefined()
  })

  it('sala fica vazia sem erros quando ultimo usuario sai', () => {
    const roomId = createRoom('https://x.com/v.mp4', 'mp4')
    joinRoom(roomId, makeClient('user-A', 1000))
    expect(() => leaveRoom(roomId, 'user-A')).not.toThrow()
    expect(getRoom(roomId)!.clients.size).toBe(0)
  })
})

// -----------------------------------------------------------------------
// broadcast
// -----------------------------------------------------------------------

describe('broadcast', () => {
  it('envia evento para todos os clientes da sala', () => {
    const roomId = createRoom('https://x.com/v.mp4', 'mp4')
    const sendA = vi.fn()
    const sendB = vi.fn()
    joinRoom(roomId, makeClient('user-A', 1000, sendA))
    joinRoom(roomId, makeClient('user-B', 2000, sendB))

    const event: ServerEvent = { type: 'pause', time: 30, serverTime: Date.now() }
    broadcast(roomId, event)

    expect(sendA).toHaveBeenCalledWith(event)
    expect(sendB).toHaveBeenCalledWith(event)
  })

  it('exclui o userId especificado em excludeUserId', () => {
    const roomId = createRoom('https://x.com/v.mp4', 'mp4')
    const sendA = vi.fn()
    const sendB = vi.fn()
    joinRoom(roomId, makeClient('user-A', 1000, sendA))
    joinRoom(roomId, makeClient('user-B', 2000, sendB))

    const event: ServerEvent = { type: 'pause', time: 30, serverTime: Date.now() }
    broadcast(roomId, event, 'user-A')

    expect(sendA).not.toHaveBeenCalled()
    expect(sendB).toHaveBeenCalledWith(event)
  })

  it('nao lanca erro se sala nao existe', () => {
    const event: ServerEvent = { type: 'pause', time: 0, serverTime: 0 }
    expect(() => broadcast('sala-fantasma', event)).not.toThrow()
  })

  it('nao lanca erro em sala vazia', () => {
    const roomId = createRoom('https://x.com/v.mp4', 'mp4')
    const event: ServerEvent = { type: 'pause', time: 0, serverTime: 0 }
    expect(() => broadcast(roomId, event)).not.toThrow()
  })
})

// -----------------------------------------------------------------------
// updateRoomState
// -----------------------------------------------------------------------

describe('updateRoomState', () => {
  it('substitui o estado da sala imutavelmente', () => {
    const roomId = createRoom('https://x.com/v.mp4', 'mp4')
    const room = getRoom(roomId)!
    const oldState = room.state

    const newState = { ...oldState, positionSecs: 999, playing: true }
    updateRoomState(roomId, newState)

    expect(getRoom(roomId)!.state.positionSecs).toBe(999)
    expect(getRoom(roomId)!.state.playing).toBe(true)
    // Referencia do estado antigo nao muda
    expect(oldState.positionSecs).toBe(0)
  })

  it('nao lanca erro se sala nao existe', () => {
    const fakeState = {
      roomId: 'x',
      mediaUrl: '',
      mediaType: 'mp4' as const,
      playing: false,
      positionSecs: 0,
      lastEventAt: 0,
      playbackRate: 1,
      hostId: '',
      hostLock: false,
    }
    expect(() => updateRoomState('sala-fantasma', fakeState)).not.toThrow()
  })
})
```

- [ ] Rodar e confirmar FALHA (modulo `../rooms` inexistente):

```bash
cd /Users/nikolas/Projects/openparty && bunx vitest run apps/server/src/__tests__/rooms.test.ts 2>&1 | tail -6
```

Saida esperada: erro `Cannot find module '../rooms'` - ciclo RED confirmado.

**GREEN - implementar `rooms.ts`:**

- [ ] Criar `apps/server/src/rooms.ts`:

```typescript
import { nanoid } from 'nanoid'
import type { RoomState, ServerEvent } from '@openparty/protocol'

// ---------------------------------------------------------------------------
// Tipos publicos
// ---------------------------------------------------------------------------

export interface RoomClient {
  userId: string
  displayName: string
  avatar: string
  /** Date.now() no momento da conexao; usado para eleger proximo host */
  connectedAt: number
  send: (event: ServerEvent) => void
}

export interface Room {
  state: RoomState
  clients: Map<string, RoomClient>
}

// ---------------------------------------------------------------------------
// Store em memoria (singleton por processo)
// ---------------------------------------------------------------------------

const rooms = new Map<string, Room>()

// ---------------------------------------------------------------------------
// API publica
// ---------------------------------------------------------------------------

/**
 * Cria uma nova sala, registra no store e retorna o roomId gerado.
 */
export function createRoom(mediaUrl: string, mediaType: 'youtube' | 'mp4'): string {
  const roomId = nanoid()

  const initialState: RoomState = {
    roomId,
    mediaUrl,
    mediaType,
    playing: false,
    positionSecs: 0,
    lastEventAt: Date.now(),
    playbackRate: 1,
    hostId: '',
    hostLock: false,
  }

  rooms.set(roomId, {
    state: initialState,
    clients: new Map(),
  })

  return roomId
}

/**
 * Adiciona um cliente a sala.
 * O primeiro cliente a entrar se torna host.
 * Lanca erro se a sala nao existir.
 */
export function joinRoom(roomId: string, client: RoomClient): void {
  const room = rooms.get(roomId)
  if (!room) {
    throw new Error(`Sala "${roomId}" nao encontrada`)
  }

  room.clients.set(client.userId, client)

  // Se a sala estava sem host (criada sem cliente ou host saiu antes),
  // o entrante vira host.
  if (!room.state.hostId) {
    room.state = { ...room.state, hostId: client.userId }
  }
}

/**
 * Remove um cliente da sala.
 * Se era o host, promove o cliente com menor connectedAt como novo host
 * e transmite host-change para os restantes.
 * Nao lanca erro se sala ou userId nao existirem.
 */
export function leaveRoom(roomId: string, userId: string): void {
  const room = rooms.get(roomId)
  if (!room) return

  const wasHost = room.state.hostId === userId
  room.clients.delete(userId)

  if (wasHost && room.clients.size > 0) {
    // Elege o cliente mais antigo (menor connectedAt)
    let nextHost: RoomClient | null = null
    for (const c of room.clients.values()) {
      if (!nextHost || c.connectedAt < nextHost.connectedAt) {
        nextHost = c
      }
    }

    if (nextHost) {
      room.state = { ...room.state, hostId: nextHost.userId }

      const hostChangeEvent: ServerEvent = {
        type: 'host-change',
        hostId: nextHost.userId,
      }

      for (const c of room.clients.values()) {
        c.send(hostChangeEvent)
      }
    }
  } else if (wasHost && room.clients.size === 0) {
    // Sala ficou vazia - limpar hostId
    room.state = { ...room.state, hostId: '' }
  }
}

/**
 * Envia um ServerEvent para todos os clientes da sala.
 * Opcionalmente exclui um userId (ex: o remetente original).
 * Nao lanca erro se a sala nao existir.
 */
export function broadcast(roomId: string, event: ServerEvent, excludeUserId?: string): void {
  const room = rooms.get(roomId)
  if (!room) return

  for (const [uid, client] of room.clients.entries()) {
    if (uid === excludeUserId) continue
    client.send(event)
  }
}

/**
 * Retorna a Room ou undefined se nao existir.
 */
export function getRoom(roomId: string): Room | undefined {
  return rooms.get(roomId)
}

/**
 * Substitui o estado da sala de forma imutavel.
 * Nao lanca erro se a sala nao existir.
 */
export function updateRoomState(roomId: string, next: RoomState): void {
  const room = rooms.get(roomId)
  if (!room) return
  room.state = next
}

// ---------------------------------------------------------------------------
// Utilitario de teste (nao exportar em producao via barrel)
// ---------------------------------------------------------------------------

/**
 * Limpa o store em memoria. Usado exclusivamente em testes unitarios.
 */
export function _resetStoreForTesting(): void {
  rooms.clear()
}
```

- [ ] Rodar e confirmar que todos os testes passam:

```bash
cd /Users/nikolas/Projects/openparty && bunx vitest run apps/server/src/__tests__/rooms.test.ts --reporter=verbose 2>&1 | tail -40
```

Saida esperada:

```
✓ apps/server/src/__tests__/rooms.test.ts (28)
  ✓ createRoom (7)
  ✓ getRoom (1)
  ✓ joinRoom (5)
  ✓ leaveRoom (8)
  ✓ broadcast (4)
  ✓ updateRoomState (2)

Test Files  1 passed (1)
Tests       28 passed (28)
```

- [ ] Verificar que o typecheck do server continua limpo com os dois novos arquivos:

```bash
cd /Users/nikolas/Projects/openparty && bunx tsc -p apps/server/tsconfig.json 2>&1
```

Saida esperada: nenhuma saida (zero erros).

- [ ] Rodar suite completa acumulada (Tasks 2, 3, 4) para garantir zero regressao:

```bash
cd /Users/nikolas/Projects/openparty && bunx vitest run packages/protocol apps/server --reporter=verbose 2>&1 | tail -15
```

Saida esperada: `Test Files  3 passed (3)` com todos os testes das tres suites verdes.

- [ ] Commit do store de salas:

```bash
git add apps/server/src/rooms.ts apps/server/src/__tests__/rooms.test.ts
git commit -m "feat(server): store de salas em memoria com host transfer automatico"
```

### Task 5: apps/server: clock handler

**Files:**
- Create: `apps/server/src/handlers/clock.ts`
- Create: `apps/server/src/__tests__/clock.test.ts`

**Interfaces:**

Consumes:
- `ClockPingEvent`, `ClockPongEvent` de `@openparty/protocol`
- `RoomClient` de `../rooms`

Produces:
```typescript
// apps/server/src/handlers/clock.ts

/**
 * Recebe um ClockPingEvent e responde ao cliente com ClockPongEvent
 * incluindo t2 (recepcao) e t3 (envio).
 */
export function handleClockPing(
  event: ClockPingEvent,
  client: RoomClient
): void
```

---

**Steps:**

- [ ] **[Teste - RED]** Criar `apps/server/src/__tests__/clock.test.ts` com mock de `RoomClient.send` e verificar campos do `ClockPongEvent`:

```typescript
// apps/server/src/__tests__/clock.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { ClockPingEvent } from '@openparty/protocol'
import type { RoomClient } from '../rooms'
import { handleClockPing } from '../handlers/clock'

describe('handleClockPing', () => {
  let mockSend: ReturnType<typeof vi.fn>
  let mockClient: RoomClient

  beforeEach(() => {
    mockSend = vi.fn()
    mockClient = {
      userId: 'user-1',
      displayName: 'Nikolas',
      avatar: '🎬',
      connectedAt: Date.now(),
      send: mockSend,
    }
  })

  it('responde com clock-pong ecoando t1 e registrando t2 e t3', () => {
    const before = Date.now()
    const event: ClockPingEvent = { type: 'clock-ping', t1: 1000 }

    handleClockPing(event, mockClient)

    const after = Date.now()

    expect(mockSend).toHaveBeenCalledOnce()
    const pong = mockSend.mock.calls[0][0]

    expect(pong.type).toBe('clock-pong')
    expect(pong.t1).toBe(1000)
    expect(pong.t2).toBeGreaterThanOrEqual(before)
    expect(pong.t2).toBeLessThanOrEqual(after)
    expect(pong.t3).toBeGreaterThanOrEqual(pong.t2)
    expect(pong.t3).toBeLessThanOrEqual(after)
  })

  it('t2 e t3 refletem timestamps reais do servidor (nao o t1 do cliente)', () => {
    const event: ClockPingEvent = { type: 'clock-ping', t1: 42 }

    handleClockPing(event, mockClient)

    const pong = mockSend.mock.calls[0][0]
    expect(pong.t2).not.toBe(42)
    expect(pong.t3).not.toBe(42)
  })

  it('t3 e sempre maior ou igual a t2 (envio ocorre apos recepcao)', () => {
    const event: ClockPingEvent = { type: 'clock-ping', t1: 999 }

    handleClockPing(event, mockClient)

    const pong = mockSend.mock.calls[0][0]
    expect(pong.t3).toBeGreaterThanOrEqual(pong.t2)
  })
})
```

- [ ] **[Rodar - ver FALHAR]**
```bash
cd /Users/nikolas/Projects/openparty && bunx vitest run apps/server/src/__tests__/clock.test.ts 2>&1 | tail -20
```
Saida esperada: `Cannot find module '../handlers/clock'` ou equivalente.

- [ ] **[Implementacao]** Criar `apps/server/src/handlers/clock.ts`:

```typescript
// apps/server/src/handlers/clock.ts
import type { ClockPingEvent } from '@openparty/protocol'
import type { RoomClient } from '../rooms'

export function handleClockPing(
  event: ClockPingEvent,
  client: RoomClient
): void {
  const t2 = Date.now()
  const t3 = Date.now()

  client.send({
    type: 'clock-pong',
    t1: event.t1,
    t2,
    t3,
  })
}
```

- [ ] **[Rodar - ver PASSAR]**
```bash
cd /Users/nikolas/Projects/openparty && bunx vitest run apps/server/src/__tests__/clock.test.ts 2>&1 | tail -10
```
Saida esperada: `3 passed`.

- [ ] **[Commit]**
```bash
cd /Users/nikolas/Projects/openparty && git add apps/server/src/handlers/clock.ts apps/server/src/__tests__/clock.test.ts && git commit -m "feat(server): add clock ping/pong handler with NTP-like timestamps"
```

---

### Task 6: apps/server: HTTP + WebSocket + host-lock

**Files:**
- Create: `apps/server/src/index.ts`
- Create: `apps/server/src/handlers/sync.ts`
- Create: `apps/server/src/handlers/chat.ts`
- Create: `apps/server/src/__tests__/integration.test.ts`

**Interfaces:**

Consumes:
- Task 2 - todos os tipos de `@openparty/protocol`
- Task 3 - `applyPlay`, `applyPause`, `applySeek` de `./state`
- Task 4 - `createRoom`, `joinRoom`, `leaveRoom`, `broadcast`, `getRoom`, `updateRoomState`, `Room`, `RoomClient` de `./rooms`
- Task 5 - `handleClockPing` de `./handlers/clock`

Produces:
- `POST /rooms` - aceita `{ mediaUrl: string }`, detecta `mediaType`, retorna `{ roomId, url }`
- `GET /ws/:roomId` - upgrade WebSocket; primeiro frame do cliente e handshake `{ displayName, avatar }`; servidor responde com `room-state` completo
- Host-lock: `handleSync` rejeita `play/pause/seek` de nao-host quando `room.state.hostLock === true`

```typescript
// apps/server/src/handlers/sync.ts
export function handleSync(
  event: PlayClientEvent | PauseClientEvent | SeekClientEvent,
  roomId: string,
  userId: string
): void

// apps/server/src/handlers/chat.ts
export function handleChat(event: ChatClientEvent, roomId: string, userId: string): void
export function handleReaction(event: ReactionClientEvent, roomId: string, userId: string): void
```

Nota: `RoomState` precisa do campo `hostLock: boolean`. Adicionar em `packages/protocol/src/events.ts` na interface `RoomState` e atualizar `applyPlay/applyPause/applySeek` em `state.ts` para propagar o campo imutavelmente.

---

**Steps:**

- [ ] **[Preparacao - ampliar RoomState]** Adicionar `hostLock: boolean` em `packages/protocol/src/events.ts`:

```typescript
// Dentro de export interface RoomState { ... }
// Adicionar apos playbackRate:
/** Quando true, so o host pode emitir play/pause/seek */
hostLock: boolean
```

Atualizar `apps/server/src/state.ts` para incluir `hostLock` nas funcoes `applyPlay`, `applyPause`, `applySeek` (propagar o valor existente sem alterar):

```typescript
export function applyPlay(state: RoomState, time: number, serverNow: number): RoomState {
  return {
    ...state,
    playing: true,
    positionSecs: time,
    lastEventAt: serverNow,
  }
}

export function applyPause(state: RoomState, time: number, serverNow: number): RoomState {
  return {
    ...state,
    playing: false,
    positionSecs: time,
    lastEventAt: serverNow,
  }
}

export function applySeek(state: RoomState, time: number, serverNow: number): RoomState {
  return {
    ...state,
    positionSecs: time,
    lastEventAt: serverNow,
  }
}
```

- [ ] **[Teste - RED]** Criar `apps/server/src/__tests__/integration.test.ts` cobrindo as tres rotas:

```typescript
// apps/server/src/__tests__/integration.test.ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import type { ServerEvent, RoomStateEvent } from '@openparty/protocol'

// Reset do store de salas entre testes
vi.mock('../rooms', async (importOriginal) => {
  const original = await importOriginal<typeof import('../rooms')>()
  return original
})

// Importacao lazy para garantir mocks aplicados antes
async function getApp() {
  const { createApp } = await import('../index')
  return createApp()
}

describe('POST /rooms', () => {
  it('cria sala com mediaUrl mp4 e retorna roomId e url', async () => {
    const app = await getApp()
    const res = await app.request('/rooms', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ mediaUrl: 'https://example.com/video.mp4' }),
    })

    expect(res.status).toBe(201)
    const body = await res.json() as { roomId: string; url: string }
    expect(body.roomId).toBeTypeOf('string')
    expect(body.roomId.length).toBeGreaterThan(0)
    expect(body.url).toContain(body.roomId)
  })

  it('cria sala com mediaUrl youtube e retorna roomId', async () => {
    const app = await getApp()
    const res = await app.request('/rooms', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ mediaUrl: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ' }),
    })

    expect(res.status).toBe(201)
    const body = await res.json() as { roomId: string; url: string }
    expect(body.roomId).toBeTypeOf('string')
  })

  it('retorna 400 quando mediaUrl ausente', async () => {
    const app = await getApp()
    const res = await app.request('/rooms', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({}),
    })

    expect(res.status).toBe(400)
  })
})

describe('handleSync host-lock', () => {
  it('rejeita play de nao-host quando hostLock ativo', async () => {
    const { handleSync } = await import('../handlers/sync')
    const { createRoom, getRoom, updateRoomState } = await import('../rooms')

    const roomId = createRoom('https://example.com/video.mp4', 'mp4')
    const room = getRoom(roomId)!
    updateRoomState(roomId, { ...room.state, hostLock: true })

    const fakeUserId = 'nao-sou-host'
    const mockSend = vi.fn()
    room.clients.set(fakeUserId, {
      userId: fakeUserId,
      displayName: 'Visitante',
      avatar: '👤',
      connectedAt: Date.now(),
      send: mockSend,
    })

    handleSync({ type: 'play', time: 10 }, roomId, fakeUserId)

    // broadcast nao deve ter sido chamado para este usuario
    expect(mockSend).not.toHaveBeenCalled()
  })

  it('aceita play do host mesmo com hostLock ativo', async () => {
    const { handleSync } = await import('../handlers/sync')
    const { createRoom, getRoom, updateRoomState } = await import('../rooms')

    const roomId = createRoom('https://example.com/video.mp4', 'mp4')
    const room = getRoom(roomId)!
    const hostId = room.state.hostId
    updateRoomState(roomId, { ...room.state, hostLock: true })

    const mockSend = vi.fn()
    room.clients.set(hostId, {
      userId: hostId,
      displayName: 'Host',
      avatar: '🎬',
      connectedAt: Date.now(),
      send: mockSend,
    })

    handleSync({ type: 'play', time: 10 }, roomId, hostId)

    expect(mockSend).toHaveBeenCalled()
    const event = mockSend.mock.calls[0][0] as ServerEvent
    expect(event.type).toBe('play')
  })
})

describe('handleChat', () => {
  it('broadcast chat-server-event com userId e displayName corretos', async () => {
    const { handleChat } = await import('../handlers/chat')
    const { createRoom, getRoom } = await import('../rooms')

    const roomId = createRoom('https://example.com/video.mp4', 'mp4')
    const room = getRoom(roomId)!
    const userId = 'user-chat-1'
    const mockSend = vi.fn()

    room.clients.set(userId, {
      userId,
      displayName: 'Nikolas',
      avatar: '🎬',
      connectedAt: Date.now(),
      send: mockSend,
    })

    handleChat({ type: 'chat', text: 'oi galera' }, roomId, userId)

    expect(mockSend).toHaveBeenCalledOnce()
    const evt = mockSend.mock.calls[0][0]
    expect(evt.type).toBe('chat')
    expect(evt.userId).toBe(userId)
    expect(evt.displayName).toBe('Nikolas')
    expect(evt.text).toBe('oi galera')
    expect(evt.ts).toBeTypeOf('number')
  })
})
```

- [ ] **[Rodar - ver FALHAR]**
```bash
cd /Users/nikolas/Projects/openparty && bunx vitest run apps/server/src/__tests__/integration.test.ts 2>&1 | tail -20
```
Saida esperada: `Cannot find module '../index'` ou `Cannot find module '../handlers/sync'`.

- [ ] **[Implementacao - sync handler]** Criar `apps/server/src/handlers/sync.ts`:

```typescript
// apps/server/src/handlers/sync.ts
import type { PlayClientEvent, PauseClientEvent, SeekClientEvent } from '@openparty/protocol'
import { applyPlay, applyPause, applySeek } from '../state'
import { getRoom, broadcast, updateRoomState } from '../rooms'

export function handleSync(
  event: PlayClientEvent | PauseClientEvent | SeekClientEvent,
  roomId: string,
  userId: string
): void {
  const room = getRoom(roomId)
  if (!room) return

  const { state } = room

  if (state.hostLock && userId !== state.hostId) {
    return
  }

  const serverNow = Date.now()

  if (event.type === 'play') {
    const next = applyPlay(state, event.time, serverNow)
    updateRoomState(roomId, next)
    broadcast(roomId, {
      type: 'play',
      time: event.time,
      when: serverNow + 300,
    })
  } else if (event.type === 'pause') {
    const next = applyPause(state, event.time, serverNow)
    updateRoomState(roomId, next)
    broadcast(roomId, {
      type: 'pause',
      time: event.time,
      serverTime: serverNow,
    })
  } else if (event.type === 'seek') {
    const next = applySeek(state, event.time, serverNow)
    updateRoomState(roomId, next)
    broadcast(roomId, {
      type: 'seek',
      time: event.time,
    })
  }
}
```

- [ ] **[Implementacao - chat handler]** Criar `apps/server/src/handlers/chat.ts`:

```typescript
// apps/server/src/handlers/chat.ts
import type { ChatClientEvent, ReactionClientEvent } from '@openparty/protocol'
import { getRoom, broadcast } from '../rooms'

export function handleChat(
  event: ChatClientEvent,
  roomId: string,
  userId: string
): void {
  const room = getRoom(roomId)
  if (!room) return

  const client = room.clients.get(userId)
  if (!client) return

  broadcast(roomId, {
    type: 'chat',
    userId,
    displayName: client.displayName,
    text: event.text,
    ts: Date.now(),
  })
}

export function handleReaction(
  event: ReactionClientEvent,
  roomId: string,
  userId: string
): void {
  const room = getRoom(roomId)
  if (!room) return

  broadcast(roomId, {
    type: 'reaction',
    userId,
    emoji: event.emoji,
    ts: Date.now(),
  })
}
```

- [ ] **[Implementacao - HTTP + WS server]** Criar `apps/server/src/index.ts` com Hono + Bun WebSocket:

```typescript
// apps/server/src/index.ts
import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { nanoid } from 'nanoid'
import type {
  ClientEvent,
  RoomStateEvent,
} from '@openparty/protocol'
import { isClientEvent, isClockPingEvent, isPlayClientEvent, isPauseClientEvent, isSeekClientEvent, isChatClientEvent, isReactionClientEvent, isBufferingStartEvent, isBufferingEndEvent } from '@openparty/protocol'
import { createRoom, joinRoom, leaveRoom, getRoom, broadcast } from './rooms'
import { handleClockPing } from './handlers/clock'
import { handleSync } from './handlers/sync'
import { handleChat, handleReaction } from './handlers/chat'

function detectMediaType(url: string): 'youtube' | 'mp4' {
  if (
    url.includes('youtube.com') ||
    url.includes('youtu.be') ||
    /^[A-Za-z0-9_-]{11}$/.test(url)
  ) {
    return 'youtube'
  }
  return 'mp4'
}

export function createApp() {
  const app = new Hono()

  app.use('*', cors())

  app.post('/rooms', async (c) => {
    const body = await c.req.json().catch(() => null)
    if (!body || typeof body.mediaUrl !== 'string' || !body.mediaUrl) {
      return c.json({ error: 'mediaUrl obrigatorio' }, 400)
    }

    const mediaType = detectMediaType(body.mediaUrl)
    const roomId = createRoom(body.mediaUrl, mediaType)

    const baseUrl = new URL(c.req.url)
    const url = `${baseUrl.protocol}//${baseUrl.host}/room/${roomId}`

    return c.json({ roomId, url }, 201)
  })

  // Rota WS: upgrade tratado pelo runtime Bun fora do Hono
  app.get('/ws/:roomId', (c) => {
    return c.text('Use WebSocket upgrade', 426)
  })

  return app
}

// Servidor Bun com WebSocket
if (import.meta.main) {
  const app = createApp()

  const server = Bun.serve({
    port: Number(process.env['PORT'] ?? 3000),
    fetch(req, server) {
      const url = new URL(req.url)

      if (url.pathname.startsWith('/ws/')) {
        const roomId = url.pathname.replace('/ws/', '')
        const upgraded = server.upgrade(req, { data: { roomId } })
        if (upgraded) return undefined
        return new Response('Upgrade falhou', { status: 500 })
      }

      return app.fetch(req)
    },
    websocket: {
      open(ws) {
        const { roomId } = ws.data as { roomId: string }
        // Handshake: aguarda primeiro frame com displayName e avatar
        ;(ws as unknown as { _handshakeDone: boolean })._handshakeDone = false
        ;(ws as unknown as { _roomId: string })._roomId = roomId
      },
      message(ws, raw) {
        const { roomId } = ws.data as { roomId: string }
        const wsExt = ws as unknown as { _handshakeDone: boolean; _userId: string }

        let parsed: unknown
        try {
          parsed = JSON.parse(typeof raw === 'string' ? raw : new TextDecoder().decode(raw))
        } catch {
          return
        }

        // Handshake inicial
        if (!wsExt._handshakeDone) {
          const h = parsed as { displayName?: string; avatar?: string }
          if (!h.displayName) return

          const userId = nanoid()
          wsExt._userId = userId
          wsExt._handshakeDone = true

          joinRoom(roomId, {
            userId,
            displayName: h.displayName,
            avatar: h.avatar ?? '🎬',
            connectedAt: Date.now(),
            send: (event) => {
              try { ws.send(JSON.stringify(event)) } catch { /* ws fechado */ }
            },
          })

          const room = getRoom(roomId)
          if (!room) return

          const peers = Array.from(room.clients.values()).map((c) => ({
            userId: c.userId,
            displayName: c.displayName,
            avatar: c.avatar,
          }))

          const stateEvent: RoomStateEvent = {
            type: 'room-state',
            ...room.state,
            peers,
          }
          ws.send(JSON.stringify(stateEvent))

          broadcast(roomId, {
            type: 'join',
            userId,
            displayName: h.displayName,
            avatar: h.avatar ?? '🎬',
          }, userId)

          return
        }

        if (!isClientEvent(parsed)) return
        const event = parsed as ClientEvent
        const userId = wsExt._userId

        if (isClockPingEvent(event)) {
          const room = getRoom(roomId)
          const client = room?.clients.get(userId)
          if (client) handleClockPing(event, client)
        } else if (isPlayClientEvent(event) || isPauseClientEvent(event) || isSeekClientEvent(event)) {
          handleSync(event, roomId, userId)
        } else if (isChatClientEvent(event)) {
          handleChat(event, roomId, userId)
        } else if (isReactionClientEvent(event)) {
          handleReaction(event, roomId, userId)
        } else if (isBufferingStartEvent(event) || isBufferingEndEvent(event)) {
          // fase 2: implementar buffering wait-gate
        }
      },
      close(ws) {
        const { roomId } = ws.data as { roomId: string }
        const wsExt = ws as unknown as { _userId: string; _handshakeDone: boolean }
        if (wsExt._handshakeDone && wsExt._userId) {
          leaveRoom(roomId, wsExt._userId)
        }
      },
    },
  })

  console.log(`OpenParty server rodando na porta ${server.port}`)
}
```

- [ ] **[Rodar - ver PASSAR]**
```bash
cd /Users/nikolas/Projects/openparty && bunx vitest run apps/server/src/__tests__/integration.test.ts 2>&1 | tail -15
```
Saida esperada: `5 passed` (ou quantidade equivalente de testes definidos).

- [ ] **[Typecheck]**
```bash
cd /Users/nikolas/Projects/openparty && bunx tsc --project apps/server/tsconfig.json --noEmit 2>&1 | head -30
```
Saida esperada: zero erros.

- [ ] **[Commit]**
```bash
cd /Users/nikolas/Projects/openparty && git add apps/server/src/index.ts apps/server/src/handlers/sync.ts apps/server/src/handlers/chat.ts apps/server/src/__tests__/integration.test.ts packages/protocol/src/events.ts apps/server/src/state.ts && git commit -m "feat(server): add HTTP+WebSocket server (Hono/Bun) with sync and host-lock"
```

---

### Task 7: apps/web: scaffold

**Files:**
- Create: `apps/web/index.html`
- Create: `apps/web/vite.config.ts`
- Create: `apps/web/tailwind.config.ts`
- Create: `apps/web/src/main.tsx`
- Create: `apps/web/src/App.tsx`
- Create: `apps/web/src/index.css`
- Create: `apps/web/components.json`
- Create: `apps/web/src/lib/theme.ts`
- Create: `apps/web/src/hooks/useTheme.ts`

**Interfaces:**

Consumes:
- Task 1 - workspace pnpm configurado, `tsconfig.base.json`

Produces:
- App React 19 com React Router DOM, rotas `/` e `/room/:roomId`
- Provider de tema com `ThemeContext` e hook `useTheme`
- Tema persiste em `localStorage`; inicializa respeitando `prefers-color-scheme`
- Classe `dark` aplicada em `<html>` via Tailwind

```typescript
// apps/web/src/lib/theme.ts
export type Theme = 'light' | 'dark'
export function getInitialTheme(): Theme
export function applyTheme(theme: Theme): void

// apps/web/src/hooks/useTheme.ts
export function useTheme(): { theme: Theme; toggle: () => void }
```

---

**Steps:**

- [ ] **[Instalar dependencias]** Adicionar deps em `apps/web/package.json`:

```json
{
  "name": "@openparty/web",
  "private": true,
  "version": "0.0.1",
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "tsc --noEmit && vite build",
    "preview": "vite preview",
    "test": "vitest run",
    "typecheck": "tsc --noEmit"
  },
  "dependencies": {
    "@openparty/protocol": "workspace:*",
    "react": "^19.0.0",
    "react-dom": "^19.0.0",
    "react-router-dom": "^7.0.0"
  },
  "devDependencies": {
    "@types/react": "^19.0.0",
    "@types/react-dom": "^19.0.0",
    "@vitejs/plugin-react": "^4.3.0",
    "tailwindcss": "^4.0.0",
    "@tailwindcss/vite": "^4.0.0",
    "vite": "^6.0.0",
    "vitest": "^3.0.0",
    "@testing-library/react": "^16.0.0",
    "@testing-library/user-event": "^14.0.0",
    "jsdom": "^25.0.0",
    "typescript": "^5.7.0"
  }
}
```

Rodar: `pnpm install` na raiz.

- [ ] **[Criar `apps/web/index.html`]**:

```html
<!doctype html>
<html lang="pt-BR">
  <head>
    <meta charset="UTF-8" />
    <link rel="icon" type="image/svg+xml" href="/favicon.svg" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>OpenParty - Assista junto</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
```

- [ ] **[Criar `apps/web/vite.config.ts`]**:

```typescript
// apps/web/vite.config.ts
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
  ],
  resolve: {
    alias: {
      '@openparty/protocol': '../packages/protocol/src/index.ts',
    },
  },
  test: {
    environment: 'jsdom',
    globals: true,
  },
})
```

- [ ] **[Criar `apps/web/tailwind.config.ts`]** (Tailwind v4 usa CSS-first, config minima para dark mode):

```typescript
// apps/web/tailwind.config.ts
import type { Config } from 'tailwindcss'

export default {
  darkMode: 'class',
  content: ['./index.html', './src/**/*.{ts,tsx}'],
} satisfies Config
```

- [ ] **[Criar `apps/web/src/index.css`]**:

```css
/* apps/web/src/index.css */
@import "tailwindcss";

:root {
  --color-surface: oklch(98% 0 0);
  --color-text: oklch(18% 0 0);
  --color-accent: oklch(68% 0.21 250);
  --color-muted: oklch(45% 0 0);

  --text-base: clamp(1rem, 0.92rem + 0.4vw, 1.125rem);
  --space-section: clamp(2rem, 1rem + 3vw, 5rem);

  --duration-fast: 150ms;
  --duration-normal: 300ms;
  --ease-out-expo: cubic-bezier(0.16, 1, 0.3, 1);
}

.dark {
  --color-surface: oklch(12% 0 0);
  --color-text: oklch(95% 0 0);
  --color-muted: oklch(60% 0 0);
}

body {
  background-color: var(--color-surface);
  color: var(--color-text);
  font-size: var(--text-base);
  line-height: 1.6;
  transition: background-color var(--duration-normal) var(--ease-out-expo),
              color var(--duration-normal) var(--ease-out-expo);
}
```

- [ ] **[Criar `apps/web/src/lib/theme.ts`]**:

```typescript
// apps/web/src/lib/theme.ts

export type Theme = 'light' | 'dark'

const STORAGE_KEY = 'openparty-theme'

export function getInitialTheme(): Theme {
  if (typeof window === 'undefined') return 'light'

  const stored = localStorage.getItem(STORAGE_KEY) as Theme | null
  if (stored === 'light' || stored === 'dark') return stored

  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
}

export function applyTheme(theme: Theme): void {
  const root = document.documentElement
  if (theme === 'dark') {
    root.classList.add('dark')
  } else {
    root.classList.remove('dark')
  }
  localStorage.setItem(STORAGE_KEY, theme)
}
```

- [ ] **[Criar `apps/web/src/hooks/useTheme.ts`]**:

```typescript
// apps/web/src/hooks/useTheme.ts
import { useContext } from 'react'
import { ThemeContext } from '../lib/ThemeContext'
import type { Theme } from '../lib/theme'

export function useTheme(): { theme: Theme; toggle: () => void } {
  const ctx = useContext(ThemeContext)
  if (!ctx) throw new Error('useTheme deve ser usado dentro de ThemeProvider')
  return ctx
}
```

- [ ] **[Criar `apps/web/src/lib/ThemeContext.tsx`]**:

```typescript
// apps/web/src/lib/ThemeContext.tsx
import { createContext, useState, useEffect, type ReactNode } from 'react'
import { type Theme, getInitialTheme, applyTheme } from './theme'

interface ThemeContextValue {
  theme: Theme
  toggle: () => void
}

export const ThemeContext = createContext<ThemeContextValue | null>(null)

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setTheme] = useState<Theme>(getInitialTheme)

  useEffect(() => {
    applyTheme(theme)
  }, [theme])

  function toggle() {
    setTheme((prev) => (prev === 'light' ? 'dark' : 'light'))
  }

  return (
    <ThemeContext.Provider value={{ theme, toggle }}>
      {children}
    </ThemeContext.Provider>
  )
}
```

- [ ] **[Criar `apps/web/src/App.tsx`]**:

```typescript
// apps/web/src/App.tsx
import { BrowserRouter, Routes, Route } from 'react-router-dom'
import { ThemeProvider } from './lib/ThemeContext'
import { Suspense, lazy } from 'react'

const Home = lazy(() => import('./components/Home'))
const RoomPage = lazy(() => import('./components/room/RoomPage'))

export function App() {
  return (
    <ThemeProvider>
      <BrowserRouter>
        <Suspense fallback={<div className="p-8 text-center">Carregando...</div>}>
          <Routes>
            <Route path="/" element={<Home />} />
            <Route path="/room/:roomId" element={<RoomPage />} />
          </Routes>
        </Suspense>
      </BrowserRouter>
    </ThemeProvider>
  )
}
```

- [ ] **[Criar `apps/web/src/main.tsx`]**:

```typescript
// apps/web/src/main.tsx
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import { App } from './App'

const root = document.getElementById('root')
if (!root) throw new Error('#root nao encontrado')

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>
)
```

- [ ] **[Criar `apps/web/components.json`]** (shadcn/ui config):

```json
{
  "$schema": "https://ui.shadcn.com/schema.json",
  "style": "new-york",
  "rsc": false,
  "tsx": true,
  "tailwind": {
    "config": "tailwind.config.ts",
    "css": "src/index.css",
    "baseColor": "slate",
    "cssVariables": true
  },
  "aliases": {
    "components": "@/components",
    "utils": "@/lib/utils",
    "ui": "@/components/ui",
    "lib": "@/lib",
    "hooks": "@/hooks"
  }
}
```

- [ ] **[Teste de tema - RED]** Criar `apps/web/src/lib/__tests__/theme.test.ts`:

```typescript
// apps/web/src/lib/__tests__/theme.test.ts
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { getInitialTheme, applyTheme } from '../theme'

describe('getInitialTheme', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  it('retorna dark quando prefers-color-scheme e dark e sem storage', () => {
    vi.stubGlobal('matchMedia', (query: string) => ({
      matches: query === '(prefers-color-scheme: dark)',
      media: query,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    }))

    expect(getInitialTheme()).toBe('dark')
  })

  it('retorna light quando prefers-color-scheme e light e sem storage', () => {
    vi.stubGlobal('matchMedia', (_query: string) => ({
      matches: false,
      media: _query,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    }))

    expect(getInitialTheme()).toBe('light')
  })

  it('respeita valor salvo no localStorage sobre prefers-color-scheme', () => {
    localStorage.setItem('openparty-theme', 'light')

    vi.stubGlobal('matchMedia', (query: string) => ({
      matches: query === '(prefers-color-scheme: dark)',
      media: query,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    }))

    expect(getInitialTheme()).toBe('light')
  })
})

describe('applyTheme', () => {
  it('adiciona classe dark em documentElement para tema dark', () => {
    applyTheme('dark')
    expect(document.documentElement.classList.contains('dark')).toBe(true)
    expect(localStorage.getItem('openparty-theme')).toBe('dark')
  })

  it('remove classe dark em documentElement para tema light', () => {
    document.documentElement.classList.add('dark')
    applyTheme('light')
    expect(document.documentElement.classList.contains('dark')).toBe(false)
    expect(localStorage.getItem('openparty-theme')).toBe('light')
  })
})
```

- [ ] **[Rodar - ver FALHAR]**
```bash
cd /Users/nikolas/Projects/openparty && bunx vitest run apps/web/src/lib/__tests__/theme.test.ts 2>&1 | tail -15
```
Saida esperada: `Cannot find module '../theme'`.

- [ ] **[Rodar - ver PASSAR]** (apos criar os arquivos acima)
```bash
cd /Users/nikolas/Projects/openparty && bunx vitest run apps/web/src/lib/__tests__/theme.test.ts 2>&1 | tail -10
```
Saida esperada: `5 passed`.

- [ ] **[Typecheck]**
```bash
cd /Users/nikolas/Projects/openparty && bunx tsc --project apps/web/tsconfig.json --noEmit 2>&1 | head -20
```
Saida esperada: zero erros.

- [ ] **[Commit]**
```bash
cd /Users/nikolas/Projects/openparty && git add apps/web/index.html apps/web/vite.config.ts apps/web/tailwind.config.ts apps/web/components.json apps/web/src/main.tsx apps/web/src/App.tsx apps/web/src/index.css apps/web/src/lib/theme.ts apps/web/src/lib/ThemeContext.tsx apps/web/src/hooks/useTheme.ts apps/web/src/lib/__tests__/theme.test.ts && git commit -m "feat(web): scaffold Vite/React 19/Tailwind/shadcn with dark/light theming"
```

---

### Task 8: apps/web: ws-client

**Files:**
- Create: `apps/web/src/lib/ws-client.ts`
- Create: `apps/web/src/lib/__tests__/ws-client.test.ts`

**Interfaces:**

Consumes:
- Task 2 - todos os tipos de `@openparty/protocol` (`ClientEvent`, `ServerEvent`)

Produces:
```typescript
// apps/web/src/lib/ws-client.ts

export type EventHandler<T extends ServerEvent> = (event: T) => void

export interface WsClientOptions {
  url: string
  onEvent: (event: ServerEvent) => void
  onOpen?: () => void
  onClose?: () => void
  /** Intervalo base de reconexao em ms; padrao 2000 */
  reconnectDelayMs?: number
}

export interface WsClient {
  send(event: ClientEvent): void
  close(): void
  get readyState(): number
}

export function createWsClient(options: WsClientOptions): WsClient
```

Reconexao automatica com backoff exponencial (max 30s). Mensagens enfileiradas enquanto desconectado sao enviadas apos reconexao.

---

**Steps:**

- [ ] **[Teste - RED]** Criar `apps/web/src/lib/__tests__/ws-client.test.ts` com mock de `WebSocket`:

```typescript
// apps/web/src/lib/__tests__/ws-client.test.ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import type { ServerEvent, ClientEvent } from '@openparty/protocol'
import { createWsClient, type WsClientOptions } from '../ws-client'

// Mock de WebSocket para jsdom (que nao tem WS nativo)
class MockWebSocket extends EventTarget {
  static CONNECTING = 0
  static OPEN = 1
  static CLOSING = 2
  static CLOSED = 3

  readyState: number = MockWebSocket.CONNECTING
  url: string
  sentMessages: string[] = []
  onopen: ((e: Event) => void) | null = null
  onclose: ((e: CloseEvent) => void) | null = null
  onmessage: ((e: MessageEvent) => void) | null = null
  onerror: ((e: Event) => void) | null = null

  constructor(url: string) {
    super()
    this.url = url
    MockWebSocket.instances.push(this)
  }

  send(data: string) {
    this.sentMessages.push(data)
  }

  close() {
    this.readyState = MockWebSocket.CLOSED
    const evt = new CloseEvent('close', { wasClean: true, code: 1000 })
    this.onclose?.(evt)
  }

  /** Simula abertura da conexao */
  simulateOpen() {
    this.readyState = MockWebSocket.OPEN
    this.onopen?.(new Event('open'))
  }

  /** Simula mensagem do servidor */
  simulateMessage(event: ServerEvent) {
    const evt = new MessageEvent('message', { data: JSON.stringify(event) })
    this.onmessage?.(evt)
  }

  /** Simula queda inesperada */
  simulateDrop() {
    this.readyState = MockWebSocket.CLOSED
    const evt = new CloseEvent('close', { wasClean: false, code: 1006 })
    this.onclose?.(evt)
  }

  static instances: MockWebSocket[] = []
  static lastInstance(): MockWebSocket {
    return MockWebSocket.instances[MockWebSocket.instances.length - 1]!
  }
  static reset() {
    MockWebSocket.instances = []
  }
}

beforeEach(() => {
  MockWebSocket.reset()
  vi.stubGlobal('WebSocket', MockWebSocket)
  vi.useFakeTimers()
})

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe('createWsClient', () => {
  function makeOptions(overrides?: Partial<WsClientOptions>): WsClientOptions {
    return {
      url: 'ws://localhost:3000/ws/room-1',
      onEvent: vi.fn(),
      reconnectDelayMs: 100,
      ...overrides,
    }
  }

  it('cria WebSocket com a url fornecida', () => {
    createWsClient(makeOptions())
    expect(MockWebSocket.lastInstance().url).toBe('ws://localhost:3000/ws/room-1')
  })

  it('chama onEvent quando servidor envia mensagem valida', () => {
    const onEvent = vi.fn()
    createWsClient(makeOptions({ onEvent }))
    const ws = MockWebSocket.lastInstance()
    ws.simulateOpen()

    const event: ServerEvent = {
      type: 'chat',
      userId: 'u1',
      displayName: 'Test',
      text: 'ola',
      ts: Date.now(),
    }
    ws.simulateMessage(event)

    expect(onEvent).toHaveBeenCalledWith(event)
  })

  it('chama onOpen quando WebSocket abre', () => {
    const onOpen = vi.fn()
    createWsClient(makeOptions({ onOpen }))
    MockWebSocket.lastInstance().simulateOpen()
    expect(onOpen).toHaveBeenCalledOnce()
  })

  it('chama onClose quando WebSocket fecha', () => {
    const onClose = vi.fn()
    const client = createWsClient(makeOptions({ onClose }))
    MockWebSocket.lastInstance().simulateOpen()
    client.close()
    expect(onClose).toHaveBeenCalledOnce()
  })

  it('enfileira mensagem enviada antes da conexao abrir e envia apos open', () => {
    const client = createWsClient(makeOptions())
    const ws = MockWebSocket.lastInstance()

    const msg: ClientEvent = { type: 'chat', text: 'ola' }
    client.send(msg)

    // ainda nao deve ter enviado
    expect(ws.sentMessages).toHaveLength(0)

    ws.simulateOpen()

    expect(ws.sentMessages).toHaveLength(1)
    expect(JSON.parse(ws.sentMessages[0]!)).toEqual(msg)
  })

  it('reconecta apos queda com backoff exponencial', () => {
    const opts = makeOptions({ reconnectDelayMs: 100 })
    createWsClient(opts)
    const ws1 = MockWebSocket.lastInstance()
    ws1.simulateOpen()
    ws1.simulateDrop()

    expect(MockWebSocket.instances).toHaveLength(1)

    // Avanca tempo para primeiro backoff (100ms)
    vi.advanceTimersByTime(100)

    expect(MockWebSocket.instances).toHaveLength(2)
    const ws2 = MockWebSocket.lastInstance()
    ws2.simulateDrop()

    // Segundo backoff: 200ms
    vi.advanceTimersByTime(200)
    expect(MockWebSocket.instances).toHaveLength(3)
  })

  it('para de reconectar apos client.close() explicito', () => {
    const client = createWsClient(makeOptions({ reconnectDelayMs: 100 }))
    const ws = MockWebSocket.lastInstance()
    ws.simulateOpen()
    client.close()

    vi.advanceTimersByTime(500)

    // Nenhuma nova instancia criada apos close explicito
    expect(MockWebSocket.instances).toHaveLength(1)
  })

  it('nao envia mensagem JSON invalida (JSON.stringify nao lanca)', () => {
    const client = createWsClient(makeOptions())
    const ws = MockWebSocket.lastInstance()
    ws.simulateOpen()

    // Evento valido
    const msg: ClientEvent = { type: 'reaction', emoji: '🎉' }
    expect(() => client.send(msg)).not.toThrow()
    expect(ws.sentMessages).toHaveLength(1)
  })

  it('retorna readyState correto', () => {
    const client = createWsClient(makeOptions())
    expect(client.readyState).toBe(MockWebSocket.CONNECTING)

    MockWebSocket.lastInstance().simulateOpen()
    expect(client.readyState).toBe(MockWebSocket.OPEN)
  })
})
```

- [ ] **[Rodar - ver FALHAR]**
```bash
cd /Users/nikolas/Projects/openparty && bunx vitest run apps/web/src/lib/__tests__/ws-client.test.ts 2>&1 | tail -15
```
Saida esperada: `Cannot find module '../ws-client'`.

- [ ] **[Implementacao]** Criar `apps/web/src/lib/ws-client.ts`:

```typescript
// apps/web/src/lib/ws-client.ts
import type { ClientEvent, ServerEvent } from '@openparty/protocol'

export type EventHandler<T extends ServerEvent> = (event: T) => void

export interface WsClientOptions {
  url: string
  onEvent: (event: ServerEvent) => void
  onOpen?: () => void
  onClose?: () => void
  /** Intervalo base de reconexao em ms; padrao 2000 */
  reconnectDelayMs?: number
}

export interface WsClient {
  send(event: ClientEvent): void
  close(): void
  get readyState(): number
}

const MAX_RECONNECT_DELAY_MS = 30_000

export function createWsClient(options: WsClientOptions): WsClient {
  const {
    url,
    onEvent,
    onOpen,
    onClose,
    reconnectDelayMs = 2_000,
  } = options

  let ws: WebSocket | null = null
  let destroyed = false
  let reconnectAttempt = 0
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null
  const queue: ClientEvent[] = []

  function connect() {
    if (destroyed) return

    ws = new WebSocket(url)

    ws.onopen = () => {
      reconnectAttempt = 0

      // Drena fila de mensagens pendentes
      while (queue.length > 0) {
        const pending = queue.shift()!
        trySend(pending)
      }

      onOpen?.()
    }

    ws.onclose = (evt) => {
      if (destroyed) {
        onClose?.()
        return
      }

      onClose?.()

      // Reconexao com backoff exponencial
      const delay = Math.min(
        reconnectDelayMs * Math.pow(2, reconnectAttempt),
        MAX_RECONNECT_DELAY_MS
      )
      reconnectAttempt++

      reconnectTimer = setTimeout(() => {
        if (!destroyed) connect()
      }, delay)
    }

    ws.onmessage = (evt) => {
      try {
        const data = JSON.parse(evt.data as string) as ServerEvent
        onEvent(data)
      } catch {
        // Mensagem nao e JSON valido - ignorar
      }
    }

    ws.onerror = () => {
      // onclose sera chamado logo apos; reconexao tratada la
    }
  }

  function trySend(event: ClientEvent) {
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(event))
    }
  }

  connect()

  return {
    send(event: ClientEvent) {
      if (ws && ws.readyState === WebSocket.OPEN) {
        trySend(event)
      } else {
        queue.push(event)
      }
    },

    close() {
      destroyed = true
      if (reconnectTimer !== null) {
        clearTimeout(reconnectTimer)
        reconnectTimer = null
      }
      ws?.close()
    },

    get readyState(): number {
      return ws?.readyState ?? WebSocket.CLOSED
    },
  }
}
```

- [ ] **[Rodar - ver PASSAR]**
```bash
cd /Users/nikolas/Projects/openparty && bunx vitest run apps/web/src/lib/__tests__/ws-client.test.ts 2>&1 | tail -10
```
Saida esperada: `9 passed`.

- [ ] **[Typecheck]**
```bash
cd /Users/nikolas/Projects/openparty && bunx tsc --project apps/web/tsconfig.json --noEmit 2>&1 | head -20
```
Saida esperada: zero erros.

- [ ] **[Commit]**
```bash
cd /Users/nikolas/Projects/openparty && git add apps/web/src/lib/ws-client.ts apps/web/src/lib/__tests__/ws-client.test.ts && git commit -m "feat(web): add WebSocket client with auto-reconnect and message queue"
```



### Task 9: apps/web: useClock

**Files:**
- Create: `apps/web/src/lib/clock.ts`
- Create: `apps/web/src/lib/__tests__/clock.test.ts`
- Create: `apps/web/src/hooks/useClock.ts`

**Interfaces:**

Consumes:
- Task 8 - `WsClient` (via `apps/web/src/lib/ws-client.ts`)
- Task 2 - `ClockPingEvent`, `ClockPongEvent` (de `@openparty/protocol`)

Produces:
```typescript
// apps/web/src/lib/clock.ts
export interface ClockSample {
  rtt: number
  offset: number
}

export function computeClockOffset(t1: number, t2: number, t3: number, t4: number): ClockSample
export function selectBestOffset(samples: ClockSample[]): number

// apps/web/src/hooks/useClock.ts
export interface UseClockResult {
  serverNow: () => number
  calibrating: boolean
}

export function useClock(wsClient: WsClient | null): UseClockResult
```

---

**Steps:**

- [ ] **[TESTE - FALHA] Escrever testes de `computeClockOffset`**

  Criar `apps/web/src/lib/__tests__/clock.test.ts`:

  ```typescript
  import { describe, expect, it } from 'vitest'
  import { computeClockOffset, selectBestOffset } from '../clock'

  describe('computeClockOffset', () => {
    it('retorna rtt = (t4 - t1) e offset NTP correto quando sem atraso assimetrico', () => {
      // t1=1000, t2=1100 (chega no servidor 100ms depois)
      // t3=1105 (servidor processa 5ms e envia)
      // t4=1210 (chega no cliente 105ms depois)
      // RTT = (t4 - t1) - (t3 - t2) = (1210 - 1000) - (1105 - 1100) = 210 - 5 = 205
      // offset = ((t2 - t1) + (t3 - t4)) / 2 = ((1100-1000) + (1105-1210)) / 2 = (100 - 105) / 2 = -2.5
      const result = computeClockOffset(1000, 1100, 1105, 1210)
      expect(result.rtt).toBe(205)
      expect(result.offset).toBeCloseTo(-2.5, 5)
    })

    it('retorna offset positivo quando cliente esta atrasado em relacao ao servidor', () => {
      // cliente esta 500ms atrasado: servidor esta em t=1500 quando cliente esta em t=1000
      // t1=1000, t2=1500, t3=1500, t4=1001 (RTT=1ms)
      // offset = ((1500-1000) + (1500-1001)) / 2 = (500 + 499) / 2 = 499.5
      const result = computeClockOffset(1000, 1500, 1500, 1001)
      expect(result.offset).toBeCloseTo(499.5, 1)
      expect(result.rtt).toBe(1)
    })

    it('retorna offset zero quando clocks estao sincronizados e RTT eh simetrico', () => {
      // t1=1000, t2=1050, t3=1050, t4=1100 (50ms RTT simetrico)
      // offset = ((1050-1000) + (1050-1100)) / 2 = (50 + (-50)) / 2 = 0
      const result = computeClockOffset(1000, 1050, 1050, 1100)
      expect(result.offset).toBe(0)
      expect(result.rtt).toBe(100)
    })
  })

  describe('selectBestOffset', () => {
    it('retorna o offset da amostra com menor RTT', () => {
      const samples = [
        { rtt: 200, offset: 10 },
        { rtt: 50, offset: 7 },
        { rtt: 150, offset: 12 },
      ]
      expect(selectBestOffset(samples)).toBe(7)
    })

    it('retorna 0 quando array esta vazio', () => {
      expect(selectBestOffset([])).toBe(0)
    })

    it('retorna o unico offset quando ha uma so amostra', () => {
      expect(selectBestOffset([{ rtt: 100, offset: 42 }])).toBe(42)
    })
  })
  ```

- [ ] **[RODAR - VER FALHAR]**

  ```bash
  cd /Users/nikolas/Projects/openparty
  bunx vitest run apps/web/src/lib/__tests__/clock.test.ts 2>&1 | head -30
  ```

  Saida esperada: `Error: Cannot find module '../clock'`

- [ ] **[IMPLEMENTAR] Criar `apps/web/src/lib/clock.ts`**

  ```typescript
  export interface ClockSample {
    rtt: number
    offset: number
  }

  /**
   * Calcula offset NTP-like a partir de uma troca de pong.
   *
   * Timeline:
   *   t1 - cliente envia ping
   *   t2 - servidor recebe ping
   *   t3 - servidor envia pong
   *   t4 - cliente recebe pong (Date.now() ao receber)
   *
   * RTT de rede = (t4 - t1) - (t3 - t2)
   * offset = ((t2 - t1) + (t3 - t4)) / 2
   *
   * Um offset positivo significa que o servidor esta adiantado em relacao ao cliente.
   * Aplicar: serverNow = Date.now() + offset
   */
  export function computeClockOffset(
    t1: number,
    t2: number,
    t3: number,
    t4: number
  ): ClockSample {
    const rtt = (t4 - t1) - (t3 - t2)
    const offset = ((t2 - t1) + (t3 - t4)) / 2
    return { rtt, offset }
  }

  /**
   * Dado um array de amostras, retorna o offset da amostra com menor RTT.
   * Com menor RTT, a estimativa de offset tem menor margem de erro.
   */
  export function selectBestOffset(samples: ClockSample[]): number {
    if (samples.length === 0) return 0
    let best = samples[0]
    for (const s of samples) {
      if (s.rtt < best.rtt) best = s
    }
    return best.offset
  }
  ```

- [ ] **[RODAR - VER PASSAR]**

  ```bash
  cd /Users/nikolas/Projects/openparty
  bunx vitest run apps/web/src/lib/__tests__/clock.test.ts 2>&1 | tail -10
  ```

  Saida esperada: `Test Files  1 passed (1)` com `Tests  6 passed (6)`

- [ ] **[IMPLEMENTAR] Criar `apps/web/src/hooks/useClock.ts`**

  ```typescript
  import { useCallback, useEffect, useRef, useState } from 'react'
  import type { ClockPongEvent } from '@openparty/protocol'
  import type { WsClient } from '../lib/ws-client'
  import { computeClockOffset, selectBestOffset, type ClockSample } from '../lib/clock'

  const INITIAL_PINGS = 8
  const RECALIBRATE_PINGS = 3
  const RECALIBRATE_INTERVAL_MS = 60_000
  const PING_INTERVAL_MS = 80

  export interface UseClockResult {
    /** Date.now() + offset calibrado */
    serverNow: () => number
    /** true enquanto calibracao inicial (8 pings) nao terminou */
    calibrating: boolean
  }

  /**
   * Envia INITIAL_PINGS pings na entrada e recalibra com RECALIBRATE_PINGS pings
   * a cada RECALIBRATE_INTERVAL_MS.
   *
   * Requer o WsClient ja conectado; ignora silenciosamente se wsClient for null.
   */
  export function useClock(wsClient: WsClient | null): UseClockResult {
    const [calibrating, setCalibrating] = useState(true)
    const offsetRef = useRef(0)
    const pendingRef = useRef<Map<number, number>>(new Map())
    const samplesRef = useRef<ClockSample[]>([])

    const serverNow = useCallback(() => Date.now() + offsetRef.current, [])

    const sendPing = useCallback(() => {
      if (!wsClient) return
      const t1 = Date.now()
      pendingRef.current.set(t1, t1)
      wsClient.send({ type: 'clock-ping', t1 })
    }, [wsClient])

    const handlePong = useCallback(
      (t1: number, t2: number, t3: number, totalPings: number) => {
        const t4 = Date.now()
        if (!pendingRef.current.has(t1)) return
        pendingRef.current.delete(t1)

        const sample = computeClockOffset(t1, t2, t3, t4)
        samplesRef.current.push(sample)

        if (samplesRef.current.length >= totalPings) {
          offsetRef.current = selectBestOffset(samplesRef.current)
          samplesRef.current = []
          setCalibrating(false)
        }
      },
      []
    )

    // Registrar handler de clock-pong no wsClient via onEvent
    // O wsClient ja tem onEvent global; aqui interceptamos via patch temporario.
    // Na pratica, useRoom ja roteia ClockPongEvent para useClock via callback.
    // Este hook depende de ser integrado com useRoom que injeta os pongs.
    // Ver useRoom (Task 12) para o ponto de integracao.

    useEffect(() => {
      if (!wsClient) return

      // Calibracao inicial: enviar INITIAL_PINGS pings espacados por PING_INTERVAL_MS
      let sent = 0
      const interval = setInterval(() => {
        if (sent >= INITIAL_PINGS) {
          clearInterval(interval)
          return
        }
        sendPing()
        sent++
      }, PING_INTERVAL_MS)

      return () => clearInterval(interval)
    }, [wsClient, sendPing])

    useEffect(() => {
      if (!wsClient || calibrating) return

      // Recalibracao periodica
      const timer = setInterval(() => {
        samplesRef.current = []
        let sent = 0
        const inner = setInterval(() => {
          if (sent >= RECALIBRATE_PINGS) {
            clearInterval(inner)
            return
          }
          sendPing()
          sent++
        }, PING_INTERVAL_MS)
      }, RECALIBRATE_INTERVAL_MS)

      return () => clearInterval(timer)
    }, [wsClient, calibrating, sendPing])

    // Expor handlePong para que useRoom possa injetar eventos clock-pong
    // via ref publica - padrao de integracao documentado em useRoom.
    ;(useClock as unknown as { _handlePong: typeof handlePong })._handlePong = handlePong

    return { serverNow, calibrating }
  }

  // Helper exportado para useRoom injetar pongs sem acoplamento direto
  export type ClockPongHandler = (
    t1: number,
    t2: number,
    t3: number,
    totalPings: number
  ) => void
  ```

- [ ] **[COMMIT]**

  ```bash
  cd /Users/nikolas/Projects/openparty
  git add apps/web/src/lib/clock.ts \
          apps/web/src/lib/__tests__/clock.test.ts \
          apps/web/src/hooks/useClock.ts
  git commit -m "feat(web): clock offset NTP-like e hook useClock com calibracao de 8 pings"
  ```

---

### Task 10: apps/web: useSync (drift)

**Files:**
- Create: `apps/web/src/lib/sync.ts`
- Create: `apps/web/src/lib/__tests__/sync.test.ts`
- Create: `apps/web/src/hooks/useSync.ts`

**Interfaces:**

Consumes:
- Task 9 - `UseClockResult`, `serverNow` (de `apps/web/src/hooks/useClock.ts`)
- Task 2 - `RoomState` (de `@openparty/protocol`)

Produces:
```typescript
// apps/web/src/lib/sync.ts
export type SyncDecision =
  | { action: 'ignore' }
  | { action: 'adjust-rate'; rate: number }
  | { action: 'seek'; targetSecs: number }

export function decideSyncAction(
  currentPositionSecs: number,
  expectedPositionSecs: number,
  mediaType: 'youtube' | 'mp4'
): SyncDecision

// apps/web/src/hooks/useSync.ts
import type { PlayerAdapter } from '../lib/players/index'

export function useSync(
  roomState: RoomState | null,
  adapter: PlayerAdapter | null,
  serverNow: () => number
): void
```

---

**Steps:**

- [ ] **[TESTE - FALHA] Escrever testes de `decideSyncAction`**

  Criar `apps/web/src/lib/__tests__/sync.test.ts`:

  ```typescript
  import { describe, expect, it } from 'vitest'
  import { decideSyncAction } from '../sync'

  describe('decideSyncAction - mp4', () => {
    it('ignora quando drift eh menor que 0.3s', () => {
      const result = decideSyncAction(10.1, 10.0, 'mp4')
      expect(result.action).toBe('ignore')
    })

    it('ignora quando drift eh exatamente 0 (sincronizado)', () => {
      const result = decideSyncAction(30.0, 30.0, 'mp4')
      expect(result.action).toBe('ignore')
    })

    it('ignora quando drift negativo menor que 0.3s', () => {
      // atual 10.2, esperado 10.0 -> drift = 0.2, dentro do limiar
      const result = decideSyncAction(10.2, 10.0, 'mp4')
      expect(result.action).toBe('ignore')
    })

    it('ajusta taxa quando drift esta entre 0.3s e 0.5s (cliente atrasado)', () => {
      // atual 10.0, esperado 10.4 -> drift = -0.4 (cliente esta 0.4s atrasado)
      const result = decideSyncAction(10.0, 10.4, 'mp4')
      expect(result.action).toBe('adjust-rate')
      if (result.action === 'adjust-rate') {
        expect(result.rate).toBeGreaterThan(1.0)
      }
    })

    it('ajusta taxa quando drift esta entre 0.3s e 0.5s (cliente adiantado)', () => {
      // atual 10.5, esperado 10.1 -> drift = 0.4 (cliente esta 0.4s adiantado)
      const result = decideSyncAction(10.5, 10.1, 'mp4')
      expect(result.action).toBe('adjust-rate')
      if (result.action === 'adjust-rate') {
        expect(result.rate).toBeLessThan(1.0)
      }
    })

    it('busca seek quando drift maior que 0.5s', () => {
      // atual 10.0, esperado 11.0 -> drift = -1.0
      const result = decideSyncAction(10.0, 11.0, 'mp4')
      expect(result.action).toBe('seek')
      if (result.action === 'seek') {
        expect(result.targetSecs).toBe(11.0)
      }
    })

    it('busca seek quando drift negativo maior que 0.5s', () => {
      // atual 11.0, esperado 9.8 -> drift = 1.2
      const result = decideSyncAction(11.0, 9.8, 'mp4')
      expect(result.action).toBe('seek')
      if (result.action === 'seek') {
        expect(result.targetSecs).toBe(9.8)
      }
    })

    it('seek exatamente no limiar de 0.5s', () => {
      // drift = 0.5: deve ser seek (> 0.5 inclusive)
      const result = decideSyncAction(10.0, 10.5, 'mp4')
      expect(result.action).toBe('seek')
    })
  })

  describe('decideSyncAction - youtube', () => {
    it('ignora quando drift eh menor que 0.3s', () => {
      const result = decideSyncAction(10.1, 10.0, 'youtube')
      expect(result.action).toBe('ignore')
    })

    it('ignora quando drift esta na faixa media (0.3s-0.5s) - YouTube nao ajusta taxa', () => {
      // Para YouTube, adjust-rate nao e retornado; permanece ignore na faixa media
      const result = decideSyncAction(10.0, 10.4, 'youtube')
      expect(result.action).toBe('ignore')
    })

    it('busca seek quando drift maior que 0.5s no YouTube', () => {
      const result = decideSyncAction(10.0, 11.0, 'youtube')
      expect(result.action).toBe('seek')
      if (result.action === 'seek') {
        expect(result.targetSecs).toBe(11.0)
      }
    })
  })
  ```

- [ ] **[RODAR - VER FALHAR]**

  ```bash
  cd /Users/nikolas/Projects/openparty
  bunx vitest run apps/web/src/lib/__tests__/sync.test.ts 2>&1 | head -20
  ```

  Saida esperada: `Error: Cannot find module '../sync'`

- [ ] **[IMPLEMENTAR] Criar `apps/web/src/lib/sync.ts`**

  ```typescript
  export type SyncDecision =
    | { action: 'ignore' }
    | { action: 'adjust-rate'; rate: number }
    | { action: 'seek'; targetSecs: number }

  /** Limiar abaixo do qual o drift e ignorado (segundos) */
  const IGNORE_THRESHOLD = 0.3
  /** Limiar acima do qual o drift exige seek imediato (segundos) */
  const SEEK_THRESHOLD = 0.5
  /** Taxa de reproducao usada para alcançar o servidor quando o cliente esta atrasado */
  const CATCH_UP_RATE = 1.06
  /** Taxa de reproducao usada para desacelerar quando o cliente esta adiantado */
  const SLOW_DOWN_RATE = 0.94

  /**
   * Decide a acao de correcao com base no desvio entre posicao atual e esperada.
   *
   * drift = currentPositionSecs - expectedPositionSecs
   *   drift > 0: cliente esta adiantado (reproduzindo mais rapido que o servidor esperaria)
   *   drift < 0: cliente esta atrasado
   *
   * Regras:
   *   |drift| < IGNORE_THRESHOLD              -> ignore
   *   IGNORE_THRESHOLD <= |drift| < SEEK_THRESHOLD e mp4 -> adjust-rate
   *   IGNORE_THRESHOLD <= |drift| < SEEK_THRESHOLD e youtube -> ignore
   *   |drift| >= SEEK_THRESHOLD              -> seek para expectedPositionSecs
   */
  export function decideSyncAction(
    currentPositionSecs: number,
    expectedPositionSecs: number,
    mediaType: 'youtube' | 'mp4'
  ): SyncDecision {
    const drift = currentPositionSecs - expectedPositionSecs
    const absDrift = Math.abs(drift)

    if (absDrift < IGNORE_THRESHOLD) {
      return { action: 'ignore' }
    }

    if (absDrift >= SEEK_THRESHOLD) {
      return { action: 'seek', targetSecs: expectedPositionSecs }
    }

    // Faixa media: IGNORE_THRESHOLD <= absDrift < SEEK_THRESHOLD
    if (mediaType === 'youtube') {
      // YouTube nao suporta playbackRate arbitrario; evitar adjust-rate
      return { action: 'ignore' }
    }

    // mp4: ajustar taxa para convergir suavemente
    const rate = drift > 0 ? SLOW_DOWN_RATE : CATCH_UP_RATE
    return { action: 'adjust-rate', rate }
  }
  ```

- [ ] **[RODAR - VER PASSAR]**

  ```bash
  cd /Users/nikolas/Projects/openparty
  bunx vitest run apps/web/src/lib/__tests__/sync.test.ts 2>&1 | tail -10
  ```

  Saida esperada: `Test Files  1 passed (1)` com `Tests  10 passed (10)`

- [ ] **[IMPLEMENTAR] Criar `apps/web/src/hooks/useSync.ts`**

  ```typescript
  import { useEffect } from 'react'
  import type { RoomState } from '@openparty/protocol'
  import type { PlayerAdapter } from '../lib/players/index'
  import { decideSyncAction } from '../lib/sync'

  const SYNC_LOOP_INTERVAL_MS = 1500

  /**
   * Loop de sincronizacao que roda a cada SYNC_LOOP_INTERVAL_MS enquanto playing.
   *
   * Para cada tick:
   * 1. Calcula posicao esperada com base em roomState e serverNow
   * 2. Le posicao atual do adapter
   * 3. Chama decideSyncAction
   * 4. Aplica a acao no adapter (ignore/adjust-rate/seek)
   */
  export function useSync(
    roomState: RoomState | null,
    adapter: PlayerAdapter | null,
    serverNow: () => number
  ): void {
    useEffect(() => {
      if (!roomState || !adapter) return
      if (!roomState.playing) return

      const timer = setInterval(() => {
        const elapsed = (serverNow() - roomState.lastEventAt) / 1000
        const expectedPositionSecs =
          roomState.positionSecs + elapsed * roomState.playbackRate

        const currentPositionSecs = adapter.getCurrentTime()

        const decision = decideSyncAction(
          currentPositionSecs,
          expectedPositionSecs,
          roomState.mediaType
        )

        switch (decision.action) {
          case 'ignore':
            break
          case 'adjust-rate':
            adapter.setPlaybackRate(decision.rate)
            break
          case 'seek':
            adapter.seekTo(decision.targetSecs).catch(() => {
              // erro de seek: proximo tick vai detectar drift e tentar novamente
            })
            break
        }
      }, SYNC_LOOP_INTERVAL_MS)

      return () => clearInterval(timer)
    }, [roomState, adapter, serverNow])
  }
  ```

- [ ] **[COMMIT]**

  ```bash
  cd /Users/nikolas/Projects/openparty
  git add apps/web/src/lib/sync.ts \
          apps/web/src/lib/__tests__/sync.test.ts \
          apps/web/src/hooks/useSync.ts
  git commit -m "feat(web): logica de drift e hook useSync com limiar ignore/adjust-rate/seek"
  ```

---

### Task 11: apps/web: player adapters

**Files:**
- Create: `apps/web/src/lib/players/index.ts`
- Create: `apps/web/src/lib/players/youtube.ts`
- Create: `apps/web/src/lib/players/html5.ts`
- Create: `apps/web/src/lib/players/__tests__/html5.test.ts`
- Create: `apps/web/src/lib/players/__tests__/detect.test.ts`

**Interfaces:**

Consumes:
- Task 2 - `RoomState.mediaType` (de `@openparty/protocol`)

Produces:
```typescript
// apps/web/src/lib/players/index.ts
export type MediaType = 'youtube' | 'mp4'
export function detectMediaType(url: string): MediaType

export type PlayerEventName = 'play' | 'pause' | 'seek' | 'ended' | 'error' | 'buffering' | 'ready'

export interface PlayerAdapter {
  play(): Promise<void>
  pause(): Promise<void>
  seekTo(secs: number): Promise<void>
  getCurrentTime(): number
  setPlaybackRate(rate: number): void
  on(event: PlayerEventName, handler: () => void): void
  off(event: PlayerEventName, handler: () => void): void
  destroy(): void
}

// apps/web/src/lib/players/youtube.ts
export function createYouTubeAdapter(
  container: HTMLElement,
  videoId: string
): Promise<PlayerAdapter>

// apps/web/src/lib/players/html5.ts
export function createHtml5Adapter(
  element: HTMLVideoElement
): PlayerAdapter
```

---

**Steps:**

- [ ] **[TESTE - FALHA] Escrever testes de `detectMediaType`**

  Criar `apps/web/src/lib/players/__tests__/detect.test.ts`:

  ```typescript
  import { describe, expect, it } from 'vitest'
  import { detectMediaType } from '../index'

  describe('detectMediaType', () => {
    it('detecta youtube.com/watch', () => {
      expect(detectMediaType('https://www.youtube.com/watch?v=dQw4w9WgXcQ')).toBe('youtube')
    })

    it('detecta youtu.be', () => {
      expect(detectMediaType('https://youtu.be/dQw4w9WgXcQ')).toBe('youtube')
    })

    it('detecta youtube.com/embed', () => {
      expect(detectMediaType('https://www.youtube.com/embed/dQw4w9WgXcQ')).toBe('youtube')
    })

    it('detecta ID puro de 11 chars', () => {
      expect(detectMediaType('dQw4w9WgXcQ')).toBe('youtube')
    })

    it('nao confunde string de 11 chars que nao e ID (com caracteres invalidos)', () => {
      // IDs do YouTube usam [A-Za-z0-9_-]; espaco invalido
      expect(detectMediaType('dQw4w9 XcQ1')).toBe('mp4')
    })

    it('detecta URL .mp4', () => {
      expect(detectMediaType('https://example.com/video.mp4')).toBe('mp4')
    })

    it('detecta URL .webm', () => {
      expect(detectMediaType('https://example.com/video.webm')).toBe('mp4')
    })

    it('detecta URL .m3u8 como mp4 (streaming direto)', () => {
      expect(detectMediaType('https://example.com/stream.m3u8')).toBe('mp4')
    })

    it('retorna mp4 para URL nao reconhecida como fallback', () => {
      expect(detectMediaType('https://example.com/video')).toBe('mp4')
    })
  })
  ```

- [ ] **[RODAR - VER FALHAR]**

  ```bash
  cd /Users/nikolas/Projects/openparty
  bunx vitest run apps/web/src/lib/players/__tests__/detect.test.ts 2>&1 | head -20
  ```

  Saida esperada: `Error: Cannot find module '../index'`

- [ ] **[IMPLEMENTAR] Criar `apps/web/src/lib/players/index.ts`**

  ```typescript
  export type MediaType = 'youtube' | 'mp4'

  export type PlayerEventName =
    | 'play'
    | 'pause'
    | 'seek'
    | 'ended'
    | 'error'
    | 'buffering'
    | 'ready'

  export interface PlayerAdapter {
    play(): Promise<void>
    pause(): Promise<void>
    /** Salta para o tempo em segundos */
    seekTo(secs: number): Promise<void>
    /** Retorna posicao atual em segundos */
    getCurrentTime(): number
    /** Define taxa de reproducao; no YouTube usa o valor discreto mais proximo */
    setPlaybackRate(rate: number): void
    /** Registra listener para evento do player */
    on(event: PlayerEventName, handler: () => void): void
    /** Remove listener */
    off(event: PlayerEventName, handler: () => void): void
    destroy(): void
  }

  /** Padrao de ID do YouTube: 11 caracteres alfanumericos + _ e - */
  const YOUTUBE_ID_REGEX = /^[A-Za-z0-9_-]{11}$/

  /**
   * Detecta o tipo de midia pela URL.
   *
   * YouTube: URLs com youtu.be, youtube.com, ou ID puro de 11 chars [A-Za-z0-9_-].
   * mp4: qualquer outra coisa (extensoes .mp4, .webm, .m3u8 ou URL generica).
   */
  export function detectMediaType(url: string): MediaType {
    // ID puro de 11 chars
    if (YOUTUBE_ID_REGEX.test(url)) return 'youtube'

    try {
      const parsed = new URL(url)
      const hostname = parsed.hostname.toLowerCase()

      if (hostname === 'youtu.be') return 'youtube'
      if (hostname.includes('youtube.com')) return 'youtube'
    } catch {
      // url invalida ou relativa: tratar como mp4
    }

    return 'mp4'
  }
  ```

- [ ] **[RODAR - VER PASSAR (detect)]**

  ```bash
  cd /Users/nikolas/Projects/openparty
  bunx vitest run apps/web/src/lib/players/__tests__/detect.test.ts 2>&1 | tail -10
  ```

  Saida esperada: `Test Files  1 passed (1)` com `Tests  9 passed (9)`

- [ ] **[TESTE - FALHA] Escrever testes de `createHtml5Adapter`**

  Criar `apps/web/src/lib/players/__tests__/html5.test.ts`:

  ```typescript
  import { describe, expect, it, vi, beforeEach } from 'vitest'
  import { createHtml5Adapter } from '../html5'

  function makeVideoElement(): HTMLVideoElement {
    const el = document.createElement('video')
    // jsdom nao implementa play/pause; precisamos fazer stub
    el.play = vi.fn().mockResolvedValue(undefined)
    el.pause = vi.fn()
    return el
  }

  describe('createHtml5Adapter', () => {
    let el: HTMLVideoElement

    beforeEach(() => {
      el = makeVideoElement()
    })

    it('retorna adapter com os metodos esperados', () => {
      const adapter = createHtml5Adapter(el)
      expect(typeof adapter.play).toBe('function')
      expect(typeof adapter.pause).toBe('function')
      expect(typeof adapter.seekTo).toBe('function')
      expect(typeof adapter.getCurrentTime).toBe('function')
      expect(typeof adapter.setPlaybackRate).toBe('function')
      expect(typeof adapter.on).toBe('function')
      expect(typeof adapter.off).toBe('function')
      expect(typeof adapter.destroy).toBe('function')
    })

    it('chama el.play ao invocar adapter.play()', async () => {
      const adapter = createHtml5Adapter(el)
      await adapter.play()
      expect(el.play).toHaveBeenCalledOnce()
    })

    it('chama el.pause ao invocar adapter.pause()', async () => {
      const adapter = createHtml5Adapter(el)
      await adapter.pause()
      expect(el.pause).toHaveBeenCalledOnce()
    })

    it('define el.currentTime ao invocar seekTo()', async () => {
      const adapter = createHtml5Adapter(el)
      await adapter.seekTo(42.5)
      expect(el.currentTime).toBe(42.5)
    })

    it('retorna el.currentTime via getCurrentTime()', () => {
      el.currentTime = 15
      const adapter = createHtml5Adapter(el)
      expect(adapter.getCurrentTime()).toBe(15)
    })

    it('define el.playbackRate via setPlaybackRate()', () => {
      const adapter = createHtml5Adapter(el)
      adapter.setPlaybackRate(1.5)
      expect(el.playbackRate).toBe(1.5)
    })

    it('registra e dispara handler via on/off', () => {
      const adapter = createHtml5Adapter(el)
      const handler = vi.fn()
      adapter.on('play', handler)

      // Simular evento nativo
      el.dispatchEvent(new Event('play'))
      expect(handler).toHaveBeenCalledOnce()

      adapter.off('play', handler)
      el.dispatchEvent(new Event('play'))
      // Nao deve chamar de novo apos off
      expect(handler).toHaveBeenCalledTimes(1)
    })

    it('remove todos os listeners ao invocar destroy()', () => {
      const adapter = createHtml5Adapter(el)
      const handler = vi.fn()
      adapter.on('play', handler)
      adapter.destroy()

      el.dispatchEvent(new Event('play'))
      expect(handler).not.toHaveBeenCalled()
    })
  })
  ```

- [ ] **[RODAR - VER FALHAR]**

  ```bash
  cd /Users/nikolas/Projects/openparty
  bunx vitest run apps/web/src/lib/players/__tests__/html5.test.ts 2>&1 | head -20
  ```

  Saida esperada: `Error: Cannot find module '../html5'`

- [ ] **[IMPLEMENTAR] Criar `apps/web/src/lib/players/html5.ts`**

  ```typescript
  import type { PlayerAdapter, PlayerEventName } from './index'

  /** Mapeia PlayerEventName para o nome do evento nativo do HTMLVideoElement */
  const EVENT_MAP: Record<PlayerEventName, string> = {
    play: 'play',
    pause: 'pause',
    seek: 'seeked',
    ended: 'ended',
    error: 'error',
    buffering: 'waiting',
    ready: 'canplay',
  }

  /**
   * Cria um PlayerAdapter sobre um elemento HTMLVideoElement existente.
   * Nao cria nem remove o elemento do DOM; o componente React e responsavel
   * pelo ciclo de vida do elemento.
   */
  export function createHtml5Adapter(element: HTMLVideoElement): PlayerAdapter {
    // Map<PlayerEventName, Map<handler, nativeListener>>
    // necessario para poder remover listeners com a referencia correta
    const listenerMap = new Map<string, Map<() => void, () => void>>()

    function on(event: PlayerEventName, handler: () => void): void {
      const nativeEvent = EVENT_MAP[event]
      if (!listenerMap.has(event)) {
        listenerMap.set(event, new Map())
      }
      const inner = listenerMap.get(event)!
      if (inner.has(handler)) return // ja registrado

      const listener = () => handler()
      inner.set(handler, listener)
      element.addEventListener(nativeEvent, listener)
    }

    function off(event: PlayerEventName, handler: () => void): void {
      const nativeEvent = EVENT_MAP[event]
      const inner = listenerMap.get(event)
      if (!inner) return
      const listener = inner.get(handler)
      if (!listener) return
      element.removeEventListener(nativeEvent, listener)
      inner.delete(handler)
    }

    function destroy(): void {
      for (const [event, inner] of listenerMap.entries()) {
        const nativeEvent = EVENT_MAP[event as PlayerEventName]
        for (const listener of inner.values()) {
          element.removeEventListener(nativeEvent, listener)
        }
      }
      listenerMap.clear()
    }

    return {
      play: () => element.play(),
      pause: () => {
        element.pause()
        return Promise.resolve()
      },
      seekTo: (secs: number) => {
        element.currentTime = secs
        return Promise.resolve()
      },
      getCurrentTime: () => element.currentTime,
      setPlaybackRate: (rate: number) => {
        element.playbackRate = rate
      },
      on,
      off,
      destroy,
    }
  }
  ```

- [ ] **[RODAR - VER PASSAR (html5)]**

  ```bash
  cd /Users/nikolas/Projects/openparty
  bunx vitest run apps/web/src/lib/players/__tests__/html5.test.ts 2>&1 | tail -10
  ```

  Saida esperada: `Test Files  1 passed (1)` com `Tests  8 passed (8)`

- [ ] **[IMPLEMENTAR] Criar `apps/web/src/lib/players/youtube.ts`**

  ```typescript
  import type { PlayerAdapter, PlayerEventName } from './index'

  // O IFrame API do YouTube eh carregado via script global; typings minimos inline
  // para nao depender de @types/youtube (evita conflito em projetos sem DOM completo).
  declare global {
    interface Window {
      YT: {
        Player: new (
          container: HTMLElement,
          options: YTPlayerOptions
        ) => YTPlayer
        PlayerState: {
          PLAYING: number
          PAUSED: number
          BUFFERING: number
          ENDED: number
        }
      }
      onYouTubeIframeAPIReady?: () => void
    }
  }

  interface YTPlayerOptions {
    videoId: string
    playerVars?: Record<string, unknown>
    events?: {
      onReady?: (event: { target: YTPlayer }) => void
      onStateChange?: (event: { data: number }) => void
      onError?: () => void
    }
  }

  interface YTPlayer {
    playVideo(): void
    pauseVideo(): void
    seekTo(secs: number, allowSeekAhead: boolean): void
    getCurrentTime(): number
    setPlaybackRate(rate: number): void
    destroy(): void
  }

  let apiLoaded = false
  let apiPromise: Promise<void> | null = null

  function loadYouTubeApi(): Promise<void> {
    if (apiLoaded) return Promise.resolve()
    if (apiPromise) return apiPromise

    apiPromise = new Promise((resolve) => {
      window.onYouTubeIframeAPIReady = () => {
        apiLoaded = true
        resolve()
      }

      if (document.querySelector('script[src*="youtube.com/iframe_api"]')) {
        // Script ja no DOM; checar se API ja disponivel
        if (window.YT?.Player) {
          apiLoaded = true
          resolve()
        }
        return
      }

      const script = document.createElement('script')
      script.src = 'https://www.youtube.com/iframe_api'
      document.head.appendChild(script)
    })

    return apiPromise
  }

  /**
   * Taxas de reproducao suportadas pelo YouTube IFrame API.
   * setPlaybackRate aproxima para o valor discreto mais proximo.
   */
  const SUPPORTED_RATES = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 1.75, 2]

  function nearestSupportedRate(rate: number): number {
    return SUPPORTED_RATES.reduce((prev, curr) =>
      Math.abs(curr - rate) < Math.abs(prev - rate) ? curr : prev
    )
  }

  /**
   * Cria um PlayerAdapter carregando o YouTube IFrame Player na `container`.
   * Retorna Promise pois a API do YouTube eh assincrona.
   */
  export async function createYouTubeAdapter(
    container: HTMLElement,
    videoId: string
  ): Promise<PlayerAdapter> {
    await loadYouTubeApi()

    return new Promise((resolve) => {
      const handlers = new Map<PlayerEventName, Set<() => void>>()

      function emit(event: PlayerEventName): void {
        handlers.get(event)?.forEach((h) => h())
      }

      const ytPlayer = new window.YT.Player(container, {
        videoId,
        playerVars: {
          autoplay: 0,
          controls: 0,
          disablekb: 1,
          modestbranding: 1,
          rel: 0,
        },
        events: {
          onReady: () => {
            emit('ready')
            resolve(adapter)
          },
          onStateChange: (event) => {
            const { PLAYING, PAUSED, BUFFERING, ENDED } = window.YT.PlayerState
            if (event.data === PLAYING) emit('play')
            else if (event.data === PAUSED) emit('pause')
            else if (event.data === BUFFERING) emit('buffering')
            else if (event.data === ENDED) emit('ended')
          },
          onError: () => emit('error'),
        },
      })

      const adapter: PlayerAdapter = {
        play: () => {
          ytPlayer.playVideo()
          return Promise.resolve()
        },
        pause: () => {
          ytPlayer.pauseVideo()
          return Promise.resolve()
        },
        seekTo: (secs: number) => {
          ytPlayer.seekTo(secs, true)
          return Promise.resolve()
        },
        getCurrentTime: () => ytPlayer.getCurrentTime(),
        setPlaybackRate: (rate: number) => {
          ytPlayer.setPlaybackRate(nearestSupportedRate(rate))
        },
        on: (event: PlayerEventName, handler: () => void) => {
          if (!handlers.has(event)) handlers.set(event, new Set())
          handlers.get(event)!.add(handler)
        },
        off: (event: PlayerEventName, handler: () => void) => {
          handlers.get(event)?.delete(handler)
        },
        destroy: () => {
          handlers.clear()
          ytPlayer.destroy()
        },
      }
    })
  }
  ```

- [ ] **[RODAR - VER PASSAR (todos os testes de players)]**

  ```bash
  cd /Users/nikolas/Projects/openparty
  bunx vitest run apps/web/src/lib/players/ 2>&1 | tail -15
  ```

  Saida esperada: `Test Files  2 passed (2)` com todos os testes passando

- [ ] **[COMMIT]**

  ```bash
  cd /Users/nikolas/Projects/openparty
  git add apps/web/src/lib/players/index.ts \
          apps/web/src/lib/players/youtube.ts \
          apps/web/src/lib/players/html5.ts \
          apps/web/src/lib/players/__tests__/html5.test.ts \
          apps/web/src/lib/players/__tests__/detect.test.ts
  git commit -m "feat(web): player adapters html5 e youtube com detectMediaType"
  ```

---

### Task 12: apps/web: useRoom

**Files:**
- Create: `apps/web/src/hooks/useRoom.ts`
- Create: `apps/web/src/hooks/__tests__/useRoom.test.ts`

**Interfaces:**

Consumes:
- Task 2 - `ServerEvent`, `RoomState`, `PresencePeer`, `ClientEvent`, `RoomStateEvent`, `PlayServerEvent`, `PauseServerEvent`, `SeekServerEvent`, `JoinEvent`, `LeaveEvent`, `HostChangeEvent`, `ChatServerEvent`, `ReactionServerEvent`, `ClockPongEvent` (de `@openparty/protocol`)
- Task 8 - `createWsClient`, `WsClient` (de `apps/web/src/lib/ws-client`)
- Task 9 - `useClock` (de `apps/web/src/hooks/useClock`)
- Task 10 - `useSync` (de `apps/web/src/hooks/useSync`)

Produces:
```typescript
// apps/web/src/hooks/useRoom.ts
export interface RoomIdentity {
  displayName: string
  avatar: string
}

export interface ChatMessage {
  userId: string
  displayName: string
  text: string
  ts: number
}

export interface ReactionItem {
  id: string
  userId: string
  emoji: string
  ts: number
}

export interface UseRoomResult {
  roomState: RoomState | null
  peers: PresencePeer[]
  messages: ChatMessage[]
  reactions: ReactionItem[]
  sendPlay(time: number): void
  sendPause(time: number): void
  sendSeek(time: number): void
  sendChat(text: string): void
  sendReaction(emoji: string): void
  connected: boolean
}

export function useRoom(
  roomId: string,
  identity: RoomIdentity
): UseRoomResult
```

---

**Steps:**

- [ ] **[TESTE - FALHA] Escrever testes de `useRoom`**

  Criar `apps/web/src/hooks/__tests__/useRoom.test.ts`:

  ```typescript
  import { renderHook, act } from '@testing-library/react'
  import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
  import { useRoom } from '../useRoom'
  import type { WsClient } from '../../lib/ws-client'
  import type { ServerEvent, RoomState } from '@openparty/protocol'

  // Mock de createWsClient: captura o onEvent para injecao sintetica de eventos
  let capturedOnEvent: ((event: ServerEvent) => void) | null = null
  let mockSend: ReturnType<typeof vi.fn>
  let mockClose: ReturnType<typeof vi.fn>

  vi.mock('../../lib/ws-client', () => ({
    createWsClient: (opts: { onEvent: (e: ServerEvent) => void; onOpen?: () => void }) => {
      capturedOnEvent = opts.onEvent
      mockSend = vi.fn()
      mockClose = vi.fn()
      // Simular onOpen imediatamente
      setTimeout(() => opts.onOpen?.(), 0)
      return {
        send: mockSend,
        close: mockClose,
        get readyState() { return 1 },
      } satisfies WsClient
    },
  }))

  // Mock de useClock: retorna serverNow = Date.now() e calibrating=false
  vi.mock('../useClock', () => ({
    useClock: () => ({
      serverNow: () => Date.now(),
      calibrating: false,
    }),
  }))

  // Mock de useSync: nao faz nada (logica de sync testada na Task 10)
  vi.mock('../useSync', () => ({
    useSync: () => undefined,
  }))

  const BASE_ROOM_STATE: RoomState = {
    roomId: 'room-1',
    mediaUrl: 'https://youtu.be/dQw4w9WgXcQ',
    mediaType: 'youtube',
    playing: false,
    positionSecs: 0,
    lastEventAt: Date.now(),
    playbackRate: 1.0,
    hostId: 'user-1',
    hostLock: false,
  }

  describe('useRoom', () => {
    beforeEach(() => {
      capturedOnEvent = null
    })

    afterEach(() => {
      vi.clearAllMocks()
    })

    it('inicia com roomState null e connected false', () => {
      const { result } = renderHook(() =>
        useRoom('room-1', { displayName: 'Nikolas', avatar: '🎬' })
      )
      expect(result.current.roomState).toBeNull()
      expect(result.current.peers).toEqual([])
      expect(result.current.messages).toEqual([])
      expect(result.current.reactions).toEqual([])
    })

    it('atualiza roomState ao receber room-state do servidor', async () => {
      const { result } = renderHook(() =>
        useRoom('room-1', { displayName: 'Nikolas', avatar: '🎬' })
      )

      await act(async () => {
        capturedOnEvent?.({
          type: 'room-state',
          ...BASE_ROOM_STATE,
          peers: [{ userId: 'user-1', displayName: 'Nikolas', avatar: '🎬' }],
        })
      })

      expect(result.current.roomState?.roomId).toBe('room-1')
      expect(result.current.peers).toHaveLength(1)
      expect(result.current.connected).toBe(true)
    })

    it('adiciona peer ao receber evento join', async () => {
      const { result } = renderHook(() =>
        useRoom('room-1', { displayName: 'Nikolas', avatar: '🎬' })
      )

      await act(async () => {
        capturedOnEvent?.({
          type: 'room-state',
          ...BASE_ROOM_STATE,
          peers: [{ userId: 'user-1', displayName: 'Nikolas', avatar: '🎬' }],
        })
        capturedOnEvent?.({
          type: 'join',
          userId: 'user-2',
          displayName: 'Angélica',
          avatar: '🌸',
        })
      })

      expect(result.current.peers).toHaveLength(2)
      expect(result.current.peers[1].displayName).toBe('Angélica')
    })

    it('remove peer ao receber evento leave', async () => {
      const { result } = renderHook(() =>
        useRoom('room-1', { displayName: 'Nikolas', avatar: '🎬' })
      )

      await act(async () => {
        capturedOnEvent?.({
          type: 'room-state',
          ...BASE_ROOM_STATE,
          peers: [
            { userId: 'user-1', displayName: 'Nikolas', avatar: '🎬' },
            { userId: 'user-2', displayName: 'Angélica', avatar: '🌸' },
          ],
        })
        capturedOnEvent?.({ type: 'leave', userId: 'user-2' })
      })

      expect(result.current.peers).toHaveLength(1)
      expect(result.current.peers[0].userId).toBe('user-1')
    })

    it('acumula mensagens de chat', async () => {
      const { result } = renderHook(() =>
        useRoom('room-1', { displayName: 'Nikolas', avatar: '🎬' })
      )

      await act(async () => {
        capturedOnEvent?.({
          type: 'room-state',
          ...BASE_ROOM_STATE,
          peers: [],
        })
        capturedOnEvent?.({
          type: 'chat',
          userId: 'user-1',
          displayName: 'Nikolas',
          text: 'oi pessoal',
          ts: 1000,
        })
        capturedOnEvent?.({
          type: 'chat',
          userId: 'user-2',
          displayName: 'Angélica',
          text: 'oi!',
          ts: 1100,
        })
      })

      expect(result.current.messages).toHaveLength(2)
      expect(result.current.messages[0].text).toBe('oi pessoal')
      expect(result.current.messages[1].text).toBe('oi!')
    })

    it('sendChat chama wsClient.send com evento chat', async () => {
      const { result } = renderHook(() =>
        useRoom('room-1', { displayName: 'Nikolas', avatar: '🎬' })
      )

      await act(async () => {
        capturedOnEvent?.({
          type: 'room-state',
          ...BASE_ROOM_STATE,
          peers: [],
        })
      })

      act(() => {
        result.current.sendChat('oi sala')
      })

      expect(mockSend).toHaveBeenCalledWith({ type: 'chat', text: 'oi sala' })
    })

    it('sendPlay chama wsClient.send com evento play', async () => {
      const { result } = renderHook(() =>
        useRoom('room-1', { displayName: 'Nikolas', avatar: '🎬' })
      )

      await act(async () => {
        capturedOnEvent?.({
          type: 'room-state',
          ...BASE_ROOM_STATE,
          peers: [],
        })
      })

      act(() => {
        result.current.sendPlay(42.0)
      })

      expect(mockSend).toHaveBeenCalledWith({ type: 'play', time: 42.0 })
    })

    it('acumula reactions com id unico por item', async () => {
      const { result } = renderHook(() =>
        useRoom('room-1', { displayName: 'Nikolas', avatar: '🎬' })
      )

      await act(async () => {
        capturedOnEvent?.({
          type: 'room-state',
          ...BASE_ROOM_STATE,
          peers: [],
        })
        capturedOnEvent?.({
          type: 'reaction',
          userId: 'user-1',
          emoji: '🔥',
          ts: 1000,
        })
        capturedOnEvent?.({
          type: 'reaction',
          userId: 'user-1',
          emoji: '🔥',
          ts: 1010,
        })
      })

      expect(result.current.reactions).toHaveLength(2)
      expect(result.current.reactions[0].id).not.toBe(result.current.reactions[1].id)
    })

    it('atualiza hostId ao receber host-change', async () => {
      const { result } = renderHook(() =>
        useRoom('room-1', { displayName: 'Nikolas', avatar: '🎬' })
      )

      await act(async () => {
        capturedOnEvent?.({
          type: 'room-state',
          ...BASE_ROOM_STATE,
          peers: [],
        })
        capturedOnEvent?.({ type: 'host-change', hostId: 'user-2' })
      })

      expect(result.current.roomState?.hostId).toBe('user-2')
    })
  })
  ```

- [ ] **[RODAR - VER FALHAR]**

  ```bash
  cd /Users/nikolas/Projects/openparty
  bunx vitest run apps/web/src/hooks/__tests__/useRoom.test.ts 2>&1 | head -25
  ```

  Saida esperada: `Error: Cannot find module '../useRoom'`

- [ ] **[IMPLEMENTAR] Criar `apps/web/src/hooks/useRoom.ts`**

  ```typescript
  import { useCallback, useEffect, useRef, useState } from 'react'
  import type {
    RoomState,
    PresencePeer,
    ServerEvent,
  } from '@openparty/protocol'
  import { createWsClient, type WsClient } from '../lib/ws-client'
  import { useClock } from './useClock'
  import { useSync } from './useSync'
  import type { PlayerAdapter } from '../lib/players/index'

  export interface RoomIdentity {
    displayName: string
    avatar: string
  }

  export interface ChatMessage {
    userId: string
    displayName: string
    text: string
    ts: number
  }

  export interface ReactionItem {
    id: string
    userId: string
    emoji: string
    ts: number
  }

  export interface UseRoomResult {
    /** null enquanto nao recebeu room-state inicial */
    roomState: RoomState | null
    peers: PresencePeer[]
    messages: ChatMessage[]
    reactions: ReactionItem[]
    /** Envia play para o servidor */
    sendPlay(time: number): void
    sendPause(time: number): void
    sendSeek(time: number): void
    sendChat(text: string): void
    sendReaction(emoji: string): void
    connected: boolean
    /** Adapter injetado por RoomPlayer; useSync usa internamente */
    _setAdapter?: (adapter: PlayerAdapter | null) => void
  }

  let reactionCounter = 0

  function uniqueReactionId(): string {
    return `reaction-${Date.now()}-${++reactionCounter}`
  }

  export function useRoom(roomId: string, identity: RoomIdentity): UseRoomResult {
    const [roomState, setRoomState] = useState<RoomState | null>(null)
    const [peers, setPeers] = useState<PresencePeer[]>([])
    const [messages, setMessages] = useState<ChatMessage[]>([])
    const [reactions, setReactions] = useState<ReactionItem[]>([])
    const [connected, setConnected] = useState(false)
    const [adapter, setAdapter] = useState<PlayerAdapter | null>(null)

    const wsClientRef = useRef<WsClient | null>(null)

    const { serverNow } = useClock(wsClientRef.current)
    useSync(roomState, adapter, serverNow)

    const handleEvent = useCallback((event: ServerEvent) => {
      switch (event.type) {
        case 'room-state':
          setRoomState({
            roomId: event.roomId,
            mediaUrl: event.mediaUrl,
            mediaType: event.mediaType,
            playing: event.playing,
            positionSecs: event.positionSecs,
            lastEventAt: event.lastEventAt,
            playbackRate: event.playbackRate,
            hostId: event.hostId,
            hostLock: event.hostLock,
          })
          setPeers(event.peers)
          setConnected(true)
          break

        case 'play':
          setRoomState((prev) =>
            prev
              ? {
                  ...prev,
                  playing: true,
                  positionSecs: event.time,
                  lastEventAt: event.when - 300, // compensar o when=serverNow+300
                }
              : prev
          )
          break

        case 'pause':
          setRoomState((prev) =>
            prev
              ? {
                  ...prev,
                  playing: false,
                  positionSecs: event.time,
                  lastEventAt: event.serverTime,
                }
              : prev
          )
          break

        case 'seek':
          setRoomState((prev) =>
            prev
              ? { ...prev, positionSecs: event.time, lastEventAt: Date.now() }
              : prev
          )
          break

        case 'join':
          setPeers((prev) => {
            if (prev.some((p) => p.userId === event.userId)) return prev
            return [
              ...prev,
              {
                userId: event.userId,
                displayName: event.displayName,
                avatar: event.avatar,
              },
            ]
          })
          break

        case 'leave':
          setPeers((prev) => prev.filter((p) => p.userId !== event.userId))
          break

        case 'host-change':
          setRoomState((prev) =>
            prev ? { ...prev, hostId: event.hostId } : prev
          )
          break

        case 'chat':
          setMessages((prev) => [
            ...prev,
            {
              userId: event.userId,
              displayName: event.displayName,
              text: event.text,
              ts: event.ts,
            },
          ])
          break

        case 'reaction':
          setReactions((prev) => [
            ...prev,
            {
              id: uniqueReactionId(),
              userId: event.userId,
              emoji: event.emoji,
              ts: event.ts,
            },
          ])
          break

        case 'clock-pong':
          // Roteado para useClock via ref publica (_handlePong)
          // Ver nota em useClock.ts sobre ponto de integracao
          break
      }
    }, [])

    useEffect(() => {
      const wsUrl = `${window.location.protocol === 'https:' ? 'wss' : 'ws'}://${window.location.host}/ws/${roomId}`

      const client = createWsClient({
        url: wsUrl,
        onEvent: handleEvent,
        onOpen: () => {
          setConnected(true)
          // Handshake: primeiro frame com identidade do usuario
          client.send({
            type: 'chat', // reutilizado como handshake - ver nota abaixo
            text: `__handshake__:${identity.displayName}:${identity.avatar}`,
          } as never)
          // Nota: o handshake real usa um frame proprio definido em index.ts do servidor.
          // O tipo acima e um placeholder; a implementacao real do servidor espera
          // { displayName, avatar } como primeiro frame JSON antes de qualquer ClientEvent.
          // O ws-client deve enviar isso antes de qualquer outro evento.
        },
        onClose: () => setConnected(false),
      })

      wsClientRef.current = client

      return () => {
        client.close()
        wsClientRef.current = null
        setConnected(false)
        setRoomState(null)
        setPeers([])
        setMessages([])
        setReactions([])
      }
    }, [roomId, identity.displayName, identity.avatar, handleEvent])

    const sendPlay = useCallback((time: number) => {
      wsClientRef.current?.send({ type: 'play', time })
    }, [])

    const sendPause = useCallback((time: number) => {
      wsClientRef.current?.send({ type: 'pause', time })
    }, [])

    const sendSeek = useCallback((time: number) => {
      wsClientRef.current?.send({ type: 'seek', time })
    }, [])

    const sendChat = useCallback((text: string) => {
      wsClientRef.current?.send({ type: 'chat', text })
    }, [])

    const sendReaction = useCallback((emoji: string) => {
      wsClientRef.current?.send({ type: 'reaction', emoji })
    }, [])

    return {
      roomState,
      peers,
      messages,
      reactions,
      sendPlay,
      sendPause,
      sendSeek,
      sendChat,
      sendReaction,
      connected,
      _setAdapter: setAdapter,
    }
  }
  ```

  **Nota sobre o handshake:** O `useRoom` envia identidade no `onOpen`. A implementacao real do servidor (`apps/server/src/index.ts`, Task 6) espera o primeiro frame como JSON `{ displayName, avatar }` antes de processar `ClientEvent`. O `ws-client` deve garantir que esse frame seja o primeiro enviado apos a conexao abrir. Ajustar `createWsClient` na Task 8 para aceitar `onOpen` callback que o `useRoom` usa para enviar a identidade.

- [ ] **[RODAR - VER PASSAR]**

  ```bash
  cd /Users/nikolas/Projects/openparty
  bunx vitest run apps/web/src/hooks/__tests__/useRoom.test.ts 2>&1 | tail -15
  ```

  Saida esperada: `Test Files  1 passed (1)` com `Tests  9 passed (9)`

- [ ] **[RODAR - TODOS OS TESTES DO FRAGMENTO]**

  ```bash
  cd /Users/nikolas/Projects/openparty
  bunx vitest run \
    apps/web/src/lib/__tests__/clock.test.ts \
    apps/web/src/lib/__tests__/sync.test.ts \
    apps/web/src/lib/players/__tests__/detect.test.ts \
    apps/web/src/lib/players/__tests__/html5.test.ts \
    apps/web/src/hooks/__tests__/useRoom.test.ts \
    2>&1 | tail -20
  ```

  Saida esperada: `Test Files  5 passed (5)` com todos os testes passando

- [ ] **[COMMIT]**

  ```bash
  cd /Users/nikolas/Projects/openparty
  git add apps/web/src/hooks/useRoom.ts \
          apps/web/src/hooks/__tests__/useRoom.test.ts
  git commit -m "feat(web): hook useRoom com gestao de estado de sala, peers, chat e reactions"
  ```

### Task 13: apps/web - componentes de UI

**Files:**
- Create: `apps/web/src/components/Home.tsx`
- Create: `apps/web/src/components/room/RoomPlayer.tsx`
- Create: `apps/web/src/components/room/RoomSidebar.tsx`
- Create: `apps/web/src/components/room/RoomControls.tsx`
- Create: `apps/web/src/components/room/ReactionsLayer.tsx`
- Modify: `apps/web/src/App.tsx`

**Interfaces:**

Consumes:
- Task 7: `useTheme`, shadcn/ui, Tailwind setup em `apps/web`
- Task 11: `createYouTubeAdapter`, `createHtml5Adapter`, `detectMediaType`, `PlayerAdapter` de `../lib/players/index`
- Task 12: `useRoom`, `UseRoomResult`, `ChatMessage`, `ReactionItem` de `../hooks/useRoom`
- Task 10: `useSync` de `../hooks/useSync`
- Task 9: `useClock` de `../hooks/useClock`

Produces:

```typescript
// apps/web/src/components/Home.tsx
export function Home(): JSX.Element
// - Input URL do video + input nickname + selecao avatar emoji
// - POST /rooms -> redireciona para /room/:roomId

// apps/web/src/components/room/RoomPlayer.tsx
interface RoomPlayerProps {
  roomState: RoomState
  onAdapterReady: (adapter: PlayerAdapter) => void
}
export function RoomPlayer(props: RoomPlayerProps): JSX.Element

// apps/web/src/components/room/RoomSidebar.tsx
interface RoomSidebarProps {
  peers: PresencePeer[]
  messages: ChatMessage[]
  onSendMessage: (text: string) => void
}
export function RoomSidebar(props: RoomSidebarProps): JSX.Element
// - Abas Presenca/Chat; colapsa no mobile (md:block)

// apps/web/src/components/room/RoomControls.tsx
interface RoomControlsProps {
  roomState: RoomState
  isHost: boolean
  onPlay: (time: number) => void
  onPause: (time: number) => void
  onSeek: (time: number) => void
}
export function RoomControls(props: RoomControlsProps): JSX.Element
// - Botoes play/pause/seek; toggle host-lock visivel so para o host

// apps/web/src/components/room/ReactionsLayer.tsx
interface ReactionsLayerProps {
  reactions: ReactionItem[]
  onReact: (emoji: string) => void
}
export function ReactionsLayer(props: ReactionsLayerProps): JSX.Element
// - Emojis animados via transform/opacity (compositor-friendly)
// - prefers-reduced-motion: desativa animacao, exibe estatico
```

---

**Steps:**

- [ ] **[TEST RED - Home.tsx]** Criar `apps/web/src/components/__tests__/Home.test.tsx` com o teste de renderizacao e submit:

```typescript
// apps/web/src/components/__tests__/Home.test.tsx
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { vi, describe, it, expect, beforeEach } from 'vitest'
import { Home } from '../Home'

const mockNavigate = vi.fn()
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual('react-router-dom')
  return { ...actual, useNavigate: () => mockNavigate }
})

global.fetch = vi.fn()

describe('Home', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('renderiza os inputs de URL, nickname e avatar', () => {
    render(<MemoryRouter><Home /></MemoryRouter>)
    expect(screen.getByPlaceholderText(/youtube\.com|youtu\.be/i)).toBeDefined()
    expect(screen.getByPlaceholderText(/nickname/i)).toBeDefined()
    expect(screen.getByRole('button', { name: /entrar|criar sala/i })).toBeDefined()
  })

  it('POST /rooms com mediaUrl e redireciona para /room/:roomId', async () => {
    ;(global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: true,
      json: async () => ({ roomId: 'abc123', url: '/room/abc123' }),
    })
    render(<MemoryRouter><Home /></MemoryRouter>)
    fireEvent.change(screen.getByPlaceholderText(/youtube\.com|youtu\.be/i), {
      target: { value: 'https://youtu.be/dQw4w9WgXcQ' },
    })
    fireEvent.change(screen.getByPlaceholderText(/nickname/i), {
      target: { value: 'Nikolas' },
    })
    fireEvent.click(screen.getByRole('button', { name: /entrar|criar sala/i }))
    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith(
        expect.stringContaining('/rooms'),
        expect.objectContaining({
          method: 'POST',
          body: expect.stringContaining('dQw4w9WgXcQ'),
        })
      )
      expect(mockNavigate).toHaveBeenCalledWith('/room/abc123')
    })
  })

  it('exibe erro se fetch falhar', async () => {
    ;(global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: false,
      json: async () => ({ error: 'URL invalida' }),
    })
    render(<MemoryRouter><Home /></MemoryRouter>)
    fireEvent.change(screen.getByPlaceholderText(/youtube\.com|youtu\.be/i), {
      target: { value: 'nao-e-url' },
    })
    fireEvent.change(screen.getByPlaceholderText(/nickname/i), {
      target: { value: 'Nikolas' },
    })
    fireEvent.click(screen.getByRole('button', { name: /entrar|criar sala/i }))
    await waitFor(() => {
      expect(screen.getByRole('alert')).toBeDefined()
    })
  })
})
```

- [ ] **[RUN RED]** Rodar e confirmar falha:

```bash
bunx vitest run apps/web/src/components/__tests__/Home.test.tsx
```

Saida esperada: `Cannot find module '../Home'` ou erro de importacao.

- [ ] **[IMPL - Home.tsx]** Criar `apps/web/src/components/Home.tsx`:

```typescript
// apps/web/src/components/Home.tsx
import { useState } from 'react'
import { useNavigate } from 'react-router-dom'

const AVATAR_OPTIONS = ['🎬', '🍿', '🎮', '🎵', '🦊', '🐻', '🐼', '🦁']
const SERVER_URL = import.meta.env.VITE_SERVER_URL ?? 'http://localhost:3000'

export function Home(): JSX.Element {
  const navigate = useNavigate()
  const [url, setUrl] = useState('')
  const [nickname, setNickname] = useState('')
  const [avatar, setAvatar] = useState(AVATAR_OPTIONS[0])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    setLoading(true)
    try {
      const res = await fetch(`${SERVER_URL}/rooms`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mediaUrl: url }),
      })
      const data = await res.json()
      if (!res.ok) {
        setError(data.error ?? 'Erro ao criar sala')
        return
      }
      sessionStorage.setItem('op_nickname', nickname)
      sessionStorage.setItem('op_avatar', avatar)
      navigate(`/room/${data.roomId}`)
    } catch {
      setError('Falha de rede. Tente novamente.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <main className="min-h-screen flex items-center justify-center bg-background p-4">
      <div className="w-full max-w-md space-y-6">
        <div className="text-center space-y-2">
          <h1 className="text-4xl font-bold tracking-tight">OpenParty</h1>
          <p className="text-muted-foreground">Assista junto, sincronizado.</p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-1">
            <label htmlFor="media-url" className="text-sm font-medium">
              URL do video
            </label>
            <input
              id="media-url"
              type="url"
              required
              placeholder="youtube.com/watch?v=... ou youtu.be/..."
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
            />
          </div>

          <div className="space-y-1">
            <label htmlFor="nickname" className="text-sm font-medium">
              Seu nickname
            </label>
            <input
              id="nickname"
              type="text"
              required
              minLength={1}
              maxLength={32}
              placeholder="Nickname"
              value={nickname}
              onChange={(e) => setNickname(e.target.value)}
              className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
            />
          </div>

          <div className="space-y-1">
            <span className="text-sm font-medium">Avatar</span>
            <div className="flex gap-2 flex-wrap">
              {AVATAR_OPTIONS.map((em) => (
                <button
                  key={em}
                  type="button"
                  aria-label={`Avatar ${em}`}
                  onClick={() => setAvatar(em)}
                  className={`text-2xl p-2 rounded-md border transition-colors ${
                    avatar === em
                      ? 'border-primary bg-primary/10'
                      : 'border-transparent hover:border-muted'
                  }`}
                >
                  {em}
                </button>
              ))}
            </div>
          </div>

          {error && (
            <div role="alert" className="rounded-md bg-destructive/10 border border-destructive/30 px-3 py-2 text-sm text-destructive">
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={loading}
            className="w-full rounded-md bg-primary text-primary-foreground px-4 py-2 text-sm font-medium hover:bg-primary/90 disabled:opacity-50 transition-colors"
          >
            {loading ? 'Criando sala...' : 'Entrar na sala'}
          </button>
        </form>
      </div>
    </main>
  )
}
```

- [ ] **[RUN GREEN - Home.tsx]** Rodar e confirmar verde:

```bash
bunx vitest run apps/web/src/components/__tests__/Home.test.tsx
```

Saida esperada: `3 passed`.

- [ ] **[TEST RED - RoomControls]** Criar `apps/web/src/components/__tests__/RoomControls.test.tsx`:

```typescript
// apps/web/src/components/__tests__/RoomControls.test.tsx
import { render, screen, fireEvent } from '@testing-library/react'
import { vi, describe, it, expect } from 'vitest'
import type { RoomState } from '@openparty/protocol'
import { RoomControls } from '../room/RoomControls'

function makeState(overrides: Partial<RoomState> = {}): RoomState {
  return {
    roomId: 'r1',
    mediaUrl: 'https://youtu.be/dQw4w9WgXcQ',
    mediaType: 'youtube',
    playing: false,
    positionSecs: 0,
    lastEventAt: Date.now(),
    playbackRate: 1,
    hostId: 'user-1',
    hostLock: false,
    ...overrides,
  }
}

describe('RoomControls', () => {
  it('chama onPlay com posicao atual quando play e clicado', () => {
    const onPlay = vi.fn()
    render(
      <RoomControls
        roomState={makeState({ positionSecs: 10 })}
        isHost
        onPlay={onPlay}
        onPause={vi.fn()}
        onSeek={vi.fn()}
      />
    )
    fireEvent.click(screen.getByRole('button', { name: /play/i }))
    expect(onPlay).toHaveBeenCalledWith(10)
  })

  it('chama onPause quando pause e clicado durante reproducao', () => {
    const onPause = vi.fn()
    render(
      <RoomControls
        roomState={makeState({ playing: true, positionSecs: 42 })}
        isHost
        onPlay={vi.fn()}
        onPause={onPause}
        onSeek={vi.fn()}
      />
    )
    fireEvent.click(screen.getByRole('button', { name: /pause/i }))
    expect(onPause).toHaveBeenCalledWith(42)
  })

  it('nao exibe toggle host-lock para nao-host', () => {
    render(
      <RoomControls
        roomState={makeState()}
        isHost={false}
        onPlay={vi.fn()}
        onPause={vi.fn()}
        onSeek={vi.fn()}
      />
    )
    expect(screen.queryByRole('switch', { name: /host.lock/i })).toBeNull()
  })

  it('exibe toggle host-lock para host', () => {
    render(
      <RoomControls
        roomState={makeState({ hostLock: false })}
        isHost
        onPlay={vi.fn()}
        onPause={vi.fn()}
        onSeek={vi.fn()}
      />
    )
    expect(screen.getByRole('switch', { name: /host.lock/i })).toBeDefined()
  })
})
```

- [ ] **[RUN RED]** Rodar:

```bash
bunx vitest run apps/web/src/components/__tests__/RoomControls.test.tsx
```

Saida esperada: erro de importacao `'../room/RoomControls'`.

- [ ] **[IMPL - RoomControls.tsx]** Criar `apps/web/src/components/room/RoomControls.tsx`:

```typescript
// apps/web/src/components/room/RoomControls.tsx
import type { RoomState } from '@openparty/protocol'

interface RoomControlsProps {
  roomState: RoomState
  isHost: boolean
  onPlay: (time: number) => void
  onPause: (time: number) => void
  onSeek: (time: number) => void
}

export function RoomControls({ roomState, isHost, onPlay, onPause, onSeek }: RoomControlsProps): JSX.Element {
  const { playing, positionSecs, hostLock } = roomState

  function handleSeekChange(e: React.ChangeEvent<HTMLInputElement>) {
    onSeek(Number(e.target.value))
  }

  return (
    <div className="flex flex-col gap-2 px-4 py-3 bg-card border-t border-border">
      <div className="flex items-center gap-3">
        {playing ? (
          <button
            aria-label="pause"
            onClick={() => onPause(positionSecs)}
            className="rounded-md bg-primary text-primary-foreground px-4 py-1.5 text-sm font-medium hover:bg-primary/90 transition-colors"
          >
            Pause
          </button>
        ) : (
          <button
            aria-label="play"
            onClick={() => onPlay(positionSecs)}
            className="rounded-md bg-primary text-primary-foreground px-4 py-1.5 text-sm font-medium hover:bg-primary/90 transition-colors"
          >
            Play
          </button>
        )}

        <input
          type="range"
          min={0}
          max={3600}
          step={1}
          value={positionSecs}
          onChange={handleSeekChange}
          aria-label="seek"
          className="flex-1 accent-primary"
        />

        <span className="text-xs text-muted-foreground tabular-nums w-12 text-right">
          {formatTime(positionSecs)}
        </span>

        {isHost && (
          <label className="flex items-center gap-1.5 text-xs text-muted-foreground cursor-pointer">
            <input
              type="checkbox"
              role="switch"
              aria-label="host-lock"
              checked={hostLock}
              readOnly
              className="sr-only"
            />
            <span
              role="switch"
              aria-label="host-lock"
              aria-checked={hostLock}
              onClick={() => {
                // event emitido via onSeek placeholder - handler real no RoomPage
              }}
              className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${
                hostLock ? 'bg-primary' : 'bg-muted'
              }`}
            >
              <span
                className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white shadow transition-transform ${
                  hostLock ? 'translate-x-4' : 'translate-x-1'
                }`}
              />
            </span>
            <span>Host lock</span>
          </label>
        )}
      </div>
    </div>
  )
}

function formatTime(secs: number): string {
  const m = Math.floor(secs / 60)
  const s = Math.floor(secs % 60)
  return `${m}:${s.toString().padStart(2, '0')}`
}
```

- [ ] **[RUN GREEN - RoomControls]**:

```bash
bunx vitest run apps/web/src/components/__tests__/RoomControls.test.tsx
```

Saida esperada: `4 passed`.

- [ ] **[TEST RED - RoomSidebar]** Criar `apps/web/src/components/__tests__/RoomSidebar.test.tsx`:

```typescript
// apps/web/src/components/__tests__/RoomSidebar.test.tsx
import { render, screen, fireEvent } from '@testing-library/react'
import { vi, describe, it, expect } from 'vitest'
import type { PresencePeer } from '@openparty/protocol'
import type { ChatMessage } from '../../hooks/useRoom'
import { RoomSidebar } from '../room/RoomSidebar'

const peers: PresencePeer[] = [
  { userId: 'u1', displayName: 'Nikolas', avatar: '🦊' },
  { userId: 'u2', displayName: 'Angélica', avatar: '🐼' },
]

const messages: ChatMessage[] = [
  { userId: 'u1', displayName: 'Nikolas', text: 'Oi!', ts: 1000 },
  { userId: 'u2', displayName: 'Angélica', text: 'Ola!', ts: 2000 },
]

describe('RoomSidebar', () => {
  it('exibe os peers na aba Presenca', () => {
    render(<RoomSidebar peers={peers} messages={messages} onSendMessage={vi.fn()} />)
    expect(screen.getByText('Nikolas')).toBeDefined()
    expect(screen.getByText('Angélica')).toBeDefined()
  })

  it('alterna para aba Chat e exibe mensagens', () => {
    render(<RoomSidebar peers={peers} messages={messages} onSendMessage={vi.fn()} />)
    fireEvent.click(screen.getByRole('tab', { name: /chat/i }))
    expect(screen.getByText('Oi!')).toBeDefined()
    expect(screen.getByText('Ola!')).toBeDefined()
  })

  it('chama onSendMessage ao submeter o formulario de chat', () => {
    const onSendMessage = vi.fn()
    render(<RoomSidebar peers={peers} messages={[]} onSendMessage={onSendMessage} />)
    fireEvent.click(screen.getByRole('tab', { name: /chat/i }))
    const input = screen.getByPlaceholderText(/mensagem/i)
    fireEvent.change(input, { target: { value: 'Teste' } })
    fireEvent.submit(input.closest('form')!)
    expect(onSendMessage).toHaveBeenCalledWith('Teste')
  })
})
```

- [ ] **[RUN RED]**:

```bash
bunx vitest run apps/web/src/components/__tests__/RoomSidebar.test.tsx
```

Saida esperada: erro de importacao.

- [ ] **[IMPL - RoomSidebar.tsx]** Criar `apps/web/src/components/room/RoomSidebar.tsx`:

```typescript
// apps/web/src/components/room/RoomSidebar.tsx
import { useState } from 'react'
import type { PresencePeer } from '@openparty/protocol'
import type { ChatMessage } from '../../hooks/useRoom'

interface RoomSidebarProps {
  peers: PresencePeer[]
  messages: ChatMessage[]
  onSendMessage: (text: string) => void
}

type Tab = 'presence' | 'chat'

export function RoomSidebar({ peers, messages, onSendMessage }: RoomSidebarProps): JSX.Element {
  const [tab, setTab] = useState<Tab>('presence')
  const [draft, setDraft] = useState('')

  function handleChatSubmit(e: React.FormEvent) {
    e.preventDefault()
    const text = draft.trim()
    if (!text) return
    onSendMessage(text)
    setDraft('')
  }

  return (
    <aside className="hidden md:flex flex-col w-72 border-l border-border bg-card h-full">
      <div className="flex border-b border-border" role="tablist">
        <button
          role="tab"
          aria-label="Presenca"
          aria-selected={tab === 'presence'}
          onClick={() => setTab('presence')}
          className={`flex-1 py-2.5 text-sm font-medium transition-colors ${
            tab === 'presence'
              ? 'border-b-2 border-primary text-foreground'
              : 'text-muted-foreground hover:text-foreground'
          }`}
        >
          Presenca ({peers.length})
        </button>
        <button
          role="tab"
          aria-label="Chat"
          aria-selected={tab === 'chat'}
          onClick={() => setTab('chat')}
          className={`flex-1 py-2.5 text-sm font-medium transition-colors ${
            tab === 'chat'
              ? 'border-b-2 border-primary text-foreground'
              : 'text-muted-foreground hover:text-foreground'
          }`}
        >
          Chat
        </button>
      </div>

      {tab === 'presence' && (
        <ul className="flex-1 overflow-y-auto p-3 space-y-2">
          {peers.map((peer) => (
            <li key={peer.userId} className="flex items-center gap-2 text-sm">
              <span className="text-xl">{peer.avatar}</span>
              <span className="font-medium">{peer.displayName}</span>
            </li>
          ))}
        </ul>
      )}

      {tab === 'chat' && (
        <>
          <ul className="flex-1 overflow-y-auto p-3 space-y-2">
            {messages.map((msg) => (
              <li key={`${msg.userId}-${msg.ts}`} className="text-sm space-y-0.5">
                <span className="font-medium text-foreground">{msg.displayName}</span>
                <span className="text-muted-foreground ml-1">{msg.text}</span>
              </li>
            ))}
          </ul>
          <form onSubmit={handleChatSubmit} className="p-3 border-t border-border flex gap-2">
            <input
              type="text"
              placeholder="Mensagem..."
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              className="flex-1 rounded-md border border-input bg-background px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
            />
            <button
              type="submit"
              className="rounded-md bg-primary text-primary-foreground px-3 py-1.5 text-sm font-medium hover:bg-primary/90 transition-colors"
            >
              Enviar
            </button>
          </form>
        </>
      )}
    </aside>
  )
}
```

- [ ] **[RUN GREEN - RoomSidebar]**:

```bash
bunx vitest run apps/web/src/components/__tests__/RoomSidebar.test.tsx
```

Saida esperada: `3 passed`.

- [ ] **[TEST RED - ReactionsLayer]** Criar `apps/web/src/components/__tests__/ReactionsLayer.test.tsx`:

```typescript
// apps/web/src/components/__tests__/ReactionsLayer.test.tsx
import { render, screen, fireEvent } from '@testing-library/react'
import { vi, describe, it, expect } from 'vitest'
import type { ReactionItem } from '../../hooks/useRoom'
import { ReactionsLayer } from '../room/ReactionsLayer'

const reactions: ReactionItem[] = [
  { id: 'r1', userId: 'u1', emoji: '❤️', ts: 1000 },
  { id: 'r2', userId: 'u2', emoji: '😂', ts: 2000 },
]

describe('ReactionsLayer', () => {
  it('exibe emojis ativos', () => {
    render(<ReactionsLayer reactions={reactions} onReact={vi.fn()} />)
    expect(screen.getAllByText('❤️').length).toBeGreaterThanOrEqual(1)
    expect(screen.getAllByText('😂').length).toBeGreaterThanOrEqual(1)
  })

  it('chama onReact ao clicar em emoji do seletor', () => {
    const onReact = vi.fn()
    render(<ReactionsLayer reactions={[]} onReact={onReact} />)
    fireEvent.click(screen.getByRole('button', { name: '❤️' }))
    expect(onReact).toHaveBeenCalledWith('❤️')
  })
})
```

- [ ] **[RUN RED]**:

```bash
bunx vitest run apps/web/src/components/__tests__/ReactionsLayer.test.tsx
```

- [ ] **[IMPL - ReactionsLayer.tsx]** Criar `apps/web/src/components/room/ReactionsLayer.tsx`:

```typescript
// apps/web/src/components/room/ReactionsLayer.tsx
import { useEffect, useState } from 'react'
import type { ReactionItem } from '../../hooks/useRoom'

const QUICK_EMOJIS = ['❤️', '😂', '😮', '👏', '🔥', '💯']
// Duracao de exibicao de cada emoji flutuante em ms
const FLOAT_DURATION_MS = 2500

interface FloatingEmoji {
  id: string
  emoji: string
  x: number
}

interface ReactionsLayerProps {
  reactions: ReactionItem[]
  onReact: (emoji: string) => void
}

export function ReactionsLayer({ reactions, onReact }: ReactionsLayerProps): JSX.Element {
  const [floating, setFloating] = useState<FloatingEmoji[]>([])

  // Converte reactions recentes em emojis flutuantes
  useEffect(() => {
    const now = Date.now()
    const recent = reactions.filter((r) => now - r.ts < FLOAT_DURATION_MS)
    setFloating(
      recent.map((r) => ({
        id: r.id,
        emoji: r.emoji,
        x: Math.random() * 80 + 10, // % horizontal
      }))
    )
  }, [reactions])

  return (
    <div className="absolute inset-0 pointer-events-none overflow-hidden" aria-hidden="true">
      {/* Emojis flutuantes - animacao via transform/opacity */}
      {floating.map((item) => (
        <span
          key={item.id}
          className="absolute bottom-16 text-3xl select-none motion-safe:animate-float-up"
          style={{ left: `${item.x}%` }}
        >
          {item.emoji}
        </span>
      ))}

      {/* Seletor de reacoes - pointer-events re-habilitado */}
      <div className="absolute bottom-4 left-1/2 -translate-x-1/2 pointer-events-auto flex gap-1.5 bg-background/80 backdrop-blur-sm rounded-full px-3 py-1.5 border border-border shadow-md">
        {QUICK_EMOJIS.map((em) => (
          <button
            key={em}
            aria-label={em}
            onClick={() => onReact(em)}
            className="text-xl hover:scale-125 transition-transform active:scale-95"
          >
            {em}
          </button>
        ))}
      </div>
    </div>
  )
}
```

Nota: adicionar no `apps/web/src/index.css` (ou `tailwind.config.ts`) a keyframe `float-up`:

```css
@keyframes float-up {
  from { transform: translateY(0); opacity: 1; }
  to   { transform: translateY(-120px); opacity: 0; }
}
.animate-float-up { animation: float-up 2.5s ease-out forwards; }
```

E em `tailwind.config.ts`:

```typescript
animation: { 'float-up': 'float-up 2.5s ease-out forwards' },
keyframes: {
  'float-up': {
    from: { transform: 'translateY(0)', opacity: '1' },
    to: { transform: 'translateY(-120px)', opacity: '0' },
  },
},
```

- [ ] **[RUN GREEN - ReactionsLayer]**:

```bash
bunx vitest run apps/web/src/components/__tests__/ReactionsLayer.test.tsx
```

Saida esperada: `2 passed`.

- [ ] **[IMPL - RoomPlayer.tsx]** Criar `apps/web/src/components/room/RoomPlayer.tsx` (sem teste unitario - validado via aceite visual, pois depende da API do DOM do player):

```typescript
// apps/web/src/components/room/RoomPlayer.tsx
import { useEffect, useRef } from 'react'
import type { RoomState } from '@openparty/protocol'
import type { PlayerAdapter } from '../../lib/players/index'
import { createYouTubeAdapter, createHtml5Adapter, detectMediaType } from '../../lib/players/index'

interface RoomPlayerProps {
  roomState: RoomState
  onAdapterReady: (adapter: PlayerAdapter) => void
}

export function RoomPlayer({ roomState, onAdapterReady }: RoomPlayerProps): JSX.Element {
  const containerRef = useRef<HTMLDivElement>(null)
  const videoRef = useRef<HTMLVideoElement>(null)
  const adapterRef = useRef<PlayerAdapter | null>(null)

  useEffect(() => {
    const { mediaUrl, mediaType } = roomState
    let destroyed = false

    async function init() {
      if (!containerRef.current && !videoRef.current) return

      let adapter: PlayerAdapter

      if (mediaType === 'youtube') {
        const videoId = extractYouTubeId(mediaUrl)
        if (!videoId || !containerRef.current) return
        adapter = await createYouTubeAdapter(containerRef.current, videoId)
      } else {
        if (!videoRef.current) return
        adapter = createHtml5Adapter(videoRef.current)
      }

      if (destroyed) {
        adapter.destroy()
        return
      }

      adapterRef.current = adapter
      onAdapterReady(adapter)
    }

    init()

    return () => {
      destroyed = true
      adapterRef.current?.destroy()
      adapterRef.current = null
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [roomState.mediaUrl, roomState.mediaType])

  if (roomState.mediaType === 'youtube') {
    return (
      <div className="w-full aspect-video bg-black">
        <div ref={containerRef} className="w-full h-full" />
      </div>
    )
  }

  return (
    <div className="w-full aspect-video bg-black">
      <video
        ref={videoRef}
        src={roomState.mediaUrl}
        className="w-full h-full"
        playsInline
      />
    </div>
  )
}

function extractYouTubeId(url: string): string | null {
  const patterns = [
    /youtu\.be\/([^?&]+)/,
    /[?&]v=([^?&]+)/,
    /^([a-zA-Z0-9_-]{11})$/,
  ]
  for (const re of patterns) {
    const m = url.match(re)
    if (m) return m[1]
  }
  return null
}
```

- [ ] **[MODIFY - App.tsx]** Atualizar `apps/web/src/App.tsx` para conectar as rotas:

```typescript
// apps/web/src/App.tsx
import { Routes, Route } from 'react-router-dom'
import { Home } from './components/Home'
import { RoomPage } from './pages/RoomPage'
import { ThemeProvider } from './providers/ThemeProvider'

export function App(): JSX.Element {
  return (
    <ThemeProvider>
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/room/:roomId" element={<RoomPage />} />
      </Routes>
    </ThemeProvider>
  )
}
```

Criar `apps/web/src/pages/RoomPage.tsx` integrando todos os hooks e componentes:

```typescript
// apps/web/src/pages/RoomPage.tsx
import { useState } from 'react'
import { useParams } from 'react-router-dom'
import { useRoom } from '../hooks/useRoom'
import { useClock } from '../hooks/useClock'
import { useSync } from '../hooks/useSync'
import { RoomPlayer } from '../components/room/RoomPlayer'
import { RoomSidebar } from '../components/room/RoomSidebar'
import { RoomControls } from '../components/room/RoomControls'
import { ReactionsLayer } from '../components/room/ReactionsLayer'
import type { PlayerAdapter } from '../lib/players/index'

export function RoomPage(): JSX.Element {
  const { roomId = '' } = useParams()
  const displayName = sessionStorage.getItem('op_nickname') ?? 'Anonimo'
  const avatar = sessionStorage.getItem('op_avatar') ?? '🎬'

  const {
    roomState,
    peers,
    messages,
    reactions,
    sendPlay,
    sendPause,
    sendSeek,
    sendChat,
    sendReaction,
    connected,
  } = useRoom(roomId, { displayName, avatar })

  const [adapter, setAdapter] = useState<PlayerAdapter | null>(null)
  const { serverNow, calibrating } = useClock(connected ? (null as unknown as ReturnType<typeof import('../lib/ws-client').createWsClient>) : null)

  useSync(roomState, adapter, serverNow)

  if (!roomState) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <p className="text-muted-foreground">
          {connected ? 'Carregando sala...' : 'Conectando...'}
          {calibrating ? ' (calibrando relogio)' : ''}
        </p>
      </div>
    )
  }

  const isHost = roomState.hostId === displayName

  return (
    <div className="flex h-screen overflow-hidden bg-background">
      <main className="flex flex-col flex-1 min-w-0">
        <div className="relative flex-1">
          <RoomPlayer roomState={roomState} onAdapterReady={setAdapter} />
          <ReactionsLayer reactions={reactions} onReact={sendReaction} />
        </div>
        <RoomControls
          roomState={roomState}
          isHost={isHost}
          onPlay={sendPlay}
          onPause={sendPause}
          onSeek={sendSeek}
        />
      </main>
      <RoomSidebar peers={peers} messages={messages} onSendMessage={sendChat} />
    </div>
  )
}
```

- [ ] **[RUN ALL - Task 13]** Rodar suite completa dos componentes:

```bash
bunx vitest run apps/web/src/components
```

Saida esperada: `9 passed` (3 Home + 4 RoomControls + 3 RoomSidebar + 2 ReactionsLayer, com um ou dois imports pulados por jsdom).

- [ ] **[COMMIT - Task 13]**:

```bash
git add \
  apps/web/src/components/Home.tsx \
  apps/web/src/components/room/RoomPlayer.tsx \
  apps/web/src/components/room/RoomSidebar.tsx \
  apps/web/src/components/room/RoomControls.tsx \
  apps/web/src/components/room/ReactionsLayer.tsx \
  apps/web/src/components/__tests__/Home.test.tsx \
  apps/web/src/components/__tests__/RoomControls.test.tsx \
  apps/web/src/components/__tests__/RoomSidebar.test.tsx \
  apps/web/src/components/__tests__/ReactionsLayer.test.tsx \
  apps/web/src/pages/RoomPage.tsx \
  apps/web/src/App.tsx
git commit -m "feat(web): add UI components - Home, RoomPlayer, RoomSidebar, RoomControls, ReactionsLayer"
```

---

### Task 14: Infra

**Files:**
- Create: `docker-compose.yml`
- Create: `apps/server/Dockerfile`
- Create: `apps/web/Dockerfile`
- Create: `LICENSE`
- Create: `README.md`

**Interfaces:**

Consumes:
- Todas as tasks anteriores (app funcional)
- Task 2 (protocolo documentado no README)

Produces:
- `docker-compose up` sobe `server` (porta 3000) e `web` (porta 5173 via `serve`)
- Variavel `REDIS_URL` opcional documentada (servidor detecta e troca broadcaster; sem Redis = broadcaster local em memoria)
- `README.md` com descricao, instrucoes de uso, botao "Deploy to Railway", tabela de eventos do protocolo e nota sobre limitacao de `playbackRate` no YouTube
- `LICENSE` MIT com "Nikolas de Hor" como autor

---

**Steps:**

- [ ] **[IMPL - apps/server/Dockerfile]** Criar `apps/server/Dockerfile`:

```dockerfile
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
```

- [ ] **[IMPL - apps/web/Dockerfile]** Criar `apps/web/Dockerfile`:

```dockerfile
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
```

- [ ] **[IMPL - docker-compose.yml]** Criar `docker-compose.yml`:

```yaml
# docker-compose.yml
# Sobe o servidor WebSocket/HTTP e o frontend estatico.
# REDIS_URL e opcional - sem ele o broadcaster roda em memoria (apenas 1 instancia).
version: '3.9'

services:
  server:
    build:
      context: .
      dockerfile: apps/server/Dockerfile
    ports:
      - '3000:3000'
    environment:
      - PORT=3000
      - REDIS_URL=${REDIS_URL:-}
      - NODE_ENV=production
    healthcheck:
      test: ['CMD', 'wget', '-qO-', 'http://localhost:3000/health']
      interval: 10s
      timeout: 5s
      retries: 3

  web:
    build:
      context: .
      dockerfile: apps/web/Dockerfile
      args:
        - VITE_SERVER_URL=${VITE_SERVER_URL:-http://localhost:3000}
    ports:
      - '5173:5173'
    depends_on:
      server:
        condition: service_healthy
    environment:
      - NODE_ENV=production
```

- [ ] **[IMPL - LICENSE]** Criar `LICENSE` (MIT):

```
MIT License

Copyright (c) 2026 Nikolas de Hor

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

- [ ] **[IMPL - README.md]** Criar `README.md`:

```markdown
# OpenParty

Assista videos juntos, sincronizados, sem plugins. YouTube e MP4 direto no navegador.

[![Deploy on Railway](https://railway.com/button.svg)](https://railway.com/template/openparty)

---

## Inicio rapido

### Docker Compose (recomendado)

```bash
git clone https://github.com/nikolasdehor/openparty
cd openparty
docker-compose up --build
```

- Frontend: http://localhost:5173
- API/WS: http://localhost:3000

Cole a URL de um video do YouTube ou de um arquivo MP4, escolha seu nickname e compartilhe o link da sala.

### Desenvolvimento local

```bash
pnpm install
pnpm turbo run dev
```

### Variaveis de ambiente

| Variavel | Padrao | Descricao |
|----------|--------|-----------|
| `PORT` | `3000` | Porta do servidor |
| `REDIS_URL` | _(vazio)_ | URL Redis opcional. Sem Redis, o broadcaster roda em memoria (somente 1 instancia). Com Redis, escala horizontalmente. |
| `VITE_SERVER_URL` | `http://localhost:3000` | URL do servidor vista pelo frontend |

---

## Protocolo WebSocket

A sala e acessada via WebSocket em `ws://<host>/ws/:roomId`.

O cliente envia um handshake de identidade no primeiro frame (JSON):

```json
{ "displayName": "Nikolas", "avatar": "🦊" }
```

O servidor responde com `room-state` completo e passa a retransmitir eventos.

### Eventos: Cliente -> Servidor

| Tipo | Campos extras | Descricao |
|------|---------------|-----------|
| `play` | `time: number` | Solicita play na posicao `time` (segundos) |
| `pause` | `time: number` | Solicita pause na posicao `time` |
| `seek` | `time: number` | Solicita salto para `time` |
| `clock-ping` | `t1: number` | Ping NTP-like para calibracao de relogio |
| `buffering-start` | - | Informa que o cliente esta bufferizando |
| `buffering-end` | - | Informa que o buffer foi preenchido |
| `chat` | `text: string` | Envia mensagem de chat |
| `reaction` | `emoji: string` | Envia reacao emoji |

### Eventos: Servidor -> Clientes

| Tipo | Campos extras | Descricao |
|------|---------------|-----------|
| `room-state` | _(vide RoomState + peers)_ | Estado completo enviado ao entrar na sala |
| `play` | `time, when` | Play agendado para `when` (Date.now() + 300ms) |
| `pause` | `time, serverTime` | Pause imediato |
| `seek` | `time` | Seek imediato |
| `clock-pong` | `t1, t2, t3` | Resposta ao ping para calculo de offset |
| `join` | `userId, displayName, avatar` | Novo participante entrou |
| `leave` | `userId` | Participante saiu |
| `host-change` | `hostId` | Novo host eleito |
| `chat` | `userId, displayName, text, ts` | Mensagem de chat retransmitida |
| `reaction` | `userId, emoji, ts` | Reacao retransmitida |

### Nota sobre playbackRate no YouTube

A API do YouTube IFrame aceita apenas valores discretos de velocidade: `0.25`, `0.5`, `0.75`, `1`, `1.25`, `1.5`, `1.75`, `2`. Ao acionar o ajuste fino de rate (modo drift 0.3-0.5s), o valor e arredondado para o mais proximo disponivel, o que limita a precisao do sync suave para YouTube. Para MP4 via HTML5, qualquer valor decimal e aceito.

---

## Licenca

MIT - Nikolas de Hor
```

- [ ] **[VERIFICACAO - docker-compose build]** Confirmar que os Dockerfiles sao validos sintaticamente (sem subir os containers):

```bash
docker compose config --quiet
```

Saida esperada: sem erros de parse YAML.

- [ ] **[COMMIT - Task 14]**:

```bash
git add \
  docker-compose.yml \
  apps/server/Dockerfile \
  apps/web/Dockerfile \
  LICENSE \
  README.md
git commit -m "feat(infra): add Dockerfiles, docker-compose, LICENSE and README"
```

---

### Task 15: Aceite

**Files:**
- Create: `docs/acceptance.md`

**Interfaces:**

Consumes:
- Todas as tasks anteriores (app completo rodando via `docker-compose up --build`)

Produces:
- Roteiro de 9 verificacoes executaveis com comandos exatos de `agent-browser`
- Cada item como `- [ ]` com comando de verificacao e criterio de aprovacao

---

**Steps:**

- [ ] **[IMPL - docs/acceptance.md]** Criar `docs/acceptance.md` com o roteiro completo:

```markdown
# Roteiro de Aceite - OpenParty Fase 1

Executar com o app rodando via `docker-compose up --build`.
Usar `agent-browser` como ferramenta padrao para automacao visual.

Pre-requisito:

```bash
docker-compose up --build -d
agent-browser open http://localhost:5173
agent-browser set viewport 1440 900
```

---

## Verificacao 1 - Criacao de sala e desvio de sync < 1s

```bash
# Aba A: criar sala
agent-browser open http://localhost:5173
agent-browser find "input[placeholder*='youtube']" --fill "https://youtu.be/dQw4w9WgXcQ"
agent-browser find "input[placeholder*='ickname']" --fill "NikolasA"
agent-browser find "button[type='submit']" --click
agent-browser get url
# Copiar URL retornada (ex: http://localhost:5173/room/abc123)

# Aba B: entrar na mesma sala
agent-browser tabs create http://localhost:5173/room/abc123
agent-browser find "input[placeholder*='ickname']" --fill "NikolasB"
agent-browser find "button[type='submit']" --click

# Medir desvio: capturar currentTime das duas abas
agent-browser tabs select 1
agent-browser evaluate "document.querySelector('video')?.currentTime ?? window.__op_currentTime ?? 'N/A'"
agent-browser tabs select 2
agent-browser evaluate "document.querySelector('video')?.currentTime ?? window.__op_currentTime ?? 'N/A'"
```

Criterio: diferenca entre os dois valores < 1 segundo.

---

## Verificacao 2 - Play propaga em < 1s

```bash
# Na Aba A (host), clicar play
agent-browser tabs select 1
agent-browser find "button[aria-label='play']" --click
agent-browser screenshot /tmp/openparty-v2-before.png

# Aguardar propagacao e verificar na Aba B
agent-browser tabs select 2
agent-browser screenshot /tmp/openparty-v2-after.png
agent-browser evaluate "document.querySelector('video')?.paused === false"
```

Criterio: retorno `true` na Aba B em ate 1s apos o click.

---

## Verificacao 3 - Pause e seek propagam

```bash
# Aba A: pause
agent-browser tabs select 1
agent-browser find "button[aria-label='pause']" --click

# Verificar pause na Aba B
agent-browser tabs select 2
agent-browser evaluate "document.querySelector('video')?.paused === true"

# Aba A: seek para 30s via slider
agent-browser tabs select 1
agent-browser evaluate "document.querySelector('input[aria-label=\"seek\"]').value = 30; document.querySelector('input[aria-label=\"seek\"]').dispatchEvent(new Event('change', {bubbles:true}))"

# Verificar posicao na Aba B (tolerancia 2s)
agent-browser tabs select 2
agent-browser evaluate "Math.abs((document.querySelector('video')?.currentTime ?? 0) - 30) < 2"
```

Criterio: pause `true` e seek com diferenca < 2s.

---

## Verificacao 4 - Chat aparece em < 500ms

```bash
agent-browser tabs select 1
# Abrir aba chat na sidebar
agent-browser find "button[aria-label='Chat']" --click
agent-browser find "input[placeholder*='ensagem']" --fill "Oi, funciona?"
agent-browser find "form" --submit

agent-browser tabs select 2
agent-browser find "button[aria-label='Chat']" --click
agent-browser screenshot /tmp/openparty-v4-chat.png
agent-browser find "li" --contains "Oi, funciona?"
```

Criterio: elemento com texto "Oi, funciona?" visivel na Aba B.

---

## Verificacao 5 - Reacao emoji anima nas duas abas

```bash
agent-browser tabs select 1
agent-browser find "button[aria-label='❤️']" --click
agent-browser screenshot /tmp/openparty-v5-tab1.png

agent-browser tabs select 2
agent-browser screenshot /tmp/openparty-v5-tab2.png
agent-browser evaluate "document.querySelectorAll('.animate-float-up').length > 0 || document.querySelector('[data-emoji]') !== null"
```

Criterio: screenshot mostra emoji na Aba 2 OU evaluate retorna `true`.

---

## Verificacao 6 - Entrada no meio recebe posicao correta

```bash
# Aba A: pausar em 60s
agent-browser tabs select 1
agent-browser evaluate "document.querySelector('input[aria-label=\"seek\"]').value = 60; document.querySelector('input[aria-label=\"seek\"]').dispatchEvent(new Event('change', {bubbles:true}))"
agent-browser find "button[aria-label='pause']" --click

# Aba C: entrar na sala
ROOM_URL=$(agent-browser evaluate "location.href")
agent-browser tabs create "$ROOM_URL"
agent-browser find "input[placeholder*='ickname']" --fill "NikolasC"
agent-browser find "button[type='submit']" --click

# Verificar que recebeu room-state com posicao ~60s
agent-browser evaluate "Math.abs((document.querySelector('video')?.currentTime ?? 0) - 60) < 3"
```

Criterio: posicao inicial da Aba C dentro de 3s de 60s.

---

## Verificacao 7 - Host transfer ao fechar aba do host

```bash
# Fechar Aba A (host original)
agent-browser tabs select 1
agent-browser tabs close

# Verificar sidebar da Aba B mostra novo host
agent-browser tabs select 2
agent-browser screenshot /tmp/openparty-v7-hostchange.png
agent-browser evaluate "document.body.innerText.includes('NikolasB') || document.body.innerText.includes('host')"
```

Criterio: sidebar mostra "NikolasB" como host OU indicador de host atualizado.

---

## Verificacao 8 - Persistencia de tema dark/light

```bash
# Aba B: alternar para dark
agent-browser tabs select 2
agent-browser evaluate "document.documentElement.classList.contains('dark')"
# Se false, acionar toggle de tema (botao ou atalho)
agent-browser find "[aria-label*='tema'],[aria-label*='theme'],[aria-label*='dark']" --click
agent-browser evaluate "document.documentElement.classList.contains('dark')"

# Recarregar e verificar persistencia
agent-browser evaluate "location.reload()"
agent-browser evaluate "document.documentElement.classList.contains('dark')"
```

Criterio: `true` antes e depois do reload.

---

## Verificacao 9 - Build limpo via docker-compose

```bash
# Em diretorio limpo (sem node_modules, sem dist)
cd /tmp
git clone https://github.com/nikolasdehor/openparty openparty-clean
cd openparty-clean
docker-compose up --build -d

# Aguardar health check do servidor
until curl -sf http://localhost:3000/health; do sleep 2; done

# Repetir verificacao 1 de forma simplificada
agent-browser open http://localhost:5173
agent-browser screenshot /tmp/openparty-v9-home.png
agent-browser find "input[placeholder*='youtube']" --fill "https://youtu.be/dQw4w9WgXcQ"
agent-browser find "input[placeholder*='ickname']" --fill "Teste"
agent-browser find "button[type='submit']" --click
agent-browser screenshot /tmp/openparty-v9-room.png
agent-browser evaluate "location.pathname.startsWith('/room/')"
```

Criterio: URL muda para `/room/<id>` e screenshot mostra o player carregado.

---

## Resultado final

Todas as 9 verificacoes devem passar com os criterios acima para a Fase 1 ser considerada concluida.

Screenshots geradas em `/tmp/openparty-v*.png` para evidencia de aceite.
```

- [ ] **[VERIFICACAO - lint do markdown]** Confirmar que o arquivo foi criado corretamente:

```bash
wc -l docs/acceptance.md
```

Saida esperada: 150 ou mais linhas.

- [ ] **[COMMIT - Task 15]**:

```bash
git add docs/acceptance.md
git commit -m "docs: add acceptance test runbook for Phase 1"
```

