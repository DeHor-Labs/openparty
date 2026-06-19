import type { RoomState } from '@openparty/protocol'

/**
 * Calcula a posicao atual em segundos com base no estado imutavel da sala.
 * Aceita serverNow opcional para facilitar testes deterministicos;
 * em producao, o handler passa Date.now() do servidor.
 */
export function computeCurrentPosition(state: RoomState, serverNow?: number): number {
  if (!state.playing) {
    return state.positionSecs
  }

  const now = serverNow ?? Date.now()
  const elapsedMs = Math.max(0, now - state.lastEventAt)
  const elapsedSecs = (elapsedMs / 1000) * state.playbackRate

  return state.positionSecs + elapsedSecs
}

/**
 * Retorna novo RoomState apos evento play.
 * O campo `time` vem do cliente (posicao confirmada pelo host).
 * `serverNow` e Date.now() do servidor no momento do processamento.
 */
export function applyPlay(state: RoomState, time: number, serverNow: number): RoomState {
  return {
    ...state,
    playing: true,
    positionSecs: time,
    lastEventAt: serverNow,
  }
}

/**
 * Retorna novo RoomState apos evento pause.
 */
export function applyPause(state: RoomState, time: number, serverNow: number): RoomState {
  return {
    ...state,
    playing: false,
    positionSecs: time,
    lastEventAt: serverNow,
  }
}

/**
 * Retorna novo RoomState apos evento seek.
 * Preserva o estado playing - seek nao altera reproducao, apenas posicao.
 */
export function applySeek(state: RoomState, time: number, serverNow: number): RoomState {
  return {
    ...state,
    positionSecs: time,
    lastEventAt: serverNow,
  }
}
