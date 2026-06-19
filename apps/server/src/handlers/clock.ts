// apps/server/src/handlers/clock.ts
import type { ClockPingEvent } from '@openparty/protocol'
import type { RoomClient } from '../rooms'

/**
 * Valor padrao de totalPings usado quando o cliente nao envia o campo.
 * Corresponde ao INITIAL_PINGS do useClock.ts do cliente (calibracao inicial).
 */
const DEFAULT_TOTAL_PINGS = 8

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
    // Eco do totalPings enviado pelo cliente; usa padrao de calibracao inicial
    // quando ausente (compatibilidade com clientes mais antigos).
    totalPings: event.totalPings ?? DEFAULT_TOTAL_PINGS,
  }

  client.send(pong)
}
