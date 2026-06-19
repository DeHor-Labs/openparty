import { nanoid } from 'nanoid'
import type { RoomState, ServerEvent } from '@openparty/protocol'

// ---------------------------------------------------------------------------
// Tipos publicos
// ---------------------------------------------------------------------------

export interface RoomClient {
  userId: string
  displayName: string
  avatar: string
  /** Date.now() no momento da conexao; usado para eleger proximo host */
  connectedAt: number
  send: (event: ServerEvent) => void
}

export interface Room {
  state: RoomState
  clients: Map<string, RoomClient>
}

// ---------------------------------------------------------------------------
// Store em memoria (singleton por processo)
// ---------------------------------------------------------------------------

const rooms = new Map<string, Room>()

// ---------------------------------------------------------------------------
// API publica
// ---------------------------------------------------------------------------

/**
 * Cria uma nova sala, registra no store e retorna o roomId gerado.
 */
export function createRoom(mediaUrl: string, mediaType: 'youtube' | 'mp4'): string {
  const roomId = nanoid()

  const initialState: RoomState = {
    roomId,
    mediaUrl,
    mediaType,
    playing: false,
    positionSecs: 0,
    lastEventAt: Date.now(),
    playbackRate: 1,
    hostId: '',
    hostLock: false,
  }

  rooms.set(roomId, {
    state: initialState,
    clients: new Map(),
  })

  return roomId
}

/**
 * Adiciona um cliente a sala.
 * O primeiro cliente a entrar se torna host.
 * Lanca erro se a sala nao existir.
 */
export function joinRoom(roomId: string, client: RoomClient): void {
  const room = rooms.get(roomId)
  if (!room) {
    throw new Error(`Sala "${roomId}" nao encontrada`)
  }

  room.clients.set(client.userId, client)

  // Se a sala estava sem host (criada sem cliente ou host saiu antes),
  // o entrante vira host.
  if (!room.state.hostId) {
    room.state = { ...room.state, hostId: client.userId }
  }
}

/**
 * Remove um cliente da sala.
 * Se era o host, promove o cliente com menor connectedAt como novo host
 * e transmite host-change para os restantes.
 * Nao lanca erro se sala ou userId nao existirem.
 */
export function leaveRoom(roomId: string, userId: string): void {
  const room = rooms.get(roomId)
  if (!room) return

  const wasHost = room.state.hostId === userId
  room.clients.delete(userId)

  if (wasHost && room.clients.size > 0) {
    // Elege o cliente mais antigo (menor connectedAt)
    let nextHost: RoomClient | null = null
    for (const c of room.clients.values()) {
      if (!nextHost || c.connectedAt < nextHost.connectedAt) {
        nextHost = c
      }
    }

    if (nextHost) {
      room.state = { ...room.state, hostId: nextHost.userId }

      const hostChangeEvent: ServerEvent = {
        type: 'host-change',
        hostId: nextHost.userId,
      }

      for (const c of room.clients.values()) {
        c.send(hostChangeEvent)
      }
    }
  } else if (wasHost && room.clients.size === 0) {
    // Sala ficou vazia - limpar hostId
    room.state = { ...room.state, hostId: '' }
  }
}

/**
 * Envia um ServerEvent para todos os clientes da sala.
 * Opcionalmente exclui um userId (ex: o remetente original).
 * Nao lanca erro se a sala nao existir.
 */
export function broadcast(roomId: string, event: ServerEvent, excludeUserId?: string): void {
  const room = rooms.get(roomId)
  if (!room) return

  for (const [uid, client] of room.clients.entries()) {
    if (uid === excludeUserId) continue
    client.send(event)
  }
}

/**
 * Retorna a Room ou undefined se nao existir.
 */
export function getRoom(roomId: string): Room | undefined {
  return rooms.get(roomId)
}

/**
 * Substitui o estado da sala de forma imutavel.
 * Nao lanca erro se a sala nao existir.
 */
export function updateRoomState(roomId: string, next: RoomState): void {
  const room = rooms.get(roomId)
  if (!room) return
  room.state = next
}

// ---------------------------------------------------------------------------
// Utilitario de teste (nao exportar em producao via barrel)
// ---------------------------------------------------------------------------

/**
 * Limpa o store em memoria. Usado exclusivamente em testes unitarios.
 */
export function _resetStoreForTesting(): void {
  rooms.clear()
}
