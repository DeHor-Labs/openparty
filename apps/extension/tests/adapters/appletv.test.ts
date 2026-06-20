// tests/adapters/appletv.test.ts
// Testes unitarios para o adapter do Apple TV+.
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
 * e nenhum elemento de UI de anuncio (Apple TV+ nao tem anuncios).
 */
function configurarDocumentoSemAd(videoEl: HTMLVideoElement): void {
  vi.spyOn(document, 'querySelector').mockImplementation((selector: string) => {
    if (selector === '.default-media-player video') return videoEl as unknown as Element
    if (selector === 'video') return videoEl as unknown as Element
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

// ---------------------------------------------------------------------------
// Testes basicos do adapter
// ---------------------------------------------------------------------------

describe('createAppleTvAdapter', () => {
  let mockVideo: HTMLVideoElement
  // Preserva MutationObserver original para restaurar no afterEach
  let MutationObserverOriginal: typeof MutationObserver

  beforeEach(() => {
    mockVideo = criarMockVideo()
    MutationObserverOriginal = globalThis.MutationObserver
    vi.clearAllMocks()
    // Garante que estamos em rota de player antes de cada teste (gate de path)
    history.pushState({}, '', '/us/episode/episodio-teste/umc.cmc.abc123')
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

    const { createAppleTvAdapter } = await import('../../src/adapters/appletv')

    vi.useFakeTimers({ toFake: ['setTimeout', 'setInterval', 'clearInterval', 'clearTimeout'] })
    const promiseAdapter = createAppleTvAdapter()

    // Avanca alem do VIDEO_WAIT_TIMEOUT_MS (8000ms)
    vi.advanceTimersByTime(9000)
    const adapter = await promiseAdapter
    expect(adapter).toBeNull()

    vi.useRealTimers()
  })

  it('retorna adapter quando elemento video esta presente', async () => {
    configurarDocumentoSemAd(mockVideo)
    const { createAppleTvAdapter } = await import('../../src/adapters/appletv')
    const adapter = await createAppleTvAdapter()
    expect(adapter).not.toBeNull()
    adapter?.destroy()
  })

  it('getCurrentTime retorna currentTime do video', async () => {
    mockVideo.currentTime = 180.5
    configurarDocumentoSemAd(mockVideo)
    const { createAppleTvAdapter } = await import('../../src/adapters/appletv')
    const adapter = await createAppleTvAdapter()
    expect(adapter?.getCurrentTime()).toBe(180.5)
    adapter?.destroy()
  })

  it('getDuration retorna duration do video', async () => {
    Object.defineProperty(mockVideo, 'duration', { value: 2700, writable: true, configurable: true })
    configurarDocumentoSemAd(mockVideo)
    const { createAppleTvAdapter } = await import('../../src/adapters/appletv')
    const adapter = await createAppleTvAdapter()
    expect(adapter?.getDuration()).toBe(2700)
    adapter?.destroy()
  })

  it('getDuration retorna 0 quando duration e NaN', async () => {
    Object.defineProperty(mockVideo, 'duration', { value: NaN, writable: true, configurable: true })
    configurarDocumentoSemAd(mockVideo)
    const { createAppleTvAdapter } = await import('../../src/adapters/appletv')
    const adapter = await createAppleTvAdapter()
    expect(adapter?.getDuration()).toBe(0)
    adapter?.destroy()
  })

  it('play() chama video.play()', async () => {
    configurarDocumentoSemAd(mockVideo)
    const { createAppleTvAdapter } = await import('../../src/adapters/appletv')
    const adapter = await createAppleTvAdapter()
    await adapter?.play()
    expect(mockVideo.play).toHaveBeenCalledOnce()
    adapter?.destroy()
  })

  it('pause() chama video.pause()', async () => {
    configurarDocumentoSemAd(mockVideo)
    const { createAppleTvAdapter } = await import('../../src/adapters/appletv')
    const adapter = await createAppleTvAdapter()
    await adapter?.pause()
    expect(mockVideo.pause).toHaveBeenCalledOnce()
    adapter?.destroy()
  })

  it('seekTo() atualiza currentTime do video', async () => {
    configurarDocumentoSemAd(mockVideo)
    const { createAppleTvAdapter } = await import('../../src/adapters/appletv')
    const adapter = await createAppleTvAdapter()
    await adapter?.seekTo(330.0)
    expect(mockVideo.currentTime).toBe(330.0)
    adapter?.destroy()
  })

  it('getPlaybackState() retorna "playing" quando video nao esta pausado', async () => {
    Object.defineProperty(mockVideo, 'paused', { value: false, writable: true, configurable: true })
    configurarDocumentoSemAd(mockVideo)
    const { createAppleTvAdapter } = await import('../../src/adapters/appletv')
    const adapter = await createAppleTvAdapter()
    expect(adapter?.getPlaybackState()).toBe('playing')
    adapter?.destroy()
  })

  it('getPlaybackState() retorna "paused" quando video esta pausado', async () => {
    Object.defineProperty(mockVideo, 'paused', { value: true, writable: true, configurable: true })
    configurarDocumentoSemAd(mockVideo)
    const { createAppleTvAdapter } = await import('../../src/adapters/appletv')
    const adapter = await createAppleTvAdapter()
    expect(adapter?.getPlaybackState()).toBe('paused')
    adapter?.destroy()
  })

  it('getPlaybackState() retorna "buffering" quando readyState < HAVE_METADATA', async () => {
    Object.defineProperty(mockVideo, 'readyState', { value: 1, writable: true, configurable: true })
    Object.defineProperty(mockVideo, 'paused', { value: false, writable: true, configurable: true })
    configurarDocumentoSemAd(mockVideo)
    const { createAppleTvAdapter } = await import('../../src/adapters/appletv')
    const adapter = await createAppleTvAdapter()
    expect(adapter?.getPlaybackState()).toBe('buffering')
    adapter?.destroy()
  })

  it('getServiceType() retorna "native-html5"', async () => {
    configurarDocumentoSemAd(mockVideo)
    const { createAppleTvAdapter } = await import('../../src/adapters/appletv')
    const adapter = await createAppleTvAdapter()
    expect(adapter?.getServiceType()).toBe('native-html5')
    adapter?.destroy()
  })

  it('isAd() retorna false - Apple TV+ nao tem anuncios', async () => {
    configurarDocumentoSemAd(mockVideo)
    const { createAppleTvAdapter } = await import('../../src/adapters/appletv')
    const adapter = await createAppleTvAdapter()
    expect(adapter?.isAd()).toBe(false)
    adapter?.destroy()
  })

  it('isAd() retorna false mesmo quando elemento com classe de anuncio esta presente mas invisivel', async () => {
    // Mesmo que existisse um elemento oculto, isAd() deve retornar false
    // pois o filtro elementoVisivel() rejeita elementos sem layout
    const elOculto = document.createElement('div')
    // getClientRects vazio = elemento sem layout = nao visivel
    elOculto.getClientRects = () => [] as unknown as DOMRectList

    vi.spyOn(document, 'querySelector').mockImplementation((sel: string) => {
      if (sel === '.default-media-player video') return mockVideo as unknown as Element
      // Retorna elemento oculto para qualquer outro seletor (nenhum seletor de ad existe no Apple TV+)
      return elOculto
    })
    vi.spyOn(document, 'querySelectorAll').mockImplementation((sel: string) => {
      if (sel === 'video') return [mockVideo] as unknown as NodeListOf<Element>
      return [] as unknown as NodeListOf<Element>
    })

    const { createAppleTvAdapter } = await import('../../src/adapters/appletv')
    const adapter = await createAppleTvAdapter()
    expect(adapter?.isAd()).toBe(false)
    adapter?.destroy()
  })

  it('on("play") dispara callback ao receber evento nativo de play', async () => {
    const videoInterno = criarMockVideo()
    configurarDocumentoSemAd(videoInterno)
    const { createAppleTvAdapter } = await import('../../src/adapters/appletv')
    const adapter = await createAppleTvAdapter()

    const handler = vi.fn()
    adapter?.on('play', handler)

    ;(videoInterno as unknown as { _dispatchEvent: (e: string) => void })._dispatchEvent('play')

    expect(handler).toHaveBeenCalledOnce()
    adapter?.destroy()
  })

  it('on("pause") dispara callback ao receber evento nativo de pause', async () => {
    const videoInterno = criarMockVideo()
    configurarDocumentoSemAd(videoInterno)
    const { createAppleTvAdapter } = await import('../../src/adapters/appletv')
    const adapter = await createAppleTvAdapter()

    const handler = vi.fn()
    adapter?.on('pause', handler)

    ;(videoInterno as unknown as { _dispatchEvent: (e: string) => void })._dispatchEvent('pause')

    expect(handler).toHaveBeenCalledOnce()
    adapter?.destroy()
  })

  it('on("seek") dispara callback ao receber evento nativo seeked', async () => {
    const videoInterno = criarMockVideo()
    configurarDocumentoSemAd(videoInterno)
    const { createAppleTvAdapter } = await import('../../src/adapters/appletv')
    const adapter = await createAppleTvAdapter()

    const handler = vi.fn()
    adapter?.on('seek', handler)

    ;(videoInterno as unknown as { _dispatchEvent: (e: string) => void })._dispatchEvent('seeked')

    expect(handler).toHaveBeenCalledOnce()
    adapter?.destroy()
  })

  it('on("buffering") dispara callback ao receber evento nativo waiting', async () => {
    const videoInterno = criarMockVideo()
    configurarDocumentoSemAd(videoInterno)
    const { createAppleTvAdapter } = await import('../../src/adapters/appletv')
    const adapter = await createAppleTvAdapter()

    const handler = vi.fn()
    adapter?.on('buffering', handler)

    ;(videoInterno as unknown as { _dispatchEvent: (e: string) => void })._dispatchEvent('waiting')

    expect(handler).toHaveBeenCalledOnce()
    adapter?.destroy()
  })

  it('on("ended") dispara callback ao receber evento nativo ended', async () => {
    const videoInterno = criarMockVideo()
    configurarDocumentoSemAd(videoInterno)
    const { createAppleTvAdapter } = await import('../../src/adapters/appletv')
    const adapter = await createAppleTvAdapter()

    const handler = vi.fn()
    adapter?.on('ended', handler)

    ;(videoInterno as unknown as { _dispatchEvent: (e: string) => void })._dispatchEvent('ended')

    expect(handler).toHaveBeenCalledOnce()
    adapter?.destroy()
  })

  it('off() remove listener de evento', async () => {
    const videoInterno = criarMockVideo()
    configurarDocumentoSemAd(videoInterno)
    const { createAppleTvAdapter } = await import('../../src/adapters/appletv')
    const adapter = await createAppleTvAdapter()

    const handler = vi.fn()
    adapter?.on('play', handler)
    adapter?.off('play', handler)

    ;(videoInterno as unknown as { _dispatchEvent: (e: string) => void })._dispatchEvent('play')

    expect(handler).not.toHaveBeenCalled()
    adapter?.destroy()
  })

  it('destroy() remove handlers nativos do video', async () => {
    configurarDocumentoSemAd(mockVideo)
    const { createAppleTvAdapter } = await import('../../src/adapters/appletv')
    const adapter = await createAppleTvAdapter()
    adapter?.destroy()
    expect(mockVideo.removeEventListener).toHaveBeenCalled()
  })

  it('destroy() limpa todos os listeners registrados', async () => {
    configurarDocumentoSemAd(mockVideo)
    const { createAppleTvAdapter } = await import('../../src/adapters/appletv')
    const adapter = await createAppleTvAdapter()

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
    // Gate de path: testes SPA precisam comecar em rota de player
    history.pushState({}, '', '/us/episode/episodio-inicial/umc.cmc.abc123')
  })

  afterEach(() => {
    vi.restoreAllMocks()
    vi.resetModules()
    // Restaura MutationObserver global, timers e URL
    globalThis.MutationObserver = MutationObserverOriginal
    vi.useRealTimers()
    history.pushState({}, '', '/')
  })

  it('inicia polling SPA com intervalo de 800ms e limpa no destroy', async () => {
    const video = criarMockVideo()

    class MockMutationObserver {
      observe = vi.fn()
      disconnect = vi.fn()
      constructor(public callback: MutationCallback) {}
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ;(globalThis as any).MutationObserver = MockMutationObserver

    vi.spyOn(document, 'querySelector').mockImplementation((sel: string) => {
      if (sel === '.default-media-player video') return video as unknown as Element
      if (sel === 'video') return video as unknown as Element
      return null
    })
    vi.spyOn(document, 'querySelectorAll').mockReturnValue([video] as unknown as NodeListOf<Element>)

    const setIntervalSpy = vi.spyOn(globalThis, 'setInterval')
    const clearIntervalSpy = vi.spyOn(globalThis, 'clearInterval')

    const { createAppleTvAdapter } = await import('../../src/adapters/appletv')
    const adapter = await createAppleTvAdapter()
    expect(adapter).not.toBeNull()

    // O polling SPA deve ter sido iniciado via setInterval com 800ms
    const chamouSetInterval = setIntervalSpy.mock.calls.some(([, delay]) => delay === 800)
    expect(chamouSetInterval).toBe(true)

    adapter?.destroy()

    // O polling deve ter sido limpo no destroy via clearInterval
    expect(clearIntervalSpy).toHaveBeenCalled()
  })

  it('re-liga listeners ao novo video apos evento popstate em rota de player', async () => {
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
      if (sel === '.default-media-player video') return videoAtivo as unknown as Element
      if (sel === 'video') return videoAtivo as unknown as Element
      return null
    })
    vi.spyOn(document, 'querySelectorAll').mockImplementation((sel: string) => {
      if (sel === 'video') return [videoAtivo] as unknown as NodeListOf<Element>
      return [] as unknown as NodeListOf<Element>
    })

    const { createAppleTvAdapter } = await import('../../src/adapters/appletv')
    const adapter = await createAppleTvAdapter()
    expect(adapter).not.toBeNull()

    const pauseHandler = vi.fn()
    adapter?.on('pause', pauseHandler)

    // Navega para rota de player do Apple TV+: /us/episode/* ou /play/*
    history.pushState({}, '', '/us/episode/episodio-teste/umc.cmc.abc123')
    videoAtivo = videoNovo
    window.dispatchEvent(new PopStateEvent('popstate'))

    // Aguarda re-resolucao: inclui SPA_RENAVIGATE_DELAY_MS=150ms + margem
    await new Promise((r) => setTimeout(r, 200))

    ;(videoNovo as unknown as { _dispatchEvent: (e: string) => void })._dispatchEvent('pause')
    expect(pauseHandler).toHaveBeenCalled()

    adapter?.destroy()
    history.pushState({}, '', '/')
  })

  it('popstate em rota /play/* dispara re-ligacao', async () => {
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
      if (sel === '.default-media-player video') return videoAtivo as unknown as Element
      if (sel === 'video') return videoAtivo as unknown as Element
      return null
    })
    vi.spyOn(document, 'querySelectorAll').mockImplementation((sel: string) => {
      if (sel === 'video') return [videoAtivo] as unknown as NodeListOf<Element>
      return [] as unknown as NodeListOf<Element>
    })

    const { createAppleTvAdapter } = await import('../../src/adapters/appletv')
    const adapter = await createAppleTvAdapter()

    const playHandler = vi.fn()
    adapter?.on('play', playHandler)

    // Navega para rota /play/* (formato alternativo do Apple TV+)
    history.pushState({}, '', '/play/episode/umc.cmc.xyz789')
    videoAtivo = videoNovo
    window.dispatchEvent(new PopStateEvent('popstate'))

    // Aguarda re-resolucao: inclui delay SPA_RENAVIGATE_DELAY_MS=150ms + margem
    await new Promise((r) => setTimeout(r, 200))

    ;(videoNovo as unknown as { _dispatchEvent: (e: string) => void })._dispatchEvent('play')
    expect(playHandler).toHaveBeenCalled()

    adapter?.destroy()
    history.pushState({}, '', '/')
  })

  it('gate de path: popstate fora de rota de player nao dispara re-ligacao', async () => {
    const video = criarMockVideo()

    class MockMutationObserver {
      observe = vi.fn()
      disconnect = vi.fn()
      constructor(public callback: MutationCallback) {}
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ;(globalThis as any).MutationObserver = MockMutationObserver

    vi.spyOn(document, 'querySelector').mockImplementation((sel: string) => {
      if (sel === '.default-media-player video') return video as unknown as Element
      if (sel === 'video') return video as unknown as Element
      return null
    })
    vi.spyOn(document, 'querySelectorAll').mockReturnValue([video] as unknown as NodeListOf<Element>)

    const { createAppleTvAdapter } = await import('../../src/adapters/appletv')
    const adapter = await createAppleTvAdapter()

    // Remove mocks para contar chamadas a partir daqui
    vi.clearAllMocks()
    const removeListenerSpy = vi.spyOn(video, 'removeEventListener')

    // Navega para pagina fora do player (catalogo, home)
    history.pushState({}, '', '/br/show/nome-do-show/umc.cmc.abc')
    window.dispatchEvent(new PopStateEvent('popstate'))

    await new Promise((r) => setTimeout(r, 20))

    // Nenhuma re-ligacao deve ter ocorrido (removeEventListener nao chamado pelo SPA)
    expect(removeListenerSpy).not.toHaveBeenCalled()

    adapter?.destroy()
    history.pushState({}, '', '/')
  })

  it('destroy() remove listener de popstate', async () => {
    const video = criarMockVideo()

    vi.spyOn(document, 'querySelector').mockImplementation((sel: string) => {
      if (sel === '.default-media-player video') return video as unknown as Element
      if (sel === 'video') return video as unknown as Element
      return null
    })
    vi.spyOn(document, 'querySelectorAll').mockReturnValue([video] as unknown as NodeListOf<Element>)

    const addSpy = vi.spyOn(window, 'addEventListener')
    const removeSpy = vi.spyOn(window, 'removeEventListener')

    const { createAppleTvAdapter } = await import('../../src/adapters/appletv')
    const adapter = await createAppleTvAdapter()
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

    const { createAppleTvAdapter } = await import('../../src/adapters/appletv')
    const adapter = await createAppleTvAdapter()
    adapter?.destroy()

    expect(clearIntervalSpy).toHaveBeenCalled()
  })

  it('destroy() durante aguardarVideoAppleTv pendente nao reinstala handlers', async () => {
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

    // Primeira chamada: retorna o video (createAppleTvAdapter inicial)
    // Chamadas subsequentes (onSpaNavegacao): retornam null (video sumiu)
    let queryCalls = 0
    vi.spyOn(document, 'querySelector').mockImplementation((sel: string) => {
      queryCalls++
      if (queryCalls <= 2 && sel === '.default-media-player video') return video as unknown as Element
      if (queryCalls <= 2 && sel === 'video') return video as unknown as Element
      return null
    })
    vi.spyOn(document, 'querySelectorAll').mockImplementation((sel: string) => {
      if (sel === 'video' && queryCalls <= 2) return [video] as unknown as NodeListOf<Element>
      return [] as unknown as NodeListOf<Element>
    })

    const { createAppleTvAdapter } = await import('../../src/adapters/appletv')
    const adapter = await createAppleTvAdapter()
    expect(adapter).not.toBeNull()

    // Navega para rota de player e dispara SPA (onSpaNavegacao fica esperando o video)
    history.pushState({}, '', '/us/episode/nome/umc.cmc.abc123')
    window.dispatchEvent(new PopStateEvent('popstate'))

    // Destroy imediato (antes de aguardarVideoAppleTv resolver)
    adapter?.destroy()

    // Dispara o MutationObserver mockado - simula video aparecendo apos destroy
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const cbCapturado = observerCallback as ((...args: any[]) => void) | null
    if (cbCapturado) {
      vi.spyOn(document, 'querySelector').mockImplementation((sel: string) => {
        if (sel === '.default-media-player video') return video as unknown as Element
        return null
      })
      cbCapturado([], null)
    }

    // Aguarda microtasks
    await new Promise((r) => setTimeout(r, 20))

    // Apos destroy + resolucao tardia, removeEventListener deve ter sido chamado
    // e nenhum erro ou reinstalacao de handlers deve ter ocorrido
    expect(video.removeEventListener).toHaveBeenCalled()

    history.pushState({}, '', '/')
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
      if (sel === '.default-media-player video') return videoAtivo as unknown as Element
      if (sel === 'video') return videoAtivo as unknown as Element
      return null
    })
    vi.spyOn(document, 'querySelectorAll').mockImplementation((sel: string) => {
      if (sel === 'video') return [videoAtivo] as unknown as NodeListOf<Element>
      return [] as unknown as NodeListOf<Element>
    })

    const { createAppleTvAdapter } = await import('../../src/adapters/appletv')
    const adapter = await createAppleTvAdapter()
    expect(adapter).not.toBeNull()

    const playHandler = vi.fn()
    adapter?.on('play', playHandler)

    // Navega para rota de player para que spaPopstateHandler nao filtre os eventos
    history.pushState({}, '', '/us/episode/primeiro/umc.cmc.111')

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
      if (sel === '.default-media-player video') return video as unknown as Element
      if (sel === 'video') return video as unknown as Element
      return null
    })
    vi.spyOn(document, 'querySelectorAll').mockReturnValue([video] as unknown as NodeListOf<Element>)

    vi.useFakeTimers({ toFake: ['setTimeout', 'setInterval', 'clearInterval', 'clearTimeout'] })

    const { createAppleTvAdapter } = await import('../../src/adapters/appletv')
    const adapter = await createAppleTvAdapter()
    expect(adapter).not.toBeNull()

    const removeListenerSpy = vi.spyOn(video, 'removeEventListener')

    // Simula pushState para rota de player do Apple TV+
    history.pushState({}, '', '/br/episode/novo-episodio/umc.cmc.xyz999')

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

describe('Anuncio: Apple TV+ nao tem anuncios', () => {
  let MutationObserverOriginal: typeof MutationObserver

  beforeEach(() => {
    MutationObserverOriginal = globalThis.MutationObserver
    // Garante timers reais (isola de vi.useFakeTimers de testes SPA anteriores)
    vi.useRealTimers()
    // Gate de path: testes de anuncio precisam estar em rota de player
    history.pushState({}, '', '/us/episode/episodio-teste/umc.cmc.abc123')
  })

  afterEach(() => {
    vi.restoreAllMocks()
    vi.resetModules()
    // Restaura MutationObserver global, timers e URL
    globalThis.MutationObserver = MutationObserverOriginal
    vi.useRealTimers()
    history.pushState({}, '', '/')
  })

  it('isAd() retorna sempre false independente do DOM', async () => {
    const video = criarMockVideo()
    const adEl = criarElementoAdVisivel()

    class MockMutationObserver {
      observe = vi.fn()
      disconnect = vi.fn()
      constructor(public callback: MutationCallback) {}
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ;(globalThis as any).MutationObserver = MockMutationObserver

    // Mesmo retornando elemento visivel para qualquer seletor, isAd() deve ser false
    // pois AD_SELETORES e vazio no adapter Apple TV+
    vi.spyOn(document, 'querySelector').mockImplementation((sel: string) => {
      if (sel === '.default-media-player video') return video as unknown as Element
      return adEl
    })
    vi.spyOn(document, 'querySelectorAll').mockReturnValue([video] as unknown as NodeListOf<Element>)

    const { createAppleTvAdapter } = await import('../../src/adapters/appletv')
    const adapter = await createAppleTvAdapter()

    expect(adapter?.isAd()).toBe(false)
    adapter?.destroy()
  })

  it('MutationObserver de anuncio NAO e criado pois AD_SELETORES esta vazio (MEDIUM-1)', async () => {
    // Apple TV+ nao tem anuncios - AD_SELETORES e vazio - guard impede criacao do observer
    const video = criarMockVideo()
    const observeSpy = vi.fn()

    class MockMutationObserver {
      observe = observeSpy
      disconnect = vi.fn()
      constructor(public callback: MutationCallback) {}
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ;(globalThis as any).MutationObserver = MockMutationObserver

    vi.spyOn(document, 'querySelector').mockImplementation((sel: string) => {
      if (sel === '.default-media-player video') return video as unknown as Element
      if (sel === 'video') return video as unknown as Element
      return null
    })
    vi.spyOn(document, 'querySelectorAll').mockReturnValue([video] as unknown as NodeListOf<Element>)

    const { createAppleTvAdapter } = await import('../../src/adapters/appletv')
    const adapter = await createAppleTvAdapter()

    // O MutationObserver nao deve ter chamado observe (guard interceptou antes de criar)
    expect(observeSpy).not.toHaveBeenCalled()
    adapter?.destroy()
  })

  it('destroy() e seguro quando adObserver e null (guard AD_SELETORES)', async () => {
    // Verifica que destroy() nao lanca excecao quando o observer nunca foi criado
    const video = criarMockVideo()

    class MockMutationObserver {
      observe = vi.fn()
      disconnect = vi.fn()
      constructor(public callback: MutationCallback) {}
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ;(globalThis as any).MutationObserver = MockMutationObserver

    vi.spyOn(document, 'querySelector').mockImplementation((sel: string) => {
      if (sel === '.default-media-player video') return video as unknown as Element
      if (sel === 'video') return video as unknown as Element
      return null
    })
    vi.spyOn(document, 'querySelectorAll').mockReturnValue([video] as unknown as NodeListOf<Element>)

    const { createAppleTvAdapter } = await import('../../src/adapters/appletv')
    const adapter = await createAppleTvAdapter()

    // destroy() nao deve lancar excecao mesmo sem adObserver criado
    expect(() => adapter?.destroy()).not.toThrow()
  })

  it('nao emite ad-start: guard AD_SELETORES impede criacao do MutationObserver (MEDIUM-1)', async () => {
    // Com AD_SELETORES vazio, configurarAdObserver() retorna sem criar o observer.
    // Portanto observerCallback nunca e definido e ad-start nunca e emitido.
    const video = criarMockVideo()

    const observeSpy = vi.fn()
    class MockMutationObserver {
      observe = observeSpy
      disconnect = vi.fn()
      constructor(public callback: MutationCallback) {}
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ;(globalThis as any).MutationObserver = MockMutationObserver

    vi.spyOn(document, 'querySelector').mockImplementation((sel: string) => {
      if (sel === '.default-media-player video') return video as unknown as Element
      if (sel === 'video') return video as unknown as Element
      return null
    })
    vi.spyOn(document, 'querySelectorAll').mockReturnValue([video] as unknown as NodeListOf<Element>)

    const { createAppleTvAdapter } = await import('../../src/adapters/appletv')
    const adapter = await createAppleTvAdapter()

    const adStartHandler = vi.fn()
    adapter?.on('ad-start', adStartHandler)

    // Guard impede criacao do observer - nenhum observe() deve ter sido chamado
    expect(observeSpy).not.toHaveBeenCalled()
    // E consequentemente ad-start nunca seria emitido
    expect(adStartHandler).not.toHaveBeenCalled()
    adapter?.destroy()
  })
})

// ---------------------------------------------------------------------------
// Testes de gate de path - HIGH-1 e CodeRabbit #1
// ---------------------------------------------------------------------------

describe('Gate de path: selecionarVideoAppleTv e createAppleTvAdapter', () => {
  let MutationObserverOriginal: typeof MutationObserver

  beforeEach(() => {
    MutationObserverOriginal = globalThis.MutationObserver

    class MockMutationObserver {
      observe = vi.fn()
      disconnect = vi.fn()
      constructor(public callback: MutationCallback) {}
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ;(globalThis as any).MutationObserver = MockMutationObserver
  })

  afterEach(() => {
    vi.restoreAllMocks()
    vi.resetModules()
    globalThis.MutationObserver = MutationObserverOriginal
    vi.useRealTimers()
    history.pushState({}, '', '/')
  })

  it('HIGH-1: selecionarVideoAppleTv retorna null em rota raiz "/"', async () => {
    // Mesmo com video presente no DOM, o gate de path bloqueia fora do player
    const video = criarMockVideo()
    history.pushState({}, '', '/')

    vi.spyOn(document, 'querySelector').mockImplementation((sel: string) => {
      if (sel === '.default-media-player video') return video as unknown as Element
      return null
    })
    vi.spyOn(document, 'querySelectorAll').mockReturnValue([video] as unknown as NodeListOf<Element>)

    // Importamos apenas a funcao interna via createAppleTvAdapter:
    // como o gate tambem esta no createAppleTvAdapter, ele retorna null imediatamente
    const { createAppleTvAdapter } = await import('../../src/adapters/appletv')
    const adapter = await createAppleTvAdapter()
    expect(adapter).toBeNull()
  })

  it('HIGH-1: createAppleTvAdapter retorna null em rota /catalog', async () => {
    const video = criarMockVideo()
    history.pushState({}, '', '/catalog')

    vi.spyOn(document, 'querySelector').mockImplementation((sel: string) => {
      if (sel === '.default-media-player video') return video as unknown as Element
      return null
    })
    vi.spyOn(document, 'querySelectorAll').mockReturnValue([video] as unknown as NodeListOf<Element>)

    const { createAppleTvAdapter } = await import('../../src/adapters/appletv')
    const adapter = await createAppleTvAdapter()
    expect(adapter).toBeNull()
  })

  it('HIGH-1: createAppleTvAdapter retorna adapter em /us/episode/', async () => {
    const video = criarMockVideo()
    history.pushState({}, '', '/us/episode/nome/umc.cmc.abc123')

    vi.spyOn(document, 'querySelector').mockImplementation((sel: string) => {
      if (sel === '.default-media-player video') return video as unknown as Element
      return null
    })
    vi.spyOn(document, 'querySelectorAll').mockReturnValue([video] as unknown as NodeListOf<Element>)

    const { createAppleTvAdapter } = await import('../../src/adapters/appletv')
    const adapter = await createAppleTvAdapter()
    expect(adapter).not.toBeNull()
    adapter?.destroy()
  })

  it('HIGH-1: createAppleTvAdapter retorna adapter em /play/', async () => {
    const video = criarMockVideo()
    history.pushState({}, '', '/play/episode/umc.cmc.xyz789')

    vi.spyOn(document, 'querySelector').mockImplementation((sel: string) => {
      if (sel === '.default-media-player video') return video as unknown as Element
      return null
    })
    vi.spyOn(document, 'querySelectorAll').mockReturnValue([video] as unknown as NodeListOf<Element>)

    const { createAppleTvAdapter } = await import('../../src/adapters/appletv')
    const adapter = await createAppleTvAdapter()
    expect(adapter).not.toBeNull()
    adapter?.destroy()
  })

  it('MEDIUM-2: gate de path aceita locale lowercase /en-us/episode/ (case-insensitive)', async () => {
    // Browser pode normalizar en-US para en-us - a regex com flag /i deve aceitar ambos
    const video = criarMockVideo()
    history.pushState({}, '', '/en-us/episode/nome-do-episodio/umc.cmc.abc')

    vi.spyOn(document, 'querySelector').mockImplementation((sel: string) => {
      if (sel === '.default-media-player video') return video as unknown as Element
      return null
    })
    vi.spyOn(document, 'querySelectorAll').mockReturnValue([video] as unknown as NodeListOf<Element>)

    const { createAppleTvAdapter } = await import('../../src/adapters/appletv')
    const adapter = await createAppleTvAdapter()
    expect(adapter).not.toBeNull()
    adapter?.destroy()
  })

  it('MEDIUM-2: gate de path aceita locale uppercase /en-US/episode/ (case-insensitive)', async () => {
    // Formato original com regiao em maiusculas
    const video = criarMockVideo()
    history.pushState({}, '', '/en-US/episode/nome-do-episodio/umc.cmc.xyz')

    vi.spyOn(document, 'querySelector').mockImplementation((sel: string) => {
      if (sel === '.default-media-player video') return video as unknown as Element
      return null
    })
    vi.spyOn(document, 'querySelectorAll').mockReturnValue([video] as unknown as NodeListOf<Element>)

    const { createAppleTvAdapter } = await import('../../src/adapters/appletv')
    const adapter = await createAppleTvAdapter()
    expect(adapter).not.toBeNull()
    adapter?.destroy()
  })

  it('MEDIUM-2: gate de path rejeita /catalog mesmo com video grande no DOM', async () => {
    const video = criarMockVideo()
    history.pushState({}, '', '/catalog')

    vi.spyOn(document, 'querySelector').mockImplementation((sel: string) => {
      if (sel === '.default-media-player video') return video as unknown as Element
      return null
    })
    vi.spyOn(document, 'querySelectorAll').mockReturnValue([video] as unknown as NodeListOf<Element>)

    const { createAppleTvAdapter } = await import('../../src/adapters/appletv')
    const adapter = await createAppleTvAdapter()
    expect(adapter).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// Testes de selecao de video (heuristica)
// ---------------------------------------------------------------------------

describe('Heuristica de selecao do video principal', () => {
  beforeEach(() => {
    // Gate de path: testes de heuristica precisam estar em rota de player
    history.pushState({}, '', '/us/episode/episodio-teste/umc.cmc.abc123')
  })

  afterEach(() => {
    vi.restoreAllMocks()
    vi.resetModules()
    history.pushState({}, '', '/')
  })

  it('prefere o video do container .default-media-player quando disponivel', async () => {
    const videoPlayer = criarMockVideo({ currentTime: 100 })
    const videoTrailer = criarMockVideo({ currentTime: 5 })

    vi.spyOn(document, 'querySelector').mockImplementation((sel: string) => {
      if (sel === '.default-media-player video') return videoPlayer as unknown as Element
      if (sel === 'video') return videoTrailer as unknown as Element
      return null
    })
    vi.spyOn(document, 'querySelectorAll').mockReturnValue(
      [videoPlayer, videoTrailer] as unknown as NodeListOf<Element>,
    )

    const { createAppleTvAdapter } = await import('../../src/adapters/appletv')
    const adapter = await createAppleTvAdapter()

    // O adapter deve ter conectado ao video do player, nao ao trailer
    expect(adapter?.getCurrentTime()).toBe(100)
    adapter?.destroy()
  })

  it('usa video.video-player como fallback quando .default-media-player falha', async () => {
    const videoAlt = criarMockVideo({ currentTime: 200 })

    vi.spyOn(document, 'querySelector').mockImplementation((sel: string) => {
      if (sel === '.default-media-player video') return null
      if (sel === 'video.video-player') return videoAlt as unknown as Element
      if (sel === 'video') return videoAlt as unknown as Element
      return null
    })
    vi.spyOn(document, 'querySelectorAll').mockReturnValue([videoAlt] as unknown as NodeListOf<Element>)

    const { createAppleTvAdapter } = await import('../../src/adapters/appletv')
    const adapter = await createAppleTvAdapter()

    expect(adapter?.getCurrentTime()).toBe(200)
    adapter?.destroy()
  })

  it('escolhe o video de maior duracao quando seletores especificos falham', async () => {
    const videoConteudo = criarMockVideo()
    Object.defineProperty(videoConteudo, 'duration', { value: 3600, configurable: true })
    Object.defineProperty(videoConteudo, 'readyState', { value: 4, configurable: true })
    videoConteudo.currentTime = 300

    const videoTrailer = criarMockVideo()
    Object.defineProperty(videoTrailer, 'duration', { value: 90, configurable: true })
    Object.defineProperty(videoTrailer, 'readyState', { value: 4, configurable: true })
    videoTrailer.currentTime = 10

    vi.spyOn(document, 'querySelector').mockImplementation((sel: string) => {
      // Todos os seletores especificos falham
      if (sel === '.default-media-player video') return null
      if (sel === 'video.video-player') return null
      if (sel === 'video') return videoTrailer as unknown as Element
      return null
    })
    vi.spyOn(document, 'querySelectorAll').mockImplementation((sel: string) => {
      if (sel === 'video') return [videoTrailer, videoConteudo] as unknown as NodeListOf<Element>
      return [] as unknown as NodeListOf<Element>
    })

    const { createAppleTvAdapter } = await import('../../src/adapters/appletv')
    const adapter = await createAppleTvAdapter()

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
      if (sel === '.default-media-player video') return null
      if (sel === 'video.video-player') return null
      return null
    })
    vi.spyOn(document, 'querySelectorAll').mockImplementation((sel: string) => {
      if (sel === 'video') return [videoPequeno, videoGrande] as unknown as NodeListOf<Element>
      return [] as unknown as NodeListOf<Element>
    })

    const { createAppleTvAdapter } = await import('../../src/adapters/appletv')
    const adapter = await createAppleTvAdapter()

    // Deve ter escolhido o video de maior area renderizada
    expect(adapter?.getCurrentTime()).toBe(42)
    adapter?.destroy()
  })
})
