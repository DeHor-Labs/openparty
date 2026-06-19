// src/adapters/youtube.ts
// Adapter de YouTube para a extensao OpenParty.
//
// Controla o player via elemento <video> nativo da pagina youtube.com/watch.
// Nao usa a IFrame API porque o content script roda na propria pagina do YouTube,
// dando acesso direto ao HTMLVideoElement e aos eventos nativos.
//
// H2: suporte a navegacao SPA do YouTube (yt-navigate-finish / popstate).
// L2: emissao de ad-start/ad-end via MutationObserver na classList do player.

import type { AdapterEventName, PlaybackState, ServiceAdapter } from './interface'
import type { StreamingServiceType } from '../lib/sync'

/** Seletor do elemento video principal na pagina de watch */
const VIDEO_SELECTOR = 'video'

/** Seletor do container do player - usado para detectar estado de anuncio */
const PLAYER_SELECTOR = '.html5-video-player'

/** Classe CSS presente no player quando um anuncio esta em exibicao */
const AD_CLASS = 'ad-showing'

/** Mapeamento de eventos nativos do video para AdapterEventName */
const NATIVE_TO_ADAPTER: Record<string, AdapterEventName> = {
  play: 'play',
  pause: 'pause',
  seeked: 'seek',
  waiting: 'buffering',
  ended: 'ended',
}

/** Tempo maximo de espera por um <video> em navegacao SPA (ms) */
const VIDEO_WAIT_TIMEOUT_MS = 5_000

/** Intervalo de pooling do MutationObserver fallback (ms) */
const VIDEO_POLL_INTERVAL_MS = 250

/**
 * Retorna true se o player esta exibindo um anuncio agora.
 * Detectado pela classe CSS `.ad-showing` no container `.html5-video-player`.
 */
function detectarAnuncio(): boolean {
  const player = document.querySelector(PLAYER_SELECTOR)
  return player?.classList.contains(AD_CLASS) ?? false
}

/**
 * Aguarda o elemento <video> aparecer no DOM por ate VIDEO_WAIT_TIMEOUT_MS ms.
 * Usa MutationObserver para eficiencia; faz fallback para polling se necessario.
 * Retorna null se o video nao aparecer dentro do prazo.
 */
async function aguardarVideo(): Promise<HTMLVideoElement | null> {
  const existente = document.querySelector<HTMLVideoElement>(VIDEO_SELECTOR)
  if (existente) return existente

  return new Promise<HTMLVideoElement | null>((resolve) => {
    let timeoutId: ReturnType<typeof setTimeout> | null = null
    let pollingId: ReturnType<typeof setInterval> | null = null
    let observer: MutationObserver | null = null

    const cleanup = (): void => {
      if (timeoutId !== null) { clearTimeout(timeoutId); timeoutId = null }
      if (pollingId !== null) { clearInterval(pollingId); pollingId = null }
      observer?.disconnect()
      observer = null
    }

    const encontrou = (video: HTMLVideoElement): void => {
      cleanup()
      resolve(video)
    }

    // MutationObserver como mecanismo primario
    observer = new MutationObserver(() => {
      const v = document.querySelector<HTMLVideoElement>(VIDEO_SELECTOR)
      if (v) encontrou(v)
    })
    observer.observe(document.body, { childList: true, subtree: true })

    // Polling como fallback
    pollingId = setInterval(() => {
      const v = document.querySelector<HTMLVideoElement>(VIDEO_SELECTOR)
      if (v) encontrou(v)
    }, VIDEO_POLL_INTERVAL_MS)

    // Timeout: desiste apos VIDEO_WAIT_TIMEOUT_MS
    timeoutId = setTimeout(() => {
      cleanup()
      resolve(null)
    }, VIDEO_WAIT_TIMEOUT_MS)
  })
}

/**
 * Cria o adapter de YouTube conectando ao elemento <video> nativo.
 *
 * Retorna null se nenhum elemento video for encontrado na pagina
 * (ex: pagina inicial do YouTube, sem video carregado ainda).
 *
 * H2: Observa navegacao SPA (yt-navigate-finish + popstate) para
 * re-resolver o <video> e religar os listeners quando o YouTube troca
 * de video sem recarregar a pagina.
 */
