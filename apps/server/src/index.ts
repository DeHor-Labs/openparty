// apps/server/src/index.ts
import { Hono } from 'hono'
import { cors } from 'hono/cors'
import type { Context, MiddlewareHandler } from 'hono'
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

const SITE_URL = 'https://openparty.dehor.com.br'

/**
 * Rotas client-side reais do react-router (apps/web/src/App.tsx).
 * Qualquer caminho fora desta lista que nao seja um arquivo estatico existente
 * recebe 404 real (ver renderNotFound), em vez do soft-404 do fallback SPA.
 */
const CLIENT_ROUTE_PATTERNS: RegExp[] = [/^\/$/, /^\/room\/[^/]+$/]

export function isKnownClientRoute(pathname: string): boolean {
  return CLIENT_ROUTE_PATTERNS.some((pattern) => pattern.test(pathname))
}

function acceptsMarkdown(accept: string | undefined | null): boolean {
  if (!accept) return false
  const raw = accept
  if (!raw.includes('text/markdown')) return false

  function getQ(mime: string): number {
    const parts = raw.split(',')
    for (const part of parts) {
      const [type, ...params] = part.trim().split(';')
      if (type.trim() === mime) {
        for (const p of params) {
          const [k, v] = p.trim().split('=')
          if (k.trim() === 'q') {
            const val = parseFloat(v)
            return isNaN(val) ? 1.0 : val
          }
        }
        return 1.0
      }
    }
    return -1
  }

  const qMarkdown = getQ('text/markdown')
  if (qMarkdown <= 0) return false

  const qHtml = getQ('text/html')
  if (qHtml >= 0 && qHtml > qMarkdown) return false

  return true
}

const NOT_FOUND_MARKDOWN = `# Página não encontrada (404)

O endereço solicitado não existe no OpenParty.

- [Início](${SITE_URL}/)
- [Guia para agentes](${SITE_URL}/llms.txt)
- [Mapa em markdown](${SITE_URL}/index.md)
- [Sitemap](${SITE_URL}/sitemap.xml)
`

const NOT_FOUND_HTML = `<!doctype html>
<html lang="pt-BR">
<head>
<meta charset="utf-8">
<title>Página não encontrada | OpenParty</title>
<meta name="robots" content="noindex">
</head>
<body>
<h1>Página não encontrada</h1>
<p>O endereço solicitado não existe no OpenParty.</p>
<ul>
<li><a href="/">Início</a></li>
<li><a href="/llms.txt">Guia para agentes</a></li>
<li><a href="/index.md">Mapa em markdown</a></li>
<li><a href="/sitemap.xml">Sitemap</a></li>
</ul>
</body>
</html>`

/**
 * 404 real (nunca 200) para paths desconhecidos, com corpo negociado por Accept:
 * application/problem+json, text/html ou text/markdown (padrao). Cache curto
 * em vez de no-store para nao forcar a funcao a rodar em toda varredura de bot.
 */
export function renderNotFound(c: Context): Response {
  const accept = c.req.header('accept') ?? ''
  c.header('Vary', 'Accept')
  c.header('Cache-Control', 'public, max-age=60, s-maxage=300')
  c.header('X-Robots-Tag', 'noindex')
  c.header(
    'Link',
    '</sitemap.xml>; rel="sitemap"; type="application/xml", </index.md>; rel="alternate"; type="text/markdown", </llms.txt>; rel="describedby"; type="text/plain"'
  )

  if (/application\/json/i.test(accept) || /application\/problem\+json/i.test(accept)) {
    return c.body(
      JSON.stringify({
        type: 'about:blank',
        title: 'Not Found',
        status: 404,
        detail: 'O endereço solicitado não existe no OpenParty.',
        links: {
          home: `${SITE_URL}/`,
          markdown: `${SITE_URL}/index.md`,
          llms: `${SITE_URL}/llms.txt`,
          sitemap: `${SITE_URL}/sitemap.xml`,
        },
      }),
      404,
      { 'Content-Type': 'application/problem+json; charset=utf-8' }
    )
  }

  if (/text\/html/i.test(accept)) {
    return c.html(NOT_FOUND_HTML, 404)
  }

  return c.body(NOT_FOUND_MARKDOWN, 404, { 'Content-Type': 'text/markdown; charset=utf-8' })
}

/**
 * Handler de GET / com negociacao de conteudo: markdown para agentes que pedem
 * Accept: text/markdown (acceptmarkdown.com), HTML estatico (com Link para
 * sitemap/index.md/llms.txt) para o resto. `indexHtml`/`indexMd` sao lidos uma
 * unica vez na subida do servidor (ver bloco import.meta.main).
 */
