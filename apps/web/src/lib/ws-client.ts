// apps/web/src/lib/ws-client.ts
import type { ClientEvent, ServerEvent } from '@openparty/protocol'

export type EventHandler<T extends ServerEvent> = (event: T) => void

/** Shape do handshake de identidade esperado pelo servidor */
export interface WsHandshake {
  displayName: string
  avatar: string
}

export interface WsClientOptions {
  url: string
  onEvent: (event: ServerEvent) => void
  onOpen?: () => void
  onClose?: () => void
  /**
   * Handshake de identidade enviado como PRIMEIRO frame a cada (re)abertura do socket.
   * Pode ser um objeto estatico ou uma funcao que retorna o objeto (util para valores reativos).
   */
  handshake?: WsHandshake | (() => WsHandshake)
  /** Intervalo base de reconexao em ms; padrao 2000 */
  reconnectDelayMs?: number
}

export interface WsClient {
  send(event: ClientEvent): void
  close(): void
  get readyState(): number
}

const MAX_RECONNECT_DELAY_MS = 30_000

export function createWsClient(options: WsClientOptions): WsClient {
  const {
    url,
    onEvent,
    onOpen,
    onClose,
    handshake,
    reconnectDelayMs = 2_000,
  } = options

  let ws: WebSocket | null = null
  let destroyed = false
  let reconnectAttempt = 0
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null
  const queue: ClientEvent[] = []

  /** Resolve o handshake (suporte a objeto estatico ou funcao) */
  function resolveHandshake(): WsHandshake | undefined {
    if (!handshake) return undefined
    return typeof handshake === 'function' ? handshake() : handshake
  }

  function connect() {
    if (destroyed) return

    ws = new WebSocket(url)
    // Flag que garante onClose chamado no maximo uma vez por instancia de socket
    let closeFired = false

    ws.onopen = () => {
      reconnectAttempt = 0

      // Envia handshake de identidade como PRIMEIRO frame, antes de qualquer outra mensagem.
      // Isso e obrigatorio em toda (re)conexao: o server descarta frames anteriores ao handshake.
      const hs = resolveHandshake()
      if (hs && ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify(hs))
      }

      // Drena fila de mensagens pendentes
      while (queue.length > 0) {
        const pending = queue.shift()!
        trySend(pending)
      }

      onOpen?.()
    }

    ws.onclose = (_evt) => {
      // Garante que onClose nao seja disparado mais de uma vez por fechamento
      if (closeFired) return
      closeFired = true

      onClose?.()

      if (destroyed) return

      // Reconexao com backoff exponencial
      const delay = Math.min(
        reconnectDelayMs * Math.pow(2, reconnectAttempt),
        MAX_RECONNECT_DELAY_MS,
      )
      reconnectAttempt++

      reconnectTimer = setTimeout(() => {
        if (!destroyed) connect()
      }, delay)
    }

    ws.onmessage = (evt) => {
      try {
        const data = JSON.parse(evt.data as string) as ServerEvent
        onEvent(data)
      } catch {
        // Mensagem nao e JSON valido - ignorar
      }
    }

    ws.onerror = () => {
      // onclose sera chamado logo apos; reconexao tratada la
    }
  }

  function trySend(event: ClientEvent) {
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(event))
    }
  }

  connect()

  return {
    send(event: ClientEvent) {
      if (ws && ws.readyState === WebSocket.OPEN) {
        trySend(event)
      } else {
        queue.push(event)
      }
    },

    close() {
      destroyed = true
      if (reconnectTimer !== null) {
        clearTimeout(reconnectTimer)
        reconnectTimer = null
      }
      ws?.close()
    },

    get readyState(): number {
      return ws?.readyState ?? WebSocket.CLOSED
    },
  }
}
