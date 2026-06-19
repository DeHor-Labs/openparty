export { createYouTubeAdapter } from './youtube'
export { createHtml5Adapter } from './html5'

export type MediaType = 'youtube' | 'mp4'

export type PlayerEventName =
  | 'play'
  | 'pause'
  | 'seek'
  | 'ended'
  | 'error'
  | 'buffering'
  | 'ready'

export interface PlayerAdapter {
  play(): Promise<void>
  pause(): Promise<void>
  /** Salta para o tempo em segundos */
  seekTo(secs: number): Promise<void>
  /** Retorna posicao atual em segundos */
  getCurrentTime(): number
  /** Define taxa de reproducao; no YouTube usa o valor discreto mais proximo */
  setPlaybackRate(rate: number): void
  /** Registra listener para evento do player */
  on(event: PlayerEventName, handler: () => void): void
  /** Remove listener */
  off(event: PlayerEventName, handler: () => void): void
  destroy(): void
}

/** Padrao de ID do YouTube: 11 caracteres alfanumericos + _ e - */
const YOUTUBE_ID_REGEX = /^[A-Za-z0-9_-]{11}$/

/**
 * Detecta o tipo de midia pela URL.
 *
 * YouTube: URLs com youtu.be, youtube.com, ou ID puro de 11 chars [A-Za-z0-9_-].
 * mp4: qualquer outra coisa (extensoes .mp4, .webm, .m3u8 ou URL generica).
 */
export function detectMediaType(url: string): MediaType {
  // ID puro de 11 chars
  if (YOUTUBE_ID_REGEX.test(url)) return 'youtube'

  try {
    const parsed = new URL(url)
    const hostname = parsed.hostname.toLowerCase()

    if (hostname === 'youtu.be') return 'youtube'
    if (hostname.includes('youtube.com')) return 'youtube'
  } catch {
    // url invalida ou relativa: tratar como mp4
  }

  return 'mp4'
}
