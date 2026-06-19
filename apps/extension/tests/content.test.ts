// tests/content.test.ts
// Testes unitarios do content script: roteamento de eventos adapter <-> background.
// Usa mocks de chrome.runtime.Port e do adapter YouTube.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// ---------------------------------------------------------------------------
// Mock da Port do chrome.runtime
// ---------------------------------------------------------------------------

type PortMessageListener = (message: unknown) => void
type PortDisconnectListener = () => void

interface MockPort {
  name: string
  postMessage: ReturnType<typeof vi.fn>
  onMessage: { addListener: (fn: PortMessageListener) => void; removeListener: (fn: PortMessageListener) => void; _listeners: PortMessageListener[] }
  onDisconnect: { addListener: (fn: PortDisconnectListener) => void; _listeners: PortDisconnectListener[] }
  disconnect: ReturnType<typeof vi.fn>
  _simulateMessage: (msg: unknown) => void
  _simulateDisconnect: () => void
}

function criarMockPort(): MockPort {
  const messageListeners: PortMessageListener[] = []
  const disconnectListeners: PortDisconnectListener[] = []

  const port: MockPort = {
    name: 'openparty-content',
    postMessage: vi.fn(),
    onMessage: {
      addListener: (fn) => messageListeners.push(fn),
      removeListener: (fn) => {
        const idx = messageListeners.indexOf(fn)
        if (idx >= 0) messageListeners.splice(idx, 1)
      },
      _listeners: messageListeners,
    },
    onDisconnect: {
      addListener: (fn) => disconnectListeners.push(fn),
      _listeners: disconnectListeners,
    },
    disconnect: vi.fn(),
    _simulateMessage: (msg) => { for (const fn of messageListeners) fn(msg) },
    _simulateDisconnect: () => { for (const fn of disconnectListeners) fn() },
  }
  return port
}

// ---------------------------------------------------------------------------
// Mock do adapter YouTube
// ---------------------------------------------------------------------------

interface MockAdapter {
  play: ReturnType<typeof vi.fn>
  pause: ReturnType<typeof vi.fn>
  seekTo: ReturnType<typeof vi.fn>
  getCurrentTime: ReturnType<typeof vi.fn>
  getPlaybackState: ReturnType<typeof vi.fn>
  isAd: ReturnType<typeof vi.fn>
  getDuration: ReturnType<typeof vi.fn>
  on: ReturnType<typeof vi.fn>
  off: ReturnType<typeof vi.fn>
  destroy: ReturnType<typeof vi.fn>
  // Utilitario de teste para disparar eventos do adapter
  _dispatchAdapterEvent: (event: string) => void
}

function criarMockAdapter(): MockAdapter {
  const eventListeners: Record<string, Array<() => void>> = {}

  const adapter: MockAdapter = {
    play: vi.fn().mockResolvedValue(undefined),
    pause: vi.fn().mockResolvedValue(undefined),
    seekTo: vi.fn().mockResolvedValue(undefined),
    getCurrentTime: vi.fn().mockReturnValue(10),
    getPlaybackState: vi.fn().mockReturnValue('paused'),
    isAd: vi.fn().mockReturnValue(false),
    getDuration: vi.fn().mockReturnValue(120),
    on: vi.fn((event: string, handler: () => void) => {
      if (!eventListeners[event]) eventListeners[event] = []
      eventListeners[event].push(handler)
    }),
    off: vi.fn(),
    destroy: vi.fn(),
    _dispatchAdapterEvent: (event: string) => {
      for (const fn of eventListeners[event] ?? []) fn()
    },
  }

  return adapter
}

let mockAdapter: MockAdapter
let mockPort: MockPort

vi.mock('../src/adapters/youtube', () => ({
  createYouTubeAdapter: vi.fn(async () => mockAdapter),
}))

vi.mock('../src/lib/storage', () => ({
  storageGet: vi.fn().mockResolvedValue({ roomId: 'sala-teste' }),
}))

// ---------------------------------------------------------------------------
// Configura chrome global antes de cada teste
// ---------------------------------------------------------------------------

beforeEach(() => {
  mockAdapter = criarMockAdapter()
  mockPort = criarMockPort()

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ;(globalThis as unknown as any).chrome = {
    runtime: {
      connect: vi.fn().mockReturnValue(mockPort),
    },
  }

  // Simula pagina do YouTube
  Object.defineProperty(window, 'location', {
    value: { hostname: 'www.youtube.com' },
    writable: true,
    configurable: true,
  })
})

afterEach(() => {
  vi.resetModules()
})

// ---------------------------------------------------------------------------
// Testes
// ---------------------------------------------------------------------------

