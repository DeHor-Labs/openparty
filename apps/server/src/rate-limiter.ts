// apps/server/src/rate-limiter.ts
//
// Rate limiting por conexao com janela deslizante.
// Cada conexao WebSocket possui contadores independentes por tipo de acao.

// ---------------------------------------------------------------------------
// Constantes de limite (janela deslizante de RATE_WINDOW_MS)
// ---------------------------------------------------------------------------

/** Duracao da janela de rate limiting em milissegundos */
export const RATE_WINDOW_MS = 5000

/** Maximo de mensagens de chat por janela por conexao */
export const MAX_CHAT_PER_WINDOW = 10

/** Maximo de reacoes por janela por conexao */
export const MAX_REACTION_PER_WINDOW = 10

/** Maximo de eventos seek por janela por conexao */
export const MAX_SEEK_PER_WINDOW = 10

/**
 * Maximo de eventos de playback (play/pause unificados) por janela por conexao.
 * Uniforme para ambos os tipos: evita bypass alternando play <-> pause.
 * Previne amplificacao: cada play/pause e broadcast para N clientes,
 * portanto spam desses eventos tem custo linear no numero de participantes.
 */
export const MAX_PLAYBACK_PER_WINDOW = 10

/**
 * Maximo de clock-pings por janela por conexao.
 * Limite generoso pois pings sao frequentes durante calibracao (8 na inicial,
 * 3 na recalibracao), mas finito para evitar loop tight consumindo CPU do servidor.
 */
export const MAX_CLOCK_PING_PER_WINDOW = 60

/**
 * Maximo de eventos set-host-lock por janela por conexao.
 * Mesmo risco de amplificacao de broadcast do play/pause.
 */
export const MAX_HOST_LOCK_PER_WINDOW = 10

/** Tipos de acao sujeitos a rate limiting */
export type RateLimitedAction = 'chat' | 'reaction' | 'seek' | 'playback' | 'clock-ping' | 'host-lock'

// ---------------------------------------------------------------------------
// Mapa de limites por tipo de acao
// ---------------------------------------------------------------------------

const ACTION_LIMITS: Record<RateLimitedAction, number> = {
  chat: MAX_CHAT_PER_WINDOW,
  reaction: MAX_REACTION_PER_WINDOW,
  seek: MAX_SEEK_PER_WINDOW,
  playback: MAX_PLAYBACK_PER_WINDOW,
  'clock-ping': MAX_CLOCK_PING_PER_WINDOW,
  'host-lock': MAX_HOST_LOCK_PER_WINDOW,
}

// ---------------------------------------------------------------------------
// Store em memoria: connId -> acao -> timestamps de mensagens na janela
// ---------------------------------------------------------------------------

const store = new Map<string, Map<RateLimitedAction, number[]>>()

function getOrCreateActionMap(connId: string): Map<RateLimitedAction, number[]> {
  let actionMap = store.get(connId)
  if (!actionMap) {
    actionMap = new Map()
    store.set(connId, actionMap)
  }
  return actionMap
}

// ---------------------------------------------------------------------------
// API publica
// ---------------------------------------------------------------------------

/**
 * Verifica se a conexao `connId` pode enviar uma mensagem do tipo `action` no instante `now`.
 *
 * Retorna `true` se a mensagem e permitida (e registra o timestamp).
 * Retorna `false` se o limite da janela foi atingido (mensagem deve ser descartada).
 *
 * O contador e por tipo de acao e por conexao, de forma independente.
 */
export function applyRateLimit(
  connId: string,
  action: RateLimitedAction,
  now: number
): boolean {
  const actionMap = getOrCreateActionMap(connId)

  const timestamps = actionMap.get(action) ?? []

  // Remove timestamps fora da janela atual
  const limiteInferior = now - RATE_WINDOW_MS
  const dentro = timestamps.filter((t) => t > limiteInferior)

  const limite = ACTION_LIMITS[action]

  if (dentro.length >= limite) {
    // Limite atingido - atualiza o array limpo sem o novo timestamp
    actionMap.set(action, dentro)
    return false
  }

  // Permite e registra o timestamp atual
  dentro.push(now)
  actionMap.set(action, dentro)
  return true
}

/**
 * Remove o registro de rate limiting de uma conexao.
 * Deve ser chamado quando a conexao e encerrada para evitar vazamento de memoria.
 * Tambem util em testes para resetar estado entre casos.
 */
export function resetRateLimit(connId: string): void {
  store.delete(connId)
}
