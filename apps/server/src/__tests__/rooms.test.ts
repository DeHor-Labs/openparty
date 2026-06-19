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
