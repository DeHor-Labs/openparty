// tests/adapters/disney.test.ts
// Testes unitarios para o adapter do Disney+.
// Usa mock de HTMLVideoElement para nao depender do DOM real.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

// ---------------------------------------------------------------------------
// Mock de HTMLVideoElement
// ---------------------------------------------------------------------------

function criarMockVideo(overrides: Partial<HTMLVideoElement> = {}): HTMLVideoElement {
  const listeners: Record<string, EventListener[]> = {}

  const video = {
    currentTime: 0,
    duration: 3600,
    paused: true,
    readyState: 4, // HAVE_ENOUGH_DATA
    offsetWidth: 1280,
    offsetHeight: 720,
    play: vi.fn().mockResolvedValue(undefined) as () => Promise<void>,
    pause: vi.fn() as () => void,
    addEventListener: vi.fn((event: string, handler: EventListener) => {
      if (!listeners[event]) listeners[event] = []
      listeners[event].push(handler)
    }),
    removeEventListener: vi.fn((event: string, handler: EventListener) => {
      if (listeners[event]) {
        listeners[event] = listeners[event].filter((h) => h !== handler)
      }
    }),
    // checkVisibility necessaria para a heuristica de selecao do Disney+
    checkVisibility: vi.fn(() => true),
    // getBoundingClientRect necessaria para a validacao de area
    getBoundingClientRect: vi.fn(() => ({
      width: 1280,
      height: 720,
      top: 0,
      left: 0,
      right: 1280,
      bottom: 720,
      x: 0,
      y: 0,
      toJSON: vi.fn(),
    })),
    // Utilitario de teste para disparar eventos nativos
    _dispatchEvent: (event: string) => {
      for (const handler of listeners[event] ?? []) {
        handler(new Event(event))
      }
    },
    _listeners: listeners,
    ...overrides,
  } as unknown as HTMLVideoElement

  return video
}

// ---------------------------------------------------------------------------
// Helpers para mockar o document sem anuncio / com anuncio
// ---------------------------------------------------------------------------

/**
 * Configura document.querySelector/querySelectorAll para retornar o video
 * fornecido e nenhum elemento de UI de anuncio.
 */
function configurarDocumentoSemAd(videoEl: HTMLVideoElement): void {
  vi.spyOn(document, 'querySelector').mockImplementation((selector: string) => {
    if (selector === 'video') return videoEl as unknown as Element
    // Nenhum elemento de anuncio presente
    return null
  })
  vi.spyOn(document, 'querySelectorAll').mockImplementation((selector: string) => {
    if (selector === 'video') return [videoEl] as unknown as NodeListOf<Element>
    return [] as unknown as NodeListOf<Element>
  })
}

/**
 * Cria um elemento DOM visivel (getClientRects nao-vazio) para simular
 * UI de anuncio. Necessario para passar pelo filtro elementoVisivel() (CR-MAJOR).
 */
function criarElementoAdVisivel(): Element {
  const el = document.createElement('div')
  el.getClientRects = () => [{ width: 100, height: 20 } as DOMRect] as unknown as DOMRectList
  return el
}

/**
 * Configura document.querySelector para simular UI de anuncio visivel.
 * Usa o custom element <ad-badge-overlay> que e o sinal mais confiavel.
 * CR-MAJOR: o elemento retornado passa pelo filtro elementoVisivel().
 */
function configurarDocumentoComAd(videoEl: HTMLVideoElement): void {
  const adEl = criarElementoAdVisivel()

  vi.spyOn(document, 'querySelector').mockImplementation((selector: string) => {
    if (selector === 'video') return videoEl as unknown as Element
    // Seletores de UI de anuncio retornam elemento com visibilidade simulada
    if (
      selector === 'ad-badge-overlay' ||
      selector === '.ad-badge' ||
      selector === '[data-testid="ad-badge"]'
    ) {
      return adEl
    }
    return null
  })
  vi.spyOn(document, 'querySelectorAll').mockImplementation((selector: string) => {
    if (selector === 'video') return [videoEl] as unknown as NodeListOf<Element>
    return [] as unknown as NodeListOf<Element>
  })
}

// ---------------------------------------------------------------------------
// Testes basicos do adapter
// ---------------------------------------------------------------------------

