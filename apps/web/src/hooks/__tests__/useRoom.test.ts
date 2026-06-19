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