describe('content script - inicializacao', () => {
  it('conecta ao background via Port ao iniciar em pagina suportada', async () => {
    await import('../src/content/content-main')
    // Aguarda inicializacao assincrona
    await new Promise((r) => setTimeout(r, 10))

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((globalThis as unknown as any).chrome.runtime.connect).toHaveBeenCalledWith({
      name: 'openparty-content',
    })
  })

  it('nao conecta ao background em pagina nao suportada', async () => {
    Object.defineProperty(window, 'location', {
      value: { hostname: 'www.google.com' },
      writable: true,
      configurable: true,
    })

    await import('../src/content/content-main')
    await new Promise((r) => setTimeout(r, 10))

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((globalThis as unknown as any).chrome.runtime.connect).not.toHaveBeenCalled()
  })
})

describe('content script - eventos adapter -> background', () => {
  it('envia evento play para o background quando adapter dispara play', async () => {
    await import('../src/content/content-main')
    await new Promise((r) => setTimeout(r, 10))

    mockAdapter._dispatchAdapterEvent('play')

    expect(mockPort.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'play' }),
    )
  })

  it('envia evento pause para o background quando adapter dispara pause', async () => {
    await import('../src/content/content-main')
    await new Promise((r) => setTimeout(r, 10))

    mockAdapter._dispatchAdapterEvent('pause')

    expect(mockPort.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'pause' }),
    )
  })

  it('envia evento seek para o background quando adapter dispara seek', async () => {
    await import('../src/content/content-main')
    await new Promise((r) => setTimeout(r, 10))

    mockAdapter._dispatchAdapterEvent('seek')

    expect(mockPort.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'seek' }),
    )
  })

  it('nao envia evento play quando player esta em modo de anuncio', async () => {
    mockAdapter.isAd.mockReturnValue(true)

    await import('../src/content/content-main')
    await new Promise((r) => setTimeout(r, 10))

    mockAdapter._dispatchAdapterEvent('play')

    // Durante anuncio eventos nao devem ser encaminhados ao servidor
    expect(mockPort.postMessage).not.toHaveBeenCalledWith(
      expect.objectContaining({ type: 'play' }),
    )
  })
})

describe('content script - comandos background -> adapter', () => {
  it('aplica play no adapter ao receber comando play do background', async () => {
    await import('../src/content/content-main')
    await new Promise((r) => setTimeout(r, 10))

    mockPort._simulateMessage({ type: 'play', time: 30, when: Date.now() })
    await new Promise((r) => setTimeout(r, 10))

    expect(mockAdapter.play).toHaveBeenCalled()
  })

  it('agenda play quando `when` e futuro', async () => {
    vi.useFakeTimers()

    await import('../src/content/content-main')
    await vi.runAllTimersAsync()

    const when = Date.now() + 500
    mockAdapter.play.mockClear()
    mockPort._simulateMessage({ type: 'play', time: 30, when })

    // Play nao deve ter sido chamado ainda
    expect(mockAdapter.play).not.toHaveBeenCalled()

    // Avanca os timers alem do `when`
    vi.advanceTimersByTime(600)
    await vi.runAllTimersAsync()

    expect(mockAdapter.play).toHaveBeenCalled()

    vi.useRealTimers()
  })

  it('aplica play imediatamente quando `when` e no passado ou zero', async () => {
    await import('../src/content/content-main')
    await new Promise((r) => setTimeout(r, 10))

    mockAdapter.play.mockClear()
    mockPort._simulateMessage({ type: 'play', time: 30, when: Date.now() - 100 })
    await new Promise((r) => setTimeout(r, 10))

    expect(mockAdapter.play).toHaveBeenCalled()
  })

  it('aplica pause no adapter ao receber comando pause do background', async () => {
    await import('../src/content/content-main')
    await new Promise((r) => setTimeout(r, 10))

    mockPort._simulateMessage({ type: 'pause', time: 30, serverTime: Date.now() })
    await new Promise((r) => setTimeout(r, 10))

    expect(mockAdapter.pause).toHaveBeenCalled()
  })

  it('aplica seek no adapter ao receber comando seek do background', async () => {
    await import('../src/content/content-main')
    await new Promise((r) => setTimeout(r, 10))

    mockPort._simulateMessage({ type: 'seek', time: 55 })
    await new Promise((r) => setTimeout(r, 10))

    expect(mockAdapter.seekTo).toHaveBeenCalledWith(55)
  })

  it('ignora mensagens com tipo desconhecido sem lancar erro', async () => {
    await import('../src/content/content-main')
    await new Promise((r) => setTimeout(r, 10))

    expect(() => {
      mockPort._simulateMessage({ type: 'unknown-event' })
    }).not.toThrow()
  })
})

