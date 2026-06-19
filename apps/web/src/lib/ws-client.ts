// apps/web/src/lib/ws-client.ts
import type { ClientEvent, ServerEvent } from '@openparty/protocol'

export type EventHandler<T extends ServerEvent> = (event: T) => void

export interface WsClientOptions {
  url: string
  onEvent: (event: ServerEvent) => void
  onOpen?: () => void
  onClose?: () => void
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
    reconnectDelayMs = 2_000,
  } = options

  let ws: WebSocket | null = null
  let destroyed = false
  let reconnectAttempt = 0
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null
  const queue: ClientEvent[] = []

  function connect() {
    if (destroyed) return

    ws = new WebSocket(url)

    ws.onopen = () => {
      reconnectAttempt = 0

      // Drena fila de mensagens pendentes
      while (queue.length > 0) {
        const pending = queue.shift()!
        trySend(pending)
      }

      onOpen?.()
    }

    ws.onclose = (_evt) => {
      if (destroyed) {
        onClose?.()
        return
      }

      onClose?.()

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
