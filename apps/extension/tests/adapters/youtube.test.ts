// tests/adapters/youtube.test.ts
// Testes unitarios para o adapter de YouTube.
// Usa mock de HTMLVideoElement para nao depender do DOM real.

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'

// ---------------------------------------------------------------------------
// Mock do HTMLVideoElement
// ---------------------------------------------------------------------------

function criarMockVideo(overrides: Partial<HTMLVideoElement> = {}): HTMLVideoElement {
  const listeners: Record<string, EventListener[]> = {}

  const video = {
    currentTime: 0,
    duration: 120,
    paused: true,
    readyState: 4, // HAVE_ENOUGH_DATA
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
    // Utilitario de teste para disparar eventos
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
// Mock do document e da classe ad-showing
// ---------------------------------------------------------------------------

function configurarDocumentoSemAd(videoEl: HTMLVideoElement, playerEl?: Element): void {
  const playerDiv = playerEl ?? {
    classList: {
      contains: vi.fn().mockReturnValue(false),
    },
    _classList: [] as string[],
  }

  vi.spyOn(document, 'querySelector').mockImplementation((selector: string) => {
    if (selector === 'video') return videoEl as unknown as Element
    if (selector === '.html5-video-player') return playerDiv as unknown as Element
    return null
  })
}

function configurarDocumentoComAd(videoEl: HTMLVideoElement): void {
  const playerDiv = {
    classList: {
      contains: vi.fn((cls: string) => cls === 'ad-showing'),
    },
  }
  vi.spyOn(document, 'querySelector').mockImplementation((selector: string) => {
    if (selector === 'video') return videoEl as unknown as Element
    if (selector === '.html5-video-player') return playerDiv as unknown as Element
    return null
  })
}

// ---------------------------------------------------------------------------
// Importacao do adapter (apos mocks do vi)
// ---------------------------------------------------------------------------

// Importacao dinamica apos configurar mocks

describe('createYouTubeAdapter', () => {
  let mockVideo: HTMLVideoElement

  beforeEach(() => {
    mockVideo = criarMockVideo()
    configurarDocumentoSemAd(mockVideo)
    vi.clearAllMocks()
    configurarDocumentoSemAd(mockVideo)
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('retorna null quando nao encontra elemento video', async () => {
    vi.spyOn(document, 'querySelector').mockReturnValue(null)

    // MutationObserver mock para o caso de await aguardarVideo
    class MockMutationObserver {
      observe = vi.fn()
      disconnect = vi.fn()
      constructor(public callback: MutationCallback) {}
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ;(globalThis as any).MutationObserver = MockMutationObserver

    const { createYouTubeAdapter } = await import('../../src/adapters/youtube')

    // O adapter deve retornar null apos o timeout de espera
    // Reduzimos o timeout para o teste via mock do setTimeout
    vi.useFakeTimers()
    const promiseAdapter = createYouTubeAdapter()

    // Avanca o timer de timeout (5000ms) para forcar o null
    vi.advanceTimersByTime(6000)
    const adapter = await promiseAdapter
    expect(adapter).toBeNull()

    vi.useRealTimers()
  })

  it('retorna adapter quando elemento video esta presente', async () => {
    configurarDocumentoSemAd(mockVideo)
    const { createYouTubeAdapter } = await import('../../src/adapters/youtube')
    const adapter = await createYouTubeAdapter()
    expect(adapter).not.toBeNull()
  })

  it('getCurrentTime retorna currentTime do video', async () => {
    mockVideo.currentTime = 42.5
    configurarDocumentoSemAd(mockVideo)
    const { createYouTubeAdapter } = await import('../../src/adapters/youtube')
    const adapter = await createYouTubeAdapter()
    expect(adapter?.getCurrentTime()).toBe(42.5)
  })

  it('getDuration retorna duration do video', async () => {
    Object.defineProperty(mockVideo, 'duration', { value: 3600, writable: true, configurable: true })
    configurarDocumentoSemAd(mockVideo)
    const { createYouTubeAdapter } = await import('../../src/adapters/youtube')
    const adapter = await createYouTubeAdapter()
    expect(adapter?.getDuration()).toBe(3600)
  })

  it('getDuration retorna 0 quando duration e NaN', async () => {
    Object.defineProperty(mockVideo, 'duration', { value: NaN, writable: true, configurable: true })
    configurarDocumentoSemAd(mockVideo)
    const { createYouTubeAdapter } = await import('../../src/adapters/youtube')
    const adapter = await createYouTubeAdapter()
    expect(adapter?.getDuration()).toBe(0)
  })

  it('play() chama video.play()', async () => {
    configurarDocumentoSemAd(mockVideo)
    const { createYouTubeAdapter } = await import('../../src/adapters/youtube')
    const adapter = await createYouTubeAdapter()
    await adapter?.play()
    expect(mockVideo.play).toHaveBeenCalledOnce()
  })

  it('pause() chama video.pause()', async () => {
    configurarDocumentoSemAd(mockVideo)
    const { createYouTubeAdapter } = await import('../../src/adapters/youtube')
    const adapter = await createYouTubeAdapter()
    await adapter?.pause()
    expect(mockVideo.pause).toHaveBeenCalledOnce()
  })

  it('seekTo() atualiza currentTime do video', async () => {
    configurarDocumentoSemAd(mockVideo)
    const { createYouTubeAdapter } = await import('../../src/adapters/youtube')
    const adapter = await createYouTubeAdapter()
    await adapter?.seekTo(99.5)
    expect(mockVideo.currentTime).toBe(99.5)
  })

  it('getPlaybackState() retorna "playing" quando nao pausado', async () => {
    Object.defineProperty(mockVideo, 'paused', { value: false, writable: true })
    configurarDocumentoSemAd(mockVideo)
    const { createYouTubeAdapter } = await import('../../src/adapters/youtube')
    const adapter = await createYouTubeAdapter()
    expect(adapter?.getPlaybackState()).toBe('playing')
  })

  it('getPlaybackState() retorna "paused" quando pausado', async () => {
    Object.defineProperty(mockVideo, 'paused', { value: true, writable: true })
    configurarDocumentoSemAd(mockVideo)
    const { createYouTubeAdapter } = await import('../../src/adapters/youtube')
    const adapter = await createYouTubeAdapter()
    expect(adapter?.getPlaybackState()).toBe('paused')
  })

  it('getPlaybackState() retorna "ad" durante anuncio', async () => {
    configurarDocumentoComAd(mockVideo)
    const { createYouTubeAdapter } = await import('../../src/adapters/youtube')
    const adapter = await createYouTubeAdapter()
    expect(adapter?.getPlaybackState()).toBe('ad')
  })

  it('isAd() retorna true quando classe ad-showing esta presente', async () => {
    configurarDocumentoComAd(mockVideo)
    const { createYouTubeAdapter } = await import('../../src/adapters/youtube')
    const adapter = await createYouTubeAdapter()
    expect(adapter?.isAd()).toBe(true)
  })

  it('isAd() retorna false quando classe ad-showing ausente', async () => {
    configurarDocumentoSemAd(mockVideo)
    const { createYouTubeAdapter } = await import('../../src/adapters/youtube')
    const adapter = await createYouTubeAdapter()
    expect(adapter?.isAd()).toBe(false)
  })

  it('on("play") dispara callback ao receber evento de play do video', async () => {
    const videoInterno = criarMockVideo()
    configurarDocumentoSemAd(videoInterno)
    const { createYouTubeAdapter } = await import('../../src/adapters/youtube')
    const adapter = await createYouTubeAdapter()

    const handler = vi.fn()
    adapter?.on('play', handler)

    // Simula evento nativo de play
    ;(videoInterno as unknown as { _dispatchEvent: (e: string) => void })._dispatchEvent('play')

    expect(handler).toHaveBeenCalledOnce()
  })

  it('off() remove listener de evento', async () => {
    const videoInterno = criarMockVideo()
    configurarDocumentoSemAd(videoInterno)
    const { createYouTubeAdapter } = await import('../../src/adapters/youtube')
    const adapter = await createYouTubeAdapter()

    const handler = vi.fn()
    adapter?.on('play', handler)
    adapter?.off('play', handler)

    ;(videoInterno as unknown as { _dispatchEvent: (e: string) => void })._dispatchEvent('play')

    expect(handler).not.toHaveBeenCalled()
  })

  it('destroy() remove todos os listeners do video', async () => {
    configurarDocumentoSemAd(mockVideo)
    const { createYouTubeAdapter } = await import('../../src/adapters/youtube')
    const adapter = await createYouTubeAdapter()
    adapter?.destroy()
    expect(mockVideo.removeEventListener).toHaveBeenCalled()
  })
})

// ---------------------------------------------------------------------------
// H2: Navegacao SPA do YouTube
// ---------------------------------------------------------------------------

describe('H2: re-resolucao de video em navegacao SPA', () => {
  afterEach(() => {
    vi.restoreAllMocks()
    vi.resetModules()
  })

  it('re-liga listeners ao novo video apos yt-navigate-finish', async () => {
    const videoOriginal = criarMockVideo()
    const videoNovo = criarMockVideo()

    let videoAtual = videoOriginal

    vi.spyOn(document, 'querySelector').mockImplementation((sel: string) => {
      if (sel === 'video') return videoAtual as unknown as Element
      if (sel === '.html5-video-player') {
        return { classList: { contains: vi.fn().mockReturnValue(false) } } as unknown as Element
      }
      return null
    })

    const { createYouTubeAdapter } = await import('../../src/adapters/youtube')
    const adapter = await createYouTubeAdapter()
    expect(adapter).not.toBeNull()

    const playHandler = vi.fn()
    adapter?.on('play', playHandler)

    // Simula navegacao SPA: troca o video ativo
    videoAtual = videoNovo

    // Dispara yt-navigate-finish
    window.dispatchEvent(new Event('yt-navigate-finish'))

    // Aguarda a re-resolucao assincrona
    await new Promise((r) => setTimeout(r, 10))

    // O handler registrado deve ser chamado pelo novo video
    ;(videoNovo as unknown as { _dispatchEvent: (e: string) => void })._dispatchEvent('play')
    expect(playHandler).toHaveBeenCalled()

    adapter?.destroy()
  })

  it('destroy() remove listeners de yt-navigate-finish e popstate', async () => {
    const video = criarMockVideo()
    configurarDocumentoSemAd(video)

    const addSpy = vi.spyOn(window, 'addEventListener')
    const removeSpy = vi.spyOn(window, 'removeEventListener')

    const { createYouTubeAdapter } = await import('../../src/adapters/youtube')
    const adapter = await createYouTubeAdapter()
    adapter?.destroy()

    // Verifica que os listeners foram adicionados e removidos
    const addedYtNav = addSpy.mock.calls.some(([evt]) => evt === 'yt-navigate-finish')
    const removedYtNav = removeSpy.mock.calls.some(([evt]) => evt === 'yt-navigate-finish')
    const addedPopstate = addSpy.mock.calls.some(([evt]) => evt === 'popstate')
    const removedPopstate = removeSpy.mock.calls.some(([evt]) => evt === 'popstate')

    expect(addedYtNav).toBe(true)
    expect(removedYtNav).toBe(true)
    expect(addedPopstate).toBe(true)
    expect(removedPopstate).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// L2: Deteccao de anuncio via MutationObserver
// ---------------------------------------------------------------------------

describe('L2: emissao de ad-start/ad-end via MutationObserver', () => {
  afterEach(() => {
    vi.restoreAllMocks()
    vi.resetModules()
  })

  it('emite ad-start quando classe ad-showing e adicionada ao player', async () => {
    const video = criarMockVideo()
    let adShowing = false

    // Player mockado com MutationObserver real
    const playerClassList = {
      contains: vi.fn().mockImplementation((cls: string) => cls === 'ad-showing' && adShowing),
    }
    const playerEl = { classList: playerClassList } as unknown as Element

    // Captura o callback do MutationObserver
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
      if (sel === '.html5-video-player') return playerEl
      return null
    })

    const { createYouTubeAdapter } = await import('../../src/adapters/youtube')
    const adapter = await createYouTubeAdapter()

    const adStartHandler = vi.fn()
    adapter?.on('ad-start', adStartHandler)

    // Simula adicao da classe ad-showing
    adShowing = true
    observerCallback!([] as unknown as MutationRecord[], null as unknown as MutationObserver)

    expect(adStartHandler).toHaveBeenCalledOnce()
    adapter?.destroy()
  })

  it('emite ad-end quando classe ad-showing e removida do player', async () => {
    const video = criarMockVideo()
    let adShowing = true // comeca com anuncio

    const playerClassList = {
      contains: vi.fn().mockImplementation((cls: string) => cls === 'ad-showing' && adShowing),
    }
    const playerEl = { classList: playerClassList } as unknown as Element

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
      if (sel === '.html5-video-player') return playerEl
      return null
    })

    const { createYouTubeAdapter } = await import('../../src/adapters/youtube')
    const adapter = await createYouTubeAdapter()

    const adEndHandler = vi.fn()
    adapter?.on('ad-end', adEndHandler)

    // Simula remocao da classe ad-showing
    adShowing = false
    observerCallback!([] as unknown as MutationRecord[], null as unknown as MutationObserver)

    expect(adEndHandler).toHaveBeenCalledOnce()
    adapter?.destroy()
  })
})
