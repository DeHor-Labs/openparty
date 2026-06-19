// tests/background.test.ts
// Testes unitarios para a logica do service worker de background.
// Usa mocks de chrome.runtime e do ws-client para nao depender de browser real.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// ---------------------------------------------------------------------------
// Mock do chrome.runtime (nao existe no jsdom)
// ---------------------------------------------------------------------------

type PortMessageListener = (message: unknown, port: MockPort) => void
type PortDisconnectListener = (port: MockPort) => void

interface MockPort {
  name: string
  sender: { tab?: { id: number } }
  postMessage: ReturnType<typeof vi.fn>
  onMessage: { addListener: (fn: PortMessageListener) => void; _listeners: PortMessageListener[] }
  onDisconnect: { addListener: (fn: PortDisconnectListener) => void; _listeners: PortDisconnectListener[] }
  disconnect: ReturnType<typeof vi.fn>
  _simulateMessage: (msg: unknown) => void
  _simulateDisconnect: () => void
}

function criarMockPort(tabId: number): MockPort {
  const messageListeners: PortMessageListener[] = []
  const disconnectListeners: PortDisconnectListener[] = []

  const port: MockPort = {
    name: 'openparty-content',
    sender: { tab: { id: tabId } },
    postMessage: vi.fn(),
    onMessage: {
      addListener: (fn) => messageListeners.push(fn),
      _listeners: messageListeners,
    },
    onDisconnect: {
      addListener: (fn) => disconnectListeners.push(fn),
      _listeners: disconnectListeners,
    },
    disconnect: vi.fn(),
    _simulateMessage: (msg) => {
      for (const fn of messageListeners) fn(msg, port)
    },
    _simulateDisconnect: () => {
      for (const fn of disconnectListeners) fn(port)
    },
  }
  return port
}

type ConnectListener = (port: MockPort) => void
type MessageListener = (message: unknown, sender: unknown, sendResponse: (r: unknown) => void) => boolean | undefined

interface MockRuntime {
  onConnect: { addListener: (fn: ConnectListener) => void; _listeners: ConnectListener[] }
  onMessage: { addListener: (fn: MessageListener) => void; _listeners: MessageListener[] }
  _simulateConnect: (port: MockPort) => void
  _simulateMessage: (msg: unknown, sender?: unknown) => unknown

}

function criarMockRuntime(): MockRuntime {
  const connectListeners: ConnectListener[] = []
  const messageListeners: MessageListener[] = []

  return {
    onConnect: {
      addListener: (fn) => connectListeners.push(fn),
      _listeners: connectListeners,
    },
    onMessage: {
      addListener: (fn) => messageListeners.push(fn),
      _listeners: messageListeners,
    },
    _simulateConnect: (port) => {
      for (const fn of connectListeners) fn(port)
    },
    _simulateMessage: (msg, sender?: unknown) => {
      let response: unknown
      for (const fn of messageListeners) {
        fn(msg, sender ?? {}, (r) => { response = r })
      }
      return response
    },
  }
}

// ---------------------------------------------------------------------------
// Mock do ws-client
// ---------------------------------------------------------------------------

interface MockWsClient {
  send: ReturnType<typeof vi.fn>
  close: ReturnType<typeof vi.fn>
  readyState: number
}

let mockWsClient: MockWsClient
let capturedWsUrl: string | null = null

vi.mock('../src/lib/ws-client', () => ({
  createWsClient: vi.fn((opts: { url: string; onEvent: (e: unknown) => void }) => {
    capturedWsUrl = opts.url
    mockWsClient = {
      send: vi.fn(),
      close: vi.fn(),
      readyState: 1, // OPEN
    }
    // Guarda o callback onEvent para que os testes possam simular eventos do servidor
    ;(mockWsClient as unknown as { _onEvent: (e: unknown) => void })._onEvent = opts.onEvent
    return mockWsClient
  }),
}))

vi.mock('../src/lib/storage', () => ({
  storageGet: vi.fn().mockResolvedValue({
    roomId: null,
    userId: null,
    displayName: 'Participante',
    avatar: '🎬',
    serverUrl: 'wss://localhost:3000/ws',
    clockOffsetMs: 0,
  }),
  storageSet: vi.fn().mockResolvedValue(undefined),
}))

// ---------------------------------------------------------------------------
// Configura o global chrome antes de importar o service worker
// ---------------------------------------------------------------------------

let mockRuntime: MockRuntime
let storageLocalData: Record<string, unknown>

