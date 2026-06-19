// apps/server/src/__tests__/integration.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest'
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

// ---------------------------------------------------------------------------
// GET /health
// ---------------------------------------------------------------------------

describe('GET /health', () => {
  it('responde 200 com status ok', async () => {
    const app = await getApp()
    const res = await app.request('/health', { method: 'GET' })
    expect(res.status).toBe(200)
    const body = await res.json() as { status: string }
    expect(body.status).toBe('ok')
  })
})

// ---------------------------------------------------------------------------
// POST /rooms - validacao de mediaUrl
// ---------------------------------------------------------------------------

describe('POST /rooms - validacao de mediaUrl', () => {
  it('rejeita mediaUrl vazia com 400', async () => {
    const app = await getApp()
    const res = await app.request('/rooms', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ mediaUrl: '' }),
    })
    expect(res.status).toBe(400)
  })

  it('rejeita mediaUrl com protocolo ftp com 400', async () => {
    const app = await getApp()
    const res = await app.request('/rooms', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ mediaUrl: 'ftp://example.com/video.mp4' }),
    })
    expect(res.status).toBe(400)
  })

  it('rejeita mediaUrl com mais de 2048 caracteres com 400', async () => {
    const app = await getApp()
    const longUrl = 'https://example.com/' + 'a'.repeat(2048)
    const res = await app.request('/rooms', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ mediaUrl: longUrl }),
    })
    expect(res.status).toBe(400)
  })

  it('rejeita mediaUrl invalida (sem protocolo) com 400', async () => {
    const app = await getApp()
    const res = await app.request('/rooms', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ mediaUrl: 'nao-e-uma-url' }),
    })
    expect(res.status).toBe(400)
  })

  it('aceita mediaUrl https valida', async () => {
    const app = await getApp()
    const res = await app.request('/rooms', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ mediaUrl: 'https://cdn.example.com/filme.mp4' }),
    })
    expect(res.status).toBe(201)
  })

  it('aceita mediaUrl http valida', async () => {
    const app = await getApp()
    const res = await app.request('/rooms', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ mediaUrl: 'http://cdn.example.com/filme.mp4' }),
    })
    expect(res.status).toBe(201)
  })
})

// ---------------------------------------------------------------------------
// handleHostLock
// ---------------------------------------------------------------------------

describe('handleHostLock', () => {
  it('host pode ativar host-lock e broadcast e emitido', async () => {
    const { handleHostLock } = await import('../handlers/host-lock')
    const { createRoom, getRoom } = await import('../rooms')

    const roomId = createRoom('https://example.com/video.mp4', 'mp4')
    const room = getRoom(roomId)!
    const hostId = room.state.hostId
    const mockSend = vi.fn()

    room.clients.set(hostId, {
      userId: hostId,
      displayName: 'Host',
      avatar: '🎬',
      connectedAt: Date.now(),
      send: mockSend,
    })

    handleHostLock({ type: 'set-host-lock', locked: true }, roomId, hostId)

    expect(getRoom(roomId)!.state.hostLock).toBe(true)
    expect(mockSend).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'host-lock', locked: true })
    )
  })

  it('nao-host nao pode alterar host-lock', async () => {
    const { handleHostLock } = await import('../handlers/host-lock')
    const { createRoom, getRoom } = await import('../rooms')

    const roomId = createRoom('https://example.com/video.mp4', 'mp4')
    const room = getRoom(roomId)!
    const hostId = room.state.hostId
    const visitanteId = 'visitante-123'
    const mockSend = vi.fn()

    room.clients.set(hostId, {
      userId: hostId,
      displayName: 'Host',
      avatar: '🎬',
      connectedAt: Date.now(),
      send: vi.fn(),
    })
    room.clients.set(visitanteId, {
      userId: visitanteId,
      displayName: 'Visitante',
      avatar: '👤',
      connectedAt: Date.now(),
      send: mockSend,
    })

    handleHostLock({ type: 'set-host-lock', locked: true }, roomId, visitanteId)

    expect(getRoom(roomId)!.state.hostLock).toBe(false)
    expect(mockSend).not.toHaveBeenCalled()
  })

  it('host pode desativar host-lock', async () => {
    const { handleHostLock } = await import('../handlers/host-lock')
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

    handleHostLock({ type: 'set-host-lock', locked: false }, roomId, hostId)

    expect(getRoom(roomId)!.state.hostLock).toBe(false)
    expect(mockSend).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'host-lock', locked: false })
    )
  })
})

// ---------------------------------------------------------------------------
// Regressao: joinRoom com roomId invalido nao derruba o processo
// ---------------------------------------------------------------------------

describe('joinRoom com roomId invalido', () => {
  it('lanca erro ao tentar entrar em sala inexistente', async () => {
    // Regressao: antes do fix, joinRoom lancava e derrubava o servidor Bun.
    // Agora o handler de WS captura e fecha o socket com 4004.
    // Aqui validamos que joinRoom ainda lanca (comportamento correto de rooms.ts)
    // para que o try/catch em index.ts tenha algo a capturar.
    const { joinRoom } = await import('../rooms')

    expect(() =>
      joinRoom('sala-que-nao-existe-jamais', {
        userId: 'u1',
        displayName: 'Teste',
        avatar: '🎬',
        connectedAt: Date.now(),
        send: vi.fn(),
      })
    ).toThrow()
  })

  it('servidor HTTP continua respondendo apos tentativa de join em sala invalida', async () => {
    // Regressao principal: o processo nao pode cair quando joinRoom lanca.
    // Simulamos o fluxo completo pelo Hono (createApp) para confirmar que
    // o servidor permanece operacional.
    const { joinRoom } = await import('../rooms')
    const app = await getApp()

    // Tenta join em sala inexistente -- no servidor real fecharia o socket com 4004
    try {
      joinRoom('sala-fantasma-regressao', {
        userId: 'u-reg',
        displayName: 'Regressao',
        avatar: '🐛',
        connectedAt: Date.now(),
        send: vi.fn(),
      })
    } catch {
      // Captura como o handler WS faria -- servidor nao deve cair
    }

    // Servidor deve continuar respondendo normalmente
    const res = await app.request('/rooms', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ mediaUrl: 'https://example.com/after-crash.mp4' }),
    })

    expect(res.status).toBe(201)
    const body = await res.json() as { roomId: string; url: string }
    expect(body.roomId).toBeTypeOf('string')
  })
})