export async function createYouTubeAdapter(): Promise<ServiceAdapter | null> {
  const video = await aguardarVideo()
  if (!video) return null

  // Mapa de listeners: AdapterEventName -> lista de handlers do usuario
  const listenerMap = new Map<AdapterEventName, Set<() => void>>()

  // Handlers nativos registrados no video - guardados para remocao no destroy()
  let nativeHandlers = new Map<string, EventListener>()

  // Estado de anuncio anterior (para MutationObserver L2)
  let eraAnuncio = detectarAnuncio()

  // Observer para ad-start/ad-end (L2)
  let adObserver: MutationObserver | null = null

  // Referencia ao elemento video atual (pode mudar em navegacao SPA)
  let videoAtual: HTMLVideoElement = video

  /**
   * Emite um evento para todos os handlers registrados.
   */
  function emit(event: AdapterEventName): void {
    const callbacks = listenerMap.get(event)
    if (!callbacks) return
    for (const cb of callbacks) {
      cb()
    }
  }

  /**
   * Remove todos os handlers nativos do elemento video atual.
   */
  function removerHandlersNativos(): void {
    for (const [nativeEvent, handler] of nativeHandlers) {
      videoAtual.removeEventListener(nativeEvent, handler)
    }
    nativeHandlers = new Map()
  }

  /**
   * Registra handlers nativos no elemento video.
   */
  function registrarHandlersNativos(el: HTMLVideoElement): void {
    removerHandlersNativos()
    videoAtual = el

    const novosHandlers = new Map<string, EventListener>()

    for (const [nativeEvent, adapterEvent] of Object.entries(NATIVE_TO_ADAPTER)) {
      const handler: EventListener = () => {
        emit(adapterEvent)
      }
      novosHandlers.set(nativeEvent, handler)
      el.addEventListener(nativeEvent, handler)
    }

    nativeHandlers = novosHandlers
  }

  /**
   * L2: Configura MutationObserver para detectar transicoes de anuncio
   * via mudancas na classList do `.html5-video-player`.
   */
  function configurarAdObserver(): void {
    adObserver?.disconnect()
    const player = document.querySelector(PLAYER_SELECTOR)
    if (!player) return

    adObserver = new MutationObserver(() => {
      const isAnuncio = detectarAnuncio()
      if (isAnuncio && !eraAnuncio) {
        eraAnuncio = true
        emit('ad-start')
      } else if (!isAnuncio && eraAnuncio) {
        eraAnuncio = false
        emit('ad-end')
      }
    })

    adObserver.observe(player, { attributes: true, attributeFilter: ['class'] })
  }

  /**
   * H2: Callback chamado quando o YouTube navega para um novo video via SPA.
   * Re-resolve o <video> e reconfigura todos os listeners.
   */
  async function onSpaNavegacao(): Promise<void> {
    removerHandlersNativos()

    const novoVideo = await aguardarVideo()
    if (!novoVideo) {
      console.warn('[OpenParty YouTube] novo video nao encontrado apos navegacao SPA')
      return
    }

    registrarHandlersNativos(novoVideo)
    configurarAdObserver()
    console.debug('[OpenParty YouTube] adapter re-ligado apos navegacao SPA')
  }

  // H2: registra listeners de navegacao SPA
  const spaListener = (): void => {
    onSpaNavegacao().catch((err) => {
      console.warn('[OpenParty YouTube] erro ao religar adapter apos SPA:', err)
    })
  }

  window.addEventListener('yt-navigate-finish', spaListener)
  window.addEventListener('popstate', spaListener)

  // Inicializa handlers no video encontrado
  registrarHandlersNativos(video)
  configurarAdObserver()

  const adapter: ServiceAdapter = {
    async play(): Promise<void> {
      await videoAtual.play()
    },

    async pause(): Promise<void> {
      videoAtual.pause()
    },

    async seekTo(secs: number): Promise<void> {
      videoAtual.currentTime = secs
    },

    getCurrentTime(): number {
      return videoAtual.currentTime
    },

    getDuration(): number {
      const d = videoAtual.duration
      return Number.isFinite(d) ? d : 0
    },

    isAd(): boolean {
      return detectarAnuncio()
    },

    getPlaybackState(): PlaybackState {
      if (detectarAnuncio()) return 'ad'
      if (!videoAtual.paused) return 'playing'
      return 'paused'
    },

    getServiceType(): StreamingServiceType {
      return 'youtube'
    },

    on(event: AdapterEventName, handler: () => void): void {
      if (!listenerMap.has(event)) {
        listenerMap.set(event, new Set())
      }
      listenerMap.get(event)!.add(handler)
    },

    off(event: AdapterEventName, handler: () => void): void {
      listenerMap.get(event)?.delete(handler)
    },

    destroy(): void {
      // Remove handlers nativos do video
      removerHandlersNativos()

      // L2: desconecta o observer de anuncio
      adObserver?.disconnect()
      adObserver = null

      // H2: remove listeners de navegacao SPA
      window.removeEventListener('yt-navigate-finish', spaListener)
      window.removeEventListener('popstate', spaListener)

      listenerMap.clear()
    },
  }

  return adapter
}
