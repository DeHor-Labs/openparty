import { renderHook } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { useSync } from '../useSync'
import type { RoomState } from '@openparty/protocol'
import type { PlayerAdapter } from '../../lib/players/index'

function makeRoomState(overrides: Partial<RoomState> = {}): RoomState {
  return {
    roomId: 'r1',
    mediaUrl: 'https://example.com/video.mp4',
    mediaType: 'mp4',
    playing: true,
    positionSecs: 10,
    lastEventAt: Date.now() - 1000, // 1 segundo atras
    playbackRate: 1.0,
    hostId: 'u1',
    hostLock: false,
    ...overrides,
  }
}

function makeAdapter(currentTime = 10.0): PlayerAdapter {
  return {
    play: vi.fn().mockResolvedValue(undefined),
    pause: vi.fn().mockResolvedValue(undefined),
    seekTo: vi.fn().mockResolvedValue(undefined),
    getCurrentTime: vi.fn(() => currentTime),
    setPlaybackRate: vi.fn(),
    on: vi.fn(),
    off: vi.fn(),
    destroy: vi.fn(),
  }
}

describe('useSync', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.clearAllMocks()
  })

  it('nao faz nada quando roomState e null', () => {
    const adapter = makeAdapter()
    renderHook(() => useSync(null, adapter, Date.now))
    vi.advanceTimersByTime(2000)
    expect(adapter.setPlaybackRate).not.toHaveBeenCalled()
  })

  it('nao faz nada quando playing e false', () => {
    const adapter = makeAdapter()
    const state = makeRoomState({ playing: false })
    renderHook(() => useSync(state, adapter, Date.now))
    vi.advanceTimersByTime(2000)
    expect(adapter.setPlaybackRate).not.toHaveBeenCalled()
  })

  it('ao decidir ignore, reseta taxa para roomState.playbackRate', () => {
    // currentTime = 10.0, esperado ~11.0 (1s elapsed * rate 1.0) -> drift = -1.0 -> seek
    // Para testar ignore: drift < 0.3s
    // lastEventAt = agora, positionSecs = 10, currentTime = 10.1 -> drift = 0.1 -> ignore
    const now = Date.now()
    const serverNow = vi.fn(() => now)
    const state = makeRoomState({
      positionSecs: 10,
      lastEventAt: now, // sem elapsed
      playbackRate: 1.0,
    })
    const adapter = makeAdapter(10.1) // drift = 0.1 < 0.3 -> ignore

    renderHook(() => useSync(state, adapter, serverNow))
    vi.advanceTimersByTime(1500)

    // Deve ter chamado setPlaybackRate(1.0) para resetar apos o ignore
    expect(adapter.setPlaybackRate).toHaveBeenCalledWith(1.0)
  })

  it('ao decidir adjust-rate, chama setPlaybackRate com taxa ajustada', () => {
    // drift de ~0.4s (cliente atrasado): currentTime = 10.0, expected = 10.4
    const now = Date.now()
    const serverNow = vi.fn(() => now)
    const state = makeRoomState({
      positionSecs: 10.4,
      lastEventAt: now,
      playbackRate: 1.0,
      mediaType: 'mp4',
    })
    const adapter = makeAdapter(10.0) // drift = -0.4 -> adjust-rate

    renderHook(() => useSync(state, adapter, serverNow))
    vi.advanceTimersByTime(1500)

    const calls = (adapter.setPlaybackRate as ReturnType<typeof vi.fn>).mock.calls
    expect(calls.length).toBeGreaterThan(0)
    const rate = calls[0]![0] as number
    expect(rate).toBeGreaterThan(1.0) // acelerando para recuperar atraso
  })

  it('ao decidir seek, chama seekTo com posicao esperada', () => {
    // drift de 2s: currentTime = 10, expected = 12
    const now = Date.now()
    const serverNow = vi.fn(() => now)
    const state = makeRoomState({
      positionSecs: 12,
      lastEventAt: now,
      playbackRate: 1.0,
    })
    const adapter = makeAdapter(10.0)

    renderHook(() => useSync(state, adapter, serverNow))
    vi.advanceTimersByTime(1500)

    expect(adapter.seekTo).toHaveBeenCalledWith(12)
  })
})
