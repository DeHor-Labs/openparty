// apps/server/src/handlers/host-lock.ts
import type { SetHostLockClientEvent } from '@openparty/protocol'
import { getRoom, broadcast, updateRoomState } from '../rooms'

/**
 * Processa o pedido de alteracao do host-lock.
 * Somente o host atual pode alterar o estado; pedidos de outros usuarios sao ignorados.
 * Apos a atualizacao, faz broadcast de 'host-lock' para todos os clientes da sala.
 */
export function handleHostLock(
  event: SetHostLockClientEvent,
  roomId: string,
  userId: string
): void {
  const room = getRoom(roomId)
  if (!room) return

  // Somente o host pode alterar o host-lock
  if (userId !== room.state.hostId) return

  const nextState = { ...room.state, hostLock: event.locked }
  updateRoomState(roomId, nextState)

  broadcast(roomId, {
    type: 'host-lock',
    locked: event.locked,
  })
}
