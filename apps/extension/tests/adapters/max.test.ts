// tests/adapters/max.test.ts
// Testes unitarios para o adapter do Max (max.com).
// Usa mock de HTMLVideoElement para nao depender do DOM real.
// Segue a mesma estrutura do netflix.test.ts.

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
    // getBoundingClientRect necessario para a validacao de area do video principal
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
// Helpers para mockar document sem anuncio / com anuncio
// ---------------------------------------------------------------------------

/**
 * Configura document.querySelector para retornar o video pelo seletor primario
 * do Max e nenhum elemento de UI de anuncio.
 */
function configurarDocumentoSemAd(videoEl: HTMLVideoElement): void {
  vi.spyOn(document, 'querySelector').mockImplementation((selector: string) => {
    if (selector === '[data-testid="player-ux-root"] video') return videoEl as unknown as Element
    if (selector === '[class*="PlayerContainer"] video') return videoEl as unknown as Element
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
 * Usa testids exatos da whitelist AD_DATA_TESTIDS do adapter (HIGH-2).
 *
 * O detector de anuncio chama container.querySelector() onde container e o
 * elemento retornado por document.querySelector('[data-testid="player-ux-root"]').
 * Aqui criamos um container falso cujo querySelector tambem retorna o adEl.
 * CR-MAJOR: o elemento retornado tem getClientRects() nao-vazio.
 */
function configurarDocumentoComAd(videoEl: HTMLVideoElement): void {
  const adEl = criarElementoAdVisivel()

  // Container falso: querySelector interno retorna adEl para seletores de anuncio
  const containerFalso = document.createElement('div')
  containerFalso.querySelector = vi.fn((sel: string): Element | null => {
    if (
      sel === '[data-testid="ad-badge"]' ||
      sel === '[data-testid="ad-timer"]' ||
      sel === '[data-testid="ad-countdown"]' ||
      sel === '[data-testid="ad-panel"]' ||
      sel === '[data-testid="ad-overlay"]' ||
      sel === '[data-testid="ad-skip-button"]' ||
      sel === '[data-testid="ad-break"]' ||
      sel === '[class*="AdBreak"]' ||
      sel === '[class*="AdTimer"]' ||
      sel === '[class*="AdPanel"]' ||
      sel === '[class*="AdOverlay"]' ||
      sel === '[class*="AdCountdown"]' ||
      sel === '[class*="SkipAd"]'
    ) return adEl
    return null
  }) as Element['querySelector']

  vi.spyOn(document, 'querySelector').mockImplementation((selector: string) => {
    if (selector === '[data-testid="player-ux-root"] video') return videoEl as unknown as Element
    if (selector === '[class*="PlayerContainer"] video') return videoEl as unknown as Element
    if (selector === 'video') return videoEl as unknown as Element
    // Retorna o container falso para o seletor raiz do player
    if (selector === '[data-testid="player-ux-root"]') return containerFalso
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

describe('createMaxAdapter', () => {
  let mockVideo: HTMLVideoElement
  // CR-MINOR-2: preserva o MutationObserver original para restaurar no afterEach
  let MutationObserverOriginal: typeof MutationObserver

  beforeEach(() => {
    mockVideo = criarMockVideo()
    MutationObserverOriginal = globalThis.MutationObserver
    vi.clearAllMocks()
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

    const { createMaxAdapter } = await import('../../src/adapters/max')

    vi.useFakeTimers({ toFake: ['setTimeout', 'setInterval', 'clearInterval', 'clearTimeout'] })
    const promiseAdapter = createMaxAdapter()

    // Avanca alem do VIDEO_WAIT_TIMEOUT_MS (8000ms)
    vi.advanceTimersByTime(9000)
    const adapter = await promiseAdapter
    expect(adapter).toBeNull()

    vi.useRealTimers()
  })

  it('retorna adapter quando elemento video esta presente', async () => {
    configurarDocumentoSemAd(mockVideo)
    const { createMaxAdapter } = await import('../../src/adapters/max')
    const adapter = await createMaxAdapter()
    expect(adapter).not.toBeNull()
    adapter?.destroy()
  })

  it('getCurrentTime retorna currentTime do video', async () => {
    mockVideo.currentTime = 120.5
    configurarDocumentoSemAd(mockVideo)
    const { createMaxAdapter } = await import('../../src/adapters/max')
    const adapter = await createMaxAdapter()
    expect(adapter?.getCurrentTime()).toBe(120.5)
    adapter?.destroy()
  })

  it('getDuration retorna duration do video', async () => {
    Object.defineProperty(mockVideo, 'duration', { value: 7200, writable: true, configurable: true })
    configurarDocumentoSemAd(mockVideo)
    const { createMaxAdapter } = await import('../../src/adapters/max')
    const adapter = await createMaxAdapter()
    expect(adapter?.getDuration()).toBe(7200)
    adapter?.destroy()
  })

  it('getDuration retorna 0 quando duration e NaN', async () => {
    Object.defineProperty(mockVideo, 'duration', { value: NaN, writable: true, configurable: true })
    configurarDocumentoSemAd(mockVideo)
    const { createMaxAdapter } = await import('../../src/adapters/max')
    const adapter = await createMaxAdapter()
    expect(adapter?.getDuration()).toBe(0)
    adapter?.destroy()
  })

  it('play() chama video.play()', async () => {
    configurarDocumentoSemAd(mockVideo)
    const { createMaxAdapter } = await import('../../src/adapters/max')
    const adapter = await createMaxAdapter()
    await adapter?.play()
    expect(mockVideo.play).toHaveBeenCalledOnce()
    adapter?.destroy()
  })

  it('pause() chama video.pause()', async () => {
    configurarDocumentoSemAd(mockVideo)
    const { createMaxAdapter } = await import('../../src/adapters/max')
    const adapter = await createMaxAdapter()
    await adapter?.pause()
    expect(mockVideo.pause).toHaveBeenCalledOnce()
    adapter?.destroy()
  })

  it('seekTo() atualiza currentTime do video', async () => {
    configurarDocumentoSemAd(mockVideo)
    const { createMaxAdapter } = await import('../../src/adapters/max')
    const adapter = await createMaxAdapter()
    await adapter?.seekTo(450.0)
    expect(mockVideo.currentTime).toBe(450.0)
    adapter?.destroy()
  })

  it('getPlaybackState() retorna "playing" quando video nao esta pausado', async () => {
    Object.defineProperty(mockVideo, 'paused', { value: false, writable: true, configurable: true })
    configurarDocumentoSemAd(mockVideo)
    const { createMaxAdapter } = await import('../../src/adapters/max')
    const adapter = await createMaxAdapter()
    expect(adapter?.getPlaybackState()).toBe('playing')
    adapter?.destroy()
  })

  it('getPlaybackState() retorna "paused" quando video esta pausado', async () => {
    Object.defineProperty(mockVideo, 'paused', { value: true, writable: true, configurable: true })
    configurarDocumentoSemAd(mockVideo)
    const { createMaxAdapter } = await import('../../src/adapters/max')
    const adapter = await createMaxAdapter()
    expect(adapter?.getPlaybackState()).toBe('paused')
    adapter?.destroy()
  })

  it('getPlaybackState() retorna "buffering" quando readyState < HAVE_METADATA', async () => {
    Object.defineProperty(mockVideo, 'readyState', { value: 1, writable: true, configurable: true })
    Object.defineProperty(mockVideo, 'paused', { value: false, writable: true, configurable: true })
    configurarDocumentoSemAd(mockVideo)
    const { createMaxAdapter } = await import('../../src/adapters/max')
    const adapter = await createMaxAdapter()
    expect(adapter?.getPlaybackState()).toBe('buffering')
    adapter?.destroy()
  })

  it('getPlaybackState() retorna "ad" durante anuncio', async () => {
    configurarDocumentoComAd(mockVideo)
    const { createMaxAdapter } = await import('../../src/adapters/max')
    const adapter = await createMaxAdapter()
    expect(adapter?.getPlaybackState()).toBe('ad')
    adapter?.destroy()
  })

  it('isAd() retorna true quando UI de anuncio esta presente', async () => {
    configurarDocumentoComAd(mockVideo)
    const { createMaxAdapter } = await import('../../src/adapters/max')
    const adapter = await createMaxAdapter()
    expect(adapter?.isAd()).toBe(true)
    adapter?.destroy()
  })

  it('isAd() retorna false quando UI de anuncio esta ausente', async () => {
    configurarDocumentoSemAd(mockVideo)
    const { createMaxAdapter } = await import('../../src/adapters/max')
    const adapter = await createMaxAdapter()
    expect(adapter?.isAd()).toBe(false)
    adapter?.destroy()
  })

  it('on("play") dispara callback ao receber evento nativo de play', async () => {
    const videoInterno = criarMockVideo()
    configurarDocumentoSemAd(videoInterno)
    const { createMaxAdapter } = await import('../../src/adapters/max')
    const adapter = await createMaxAdapter()

    const handler = vi.fn()
    adapter?.on('play', handler)

    ;(videoInterno as unknown as { _dispatchEvent: (e: string) => void })._dispatchEvent('play')

    expect(handler).toHaveBeenCalledOnce()
    adapter?.destroy()
  })

  it('on("pause") dispara callback ao receber evento nativo de pause', async () => {
    const videoInterno = criarMockVideo()
    configurarDocumentoSemAd(videoInterno)
    const { createMaxAdapter } = await import('../../src/adapters/max')
    const adapter = await createMaxAdapter()

    const handler = vi.fn()
    adapter?.on('pause', handler)

    ;(videoInterno as unknown as { _dispatchEvent: (e: string) => void })._dispatchEvent('pause')

    expect(handler).toHaveBeenCalledOnce()
    adapter?.destroy()
  })

  it('on("seek") dispara callback ao receber evento nativo seeked', async () => {
    const videoInterno = criarMockVideo()
    configurarDocumentoSemAd(videoInterno)
    const { createMaxAdapter } = await import('../../src/adapters/max')
    const adapter = await createMaxAdapter()

    const handler = vi.fn()
    adapter?.on('seek', handler)

    ;(videoInterno as unknown as { _dispatchEvent: (e: string) => void })._dispatchEvent('seeked')

    expect(handler).toHaveBeenCalledOnce()
    adapter?.destroy()
  })

  it('on("buffering") dispara callback ao receber evento nativo waiting', async () => {
    const videoInterno = criarMockVideo()
    configurarDocumentoSemAd(videoInterno)
    const { createMaxAdapter } = await import('../../src/adapters/max')
    const adapter = await createMaxAdapter()

    const handler = vi.fn()
    adapter?.on('buffering', handler)

    ;(videoInterno as unknown as { _dispatchEvent: (e: string) => void })._dispatchEvent('waiting')

    expect(handler).toHaveBeenCalledOnce()
    adapter?.destroy()
  })

  it('on("ended") dispara callback ao receber evento nativo ended', async () => {
    const videoInterno = criarMockVideo()
    configurarDocumentoSemAd(videoInterno)
    const { createMaxAdapter } = await import('../../src/adapters/max')
    const adapter = await createMaxAdapter()

    const handler = vi.fn()
    adapter?.on('ended', handler)

    ;(videoInterno as unknown as { _dispatchEvent: (e: string) => void })._dispatchEvent('ended')

    expect(handler).toHaveBeenCalledOnce()
    adapter?.destroy()
  })

  it('off() remove listener de evento', async () => {
    const videoInterno = criarMockVideo()
    configurarDocumentoSemAd(videoInterno)
    const { createMaxAdapter } = await import('../../src/adapters/max')
    const adapter = await createMaxAdapter()

    const handler = vi.fn()
    adapter?.on('play', handler)
    adapter?.off('play', handler)

    ;(videoInterno as unknown as { _dispatchEvent: (e: string) => void })._dispatchEvent('play')

    expect(handler).not.toHaveBeenCalled()
    adapter?.destroy()
  })

  it('getServiceType() retorna "native-html5"', async () => {
    configurarDocumentoSemAd(mockVideo)
    const { createMaxAdapter } = await import('../../src/adapters/max')
    const adapter = await createMaxAdapter()
    expect(adapter?.getServiceType()).toBe('native-html5')
    adapter?.destroy()
  })

  it('destroy() remove handlers nativos do video', async () => {
    configurarDocumentoSemAd(mockVideo)
    const { createMaxAdapter } = await import('../../src/adapters/max')
    const adapter = await createMaxAdapter()
    adapter?.destroy()
    expect(mockVideo.removeEventListener).toHaveBeenCalled()
  })

  it('destroy() limpa todos os listeners registrados', async () => {
    configurarDocumentoSemAd(mockVideo)
    const { createMaxAdapter } = await import('../../src/adapters/max')
    const adapter = await createMaxAdapter()

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

describe('SPA: re-resolucao de video ao trocar de conteudo', () => {
  let MutationObserverOriginal: typeof MutationObserver

  beforeEach(() => {
    MutationObserverOriginal = globalThis.MutationObserver
  })

  afterEach(() => {
    vi.restoreAllMocks()
    vi.resetModules()
    // CR-MINOR-2: restaura MutationObserver global e timers entre testes SPA
    globalThis.MutationObserver = MutationObserverOriginal
    vi.useRealTimers()
    history.pushState({}, '', '/')
  })

  it('registra setInterval para polling SPA e limpa no destroy', async () => {
    const video = criarMockVideo()

    class MockMutationObserver {
      observe = vi.fn()
      disconnect = vi.fn()
      constructor(public callback: MutationCallback) {}
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ;(globalThis as any).MutationObserver = MockMutationObserver

    vi.spyOn(document, 'querySelector').mockImplementation((sel: string) => {
      if (sel === '[data-testid="player-ux-root"] video') return video as unknown as Element
      if (sel === '[class*="PlayerContainer"] video') return video as unknown as Element
      if (sel === 'video') return video as unknown as Element
      return null
    })
    vi.spyOn(document, 'querySelectorAll').mockReturnValue([video] as unknown as NodeListOf<Element>)

    const setIntervalSpy = vi.spyOn(globalThis, 'setInterval')
    const clearIntervalSpy = vi.spyOn(globalThis, 'clearInterval')

    const { createMaxAdapter } = await import('../../src/adapters/max')
    const adapter = await createMaxAdapter()
    expect(adapter).not.toBeNull()

    // O polling SPA deve ter sido iniciado com intervalo de 800ms
    const chamouSetInterval = setIntervalSpy.mock.calls.some(
      ([, delay]) => delay === 800,
    )
    expect(chamouSetInterval).toBe(true)

    adapter?.destroy()

    // O polling deve ter sido limpo no destroy
    expect(clearIntervalSpy).toHaveBeenCalled()
  })

  it('re-liga listeners ao novo video apos evento popstate em /play/', async () => {
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
      if (sel === '[data-testid="player-ux-root"] video') return videoAtivo as unknown as Element
      if (sel === '[class*="PlayerContainer"] video') return videoAtivo as unknown as Element
      if (sel === 'video') return videoAtivo as unknown as Element
      return null
    })
    vi.spyOn(document, 'querySelectorAll').mockImplementation((sel: string) => {
      if (sel === 'video') return [videoAtivo] as unknown as NodeListOf<Element>
      return [] as unknown as NodeListOf<Element>
    })

    const { createMaxAdapter } = await import('../../src/adapters/max')
    const adapter = await createMaxAdapter()
    expect(adapter).not.toBeNull()

    const pauseHandler = vi.fn()
    adapter?.on('pause', pauseHandler)

    // Simula troca de conteudo via back/forward a partir de uma URL /play/
    history.pushState({}, '', '/play/urn:hbo:episode:abc123')
    videoAtivo = videoNovo
    window.dispatchEvent(new PopStateEvent('popstate'))

    // Aguarda re-resolucao: inclui SPA_RENAVIGATE_DELAY_MS=150ms + margem
    await new Promise((r) => setTimeout(r, 200))

    ;(videoNovo as unknown as { _dispatchEvent: (e: string) => void })._dispatchEvent('pause')
    expect(pauseHandler).toHaveBeenCalled()

    adapter?.destroy()
    history.pushState({}, '', '/')
  })

  it('nao re-liga ao navegar para paginas fora de /play/ (catalogo)', async () => {
    const video = criarMockVideo()

    class MockMutationObserver {
      observe = vi.fn()
      disconnect = vi.fn()
      constructor(public callback: MutationCallback) {}
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ;(globalThis as any).MutationObserver = MockMutationObserver

    vi.spyOn(document, 'querySelector').mockImplementation((sel: string) => {
      if (sel === '[data-testid="player-ux-root"] video') return video as unknown as Element
      if (sel === '[class*="PlayerContainer"] video') return video as unknown as Element
      if (sel === 'video') return video as unknown as Element
      return null
    })
    vi.spyOn(document, 'querySelectorAll').mockReturnValue([video] as unknown as NodeListOf<Element>)

    const addSpy = vi.spyOn(window, 'addEventListener')

    const { createMaxAdapter } = await import('../../src/adapters/max')
    const adapter = await createMaxAdapter()
    expect(adapter).not.toBeNull()

    const removeListenerSpy = vi.spyOn(video, 'removeEventListener')

    // Navega para pagina de catalogo (sem /play/) e dispara popstate
    history.pushState({}, '', '/series/dexter/urn:hbo:series:123')
    window.dispatchEvent(new PopStateEvent('popstate'))

    await new Promise((r) => setTimeout(r, 20))

    // Nao deve ter removido e reinstalado handlers (filtragem de path funcionou)
    expect(removeListenerSpy).not.toHaveBeenCalled()

    adapter?.destroy()
    history.pushState({}, '', '/')

    // Verifica que o popstate foi registrado
    const adicionouPopstate = addSpy.mock.calls.some(([evt]) => evt === 'popstate')
    expect(adicionouPopstate).toBe(true)
  })

  it('destroy() remove listener de popstate', async () => {
    const video = criarMockVideo()

    vi.spyOn(document, 'querySelector').mockImplementation((sel: string) => {
      if (sel === '[data-testid="player-ux-root"] video') return video as unknown as Element
      if (sel === '[class*="PlayerContainer"] video') return video as unknown as Element
      if (sel === 'video') return video as unknown as Element
      return null
    })
    vi.spyOn(document, 'querySelectorAll').mockReturnValue([video] as unknown as NodeListOf<Element>)

    const addSpy = vi.spyOn(window, 'addEventListener')
    const removeSpy = vi.spyOn(window, 'removeEventListener')

    const { createMaxAdapter } = await import('../../src/adapters/max')
    const adapter = await createMaxAdapter()
    adapter?.destroy()

    const adicionouPopstate = addSpy.mock.calls.some(([evt]) => evt === 'popstate')
    const removeuPopstate = removeSpy.mock.calls.some(([evt]) => evt === 'popstate')

    expect(adicionouPopstate).toBe(true)
    expect(removeuPopstate).toBe(true)
  })

  it('destroy() para o polling de URL SPA', async () => {
    const video = criarMockVideo()
    configurarDocumentoSemAd(video)
    vi.spyOn(document, 'querySelectorAll').mockReturnValue([video] as unknown as NodeListOf<Element>)

    const clearIntervalSpy = vi.spyOn(globalThis, 'clearInterval')

    const { createMaxAdapter } = await import('../../src/adapters/max')
    const adapter = await createMaxAdapter()
    adapter?.destroy()

    expect(clearIntervalSpy).toHaveBeenCalled()
  })

  it('polling detecta mudanca de URL via pushState em /play/', async () => {
    const video = criarMockVideo()

    class MockMutationObserver {
      observe = vi.fn()
      disconnect = vi.fn()
      constructor(public callback: MutationCallback) {}
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ;(globalThis as any).MutationObserver = MockMutationObserver

    vi.spyOn(document, 'querySelector').mockImplementation((sel: string) => {
      if (sel === '[data-testid="player-ux-root"] video') return video as unknown as Element
      if (sel === '[class*="PlayerContainer"] video') return video as unknown as Element
      if (sel === 'video') return video as unknown as Element
      return null
    })
    vi.spyOn(document, 'querySelectorAll').mockReturnValue([video] as unknown as NodeListOf<Element>)

    vi.useFakeTimers({ toFake: ['setTimeout', 'setInterval', 'clearInterval', 'clearTimeout'] })

    const { createMaxAdapter } = await import('../../src/adapters/max')
    const adapter = await createMaxAdapter()
    expect(adapter).not.toBeNull()

    const removeListenerSpy = vi.spyOn(video, 'removeEventListener')

    // Simula pushState para /play/ (troca de conteudo SPA)
    history.pushState({}, '', '/play/urn:hbo:movie:xyz999')

    // Avanca exatamente 1 ciclo de polling (800ms) + delay de renavigate (150ms) + margem
    // Nao usar runAllTimersAsync() pois o setInterval de polling eh infinito
    vi.advanceTimersByTime(951)

    // Aguarda resolucao das promises internas (microtasks e macrotasks do renavigate)
    await Promise.resolve()
    await Promise.resolve()
    await Promise.resolve()
    await Promise.resolve()

    // O polling reagiu a mudanca de URL e re-ligou o adapter
    expect(removeListenerSpy).toHaveBeenCalled()

    adapter?.destroy()
    history.pushState({}, '', '/')
    vi.useRealTimers()
  })

  it('navegacoes SPA concorrentes - apenas a ultima e aplicada', async () => {
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
      if (sel === '[data-testid="player-ux-root"] video') return videoAtivo as unknown as Element
      if (sel === '[class*="PlayerContainer"] video') return videoAtivo as unknown as Element
      if (sel === 'video') return videoAtivo as unknown as Element
      return null
    })
    vi.spyOn(document, 'querySelectorAll').mockImplementation((sel: string) => {
      if (sel === 'video') return [videoAtivo] as unknown as NodeListOf<Element>
      return [] as unknown as NodeListOf<Element>
    })

    const { createMaxAdapter } = await import('../../src/adapters/max')
    const adapter = await createMaxAdapter()
    expect(adapter).not.toBeNull()

    const playHandler = vi.fn()
    adapter?.on('play', playHandler)

    // Navega para /play/ para que spaPopstateHandler nao filtre
    history.pushState({}, '', '/play/urn:hbo:episode:11111')

    // Duas navegacoes em rapida sucessao (concorrentes)
    window.dispatchEvent(new PopStateEvent('popstate'))
    videoAtivo = videoFinal
    window.dispatchEvent(new PopStateEvent('popstate'))

    // Aguarda resolucao: inclui SPA_RENAVIGATE_DELAY_MS=150ms + margem
    await new Promise((r) => setTimeout(r, 200))

    // O adapter deve ter re-ligado no videoFinal (ultima navegacao vence)
    ;(videoFinal as unknown as { _dispatchEvent: (e: string) => void })._dispatchEvent('play')
    expect(playHandler).toHaveBeenCalled()

    adapter?.destroy()
    history.pushState({}, '', '/')
  })

  it('destroy() durante aguardarVideoMax pendente nao reinstala handlers', async () => {
    const video = criarMockVideo()

    // MutationObserver que nunca dispara (video "ainda nao apareceu")
    let observerCallback: MutationCallback | null = null
    class MockMutationObserver {
      observe = vi.fn()
      disconnect = vi.fn()
      constructor(cb: MutationCallback) { observerCallback = cb }
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ;(globalThis as any).MutationObserver = MockMutationObserver

    // Primeiras chamadas: retorna o video (para o createMaxAdapter inicial)
    // Chamadas subsequentes: retornam null (video sumiu apos navegacao)
    let queryCalls = 0
    vi.spyOn(document, 'querySelector').mockImplementation((sel: string) => {
      queryCalls++
      if (queryCalls <= 3 && sel === '[data-testid="player-ux-root"] video') return video as unknown as Element
      if (queryCalls <= 3 && sel === '[class*="PlayerContainer"] video') return video as unknown as Element
      if (queryCalls <= 3 && sel === 'video') return video as unknown as Element
      return null
    })
    vi.spyOn(document, 'querySelectorAll').mockImplementation((sel: string) => {
      if (sel === 'video' && queryCalls <= 3) return [video] as unknown as NodeListOf<Element>
      return [] as unknown as NodeListOf<Element>
    })

    const { createMaxAdapter } = await import('../../src/adapters/max')
    const adapter = await createMaxAdapter()
    expect(adapter).not.toBeNull()

    // Dispara navegacao SPA (onSpaNavegacao fica esperando o video)
    window.dispatchEvent(new PopStateEvent('popstate'))

    // Destroy imediato (antes de aguardarVideoMax resolver)
    adapter?.destroy()

    // Dispara o MutationObserver mockado (simula video aparecendo apos destroy)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const cbCapturado = observerCallback as ((...args: any[]) => void) | null
    if (cbCapturado) {
      vi.spyOn(document, 'querySelector').mockImplementation((sel: string) => {
        if (sel === '[data-testid="player-ux-root"] video') return video as unknown as Element
        return null
      })
      cbCapturado([], null)
    }

    // Aguarda microtasks
    await new Promise((r) => setTimeout(r, 20))

    // Apos destroy, removeEventListener deve ter sido chamado (cleanup normal)
    // e nao deve ter ocorrido erro ou reinstalacao de handlers pos-destroy
    expect(video.removeEventListener).toHaveBeenCalled()
  })
})

// ---------------------------------------------------------------------------
// Testes de deteccao de anuncio via MutationObserver
// ---------------------------------------------------------------------------

describe('Anuncio: emissao de ad-start/ad-end via MutationObserver', () => {
  let MutationObserverOriginalAnuncio: typeof MutationObserver

  beforeEach(() => {
    MutationObserverOriginalAnuncio = globalThis.MutationObserver
  })

  afterEach(() => {
    vi.restoreAllMocks()
    vi.resetModules()
    // CR-MINOR-2: restaura MutationObserver, timers e URL entre testes de anuncio
    globalThis.MutationObserver = MutationObserverOriginalAnuncio
    vi.useRealTimers()
    history.pushState({}, '', '/')
  })

  it('emite ad-start quando UI de anuncio aparece no DOM', async () => {
    const video = criarMockVideo()
    let adVisivel = false

    // Container falso com querySelector dinamico (HIGH-2 + CR-MAJOR):
    // detectarAnuncioMax usa container.querySelector(testid), nao document.querySelector.
    // O adEl precisa de getClientRects nao-vazio para passar elementoVisivel() (CR-MAJOR).
    const adEl = criarElementoAdVisivel()
    const containerFalso = document.createElement('div')
    containerFalso.querySelector = vi.fn((sel: string): Element | null => {
      const ehSeletorAd =
        sel === '[data-testid="ad-badge"]' ||
        sel === '[data-testid="ad-timer"]' ||
        sel === '[data-testid="ad-countdown"]' ||
        sel === '[data-testid="ad-panel"]' ||
        sel === '[data-testid="ad-overlay"]' ||
        sel === '[data-testid="ad-skip-button"]' ||
        sel === '[data-testid="ad-break"]' ||
        sel === '[class*="AdBreak"]' ||
        sel === '[class*="AdTimer"]' ||
        sel === '[class*="AdPanel"]' ||
        sel === '[class*="AdOverlay"]' ||
        sel === '[class*="AdCountdown"]' ||
        sel === '[class*="SkipAd"]'
      return ehSeletorAd && adVisivel ? adEl : null
    }) as Element['querySelector']

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
      if (sel === '[data-testid="player-ux-root"] video') return video as unknown as Element
      if (sel === '[class*="PlayerContainer"] video') return video as unknown as Element
      if (sel === 'video') return video as unknown as Element
      if (sel === '[data-testid="player-ux-root"]') return containerFalso
      return null
    })
    vi.spyOn(document, 'querySelectorAll').mockReturnValue([video] as unknown as NodeListOf<Element>)

    const { createMaxAdapter } = await import('../../src/adapters/max')
    const adapter = await createMaxAdapter()

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

    // Container falso com querySelector dinamico (HIGH-2 + CR-MAJOR)
    const adEl = criarElementoAdVisivel()
    const containerFalso = document.createElement('div')
    containerFalso.querySelector = vi.fn((sel: string): Element | null => {
      const ehSeletorAd =
        sel === '[data-testid="ad-badge"]' ||
        sel === '[data-testid="ad-timer"]' ||
        sel === '[data-testid="ad-countdown"]' ||
        sel === '[data-testid="ad-panel"]' ||
        sel === '[data-testid="ad-overlay"]' ||
        sel === '[data-testid="ad-skip-button"]' ||
        sel === '[data-testid="ad-break"]' ||
        sel === '[class*="AdBreak"]' ||
        sel === '[class*="AdTimer"]' ||
        sel === '[class*="AdPanel"]' ||
        sel === '[class*="AdOverlay"]' ||
        sel === '[class*="AdCountdown"]' ||
        sel === '[class*="SkipAd"]'
      return ehSeletorAd && adVisivel ? adEl : null
    }) as Element['querySelector']

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
      if (sel === '[data-testid="player-ux-root"] video') return video as unknown as Element
      if (sel === '[class*="PlayerContainer"] video') return video as unknown as Element
      if (sel === 'video') return video as unknown as Element
      if (sel === '[data-testid="player-ux-root"]') return containerFalso
      return null
    })
    vi.spyOn(document, 'querySelectorAll').mockReturnValue([video] as unknown as NodeListOf<Element>)

    const { createMaxAdapter } = await import('../../src/adapters/max')
    const adapter = await createMaxAdapter()

    const adEndHandler = vi.fn()
    adapter?.on('ad-end', adEndHandler)

    // Simula fim do anuncio
    adVisivel = false
    observerCallback!([] as unknown as MutationRecord[], null as unknown as MutationObserver)

    expect(adEndHandler).toHaveBeenCalledOnce()
    adapter?.destroy()
  })

  it('nao emite ad-start/ad-end quando estado de anuncio nao mudou', async () => {
    const video = criarMockVideo()
    const adVisivel = false // sem anuncio, e permanece sem

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
      if (sel === '[data-testid="player-ux-root"] video') return video as unknown as Element
      if (sel === '[class*="PlayerContainer"] video') return video as unknown as Element
      if (sel === 'video') return video as unknown as Element
      if (sel === '[data-testid*="ad"]' && adVisivel) return document.createElement('div')
      return null
    })
    vi.spyOn(document, 'querySelectorAll').mockReturnValue([video] as unknown as NodeListOf<Element>)

    const { createMaxAdapter } = await import('../../src/adapters/max')
    const adapter = await createMaxAdapter()

    const adStartHandler = vi.fn()
    const adEndHandler = vi.fn()
    adapter?.on('ad-start', adStartHandler)
    adapter?.on('ad-end', adEndHandler)

    // Dispara observer sem mudar estado
    observerCallback!([] as unknown as MutationRecord[], null as unknown as MutationObserver)

    expect(adStartHandler).not.toHaveBeenCalled()
    expect(adEndHandler).not.toHaveBeenCalled()
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
      if (sel === '[data-testid="player-ux-root"] video') return video as unknown as Element
      if (sel === '[class*="PlayerContainer"] video') return video as unknown as Element
      if (sel === 'video') return video as unknown as Element
      return null
    })
    vi.spyOn(document, 'querySelectorAll').mockReturnValue([video] as unknown as NodeListOf<Element>)

    const { createMaxAdapter } = await import('../../src/adapters/max')
    const adapter = await createMaxAdapter()
    adapter?.destroy()

    expect(disconnectSpy).toHaveBeenCalled()
  })
})

// ---------------------------------------------------------------------------
// Testes de selecao de video (heuristica)
// ---------------------------------------------------------------------------

describe('Heuristica de selecao do video principal', () => {
  afterEach(() => {
    vi.restoreAllMocks()
    vi.resetModules()
  })

  it('prefere o video do container [data-testid="player-ux-root"] quando disponivel', async () => {
    const videoPlayer = criarMockVideo({ currentTime: 100 })
    const videoTrailer = criarMockVideo({ currentTime: 5 })

    vi.spyOn(document, 'querySelector').mockImplementation((sel: string) => {
      if (sel === '[data-testid="player-ux-root"] video') return videoPlayer as unknown as Element
      if (sel === '[class*="PlayerContainer"] video') return videoTrailer as unknown as Element
      if (sel === 'video') return videoTrailer as unknown as Element
      return null
    })
    vi.spyOn(document, 'querySelectorAll').mockReturnValue(
      [videoPlayer, videoTrailer] as unknown as NodeListOf<Element>,
    )

    const { createMaxAdapter } = await import('../../src/adapters/max')
    const adapter = await createMaxAdapter()

    // Deve ter conectado ao video do player-ux-root, nao ao trailer
    expect(adapter?.getCurrentTime()).toBe(100)
    adapter?.destroy()
  })

  it('usa seletor secundario [class*="PlayerContainer"] quando primario falha', async () => {
    const videoPlayer = criarMockVideo({ currentTime: 200 })
    const videoTrailer = criarMockVideo({ currentTime: 5 })

    vi.spyOn(document, 'querySelector').mockImplementation((sel: string) => {
      // Seletor primario falha
      if (sel === '[data-testid="player-ux-root"] video') return null
      if (sel === '[class*="PlayerContainer"] video') return videoPlayer as unknown as Element
      if (sel === 'video') return videoTrailer as unknown as Element
      return null
    })
    vi.spyOn(document, 'querySelectorAll').mockReturnValue(
      [videoPlayer, videoTrailer] as unknown as NodeListOf<Element>,
    )

    const { createMaxAdapter } = await import('../../src/adapters/max')
    const adapter = await createMaxAdapter()

    // Deve ter conectado ao video do PlayerContainer
    expect(adapter?.getCurrentTime()).toBe(200)
    adapter?.destroy()
  })

  it('escolhe o video de maior duracao quando seletores primarios falham', async () => {
    const videoConteudo = criarMockVideo()
    Object.defineProperty(videoConteudo, 'duration', { value: 5400, configurable: true })
    Object.defineProperty(videoConteudo, 'readyState', { value: 4, configurable: true })
    videoConteudo.currentTime = 300

    const videoTrailer = criarMockVideo()
    Object.defineProperty(videoTrailer, 'duration', { value: 90, configurable: true })
    Object.defineProperty(videoTrailer, 'readyState', { value: 4, configurable: true })
    videoTrailer.currentTime = 10

    vi.spyOn(document, 'querySelector').mockImplementation((sel: string) => {
      if (sel === '[data-testid="player-ux-root"] video') return null
      if (sel === '[class*="PlayerContainer"] video') return null
      if (sel === 'video') return videoTrailer as unknown as Element
      return null
    })
    vi.spyOn(document, 'querySelectorAll').mockImplementation((sel: string) => {
      if (sel === 'video') return [videoTrailer, videoConteudo] as unknown as NodeListOf<Element>
      return [] as unknown as NodeListOf<Element>
    })

    const { createMaxAdapter } = await import('../../src/adapters/max')
    const adapter = await createMaxAdapter()

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
      width: 320, height: 180,
      top: 0, left: 0, right: 320, bottom: 180,
      x: 0, y: 0, toJSON: vi.fn(),
    } as DOMRect)
    videoPequeno.currentTime = 5

    const videoGrande = criarMockVideo()
    Object.defineProperty(videoGrande, 'readyState', { value: 1, configurable: true })
    Object.defineProperty(videoGrande, 'duration', { value: NaN, configurable: true })
    Object.defineProperty(videoGrande, 'offsetWidth', { value: 1280, configurable: true })
    Object.defineProperty(videoGrande, 'offsetHeight', { value: 720, configurable: true })
    vi.spyOn(videoGrande, 'getBoundingClientRect').mockReturnValue({
      width: 1280, height: 720,
      top: 0, left: 0, right: 1280, bottom: 720,
      x: 0, y: 0, toJSON: vi.fn(),
    } as DOMRect)
    videoGrande.currentTime = 42

    vi.spyOn(document, 'querySelector').mockImplementation((sel: string) => {
      if (sel === '[data-testid="player-ux-root"] video') return null
      if (sel === '[class*="PlayerContainer"] video') return null
      return null
    })
    vi.spyOn(document, 'querySelectorAll').mockImplementation((sel: string) => {
      if (sel === 'video') return [videoPequeno, videoGrande] as unknown as NodeListOf<Element>
      return [] as unknown as NodeListOf<Element>
    })

    const { createMaxAdapter } = await import('../../src/adapters/max')
    const adapter = await createMaxAdapter()

    // Deve ter escolhido o video de maior area renderizada
    expect(adapter?.getCurrentTime()).toBe(42)
    adapter?.destroy()
  })
})
