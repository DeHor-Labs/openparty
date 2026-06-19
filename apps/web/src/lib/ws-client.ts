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
/** Numero maximo de mensagens na fila de envio pendente */
const MAX_QUEUE_SIZE = 100
/** Faixa de close codes reservados para uso de aplicacao (nao reconectar) */
const APP_CLOSE_CODE_MIN = 4000
const APP_CLOSE_CODE_MAX = 4999

/**
 * Close codes do protocolo WebSocket que sinalizam falha permanente:
 * - 1002 (Protocol Error): servidor rejeitou por violacao de protocolo.
 * - 1008 (Policy Violation): servidor rejeitou handshake ou regra de seguranca.
 * Nesses casos reconectar nao resolveria e causaria loop infinito.
 */
const FATAL_CLOSE_CODES = new Set([1002, 1008])

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

    ws.onclose = (evt) => {
      // Garante que onClose nao seja disparado mais de uma vez por fechamento
      if (closeFired) return
      closeFired = true

      onClose?.()

      if (destroyed) return

      // Close codes 4xxx sao reservados para uso de aplicacao (ex: autenticacao invalida,
      // sala encerrada). Nesses casos nao faz sentido reconectar automaticamente.
      if (evt.code >= APP_CLOSE_CODE_MIN && evt.code <= APP_CLOSE_CODE_MAX) return

      // Close codes de protocolo que indicam falha permanente (ex: handshake recusado
      // com 1008 Policy Violation, ou violacao de protocolo 1002): reconectar nao resolve.
      if (FATAL_CLOSE_CODES.has(evt.code)) return

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
        // Ao exceder o limite, descarta a mensagem mais antiga para manter as mais recentes
        if (queue.length >= MAX_QUEUE_SIZE) {
          queue.shift()
        }
        queue.push(event)
      }
    },

    /**
     * Fecha a conexao e cancela reconexoes pendentes.
     * Mensagens enfileiradas aguardando envio sao descartadas ao chamar este metodo.
     */
    close() {
      destroyed = true
      if (reconnectTimer !== null) {
        clearTimeout(reconnectTimer)
        reconnectTimer = null
      }
      // Descarta mensagens pendentes na fila: apos close() nao ha mais conexao destino.
      queue.length = 0
      ws?.close()
    },

    get readyState(): number {
      return ws?.readyState ?? WebSocket.CLOSED
    },
  }
}
