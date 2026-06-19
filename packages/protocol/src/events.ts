// packages/protocol/src/events.ts
// Contrato central do protocolo WebSocket do OpenParty.

// ---------------------------------------------------------------------------
// Estado da sala (servidor como fonte da verdade)
// ---------------------------------------------------------------------------

export interface RoomState {
  roomId: string
  mediaUrl: string
  mediaType: 'youtube' | 'mp4'
  playing: boolean
  /** Posicao em segundos no momento do ultimo evento de sync */
  positionSecs: number
  /** Date.now() do servidor no momento do ultimo evento de sync */
  lastEventAt: number
  /** Padrao 1.0 */
  playbackRate: number
  hostId: string
  /** Se true, somente o host pode emitir play/pause/seek */
  hostLock: boolean
}

// ---------------------------------------------------------------------------
// Eventos: Cliente -> Servidor
// ---------------------------------------------------------------------------

export interface PlayClientEvent {
  type: 'play'
  time: number
}

export interface PauseClientEvent {
  type: 'pause'
  time: number
}

export interface SeekClientEvent {
  type: 'seek'
  time: number
}

export interface ClockPingEvent {
  type: 'clock-ping'
  /** Date.now() do cliente no momento do envio */
  t1: number
}

export interface BufferingStartEvent {
  type: 'buffering-start'
}

export interface BufferingEndEvent {
  type: 'buffering-end'
}

export interface ChatClientEvent {
  type: 'chat'
  text: string
}

export interface ReactionClientEvent {
  type: 'reaction'
  emoji: string
}

/** Cliente solicita ativar ou desativar o host-lock da sala */
export interface SetHostLockClientEvent {
  type: 'set-host-lock'
  locked: boolean
}

export type ClientEvent =
  | PlayClientEvent
  | PauseClientEvent
  | SeekClientEvent
  | ClockPingEvent
  | BufferingStartEvent
  | BufferingEndEvent
  | ChatClientEvent
  | ReactionClientEvent
  | SetHostLockClientEvent

// ---------------------------------------------------------------------------
// Eventos: Servidor -> Clientes
// ---------------------------------------------------------------------------

/**
 * Enviado ao cliente logo apos o handshake para informar seu userId.
 * Permite que o cliente saiba quem ele mesmo e e compare com hostId.
 */
export interface WelcomeEvent {
  type: 'welcome'
  userId: string
}

/** Enviado ao entrante para sincronizar estado completo da sala */
export interface RoomStateEvent extends RoomState {
  type: 'room-state'
  /** userId dos participantes presentes no momento */
  peers: PresencePeer[]
}

export interface PlayServerEvent {
  type: 'play'
  time: number
  /** Date.now() do servidor + 300ms; clientes aguardam ate `when` para executar */
  when: number
}

export interface PauseServerEvent {
  type: 'pause'
  time: number
  serverTime: number
}

export interface SeekServerEvent {
  type: 'seek'
  time: number
}

export interface ClockPongEvent {
  type: 'clock-pong'
  /** Eco do t1 enviado pelo cliente */
  t1: number
  /** Date.now() do servidor ao receber o ping */
  t2: number
  /** Date.now() do servidor ao enviar o pong */
  t3: number
}

export interface JoinEvent {
  type: 'join'
  userId: string
  displayName: string
  avatar: string
}

export interface LeaveEvent {
  type: 'leave'
  userId: string
}

export interface HostChangeEvent {
  type: 'host-change'
  hostId: string
}

/** Notifica todos os clientes da sala sobre mudanca no estado do host-lock */
export interface HostLockEvent {
  type: 'host-lock'
  locked: boolean
}

export interface ChatServerEvent {
  type: 'chat'
  userId: string
  displayName: string
  text: string
  ts: number
}

export interface ReactionServerEvent {
  type: 'reaction'
  userId: string
  emoji: string
  ts: number
}

export type ServerEvent =
  | WelcomeEvent
  | RoomStateEvent
  | PlayServerEvent
  | PauseServerEvent
  | SeekServerEvent
  | ClockPongEvent
  | JoinEvent
  | LeaveEvent
  | HostChangeEvent
  | HostLockEvent
  | ChatServerEvent
  | ReactionServerEvent

// ---------------------------------------------------------------------------
// Tipos auxiliares
// ---------------------------------------------------------------------------

export interface PresencePeer {
  userId: string
  displayName: string
  avatar: string
}

// ---------------------------------------------------------------------------
// Constantes de validacao
// ---------------------------------------------------------------------------

/** Duracao maxima de video suportada (24 horas em segundos) */
export const MAX_TIME_SECS = 86400

/** Comprimento maximo do texto de chat */
export const CHAT_MAX_LENGTH = 500

/** Comprimento maximo do emoji de reacao */
export const EMOJI_MAX_LENGTH = 16

// ---------------------------------------------------------------------------
// Helpers internos de validacao de payload
// ---------------------------------------------------------------------------

/** Verifica se `n` e um number finito >= 0 e <= MAX_TIME_SECS */
function isValidTimeSecs(n: unknown): n is number {
  return (
    typeof n === 'number' &&
    Number.isFinite(n) &&
    n >= 0 &&
    n <= MAX_TIME_SECS
  )
}

// ---------------------------------------------------------------------------
// Type guards (usados pelo servidor para validar mensagens recebidas)
// ---------------------------------------------------------------------------

/**
 * Valida que `raw` e um ClientEvent bem-formado, incluindo os campos
 * obrigatorios de cada subtipo. Payload invalido retorna false.
 */
export function isClientEvent(raw: unknown): raw is ClientEvent {
  if (typeof raw !== 'object' || raw === null) return false

  const obj = raw as Record<string, unknown>
  if (typeof obj['type'] !== 'string') return false

  switch (obj['type']) {
    case 'play':
    case 'pause':
    case 'seek':
      return isValidTimeSecs(obj['time'])

    case 'clock-ping':
      return typeof obj['t1'] === 'number' && Number.isFinite(obj['t1'])

    case 'chat': {
      const text = obj['text']
      return (
        typeof text === 'string' &&
        text.length >= 1 &&
        text.length <= CHAT_MAX_LENGTH
      )
    }

    case 'reaction': {
      const emoji = obj['emoji']
      return (
        typeof emoji === 'string' &&
        emoji.length >= 1 &&
        emoji.length <= EMOJI_MAX_LENGTH
      )
    }

    case 'set-host-lock':
      return typeof obj['locked'] === 'boolean'

    case 'buffering-start':
    case 'buffering-end':
      return true

    default:
      return false
  }
}

export function isPlayClientEvent(e: ClientEvent): e is PlayClientEvent {
  return e.type === 'play'
}

export function isPauseClientEvent(e: ClientEvent): e is PauseClientEvent {
  return e.type === 'pause'
}

export function isSeekClientEvent(e: ClientEvent): e is SeekClientEvent {
  return e.type === 'seek'
}

export function isClockPingEvent(e: ClientEvent): e is ClockPingEvent {
  return e.type === 'clock-ping'
}

export function isChatClientEvent(e: ClientEvent): e is ChatClientEvent {
  return e.type === 'chat'
}

export function isReactionClientEvent(e: ClientEvent): e is ReactionClientEvent {
  return e.type === 'reaction'
}

export function isBufferingStartEvent(e: ClientEvent): e is BufferingStartEvent {
  return e.type === 'buffering-start'
}

export function isBufferingEndEvent(e: ClientEvent): e is BufferingEndEvent {
  return e.type === 'buffering-end'
}

export function isSetHostLockEvent(e: ClientEvent): e is SetHostLockClientEvent {
  return e.type === 'set-host-lock'
}
