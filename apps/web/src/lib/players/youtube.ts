import type { PlayerAdapter, PlayerEventName } from './index'

// O IFrame API do YouTube eh carregado via script global; typings minimos inline
// para nao depender de @types/youtube (evita conflito em projetos sem DOM completo).
declare global {
  interface Window {
    YT: {
      Player: new (
        container: HTMLElement,
        options: YTPlayerOptions
      ) => YTPlayer
      PlayerState: {
        PLAYING: number
        PAUSED: number
        BUFFERING: number
        ENDED: number
      }
    }
    onYouTubeIframeAPIReady?: () => void
  }
}

interface YTPlayerOptions {
  videoId: string
  playerVars?: Record<string, unknown>
  events?: {
    onReady?: (event: { target: YTPlayer }) => void
    onStateChange?: (event: { data: number }) => void
    onError?: () => void
  }
}

interface YTPlayer {
  playVideo(): void
  pauseVideo(): void
  seekTo(secs: number, allowSeekAhead: boolean): void
  getCurrentTime(): number
  setPlaybackRate(rate: number): void
  destroy(): void
}

let apiLoaded = false
let apiPromise: Promise<void> | null = null

function loadYouTubeApi(): Promise<void> {
  if (apiLoaded) return Promise.resolve()
  if (apiPromise) return apiPromise

  apiPromise = new Promise((resolve) => {
    window.onYouTubeIframeAPIReady = () => {
      apiLoaded = true
      resolve()
    }

    if (document.querySelector('script[src*="youtube.com/iframe_api"]')) {
      // Script ja no DOM; checar se API ja disponivel
      if (window.YT?.Player) {
        apiLoaded = true
        resolve()
      }
      return
    }

    const script = document.createElement('script')
    script.src = 'https://www.youtube.com/iframe_api'
    document.head.appendChild(script)
  })

  return apiPromise
}

/**
 * Taxas de reproducao suportadas pelo YouTube IFrame API.
 * setPlaybackRate aproxima para o valor discreto mais proximo.
 */
const SUPPORTED_RATES = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 1.75, 2]

function nearestSupportedRate(rate: number): number {
  return SUPPORTED_RATES.reduce((prev, curr) =>
    Math.abs(curr - rate) < Math.abs(prev - rate) ? curr : prev
  )
}

/**
 * Cria um PlayerAdapter carregando o YouTube IFrame Player na `container`.
 * Retorna Promise pois a API do YouTube eh assincrona.
 */
export async function createYouTubeAdapter(
  container: HTMLElement,
  videoId: string
): Promise<PlayerAdapter> {
  await loadYouTubeApi()

  return new Promise((resolve) => {
    const handlers = new Map<PlayerEventName, Set<() => void>>()

    function emit(event: PlayerEventName): void {
      handlers.get(event)?.forEach((h) => h())
    }

    const ytPlayer = new window.YT.Player(container, {
      videoId,
      playerVars: {
        autoplay: 0,
        controls: 0,
        disablekb: 1,
        modestbranding: 1,
        rel: 0,
      },
      events: {
        onReady: () => {
          emit('ready')
          resolve(adapter)
        },
        onStateChange: (event) => {
          const { PLAYING, PAUSED, BUFFERING, ENDED } = window.YT.PlayerState
          if (event.data === PLAYING) emit('play')
          else if (event.data === PAUSED) emit('pause')
          else if (event.data === BUFFERING) emit('buffering')
          else if (event.data === ENDED) emit('ended')
        },
        onError: () => emit('error'),
      },
    })

    const adapter: PlayerAdapter = {
      play: () => {
        ytPlayer.playVideo()
        return Promise.resolve()
      },
      pause: () => {
        ytPlayer.pauseVideo()
        return Promise.resolve()
      },
      seekTo: (secs: number) => {
        ytPlayer.seekTo(secs, true)
        return Promise.resolve()
      },
      getCurrentTime: () => ytPlayer.getCurrentTime(),
      setPlaybackRate: (rate: number) => {
        ytPlayer.setPlaybackRate(nearestSupportedRate(rate))
      },
      on: (event: PlayerEventName, handler: () => void) => {
        if (!handlers.has(event)) handlers.set(event, new Set())
        handlers.get(event)!.add(handler)
      },
      off: (event: PlayerEventName, handler: () => void) => {
        handlers.get(event)?.delete(handler)
      },
      destroy: () => {
        handlers.clear()
        ytPlayer.destroy()
      },
    }
  })
}
