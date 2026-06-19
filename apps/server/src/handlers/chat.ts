// apps/server/src/handlers/chat.ts
import type { ChatClientEvent, ReactionClientEvent } from '@openparty/protocol'
import { getRoom, broadcast } from '../rooms'

export function handleChat(
  event: ChatClientEvent,
  roomId: string,
  userId: string
): void {
  const room = getRoom(roomId)
  if (!room) return

  const client = room.clients.get(userId)
  if (!client) return

  broadcast(roomId, {
    type: 'chat',
    userId,
    displayName: client.displayName,
    text: event.text,
    ts: Date.now(),
  })
}

export function handleReaction(
  event: ReactionClientEvent,
  roomId: string,
  userId: string
): void {
  const room = getRoom(roomId)
  if (!room) return

  broadcast(roomId, {
    type: 'reaction',
    userId,
    emoji: event.emoji,
    ts: Date.now(),
  })
}
