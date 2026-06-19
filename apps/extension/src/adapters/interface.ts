// src/adapters/interface.ts
// Contrato comum para todos os adapters de servico de streaming.
// Superset da interface PlayerAdapter de apps/web/src/lib/players/index.ts.

/**
 * Eventos emitidos pelo adapter para o content script.
 * Extensao de PlayerEventName com ad-start e ad-end.
 */
export type AdapterEventName =
  | 'play'
  | 'pause'
  | 'seek'
  | 'buffering'
  | 'ended'
  | 'ready'
  | 'error'
  | 'ad-start'
  | 'ad-end'

/** Estado de reproducao retornado por getPlaybackState() */
export type PlaybackState = 'playing' | 'paused' | 'buffering' | 'ad' | 'unknown'

/**
 * Contrato comum para adapters de servicos de streaming.
 *
 * Cada servico (Netflix, YouTube, Prime Video, etc.) implementa esta interface
 * encapsulando o elemento <video> nativo e os seletores especificos da plataforma.
 */
export interface ServiceAdapter {
  /** Inicia reproducao no player nativo */
  play(): Promise<void>
  /** Pausa reproducao no player nativo */
  pause(): Promise<void>
  /** Salta para `secs` segundos no player nativo */
  seekTo(secs: number): Promise<void>
  /** Retorna posicao atual em segundos */
  getCurrentTime(): number
  /** Retorna duracao total em segundos (0 se desconhecida ou nao carregada) */
  getDuration(): number
  /** Retorna true se o player esta atualmente exibindo um anuncio */
  isAd(): boolean
  /** Retorna o estado atual do player */
  getPlaybackState(): PlaybackState
  /** Registra listener para evento do player */
  on(event: AdapterEventName, handler: () => void): void
  /** Remove listener registrado anteriormente */
  off(event: AdapterEventName, handler: () => void): void
  /** Libera recursos, remove listeners e desconecta MutationObserver */
  destroy(): void
}

/**
 * Factory que tenta localizar e conectar ao elemento de video na pagina.
 * Retorna null se nao encontrar apos N tentativas ou timeout.
 */
export type AdapterFactory = () => Promise<ServiceAdapter | null>
