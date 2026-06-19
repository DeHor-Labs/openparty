// apps/server/src/index.ts
import { Hono } from 'hono'
import { cors } from 'hono/cors'
import type { MiddlewareHandler } from 'hono'
import { nanoid } from 'nanoid'
import type {
  ClientEvent,
  RoomStateEvent,
  WelcomeEvent,
} from '@openparty/protocol'
import {
  isClientEvent,
  isClockPingEvent,
  isPlayClientEvent,
  isPauseClientEvent,
  isSeekClientEvent,
  isChatClientEvent,
  isReactionClientEvent,
  isBufferingStartEvent,
  isBufferingEndEvent,
  isSetHostLockEvent,
} from '@openparty/protocol'
import { createRoom, joinRoom, leaveRoom, getRoom, broadcast } from './rooms'
import { handleClockPing } from './handlers/clock'
import { handleSync } from './handlers/sync'
import { handleChat, handleReaction } from './handlers/chat'
import { handleHostLock } from './handlers/host-lock'

// Comprimento maximo permitido para displayName e avatar no handshake
const DISPLAY_NAME_MAX = 64
const AVATAR_MAX = 16
const MEDIA_URL_MAX = 2048

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

/**
 * Valida a mediaUrl recebida em POST /rooms.
 * Exige string nao vazia, length <= MEDIA_URL_MAX, e protocolo http ou https.
 */
function isValidMediaUrl(value: unknown): value is string {
  if (typeof value !== 'string' || value.length === 0 || value.length > MEDIA_URL_MAX) {
    return false
  }
  try {
    const parsed = new URL(value)
    return parsed.protocol === 'http:' || parsed.protocol === 'https:'
  } catch {
    return false
  }
}

/**
 * Opcoes de criacao do app Hono.
 * staticMiddleware: serve arquivos do dist do Vite (JS, CSS, imagens).
 * spaFallback: serve index.html para rotas desconhecidas (react-router).
 * Ambos sao injetados apenas em producao (runtime Bun) para nao poluir
 * o ambiente de testes Node/Vitest, onde Bun nao existe.
 */
export interface CreateAppOptions {
  staticMiddleware?: MiddlewareHandler
  spaFallback?: MiddlewareHandler
}

export function createApp(options: CreateAppOptions = {}) {
  const app = new Hono()

  // CORS configuravel via variavel de ambiente.
  // Em self-host ou desenvolvimento: ALLOWED_ORIGIN nao definida => '*' (permissivo).
  // Em producao: definir ALLOWED_ORIGIN com a origem exata do frontend.
  app.use('*', cors({ origin: process.env['ALLOWED_ORIGIN'] ?? '*' }))

  app.post('/rooms', async (c) => {
    const body = await c.req.json().catch(() => null)
    if (!body || !isValidMediaUrl(body.mediaUrl)) {
      return c.json({ error: 'mediaUrl invalida: deve ser string http/https com ate 2048 caracteres' }, 400)
    }

    const mediaType = detectMediaType(body.mediaUrl as string)
    const roomId = createRoom(body.mediaUrl as string, mediaType)

    const baseUrl = new URL(c.req.url)
    const url = `${baseUrl.protocol}//${baseUrl.host}/room/${roomId}`

    return c.json({ roomId, url }, 201)
  })

  // Rota de health check - usada pelo docker-compose e por load balancers
  app.get('/health', (c) => {
    return c.json({ status: 'ok' })
  })

  // Rota WS: upgrade tratado pelo runtime Bun fora do Hono
  app.get('/ws/:roomId', (c) => {
    return c.text('Use WebSocket upgrade', 426)
  })

  // ---------------------------------------------------------------------------
  // Servir arquivos estaticos do web quando um middleware for injetado.
  // Em producao (single-origin), o bloco import.meta.main instancia
  // serveStatic de 'hono/bun' e passa via options.staticMiddleware.
  // Em testes (Vitest/Node), nenhum middleware e passado e este bloco
  // e ignorado, preservando o comportamento de dev.
  // ---------------------------------------------------------------------------
  if (options.staticMiddleware) {
    // Arquivos estaticos (JS, CSS, imagens, favicon, etc.)
    app.use('/*', options.staticMiddleware)
  }

  if (options.spaFallback) {
    // Fallback SPA: qualquer rota GET nao capturada pelos handlers acima
    // (ex: /room/abc) devolve o index.html para o react-router tratar.
    app.get('*', options.spaFallback)
  }

  return app
}

