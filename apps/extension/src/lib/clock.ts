// src/lib/clock.ts
// Portado de apps/web/src/lib/clock.ts sem alteracoes de logica.
// Calibracao NTP-like para estimar o offset entre o clock do cliente e do servidor.

export interface ClockSample {
  rtt: number
  offset: number
}

/**
 * Calcula offset NTP-like a partir de uma troca ping/pong.
 *
 * Timeline:
 *   t1 - cliente envia ping
 *   t2 - servidor recebe ping
 *   t3 - servidor envia pong
 *   t4 - cliente recebe pong (Date.now() ao receber)
 *
 * RTT de rede = (t4 - t1) - (t3 - t2)
 * offset     = ((t2 - t1) + (t3 - t4)) / 2
 *
 * Offset positivo: servidor adiantado em relacao ao cliente.
 * Aplicar: serverNow = Date.now() + offset
 */
export function computeClockOffset(
  t1: number,
  t2: number,
  t3: number,
  t4: number,
): ClockSample {
  const rtt = (t4 - t1) - (t3 - t2)
  const offset = ((t2 - t1) + (t3 - t4)) / 2
  return { rtt, offset }
}

/**
 * Dado um array de amostras, retorna o offset da amostra com menor RTT.
 * Com menor RTT a estimativa tem menor margem de erro.
 */
export function selectBestOffset(samples: ClockSample[]): number {
  if (samples.length === 0) return 0
  let best = samples[0]
  for (const s of samples) {
    if (s.rtt < best.rtt) best = s
  }
  return best.offset
}