describe('createDisneyAdapter', () => {
  let mockVideo: HTMLVideoElement
  // CR-MINOR-2: preserva o MutationObserver original para restaurar no afterEach
  let MutationObserverOriginal: typeof MutationObserver

  beforeEach(() => {
    mockVideo = criarMockVideo()
    MutationObserverOriginal = globalThis.MutationObserver
    vi.clearAllMocks()
    // MEDIUM-2: gate de path requer rota de player; define URL de video para testes basicos
    history.pushState({}, '', '/video/test-id')
    configurarDocumentoSemAd(mockVideo)
  })

  afterEach(() => {
    vi.restoreAllMocks()
    vi.resetModules()
    // CR-MINOR-2: restaura MutationObserver global
    globalThis.MutationObserver = MutationObserverOriginal
    // CR-MINOR-2: restaura timers reais caso algum teste use fake timers
    vi.useRealTimers()
    // CR-MINOR-2: reseta URL para raiz para nao vazar entre suites
    history.pushState({}, '', '/')
  })

  it('retorna null quando nao encontra elemento video apos timeout', async () => {
    vi.spyOn(document, 'querySelector').mockReturnValue(null)
    vi.spyOn(document, 'querySelectorAll').mockReturnValue([] as unknown as NodeListOf<Element>)

    class MockMutationObserver {
      observe = vi.fn()
      disconnect = vi.fn()
      constructor(public callback: MutationCallback) {}
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ;(globalThis as any).MutationObserver = MockMutationObserver

    const { createDisneyAdapter } = await import('../../src/adapters/disney')

    vi.useFakeTimers({ toFake: ['setTimeout', 'setInterval', 'clearInterval', 'clearTimeout'] })
    const promiseAdapter = createDisneyAdapter()

    // Avanca alem do VIDEO_WAIT_TIMEOUT_MS (8000ms)
    vi.advanceTimersByTime(9000)
    const adapter = await promiseAdapter
    expect(adapter).toBeNull()

    vi.useRealTimers()
  })

  it('retorna adapter quando elemento video esta presente', async () => {
    configurarDocumentoSemAd(mockVideo)
    const { createDisneyAdapter } = await import('../../src/adapters/disney')
    const adapter = await createDisneyAdapter()
    expect(adapter).not.toBeNull()
    adapter?.destroy()
  })

  it('getCurrentTime retorna currentTime do video', async () => {
    mockVideo.currentTime = 120.5
    configurarDocumentoSemAd(mockVideo)
    const { createDisneyAdapter } = await import('../../src/adapters/disney')
    const adapter = await createDisneyAdapter()
    expect(adapter?.getCurrentTime()).toBe(120.5)
    adapter?.destroy()
  })

  it('getDuration retorna duration do video', async () => {
    Object.defineProperty(mockVideo, 'duration', { value: 7200, writable: true, configurable: true })
    configurarDocumentoSemAd(mockVideo)
    const { createDisneyAdapter } = await import('../../src/adapters/disney')
    const adapter = await createDisneyAdapter()
    expect(adapter?.getDuration()).toBe(7200)
    adapter?.destroy()
  })

  it('getDuration retorna 0 quando duration e NaN', async () => {
    Object.defineProperty(mockVideo, 'duration', { value: NaN, writable: true, configurable: true })
    configurarDocumentoSemAd(mockVideo)
    const { createDisneyAdapter } = await import('../../src/adapters/disney')
    const adapter = await createDisneyAdapter()
    expect(adapter?.getDuration()).toBe(0)
    adapter?.destroy()
  })

  it('play() chama video.play()', async () => {
    configurarDocumentoSemAd(mockVideo)
    const { createDisneyAdapter } = await import('../../src/adapters/disney')
    const adapter = await createDisneyAdapter()
    await adapter?.play()
    expect(mockVideo.play).toHaveBeenCalledOnce()
    adapter?.destroy()
  })

  it('pause() chama video.pause()', async () => {
    configurarDocumentoSemAd(mockVideo)
    const { createDisneyAdapter } = await import('../../src/adapters/disney')
    const adapter = await createDisneyAdapter()
    await adapter?.pause()
    expect(mockVideo.pause).toHaveBeenCalledOnce()
    adapter?.destroy()
  })

  it('seekTo() atualiza currentTime do video', async () => {
    configurarDocumentoSemAd(mockVideo)
    const { createDisneyAdapter } = await import('../../src/adapters/disney')
    const adapter = await createDisneyAdapter()
    await adapter?.seekTo(450.0)
    expect(mockVideo.currentTime).toBe(450.0)
    adapter?.destroy()
  })

  it('getPlaybackState() retorna "playing" quando video nao esta pausado', async () => {
    Object.defineProperty(mockVideo, 'paused', { value: false, writable: true, configurable: true })
    configurarDocumentoSemAd(mockVideo)
    const { createDisneyAdapter } = await import('../../src/adapters/disney')
    const adapter = await createDisneyAdapter()
    expect(adapter?.getPlaybackState()).toBe('playing')
    adapter?.destroy()
  })

  it('getPlaybackState() retorna "paused" quando video esta pausado', async () => {
    Object.defineProperty(mockVideo, 'paused', { value: true, writable: true, configurable: true })
    configurarDocumentoSemAd(mockVideo)
    const { createDisneyAdapter } = await import('../../src/adapters/disney')
    const adapter = await createDisneyAdapter()
    expect(adapter?.getPlaybackState()).toBe('paused')
    adapter?.destroy()
  })

  it('getPlaybackState() retorna "buffering" quando readyState < HAVE_METADATA', async () => {
    Object.defineProperty(mockVideo, 'readyState', { value: 1, writable: true, configurable: true })
    Object.defineProperty(mockVideo, 'paused', { value: false, writable: true, configurable: true })
    configurarDocumentoSemAd(mockVideo)
    const { createDisneyAdapter } = await import('../../src/adapters/disney')
    const adapter = await createDisneyAdapter()
    expect(adapter?.getPlaybackState()).toBe('buffering')
    adapter?.destroy()
  })

  it('getPlaybackState() retorna "ad" durante anuncio', async () => {
    configurarDocumentoComAd(mockVideo)
    const { createDisneyAdapter } = await import('../../src/adapters/disney')
    const adapter = await createDisneyAdapter()
    expect(adapter?.getPlaybackState()).toBe('ad')
    adapter?.destroy()
  })

  it('isAd() retorna true quando UI de anuncio esta presente', async () => {
    configurarDocumentoComAd(mockVideo)
    const { createDisneyAdapter } = await import('../../src/adapters/disney')
    const adapter = await createDisneyAdapter()
    expect(adapter?.isAd()).toBe(true)
    adapter?.destroy()
  })

  it('isAd() retorna false quando UI de anuncio esta ausente', async () => {
    configurarDocumentoSemAd(mockVideo)
    const { createDisneyAdapter } = await import('../../src/adapters/disney')
    const adapter = await createDisneyAdapter()
    expect(adapter?.isAd()).toBe(false)
    adapter?.destroy()
  })

  it('on("play") dispara callback ao receber evento nativo de play', async () => {
    const videoInterno = criarMockVideo()
    configurarDocumentoSemAd(videoInterno)
    const { createDisneyAdapter } = await import('../../src/adapters/disney')
    const adapter = await createDisneyAdapter()

    const handler = vi.fn()
    adapter?.on('play', handler)

    ;(videoInterno as unknown as { _dispatchEvent: (e: string) => void })._dispatchEvent('play')

    expect(handler).toHaveBeenCalledOnce()
    adapter?.destroy()
  })

  it('on("pause") dispara callback ao receber evento nativo de pause', async () => {
    const videoInterno = criarMockVideo()
    configurarDocumentoSemAd(videoInterno)
    const { createDisneyAdapter } = await import('../../src/adapters/disney')
    const adapter = await createDisneyAdapter()

    const handler = vi.fn()
    adapter?.on('pause', handler)

    ;(videoInterno as unknown as { _dispatchEvent: (e: string) => void })._dispatchEvent('pause')

    expect(handler).toHaveBeenCalledOnce()
    adapter?.destroy()
  })

  it('on("seek") dispara callback ao receber evento nativo seeked', async () => {
    const videoInterno = criarMockVideo()
    configurarDocumentoSemAd(videoInterno)
    const { createDisneyAdapter } = await import('../../src/adapters/disney')
    const adapter = await createDisneyAdapter()

    const handler = vi.fn()
    adapter?.on('seek', handler)

    ;(videoInterno as unknown as { _dispatchEvent: (e: string) => void })._dispatchEvent('seeked')

    expect(handler).toHaveBeenCalledOnce()
    adapter?.destroy()
  })

  it('on("buffering") dispara callback ao receber evento nativo waiting', async () => {
    const videoInterno = criarMockVideo()
    configurarDocumentoSemAd(videoInterno)
    const { createDisneyAdapter } = await import('../../src/adapters/disney')
    const adapter = await createDisneyAdapter()

    const handler = vi.fn()
    adapter?.on('buffering', handler)

    ;(videoInterno as unknown as { _dispatchEvent: (e: string) => void })._dispatchEvent('waiting')

    expect(handler).toHaveBeenCalledOnce()
    adapter?.destroy()
  })

  it('on("ended") dispara callback ao receber evento nativo ended', async () => {
    const videoInterno = criarMockVideo()
    configurarDocumentoSemAd(videoInterno)
    const { createDisneyAdapter } = await import('../../src/adapters/disney')
    const adapter = await createDisneyAdapter()

    const handler = vi.fn()
    adapter?.on('ended', handler)

    ;(videoInterno as unknown as { _dispatchEvent: (e: string) => void })._dispatchEvent('ended')

    expect(handler).toHaveBeenCalledOnce()
    adapter?.destroy()
  })

  it('off() remove listener de evento', async () => {
    const videoInterno = criarMockVideo()
    configurarDocumentoSemAd(videoInterno)
    const { createDisneyAdapter } = await import('../../src/adapters/disney')
    const adapter = await createDisneyAdapter()

    const handler = vi.fn()
    adapter?.on('play', handler)
    adapter?.off('play', handler)

    ;(videoInterno as unknown as { _dispatchEvent: (e: string) => void })._dispatchEvent('play')

    expect(handler).not.toHaveBeenCalled()
    adapter?.destroy()
  })

  it('getServiceType() retorna "native-html5"', async () => {
    configurarDocumentoSemAd(mockVideo)
    const { createDisneyAdapter } = await import('../../src/adapters/disney')
    const adapter = await createDisneyAdapter()
    expect(adapter?.getServiceType()).toBe('native-html5')
    adapter?.destroy()
  })

  it('destroy() remove handlers nativos do video', async () => {
    configurarDocumentoSemAd(mockVideo)
    const { createDisneyAdapter } = await import('../../src/adapters/disney')
    const adapter = await createDisneyAdapter()
    adapter?.destroy()
    expect(mockVideo.removeEventListener).toHaveBeenCalled()
  })

  it('destroy() limpa todos os listeners registrados', async () => {
    configurarDocumentoSemAd(mockVideo)
    const { createDisneyAdapter } = await import('../../src/adapters/disney')
    const adapter = await createDisneyAdapter()

    const handler = vi.fn()
    adapter?.on('play', handler)
    adapter?.destroy()

    // Apos destroy, o handler nao deve mais ser chamado
    ;(mockVideo as unknown as { _dispatchEvent: (e: string) => void })._dispatchEvent('play')
    expect(handler).not.toHaveBeenCalled()
  })
})

// ---------------------------------------------------------------------------
// Testes de navegacao SPA
// ---------------------------------------------------------------------------

describe('SPA Disney+: re-resolucao de video ao trocar de episodio', () => {
  let MutationObserverOriginal: typeof MutationObserver

  beforeEach(() => {
    MutationObserverOriginal = globalThis.MutationObserver
    // MEDIUM-2: gate de path requer rota de player
    history.pushState({}, '', '/video/test-id')
  })

  afterEach(() => {
    vi.restoreAllMocks()
    vi.resetModules()
    // CR-MINOR-2: restaura MutationObserver global, timers e URL
    globalThis.MutationObserver = MutationObserverOriginal
    vi.useRealTimers()
    history.pushState({}, '', '/')
  })

  it('inicia e cancela polling de SPA no ciclo de vida do adapter', async () => {
    const video = criarMockVideo()

    class MockMutationObserver {
      observe = vi.fn()
      disconnect = vi.fn()
      constructor(public callback: MutationCallback) {}
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ;(globalThis as any).MutationObserver = MockMutationObserver

    vi.spyOn(document, 'querySelector').mockImplementation((sel: string) => {
      if (sel === 'video') return video as unknown as Element
      return null
    })
    vi.spyOn(document, 'querySelectorAll').mockReturnValue([video] as unknown as NodeListOf<Element>)

    const setIntervalSpy = vi.spyOn(globalThis, 'setInterval')
    const clearIntervalSpy = vi.spyOn(globalThis, 'clearInterval')

    const { createDisneyAdapter } = await import('../../src/adapters/disney')
    const adapter = await createDisneyAdapter()
    expect(adapter).not.toBeNull()

    // O polling SPA deve ter sido iniciado via setInterval com 800ms
    const chamouSetInterval = setIntervalSpy.mock.calls.some(
      ([, delay]) => delay === 800
    )
    expect(chamouSetInterval).toBe(true)

    adapter?.destroy()

    // O polling deve ter sido limpo no destroy via clearInterval
    expect(clearIntervalSpy).toHaveBeenCalled()
  })

  it('re-liga listeners ao novo video apos evento popstate em /video/:id', async () => {
    const videoOriginal = criarMockVideo()
    const videoNovo = criarMockVideo()

    let videoAtivo = videoOriginal

    class MockMutationObserver {
      observe = vi.fn()
      disconnect = vi.fn()
      constructor(public callback: MutationCallback) {}
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ;(globalThis as any).MutationObserver = MockMutationObserver

    vi.spyOn(document, 'querySelector').mockImplementation((sel: string) => {
      if (sel === 'video') return videoAtivo as unknown as Element
      return null
    })
    vi.spyOn(document, 'querySelectorAll').mockImplementation((sel: string) => {
      if (sel === 'video') return [videoAtivo] as unknown as NodeListOf<Element>
      return [] as unknown as NodeListOf<Element>
    })

    const { createDisneyAdapter } = await import('../../src/adapters/disney')
    const adapter = await createDisneyAdapter()
    expect(adapter).not.toBeNull()

    const pauseHandler = vi.fn()
    adapter?.on('pause', pauseHandler)

    // Navega para /video/:id (rota de episodio do Disney+)
    history.pushState({}, '', '/video/12345')
    videoAtivo = videoNovo
    window.dispatchEvent(new PopStateEvent('popstate'))

    // Aguarda re-resolucao: inclui SPA_RENAVIGATE_DELAY_MS=150ms + margem
    await new Promise((r) => setTimeout(r, 200))

    ;(videoNovo as unknown as { _dispatchEvent: (e: string) => void })._dispatchEvent('pause')
    expect(pauseHandler).toHaveBeenCalled()

    adapter?.destroy()
    history.pushState({}, '', '/')
  })

  it('re-liga listeners ao novo video apos evento popstate em /play/:id', async () => {
    const videoOriginal = criarMockVideo()
    const videoNovo = criarMockVideo()

    let videoAtivo = videoOriginal

    class MockMutationObserver {
      observe = vi.fn()
      disconnect = vi.fn()
      constructor(public callback: MutationCallback) {}
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ;(globalThis as any).MutationObserver = MockMutationObserver

    vi.spyOn(document, 'querySelector').mockImplementation((sel: string) => {
      if (sel === 'video') return videoAtivo as unknown as Element
      return null
    })
    vi.spyOn(document, 'querySelectorAll').mockImplementation((sel: string) => {
      if (sel === 'video') return [videoAtivo] as unknown as NodeListOf<Element>
      return [] as unknown as NodeListOf<Element>
    })

    const { createDisneyAdapter } = await import('../../src/adapters/disney')
    const adapter = await createDisneyAdapter()
    expect(adapter).not.toBeNull()

    const playHandler = vi.fn()
    adapter?.on('play', playHandler)

    // Navega para /play/:id (rota alternativa do Disney+)
    history.pushState({}, '', '/play/67890')
    videoAtivo = videoNovo
    window.dispatchEvent(new PopStateEvent('popstate'))

    // Aguarda re-resolucao: inclui SPA_RENAVIGATE_DELAY_MS=150ms + margem
    await new Promise((r) => setTimeout(r, 200))

    ;(videoNovo as unknown as { _dispatchEvent: (e: string) => void })._dispatchEvent('play')
    expect(playHandler).toHaveBeenCalled()

    adapter?.destroy()
    history.pushState({}, '', '/')
  })

  it('NAO re-liga quando popstate navega para fora de /video/ e /play/', async () => {
    const video = criarMockVideo()

    class MockMutationObserver {
      observe = vi.fn()
      disconnect = vi.fn()
      constructor(public callback: MutationCallback) {}
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ;(globalThis as any).MutationObserver = MockMutationObserver

    vi.spyOn(document, 'querySelector').mockImplementation((sel: string) => {
      if (sel === 'video') return video as unknown as Element
      return null
    })
    vi.spyOn(document, 'querySelectorAll').mockReturnValue([video] as unknown as NodeListOf<Element>)

    const { createDisneyAdapter } = await import('../../src/adapters/disney')
    const adapter = await createDisneyAdapter()

    const removeListenerSpy = vi.spyOn(video, 'removeEventListener')
    const chamadas = removeListenerSpy.mock.calls.length

    // Navega para a home (fora de /video/ e /play/)
    history.pushState({}, '', '/')
    window.dispatchEvent(new PopStateEvent('popstate'))

    await new Promise((r) => setTimeout(r, 20))

    // removeEventListener nao deve ter sido chamado novamente (nenhuma re-ligacao)
    expect(removeListenerSpy.mock.calls.length).toBe(chamadas)

    adapter?.destroy()
    history.pushState({}, '', '/')
  })

  it('destroy() remove listener de popstate', async () => {
    const video = criarMockVideo()

    vi.spyOn(document, 'querySelector').mockImplementation((sel: string) => {
      if (sel === 'video') return video as unknown as Element
      return null
    })
    vi.spyOn(document, 'querySelectorAll').mockReturnValue([video] as unknown as NodeListOf<Element>)

    const addSpy = vi.spyOn(window, 'addEventListener')
    const removeSpy = vi.spyOn(window, 'removeEventListener')

    const { createDisneyAdapter } = await import('../../src/adapters/disney')
    const adapter = await createDisneyAdapter()
    adapter?.destroy()

    const adicionouPopstate = addSpy.mock.calls.some(([evt]) => evt === 'popstate')
    const removeuPopstate = removeSpy.mock.calls.some(([evt]) => evt === 'popstate')

    expect(adicionouPopstate).toBe(true)
    expect(removeuPopstate).toBe(true)
  })

  it('polling de location.href detecta mudanca de URL via pushState', async () => {
    const video = criarMockVideo()

    class MockMutationObserver {
      observe = vi.fn()
      disconnect = vi.fn()
      constructor(public callback: MutationCallback) {}
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ;(globalThis as any).MutationObserver = MockMutationObserver

    vi.spyOn(document, 'querySelector').mockImplementation((sel: string) => {
      if (sel === 'video') return video as unknown as Element
      return null
    })
    vi.spyOn(document, 'querySelectorAll').mockReturnValue([video] as unknown as NodeListOf<Element>)

    vi.useFakeTimers({ toFake: ['setTimeout', 'setInterval', 'clearInterval', 'clearTimeout'] })

    const { createDisneyAdapter } = await import('../../src/adapters/disney')
    const adapter = await createDisneyAdapter()
    expect(adapter).not.toBeNull()

    const removeListenerSpy = vi.spyOn(video, 'removeEventListener')

    // Simula pushState para /video/:id
    history.pushState({}, '', '/video/99999')

    // Avanca: 800ms (polling) + 150ms (SPA_RENAVIGATE_DELAY_MS) + margem
    vi.advanceTimersByTime(951)

    // Aguarda resolucao das promises internas do renavigate
    await Promise.resolve()
    await Promise.resolve()
    await Promise.resolve()
    await Promise.resolve()

    // Verifica que o polling reagiu a mudanca de URL
    expect(removeListenerSpy).toHaveBeenCalled()

    adapter?.destroy()
    history.pushState({}, '', '/')
    vi.useRealTimers()
  })

  it('destroy() durante aguardarVideoDisney pendente nao reinstala handlers', async () => {
    const video = criarMockVideo()

    let observerCallback: MutationCallback | null = null
    class MockMutationObserver {
      observe = vi.fn()
      disconnect = vi.fn()
      constructor(cb: MutationCallback) { observerCallback = cb }
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ;(globalThis as any).MutationObserver = MockMutationObserver

    let queryCalls = 0
    vi.spyOn(document, 'querySelector').mockImplementation((sel: string) => {
      queryCalls++
      if (queryCalls <= 2 && sel === 'video') return video as unknown as Element
      return null
    })
    vi.spyOn(document, 'querySelectorAll').mockImplementation((sel: string) => {
      if (sel === 'video' && queryCalls <= 2) return [video] as unknown as NodeListOf<Element>
      return [] as unknown as NodeListOf<Element>
    })

    const { createDisneyAdapter } = await import('../../src/adapters/disney')
    const adapter = await createDisneyAdapter()
    expect(adapter).not.toBeNull()

    // Dispara navegacao SPA (onSpaNavegacao fica esperando o video aparecer)
    history.pushState({}, '', '/video/test')
    window.dispatchEvent(new PopStateEvent('popstate'))

    // Destroy imediato (antes de aguardarVideoDisney resolver)
    adapter?.destroy()
    history.pushState({}, '', '/')

    // Dispara o MutationObserver mockado - simula video aparecendo apos destroy
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const cbCapturado = observerCallback as ((...args: any[]) => void) | null
    if (cbCapturado) {
      vi.spyOn(document, 'querySelector').mockImplementation((sel: string) => {
        if (sel === 'video') return video as unknown as Element
        return null
      })
      cbCapturado([], null)
    }

    // Aguarda microtasks
    await new Promise((r) => setTimeout(r, 20))

    // Apos destroy + resolucao tardia, removeEventListener deve ter sido chamado
    // e nenhum erro deve ter ocorrido (adapter nao reinstalou handlers)
    expect(video.removeEventListener).toHaveBeenCalled()
  })

  it('navegacoes SPA concorrentes: apenas a ultima e aplicada', async () => {
    const videoOriginal = criarMockVideo()
    const videoFinal = criarMockVideo()

    let videoAtivo = videoOriginal

    class MockMutationObserver {
      observe = vi.fn()
      disconnect = vi.fn()
      constructor(public callback: MutationCallback) {}
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ;(globalThis as any).MutationObserver = MockMutationObserver

    vi.spyOn(document, 'querySelector').mockImplementation((sel: string) => {
      if (sel === 'video') return videoAtivo as unknown as Element
      return null
    })
    vi.spyOn(document, 'querySelectorAll').mockImplementation((sel: string) => {
      if (sel === 'video') return [videoAtivo] as unknown as NodeListOf<Element>
      return [] as unknown as NodeListOf<Element>
    })

    const { createDisneyAdapter } = await import('../../src/adapters/disney')
    const adapter = await createDisneyAdapter()
    expect(adapter).not.toBeNull()

    const playHandler = vi.fn()
    adapter?.on('play', playHandler)

    history.pushState({}, '', '/video/11111')

    // Dispara duas navegacoes SPA em rapida sucessao (concorrentes)
    window.dispatchEvent(new PopStateEvent('popstate'))
    // Segunda navegacao imediatamente - deve cancelar a primeira
    videoAtivo = videoFinal
    window.dispatchEvent(new PopStateEvent('popstate'))

    // Aguarda resolucao: inclui SPA_RENAVIGATE_DELAY_MS=150ms + margem
    await new Promise((r) => setTimeout(r, 200))

    // O evento deve ter sido re-ligado no videoFinal (ultima navegacao)
    ;(videoFinal as unknown as { _dispatchEvent: (e: string) => void })._dispatchEvent('play')
    expect(playHandler).toHaveBeenCalled()

    adapter?.destroy()
    history.pushState({}, '', '/')
  })
})

// ---------------------------------------------------------------------------
// Testes de deteccao de anuncio via MutationObserver
// ---------------------------------------------------------------------------

describe('Anuncio Disney+: emissao de ad-start/ad-end via MutationObserver', () => {
  let MutationObserverOriginal: typeof MutationObserver

  beforeEach(() => {
    MutationObserverOriginal = globalThis.MutationObserver
    // MEDIUM-2: gate de path requer rota de player para que o adapter seja criado
    history.pushState({}, '', '/video/test-id')
  })

  afterEach(() => {
    vi.restoreAllMocks()
    vi.resetModules()
    // CR-MINOR-2: restaura MutationObserver global e timers
    globalThis.MutationObserver = MutationObserverOriginal
    vi.useRealTimers()
    history.pushState({}, '', '/')
  })

  it('emite ad-start quando UI de anuncio aparece no DOM', async () => {
    const video = criarMockVideo()
    let adVisivel = false

    let observerCallback: MutationCallback | null = null
    class MockMutationObserver {
      observe = vi.fn()
      disconnect = vi.fn()
      constructor(callback: MutationCallback) {
        observerCallback = callback
      }
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ;(globalThis as any).MutationObserver = MockMutationObserver

    vi.spyOn(document, 'querySelector').mockImplementation((sel: string) => {
      if (sel === 'video') return video as unknown as Element
      // custom element de anuncio retorna elemento somente quando anuncio esta visivel
      // CR-MAJOR: usa criarElementoAdVisivel() para passar pelo filtro elementoVisivel()
      if (sel === 'ad-badge-overlay' && adVisivel) return criarElementoAdVisivel()
      return null
    })
    vi.spyOn(document, 'querySelectorAll').mockReturnValue([video] as unknown as NodeListOf<Element>)

    const { createDisneyAdapter } = await import('../../src/adapters/disney')
    const adapter = await createDisneyAdapter()

    const adStartHandler = vi.fn()
    adapter?.on('ad-start', adStartHandler)

    // Simula aparecimento do anuncio
    adVisivel = true
    observerCallback!([] as unknown as MutationRecord[], null as unknown as MutationObserver)

    expect(adStartHandler).toHaveBeenCalledOnce()
    adapter?.destroy()
  })

  it('emite ad-end quando UI de anuncio desaparece do DOM', async () => {
    const video = criarMockVideo()
    let adVisivel = true // comeca com anuncio visivel

    let observerCallback: MutationCallback | null = null
    class MockMutationObserver {
      observe = vi.fn()
      disconnect = vi.fn()
      constructor(callback: MutationCallback) {
        observerCallback = callback
      }
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ;(globalThis as any).MutationObserver = MockMutationObserver

    vi.spyOn(document, 'querySelector').mockImplementation((sel: string) => {
      if (sel === 'video') return video as unknown as Element
      // CR-MAJOR: usa criarElementoAdVisivel() para passar pelo filtro elementoVisivel()
      if (sel === 'ad-badge-overlay' && adVisivel) return criarElementoAdVisivel()
      return null
    })
    vi.spyOn(document, 'querySelectorAll').mockReturnValue([video] as unknown as NodeListOf<Element>)

    const { createDisneyAdapter } = await import('../../src/adapters/disney')
    const adapter = await createDisneyAdapter()

    const adEndHandler = vi.fn()
    adapter?.on('ad-end', adEndHandler)

    // Simula fim do anuncio
    adVisivel = false
    observerCallback!([] as unknown as MutationRecord[], null as unknown as MutationObserver)

    expect(adEndHandler).toHaveBeenCalledOnce()
    adapter?.destroy()
  })

  it('deteta anuncio via seletor alternativo .ad-badge', async () => {
    const video = criarMockVideo()
    // CR-MAJOR: elemento precisa passar pelo filtro elementoVisivel()
    const adEl = criarElementoAdVisivel()

    vi.spyOn(document, 'querySelector').mockImplementation((sel: string) => {
      if (sel === 'video') return video as unknown as Element
      if (sel === '.ad-badge') return adEl
      return null
    })
    vi.spyOn(document, 'querySelectorAll').mockReturnValue([video] as unknown as NodeListOf<Element>)

    const { createDisneyAdapter } = await import('../../src/adapters/disney')
    const adapter = await createDisneyAdapter()

    expect(adapter?.isAd()).toBe(true)
    adapter?.destroy()
  })

  it('deteta anuncio via seletor [data-testid="ad-badge"]', async () => {
    const video = criarMockVideo()
    // CR-MAJOR: elemento precisa passar pelo filtro elementoVisivel()
    const adEl = criarElementoAdVisivel()

    vi.spyOn(document, 'querySelector').mockImplementation((sel: string) => {
      if (sel === 'video') return video as unknown as Element
      if (sel === '[data-testid="ad-badge"]') return adEl
      return null
    })
    vi.spyOn(document, 'querySelectorAll').mockReturnValue([video] as unknown as NodeListOf<Element>)

    const { createDisneyAdapter } = await import('../../src/adapters/disney')
    const adapter = await createDisneyAdapter()

    expect(adapter?.isAd()).toBe(true)
    adapter?.destroy()
  })

  it('destroy() desconecta o MutationObserver de anuncio', async () => {
    const video = criarMockVideo()
    const disconnectSpy = vi.fn()

    class MockMutationObserver {
      observe = vi.fn()
      disconnect = disconnectSpy
      constructor(public callback: MutationCallback) {}
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ;(globalThis as any).MutationObserver = MockMutationObserver

    vi.spyOn(document, 'querySelector').mockImplementation((sel: string) => {
      if (sel === 'video') return video as unknown as Element
      return null
    })
    vi.spyOn(document, 'querySelectorAll').mockReturnValue([video] as unknown as NodeListOf<Element>)

    const { createDisneyAdapter } = await import('../../src/adapters/disney')
    const adapter = await createDisneyAdapter()
    adapter?.destroy()

    expect(disconnectSpy).toHaveBeenCalled()
  })
})

// ---------------------------------------------------------------------------
// Testes de selecao de video (heuristica Disney+)
// ---------------------------------------------------------------------------

describe('Heuristica de selecao do video principal (Disney+)', () => {
  let MutationObserverOriginalHeuristica: typeof MutationObserver

  beforeEach(() => {
    MutationObserverOriginalHeuristica = globalThis.MutationObserver
    // MEDIUM-2: selecionarVideoDisney() requer path de player para nao retornar null
    history.pushState({}, '', '/video/test-id')
  })

  afterEach(() => {
    vi.restoreAllMocks()
    vi.resetModules()
    // CR-MINOR-2: restaura MutationObserver, timers e URL
    globalThis.MutationObserver = MutationObserverOriginalHeuristica
    vi.useRealTimers()
    history.pushState({}, '', '/')
  })

  it('prefere video visivel (checkVisibility=true) sobre invisivel', async () => {
    // Disney+ tem varios <video> na pagina; checkVisibility e o primeiro filtro
    const videoInvisivel = criarMockVideo({ currentTime: 5 })
    ;(videoInvisivel as unknown as { checkVisibility: () => boolean }).checkVisibility = vi.fn(() => false)
    vi.spyOn(videoInvisivel, 'getBoundingClientRect').mockReturnValue({
      width: 1280, height: 720, top: 0, left: 0, right: 1280, bottom: 720, x: 0, y: 0, toJSON: vi.fn(),
    } as DOMRect)

    const videoPrincipal = criarMockVideo({ currentTime: 100 })
    ;(videoPrincipal as unknown as { checkVisibility: () => boolean }).checkVisibility = vi.fn(() => true)
    vi.spyOn(videoPrincipal, 'getBoundingClientRect').mockReturnValue({
      width: 1280, height: 720, top: 0, left: 0, right: 1280, bottom: 720, x: 0, y: 0, toJSON: vi.fn(),
    } as DOMRect)

    vi.spyOn(document, 'querySelector').mockReturnValue(null)
    vi.spyOn(document, 'querySelectorAll').mockImplementation((sel: string) => {
      if (sel === 'video') return [videoInvisivel, videoPrincipal] as unknown as NodeListOf<Element>
      return [] as unknown as NodeListOf<Element>
    })

    const { createDisneyAdapter } = await import('../../src/adapters/disney')
    const adapter = await createDisneyAdapter()

    // O adapter deve ter conectado ao video visivel
    expect(adapter?.getCurrentTime()).toBe(100)
    adapter?.destroy()
  })

  it('escolhe o video de maior duracao entre os visiveis', async () => {
    const videoConteudo = criarMockVideo()
    Object.defineProperty(videoConteudo, 'duration', { value: 5400, configurable: true })
    Object.defineProperty(videoConteudo, 'readyState', { value: 4, configurable: true })
    videoConteudo.currentTime = 300
    vi.spyOn(videoConteudo, 'getBoundingClientRect').mockReturnValue({
      width: 1280, height: 720, top: 0, left: 0, right: 1280, bottom: 720, x: 0, y: 0, toJSON: vi.fn(),
    } as DOMRect)

    const videoTrailer = criarMockVideo()
    Object.defineProperty(videoTrailer, 'duration', { value: 90, configurable: true })
    Object.defineProperty(videoTrailer, 'readyState', { value: 4, configurable: true })
    videoTrailer.currentTime = 10
    vi.spyOn(videoTrailer, 'getBoundingClientRect').mockReturnValue({
      width: 1280, height: 720, top: 0, left: 0, right: 1280, bottom: 720, x: 0, y: 0, toJSON: vi.fn(),
    } as DOMRect)

    vi.spyOn(document, 'querySelector').mockReturnValue(null)
    vi.spyOn(document, 'querySelectorAll').mockImplementation((sel: string) => {
      if (sel === 'video') return [videoTrailer, videoConteudo] as unknown as NodeListOf<Element>
      return [] as unknown as NodeListOf<Element>
    })

    const { createDisneyAdapter } = await import('../../src/adapters/disney')
    const adapter = await createDisneyAdapter()

    // Deve ter escolhido o video de maior duracao (conteudo principal)
    expect(adapter?.getCurrentTime()).toBe(300)
    adapter?.destroy()
  })

  it('fallback por maior area renderizada quando nenhum video tem duracao conhecida', async () => {
    const videoPequeno = criarMockVideo()
    Object.defineProperty(videoPequeno, 'readyState', { value: 1, configurable: true })
    Object.defineProperty(videoPequeno, 'duration', { value: NaN, configurable: true })
    Object.defineProperty(videoPequeno, 'offsetWidth', { value: 320, configurable: true })
    Object.defineProperty(videoPequeno, 'offsetHeight', { value: 180, configurable: true })
    vi.spyOn(videoPequeno, 'getBoundingClientRect').mockReturnValue({
      width: 320, height: 180, top: 0, left: 0, right: 320, bottom: 180, x: 0, y: 0, toJSON: vi.fn(),
    } as DOMRect)
    videoPequeno.currentTime = 5

    const videoGrande = criarMockVideo()
    Object.defineProperty(videoGrande, 'readyState', { value: 1, configurable: true })
    Object.defineProperty(videoGrande, 'duration', { value: NaN, configurable: true })
    Object.defineProperty(videoGrande, 'offsetWidth', { value: 1280, configurable: true })
    Object.defineProperty(videoGrande, 'offsetHeight', { value: 720, configurable: true })
    vi.spyOn(videoGrande, 'getBoundingClientRect').mockReturnValue({
      width: 1280, height: 720, top: 0, left: 0, right: 1280, bottom: 720, x: 0, y: 0, toJSON: vi.fn(),
    } as DOMRect)
    videoGrande.currentTime = 42

    vi.spyOn(document, 'querySelector').mockReturnValue(null)
    vi.spyOn(document, 'querySelectorAll').mockImplementation((sel: string) => {
      if (sel === 'video') return [videoPequeno, videoGrande] as unknown as NodeListOf<Element>
      return [] as unknown as NodeListOf<Element>
    })

    const { createDisneyAdapter } = await import('../../src/adapters/disney')
    const adapter = await createDisneyAdapter()

    // Deve ter escolhido o video de maior area renderizada
    expect(adapter?.getCurrentTime()).toBe(42)
    adapter?.destroy()
  })
})
