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
