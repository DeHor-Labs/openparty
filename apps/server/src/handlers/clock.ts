// apps/server/src/handlers/clock.ts
import type { ClockPingEvent } from '@openparty/protocol'
import type { RoomClient } from '../rooms'

export function handleClockPing(
  event: ClockPingEvent,
  client: RoomClient
): void {
  // t2 capturado logo ao entrar no handler (recepcao do ping)
  const t2 = Date.now()

  const pong = {
    type: 'clock-pong' as const,
    t1: event.t1,
    t2,
    // t3 capturado imediatamente antes de montar o pong (envio iminente)
    t3: Date.now(),
  }

  client.send(pong)
}