export function createHomeMiddleware(indexHtml: string, indexMd: string): MiddlewareHandler {
  return async (c) => {
    c.header('Vary', 'Accept')
    if (indexMd && acceptsMarkdown(c.req.header('accept'))) {
      c.header('Link', `<${SITE_URL}/>; rel="canonical"; type="text/html"`)
      return c.body(indexMd, 200, { 'Content-Type': 'text/markdown; charset=utf-8' })
    }
    c.header(
      'Link',
      '</sitemap.xml>; rel="sitemap"; type="application/xml", </index.md>; rel="alternate"; type="text/markdown", </llms.txt>; rel="describedby"; type="text/plain"'
    )
    return c.html(indexHtml)
  }
}

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
 * staticMiddleware: serve arquivos do dist do Vite (JS, CSS, imagens, public/*).
 * spaFallback: serve index.html para as rotas client-side conhecidas (react-router).
 * homeMiddleware: GET / com negociacao Accept (markdown para agentes, HTML com Link para o resto).
 * Todos sao injetados apenas em producao (runtime Bun) para nao poluir
 * o ambiente de testes Node/Vitest, onde Bun nao existe.
 */
export interface CreateAppOptions {
  staticMiddleware?: MiddlewareHandler
  spaFallback?: MiddlewareHandler
  homeMiddleware?: MiddlewareHandler
}

export function createApp(options: CreateAppOptions = {}) {
  const app = new Hono()

  // CORS configuravel via variavel de ambiente.
  // Em self-host ou desenvolvimento: ALLOWED_ORIGIN nao definida => '*' (permissivo).
  // Em producao: definir ALLOWED_ORIGIN com a origem exata do frontend.
  app.use('*', cors({ origin: process.env['ALLOWED_ORIGIN'] ?? '*' }))

  // Headers de seguranca HTTP
  app.use('*', async (c, next) => {
    await next()
    c.header('Strict-Transport-Security', 'max-age=31536000; includeSubDomains')
    c.header('X-Frame-Options', 'SAMEORIGIN')
    c.header('X-Content-Type-Options', 'nosniff')
    c.header('Referrer-Policy', 'strict-origin-when-cross-origin')
    c.header(
      'Content-Security-Policy',
      "default-src 'self'; script-src 'self' 'unsafe-inline' https:; style-src 'self' 'unsafe-inline'; img-src 'self' data: https: blob:; connect-src 'self' wss: ws: https:; font-src 'self' data:; media-src 'self' https: blob:; frame-src 'self' https://www.youtube.com https://www.youtube-nocookie.com; base-uri 'self'; object-src 'none'"
    )
  })

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
  if (options.homeMiddleware) {
    // GET / com negociacao de Accept, registrado ANTES do static middleware
    // para poder responder markdown a agentes antes que o arquivo index.html
    // seja servido cru.
    app.get('/', options.homeMiddleware)
  }

  if (options.staticMiddleware) {
    // Arquivos estaticos (JS, CSS, imagens, favicon, public/*, etc.)
    app.use('/*', options.staticMiddleware)
  }

  if (options.spaFallback) {
    // Qualquer rota GET nao capturada pelos handlers acima: se for uma rota
    // client-side conhecida do react-router (ex: /room/abc), devolve o
    // index.html; qualquer outro caminho recebe 404 real (nunca soft-404).
    app.get('*', async (c, next) => {
      const pathname = new URL(c.req.url).pathname
      if (isKnownClientRoute(pathname)) {
        const res = await options.spaFallback!(c, next)
        return res ?? renderNotFound(c)
      }
      return renderNotFound(c)
    })
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
  let homeMiddleware: MiddlewareHandler | undefined
  if (staticDir) {
    const { serveStatic } = await import('hono/bun')
    // Serve arquivos estaticos do dist (JS, CSS, imagens, public/*, etc.).
    // mimes.md corrige o Content-Type de /index.md, que o hono nao reconhece por padrao.
    staticMiddleware = serveStatic({ root: staticDir, mimes: { md: 'text/markdown; charset=utf-8' } })
    // Fallback SPA: rotas client-side conhecidas (ex: /room/abc) retornam index.html
    spaFallback = serveStatic({ path: `${staticDir}/index.html` })

    // Lidos uma unica vez na subida: usados pela negociacao de conteudo de GET /.
    const indexHtml = await Bun.file(`${staticDir}/index.html`).text()
    const indexMd = await Bun.file(`${staticDir}/index.md`).text().catch(() => '')
    homeMiddleware = createHomeMiddleware(indexHtml, indexMd)
  }

  const app = createApp({ staticMiddleware, spaFallback, homeMiddleware })

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
