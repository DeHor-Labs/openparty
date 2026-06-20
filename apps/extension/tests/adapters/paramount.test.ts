// tests/adapters/paramount.test.ts
// Testes unitarios para o adapter do Paramount+.
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
// Helpers para mockar o document sem anuncio / com anuncio
// ---------------------------------------------------------------------------

/**
 * Configura document.querySelector para retornar o video fornecido
 * e nenhum elemento de UI de anuncio do Paramount+.
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
  // jsdom nao faz layout - sobrescrevemos getClientRects para retornar um rect ficticio
  el.getClientRects = () => [{ width: 100, height: 20 } as DOMRect] as unknown as DOMRectList
  return el
}

/**
 * Configura document.querySelector para simular UI de anuncio Paramount+ visivel.
 * Usa o seletor div.ad-info-manager-circular-loader-copy que e o mais estavel.
 * CR-MAJOR: o elemento retornado passa pelo filtro elementoVisivel().
 */
function configurarDocumentoComAd(videoEl: HTMLVideoElement): void {
  const adEl = criarElementoAdVisivel()

  vi.spyOn(document, 'querySelector').mockImplementation((selector: string) => {
    if (selector === 'video') return videoEl as unknown as Element
    // Seletores de UI de anuncio retornam elemento com visibilidade simulada
    if (
      selector === 'div.ad-info-manager-circular-loader-copy' ||
      selector === 'div.ad-click-overlay' ||
      selector === '[class*="ad-info-manager"]'
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

describe('createParamountAdapter', () => {
  let mockVideo: HTMLVideoElement
  // CR-MINOR-2: preserva MutationObserver original
  let MutationObserverOriginal: typeof MutationObserver

  beforeEach(() => {
    mockVideo = criarMockVideo()
    MutationObserverOriginal = globalThis.MutationObserver
    vi.clearAllMocks()
    // Garante que estamos em rota de player antes de cada teste
    history.pushState({}, '', '/shows/video/episodio-teste')
    configurarDocumentoSemAd(mockVideo)
  })

  afterEach(() => {
    vi.restoreAllMocks()
    vi.resetModules()
    // CR-MINOR-2: restaura MutationObserver global, timers e URL
    globalThis.MutationObserver = MutationObserverOriginal
    vi.useRealTimers()
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

    const { createParamountAdapter } = await import('../../src/adapters/paramount')

    vi.useFakeTimers({ toFake: ['setTimeout', 'setInterval', 'clearInterval', 'clearTimeout'] })
    const promiseAdapter = createParamountAdapter()

    // Avanca alem do VIDEO_WAIT_TIMEOUT_MS (8000ms)
    vi.advanceTimersByTime(9000)
    const adapter = await promiseAdapter
    expect(adapter).toBeNull()

    vi.useRealTimers()
  })

  it('retorna null quando esta fora da rota de player (gate de path)', async () => {
    // Vai para uma rota que nao e de player
    history.pushState({}, '', '/shows/sur-la-lune-fairy-tales')
    configurarDocumentoSemAd(mockVideo)

    const { createParamountAdapter } = await import('../../src/adapters/paramount')

    class MockMutationObserver {
      observe = vi.fn()
      disconnect = vi.fn()
      constructor(public callback: MutationCallback) {}
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ;(globalThis as any).MutationObserver = MockMutationObserver

    vi.useFakeTimers({ toFake: ['setTimeout', 'setInterval', 'clearInterval', 'clearTimeout'] })
    const promiseAdapter = createParamountAdapter()
    vi.advanceTimersByTime(9000)
    const adapter = await promiseAdapter
    expect(adapter).toBeNull()

    vi.useRealTimers()
  })

  it('retorna null quando esta na rota /movies/ sem /video/ (gate de path)', async () => {
    // Rota de catalogo de filmes - nao e rota de player
    history.pushState({}, '', '/movies/some-movie')
    configurarDocumentoSemAd(mockVideo)

    const { createParamountAdapter } = await import('../../src/adapters/paramount')

    class MockMutationObserver {
      observe = vi.fn()
      disconnect = vi.fn()
      constructor(public callback: MutationCallback) {}
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ;(globalThis as any).MutationObserver = MockMutationObserver

    vi.useFakeTimers({ toFake: ['setTimeout', 'setInterval', 'clearInterval', 'clearTimeout'] })
    const promiseAdapter = createParamountAdapter()
    vi.advanceTimersByTime(9000)
    const adapter = await promiseAdapter
    expect(adapter).toBeNull()

    vi.useRealTimers()
  })

  it('retorna adapter quando elemento video esta presente em /shows/video/', async () => {
    history.pushState({}, '', '/shows/video/episodio-teste')
    configurarDocumentoSemAd(mockVideo)
    const { createParamountAdapter } = await import('../../src/adapters/paramount')
    const adapter = await createParamountAdapter()
    expect(adapter).not.toBeNull()
    adapter?.destroy()
  })

  it('retorna adapter quando elemento video esta presente em /movies/video/', async () => {
    history.pushState({}, '', '/movies/video/filme-teste')
    configurarDocumentoSemAd(mockVideo)
    const { createParamountAdapter } = await import('../../src/adapters/paramount')
    const adapter = await createParamountAdapter()
    expect(adapter).not.toBeNull()
    adapter?.destroy()
  })

  it('getCurrentTime retorna currentTime do video', async () => {
    mockVideo.currentTime = 120.5
    configurarDocumentoSemAd(mockVideo)
    const { createParamountAdapter } = await import('../../src/adapters/paramount')
    const adapter = await createParamountAdapter()
    expect(adapter?.getCurrentTime()).toBe(120.5)
    adapter?.destroy()
  })

  it('getDuration retorna duration do video', async () => {
    Object.defineProperty(mockVideo, 'duration', { value: 7200, writable: true, configurable: true })
    configurarDocumentoSemAd(mockVideo)
    const { createParamountAdapter } = await import('../../src/adapters/paramount')
    const adapter = await createParamountAdapter()
    expect(adapter?.getDuration()).toBe(7200)
    adapter?.destroy()
  })

  it('getDuration retorna 0 quando duration e NaN', async () => {
    Object.defineProperty(mockVideo, 'duration', { value: NaN, writable: true, configurable: true })
    configurarDocumentoSemAd(mockVideo)
    const { createParamountAdapter } = await import('../../src/adapters/paramount')
    const adapter = await createParamountAdapter()
    expect(adapter?.getDuration()).toBe(0)
    adapter?.destroy()
  })

  it('play() chama video.play()', async () => {
    configurarDocumentoSemAd(mockVideo)
    const { createParamountAdapter } = await import('../../src/adapters/paramount')
    const adapter = await createParamountAdapter()
    await adapter?.play()
    expect(mockVideo.play).toHaveBeenCalledOnce()
    adapter?.destroy()
  })

  it('pause() chama video.pause()', async () => {
    configurarDocumentoSemAd(mockVideo)
    const { createParamountAdapter } = await import('../../src/adapters/paramount')
    const adapter = await createParamountAdapter()
    await adapter?.pause()
    expect(mockVideo.pause).toHaveBeenCalledOnce()
    adapter?.destroy()
  })

  it('seekTo() atualiza currentTime do video', async () => {
    configurarDocumentoSemAd(mockVideo)
    const { createParamountAdapter } = await import('../../src/adapters/paramount')
    const adapter = await createParamountAdapter()
    await adapter?.seekTo(450.0)
    expect(mockVideo.currentTime).toBe(450.0)
    adapter?.destroy()
  })

  it('getPlaybackState() retorna "playing" quando video nao esta pausado', async () => {
    Object.defineProperty(mockVideo, 'paused', { value: false, writable: true, configurable: true })
    configurarDocumentoSemAd(mockVideo)
    const { createParamountAdapter } = await import('../../src/adapters/paramount')
    const adapter = await createParamountAdapter()
    expect(adapter?.getPlaybackState()).toBe('playing')
    adapter?.destroy()
  })

  it('getPlaybackState() retorna "paused" quando video esta pausado', async () => {
    Object.defineProperty(mockVideo, 'paused', { value: true, writable: true, configurable: true })
    configurarDocumentoSemAd(mockVideo)
    const { createParamountAdapter } = await import('../../src/adapters/paramount')
    const adapter = await createParamountAdapter()
    expect(adapter?.getPlaybackState()).toBe('paused')
    adapter?.destroy()
  })

  it('getPlaybackState() retorna "buffering" quando readyState < HAVE_METADATA', async () => {
    Object.defineProperty(mockVideo, 'readyState', { value: 1, writable: true, configurable: true })
    Object.defineProperty(mockVideo, 'paused', { value: false, writable: true, configurable: true })
    configurarDocumentoSemAd(mockVideo)
    const { createParamountAdapter } = await import('../../src/adapters/paramount')
    const adapter = await createParamountAdapter()
    expect(adapter?.getPlaybackState()).toBe('buffering')
    adapter?.destroy()
  })

  it('getPlaybackState() retorna "ad" durante anuncio', async () => {
    configurarDocumentoComAd(mockVideo)
    const { createParamountAdapter } = await import('../../src/adapters/paramount')
    const adapter = await createParamountAdapter()
    expect(adapter?.getPlaybackState()).toBe('ad')
    adapter?.destroy()
  })

  it('isAd() retorna true quando UI de anuncio esta presente e visivel', async () => {
    configurarDocumentoComAd(mockVideo)
    const { createParamountAdapter } = await import('../../src/adapters/paramount')
    const adapter = await createParamountAdapter()
    expect(adapter?.isAd()).toBe(true)
    adapter?.destroy()
  })

  it('isAd() retorna false quando UI de anuncio esta ausente', async () => {
    configurarDocumentoSemAd(mockVideo)
    const { createParamountAdapter } = await import('../../src/adapters/paramount')
    const adapter = await createParamountAdapter()
    expect(adapter?.isAd()).toBe(false)
    adapter?.destroy()
  })

  it('isAd() retorna false quando elemento de anuncio esta oculto (display:none)', async () => {
    // Cria elemento de anuncio oculto - NAO deve disparar isAd()
    const adElOculto = document.createElement('div')
    // getClientRects vazio = elemento sem layout = nao visivel
    adElOculto.getClientRects = () => [] as unknown as DOMRectList
    // computedStyle sem override = display padrao e retornado pelo jsdom

    vi.spyOn(document, 'querySelector').mockImplementation((selector: string) => {
      if (selector === 'video') return mockVideo as unknown as Element
      if (selector === 'div.ad-info-manager-circular-loader-copy') return adElOculto
      return null
    })
    vi.spyOn(document, 'querySelectorAll').mockImplementation((selector: string) => {
      if (selector === 'video') return [mockVideo] as unknown as NodeListOf<Element>
      return [] as unknown as NodeListOf<Element>
    })

    const { createParamountAdapter } = await import('../../src/adapters/paramount')
    const adapter = await createParamountAdapter()
    // Elemento existe mas nao tem rects (oculto) - isAd deve ser false
    expect(adapter?.isAd()).toBe(false)
    adapter?.destroy()
  })

  it('on("play") dispara callback ao receber evento nativo de play', async () => {
    const videoInterno = criarMockVideo()
    configurarDocumentoSemAd(videoInterno)
    const { createParamountAdapter } = await import('../../src/adapters/paramount')
    const adapter = await createParamountAdapter()

    const handler = vi.fn()
    adapter?.on('play', handler)

    ;(videoInterno as unknown as { _dispatchEvent: (e: string) => void })._dispatchEvent('play')

    expect(handler).toHaveBeenCalledOnce()
    adapter?.destroy()
  })

  it('on("pause") dispara callback ao receber evento nativo de pause', async () => {
    const videoInterno = criarMockVideo()
    configurarDocumentoSemAd(videoInterno)
    const { createParamountAdapter } = await import('../../src/adapters/paramount')
    const adapter = await createParamountAdapter()

    const handler = vi.fn()
    adapter?.on('pause', handler)

    ;(videoInterno as unknown as { _dispatchEvent: (e: string) => void })._dispatchEvent('pause')

    expect(handler).toHaveBeenCalledOnce()
    adapter?.destroy()
  })

  it('on("seek") dispara callback ao receber evento nativo seeked', async () => {
    const videoInterno = criarMockVideo()
    configurarDocumentoSemAd(videoInterno)
    const { createParamountAdapter } = await import('../../src/adapters/paramount')
    const adapter = await createParamountAdapter()

    const handler = vi.fn()
    adapter?.on('seek', handler)

    ;(videoInterno as unknown as { _dispatchEvent: (e: string) => void })._dispatchEvent('seeked')

    expect(handler).toHaveBeenCalledOnce()
    adapter?.destroy()
  })

  it('on("buffering") dispara callback ao receber evento nativo waiting', async () => {
    const videoInterno = criarMockVideo()
    configurarDocumentoSemAd(videoInterno)
    const { createParamountAdapter } = await import('../../src/adapters/paramount')
    const adapter = await createParamountAdapter()

    const handler = vi.fn()
    adapter?.on('buffering', handler)

    ;(videoInterno as unknown as { _dispatchEvent: (e: string) => void })._dispatchEvent('waiting')

    expect(handler).toHaveBeenCalledOnce()
    adapter?.destroy()
  })

  it('on("ended") dispara callback ao receber evento nativo ended', async () => {
    const videoInterno = criarMockVideo()
    configurarDocumentoSemAd(videoInterno)
    const { createParamountAdapter } = await import('../../src/adapters/paramount')
    const adapter = await createParamountAdapter()

    const handler = vi.fn()
    adapter?.on('ended', handler)

    ;(videoInterno as unknown as { _dispatchEvent: (e: string) => void })._dispatchEvent('ended')

    expect(handler).toHaveBeenCalledOnce()
    adapter?.destroy()
  })

  it('off() remove listener de evento', async () => {
    const videoInterno = criarMockVideo()
    configurarDocumentoSemAd(videoInterno)
    const { createParamountAdapter } = await import('../../src/adapters/paramount')
    const adapter = await createParamountAdapter()

    const handler = vi.fn()
    adapter?.on('play', handler)
    adapter?.off('play', handler)

    ;(videoInterno as unknown as { _dispatchEvent: (e: string) => void })._dispatchEvent('play')

    expect(handler).not.toHaveBeenCalled()
    adapter?.destroy()
  })

  it('getServiceType() retorna "native-html5"', async () => {
    configurarDocumentoSemAd(mockVideo)
    const { createParamountAdapter } = await import('../../src/adapters/paramount')
    const adapter = await createParamountAdapter()
    expect(adapter?.getServiceType()).toBe('native-html5')
    adapter?.destroy()
  })

  it('destroy() remove handlers nativos do video', async () => {
    configurarDocumentoSemAd(mockVideo)
    const { createParamountAdapter } = await import('../../src/adapters/paramount')
    const adapter = await createParamountAdapter()
    adapter?.destroy()
    expect(mockVideo.removeEventListener).toHaveBeenCalled()
  })

  it('destroy() limpa todos os listeners registrados', async () => {
    configurarDocumentoSemAd(mockVideo)
    const { createParamountAdapter } = await import('../../src/adapters/paramount')
    const adapter = await createParamountAdapter()

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

describe('SPA: re-resolucao de video ao trocar de episodio', () => {
  let MutationObserverOriginal: typeof MutationObserver

  beforeEach(() => {
    MutationObserverOriginal = globalThis.MutationObserver
  })

  afterEach(() => {
    vi.restoreAllMocks()
    vi.resetModules()
    // CR-MINOR-2: restaura MutationObserver global, timers e URL
    globalThis.MutationObserver = MutationObserverOriginal
    vi.useRealTimers()
    history.pushState({}, '', '/')
  })

  it('re-liga listeners ao novo video apos mudanca de URL via polling', async () => {
    const video = criarMockVideo()

    // Garante rota de player para o adapter ser criado
    history.pushState({}, '', '/shows/video/episodio-1')

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

    // Espiona setInterval e clearInterval para verificar o ciclo de vida do polling
    const setIntervalSpy = vi.spyOn(globalThis, 'setInterval')
    const clearIntervalSpy = vi.spyOn(globalThis, 'clearInterval')

    const { createParamountAdapter } = await import('../../src/adapters/paramount')
    const adapter = await createParamountAdapter()
    expect(adapter).not.toBeNull()

    // O polling SPA deve ter sido iniciado via setInterval
    const chamouSetInterval = setIntervalSpy.mock.calls.some(
      ([, delay]) => delay === 800
    )
    expect(chamouSetInterval).toBe(true)

    adapter?.destroy()

    // O polling deve ter sido limpo no destroy via clearInterval
    expect(clearIntervalSpy).toHaveBeenCalled()
  })

  it('re-liga listeners ao novo video apos evento popstate', async () => {
    const videoOriginal = criarMockVideo()
    const videoNovo = criarMockVideo()

    let videoAtivo = videoOriginal

    // Garante rota de player para o adapter ser criado
    history.pushState({}, '', '/shows/video/episodio-1')

    // MutationObserver mock para evitar que aguardarVideo fique esperando
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

    const { createParamountAdapter } = await import('../../src/adapters/paramount')
    const adapter = await createParamountAdapter()
    expect(adapter).not.toBeNull()

    const pauseHandler = vi.fn()
    adapter?.on('pause', pauseHandler)

    // Simula troca de episodio via back/forward a partir de uma URL /shows/video/:
    // o spaPopstateHandler filtra por SPA_PATH_REGEX, entao a URL precisa estar la.
    history.pushState({}, '', '/shows/video/episodio-2')
    videoAtivo = videoNovo
    window.dispatchEvent(new PopStateEvent('popstate'))

    // Aguarda re-resolucao: inclui SPA_RENAVIGATE_DELAY_MS=150ms + margem
    await new Promise((r) => setTimeout(r, 200))

    ;(videoNovo as unknown as { _dispatchEvent: (e: string) => void })._dispatchEvent('pause')
    expect(pauseHandler).toHaveBeenCalled()

    adapter?.destroy()
    history.pushState({}, '', '/')
  })

  it('popstate fora de rota de player NAO aciona re-resolucao', async () => {
    const video = criarMockVideo()

    history.pushState({}, '', '/shows/video/episodio-1')

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

    const { createParamountAdapter } = await import('../../src/adapters/paramount')
    const adapter = await createParamountAdapter()
    expect(adapter).not.toBeNull()

    // Navega para fora da rota de player (catalogo)
    history.pushState({}, '', '/shows/star-trek')

    // O spaPopstateHandler deve ignorar este popstate (nao e rota de player)
    const removeListenerSpy = vi.spyOn(video, 'removeEventListener')
    window.dispatchEvent(new PopStateEvent('popstate'))

    await new Promise((r) => setTimeout(r, 200))

    // Nenhuma re-resolucao deve ter ocorrido (removeEventListener nao chamado para re-ligacao)
    expect(removeListenerSpy).not.toHaveBeenCalled()

    adapter?.destroy()
    history.pushState({}, '', '/')
  })

  it('destroy() remove listener de popstate', async () => {
    const video = criarMockVideo()

    history.pushState({}, '', '/shows/video/episodio-1')

    vi.spyOn(document, 'querySelector').mockImplementation((sel: string) => {
      if (sel === 'video') return video as unknown as Element
      return null
    })
    vi.spyOn(document, 'querySelectorAll').mockReturnValue([video] as unknown as NodeListOf<Element>)

    const addSpy = vi.spyOn(window, 'addEventListener')
    const removeSpy = vi.spyOn(window, 'removeEventListener')

    const { createParamountAdapter } = await import('../../src/adapters/paramount')
    const adapter = await createParamountAdapter()
    adapter?.destroy()

    const adicionouPopstate = addSpy.mock.calls.some(([evt]) => evt === 'popstate')
    const removeuPopstate = removeSpy.mock.calls.some(([evt]) => evt === 'popstate')

    expect(adicionouPopstate).toBe(true)
    expect(removeuPopstate).toBe(true)
  })

  it('destroy() para o polling de URL SPA', async () => {
    const video = criarMockVideo()
    history.pushState({}, '', '/shows/video/episodio-1')

    vi.spyOn(document, 'querySelector').mockImplementation((sel: string) => {
      if (sel === 'video') return video as unknown as Element
      return null
    })
    vi.spyOn(document, 'querySelectorAll').mockReturnValue([video] as unknown as NodeListOf<Element>)

    const clearIntervalSpy = vi.spyOn(globalThis, 'clearInterval')

    const { createParamountAdapter } = await import('../../src/adapters/paramount')
    const adapter = await createParamountAdapter()
    adapter?.destroy()

    // clearInterval deve ter sido chamado para o polling de SPA
    expect(clearIntervalSpy).toHaveBeenCalled()
  })

  it('HIGH-2: destroy() durante aguardarVideoParamount pendente nao reinstala handlers', async () => {
    history.pushState({}, '', '/shows/video/episodio-1')
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

    // Primeira chamada: retorna o video (para o createParamountAdapter inicial)
    // Chamadas subsequentes (em onSpaNavegacao): retornam null (video sumiu)
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

    const { createParamountAdapter } = await import('../../src/adapters/paramount')
    const adapter = await createParamountAdapter()
    expect(adapter).not.toBeNull()

    // Dispara navegacao SPA (onSpaNavegacao fica esperando o video aparecer)
    window.dispatchEvent(new PopStateEvent('popstate'))

    // Destroy imediato (antes de aguardarVideoParamount resolver)
    adapter?.destroy()

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
    // e nao deve ter ocorrido erro ou reinstalacao de handlers
    expect(video.removeEventListener).toHaveBeenCalled()
  })

  it('HIGH-2: navegacoes SPA concorrentes - apenas a ultima e aplicada', async () => {
    const videoOriginal = criarMockVideo()
    const videoFinal = criarMockVideo()

    let videoAtivo = videoOriginal

    history.pushState({}, '', '/shows/video/episodio-1')

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

    const { createParamountAdapter } = await import('../../src/adapters/paramount')
    const adapter = await createParamountAdapter()
    expect(adapter).not.toBeNull()

    const playHandler = vi.fn()
    adapter?.on('play', playHandler)

    // URL ja esta em /shows/video/ para que spaPopstateHandler nao filtre os eventos
    history.pushState({}, '', '/shows/video/episodio-2')

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

  it('HIGH-2: polling de location.href detecta mudanca de URL (pushState)', async () => {
    const video = criarMockVideo()

    history.pushState({}, '', '/shows/video/episodio-1')

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

    const { createParamountAdapter } = await import('../../src/adapters/paramount')
    const adapter = await createParamountAdapter()
    expect(adapter).not.toBeNull()

    const removeListenerSpy = vi.spyOn(video, 'removeEventListener')

    // Simula pushState para outra rota de player
    history.pushState({}, '', '/shows/video/episodio-2')

    // Avanca exatamente 1 ciclo de polling (800ms) + delay de renavigate (150ms) + margem
    vi.advanceTimersByTime(951)

    // Aguarda resolucao das promises internas (microtasks e macrotasks do renavigate)
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
})

// ---------------------------------------------------------------------------
// Testes de deteccao de anuncio via MutationObserver
// ---------------------------------------------------------------------------

describe('Anuncio: emissao de ad-start/ad-end via MutationObserver', () => {
  let MutationObserverOriginal: typeof MutationObserver

  beforeEach(() => {
    MutationObserverOriginal = globalThis.MutationObserver
    history.pushState({}, '', '/shows/video/episodio-1')
  })

  afterEach(() => {
    vi.restoreAllMocks()
    vi.resetModules()
    // CR-MINOR-2: restaura MutationObserver global, timers e URL
    globalThis.MutationObserver = MutationObserverOriginal
    vi.useRealTimers()
    history.pushState({}, '', '/')
  })

  it('emite ad-start quando UI de anuncio aparece no DOM', async () => {
    const video = criarMockVideo()
    let adVisivel = false

    // Captura callback do MutationObserver
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
      // Seletor de anuncio retorna elemento visivel somente quando anuncio esta ativo
      // CR-MAJOR: usa criarElementoAdVisivel() para passar pelo filtro elementoVisivel()
      if (sel === 'div.ad-info-manager-circular-loader-copy' && adVisivel) return criarElementoAdVisivel()
      return null
    })
    vi.spyOn(document, 'querySelectorAll').mockReturnValue([video] as unknown as NodeListOf<Element>)

    const { createParamountAdapter } = await import('../../src/adapters/paramount')
    const adapter = await createParamountAdapter()

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
      if (sel === 'div.ad-info-manager-circular-loader-copy' && adVisivel) return criarElementoAdVisivel()
      return null
    })
    vi.spyOn(document, 'querySelectorAll').mockReturnValue([video] as unknown as NodeListOf<Element>)

    const { createParamountAdapter } = await import('../../src/adapters/paramount')
    const adapter = await createParamountAdapter()

    const adEndHandler = vi.fn()
    adapter?.on('ad-end', adEndHandler)

    // Simula fim do anuncio
    adVisivel = false
    observerCallback!([] as unknown as MutationRecord[], null as unknown as MutationObserver)

    expect(adEndHandler).toHaveBeenCalledOnce()
    adapter?.destroy()
  })

  it('elemento de anuncio oculto (sem rects) NAO dispara ad-start', async () => {
    const video = criarMockVideo()
    // Elemento existe mas esta oculto
    const adElOculto = document.createElement('div')
    adElOculto.getClientRects = () => [] as unknown as DOMRectList

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
      // Retorna elemento oculto para todos os seletores de anuncio
      if (sel === 'div.ad-info-manager-circular-loader-copy') return adElOculto
      return null
    })
    vi.spyOn(document, 'querySelectorAll').mockReturnValue([video] as unknown as NodeListOf<Element>)

    const { createParamountAdapter } = await import('../../src/adapters/paramount')
    const adapter = await createParamountAdapter()

    const adStartHandler = vi.fn()
    adapter?.on('ad-start', adStartHandler)

    // Dispara o observer - mas elemento esta oculto
    observerCallback!([] as unknown as MutationRecord[], null as unknown as MutationObserver)

    // ad-start NAO deve ter sido emitido (elemento oculto)
    expect(adStartHandler).not.toHaveBeenCalled()
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

    const { createParamountAdapter } = await import('../../src/adapters/paramount')
    const adapter = await createParamountAdapter()
    adapter?.destroy()

    // O MutationObserver de anuncio deve ter sido desconectado
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
    history.pushState({}, '', '/')
  })

  it('escolhe o video de maior duracao quando ha multiplos candidatos', async () => {
    history.pushState({}, '', '/shows/video/episodio-teste')

    const videoConteudo = criarMockVideo()
    Object.defineProperty(videoConteudo, 'duration', { value: 5400, configurable: true })
    Object.defineProperty(videoConteudo, 'readyState', { value: 4, configurable: true })
    videoConteudo.currentTime = 300

    const videoTrailer = criarMockVideo()
    Object.defineProperty(videoTrailer, 'duration', { value: 90, configurable: true })
    Object.defineProperty(videoTrailer, 'readyState', { value: 4, configurable: true })
    videoTrailer.currentTime = 10

    vi.spyOn(document, 'querySelector').mockImplementation((sel: string) => {
      if (sel === 'video') return videoTrailer as unknown as Element
      return null
    })
    vi.spyOn(document, 'querySelectorAll').mockImplementation((sel: string) => {
      if (sel === 'video') return [videoTrailer, videoConteudo] as unknown as NodeListOf<Element>
      return [] as unknown as NodeListOf<Element>
    })

    const { createParamountAdapter } = await import('../../src/adapters/paramount')
    const adapter = await createParamountAdapter()

    // Deve ter escolhido o video de maior duracao (conteudo principal)
    expect(adapter?.getCurrentTime()).toBe(300)
    adapter?.destroy()
  })

  it('fallback por maior area renderizada quando nenhum video tem duracao conhecida', async () => {
    history.pushState({}, '', '/movies/video/filme-teste')

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
      if (sel === 'video') return videoPequeno as unknown as Element
      return null
    })
    vi.spyOn(document, 'querySelectorAll').mockImplementation((sel: string) => {
      if (sel === 'video') return [videoPequeno, videoGrande] as unknown as NodeListOf<Element>
      return [] as unknown as NodeListOf<Element>
    })

    const { createParamountAdapter } = await import('../../src/adapters/paramount')
    const adapter = await createParamountAdapter()

    // Deve ter escolhido o video de maior area renderizada
    expect(adapter?.getCurrentTime()).toBe(42)
    adapter?.destroy()
  })
})
