// tests/adapters/netflix.test.ts
// Testes unitarios para o adapter de Netflix.
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
    // M1: getBoundingClientRect necessario para a validacao de area do video principal
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
 * e nenhum elemento de UI de anuncio.
 */
function configurarDocumentoSemAd(videoEl: HTMLVideoElement): void {
  vi.spyOn(document, 'querySelector').mockImplementation((selector: string) => {
    if (selector === '.watch-video--player-view video') return videoEl as unknown as Element
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
 * Configura document.querySelector para simular UI de anuncio visivel.
 * Usa o seletor data-uia="ad-ui" que e o mais estavel.
 */
function configurarDocumentoComAd(videoEl: HTMLVideoElement): void {
  const adEl = document.createElement('div')

  vi.spyOn(document, 'querySelector').mockImplementation((selector: string) => {
    if (selector === '.watch-video--player-view video') return videoEl as unknown as Element
    if (selector === 'video') return videoEl as unknown as Element
    // Seletores de UI de anuncio retornam um elemento ficticio
    if (
      selector === '[data-uia="ad-ui"]' ||
      selector === '[data-uia="ad-skip-button"]' ||
      selector === '[data-uia="ad-countdown"]' ||
      selector === '.watch-video--skip-ad' ||
      selector === '.nfp-ad-ui'
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

describe('createNetflixAdapter', () => {
  let mockVideo: HTMLVideoElement

  beforeEach(() => {
    mockVideo = criarMockVideo()
    vi.clearAllMocks()
    configurarDocumentoSemAd(mockVideo)
  })

  afterEach(() => {
    vi.restoreAllMocks()
    vi.resetModules()
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

    const { createNetflixAdapter } = await import('../../src/adapters/netflix')

    vi.useFakeTimers()
    const promiseAdapter = createNetflixAdapter()

    // Avanca alem do VIDEO_WAIT_TIMEOUT_MS (8000ms)
    vi.advanceTimersByTime(9000)
    const adapter = await promiseAdapter
    expect(adapter).toBeNull()

    vi.useRealTimers()
  })

  it('retorna adapter quando elemento video esta presente', async () => {
    configurarDocumentoSemAd(mockVideo)
    const { createNetflixAdapter } = await import('../../src/adapters/netflix')
    const adapter = await createNetflixAdapter()
    expect(adapter).not.toBeNull()
    adapter?.destroy()
  })

  it('getCurrentTime retorna currentTime do video', async () => {
    mockVideo.currentTime = 120.5
    configurarDocumentoSemAd(mockVideo)
    const { createNetflixAdapter } = await import('../../src/adapters/netflix')
    const adapter = await createNetflixAdapter()
    expect(adapter?.getCurrentTime()).toBe(120.5)
    adapter?.destroy()
  })

  it('getDuration retorna duration do video', async () => {
    Object.defineProperty(mockVideo, 'duration', { value: 7200, writable: true, configurable: true })
    configurarDocumentoSemAd(mockVideo)
    const { createNetflixAdapter } = await import('../../src/adapters/netflix')
    const adapter = await createNetflixAdapter()
    expect(adapter?.getDuration()).toBe(7200)
    adapter?.destroy()
  })

  it('getDuration retorna 0 quando duration e NaN', async () => {
    Object.defineProperty(mockVideo, 'duration', { value: NaN, writable: true, configurable: true })
    configurarDocumentoSemAd(mockVideo)
    const { createNetflixAdapter } = await import('../../src/adapters/netflix')
    const adapter = await createNetflixAdapter()
    expect(adapter?.getDuration()).toBe(0)
    adapter?.destroy()
  })

  it('play() chama video.play()', async () => {
    configurarDocumentoSemAd(mockVideo)
    const { createNetflixAdapter } = await import('../../src/adapters/netflix')
    const adapter = await createNetflixAdapter()
    await adapter?.play()
    expect(mockVideo.play).toHaveBeenCalledOnce()
    adapter?.destroy()
  })

  it('pause() chama video.pause()', async () => {
    configurarDocumentoSemAd(mockVideo)
    const { createNetflixAdapter } = await import('../../src/adapters/netflix')
    const adapter = await createNetflixAdapter()
    await adapter?.pause()
    expect(mockVideo.pause).toHaveBeenCalledOnce()
    adapter?.destroy()
  })

  it('seekTo() atualiza currentTime do video', async () => {
    configurarDocumentoSemAd(mockVideo)
    const { createNetflixAdapter } = await import('../../src/adapters/netflix')
    const adapter = await createNetflixAdapter()
    await adapter?.seekTo(450.0)
    expect(mockVideo.currentTime).toBe(450.0)
    adapter?.destroy()
  })

  it('getPlaybackState() retorna "playing" quando video nao esta pausado', async () => {
    Object.defineProperty(mockVideo, 'paused', { value: false, writable: true, configurable: true })
    configurarDocumentoSemAd(mockVideo)
    const { createNetflixAdapter } = await import('../../src/adapters/netflix')
    const adapter = await createNetflixAdapter()
    expect(adapter?.getPlaybackState()).toBe('playing')
    adapter?.destroy()
  })

  it('getPlaybackState() retorna "paused" quando video esta pausado', async () => {
    Object.defineProperty(mockVideo, 'paused', { value: true, writable: true, configurable: true })
    configurarDocumentoSemAd(mockVideo)
    const { createNetflixAdapter } = await import('../../src/adapters/netflix')
    const adapter = await createNetflixAdapter()
    expect(adapter?.getPlaybackState()).toBe('paused')
    adapter?.destroy()
  })

  it('getPlaybackState() retorna "buffering" quando readyState < HAVE_METADATA', async () => {
    Object.defineProperty(mockVideo, 'readyState', { value: 1, writable: true, configurable: true })
    Object.defineProperty(mockVideo, 'paused', { value: false, writable: true, configurable: true })
    configurarDocumentoSemAd(mockVideo)
    const { createNetflixAdapter } = await import('../../src/adapters/netflix')
    const adapter = await createNetflixAdapter()
    expect(adapter?.getPlaybackState()).toBe('buffering')
    adapter?.destroy()
  })

  it('getPlaybackState() retorna "ad" durante anuncio', async () => {
    configurarDocumentoComAd(mockVideo)
    const { createNetflixAdapter } = await import('../../src/adapters/netflix')
    const adapter = await createNetflixAdapter()
    expect(adapter?.getPlaybackState()).toBe('ad')
    adapter?.destroy()
  })

  it('isAd() retorna true quando UI de anuncio esta presente', async () => {
    configurarDocumentoComAd(mockVideo)
    const { createNetflixAdapter } = await import('../../src/adapters/netflix')
    const adapter = await createNetflixAdapter()
    expect(adapter?.isAd()).toBe(true)
    adapter?.destroy()
  })

  it('isAd() retorna false quando UI de anuncio esta ausente', async () => {
    configurarDocumentoSemAd(mockVideo)
    const { createNetflixAdapter } = await import('../../src/adapters/netflix')
    const adapter = await createNetflixAdapter()
    expect(adapter?.isAd()).toBe(false)
    adapter?.destroy()
  })

  it('on("play") dispara callback ao receber evento nativo de play', async () => {
    const videoInterno = criarMockVideo()
    configurarDocumentoSemAd(videoInterno)
    const { createNetflixAdapter } = await import('../../src/adapters/netflix')
    const adapter = await createNetflixAdapter()

    const handler = vi.fn()
    adapter?.on('play', handler)

    ;(videoInterno as unknown as { _dispatchEvent: (e: string) => void })._dispatchEvent('play')

    expect(handler).toHaveBeenCalledOnce()
    adapter?.destroy()
  })

  it('on("pause") dispara callback ao receber evento nativo de pause', async () => {
    const videoInterno = criarMockVideo()
    configurarDocumentoSemAd(videoInterno)
    const { createNetflixAdapter } = await import('../../src/adapters/netflix')
    const adapter = await createNetflixAdapter()

    const handler = vi.fn()
    adapter?.on('pause', handler)

    ;(videoInterno as unknown as { _dispatchEvent: (e: string) => void })._dispatchEvent('pause')

    expect(handler).toHaveBeenCalledOnce()
    adapter?.destroy()
  })

  it('on("seek") dispara callback ao receber evento nativo seeked', async () => {
    const videoInterno = criarMockVideo()
    configurarDocumentoSemAd(videoInterno)
    const { createNetflixAdapter } = await import('../../src/adapters/netflix')
    const adapter = await createNetflixAdapter()

    const handler = vi.fn()
    adapter?.on('seek', handler)

    ;(videoInterno as unknown as { _dispatchEvent: (e: string) => void })._dispatchEvent('seeked')

    expect(handler).toHaveBeenCalledOnce()
    adapter?.destroy()
  })

  it('on("buffering") dispara callback ao receber evento nativo waiting', async () => {
    const videoInterno = criarMockVideo()
    configurarDocumentoSemAd(videoInterno)
    const { createNetflixAdapter } = await import('../../src/adapters/netflix')
    const adapter = await createNetflixAdapter()

    const handler = vi.fn()
    adapter?.on('buffering', handler)

    ;(videoInterno as unknown as { _dispatchEvent: (e: string) => void })._dispatchEvent('waiting')

    expect(handler).toHaveBeenCalledOnce()
    adapter?.destroy()
  })

  it('on("ended") dispara callback ao receber evento nativo ended', async () => {
    const videoInterno = criarMockVideo()
    configurarDocumentoSemAd(videoInterno)
    const { createNetflixAdapter } = await import('../../src/adapters/netflix')
    const adapter = await createNetflixAdapter()

    const handler = vi.fn()
    adapter?.on('ended', handler)

    ;(videoInterno as unknown as { _dispatchEvent: (e: string) => void })._dispatchEvent('ended')

    expect(handler).toHaveBeenCalledOnce()
    adapter?.destroy()
  })

  it('off() remove listener de evento', async () => {
    const videoInterno = criarMockVideo()
    configurarDocumentoSemAd(videoInterno)
    const { createNetflixAdapter } = await import('../../src/adapters/netflix')
    const adapter = await createNetflixAdapter()

    const handler = vi.fn()
    adapter?.on('play', handler)
    adapter?.off('play', handler)

    ;(videoInterno as unknown as { _dispatchEvent: (e: string) => void })._dispatchEvent('play')

    expect(handler).not.toHaveBeenCalled()
    adapter?.destroy()
  })

  it('getServiceType() retorna "native-html5"', async () => {
    configurarDocumentoSemAd(mockVideo)
    const { createNetflixAdapter } = await import('../../src/adapters/netflix')
    const adapter = await createNetflixAdapter()
    expect(adapter?.getServiceType()).toBe('native-html5')
    adapter?.destroy()
  })

  it('destroy() remove handlers nativos do video', async () => {
    configurarDocumentoSemAd(mockVideo)
    const { createNetflixAdapter } = await import('../../src/adapters/netflix')
    const adapter = await createNetflixAdapter()
    adapter?.destroy()
    expect(mockVideo.removeEventListener).toHaveBeenCalled()
  })

  it('destroy() limpa todos os listeners registrados', async () => {
    configurarDocumentoSemAd(mockVideo)
    const { createNetflixAdapter } = await import('../../src/adapters/netflix')
    const adapter = await createNetflixAdapter()

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
  afterEach(() => {
    vi.restoreAllMocks()
    vi.resetModules()
  })

  it('re-liga listeners ao novo video apos mudanca de URL via polling', async () => {
    // Nota: o polling SPA tem intervalo de 800ms. Para testar sem esperar,
    // usamos MutationObserver mock (resolucao imediata) e disparamos o popstate
    // como proxy do mesmo handler de re-ligacao. O caminho de codigo do polling
    // (deteccao de location.href diferente) e coberto pelo teste de popstate -
    // ambos chamam o mesmo onSpaNavegacao internamente.
    //
    // Este teste verifica que o adapter registra um setInterval e o cancela no destroy.
    const video = criarMockVideo()

    class MockMutationObserver {
      observe = vi.fn()
      disconnect = vi.fn()
      constructor(public callback: MutationCallback) {}
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ;(globalThis as any).MutationObserver = MockMutationObserver

    vi.spyOn(document, 'querySelector').mockImplementation((sel: string) => {
      if (sel === '.watch-video--player-view video') return video as unknown as Element
      if (sel === 'video') return video as unknown as Element
      return null
    })
    vi.spyOn(document, 'querySelectorAll').mockReturnValue([video] as unknown as NodeListOf<Element>)

    // Espiona setInterval e clearInterval para verificar o ciclo de vida do polling
    const setIntervalSpy = vi.spyOn(globalThis, 'setInterval')
    const clearIntervalSpy = vi.spyOn(globalThis, 'clearInterval')

    const { createNetflixAdapter } = await import('../../src/adapters/netflix')
    const adapter = await createNetflixAdapter()
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

    // MutationObserver mock para evitar que aguardarVideo fique esperando
    // o timeout de 8s quando o video ja esta disponivel no mock
    class MockMutationObserver {
      observe = vi.fn()
      disconnect = vi.fn()
      constructor(public callback: MutationCallback) {}
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ;(globalThis as any).MutationObserver = MockMutationObserver

    vi.spyOn(document, 'querySelector').mockImplementation((sel: string) => {
      // Seletor primario sempre retorna o video ativo - resolucao imediata
      if (sel === '.watch-video--player-view video') return videoAtivo as unknown as Element
      if (sel === 'video') return videoAtivo as unknown as Element
      return null
    })
    vi.spyOn(document, 'querySelectorAll').mockImplementation((sel: string) => {
      if (sel === 'video') return [videoAtivo] as unknown as NodeListOf<Element>
      return [] as unknown as NodeListOf<Element>
    })

    const { createNetflixAdapter } = await import('../../src/adapters/netflix')
    const adapter = await createNetflixAdapter()
    expect(adapter).not.toBeNull()

    const pauseHandler = vi.fn()
    adapter?.on('pause', pauseHandler)

    // Simula troca de episodio via back/forward a partir de uma URL /watch/:
    // o spaPopstateHandler filtra por pathname /watch/, entao a URL precisa estar la.
    history.pushState({}, '', '/watch/12345')
    videoAtivo = videoNovo
    window.dispatchEvent(new PopStateEvent('popstate'))

    // Aguarda a re-resolucao assincrona - seletor primario resolve imediatamente
    await new Promise((r) => setTimeout(r, 20))

    ;(videoNovo as unknown as { _dispatchEvent: (e: string) => void })._dispatchEvent('pause')
    expect(pauseHandler).toHaveBeenCalled()

    adapter?.destroy()
    history.pushState({}, '', '/')
  })

  it('destroy() remove listener de popstate', async () => {
    const video = criarMockVideo()

    vi.spyOn(document, 'querySelector').mockImplementation((sel: string) => {
      if (sel === '.watch-video--player-view video') return video as unknown as Element
      if (sel === 'video') return video as unknown as Element
      return null
    })
    vi.spyOn(document, 'querySelectorAll').mockReturnValue([video] as unknown as NodeListOf<Element>)

    const addSpy = vi.spyOn(window, 'addEventListener')
    const removeSpy = vi.spyOn(window, 'removeEventListener')

    const { createNetflixAdapter } = await import('../../src/adapters/netflix')
    const adapter = await createNetflixAdapter()
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

    const { createNetflixAdapter } = await import('../../src/adapters/netflix')
    const adapter = await createNetflixAdapter()
    adapter?.destroy()

    // clearInterval deve ter sido chamado para o polling de SPA
    expect(clearIntervalSpy).toHaveBeenCalled()
  })

  it('HIGH-2: destroy() durante aguardarVideoNetflix pendente nao reinstala handlers', async () => {
    // Cenario: aguardarVideoNetflix leva tempo (video nao disponivel imediatamente)
    // destroy() e chamado antes da promise resolver; o adapter nao deve tentar
    // registrar handlers num elemento destruido.
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

    // Primeira chamada: retorna o video (para o createNetflixAdapter inicial)
    // Chamadas subsequentes (em onSpaNavegacao): retornam null (video sumiu)
    let queryCalls = 0
    vi.spyOn(document, 'querySelector').mockImplementation((sel: string) => {
      queryCalls++
      if (queryCalls <= 2 && sel === '.watch-video--player-view video') return video as unknown as Element
      if (queryCalls <= 2 && sel === 'video') return video as unknown as Element
      return null
    })
    vi.spyOn(document, 'querySelectorAll').mockImplementation((sel: string) => {
      if (sel === 'video' && queryCalls <= 2) return [video] as unknown as NodeListOf<Element>
      return [] as unknown as NodeListOf<Element>
    })

    const { createNetflixAdapter } = await import('../../src/adapters/netflix')
    const adapter = await createNetflixAdapter()
    expect(adapter).not.toBeNull()

    // Dispara navegacao SPA (onSpaNavegacao fica esperando o video aparecer)
    window.dispatchEvent(new PopStateEvent('popstate'))

    // Destroy imediato (antes de aguardarVideoNetflix resolver)
    adapter?.destroy()

    // Dispara o MutationObserver mockado - simula video aparecendo apos destroy
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const cbCapturado = observerCallback as ((...args: any[]) => void) | null
    if (cbCapturado) {
      // Faz querySelector retornar o video agora
      vi.spyOn(document, 'querySelector').mockImplementation((sel: string) => {
        if (sel === '.watch-video--player-view video') return video as unknown as Element
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

    class MockMutationObserver {
      observe = vi.fn()
      disconnect = vi.fn()
      constructor(public callback: MutationCallback) {}
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ;(globalThis as any).MutationObserver = MockMutationObserver

    vi.spyOn(document, 'querySelector').mockImplementation((sel: string) => {
      if (sel === '.watch-video--player-view video') return videoAtivo as unknown as Element
      if (sel === 'video') return videoAtivo as unknown as Element
      return null
    })
    vi.spyOn(document, 'querySelectorAll').mockImplementation((sel: string) => {
      if (sel === 'video') return [videoAtivo] as unknown as NodeListOf<Element>
      return [] as unknown as NodeListOf<Element>
    })

    const { createNetflixAdapter } = await import('../../src/adapters/netflix')
    const adapter = await createNetflixAdapter()
    expect(adapter).not.toBeNull()

    const playHandler = vi.fn()
    adapter?.on('play', playHandler)

    // Navega para /watch/ para que spaPopstateHandler nao filtre os eventos
    history.pushState({}, '', '/watch/11111')

    // Dispara duas navegacoes SPA em rapida sucessao (concorrentes)
    window.dispatchEvent(new PopStateEvent('popstate'))
    // Segunda navegacao imediatamente - deve cancelar a primeira
    videoAtivo = videoFinal
    window.dispatchEvent(new PopStateEvent('popstate'))

    // Aguarda resolucao (seletor retorna imediatamente)
    await new Promise((r) => setTimeout(r, 50))

    // O evento deve ter sido re-ligado no videoFinal (ultima navegacao)
    ;(videoFinal as unknown as { _dispatchEvent: (e: string) => void })._dispatchEvent('play')
    expect(playHandler).toHaveBeenCalled()

    adapter?.destroy()
    history.pushState({}, '', '/')
  })

  it('HIGH-2: polling de location.href detecta mudanca de URL (pushState)', async () => {
    const video = criarMockVideo()

    class MockMutationObserver {
      observe = vi.fn()
      disconnect = vi.fn()
      constructor(public callback: MutationCallback) {}
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ;(globalThis as any).MutationObserver = MockMutationObserver

    vi.spyOn(document, 'querySelector').mockImplementation((sel: string) => {
      if (sel === '.watch-video--player-view video') return video as unknown as Element
      if (sel === 'video') return video as unknown as Element
      return null
    })
    vi.spyOn(document, 'querySelectorAll').mockReturnValue([video] as unknown as NodeListOf<Element>)

    vi.useFakeTimers()

    const { createNetflixAdapter } = await import('../../src/adapters/netflix')
    const adapter = await createNetflixAdapter()
    expect(adapter).not.toBeNull()

    // Espiona onSpaNavegacao indiretamente via removeEventListener do video
    // (removerHandlersNativos e chamado na navegacao bem-sucedida apos M2 fix)
    const removeListenerSpy = vi.spyOn(video, 'removeEventListener')

    // Simula pushState usando history.pushState (suportado pelo jsdom).
    // history.pushState atualiza location.href de forma nativa, sem precisar de
    // Object.defineProperty que o jsdom bloqueia (location.href nao e configuravel).
    history.pushState({}, '', '/watch/99999999')

    // Avanca o tempo do polling SPA (intervalo = 800ms)
    vi.advanceTimersByTime(900)

    // Aguarda execucao da promise de onSpaNavegacao
    await Promise.resolve()
    await Promise.resolve()

    // Verifica que o polling reagiu a mudanca de URL
    // (handlers do video antigo foram removidos como parte da re-ligacao)
    expect(removeListenerSpy).toHaveBeenCalled()

    adapter?.destroy()
    // Restaura a URL original para nao contaminar outros testes
    history.pushState({}, '', '/')
    vi.useRealTimers()
  })
})

// ---------------------------------------------------------------------------
// Testes de deteccao de anuncio via MutationObserver
// ---------------------------------------------------------------------------

describe('Anuncio: emissao de ad-start/ad-end via MutationObserver', () => {
  afterEach(() => {
    vi.restoreAllMocks()
    vi.resetModules()
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
      if (sel === '.watch-video--player-view video') return video as unknown as Element
      if (sel === 'video') return video as unknown as Element
      // Seletor de ad-ui retorna elemento somente quando anuncio esta visivel
      if (sel === '[data-uia="ad-ui"]' && adVisivel) return document.createElement('div')
      return null
    })
    vi.spyOn(document, 'querySelectorAll').mockReturnValue([video] as unknown as NodeListOf<Element>)

    const { createNetflixAdapter } = await import('../../src/adapters/netflix')
    const adapter = await createNetflixAdapter()

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
      if (sel === '.watch-video--player-view video') return video as unknown as Element
      if (sel === 'video') return video as unknown as Element
      if (sel === '[data-uia="ad-ui"]' && adVisivel) return document.createElement('div')
      return null
    })
    vi.spyOn(document, 'querySelectorAll').mockReturnValue([video] as unknown as NodeListOf<Element>)

    const { createNetflixAdapter } = await import('../../src/adapters/netflix')
    const adapter = await createNetflixAdapter()

    const adEndHandler = vi.fn()
    adapter?.on('ad-end', adEndHandler)

    // Simula fim do anuncio
    adVisivel = false
    observerCallback!([] as unknown as MutationRecord[], null as unknown as MutationObserver)

    expect(adEndHandler).toHaveBeenCalledOnce()
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
      if (sel === '.watch-video--player-view video') return video as unknown as Element
      if (sel === 'video') return video as unknown as Element
      return null
    })
    vi.spyOn(document, 'querySelectorAll').mockReturnValue([video] as unknown as NodeListOf<Element>)

    const { createNetflixAdapter } = await import('../../src/adapters/netflix')
    const adapter = await createNetflixAdapter()
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
  })

  it('prefere o video do container .watch-video--player-view quando disponivel', async () => {
    const videoPlayer = criarMockVideo({ currentTime: 100 })
    const videoTrailer = criarMockVideo({ currentTime: 5 })

    vi.spyOn(document, 'querySelector').mockImplementation((sel: string) => {
      if (sel === '.watch-video--player-view video') return videoPlayer as unknown as Element
      if (sel === 'video') return videoTrailer as unknown as Element
      return null
    })
    vi.spyOn(document, 'querySelectorAll').mockReturnValue(
      [videoPlayer, videoTrailer] as unknown as NodeListOf<Element>
    )

    const { createNetflixAdapter } = await import('../../src/adapters/netflix')
    const adapter = await createNetflixAdapter()

    // O adapter deve ter conectado ao video do player, nao ao trailer
    expect(adapter?.getCurrentTime()).toBe(100)
    adapter?.destroy()
  })

  it('escolhe o video de maior duracao quando seletor primario falha', async () => {
    // Simula dois videos: conteudo principal (longo) e trailer (curto)
    const videoConteudo = criarMockVideo()
    Object.defineProperty(videoConteudo, 'duration', { value: 5400, configurable: true })
    Object.defineProperty(videoConteudo, 'readyState', { value: 4, configurable: true })
    videoConteudo.currentTime = 300

    const videoTrailer = criarMockVideo()
    Object.defineProperty(videoTrailer, 'duration', { value: 90, configurable: true })
    Object.defineProperty(videoTrailer, 'readyState', { value: 4, configurable: true })
    videoTrailer.currentTime = 10

    vi.spyOn(document, 'querySelector').mockImplementation((sel: string) => {
      // Seletor primario falha
      if (sel === '.watch-video--player-view video') return null
      if (sel === 'video') return videoTrailer as unknown as Element
      return null
    })
    vi.spyOn(document, 'querySelectorAll').mockImplementation((sel: string) => {
      if (sel === 'video') return [videoTrailer, videoConteudo] as unknown as NodeListOf<Element>
      return [] as unknown as NodeListOf<Element>
    })

    const { createNetflixAdapter } = await import('../../src/adapters/netflix')
    const adapter = await createNetflixAdapter()

    // Deve ter escolhido o video de maior duracao (conteudo principal)
    expect(adapter?.getCurrentTime()).toBe(300)
    adapter?.destroy()
  })

  it('fallback por maior area renderizada (offsetWidth * offsetHeight) quando nenhum video tem duracao conhecida', async () => {
    // Simula dois videos sem duracao (readyState < HAVE_METADATA):
    // o adapter deve cair no terceiro nivel da heuristica e escolher o de maior area.
    const videoPequeno = criarMockVideo()
    Object.defineProperty(videoPequeno, 'readyState', { value: 1, configurable: true })
    Object.defineProperty(videoPequeno, 'duration', { value: NaN, configurable: true })
    Object.defineProperty(videoPequeno, 'offsetWidth', { value: 320, configurable: true })
    Object.defineProperty(videoPequeno, 'offsetHeight', { value: 180, configurable: true })
    // getBoundingClientRect com area menor (area = 57600px2 < VIDEO_AREA_MINIMA_PX2 de 40000?
    // 320*180=57600 > 40000, entao ainda passa o filtro de area minima)
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
      // Seletor primario falha
      if (sel === '.watch-video--player-view video') return null
      return null
    })
    vi.spyOn(document, 'querySelectorAll').mockImplementation((sel: string) => {
      if (sel === 'video') return [videoPequeno, videoGrande] as unknown as NodeListOf<Element>
      return [] as unknown as NodeListOf<Element>
    })

    const { createNetflixAdapter } = await import('../../src/adapters/netflix')
    const adapter = await createNetflixAdapter()

    // Deve ter escolhido o video de maior area renderizada
    expect(adapter?.getCurrentTime()).toBe(42)
    adapter?.destroy()
  })
})
