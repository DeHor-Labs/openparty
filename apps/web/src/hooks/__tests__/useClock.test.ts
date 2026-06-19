import { renderHook, act } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { useClock } from '../useClock'
import type { WsClient } from '../../lib/ws-client'

// Mock de clock.ts para controle total dos calculos de offset
vi.mock('../../lib/clock', () => ({
  computeClockOffset: vi.fn((_t1: number, _t2: number, _t3: number, _t4: number) => ({
    rtt: 10,
    offset: 50,
  })),
  selectBestOffset: vi.fn((samples: { rtt: number; offset: number }[]) =>
    samples.length > 0 ? samples[0]!.offset : 0
  ),
}))

function makeMockClient(): WsClient {
  return {
    send: vi.fn(),
    close: vi.fn(),
    get readyState() {
      return 1 // OPEN
    },
  }
}

describe('useClock', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.clearAllMocks()
  })

  it('retorna onPong como funcao no retorno do hook', () => {
    const client = makeMockClient()
    const { result } = renderHook(() => useClock(client))
    expect(typeof result.current.onPong).toBe('function')
  })

  it('nao dispara pings quando wsClient for null', () => {
    const { result } = renderHook(() => useClock(null))
    act(() => {
      vi.advanceTimersByTime(1000)
    })
    // calibrating permanece true pois nenhum ping foi enviado
    expect(result.current.calibrating).toBe(true)
  })

  it('dispara pings quando wsClient e fornecido', () => {
    const client = makeMockClient()
    renderHook(() => useClock(client))
    act(() => {
      // 8 pings a cada 80ms = 640ms
      vi.advanceTimersByTime(700)
    })
    expect(client.send).toHaveBeenCalledTimes(8)
  })

  it('pong via onPong calibra o offset e marca calibrating=false', async () => {
    const client = makeMockClient()
    const { result } = renderHook(() => useClock(client))

    // Envia 8 pings para popular pendingRef
    act(() => {
      vi.advanceTimersByTime(700)
    })

    // Simula retorno dos 8 pongs (totalPings = 8)
    await act(async () => {
      const calls = (client.send as ReturnType<typeof vi.fn>).mock.calls as Array<[{ type: string; t1: number }]>
      for (const [payload] of calls) {
        result.current.onPong(payload.t1, payload.t1 + 5, payload.t1 + 6, 8)
      }
    })

    expect(result.current.calibrating).toBe(false)
  })

  it('serverNow retorna Date.now() + offset apos calibracao', async () => {
    const now = 1_000_000
    vi.setSystemTime(now)

    const client = makeMockClient()
    const { result } = renderHook(() => useClock(client))

    act(() => {
      vi.advanceTimersByTime(700)
    })

    // Pongs com offset = 50 (valor do mock de selectBestOffset)
    await act(async () => {
      const calls = (client.send as ReturnType<typeof vi.fn>).mock.calls as Array<[{ type: string; t1: number }]>
      for (const [payload] of calls) {
        result.current.onPong(payload.t1, payload.t1 + 5, payload.t1 + 6, 8)
      }
    })

    // Reseta o tempo para um valor conhecido antes de verificar serverNow
    const checkpoint = 1_001_000
    vi.setSystemTime(checkpoint)
    expect(result.current.serverNow()).toBe(checkpoint + 50)
  })

  it('ignora pong cujo t1 nao foi registrado como ping pendente', async () => {
    const client = makeMockClient()
    const { result } = renderHook(() => useClock(client))

    // Nenhum ping enviado ainda - pong com t1 arbitrario deve ser ignorado
    await act(async () => {
      result.current.onPong(99999, 100000, 100001, 8)
    })

    // calibrating ainda true pois o pong foi descartado
    expect(result.current.calibrating).toBe(true)
  })
})