beforeEach(() => {
  capturedWsUrl = null
  storageLocalData = {}
  mockRuntime = criarMockRuntime()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ;(globalThis as unknown as any).chrome = {
    runtime: mockRuntime,
    storage: {
      local: {
        get: vi.fn((key: string) => Promise.resolve({ [key]: storageLocalData[key] })),
        set: vi.fn((data: Record<string, unknown>) => {
          Object.assign(storageLocalData, data)
          return Promise.resolve()
        }),
        clear: vi.fn(() => {
          storageLocalData = {}
          return Promise.resolve()
        }),
        remove: vi.fn((key: string) => {
          delete storageLocalData[key]
          return Promise.resolve()
        }),
      },
    },
  }
})

afterEach(() => {
  vi.resetModules()
})

// ---------------------------------------------------------------------------
// Testes
// ---------------------------------------------------------------------------

describe('service worker - gestao de portas', () => {
  it('registra porta ao conectar content script', async () => {
    await import('../src/background/service-worker')
    const porta = criarMockPort(42)
    mockRuntime._simulateConnect(porta)
    // Verificar que a porta recebeu o listener de mensagem
    expect(porta.onMessage._listeners.length).toBeGreaterThan(0)
    expect(porta.onDisconnect._listeners.length).toBeGreaterThan(0)
  })

  it('ignora porta sem tabId', async () => {
    await import('../src/background/service-worker')
    const portaSemTab = {
      ...criarMockPort(0),
      sender: {},
    } as unknown as MockPort
    // Nao deve lancar erro
    expect(() => mockRuntime._simulateConnect(portaSemTab)).not.toThrow()
  })

  it('envia evento do servidor para a porta do content script', async () => {
    await import('../src/background/service-worker')
    const porta = criarMockPort(10)
    mockRuntime._simulateConnect(porta)

    // Entra na sala para garantir que o WS seja conectado
    await new Promise<void>((resolve) => {
      mockRuntime._simulateMessage({ type: 'join-room', roomId: 'sala-x' }, {})
      setTimeout(resolve, 10)
    })

    // Simula evento de play recebido do servidor
    const eventoPlay = { type: 'play', time: 30, when: Date.now() + 300 }
    const onEvent = (mockWsClient as unknown as { _onEvent: (e: unknown) => void })._onEvent
    onEvent(eventoPlay)

    expect(porta.postMessage).toHaveBeenCalledWith(eventoPlay)
  })

  it('encaminha mensagem do content script para o servidor WS', async () => {
    await import('../src/background/service-worker')
    const porta = criarMockPort(7)
    mockRuntime._simulateConnect(porta)

    // Entra na sala para conectar o WS
    await new Promise<void>((resolve) => {
      mockRuntime._simulateMessage({ type: 'join-room', roomId: 'sala-y' }, {})
      setTimeout(resolve, 10)
    })

    porta._simulateMessage({ type: 'play', time: 10 })

    expect(mockWsClient.send).toHaveBeenCalledWith({ type: 'play', time: 10 })
  })

  it('remove porta do registro ao desconectar', async () => {
    await import('../src/background/service-worker')
    const porta = criarMockPort(99)
    mockRuntime._simulateConnect(porta)

    // Entra na sala para conectar o WS
    await new Promise<void>((resolve) => {
      mockRuntime._simulateMessage({ type: 'join-room', roomId: 'sala-z' }, {})
      setTimeout(resolve, 10)
    })

    porta._simulateDisconnect()

    // Depois de desconectar, eventos do servidor nao devem chegar na porta
    const eventoPlay = { type: 'play', time: 5, when: Date.now() }
    const onEvent = (mockWsClient as unknown as { _onEvent: (e: unknown) => void })._onEvent
    onEvent(eventoPlay)

    expect(porta.postMessage).not.toHaveBeenCalled()
  })

  it('nao encaminha mensagem invalida do content script ao WS (M1)', async () => {
    await import('../src/background/service-worker')
    const porta = criarMockPort(11)
    mockRuntime._simulateConnect(porta)

    await new Promise<void>((resolve) => {
      mockRuntime._simulateMessage({ type: 'join-room', roomId: 'sala-m1' }, {})
      setTimeout(resolve, 10)
    })

    // Mensagem invalida: tipo desconhecido
    porta._simulateMessage({ type: 'EVENTO_INVALIDO_XYZ', payload: 'malicioso' })

    // O WS nao deve ter recebido esta mensagem
    expect(mockWsClient.send).not.toHaveBeenCalledWith(
      expect.objectContaining({ type: 'EVENTO_INVALIDO_XYZ' }),
    )
  })
})

