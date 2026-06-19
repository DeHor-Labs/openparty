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
import { validateHandshake } from './handshake'
import { handleClockPing } from './handlers/clock'
import { handleSync } from './handlers/sync'
import { handleChat, handleReaction } from './handlers/chat'
import { handleHostLock } from './handlers/host-lock'
import { applyRateLimit, resetRateLimit } from './rate-limiter'

const MEDIA_URL_MAX = 2048

/**
 * Numero maximo de frames invalidos aceitos por conexao antes de fechar com 1002.
 * Previne abuso de parsing (loop tight de JSON malformado ou payloads invalidos).
 * Exportado para uso em testes de integracao.
 */
export const MAX_INVALID_FRAMES = 10

/** Padrao de ID do YouTube: 11 caracteres alfanumericos + _ e - */
const YOUTUBE_ID_REGEX_SERVER = /^[A-Za-z0-9_-]{11}$/

/**
 * Detecta o tipo de midia pela URL usando match exato de hostname.
 * Consistente com o cliente (apps/web/src/lib/players/index.ts):
 * nao usa includes() para evitar falsos positivos como 'evil.com/youtube.com/x'.
 * Exportado para permitir testes diretos da logica de deteccao.
 */
export function detectMediaType(url: string): 'youtube' | 'mp4' {
  // ID puro de 11 chars (sem protocolo)
  if (YOUTUBE_ID_REGEX_SERVER.test(url)) return 'youtube'

  try {
    const parsed = new URL(url)
    const hostname = parsed.hostname.toLowerCase()

    if (
      hostname === 'youtu.be' ||
      hostname === 'youtube.com' ||
      hostname === 'www.youtube.com' ||
      hostname === 'm.youtube.com' ||
      hostname === 'music.youtube.com' ||
      hostname === 'www.youtube-nocookie.com'
    ) {
      return 'youtube'
    }
  } catch {
    // url invalida: tratar como mp4
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
  /** Identificador unico da conexao para fins de rate limiting */
  _connId?: string
  /** Contador de frames invalidos (JSON malformado ou payload nao reconhecido) */
  _invalidFrames?: number
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
          // JSON malformado: incrementa contador de frames invalidos
          ws.data._invalidFrames = (ws.data._invalidFrames ?? 0) + 1
          if (ws.data._invalidFrames > MAX_INVALID_FRAMES) {
            // 1002 = Protocol Error (RFC 6455): cliente excedeu limite de frames invalidos
            ws.close(1002, 'Muitos frames invalidos')
          }
          return
        }

        // Handshake inicial
        if (!ws.data._handshakeDone) {
          // Delega validacao para handshake.ts (unica fonte de verdade da logica)
          const validation = validateHandshake(parsed)
          if (!validation.valid) {
            // 1008 = Policy Violation (RFC 6455): handshake nao atende ao contrato do protocolo
            ws.close(validation.closeCode, validation.reason)
            return
          }

          const { displayName, avatar } = validation.handshake

          const userId = nanoid()
          ws.data._userId = userId
          ws.data._connId = nanoid()
          ws.data._handshakeDone = true
          ws.data._invalidFrames = 0

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

        if (!isClientEvent(parsed)) {
          // Payload pos-handshake nao reconhecido: incrementa contador de frames invalidos
          ws.data._invalidFrames = (ws.data._invalidFrames ?? 0) + 1
          if (ws.data._invalidFrames > MAX_INVALID_FRAMES) {
            ws.close(1002, 'Muitos frames invalidos')
          }
          return
        }
        const event = parsed as ClientEvent
        const userId = ws.data._userId!
        const connId = ws.data._connId!
        const agora = Date.now()

        if (isClockPingEvent(event)) {
          // Rate limit generoso para clock-ping: pings sao frequentes mas nao ilimitados
          if (applyRateLimit(connId, 'clock-ping', agora)) {
            const room = getRoom(roomId)
            const client = room?.clients.get(userId)
            if (client) handleClockPing(event, client)
          }
        } else if (isSeekClientEvent(event)) {
          // Rate limit para seek: descarta silenciosamente se excedido
          if (applyRateLimit(connId, 'seek', agora)) {
            handleSync(event, roomId, userId)
          }
        } else if (isPlayClientEvent(event) || isPauseClientEvent(event)) {
          // Rate limit unificado para playback: evita bypass alternando play <-> pause
          if (applyRateLimit(connId, 'playback', agora)) {
            handleSync(event, roomId, userId)
          }
        } else if (isChatClientEvent(event)) {
          // Rate limit para chat: descarta silenciosamente se excedido
          if (applyRateLimit(connId, 'chat', agora)) {
            handleChat(event, roomId, userId)
          }
        } else if (isReactionClientEvent(event)) {
          // Rate limit para reacao: descarta silenciosamente se excedido
          if (applyRateLimit(connId, 'reaction', agora)) {
            handleReaction(event, roomId, userId)
          }
        } else if (isSetHostLockEvent(event)) {
          // Rate limit para host-lock: broadcast amplifica para N clientes
          if (applyRateLimit(connId, 'host-lock', agora)) {
            handleHostLock(event, roomId, userId)
          }
        } else if (isBufferingStartEvent(event) || isBufferingEndEvent(event)) {
          // fase 2: implementar buffering wait-gate
        }
      },
      close(ws) {
        const { roomId } = ws.data
        if (ws.data._handshakeDone && ws.data._userId) {
          leaveRoom(roomId, ws.data._userId)
          // Libera o contador de rate limiting da conexao encerrada
          if (ws.data._connId) {
            resetRateLimit(ws.data._connId)
          }
        }
        // Limpa o contador de frames invalidos
        ws.data._invalidFrames = 0
      },
    },
  })

  console.log(`OpenParty server rodando na porta ${server.port}`)
}
