// apps/server/src/index.ts
import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { nanoid } from 'nanoid'
import type {
  ClientEvent,
  RoomStateEvent,
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
} from '@openparty/protocol'
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
  const app = createApp()

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
          const h = parsed as { displayName?: string; avatar?: string }
          if (!h.displayName) return

          const userId = nanoid()
          ws.data._userId = userId
          ws.data._handshakeDone = true

          try {
            joinRoom(roomId, {
              userId,
              displayName: h.displayName,
              avatar: h.avatar ?? '🎬',
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