// ---------------------------------------------------------------------------
// Tipos para WebSocket Bun com dados de contexto
// ---------------------------------------------------------------------------

interface WsData {
  roomId: string
  _handshakeDone?: boolean
  _userId?: string
}

// Servidor Bun com WebSocket
if (import.meta.main) {
  // Em producao single-origin, STATIC_DIR aponta para o dist do Vite.
  // Importamos serveStatic de 'hono/bun' apenas aqui para nao poluir o
  // ambiente de testes Node/Vitest com APIs exclusivas do runtime Bun.
  const staticDir = process.env['STATIC_DIR']
  let staticMiddleware: MiddlewareHandler | undefined
  let spaFallback: MiddlewareHandler | undefined
  if (staticDir) {
    const { serveStatic } = await import('hono/bun')
    // Serve arquivos estaticos do dist (JS, CSS, imagens, etc.)
    staticMiddleware = serveStatic({ root: staticDir })
    // Fallback SPA: rotas de pagina como /room/abc retornam index.html
    spaFallback = serveStatic({ path: `${staticDir}/index.html` })
  }

  const app = createApp({ staticMiddleware, spaFallback })

  const server = Bun.serve<WsData>({
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
      // Limita o tamanho maximo de cada frame recebido a 64KB para
      // evitar ataques de payload gigante via WebSocket
      maxPayloadLength: 65536,

      open(ws) {
        // Handshake: aguarda primeiro frame com displayName e avatar
        ws.data._handshakeDone = false
      },
      message(ws, raw) {
        const { roomId } = ws.data

        let parsed: unknown
        try {
          parsed = JSON.parse(
            typeof raw === 'string' ? raw : new TextDecoder().decode(raw as unknown as Uint8Array)
          )
        } catch {
          return
        }

        // Handshake inicial
        if (!ws.data._handshakeDone) {
          const h = parsed as Record<string, unknown>

          // displayName: obrigatorio, string, 1..64 chars
          if (
            typeof h['displayName'] !== 'string' ||
            h['displayName'].length < 1 ||
            h['displayName'].length > DISPLAY_NAME_MAX
          ) {
            ws.close(4000, 'handshake invalido')
            return
          }

          // avatar: opcional, mas se fornecido deve ser string com ate 16 chars
          const rawAvatar = h['avatar']
          if (rawAvatar !== undefined && rawAvatar !== null) {
            if (typeof rawAvatar !== 'string' || rawAvatar.length > AVATAR_MAX) {
              ws.close(4000, 'handshake invalido')
              return
            }
          }

          const displayName = h['displayName'] as string
          const avatar = typeof rawAvatar === 'string' ? rawAvatar : '🎬'

          const userId = nanoid()
          ws.data._userId = userId
          ws.data._handshakeDone = true

          try {
            joinRoom(roomId, {
              userId,
              displayName,
              avatar,
              connectedAt: Date.now(),
              send: (event) => {
                try { ws.send(JSON.stringify(event)) } catch { /* ws fechado */ }
              },
            })
          } catch (err) {
            console.error(`[WS] joinRoom falhou para sala "${roomId}":`, err)
            ws.close(4004, 'Sala nao encontrada')
            return
          }

          // Informa ao cliente o seu proprio userId logo apos o handshake
          const welcomeEvent: WelcomeEvent = { type: 'welcome', userId }
          ws.send(JSON.stringify(welcomeEvent))

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
            displayName,
            avatar,
          }, userId)

          return
        }

        if (!isClientEvent(parsed)) return
        const event = parsed as ClientEvent
        const userId = ws.data._userId!

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
        } else if (isSetHostLockEvent(event)) {
          handleHostLock(event, roomId, userId)
        } else if (isBufferingStartEvent(event) || isBufferingEndEvent(event)) {
          // fase 2: implementar buffering wait-gate
        }
      },
      close(ws) {
        const { roomId } = ws.data
        if (ws.data._handshakeDone && ws.data._userId) {
          leaveRoom(roomId, ws.data._userId)
        }
      },
    },
  })

  console.log(`OpenParty server rodando na porta ${server.port}`)
}
