export type SyncDecision =
  | { action: 'ignore' }
  | { action: 'adjust-rate'; rate: number }
  | { action: 'seek'; targetSecs: number }

/** Limiar abaixo do qual o drift e ignorado (segundos) */
const IGNORE_THRESHOLD = 0.3
/** Limiar acima do qual o drift exige seek imediato (segundos) */
const SEEK_THRESHOLD = 0.5
/** Taxa de reproducao usada para alcançar o servidor quando o cliente esta atrasado */
const CATCH_UP_RATE = 1.06
/** Taxa de reproducao usada para desacelerar quando o cliente esta adiantado */
const SLOW_DOWN_RATE = 0.94

/**
 * Decide a acao de correcao com base no desvio entre posicao atual e esperada.
 *
 * drift = currentPositionSecs - expectedPositionSecs
 *   drift > 0: cliente esta adiantado (reproduzindo mais rapido que o servidor esperaria)
 *   drift < 0: cliente esta atrasado
 *
 * Regras:
 *   |drift| < IGNORE_THRESHOLD              -> ignore
 *   IGNORE_THRESHOLD <= |drift| < SEEK_THRESHOLD e mp4 -> adjust-rate
 *   IGNORE_THRESHOLD <= |drift| < SEEK_THRESHOLD e youtube -> ignore
 *   |drift| >= SEEK_THRESHOLD              -> seek para expectedPositionSecs
 */
export function decideSyncAction(
  currentPositionSecs: number,
  expectedPositionSecs: number,
  mediaType: 'youtube' | 'mp4'
): SyncDecision {
  const drift = currentPositionSecs - expectedPositionSecs
  const absDrift = Math.abs(drift)

  if (absDrift < IGNORE_THRESHOLD) {
    return { action: 'ignore' }
  }

  if (absDrift >= SEEK_THRESHOLD) {
    return { action: 'seek', targetSecs: expectedPositionSecs }
  }

  // Faixa media: IGNORE_THRESHOLD <= absDrift < SEEK_THRESHOLD
  if (mediaType === 'youtube') {
    // YouTube nao suporta playbackRate arbitrario; evitar adjust-rate
    return { action: 'ignore' }
  }

  // mp4: ajustar taxa para convergir suavemente
  const rate = drift > 0 ? SLOW_DOWN_RATE : CATCH_UP_RATE
  return { action: 'adjust-rate', rate }
}
