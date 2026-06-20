// tests/adapters/hulu.test.ts
// Testes unitarios para o adapter do Hulu.
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
 * e nenhum elemento de UI de anuncio do Hulu.
 * Usa seletor primario #content-video-player video (mais estavel).
 */
function configurarDocumentoSemAd(videoEl: HTMLVideoElement): void {
  vi.spyOn(document, 'querySelector').mockImplementation((selector: string) => {
    if (selector === '#content-video-player video') return videoEl as unknown as Element
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
 * UI de anuncio. Necessario para passar pelo filtro elementoVisivel().
 */
function criarElementoAdVisivel(): Element {
  const el = document.createElement('div')
  // jsdom nao faz layout - sobrescrevemos getClientRects para retornar um rect ficticio
  el.getClientRects = () => [{ width: 100, height: 20 } as DOMRect] as unknown as DOMRectList
  return el
}

/**
 * Configura document.querySelector para simular UI de anuncio Hulu visivel.
 * Usa data-testid="ads-ui" que e o seletor mais estavel.
 * O elemento retornado passa pelo filtro elementoVisivel().
 */
function configurarDocumentoComAd(videoEl: HTMLVideoElement): void {
  const adEl = criarElementoAdVisivel()

  vi.spyOn(document, 'querySelector').mockImplementation((selector: string) => {
    if (selector === '#content-video-player video') return videoEl as unknown as Element
    if (selector === 'video') return videoEl as unknown as Element
    // Seletores de UI de anuncio retornam elemento com visibilidade simulada
    if (
      selector === '[data-testid="ads-ui"]' ||
      selector === '[data-testid="ad-badge"]' ||
      selector === '.HuluPlayer--ad-container' ||
      selector === '[class*="AdBreakBadge"]' ||
      selector === '[class*="ad-ui-container"]'
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

describe('createHuluAdapter', () => {
  let mockVideo: HTMLVideoElement
  // Preserva MutationObserver original para restaurar no afterEach
  let MutationObserverOriginal: typeof MutationObserver

  beforeEach(() => {
    mockVideo = criarMockVideo()
    MutationObserverOriginal = globalThis.MutationObserver
    vi.clearAllMocks()
    // Garante que estamos em rota de player antes de cada teste
    history.pushState({}, '', '/watch/12345')
    configurarDocumentoSemAd(mockVideo)
  })

  afterEach(() => {
    vi.restoreAllMocks()
    vi.resetModules()
    // Restaura MutationObserver global, timers e URL
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

    const { createHuluAdapter } = await import('../../src/adapters/hulu')

    vi.useFakeTimers({ toFake: ['setTimeout', 'setInterval', 'clearInterval', 'clearTimeout'] })
    const promiseAdapter = createHuluAdapter()

    // Avanca alem do VIDEO_WAIT_TIMEOUT_MS (8000ms)
    vi.advanceTimersByTime(9000)
    const adapter = await promiseAdapter
    expect(adapter).toBeNull()

    vi.useRealTimers()
  })

  it('retorna adapter quando elemento video esta presente em /watch/', async () => {
    configurarDocumentoSemAd(mockVideo)
    const { createHuluAdapter } = await import('../../src/adapters/hulu')
    const adapter = await createHuluAdapter()
    expect(adapter).not.toBeNull()
    adapter?.destroy()
  })

  it('getCurrentTime retorna currentTime do video', async () => {
    mockVideo.currentTime = 240.5
    configurarDocumentoSemAd(mockVideo)
    const { createHuluAdapter } = await import('../../src/adapters/hulu')
    const adapter = await createHuluAdapter()
    expect(adapter?.getCurrentTime()).toBe(240.5)
    adapter?.destroy()
  })

  it('getDuration retorna duration do video', async () => {
    Object.defineProperty(mockVideo, 'duration', { value: 5400, writable: true, configurable: true })
    configurarDocumentoSemAd(mockVideo)
    const { createHuluAdapter } = await import('../../src/adapters/hulu')
    const adapter = await createHuluAdapter()
    expect(adapter?.getDuration()).toBe(5400)
    adapter?.destroy()
  })

  it('getDuration retorna 0 quando duration e NaN', async () => {
    Object.defineProperty(mockVideo, 'duration', { value: NaN, writable: true, configurable: true })
    configurarDocumentoSemAd(mockVideo)
    const { createHuluAdapter } = await import('../../src/adapters/hulu')
    const adapter = await createHuluAdapter()
    expect(adapter?.getDuration()).toBe(0)
    adapter?.destroy()
  })

  it('play() chama video.play()', async () => {
    configurarDocumentoSemAd(mockVideo)
    const { createHuluAdapter } = await import('../../src/adapters/hulu')
    const adapter = await createHuluAdapter()
    await adapter?.play()
    expect(mockVideo.play).toHaveBeenCalledOnce()
    adapter?.destroy()
  })

  it('pause() chama video.pause()', async () => {
    configurarDocumentoSemAd(mockVideo)
    const { createHuluAdapter } = await import('../../src/adapters/hulu')
    const adapter = await createHuluAdapter()
    await adapter?.pause()
    expect(mockVideo.pause).toHaveBeenCalledOnce()
    adapter?.destroy()
  })

  it('seekTo() atualiza currentTime do video', async () => {
    configurarDocumentoSemAd(mockVideo)
    const { createHuluAdapter } = await import('../../src/adapters/hulu')
    const adapter = await createHuluAdapter()
    await adapter?.seekTo(720.0)
    expect(mockVideo.currentTime).toBe(720.0)
    adapter?.destroy()
  })

  it('getPlaybackState() retorna "playing" quando video nao esta pausado', async () => {
    Object.defineProperty(mockVideo, 'paused', { value: false, writable: true, configurable: true })
    configurarDocumentoSemAd(mockVideo)
    const { createHuluAdapter } = await import('../../src/adapters/hulu')
    const adapter = await createHuluAdapter()
    expect(adapter?.getPlaybackState()).toBe('playing')
    adapter?.destroy()
  })

  it('getPlaybackState() retorna "paused" quando video esta pausado', async () => {
    Object.defineProperty(mockVideo, 'paused', { value: true, writable: true, configurable: true })
    configurarDocumentoSemAd(mockVideo)
    const { createHuluAdapter } = await import('../../src/adapters/hulu')
    const adapter = await createHuluAdapter()
    expect(adapter?.getPlaybackState()).toBe('paused')
    adapter?.destroy()
  })

  it('getPlaybackState() retorna "buffering" quando readyState < HAVE_METADATA', async () => {
    Object.defineProperty(mockVideo, 'readyState', { value: 1, writable: true, configurable: true })
    Object.defineProperty(mockVideo, 'paused', { value: false, writable: true, configurable: true })
    configurarDocumentoSemAd(mockVideo)
    const { createHuluAdapter } = await import('../../src/adapters/hulu')
    const adapter = await createHuluAdapter()
    expect(adapter?.getPlaybackState()).toBe('buffering')
    adapter?.destroy()
  })

  it('getPlaybackState() retorna "ad" durante anuncio', async () => {
    configurarDocumentoComAd(mockVideo)
    const { createHuluAdapter } = await import('../../src/adapters/hulu')
    const adapter = await createHuluAdapter()
    expect(adapter?.getPlaybackState()).toBe('ad')
    adapter?.destroy()
  })

  it('isAd() retorna true quando UI de anuncio esta presente e visivel', async () => {
    configurarDocumentoComAd(mockVideo)
    const { createHuluAdapter } = await import('../../src/adapters/hulu')
    const adapter = await createHuluAdapter()
    expect(adapter?.isAd()).toBe(true)
    adapter?.destroy()
  })

  it('isAd() retorna false quando UI de anuncio esta ausente', async () => {
    configurarDocumentoSemAd(mockVideo)
    const { createHuluAdapter } = await import('../../src/adapters/hulu')
    const adapter = await createHuluAdapter()
    expect(adapter?.isAd()).toBe(false)
    adapter?.destroy()
  })

  it('isAd() retorna false quando elemento de anuncio esta oculto (display:none)', async () => {
    // Elemento de anuncio existe no DOM mas com display:none - nao deve ser contado
    const adElOculto = document.createElement('div')
    // jsdom retorna getClientRects vazio por padrao - simula elemento sem layout
    // mas forcamos display:none via getComputedStyle override
    Object.defineProperty(adElOculto, 'ownerDocument', { value: document })

    vi.spyOn(document, 'querySelector').mockImplementation((selector: string) => {
      if (selector === '#content-video-player video') return mockVideo as unknown as Element
      if (selector === 'video') return mockVideo as unknown as Element
      if (selector === '[data-testid="ads-ui"]') return adElOculto
      return null
    })
    vi.spyOn(document, 'querySelectorAll').mockImplementation((selector: string) => {
      if (selector === 'video') return [mockVideo] as unknown as NodeListOf<Element>
      return [] as unknown as NodeListOf<Element>
    })
    // getClientRects vazio = elemento sem layout = nao visivel
    adElOculto.getClientRects = () => [] as unknown as DOMRectList

    const { createHuluAdapter } = await import('../../src/adapters/hulu')
    const adapter = await createHuluAdapter()
    expect(adapter?.isAd()).toBe(false)
    adapter?.destroy()
  })

  it('on("play") dispara callback ao receber evento nativo de play', async () => {
    const videoInterno = criarMockVideo()
    configurarDocumentoSemAd(videoInterno)
    const { createHuluAdapter } = await import('../../src/adapters/hulu')
    const adapter = await createHuluAdapter()

    const handler = vi.fn()
    adapter?.on('play', handler)

    ;(videoInterno as unknown as { _dispatchEvent: (e: string) => void })._dispatchEvent('play')

    expect(handler).toHaveBeenCalledOnce()
    adapter?.destroy()
  })

  it('on("pause") dispara callback ao receber evento nativo de pause', async () => {
    const videoInterno = criarMockVideo()
    configurarDocumentoSemAd(videoInterno)
    const { createHuluAdapter } = await import('../../src/adapters/hulu')
    const adapter = await createHuluAdapter()

    const handler = vi.fn()
    adapter?.on('pause', handler)

    ;(videoInterno as unknown as { _dispatchEvent: (e: string) => void })._dispatchEvent('pause')

    expect(handler).toHaveBeenCalledOnce()
    adapter?.destroy()
  })

  it('on("seek") dispara callback ao receber evento nativo seeked', async () => {
    const videoInterno = criarMockVideo()
    configurarDocumentoSemAd(videoInterno)
    const { createHuluAdapter } = await import('../../src/adapters/hulu')
    const adapter = await createHuluAdapter()

    const handler = vi.fn()
    adapter?.on('seek', handler)

    ;(videoInterno as unknown as { _dispatchEvent: (e: string) => void })._dispatchEvent('seeked')

    expect(handler).toHaveBeenCalledOnce()
    adapter?.destroy()
  })

  it('on("buffering") dispara callback ao receber evento nativo waiting', async () => {
    const videoInterno = criarMockVideo()
    configurarDocumentoSemAd(videoInterno)
    const { createHuluAdapter } = await import('../../src/adapters/hulu')
    const adapter = await createHuluAdapter()

    const handler = vi.fn()
    adapter?.on('buffering', handler)

    ;(videoInterno as unknown as { _dispatchEvent: (e: string) => void })._dispatchEvent('waiting')

    expect(handler).toHaveBeenCalledOnce()
    adapter?.destroy()
  })

  it('on("ended") dispara callback ao receber evento nativo ended', async () => {
    const videoInterno = criarMockVideo()
    configurarDocumentoSemAd(videoInterno)
    const { createHuluAdapter } = await import('../../src/adapters/hulu')
    const adapter = await createHuluAdapter()

    const handler = vi.fn()
    adapter?.on('ended', handler)

    ;(videoInterno as unknown as { _dispatchEvent: (e: string) => void })._dispatchEvent('ended')

    expect(handler).toHaveBeenCalledOnce()
    adapter?.destroy()
  })

  it('off() remove listener de evento', async () => {
    const videoInterno = criarMockVideo()
    configurarDocumentoSemAd(videoInterno)
    const { createHuluAdapter } = await import('../../src/adapters/hulu')
    const adapter = await createHuluAdapter()

    const handler = vi.fn()
    adapter?.on('play', handler)
    adapter?.off('play', handler)

    ;(videoInterno as unknown as { _dispatchEvent: (e: string) => void })._dispatchEvent('play')

    expect(handler).not.toHaveBeenCalled()
    adapter?.destroy()
  })

  it('getServiceType() retorna "native-html5"', async () => {
    configurarDocumentoSemAd(mockVideo)
    const { createHuluAdapter } = await import('../../src/adapters/hulu')
    const adapter = await createHuluAdapter()
    expect(adapter?.getServiceType()).toBe('native-html5')
    adapter?.destroy()
  })

  it('destroy() remove handlers nativos do video', async () => {
    configurarDocumentoSemAd(mockVideo)
    const { createHuluAdapter } = await import('../../src/adapters/hulu')
    const adapter = await createHuluAdapter()
    adapter?.destroy()
    expect(mockVideo.removeEventListener).toHaveBeenCalled()
  })

  it('destroy() limpa todos os listeners registrados', async () => {
    configurarDocumentoSemAd(mockVideo)
    const { createHuluAdapter } = await import('../../src/adapters/hulu')
    const adapter = await createHuluAdapter()

    const handler = vi.fn()
    adapter?.on('play', handler)
    adapter?.destroy()

    // Apos destroy, o handler nao deve mais ser chamado
    ;(mockVideo as unknown as { _dispatchEvent: (e: string) => void })._dispatchEvent('play')
    expect(handler).not.toHaveBeenCalled()
  })
})

// ---------------------------------------------------------------------------
// Testes de gate de path
// ---------------------------------------------------------------------------

describe('Gate de path: nao seleciona video fora de /watch/', () => {
  let MutationObserverOriginal: typeof MutationObserver

  beforeEach(() => {
    MutationObserverOriginal = globalThis.MutationObserver
  })

  afterEach(() => {
    vi.restoreAllMocks()
    vi.resetModules()
    globalThis.MutationObserver = MutationObserverOriginal
    vi.useRealTimers()
    history.pushState({}, '', '/')
  })

  it('retorna null quando URL nao e de rota de player (pagina inicial)', async () => {
    // URL fora do player
    history.pushState({}, '', '/')

    const video = criarMockVideo()
    vi.spyOn(document, 'querySelector').mockImplementation((sel: string) => {
      if (sel === '#content-video-player video') return video as unknown as Element
      return null
    })
    vi.spyOn(document, 'querySelectorAll').mockReturnValue([video] as unknown as NodeListOf<Element>)

    class MockMutationObserver {
      observe = vi.fn()
      disconnect = vi.fn()
      constructor(public callback: MutationCallback) {}
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ;(globalThis as any).MutationObserver = MockMutationObserver

    vi.useFakeTimers({ toFake: ['setTimeout', 'setInterval', 'clearInterval', 'clearTimeout'] })

    const { createHuluAdapter } = await import('../../src/adapters/hulu')
    const promiseAdapter = createHuluAdapter()

    // Avanca alem do timeout - deve retornar null pois nao esta em /watch/
    vi.advanceTimersByTime(9000)
    const adapter = await promiseAdapter
    expect(adapter).toBeNull()

    vi.useRealTimers()
  })

  it('retorna null quando URL e catalogo /series/', async () => {
    history.pushState({}, '', '/series/game-of-thrones/123')

    const video = criarMockVideo()
    vi.spyOn(document, 'querySelector').mockImplementation((sel: string) => {
      if (sel === '#content-video-player video') return video as unknown as Element
      return null
    })
    vi.spyOn(document, 'querySelectorAll').mockReturnValue([video] as unknown as NodeListOf<Element>)

    class MockMutationObserver {
      observe = vi.fn()
      disconnect = vi.fn()
      constructor(public callback: MutationCallback) {}
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ;(globalThis as any).MutationObserver = MockMutationObserver

    vi.useFakeTimers({ toFake: ['setTimeout', 'setInterval', 'clearInterval', 'clearTimeout'] })

    const { createHuluAdapter } = await import('../../src/adapters/hulu')
    const promiseAdapter = createHuluAdapter()

    vi.advanceTimersByTime(9000)
    const adapter = await promiseAdapter
    expect(adapter).toBeNull()

    vi.useRealTimers()
  })

  it('retorna adapter quando URL e /watch/:id', async () => {
    history.pushState({}, '', '/watch/ey6n1wr')

    const video = criarMockVideo()
    vi.spyOn(document, 'querySelector').mockImplementation((sel: string) => {
      if (sel === '#content-video-player video') return video as unknown as Element
      return null
    })
    vi.spyOn(document, 'querySelectorAll').mockReturnValue([video] as unknown as NodeListOf<Element>)

    const { createHuluAdapter } = await import('../../src/adapters/hulu')
    const adapter = await createHuluAdapter()
    expect(adapter).not.toBeNull()
    adapter?.destroy()
  })
})

// ---------------------------------------------------------------------------
// Testes de navegacao SPA
// ---------------------------------------------------------------------------

describe('SPA: re-resolucao de video ao trocar de episodio', () => {
  let MutationObserverOriginal: typeof MutationObserver

  beforeEach(() => {
    MutationObserverOriginal = globalThis.MutationObserver
    history.pushState({}, '', '/watch/ep1')
  })

  afterEach(() => {
    vi.restoreAllMocks()
    vi.resetModules()
    // Restaura MutationObserver global, timers e URL
    globalThis.MutationObserver = MutationObserverOriginal
    vi.useRealTimers()
    history.pushState({}, '', '/')
  })

  it('re-liga listeners ao novo video apos evento popstate em /watch/', async () => {
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
      if (sel === '#content-video-player video') return videoAtivo as unknown as Element
      if (sel === 'video') return videoAtivo as unknown as Element
      return null
    })
    vi.spyOn(document, 'querySelectorAll').mockImplementation((sel: string) => {
      if (sel === 'video') return [videoAtivo] as unknown as NodeListOf<Element>
      return [] as unknown as NodeListOf<Element>
    })

    const { createHuluAdapter } = await import('../../src/adapters/hulu')
    const adapter = await createHuluAdapter()
    expect(adapter).not.toBeNull()

    const pauseHandler = vi.fn()
    adapter?.on('pause', pauseHandler)

    // Simula troca de episodio via back/forward - URL precisa ser /watch/ para
    // o spaPopstateHandler nao filtrar o evento
    history.pushState({}, '', '/watch/ep2')
    videoAtivo = videoNovo
    window.dispatchEvent(new PopStateEvent('popstate'))

    // Aguarda re-resolucao: inclui SPA_RENAVIGATE_DELAY_MS=150ms + margem
    await new Promise((r) => setTimeout(r, 250))

    ;(videoNovo as unknown as { _dispatchEvent: (e: string) => void })._dispatchEvent('pause')
    expect(pauseHandler).toHaveBeenCalled()

    adapter?.destroy()
    history.pushState({}, '', '/')
  })

  it('nao reage a popstate fora de /watch/', async () => {
    const video = criarMockVideo()

    class MockMutationObserver {
      observe = vi.fn()
      disconnect = vi.fn()
      constructor(public callback: MutationCallback) {}
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ;(globalThis as any).MutationObserver = MockMutationObserver

    vi.spyOn(document, 'querySelector').mockImplementation((sel: string) => {
      if (sel === '#content-video-player video') return video as unknown as Element
      if (sel === 'video') return video as unknown as Element
      return null
    })
    vi.spyOn(document, 'querySelectorAll').mockReturnValue([video] as unknown as NodeListOf<Element>)

    const { createHuluAdapter } = await import('../../src/adapters/hulu')
    const adapter = await createHuluAdapter()
    expect(adapter).not.toBeNull()

    // Espiona addEventListener do video para verificar que nao houve nova ligacao
    const addSpy = vi.spyOn(video, 'addEventListener')

    // Navega para fora do player (catalogo) e dispara popstate
    history.pushState({}, '', '/series/game-of-thrones/123')
    window.dispatchEvent(new PopStateEvent('popstate'))

    await new Promise((r) => setTimeout(r, 100))

    // Nenhum novo addEventListener deve ter sido chamado (nao re-ligou)
    expect(addSpy).not.toHaveBeenCalled()

    adapter?.destroy()
    history.pushState({}, '', '/')
  })

  it('inicia polling de SPA com setInterval de 800ms', async () => {
    const video = criarMockVideo()

    class MockMutationObserver {
      observe = vi.fn()
      disconnect = vi.fn()
      constructor(public callback: MutationCallback) {}
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ;(globalThis as any).MutationObserver = MockMutationObserver

    vi.spyOn(document, 'querySelector').mockImplementation((sel: string) => {
      if (sel === '#content-video-player video') return video as unknown as Element
      if (sel === 'video') return video as unknown as Element
      return null
    })
    vi.spyOn(document, 'querySelectorAll').mockReturnValue([video] as unknown as NodeListOf<Element>)

    const setIntervalSpy = vi.spyOn(globalThis, 'setInterval')
    const clearIntervalSpy = vi.spyOn(globalThis, 'clearInterval')

    const { createHuluAdapter } = await import('../../src/adapters/hulu')
    const adapter = await createHuluAdapter()
    expect(adapter).not.toBeNull()

    // O polling SPA deve ter sido iniciado via setInterval de 800ms
    const chamouSetInterval = setIntervalSpy.mock.calls.some(([, delay]) => delay === 800)
    expect(chamouSetInterval).toBe(true)

    adapter?.destroy()

    // O polling deve ter sido limpo no destroy via clearInterval
    expect(clearIntervalSpy).toHaveBeenCalled()
  })

  it('polling de location.href detecta mudanca de URL (pushState)', async () => {
    const video = criarMockVideo()

    class MockMutationObserver {
      observe = vi.fn()
      disconnect = vi.fn()
      constructor(public callback: MutationCallback) {}
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ;(globalThis as any).MutationObserver = MockMutationObserver

    vi.spyOn(document, 'querySelector').mockImplementation((sel: string) => {
      if (sel === '#content-video-player video') return video as unknown as Element
      if (sel === 'video') return video as unknown as Element
      return null
    })
    vi.spyOn(document, 'querySelectorAll').mockReturnValue([video] as unknown as NodeListOf<Element>)

    vi.useFakeTimers({ toFake: ['setTimeout', 'setInterval', 'clearInterval', 'clearTimeout'] })

    const { createHuluAdapter } = await import('../../src/adapters/hulu')
    const adapter = await createHuluAdapter()
    expect(adapter).not.toBeNull()

    // Espiona removeEventListener como proxy de que a re-ligacao ocorreu
    const removeListenerSpy = vi.spyOn(video, 'removeEventListener')

    // Simula pushState (history.pushState atualiza location.href no jsdom)
    history.pushState({}, '', '/watch/ep2-novo')

    // Avanca 1 ciclo de polling (800ms) + delay de renavigate (150ms) + margem
    vi.advanceTimersByTime(960)

    // Aguarda resolucao das promises internas
    await Promise.resolve()
    await Promise.resolve()
    await Promise.resolve()
    await Promise.resolve()

    // O polling reagiu a mudanca de URL e tentou re-ligar (removeu handlers antigos)
    expect(removeListenerSpy).toHaveBeenCalled()

    adapter?.destroy()
    history.pushState({}, '', '/')
    vi.useRealTimers()
  })

  it('destroy() remove listener de popstate', async () => {
    const video = criarMockVideo()

    vi.spyOn(document, 'querySelector').mockImplementation((sel: string) => {
      if (sel === '#content-video-player video') return video as unknown as Element
      if (sel === 'video') return video as unknown as Element
      return null
    })
    vi.spyOn(document, 'querySelectorAll').mockReturnValue([video] as unknown as NodeListOf<Element>)

    const addSpy = vi.spyOn(window, 'addEventListener')
    const removeSpy = vi.spyOn(window, 'removeEventListener')

    const { createHuluAdapter } = await import('../../src/adapters/hulu')
    const adapter = await createHuluAdapter()
    adapter?.destroy()

    const adicionouPopstate = addSpy.mock.calls.some(([evt]) => evt === 'popstate')
    const removeuPopstate = removeSpy.mock.calls.some(([evt]) => evt === 'popstate')

    expect(adicionouPopstate).toBe(true)
    expect(removeuPopstate).toBe(true)
  })

  it('destroy() para o polling de URL SPA', async () => {
    const video = criarMockVideo()
    vi.spyOn(document, 'querySelector').mockImplementation((sel: string) => {
      if (sel === '#content-video-player video') return video as unknown as Element
      return null
    })
    vi.spyOn(document, 'querySelectorAll').mockReturnValue([video] as unknown as NodeListOf<Element>)

    const clearIntervalSpy = vi.spyOn(globalThis, 'clearInterval')

    const { createHuluAdapter } = await import('../../src/adapters/hulu')
    const adapter = await createHuluAdapter()
    adapter?.destroy()

    expect(clearIntervalSpy).toHaveBeenCalled()
  })

  it('destroy() durante aguardarVideoHulu pendente nao reinstala handlers', async () => {
    // Cenario: aguardarVideoHulu leva tempo (video nao disponivel imediatamente)
    // destroy() e chamado antes da promise resolver; o adapter nao deve tentar
    // registrar handlers num elemento destruido.
    const video = criarMockVideo()

    let observerCallback: MutationCallback | null = null
    class MockMutationObserver {
      observe = vi.fn()
      disconnect = vi.fn()
      constructor(cb: MutationCallback) { observerCallback = cb }
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ;(globalThis as any).MutationObserver = MockMutationObserver

    // Primeira chamada: retorna o video (para o createHuluAdapter inicial)
    // Chamadas subsequentes (em onSpaNavegacao): retornam null (video sumiu)
    let queryCalls = 0
    vi.spyOn(document, 'querySelector').mockImplementation((sel: string) => {
      queryCalls++
      if (queryCalls <= 2 && sel === '#content-video-player video') return video as unknown as Element
      if (queryCalls <= 2 && sel === 'video') return video as unknown as Element
      return null
    })
    vi.spyOn(document, 'querySelectorAll').mockImplementation((sel: string) => {
      if (sel === 'video' && queryCalls <= 2) return [video] as unknown as NodeListOf<Element>
      return [] as unknown as NodeListOf<Element>
    })

    const { createHuluAdapter } = await import('../../src/adapters/hulu')
    const adapter = await createHuluAdapter()
    expect(adapter).not.toBeNull()

    // Dispara navegacao SPA (onSpaNavegacao fica esperando o video aparecer)
    window.dispatchEvent(new PopStateEvent('popstate'))

    // Destroy imediato (antes de aguardarVideoHulu resolver)
    adapter?.destroy()

    // Dispara o MutationObserver mockado - simula video aparecendo apos destroy
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const cbCapturado = observerCallback as ((...args: any[]) => void) | null
    if (cbCapturado) {
      vi.spyOn(document, 'querySelector').mockImplementation((sel: string) => {
        if (sel === '#content-video-player video') return video as unknown as Element
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
      if (sel === '#content-video-player video') return videoAtivo as unknown as Element
      if (sel === 'video') return videoAtivo as unknown as Element
      return null
    })
    vi.spyOn(document, 'querySelectorAll').mockImplementation((sel: string) => {
      if (sel === 'video') return [videoAtivo] as unknown as NodeListOf<Element>
      return [] as unknown as NodeListOf<Element>
    })

    const { createHuluAdapter } = await import('../../src/adapters/hulu')
    const adapter = await createHuluAdapter()
    expect(adapter).not.toBeNull()

    const playHandler = vi.fn()
    adapter?.on('play', playHandler)

    // Garante que estamos em /watch/ para o spaPopstateHandler nao filtrar
    history.pushState({}, '', '/watch/ep1')

    // Dispara duas navegacoes SPA em rapida sucessao (concorrentes)
    window.dispatchEvent(new PopStateEvent('popstate'))
    // Segunda navegacao imediatamente - deve cancelar a primeira
    videoAtivo = videoFinal
    window.dispatchEvent(new PopStateEvent('popstate'))

    // Aguarda resolucao: inclui SPA_RENAVIGATE_DELAY_MS=150ms + margem
    await new Promise((r) => setTimeout(r, 250))

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

describe('Anuncio: emissao de ad-start/ad-end via MutationObserver', () => {
  let MutationObserverOriginal: typeof MutationObserver

  beforeEach(() => {
    MutationObserverOriginal = globalThis.MutationObserver
    history.pushState({}, '', '/watch/12345')
  })

  afterEach(() => {
    vi.restoreAllMocks()
    vi.resetModules()
    // Restaura MutationObserver global, timers e URL
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
      if (sel === '#content-video-player video') return video as unknown as Element
      if (sel === 'video') return video as unknown as Element
      // data-testid="ads-ui" retorna elemento visivel apenas quando anuncio ativo
      if (sel === '[data-testid="ads-ui"]' && adVisivel) return criarElementoAdVisivel()
      return null
    })
    vi.spyOn(document, 'querySelectorAll').mockReturnValue([video] as unknown as NodeListOf<Element>)

    const { createHuluAdapter } = await import('../../src/adapters/hulu')
    const adapter = await createHuluAdapter()

    const adStartHandler = vi.fn()
    adapter?.on('ad-start', adStartHandler)

    // Simula aparecimento do anuncio SSAI
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
      if (sel === '#content-video-player video') return video as unknown as Element
      if (sel === 'video') return video as unknown as Element
      if (sel === '[data-testid="ads-ui"]' && adVisivel) return criarElementoAdVisivel()
      return null
    })
    vi.spyOn(document, 'querySelectorAll').mockReturnValue([video] as unknown as NodeListOf<Element>)

    const { createHuluAdapter } = await import('../../src/adapters/hulu')
    const adapter = await createHuluAdapter()

    const adEndHandler = vi.fn()
    adapter?.on('ad-end', adEndHandler)

    // Simula fim do anuncio SSAI
    adVisivel = false
    observerCallback!([] as unknown as MutationRecord[], null as unknown as MutationObserver)

    expect(adEndHandler).toHaveBeenCalledOnce()
    adapter?.destroy()
  })

  it('elemento de anuncio oculto (getClientRects vazio) NAO dispara ad-start', async () => {
    const video = criarMockVideo()
    // Elemento de anuncio existe mas sem layout (getClientRects vazio)
    const adElSemLayout = document.createElement('div')
    adElSemLayout.getClientRects = () => [] as unknown as DOMRectList

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
      if (sel === '#content-video-player video') return video as unknown as Element
      if (sel === 'video') return video as unknown as Element
      // Retorna elemento SEM layout para simular display:none
      if (sel === '[data-testid="ads-ui"]') return adElSemLayout
      return null
    })
    vi.spyOn(document, 'querySelectorAll').mockReturnValue([video] as unknown as NodeListOf<Element>)

    const { createHuluAdapter } = await import('../../src/adapters/hulu')
    const adapter = await createHuluAdapter()

    const adStartHandler = vi.fn()
    adapter?.on('ad-start', adStartHandler)

    // Dispara o observer - mas o elemento esta oculto
    observerCallback!([] as unknown as MutationRecord[], null as unknown as MutationObserver)

    // Nao deve ter disparado ad-start (elemento nao e visivel)
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
      if (sel === '#content-video-player video') return video as unknown as Element
      if (sel === 'video') return video as unknown as Element
      return null
    })
    vi.spyOn(document, 'querySelectorAll').mockReturnValue([video] as unknown as NodeListOf<Element>)

    const { createHuluAdapter } = await import('../../src/adapters/hulu')
    const adapter = await createHuluAdapter()
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

  it('prefere o video do container #content-video-player quando disponivel', async () => {
    history.pushState({}, '', '/watch/abc')

    const videoPlayer = criarMockVideo({ currentTime: 150 })
    const videoTrailer = criarMockVideo({ currentTime: 5 })

    vi.spyOn(document, 'querySelector').mockImplementation((sel: string) => {
      if (sel === '#content-video-player video') return videoPlayer as unknown as Element
      if (sel === 'video') return videoTrailer as unknown as Element
      return null
    })
    vi.spyOn(document, 'querySelectorAll').mockReturnValue(
      [videoPlayer, videoTrailer] as unknown as NodeListOf<Element>
    )

    const { createHuluAdapter } = await import('../../src/adapters/hulu')
    const adapter = await createHuluAdapter()

    // O adapter deve ter conectado ao video do player, nao ao trailer
    expect(adapter?.getCurrentTime()).toBe(150)
    adapter?.destroy()
  })

  it('escolhe o video de maior duracao quando seletor primario falha', async () => {
    history.pushState({}, '', '/watch/abc')

    const videoConteudo = criarMockVideo()
    Object.defineProperty(videoConteudo, 'duration', { value: 5400, configurable: true })
    Object.defineProperty(videoConteudo, 'readyState', { value: 4, configurable: true })
    videoConteudo.currentTime = 300

    const videoTrailer = criarMockVideo()
    Object.defineProperty(videoTrailer, 'duration', { value: 90, configurable: true })
    Object.defineProperty(videoTrailer, 'readyState', { value: 4, configurable: true })
    videoTrailer.currentTime = 10

    vi.spyOn(document, 'querySelector').mockImplementation((sel: string) => {
      // Seletores primarios falham
      if (
        sel === '#content-video-player video' ||
        sel === '[class*="PlayerControls"] video' ||
        sel === '.PlayerControls--control-element video'
      ) return null
      if (sel === 'video') return videoTrailer as unknown as Element
      return null
    })
    vi.spyOn(document, 'querySelectorAll').mockImplementation((sel: string) => {
      if (sel === 'video') return [videoTrailer, videoConteudo] as unknown as NodeListOf<Element>
      return [] as unknown as NodeListOf<Element>
    })

    const { createHuluAdapter } = await import('../../src/adapters/hulu')
    const adapter = await createHuluAdapter()

    // Deve ter escolhido o video de maior duracao (conteudo principal)
    expect(adapter?.getCurrentTime()).toBe(300)
    adapter?.destroy()
  })

  it('fallback por maior area renderizada quando nenhum video tem duracao conhecida', async () => {
    history.pushState({}, '', '/watch/abc')

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
      if (
        sel === '#content-video-player video' ||
        sel === '[class*="PlayerControls"] video' ||
        sel === '.PlayerControls--control-element video'
      ) return null
      return null
    })
    vi.spyOn(document, 'querySelectorAll').mockImplementation((sel: string) => {
      if (sel === 'video') return [videoPequeno, videoGrande] as unknown as NodeListOf<Element>
      return [] as unknown as NodeListOf<Element>
    })

    const { createHuluAdapter } = await import('../../src/adapters/hulu')
    const adapter = await createHuluAdapter()

    // Deve ter escolhido o video de maior area renderizada
    expect(adapter?.getCurrentTime()).toBe(42)
    adapter?.destroy()
  })
})
