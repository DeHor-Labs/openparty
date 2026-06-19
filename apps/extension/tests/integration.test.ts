// tests/integration.test.ts
// Teste de integracao: fluxo completo com mocks.
//
// Prova os caminhos criticos:
//   1. evento do player -> content script -> background (via Port) -> WS (mock)
//   2. servidor (WS mock) -> background -> content script (via Port) -> adapter
//
// CR: o mock de Port e bidirecional - postMessage do content script chega ao SW
// e postMessage do SW chega ao content script, provando o roteamento completo.

import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest'

// ---------------------------------------------------------------------------
// Mocks declarados antes de qualquer import do codigo
// ---------------------------------------------------------------------------

/** Referencia mutavel ao WS client criado pelo SW */
let capturedOnEvent: ((event: unknown) => void) | null = null
let capturedWsUrl: string | null = null
let wsSendMock: ReturnType<typeof vi.fn> | null = null

vi.mock('../src/lib/ws-client', () => ({
  createWsClient: vi.fn((opts: { url: string; onEvent: (e: unknown) => void }) => {
    capturedOnEvent = opts.onEvent
    capturedWsUrl = opts.url
    wsSendMock = vi.fn()
    return {
      send: wsSendMock,
      close: vi.fn(),
      readyState: 1,
    }
  }),
}))

vi.mock('../src/lib/storage', () => ({
  storageGet: vi.fn().mockResolvedValue({
    roomId: 'sala-integracao',
    userId: null,
    displayName: 'Tester',
    avatar: '🎬',
    serverUrl: 'wss://localhost:3000/ws',
    clockOffsetMs: 0,
  }),
  storageSet: vi.fn().mockResolvedValue(undefined),
}))

// ---------------------------------------------------------------------------
// Adapter mock que captura handlers registrados
// ---------------------------------------------------------------------------

const adapterEventListeners: Record<string, Array<() => void>> = {}
const adapterMock = {
  play: vi.fn().mockResolvedValue(undefined),
  pause: vi.fn().mockResolvedValue(undefined),
  seekTo: vi.fn().mockImplementation(async (secs: number) => { videoEl.currentTime = secs }),
  getCurrentTime: vi.fn().mockReturnValue(0),
  getDuration: vi.fn().mockReturnValue(600),
  isAd: vi.fn().mockReturnValue(false),
  getPlaybackState: vi.fn().mockReturnValue('paused'),
  on: vi.fn((event: string, handler: () => void) => {
    if (!adapterEventListeners[event]) adapterEventListeners[event] = []
    adapterEventListeners[event].push(handler)
  }),
  off: vi.fn(),
  destroy: vi.fn(),
}

vi.mock('../src/adapters/youtube', () => ({
  createYouTubeAdapter: vi.fn(async () => adapterMock),
}))

/** Mock de HTMLVideoElement compartilhado */
const videoEl = {
  currentTime: 0,
  duration: 600,
  paused: true,
  readyState: 4,
  play: vi.fn().mockImplementation(async () => { videoEl.paused = false }),
  pause: vi.fn().mockImplementation(() => { videoEl.paused = true }),
}

// ---------------------------------------------------------------------------
// Infraestrutura de Port BIDIRECIONAL
// CR item 3: postMessage de um lado dispara onMessage do outro lado.
// ---------------------------------------------------------------------------

/** Listeners registrados pelo SW no onMessage da port */
const portaOnMessageListenersSW: Array<(msg: unknown) => void> = []

/** Listeners registrados pelo CS no onMessage da port */
const portaOnMessageListenersCS: Array<(msg: unknown) => void> = []

/** Listeners registrados pelo SW via onConnect */
const swConnectListeners: Array<(port: unknown) => void> = []

/**
 * Port vista pelo SW: onMessage.addListener captura handlers do SW,
 * postMessage entrega a mensagem ao CS (portaOnMessageListenersCS).
 */
const portaParaSW = {
  name: 'openparty-content',
  sender: { tab: { id: 1 } },
  postMessage: vi.fn((msg: unknown) => {
    // SW envia -> CS recebe
    for (const fn of portaOnMessageListenersCS) fn(msg)
  }),
  onMessage: {
    addListener(fn: (msg: unknown) => void) { portaOnMessageListenersSW.push(fn) },
    removeListener(fn: (msg: unknown) => void) {
      const idx = portaOnMessageListenersSW.indexOf(fn)
      if (idx >= 0) portaOnMessageListenersSW.splice(idx, 1)
    },
  },
  onDisconnect: {
    addListener: vi.fn(),
  },
  disconnect: vi.fn(),
}

/**
 * Port vista pelo CS: onMessage.addListener captura handlers do CS,
 * postMessage entrega a mensagem ao SW (portaOnMessageListenersSW).
 */
