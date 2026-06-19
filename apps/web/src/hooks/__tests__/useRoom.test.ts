import { renderHook, act } from '@testing-library/react'
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import { useRoom } from '../useRoom'
import type { WsClient, WsClientOptions } from '../../lib/ws-client'
import type { ServerEvent, RoomState } from '@openparty/protocol'

// Mock de createWsClient: captura opcoes completas para assertivas de regressao
let capturedOnEvent: ((event: ServerEvent) => void) | null = null
let capturedOptions: WsClientOptions | null = null
let mockSend: ReturnType<typeof vi.fn>
let mockClose: ReturnType<typeof vi.fn>

vi.mock('../../lib/ws-client', () => ({
  createWsClient: (opts: WsClientOptions) => {
    capturedOnEvent = opts.onEvent
    capturedOptions = opts
    mockSend = vi.fn()
    mockClose = vi.fn()
    // Simular onOpen de forma sincrona para evitar tasks pendentes apos teardown
    opts.onOpen?.()
    return {
      send: mockSend,
      close: mockClose,
      get readyState() { return 1 },
    } satisfies WsClient
  },
}))

// Mock de useClock: retorna serverNow = Date.now(), calibrating=false e onPong como fn
const mockOnPong = vi.fn()
vi.mock('../useClock', () => ({
  useClock: () => ({
    serverNow: () => Date.now(),
    calibrating: false,
    onPong: mockOnPong,
  }),
}))

// Mock de useSync: nao faz nada (logica de sync testada separadamente)
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
    capturedOptions = null
    mockOnPong.mockClear()
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
    expect(result.current.localUserId).toBeNull()
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

  it('armazena localUserId ao receber evento welcome', async () => {
    const { result } = renderHook(() =>
      useRoom('room-1', { displayName: 'Nikolas', avatar: '🎬' })
    )

    await act(async () => {
      capturedOnEvent?.({ type: 'welcome', userId: 'user-abc' })
    })

    expect(result.current.localUserId).toBe('user-abc')
  })

  it('atualiza hostLock ao receber evento host-lock', async () => {
    const { result } = renderHook(() =>
      useRoom('room-1', { displayName: 'Nikolas', avatar: '🎬' })
    )

    await act(async () => {
      capturedOnEvent?.({
        type: 'room-state',
        ...BASE_ROOM_STATE,
        hostLock: false,
        peers: [],
      })
      capturedOnEvent?.({ type: 'host-lock', locked: true })
    })

    expect(result.current.roomState?.hostLock).toBe(true)
  })

  it('roteia clock-pong para onPong de useClock', async () => {
    renderHook(() =>
      useRoom('room-1', { displayName: 'Nikolas', avatar: '🎬' })
    )

    await act(async () => {
      capturedOnEvent?.({
        type: 'clock-pong',
        t1: 1000,
        t2: 1010,
        t3: 1011,
      })
    })

    expect(mockOnPong).toHaveBeenCalledWith(1000, 1010, 1011, 8)
  })

  it('sendSetHostLock envia evento set-host-lock para o servidor', async () => {
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
      result.current.sendSetHostLock(true)
    })

    expect(mockSend).toHaveBeenCalledWith({ type: 'set-host-lock', locked: true })
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

  it('limita messages a 200 itens mais recentes', async () => {
    const { result } = renderHook(() =>
      useRoom('room-1', { displayName: 'Nikolas', avatar: '🎬' })
    )

    await act(async () => {
      capturedOnEvent?.({ type: 'room-state', ...BASE_ROOM_STATE, peers: [] })
      // Envia 205 mensagens
      for (let i = 0; i < 205; i++) {
        capturedOnEvent?.({
          type: 'chat',
          userId: 'u1',
          displayName: 'X',
          text: `msg-${i}`,
          ts: i,
        })
      }
    })

    expect(result.current.messages).toHaveLength(200)
    // Garante que sao as 200 mais recentes (msg-5 em diante)
    expect(result.current.messages[0].text).toBe('msg-5')
    expect(result.current.messages[199].text).toBe('msg-204')
  })

  it('limita reactions a 200 itens mais recentes', async () => {
    const { result } = renderHook(() =>
      useRoom('room-1', { displayName: 'Nikolas', avatar: '🎬' })
    )

    await act(async () => {
      capturedOnEvent?.({ type: 'room-state', ...BASE_ROOM_STATE, peers: [] })
      for (let i = 0; i < 205; i++) {
        capturedOnEvent?.({
          type: 'reaction',
          userId: 'u1',
          emoji: '🔥',
          ts: i,
        })
      }
    })

    expect(result.current.reactions).toHaveLength(200)
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

  // --- Testes de regressao: handshake e URL ---

  it('passa handshake com displayName e avatar para createWsClient', () => {
    renderHook(() =>
      useRoom('room-1', { displayName: 'Nikolas', avatar: '🎬' })
    )

    expect(capturedOptions?.handshake).toEqual({
      displayName: 'Nikolas',
      avatar: '🎬',
    })
  })

  it('usa caminho relativo /ws/<roomId> quando VITE_SERVER_URL nao esta definida', () => {
    renderHook(() =>
      useRoom('sala-abc', { displayName: 'Nikolas', avatar: '🎬' })
    )

    expect(capturedOptions?.url).toBe('/ws/sala-abc')
  })

  it('usa VITE_SERVER_URL para construir wsUrl quando definida', () => {
    vi.stubEnv('VITE_SERVER_URL', 'http://server.example.com:3000')

    renderHook(() =>
      useRoom('sala-xyz', { displayName: 'Nikolas', avatar: '🎬' })
    )

    expect(capturedOptions?.url).toBe('ws://server.example.com:3000/ws/sala-xyz')

    vi.unstubAllEnvs()
  })
})