describe('service worker - C2: URL WebSocket inclui roomId', () => {
  it('monta a URL do WS com o roomId ao entrar na sala', async () => {
    await import('../src/background/service-worker')

    await new Promise<void>((resolve) => {
      mockRuntime._simulateMessage({ type: 'join-room', roomId: 'sala-url-test' }, {})
      setTimeout(resolve, 10)
    })

    // A URL passada ao ws-client deve conter o roomId no path
    expect(capturedWsUrl).toContain('sala-url-test')
  })

  it('URL do WS e a concatenacao de serverUrl + roomId', async () => {
    await import('../src/background/service-worker')

    await new Promise<void>((resolve) => {
      mockRuntime._simulateMessage({ type: 'join-room', roomId: 'abc123' }, {})
      setTimeout(resolve, 10)
    })

    // serverUrl mockado: wss://localhost:3000/ws
    // URL esperada: wss://localhost:3000/ws/abc123
    expect(capturedWsUrl).toBe('wss://localhost:3000/ws/abc123')
  })
})

describe('service worker - H4: persistencia e recovery de room-state', () => {
  it('persiste room-state no chrome.storage ao receber evento room-state do servidor', async () => {
    await import('../src/background/service-worker')
    const porta = criarMockPort(20)
    mockRuntime._simulateConnect(porta)

    await new Promise<void>((resolve) => {
      mockRuntime._simulateMessage({ type: 'join-room', roomId: 'sala-h4' }, {})
      setTimeout(resolve, 10)
    })

    const roomState = {
      type: 'room-state',
      positionSecs: 42,
      lastEventAt: Date.now(),
      playing: true,
      roomId: 'sala-h4',
      mediaUrl: 'https://youtu.be/xyz',
      mediaType: 'youtube',
      playbackRate: 1,
      hostId: 'host1',
      hostLock: false,
      peers: [],
    }

    const onEvent = (mockWsClient as unknown as { _onEvent: (e: unknown) => void })._onEvent
    onEvent(roomState)

    // Aguarda a promise de chrome.storage.local.set resolver
    await new Promise((r) => setTimeout(r, 10))

    // chrome.storage.local.set deve ter sido chamado com o cachedRoomState
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const chromeMock = (globalThis as unknown as any).chrome
    expect(chromeMock.storage.local.set).toHaveBeenCalledWith(
      expect.objectContaining({ cachedRoomState: roomState }),
    )
  })

  it('envia room-state cacheado ao content script que acaba de conectar', async () => {
    // Pre-popula o cache com um room-state
    const cachedState = {
      type: 'room-state',
      positionSecs: 99,
      lastEventAt: Date.now(),
      playing: false,
      roomId: 'sala-h4',
      mediaUrl: 'https://youtu.be/xyz',
      mediaType: 'youtube',
      playbackRate: 1,
      hostId: 'host1',
      hostLock: false,
      peers: [],
    }
    storageLocalData['cachedRoomState'] = cachedState

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const chromeMock = (globalThis as unknown as any).chrome
    chromeMock.storage.local.get = vi.fn((key: string) =>
      Promise.resolve({ [key]: storageLocalData[key] }),
    )

    await import('../src/background/service-worker')

    const porta = criarMockPort(30)
    mockRuntime._simulateConnect(porta)

    // Aguarda a promise de chrome.storage.local.get resolver
    await new Promise((r) => setTimeout(r, 20))

    // A porta deve ter recebido o estado cacheado
    expect(porta.postMessage).toHaveBeenCalledWith(cachedState)
  })

  it('limpa o cache de room-state ao sair da sala', async () => {
    storageLocalData['cachedRoomState'] = { type: 'room-state', positionSecs: 10 }

    await import('../src/background/service-worker')

    mockRuntime._simulateMessage({ type: 'leave-room' })
    await new Promise((r) => setTimeout(r, 10))

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const chromeMock = (globalThis as unknown as any).chrome
    expect(chromeMock.storage.local.remove).toHaveBeenCalledWith('cachedRoomState')
  })
})

describe('service worker - mensagens do popup', () => {
  it('responde a mensagem join-room persistindo roomId', async () => {
    const { storageSet } = await import('../src/lib/storage')
    await import('../src/background/service-worker')

    mockRuntime._simulateMessage({ type: 'join-room', roomId: 'sala-abc' })

    expect(storageSet).toHaveBeenCalledWith(expect.objectContaining({ roomId: 'sala-abc' }))
  })

  it('responde a mensagem leave-room limpando roomId', async () => {
    const { storageSet } = await import('../src/lib/storage')
    await import('../src/background/service-worker')

    mockRuntime._simulateMessage({ type: 'leave-room' })

    expect(storageSet).toHaveBeenCalledWith(expect.objectContaining({ roomId: null }))
  })

  it('responde a get-status retornando estado atual', async () => {
    await import('../src/background/service-worker')
    const response = mockRuntime._simulateMessage({ type: 'get-status' })
    expect(response).toMatchObject({ ok: true })
  })
})
