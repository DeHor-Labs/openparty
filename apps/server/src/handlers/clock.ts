// apps/server/src/handlers/clock.ts
import type { ClockPingEvent } from '@openparty/protocol'
import type { RoomClient } from '../rooms'

export function handleClockPing(
  event: ClockPingEvent,
  client: RoomClient
): void {
  const t2 = Date.now()
  const t3 = Date.now()

  client.send({
    type: 'clock-pong',
    t1: event.t1,
    t2,
    t3,
  })
}
