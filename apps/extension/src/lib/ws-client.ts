// src/lib/ws-client.ts
// Portado de apps/web/src/lib/ws-client.ts.
// Adaptacao minima: sem dependencias de React ou DOM do browser (funciona no
// service worker MV3 que tambem tem WebSocket global).
import type { ClientEvent, ServerEvent } from '@openparty/protocol'
import { isClientEvent } from '@openparty/protocol'

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
   * Handshake enviado como PRIMEIRO frame a cada (re)abertura do socket.
   * Aceita objeto estatico ou funcao (util para valores que mudam apos reconexao).
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
/** Limite de mensagens na fila pendente para evitar crescimento ilimitado */
const MAX_QUEUE_SIZE = 100
/** Faixa de close codes de aplicacao (nao reconectar) */
const APP_CLOSE_CODE_MIN = 4000
const APP_CLOSE_CODE_MAX = 4999
/**
 * Close codes de protocolo que indicam falha permanente:
 * 1002 (Protocol Error) e 1008 (Policy Violation).
 */
const FATAL_CLOSE_CODES = new Set([1002, 1008])

/**
 * Valida um ServerEvent recebido pelo socket antes de entregar ao onEvent.
 * M2: descarta shapes invalidos (ex: seek com time null/Infinity).
 */
function isValidServerEvent(raw: unknown): raw is ServerEvent {
  if (typeof raw !== 'object' || raw === null) return false
  const obj = raw as Record<string, unknown>
  if (typeof obj['type'] !== 'string') return false

  switch (obj['type']) {
    case 'welcome':
      return typeof obj['userId'] === 'string'

    case 'play': {
      const time = obj['time']
      const when = obj['when']
      return (
        typeof time === 'number' && Number.isFinite(time) && time >= 0 &&
        typeof when === 'number' && Number.isFinite(when)
      )
    }

    case 'pause': {
      const time = obj['time']
      return typeof time === 'number' && Number.isFinite(time) && time >= 0
    }

    case 'seek': {
      const time = obj['time']
      return typeof time === 'number' && Number.isFinite(time) && time >= 0
    }

    case 'room-state':
      return (
        typeof obj['positionSecs'] === 'number' &&
        Number.isFinite(obj['positionSecs']) &&
        typeof obj['lastEventAt'] === 'number' &&
        typeof obj['playing'] === 'boolean'
      )

    case 'clock-pong':
      return (
        typeof obj['t1'] === 'number' &&
        typeof obj['t2'] === 'number' &&
        typeof obj['t3'] === 'number' &&
        typeof obj['totalPings'] === 'number'
      )

    case 'join':
      return (
        typeof obj['userId'] === 'string' &&
        typeof obj['displayName'] === 'string'
      )

    case 'leave':
      return typeof obj['userId'] === 'string'

    case 'host-change':
      return typeof obj['hostId'] === 'string'

    case 'host-lock':
      return typeof obj['locked'] === 'boolean'

    case 'chat':
      return (
        typeof obj['userId'] === 'string' &&
        typeof obj['text'] === 'string'
      )

    case 'reaction':
      return (
        typeof obj['userId'] === 'string' &&
        typeof obj['emoji'] === 'string'
      )

    default:
      return false
  }
}

/** Guard de tipo minimo para ClientEvent - M1: usa allowlist de tipos validos */
function isValidClientEvent(raw: unknown): raw is ClientEvent {
  return isClientEvent(raw)
}

/**
 * Cria um cliente WebSocket com reconexao automatica por backoff exponencial
 * com jitter, fila de mensagens offline e validacao de eventos.
 *
 * CR: jitter de ate 300ms no backoff evita thundering herd apos queda do servidor.
 * M1: valida ClientEvent com allowlist do protocolo antes de enviar.
 * M2: valida ServerEvent antes de entregar ao onEvent.
 */
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

  function resolveHandshake(): WsHandshake | undefined {
    if (!handshake) return undefined
    return typeof handshake === 'function' ? handshake() : handshake
  }

  function trySend(event: ClientEvent): void {
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(event))
    }
  }

  function connect(): void {
    if (destroyed) return

    ws = new WebSocket(url)
    let closeFired = false

    ws.onopen = () => {
      reconnectAttempt = 0

      // Envia handshake de identidade como PRIMEIRO frame obrigatorio
      const hs = resolveHandshake()
      if (hs && ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify(hs))
      }

      // Drena fila de mensagens pendentes acumuladas offline
      while (queue.length > 0) {
        const pending = queue.shift()!
        trySend(pending)
      }

      onOpen?.()
    }

    ws.onclose = (evt) => {
      if (closeFired) return
      closeFired = true

      onClose?.()

      if (destroyed) return

      // Close codes de aplicacao (4xxx): nao reconectar
      if (evt.code >= APP_CLOSE_CODE_MIN && evt.code <= APP_CLOSE_CODE_MAX) return

      // Close codes de protocolo fatais: reconectar nao resolve
      if (FATAL_CLOSE_CODES.has(evt.code)) return

      // Backoff exponencial com teto em MAX_RECONNECT_DELAY_MS.
      // Jitter de ate 300ms para evitar reconexao em manada (thundering herd).
      const jitter = Math.floor(Math.random() * 300)
      const delay = Math.min(
        reconnectDelayMs * Math.pow(2, reconnectAttempt),
        MAX_RECONNECT_DELAY_MS,
      ) + jitter
      reconnectAttempt++

      reconnectTimer = setTimeout(() => {
        if (!destroyed) connect()
      }, delay)
    }

    ws.onmessage = (evt) => {
      try {
        const data = JSON.parse(evt.data as string) as unknown
        // M2: valida shape do ServerEvent antes de entregar ao onEvent
        if (!isValidServerEvent(data)) {
          console.warn('[OpenParty WsClient] frame descartado: shape invalido', data)
          return
        }
        onEvent(data)
      } catch {
        // Frame nao e JSON valido - ignorar silenciosamente
      }
    }

    ws.onerror = () => {
      // onclose sera disparado logo apos; reconexao tratada la
    }
  }

  connect()

  return {
    send(event: ClientEvent): void {
      // M1: valida evento antes de enviar ao servidor
      if (!isValidClientEvent(event)) return

      if (ws && ws.readyState === WebSocket.OPEN) {
        trySend(event)
      } else {
        // Descarta a mensagem mais antiga quando a fila atinge o limite
        if (queue.length >= MAX_QUEUE_SIZE) {
          queue.shift()
        }
        queue.push(event)
      }
    },

    close(): void {
      destroyed = true
      if (reconnectTimer !== null) {
        clearTimeout(reconnectTimer)
        reconnectTimer = null
      }
      // Descarta mensagens pendentes: apos close() nao ha destino
      queue.length = 0
      ws?.close()
    },

    get readyState(): number {
      return ws?.readyState ?? WebSocket.CLOSED
    },
  }
}
