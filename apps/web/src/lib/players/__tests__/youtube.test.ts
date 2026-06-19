// apps/web/src/lib/players/__tests__/youtube.test.ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

describe('loadYouTubeApi (via createYouTubeAdapter)', () => {
  beforeEach(() => {
    vi.useFakeTimers()

    // Limpa qualquer script do YouTube injetado por testes anteriores
    document.querySelectorAll('script[src*="youtube.com/iframe_api"]').forEach((s) => s.remove())

    // Reseta window.YT e onYouTubeIframeAPIReady
    delete (window as unknown as Record<string, unknown>).YT
    delete (window as unknown as Record<string, unknown>).onYouTubeIframeAPIReady
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.clearAllMocks()
    vi.resetModules()
  })

  it('rejeita a promise quando o script falha a carregar (onerror)', async () => {
    const { createYouTubeAdapter } = await import('../youtube')

    const container = document.createElement('div')

    // Captura estado de rejeicao sem await da promise principal (que travaria)
    let errorCaught: unknown = null
    const adapterPromise = createYouTubeAdapter(container, 'dQw4w9WgXcQ').catch((e) => {
      errorCaught = e
    })

    // Script deve ter sido injetado
    const script = document.querySelector('script[src*="youtube.com/iframe_api"]') as HTMLScriptElement
    expect(script).not.toBeNull()

    // Dispara onerror no script para simular falha de carregamento
    script.onerror?.(new Event('error'))

    // Drena microtasks
    await Promise.resolve()
    await Promise.resolve()
    await Promise.resolve()

    // Com o fix aplicado: errorCaught deve ter sido preenchido
    // Com o bug (sem onerror handler): a promise nunca rejeita, errorCaught permanece null
    expect(errorCaught).not.toBeNull()

    // Limpa promise pendente para nao vazar
    vi.advanceTimersByTime(15_000)
    await adapterPromise.catch(() => {})
  })

  it('rejeita a promise quando script ja esta no DOM mas falha (onerror no script existente)', async () => {
    // Simula o ramo: script ja no DOM, window.YT ainda nao carregou
    const existingScript = document.createElement('script')
    existingScript.src = 'https://www.youtube.com/iframe_api'
    document.head.appendChild(existingScript)
    // window.YT ausente (nao definido no beforeEach)

    const { createYouTubeAdapter } = await import('../youtube')
    const container = document.createElement('div')

    let errorCaught: unknown = null
    const adapterPromise = createYouTubeAdapter(container, 'dQw4w9WgXcQ').catch((e) => {
      errorCaught = e
    })

    // Dispara onerror no script existente
    existingScript.onerror?.(new Event('error'))

    await Promise.resolve()
    await Promise.resolve()
    await Promise.resolve()

    expect(errorCaught).not.toBeNull()

    vi.advanceTimersByTime(15_000)
    await adapterPromise.catch(() => {})
  })

  it('rejeita a promise apos YOUTUBE_API_TIMEOUT_MS se a API nao carregar', async () => {
    const { createYouTubeAdapter } = await import('../youtube')

    const container = document.createElement('div')

    let errorCaught: unknown = null
    const adapterPromise = createYouTubeAdapter(container, 'dQw4w9WgXcQ').catch((e) => {
      errorCaught = e
    })

    // Avanca tempo alem do timeout esperado (minimo 5000ms)
    vi.advanceTimersByTime(15_000)
    await Promise.resolve()
    await Promise.resolve()
    await Promise.resolve()

    // Com o fix: errorCaught deve ter sido preenchido (timeout disparou rejeicao)
    // Com o bug (sem timeout): promise nunca rejeita, errorCaught permanece null
    expect(errorCaught).not.toBeNull()

    await adapterPromise.catch(() => {})
  })
})