describe('content script - supressao de eco (H1)', () => {
  it('nao reenvia play ao background quando o play foi originado pelo servidor', async () => {
    await import('../src/content/content-main')
    await new Promise((r) => setTimeout(r, 10))

    // Servidor envia play - aplica no adapter e suprime o proximo eco
    mockPort._simulateMessage({ type: 'play', time: 10, when: Date.now() })
    await new Promise((r) => setTimeout(r, 10))

    // Limpa chamadas anteriores de postMessage (handshake, etc.)
    mockPort.postMessage.mockClear()

    // O adapter dispara o evento de play como eco - deve ser suprimido
    mockAdapter._dispatchAdapterEvent('play')

    // Eco nao deve ter chegado ao background
    expect(mockPort.postMessage).not.toHaveBeenCalledWith(
      expect.objectContaining({ type: 'play' }),
    )
  })

  it('nao reenvia pause ao background quando o pause foi originado pelo servidor', async () => {
    await import('../src/content/content-main')
    await new Promise((r) => setTimeout(r, 10))

    mockPort._simulateMessage({ type: 'pause', time: 10, serverTime: Date.now() })
    await new Promise((r) => setTimeout(r, 10))

    mockPort.postMessage.mockClear()
    mockAdapter._dispatchAdapterEvent('pause')

    expect(mockPort.postMessage).not.toHaveBeenCalledWith(
      expect.objectContaining({ type: 'pause' }),
    )
  })

  it('nao reenvia seek ao background quando o seek foi originado pelo servidor', async () => {
    await import('../src/content/content-main')
    await new Promise((r) => setTimeout(r, 10))

    mockPort._simulateMessage({ type: 'seek', time: 30 })
    await new Promise((r) => setTimeout(r, 10))

    mockPort.postMessage.mockClear()
    mockAdapter._dispatchAdapterEvent('seek')

    expect(mockPort.postMessage).not.toHaveBeenCalledWith(
      expect.objectContaining({ type: 'seek' }),
    )
  })

  it('supressao e por tipo: seek server nao suprime play do usuario', async () => {
    await import('../src/content/content-main')
    await new Promise((r) => setTimeout(r, 10))

    // Servidor envia seek - suprime apenas seek
    mockPort._simulateMessage({ type: 'seek', time: 30 })
    await new Promise((r) => setTimeout(r, 10))

    mockPort.postMessage.mockClear()

    // Eco de seek: suprimido
    mockAdapter._dispatchAdapterEvent('seek')
    expect(mockPort.postMessage).not.toHaveBeenCalledWith(
      expect.objectContaining({ type: 'seek' }),
    )

    // Play do usuario: NAO suprimido
    mockAdapter._dispatchAdapterEvent('play')
    expect(mockPort.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'play' }),
    )
  })
})

describe('content script - room-state reconciliacao (C1)', () => {
  it('aplica seek quando drift >= 0.5s e play/pause conforme estado da sala', async () => {
    // Adapter com posicao 0 e sala com posicao 10s tocando ha 0ms
    mockAdapter.getCurrentTime.mockReturnValue(0)
    mockAdapter.isAd.mockReturnValue(false)

    await import('../src/content/content-main')
    await new Promise((r) => setTimeout(r, 10))

    mockPort._simulateMessage({
      type: 'room-state',
      positionSecs: 10,
      lastEventAt: Date.now(),
      playing: true,
      roomId: 'x',
      mediaUrl: 'https://youtu.be/abc',
      mediaType: 'youtube',
      playbackRate: 1,
      hostId: 'host1',
      hostLock: false,
      peers: [],
    })
    await new Promise((r) => setTimeout(r, 10))

    // Drift = 0 - 10 = -10s (abs >= 0.5) -> seek para 10
    expect(mockAdapter.seekTo).toHaveBeenCalledWith(10)
    expect(mockAdapter.play).toHaveBeenCalled()
  })

  it('aplica pause quando sala esta pausada', async () => {
    mockAdapter.getCurrentTime.mockReturnValue(0)
    mockAdapter.isAd.mockReturnValue(false)

    await import('../src/content/content-main')
    await new Promise((r) => setTimeout(r, 10))

    mockPort._simulateMessage({
      type: 'room-state',
      positionSecs: 10,
      lastEventAt: Date.now(),
      playing: false,
      roomId: 'x',
      mediaUrl: 'https://youtu.be/abc',
      mediaType: 'youtube',
      playbackRate: 1,
      hostId: 'host1',
      hostLock: false,
      peers: [],
    })
    await new Promise((r) => setTimeout(r, 10))

    expect(mockAdapter.seekTo).toHaveBeenCalled()
    expect(mockAdapter.pause).toHaveBeenCalled()
  })
})
