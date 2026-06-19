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

  // --- Testes de regressao: handshake de identidade ---

  it('envia handshake como PRIMEIRO frame ao abrir o socket', () => {
    const hs = { displayName: 'Nikolas', avatar: '🎬' }
    createWsClient(makeOptions({ handshake: hs }))
    const ws = MockWebSocket.lastInstance()
    ws.simulateOpen()

    expect(ws.sentMessages).toHaveLength(1)
    expect(JSON.parse(ws.sentMessages[0]!)).toEqual(hs)
  })

  it('envia handshake ANTES de mensagens enfileiradas', () => {
    const hs = { displayName: 'Nikolas', avatar: '🎬' }
    const client = createWsClient(makeOptions({ handshake: hs }))
    const ws = MockWebSocket.lastInstance()

    // Enfileira uma mensagem antes da conexao abrir
    const msg: ClientEvent = { type: 'chat', text: 'ola' }
    client.send(msg)

    ws.simulateOpen()

    // Primeiro frame deve ser o handshake, segundo a mensagem enfileirada
    expect(ws.sentMessages).toHaveLength(2)
    expect(JSON.parse(ws.sentMessages[0]!)).toEqual(hs)
    expect(JSON.parse(ws.sentMessages[1]!)).toEqual(msg)
  })

  it('reenvia handshake em toda reconexao', () => {
    const hs = { displayName: 'Nikolas', avatar: '🎬' }
    createWsClient(makeOptions({ handshake: hs, reconnectDelayMs: 100 }))

    // Primeira conexao
    const ws1 = MockWebSocket.lastInstance()
    ws1.simulateOpen()
    expect(JSON.parse(ws1.sentMessages[0]!)).toEqual(hs)

    // Simula queda e espera reconexao
    ws1.simulateDrop()
    vi.advanceTimersByTime(100)

    // Segunda conexao (reconexao)
    const ws2 = MockWebSocket.lastInstance()
    ws2.simulateOpen()

    // Handshake deve ser reenviado na reconexao
    expect(ws2.sentMessages).toHaveLength(1)
    expect(JSON.parse(ws2.sentMessages[0]!)).toEqual(hs)
  })

  it('aceita handshake como funcao e a chama a cada abertura', () => {
    let callCount = 0
    const handshakeFn = () => {
      callCount++
      return { displayName: `User-${callCount}`, avatar: '🐼' }
    }

    createWsClient(makeOptions({ handshake: handshakeFn, reconnectDelayMs: 100 }))

    const ws1 = MockWebSocket.lastInstance()
    ws1.simulateOpen()
    expect(callCount).toBe(1)
    expect(JSON.parse(ws1.sentMessages[0]!)).toEqual({ displayName: 'User-1', avatar: '🐼' })

    ws1.simulateDrop()
    vi.advanceTimersByTime(100)

    const ws2 = MockWebSocket.lastInstance()
    ws2.simulateOpen()
    expect(callCount).toBe(2)
    expect(JSON.parse(ws2.sentMessages[0]!)).toEqual({ displayName: 'User-2', avatar: '🐼' })
  })

  it('nao envia handshake quando opcao nao e fornecida', () => {
    // Sem handshake: comportamento legado, nenhum frame extra no open
    const client = createWsClient(makeOptions())
    const ws = MockWebSocket.lastInstance()
    ws.simulateOpen()

    // Nenhum frame enviado automaticamente (sem handshake configurado)
    expect(ws.sentMessages).toHaveLength(0)

    // Mas send ainda funciona normalmente
    const msg: ClientEvent = { type: 'reaction', emoji: '🎉' }
    client.send(msg)
    expect(ws.sentMessages).toHaveLength(1)
  })

  // --- Teste MED-4: onClose chamado no maximo uma vez por fechamento ---

  it('chama onClose exatamente uma vez ao fechar via client.close()', () => {
    const onClose = vi.fn()
    const client = createWsClient(makeOptions({ onClose }))
    const ws = MockWebSocket.lastInstance()
    ws.simulateOpen()
    client.close()
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('chama onClose exatamente uma vez em queda inesperada seguida de close()', () => {
    const onClose = vi.fn()
    const client = createWsClient(makeOptions({ onClose, reconnectDelayMs: 100 }))
    const ws = MockWebSocket.lastInstance()
    ws.simulateOpen()

    // Simula queda e logo em seguida close() explicito antes da reconexao
    ws.simulateDrop()
    client.close()

    // onClose deve ter sido chamado apenas uma vez (pelo simulateDrop)
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  // --- Testes de limite de fila (MAX_QUEUE_SIZE) ---

  it('descarta mensagens mais antigas quando fila excede MAX_QUEUE_SIZE', () => {
    const client = createWsClient(makeOptions())
    const ws = MockWebSocket.lastInstance()
    // Nao abre a conexao: mensagens ficam na fila

    // Enfileira 110 mensagens (MAX_QUEUE_SIZE = 100)
    for (let i = 0; i < 110; i++) {
      client.send({ type: 'chat', text: `msg-${i}` })
    }

    // Abre a conexao para drenar a fila
    ws.simulateOpen()

    // Deve ter enviado EXATAMENTE MAX_QUEUE_SIZE mensagens (boundary exato)
    const sent = ws.sentMessages.map((m) => JSON.parse(m) as { type: string; text: string })
    expect(sent.length).toBe(100)

    // As 10 mensagens mais antigas (msg-0 a msg-9) devem ter sido descartadas
    const texts = sent.map((m) => m.text)
    expect(texts).not.toContain('msg-0')
    expect(texts).not.toContain('msg-9')
    // As mais recentes devem estar presentes
    expect(texts).toContain('msg-10') // primeira mantida
    expect(texts).toContain('msg-109') // mais recente
  })

  // --- Testes de close codes 4xxx ---

  it('nao reconecta quando close code esta na faixa 4000-4999', () => {
    const client = createWsClient(makeOptions({ reconnectDelayMs: 100 }))
    const ws = MockWebSocket.lastInstance()
    ws.simulateOpen()

    // Simula fechamento com code de aplicacao (4xxx)
    ws.readyState = MockWebSocket.CLOSED
    const evt = new CloseEvent('close', { wasClean: true, code: 4001 })
    ws.onclose?.(evt)

    // Avanca tempo suficiente para reconexao ocorrer se houvesse
    vi.advanceTimersByTime(500)

    // Nenhuma nova instancia: nao deve reconectar
    expect(MockWebSocket.instances).toHaveLength(1)
    client.close()
  })

  it('reconecta quando close code e 1006 (queda inesperada)', () => {
    createWsClient(makeOptions({ reconnectDelayMs: 100 }))
    const ws = MockWebSocket.lastInstance()
    ws.simulateOpen()
    ws.simulateDrop() // code 1006

    vi.advanceTimersByTime(100)

    // Deve ter criado nova instancia (reconexao)
    expect(MockWebSocket.instances).toHaveLength(2)
  })

  it('nao reconecta quando close code e 1008 (Policy Violation - handshake invalido)', () => {
    // 1008 e o close code usado pelo servidor ao rejeitar handshake invalido.
    // Reconectar nao resolveria e causaria loop infinito.
    const client = createWsClient(makeOptions({ reconnectDelayMs: 100 }))
    const ws = MockWebSocket.lastInstance()
    ws.simulateOpen()

    ws.readyState = MockWebSocket.CLOSED
    const evt = new CloseEvent('close', { wasClean: true, code: 1008 })
    ws.onclose?.(evt)

    vi.advanceTimersByTime(500)
    expect(MockWebSocket.instances).toHaveLength(1)
    client.close()
  })

  it('nao reconecta quando close code e 1002 (Protocol Error)', () => {
    const client = createWsClient(makeOptions({ reconnectDelayMs: 100 }))
    const ws = MockWebSocket.lastInstance()
    ws.simulateOpen()

    ws.readyState = MockWebSocket.CLOSED
    const evt = new CloseEvent('close', { wasClean: true, code: 1002 })
    ws.onclose?.(evt)

    vi.advanceTimersByTime(500)
    expect(MockWebSocket.instances).toHaveLength(1)
    client.close()
  })

  it('descarta fila de mensagens pendentes ao chamar close()', () => {
    const client = createWsClient(makeOptions())
    // Enfileira mensagens sem abrir o socket
    client.send({ type: 'chat', text: 'msg-1' })
    client.send({ type: 'chat', text: 'msg-2' })

    // Fecha sem abrir: a fila deve ser descartada
    client.close()

    const ws = MockWebSocket.lastInstance()
    // Abre para verificar que nenhuma mensagem e entregue
    ws.simulateOpen()

    // Somente o handshake nao configurado: nenhuma mensagem deve ter sido enviada
    expect(ws.sentMessages).toHaveLength(0)
  })

  it('nao reconecta quando close code e 4000 (limite inferior da faixa 4xxx)', () => {
    const client = createWsClient(makeOptions({ reconnectDelayMs: 100 }))
    const ws = MockWebSocket.lastInstance()
    ws.simulateOpen()

    ws.readyState = MockWebSocket.CLOSED
    const evt = new CloseEvent('close', { wasClean: true, code: 4000 })
    ws.onclose?.(evt)

    vi.advanceTimersByTime(500)
    expect(MockWebSocket.instances).toHaveLength(1)
    client.close()
  })

  it('nao reconecta quando close code e 4999 (limite superior da faixa 4xxx)', () => {
    const client = createWsClient(makeOptions({ reconnectDelayMs: 100 }))
    const ws = MockWebSocket.lastInstance()
    ws.simulateOpen()

    ws.readyState = MockWebSocket.CLOSED
    const evt = new CloseEvent('close', { wasClean: true, code: 4999 })
    ws.onclose?.(evt)

    vi.advanceTimersByTime(500)
    expect(MockWebSocket.instances).toHaveLength(1)
    client.close()
  })
})