const portaParaCS = {
  name: 'openparty-content',
  postMessage: vi.fn((msg: unknown) => {
    // CS envia -> SW recebe
    for (const fn of portaOnMessageListenersSW) fn(msg)
  }),
  onMessage: {
    addListener(fn: (msg: unknown) => void) { portaOnMessageListenersCS.push(fn) },
    removeListener(fn: (msg: unknown) => void) {
      const idx = portaOnMessageListenersCS.indexOf(fn)
      if (idx >= 0) portaOnMessageListenersCS.splice(idx, 1)
    },
  },
  onDisconnect: {
    addListener: vi.fn(),
  },
  disconnect: vi.fn(),
}

// ---------------------------------------------------------------------------
// Setup unico: inicia SW e content script uma vez para todos os testes
// ---------------------------------------------------------------------------

beforeAll(async () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ;(globalThis as unknown as any).chrome = {
    runtime: {
      onConnect: {
        addListener: (fn: (p: unknown) => void) => swConnectListeners.push(fn),
      },
      onMessage: {
        addListener: vi.fn(),
      },
      // CS chama chrome.runtime.connect() e recebe portaParaCS
      connect: vi.fn().mockReturnValue(portaParaCS),
      lastError: null,
    },
    storage: {
      local: {
        get: vi.fn().mockResolvedValue({ cachedRoomState: undefined }),
        set: vi.fn().mockResolvedValue(undefined),
        clear: vi.fn().mockResolvedValue(undefined),
        remove: vi.fn().mockResolvedValue(undefined),
      },
    },
  }

  // Hostname = YouTube
  Object.defineProperty(window, 'location', {
    value: { hostname: 'www.youtube.com' },
    writable: true,
    configurable: true,
  })

  // Importa SW e content script - registra listeners
  await import('../src/background/service-worker')
  await import('../src/content/content-main')

  // Aguarda init() assincrono de ambos
  await new Promise((r) => setTimeout(r, 30))

  // Simula o content script abrindo uma Port com o SW
  // SW recebe portaParaSW (que tem seu proprio postMessage/onMessage)
  for (const fn of swConnectListeners) fn(portaParaSW)

  // Aguarda processamento
  await new Promise((r) => setTimeout(r, 20))
})

afterAll(() => {
  vi.restoreAllMocks()
})

// ---------------------------------------------------------------------------
// Testes de integracao
// ---------------------------------------------------------------------------

describe('integracao: evento do player -> WS via Port bidirecional', () => {
  it('adapter esta disponivel apos inicializacao', () => {
    // O mock de createYouTubeAdapter retorna adapterMock
    expect(adapterMock.on).toHaveBeenCalled()
  })

  it('evento play registrado no adapter e encaminhado ao WS via background', async () => {
    wsSendMock?.mockClear()

    // Dispara play via handlers registrados pelo content script no adapter
    for (const fn of adapterEventListeners['play'] ?? []) fn()

    await new Promise((r) => setTimeout(r, 10))

    // CS chama port.postMessage -> SW recebe -> encaminha ao WS
    expect(wsSendMock).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'play' }),
    )
  })

  it('evento seek registrado no adapter e encaminhado ao WS via background', async () => {
    wsSendMock?.mockClear()

    for (const fn of adapterEventListeners['seek'] ?? []) fn()

    await new Promise((r) => setTimeout(r, 10))

    expect(wsSendMock).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'seek' }),
    )
  })
})

describe('integracao: servidor -> adapter via background (Port bidirecional)', () => {
  it('WS recebe play e background repassa para o adapter via CS', async () => {
    adapterMock.play.mockClear()

    // Simula servidor enviando play
    const eventoPlay = { type: 'play', time: 45, when: Date.now() }
    capturedOnEvent?.(eventoPlay)

    // SW faz postMessage para portaParaSW -> chega no CS via portaOnMessageListenersCS -> aplica no adapter
    await new Promise((r) => setTimeout(r, 20))

    expect(adapterMock.play).toHaveBeenCalled()
  })

  it('WS recebe seek e background repassa para o adapter via CS', async () => {
    adapterMock.seekTo.mockClear()

    const eventoSeek = { type: 'seek', time: 200 }
    capturedOnEvent?.(eventoSeek)

    await new Promise((r) => setTimeout(r, 20))

    expect(adapterMock.seekTo).toHaveBeenCalledWith(200)
  })

  it('WS recebe pause e background repassa para o adapter via CS', async () => {
    adapterMock.pause.mockClear()

    const eventoPause = { type: 'pause', time: 30, serverTime: Date.now() }
    capturedOnEvent?.(eventoPause)

    await new Promise((r) => setTimeout(r, 20))

    expect(adapterMock.pause).toHaveBeenCalled()
  })
})

describe('integracao: C2 - URL WebSocket inclui roomId', () => {
  it('URL do WS e a concatenacao de serverUrl + roomId', () => {
    expect(capturedWsUrl).not.toBeNull()
    expect(capturedWsUrl).toContain('sala-integracao')
    // wss://localhost:3000/ws + /sala-integracao
    expect(capturedWsUrl).toBe('wss://localhost:3000/ws/sala-integracao')
  })
})
