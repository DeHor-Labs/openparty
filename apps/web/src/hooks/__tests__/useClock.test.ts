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
    // Cada ping deve incluir totalPings=8 (calibracao inicial)
    const calls = (client.send as ReturnType<typeof vi.fn>).mock.calls as Array<[{ type: string; t1: number; totalPings: number }]>
    for (const [payload] of calls) {
      expect(payload.totalPings).toBe(8)
    }
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

  it('pong perdido nao trava: pings antigos sao removidos de pendentes apos PING_PONG_TIMEOUT_MS', async () => {
    // BUG: pings sem pong ficam em pendingRef indefinidamente, vazando memoria.
    // FIX: cada ping deve ter um timeout que o remove de pendingRef se o pong nao chegar.
    //
    // Para testar isso: enviamos 1 ping, esperamos que o timeout o expire,
    // depois enviamos pong com totalPings=1 (seria suficiente para concluir calibracao).
    // Se o ping foi removido, o pong sera ignorado e calibrating permanece true.
    // Se o ping NAO foi removido (bug), o pong seria aceito e calibrating viraria false.
    const client = makeMockClient()
    const { result } = renderHook(() => useClock(client))

    // Avanca apenas 80ms: apenas 1 ping enviado
    act(() => {
      vi.advanceTimersByTime(80)
    })
    const calls = (client.send as ReturnType<typeof vi.fn>).mock.calls as Array<[{ type: string; t1: number }]>
    expect(calls.length).toBeGreaterThanOrEqual(1)
    const firstT1 = calls[0]![0].t1

    // Avanca exatamente alem do PING_PONG_TIMEOUT_MS (2000ms) + 1ms para garantir expiracao.
    // Limpa timers colaterais (pings subsequentes) antes do onPong para isolar o assert.
    act(() => {
      vi.advanceTimersByTime(2001)
    })
    vi.clearAllTimers()

    // Pong tardio com totalPings=1 - se ping expirou, deve ser ignorado
    await act(async () => {
      result.current.onPong(firstT1, firstT1 + 5, firstT1 + 6, 1)
    })

    // calibrating deve ser true: pong foi ignorado porque ping expirou
    // (se fosse aceito, calibrating viraria false com totalPings=1)
    expect(result.current.calibrating).toBe(true)
  })

  it('cleanup completo: sem timers ativos apos unmount', () => {
    const client = makeMockClient()
    const { unmount } = renderHook(() => useClock(client))

    act(() => {
      vi.advanceTimersByTime(700)
    })

    // Desmonta o hook - nao deve lancar excecao nem ter timers pendentes
    expect(() => unmount()).not.toThrow()

    // Apos unmount, avancando tempo nao deve mais disparar sends
    const countBefore = (client.send as ReturnType<typeof vi.fn>).mock.calls.length
    act(() => {
      vi.advanceTimersByTime(5000)
    })
    const countAfter = (client.send as ReturnType<typeof vi.fn>).mock.calls.length
    expect(countAfter).toBe(countBefore)
  })

  // ---------------------------------------------------------------------------
  // Item 7: timeout armado somente quando socket esta OPEN
  // ---------------------------------------------------------------------------

  it('nao arma timeout de expiracao se socket nao esta OPEN (readyState != 1)', () => {
    // Simula cliente cujo socket ainda nao abriu (readyState = 0 = CONNECTING)
    const closedClient: WsClient = {
      send: vi.fn(),
      close: vi.fn(),
      get readyState() { return 0 }, // CONNECTING
    }

    const { result } = renderHook(() => useClock(closedClient))

    // Avanca tempo suficiente para que o interval disparasse pings
    act(() => {
      vi.advanceTimersByTime(700)
    })

    // Como o socket nao esta OPEN, nenhum ping deve ter sido enviado
    expect(closedClient.send).not.toHaveBeenCalled()
    // calibrating deve permanecer true
    expect(result.current.calibrating).toBe(true)
  })

  // ---------------------------------------------------------------------------
  // Item 8: timeout de calibracao conclui mesmo com pongs perdidos
  // ---------------------------------------------------------------------------

  it('conclui calibracao via timeout quando pongs sao perdidos (MIN_SAMPLES_TO_CALIBRATE)', async () => {
    // O timeout de calibracao e INITIAL_PINGS * PING_INTERVAL_MS * 2 + PING_PONG_TIMEOUT_MS + 500
    // = 8 * 80 * 2 + 2000 + 500 = 3780ms
    const client = makeMockClient()
    const { result } = renderHook(() => useClock(client))

    // Envia apenas 3 pings (MIN_SAMPLES_TO_CALIBRATE) e responde com pongs
    act(() => {
      vi.advanceTimersByTime(3 * 80) // 3 pings
    })
    const calls = (client.send as ReturnType<typeof vi.fn>).mock.calls as Array<[{ type: string; t1: number }]>
    expect(calls.length).toBeGreaterThanOrEqual(3)

    // Responde apenas os 3 primeiros pongs (simula perda dos demais)
    await act(async () => {
      for (let i = 0; i < 3; i++) {
        result.current.onPong(calls[i]![0].t1, calls[i]![0].t1 + 5, calls[i]![0].t1 + 6, 8)
      }
    })

    // Com apenas 3 amostras, nao atingiu totalPings=8 ainda; calibrating ainda true
    expect(result.current.calibrating).toBe(true)

    // Avanca alem do CALIBRATION_TIMEOUT_MS (3780ms, so precisa do restante)
    act(() => {
      vi.advanceTimersByTime(4000)
    })

    // Apos o timeout, com MIN_SAMPLES_TO_CALIBRATE (3) amostras, deve ter concluido
    expect(result.current.calibrating).toBe(false)
  })

  // ---------------------------------------------------------------------------
  // Item 9: inner setInterval da recalibracao e limpo no unmount
  // ---------------------------------------------------------------------------

  it('inner interval da recalibracao e limpo se componente desmonta no meio da rajada', async () => {
    const client = makeMockClient()
    const { result, unmount } = renderHook(() => useClock(client))

    // Conclui a calibracao inicial rapidamente
    act(() => { vi.advanceTimersByTime(700) })
    await act(async () => {
      const calls = (client.send as ReturnType<typeof vi.fn>).mock.calls as Array<[{ type: string; t1: number }]>
      for (const [payload] of calls) {
        result.current.onPong(payload.t1, payload.t1 + 5, payload.t1 + 6, 8)
      }
    })
    expect(result.current.calibrating).toBe(false)

    // Limpa mock de send para contar apenas os pings da recalibracao
    ;(client.send as ReturnType<typeof vi.fn>).mockClear()

    // Avanca ate iniciar a recalibracao (RECALIBRATE_INTERVAL_MS = 60000ms)
    act(() => { vi.advanceTimersByTime(60_000) })

    // Desmonta no meio da rajada de recalibracao (inner interval ativo)
    expect(() => unmount()).not.toThrow()

    // Apos unmount, avancando mais tempo nao deve gerar pings extras
    const countBefore = (client.send as ReturnType<typeof vi.fn>).mock.calls.length
    act(() => { vi.advanceTimersByTime(5_000) })
    const countAfter = (client.send as ReturnType<typeof vi.fn>).mock.calls.length
    expect(countAfter).toBe(countBefore)
  })
})
