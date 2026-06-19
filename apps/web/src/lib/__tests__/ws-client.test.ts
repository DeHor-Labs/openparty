// apps/web/src/lib/__tests__/ws-client.test.ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import type { ServerEvent, ClientEvent } from '@openparty/protocol'
import { createWsClient, type WsClientOptions } from '../ws-client'

// Mock de WebSocket para jsdom (que nao tem WS nativo)
class MockWebSocket extends EventTarget {
  static CONNECTING = 0
  static OPEN = 1
  static CLOSING = 2
  static CLOSED = 3

  readyState: number = MockWebSocket.CONNECTING
  url: string
  sentMessages: string[] = []
  onopen: ((e: Event) => void) | null = null
  onclose: ((e: CloseEvent) => void) | null = null
  onmessage: ((e: MessageEvent) => void) | null = null
  onerror: ((e: Event) => void) | null = null

  constructor(url: string) {
    super()
    this.url = url
    MockWebSocket.instances.push(this)
  }

  send(data: string) {
    this.sentMessages.push(data)
  }

  close() {
    this.readyState = MockWebSocket.CLOSED
    const evt = new CloseEvent('close', { wasClean: true, code: 1000 })
    this.onclose?.(evt)
  }

  /** Simula abertura da conexao */
  simulateOpen() {
    this.readyState = MockWebSocket.OPEN
    this.onopen?.(new Event('open'))
  }

  /** Simula mensagem do servidor */
  simulateMessage(event: ServerEvent) {
    const evt = new MessageEvent('message', { data: JSON.stringify(event) })
    this.onmessage?.(evt)
  }

  /** Simula queda inesperada */
  simulateDrop() {
    this.readyState = MockWebSocket.CLOSED
    const evt = new CloseEvent('close', { wasClean: false, code: 1006 })
    this.onclose?.(evt)
  }

  static instances: MockWebSocket[] = []
  static lastInstance(): MockWebSocket {
    return MockWebSocket.instances[MockWebSocket.instances.length - 1]!
  }
  static reset() {
    MockWebSocket.instances = []
  }
}

beforeEach(() => {
  MockWebSocket.reset()
  vi.stubGlobal('WebSocket', MockWebSocket)
  vi.useFakeTimers()
})

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe('createWsClient', () => {
  function makeOptions(overrides?: Partial<WsClientOptions>): WsClientOptions {
    return {
      url: 'ws://localhost:3000/ws/room-1',
      onEvent: vi.fn(),
      reconnectDelayMs: 100,
      ...overrides,
    }
  }

  it('cria WebSocket com a url fornecida', () => {
    createWsClient(makeOptions())
    expect(MockWebSocket.lastInstance().url).toBe('ws://localhost:3000/ws/room-1')
  })

  it('chama onEvent quando servidor envia mensagem valida', () => {
    const onEvent = vi.fn()
    createWsClient(makeOptions({ onEvent }))
    const ws = MockWebSocket.lastInstance()
    ws.simulateOpen()

    const event: ServerEvent = {
      type: 'chat',
      userId: 'u1',
      displayName: 'Test',
      text: 'ola',
      ts: Date.now(),
    }
    ws.simulateMessage(event)

    expect(onEvent).toHaveBeenCalledWith(event)
  })

  it('chama onOpen quando WebSocket abre', () => {
    const onOpen = vi.fn()
    createWsClient(makeOptions({ onOpen }))
    MockWebSocket.lastInstance().simulateOpen()
    expect(onOpen).toHaveBeenCalledOnce()
  })

  it('chama onClose quando WebSocket fecha', () => {
    const onClose = vi.fn()
    const client = createWsClient(makeOptions({ onClose }))
    MockWebSocket.lastInstance().simulateOpen()
    client.close()
    expect(onClose).toHaveBeenCalledOnce()
  })

  it('enfileira mensagem enviada antes da conexao abrir e envia apos open', () => {
    const client = createWsClient(makeOptions())
    const ws = MockWebSocket.lastInstance()

    const msg: ClientEvent = { type: 'chat', text: 'ola' }
    client.send(msg)

    // ainda nao deve ter enviado
    expect(ws.sentMessages).toHaveLength(0)

    ws.simulateOpen()

    expect(ws.sentMessages).toHaveLength(1)
    expect(JSON.parse(ws.sentMessages[0]!)).toEqual(msg)
  })

  it('reconecta apos queda com backoff exponencial', () => {
    const opts = makeOptions({ reconnectDelayMs: 100 })
    createWsClient(opts)
    const ws1 = MockWebSocket.lastInstance()
    ws1.simulateOpen()
    ws1.simulateDrop()

    expect(MockWebSocket.instances).toHaveLength(1)

    // Avanca tempo para primeiro backoff (100ms)
    vi.advanceTimersByTime(100)

    expect(MockWebSocket.instances).toHaveLength(2)
    const ws2 = MockWebSocket.lastInstance()
    ws2.simulateDrop()

    // Segundo backoff: 200ms
    vi.advanceTimersByTime(200)
    expect(MockWebSocket.instances).toHaveLength(3)
  })

  it('para de reconectar apos client.close() explicito', () => {
    const client = createWsClient(makeOptions({ reconnectDelayMs: 100 }))
    const ws = MockWebSocket.lastInstance()
    ws.simulateOpen()
    client.close()

    vi.advanceTimersByTime(500)

    // Nenhuma nova instancia criada apos close explicito
    expect(MockWebSocket.instances).toHaveLength(1)
  })

  it('nao envia mensagem JSON invalida (JSON.stringify nao lanca)', () => {
    const client = createWsClient(makeOptions())
    const ws = MockWebSocket.lastInstance()
    ws.simulateOpen()

    // Evento valido
    const msg: ClientEvent = { type: 'reaction', emoji: '🎉' }
    expect(() => client.send(msg)).not.toThrow()
    expect(ws.sentMessages).toHaveLength(1)
  })

  it('retorna readyState correto', () => {
    const client = createWsClient(makeOptions())
    expect(client.readyState).toBe(MockWebSocket.CONNECTING)

    MockWebSocket.lastInstance().simulateOpen()
    expect(client.readyState).toBe(MockWebSocket.OPEN)
  })
})
