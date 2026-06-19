// apps/server/src/handlers/sync.ts
import type { PlayClientEvent, PauseClientEvent, SeekClientEvent } from '@openparty/protocol'
import { applyPlay, applyPause, applySeek } from '../state'
import { getRoom, broadcast, updateRoomState } from '../rooms'

export function handleSync(
  event: PlayClientEvent | PauseClientEvent | SeekClientEvent,
  roomId: string,
  userId: string
): void {
  const room = getRoom(roomId)
  if (!room) return

  const { state } = room

  if (state.hostLock && userId !== state.hostId) {
    return
  }

  const serverNow = Date.now()

  if (event.type === 'play') {
    const next = applyPlay(state, event.time, serverNow)
    updateRoomState(roomId, next)
    broadcast(roomId, {
      type: 'play',
      time: event.time,
      when: serverNow + 300,
    })
  } else if (event.type === 'pause') {
    const next = applyPause(state, event.time, serverNow)
    updateRoomState(roomId, next)
    broadcast(roomId, {
      type: 'pause',
      time: event.time,
      serverTime: serverNow,
    })
  } else if (event.type === 'seek') {
    const next = applySeek(state, event.time, serverNow)
    updateRoomState(roomId, next)
    broadcast(roomId, {
      type: 'seek',
      time: event.time,
    })
  }
}
