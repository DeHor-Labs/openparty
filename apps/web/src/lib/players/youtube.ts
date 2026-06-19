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
  getDuration(): number
  setPlaybackRate(rate: number): void
  destroy(): void
}

let apiLoaded = false
let apiPromise: Promise<void> | null = null

/** Tempo maximo esperando a API do YouTube carregar antes de rejeitar */
const YOUTUBE_API_TIMEOUT_MS = 10_000

function loadYouTubeApi(): Promise<void> {
  if (apiLoaded) return Promise.resolve()
  if (apiPromise) return apiPromise

  apiPromise = new Promise((resolve, reject) => {
    let timeoutHandle: ReturnType<typeof setTimeout> | null = null

    // Cancela o timeout e marca como carregado ao resolver
    function onReady() {
      if (timeoutHandle !== null) {
        clearTimeout(timeoutHandle)
        timeoutHandle = null
      }
      apiLoaded = true
      resolve()
    }

    // Rejeita a promise e limpa o singleton para permitir nova tentativa
    function onFailed(reason: string) {
      if (timeoutHandle !== null) {
        clearTimeout(timeoutHandle)
        timeoutHandle = null
      }
      apiPromise = null
      reject(new Error(reason))
    }

    // Timeout de seguranca: rejeita se a API nao carregar a tempo
    timeoutHandle = setTimeout(() => {
      onFailed('YouTube IFrame API nao carregou dentro do tempo limite')
    }, YOUTUBE_API_TIMEOUT_MS)

    // Caso o script ja esteja no DOM e a API ja esteja pronta
    const existingScript = document.querySelector('script[src*="youtube.com/iframe_api"]') as HTMLScriptElement | null
    if (existingScript) {
      if (window.YT?.Player) {
        onReady()
        return
      }
      // Script esta no DOM mas window.YT ainda nao carregou.
      // Encadeia no callback global sem adicionar novo script.
      // Registra onerror no script existente para rejeitar se ele falhar.
      const prevError = existingScript.onerror
      existingScript.onerror = (event) => {
        prevError?.call(existingScript, event)
        onFailed('Falha ao carregar o script da YouTube IFrame API (script existente)')
      }
      const prevReady = window.onYouTubeIframeAPIReady
      window.onYouTubeIframeAPIReady = () => {
        prevReady?.()
        onReady()
      }
      return
    }

    // Primeiro carregamento: injeta o script e aguarda o callback global
    window.onYouTubeIframeAPIReady = () => {
      onReady()
    }

    const script = document.createElement('script')
    script.src = 'https://www.youtube.com/iframe_api'

    // Handler de erro: rejeita se o script falhar ao carregar
    script.onerror = () => {
      onFailed('Falha ao carregar o script da YouTube IFrame API')
    }

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
      getDuration: () => ytPlayer.getDuration(),
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
