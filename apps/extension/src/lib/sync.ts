// src/lib/sync.ts
// Portado de apps/web/src/lib/sync.ts.
// Adaptacao: mediaType expandido para cobrir todos os servicos de streaming
// (a extensao nao distingue youtube/mp4 pelo mesmo criterio do web app).

export type SyncDecision =
  | { action: 'ignore' }
  | { action: 'adjust-rate'; rate: number }
  | { action: 'seek'; targetSecs: number }

/** Drift abaixo deste limiar e ignorado (sem acao) */
const IGNORE_THRESHOLD_SECS = 0.3
/** Drift acima deste limiar exige seek imediato */
const SEEK_THRESHOLD_SECS = 0.5
/** Taxa de aceleração para recuperar atraso */
const CATCH_UP_RATE = 1.06
/** Taxa de desaceleracao para reduzir adiantamento */
const SLOW_DOWN_RATE = 0.94

/**
 * Tipo de servico de streaming para fins de decisao de sync.
 *
 * - 'native-html5': Netflix, Prime Video, Disney+, Max, Hulu, Crunchyroll,
 *                   Apple TV+, Paramount+ (todos usam HTMLVideoElement nativo
 *                   e suportam playbackRate arbitrario).
 * - 'youtube': YouTube via elemento <video> nativo (playbackRate discreto;
 *              evitar adjust-rate).
 */
export type StreamingServiceType = 'youtube' | 'native-html5'

/**
 * Decide a acao de correcao com base no drift entre posicao atual e esperada.
 *
 * drift = currentPositionSecs - expectedPositionSecs
 *   drift > 0: cliente adiantado (reproduzindo mais rapido que o esperado)
 *   drift < 0: cliente atrasado
 *
 * Regras:
 *   |drift| < IGNORE_THRESHOLD              -> ignore
 *   IGNORE_THRESHOLD <= |drift| < SEEK_THRESHOLD e youtube -> ignore
 *   IGNORE_THRESHOLD <= |drift| < SEEK_THRESHOLD e native-html5 -> adjust-rate
 *   |drift| >= SEEK_THRESHOLD              -> seek para expectedPositionSecs
 */
export function decideSyncAction(
  currentPositionSecs: number,
  expectedPositionSecs: number,
  serviceType: StreamingServiceType,
): SyncDecision {
  const drift = currentPositionSecs - expectedPositionSecs
  const absDrift = Math.abs(drift)

  if (absDrift < IGNORE_THRESHOLD_SECS) {
    return { action: 'ignore' }
  }

  if (absDrift >= SEEK_THRESHOLD_SECS) {
    return { action: 'seek', targetSecs: expectedPositionSecs }
  }

  // Faixa intermediaria: IGNORE_THRESHOLD <= absDrift < SEEK_THRESHOLD
  if (serviceType === 'youtube') {
    // YouTube nao suporta playbackRate arbitrario de forma confiavel
    return { action: 'ignore' }
  }

  const rate = drift > 0 ? SLOW_DOWN_RATE : CATCH_UP_RATE
  return { action: 'adjust-rate', rate }
}
