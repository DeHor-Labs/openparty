// src/adapters/appletv.ts
// Adapter do Apple TV+ para a extensao OpenParty.
//
// Controla o player via elemento <video> nativo em paginas tv.apple.com/play/* e
// rotas de episodio. Nao usa nenhuma API privada da Apple - apenas HTMLVideoElement padrao.
//
// Heuristica de selecao do <video>:
//   1. Seletor especifico do container do player:
//      `.default-media-player video`
//      Validado por area minima para excluir previews de hover do catalogo.
//   2. Fallback: `[data-testid="transport-controls-container"] ~ * video`
//      (area lateral de controles do player; menos confiavel)
//   3. Fallback final: todos os elementos <video> da pagina, filtrados por:
//      - readyState >= HAVE_METADATA (2): duracao conhecida
//      - Maior duracao (conteudo principal sempre tem duracao > trailers)
//      - Maior area renderizada (offsetWidth * offsetHeight)
//      A area minima de VIDEO_AREA_MINIMA_PX2 descarta thumbnails e previews.
//
// Navegacao SPA:
//   O Apple TV+ e uma SPA; a troca de episodio ocorre via History API (pushState)
//   sem recarregar a pagina. Usamos dois mecanismos combinados:
//     - Listener em popstate (navegacao com back/forward)
//     - Polling leve de location.href a cada SPA_POLL_INTERVAL_MS, limpado no destroy()
//   O filtro de path e aplicado em ambos: reage apenas quando a URL contem
//   /play/ ou /en-US/episode/ ou /br/episode/ (rotas de reproducao conhecidas).
//
// Deteccao de anuncio:
//   O Apple TV+ NAO tem anuncios - e um servico de assinatura sem ad-tier.
//   isAd() retorna sempre false. O MutationObserver de ad e mantido como
//   scaffolding para conformidade com a interface, mas com lista de seletores
//   vazia; ele nunca dispara ad-start nem ad-end.
//
// Seletores pesquisados e validados (fontes: github.com/Dreamlinerm/Netflix-Prime-Auto-Skip,
// inspecao manual do DOM do Apple TV+, repositorios de extensoes de watch party):
//   - Video: `.default-media-player video` (container principal do player Apple TV+)
//   - Alternativo: `video.video-player`, `[class*="VideoPlayer"] video`
//   - Container do player: `.default-media-player`, `.media-player-container`
//   - Rotas de player: /play/, /en-US/episode/, /br/episode/, /us/episode/,
//     /gb/episode/, /au/episode/, /<locale>/episode/
//   - Apple TV+ usa `<video>` HTML5 nativo com DRM FairPlay (nao contornamos o DRM -
//     apenas controlamos o elemento legitimo que a pagina ja expoe).
//
// NOTA DE COBERTURA: O adapter foca em tv.apple.com. Caminhos de locale variam
// (en-US, en-us, br, gb, au). O gate de path por regex (case-insensitive)
// /\/(?:play(?:\/|$)|[a-z]{2}(?:-[a-z]{2})?\/episode\/)/i cobre os formatos
// conhecidos e tolera browsers que normalizam locales para lowercase.
//
// LIMITACAO CONHECIDA: O Apple TV+ pode alterar a estrutura do DOM do player
// em atualizacoes. O seletor `.default-media-player video` e o mais estavel
// observado, mas o fallback por maior area serve como resguardo.

import type { AdapterEventName, PlaybackState, ServiceAdapter } from './interface'
import type { StreamingServiceType } from '../lib/sync'

// ---------------------------------------------------------------------------
// Constantes
// ---------------------------------------------------------------------------

/** Seletor preferencial: container principal do player Apple TV+ */
const VIDEO_SELETOR_PRIMARIO = '.default-media-player video'

/** Seletor alternativo: classe generica do player de video */
const VIDEO_SELETOR_ALT = 'video.video-player'

/** Seletor fallback final: qualquer <video> na pagina */
const VIDEO_SELETOR_FALLBACK = 'video'

/** Container geral do player (usado para o MutationObserver de anuncio) */
const PLAYER_CONTAINER_SELETOR = '.default-media-player'

/** readyState minimo para considerar o <video> com metadados carregados */
const HAVE_METADATA = 2

/** Area minima (pixels quadrados) para considerar o <video> como player principal */
const VIDEO_AREA_MINIMA_PX2 = 40_000 // ~200x200px - descarta previews de hover

/** Tempo maximo de espera pelo <video> aparecer no DOM (ms) */
const VIDEO_WAIT_TIMEOUT_MS = 8_000

/** Intervalo de polling interno do aguardarVideo (ms) */
const VIDEO_POLL_INTERVAL_MS = 300

/** Intervalo de polling para detectar navegacao SPA via pushState (ms) */
const SPA_POLL_INTERVAL_MS = 800

/**
 * Atraso minimo antes de re-selecionar o <video> apos navegacao SPA.
 * Evita retornar o elemento antigo que ainda permanece no DOM nos primeiros
 * 100-300ms apos a transicao de conteudo.
 */
const SPA_RENAVIGATE_DELAY_MS = 150

/**
 * Regex que identifica URLs de reproducao do Apple TV+.
 * Cobre:
 *   - tv.apple.com/play/* (rota canonica de reproducao)
 *   - tv.apple.com/us/episode/* (e outros locales: br, gb, au, de, fr, etc.)
 *   - tv.apple.com/en-US/episode/* (locale com regiao)
 * Exemplos validos:
 *   /play/episode/umc.cmc.xxxxx
 *   /us/episode/nome-do-episodio/umc.cmc.xxxxx
 *   /en-US/episode/nome-do-episodio/umc.cmc.xxxxx
 *   /br/episode/nome-do-episodio/umc.cmc.xxxxx
 */
const SPA_PATH_REGEX = /\/(?:play(?:\/|$)|[a-z]{2}(?:-[a-z]{2})?\/episode\/)/i

/**
 * Seletores de anuncio do Apple TV+ (lista vazia - sem anuncios no servico).
 * Mantida para conformidade com a interface e facilitar adicao futura.
 */
const AD_SELETORES: string[] = []

/** Mapeamento de eventos nativos do <video> para AdapterEventName */
const NATIVE_TO_ADAPTER: Record<string, AdapterEventName> = {
  play: 'play',
  pause: 'pause',
  seeked: 'seek',
  waiting: 'buffering',
  ended: 'ended',
}

// ---------------------------------------------------------------------------
// Utilitarios internos
// ---------------------------------------------------------------------------

/**
 * Retorna true se o pathname atual e de uma rota de reproducao do Apple TV+.
 * Usado como gate para evitar selecionar video fora do player (catalogo, home).
 *
 * Formatos cobertos:
 *   /play/*          - rota canonica de reproducao
 *   /us/episode/*    - locale simples (us, br, gb, au, de, fr...)
 *   /en-US/episode/* - locale com regiao (case-insensitive: en-us e en-US ambos passam)
 */
function eRotaDePlayer(): boolean {
  const pathname = new URL(location.href).pathname
  return SPA_PATH_REGEX.test(pathname)
}

/**
 * Verifica se um elemento <video> tem area de renderizacao suficiente para
 * ser considerado o player principal (descarta previews de hover do catalogo).
 *
 * Usa getBoundingClientRect para obter dimensoes reais renderizadas,
 * mais preciso que offsetWidth/offsetHeight para elementos transformados.
 */
function videoTemAreaSuficiente(v: HTMLVideoElement): boolean {
  const rect = v.getBoundingClientRect()
  return rect.width * rect.height >= VIDEO_AREA_MINIMA_PX2
}

/**
 * Seleciona o elemento <video> principal do player Apple TV+.
 *
 * Heuristica em ordem de prioridade:
 * 1. `.default-media-player video` - container principal do player
 *    Validado por area minima para excluir previews de hover.
 * 2. `video.video-player` - classe generica do player
 * 3. Entre todos os <video> da pagina com area suficiente, escolhe o de maior duracao
 * 4. Entre todos os <video> da pagina, escolhe o de maior area renderizada
 *
 * Retorna null se nenhum <video> adequado for encontrado.
 */
function selecionarVideoAppleTv(): HTMLVideoElement | null {
  // Gate de path: so seleciona em rota de reproducao do Apple TV+.
  // Sem este guard, o adapter montaria em paginas de catalogo/home/store
  // onde qualquer <video> grande (ex: trailer em autoplay) seria capturado.
  if (!eRotaDePlayer()) return null

  // Tentativa 1: container principal do player
  const primario = document.querySelector<HTMLVideoElement>(VIDEO_SELETOR_PRIMARIO)
  if (primario && videoTemAreaSuficiente(primario)) return primario

  // Tentativa 2: classe generica do player de video
  const alt = document.querySelector<HTMLVideoElement>(VIDEO_SELETOR_ALT)
  if (alt && videoTemAreaSuficiente(alt)) return alt

  // Tentativa 3 e 4: entre todos os videos, filtra e escolhe o mais adequado
  const todos = Array.from(document.querySelectorAll<HTMLVideoElement>(VIDEO_SELETOR_FALLBACK))
  if (todos.length === 0) return null

  // Filtra por area minima antes de aplicar heuristica de duracao
  const comAreaSuficiente = todos.filter(videoTemAreaSuficiente)
  const candidatos = comAreaSuficiente.length > 0 ? comAreaSuficiente : todos

  if (candidatos.length === 1) return candidatos[0]

  // Prioriza videos com duracao conhecida (conteudo principal vs trailers)
  const comDuracao = candidatos.filter(
    (v) => v.readyState >= HAVE_METADATA && Number.isFinite(v.duration) && v.duration > 0,
  )
  if (comDuracao.length > 0) {
    // Entre os com duracao, escolhe o de maior duracao (conteudo > trailer)
    return comDuracao.reduce((melhor, atual) => (atual.duration > melhor.duration ? atual : melhor))
  }

  // Fallback: video com maior area renderizada
  const comArea = candidatos.filter((v) => v.offsetWidth > 0 && v.offsetHeight > 0)
  if (comArea.length > 0) {
    return comArea.reduce((melhor, atual) =>
      atual.offsetWidth * atual.offsetHeight > melhor.offsetWidth * melhor.offsetHeight ? atual : melhor,
    )
  }

  // Ultimo recurso: primeiro candidato da lista
  return candidatos[0] ?? null
}

/**
 * Retorna true se o elemento esta visivel no viewport de forma confiavel.
 *
 * Impede que um elemento oculto (display:none, visibility:hidden, opacity:0
 * ou sem layout) dispare isAd() incorretamente, prendendo o sync em modo
 * de anuncio sem razao.
 */
function elementoVisivel(el: Element): boolean {
  const style = getComputedStyle(el)
  if (style.display === 'none') return false
  if (style.visibility === 'hidden') return false
  if (style.opacity === '0') return false
  if (el.getClientRects().length === 0) return false
  return true
}

/**
 * Retorna true se o player Apple TV+ esta exibindo um anuncio no momento.
 *
 * O Apple TV+ NAO tem anuncios. Esta funcao retorna sempre false.
 * Mantida na interface por conformidade; a lista AD_SELETORES esta vazia.
 */
function detectarAnuncioAppleTv(): boolean {
  for (const seletor of AD_SELETORES) {
    const el = document.querySelector(seletor)
    if (el && elementoVisivel(el)) return true
  }
  return false
}

/**
 * Aguarda o elemento <video> principal do Apple TV+ aparecer no DOM.
 *
 * Usa MutationObserver como mecanismo primario e polling como fallback.
 * Respeita VIDEO_WAIT_TIMEOUT_MS antes de desistir e retornar null.
 * Aceita AbortSignal para cancelamento antecipado (destroy ou nova navegacao).
 */
async function aguardarVideoAppleTv(signal?: AbortSignal): Promise<HTMLVideoElement | null> {
  const existente = selecionarVideoAppleTv()
  if (existente) return existente

  return new Promise<HTMLVideoElement | null>((resolve) => {
    let timeoutId: ReturnType<typeof setTimeout> | null = null
    let pollingId: ReturnType<typeof setInterval> | null = null
    let observer: MutationObserver | null = null
    // Flag de idempotencia para evitar dupla resolucao
    let settled = false

    const cleanup = (): void => {
      if (timeoutId !== null) { clearTimeout(timeoutId); timeoutId = null }
      if (pollingId !== null) { clearInterval(pollingId); pollingId = null }
      observer?.disconnect()
      observer = null
      // Remove o listener de abort para evitar vazamento de referencia
      signal?.removeEventListener('abort', cancelar)
    }

    const encontrou = (video: HTMLVideoElement): void => {
      if (settled) return
      settled = true
      cleanup()
      resolve(video)
    }

    const cancelar = (): void => {
      if (settled) return
      settled = true
      cleanup()
      resolve(null)
    }

    // Abortar via signal (destroy ou nova navegacao)
    if (signal?.aborted) {
      resolve(null)
      return
    }
    signal?.addEventListener('abort', cancelar, { once: true })

    // MutationObserver como mecanismo primario
    observer = new MutationObserver(() => {
      if (signal?.aborted) return
      const v = selecionarVideoAppleTv()
      if (v) encontrou(v)
    })
    observer.observe(document.body, { childList: true, subtree: true })

    // Polling como fallback (necessario quando o MutationObserver e throttled)
    pollingId = setInterval(() => {
      if (signal?.aborted) return
      const v = selecionarVideoAppleTv()
      if (v) encontrou(v)
    }, VIDEO_POLL_INTERVAL_MS)

    // Timeout: desiste apos VIDEO_WAIT_TIMEOUT_MS
    timeoutId = setTimeout(() => {
      cleanup()
      resolve(null)
    }, VIDEO_WAIT_TIMEOUT_MS)
  })
}

// ---------------------------------------------------------------------------
// Factory principal
// ---------------------------------------------------------------------------

/**
 * Cria o adapter do Apple TV+ conectando ao elemento <video> nativo do player.
 *
 * Retorna null se nenhum elemento <video> adequado for encontrado na pagina
 * (ex: pagina inicial do Apple TV+, catalogo sem reproducao ativa).
 *
 * SPA: Detecta mudanca de URL (troca de episodio/conteudo) via polling de
 * location.href e via popstate. Ao detectar mudanca em path de player, re-resolve
 * o <video> e reconfigura todos os listeners.
 *
 * Anuncio: O Apple TV+ nao tem anuncios; isAd() retorna sempre false.
 * O MutationObserver de ad nao e criado quando AD_SELETORES esta vazio.
 */
export async function createAppleTvAdapter(): Promise<ServiceAdapter | null> {
  // Gate de entrada: nao instancia o adapter fora de rotas de reproducao.
  // Defesa em profundidade - selecionarVideoAppleTv() tambem tem este guard,
  // mas bloquear aqui evita que aguardarVideoAppleTv() fique em espera
  // desnecessaria (timeout de 8s) em paginas de catalogo ou home.
  if (!SPA_PATH_REGEX.test(new URL(location.href).pathname)) return null

  const video = await aguardarVideoAppleTv()
  if (!video) return null

  // Mapa de listeners: AdapterEventName -> conjunto de handlers do usuario
  const listenerMap = new Map<AdapterEventName, Set<() => void>>()

  // Handlers nativos registrados no video - guardados para remocao no destroy()
  let nativeHandlers = new Map<string, EventListener>()

  // Estado de anuncio anterior (para o MutationObserver de ad-start/ad-end)
  let eraAnuncio = detectarAnuncioAppleTv()

  // Observer para detectar transicao de anuncio (scaffolding; Apple TV+ nao tem anuncios)
  let adObserver: MutationObserver | null = null

  // Referencia ao elemento video atual (pode mudar em navegacao SPA)
  let videoAtual: HTMLVideoElement = video

  // URL atual - usada para detectar mudanca de episodio/conteudo via polling
  let urlAtual = location.href

  // ID do intervalo de polling de URL (SPA)
  let spaPollingId: ReturnType<typeof setInterval> | null = null

  // Token de sequencia incrementado a cada navegacao SPA.
  // Apos cada await em onSpaNavegacao, verificamos se o token ainda e o atual.
  // Se nao for, a navegacao foi superada por uma mais recente e devemos abortar.
  let navigationSeq = 0

  // AbortController da aguardarVideoAppleTv em andamento.
  // Cancelado no destroy() e em cada nova navegacao.
  let aguardarAbortController: AbortController | null = null

  // ---------------------------------------------------------------------------
  // Emissao de eventos
  // ---------------------------------------------------------------------------

  /**
   * Emite evento para todos os handlers registrados naquele nome de evento.
   */
  function emit(event: AdapterEventName): void {
    const callbacks = listenerMap.get(event)
    if (!callbacks) return
    for (const cb of callbacks) {
      cb()
    }
  }

  // ---------------------------------------------------------------------------
  // Gerenciamento de handlers nativos
  // ---------------------------------------------------------------------------

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
   * Registra handlers nativos no elemento video informado.
   * Limpa os handlers anteriores antes de registrar os novos.
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

  // ---------------------------------------------------------------------------
  // Deteccao de anuncio via MutationObserver
  // ---------------------------------------------------------------------------

  /**
   * Configura MutationObserver para detectar transicoes de anuncio.
   * No Apple TV+, os anuncios nao existem; este observer nunca dispara
   * ad-start nem ad-end, mas e mantido por conformidade com a interface.
   */
  function configurarAdObserver(): void {
    adObserver?.disconnect()

    // Guard: Apple TV+ nao tem anuncios - AD_SELETORES e vazio.
    // Sem este guard, o MutationObserver seria criado e dispararia a cada
    // mutacao do DOM sem nenhum efeito util, apenas consumindo ciclos de CPU.
    if (AD_SELETORES.length === 0) return

    // Observa o container do player ou o body como fallback
    const alvo = document.querySelector(PLAYER_CONTAINER_SELETOR) ?? document.body

    adObserver = new MutationObserver(() => {
      const isAnuncio = detectarAnuncioAppleTv()
      if (isAnuncio && !eraAnuncio) {
        eraAnuncio = true
        emit('ad-start')
      } else if (!isAnuncio && eraAnuncio) {
        eraAnuncio = false
        emit('ad-end')
      }
    })

    adObserver.observe(alvo, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['class', 'style'],
    })
  }

  // ---------------------------------------------------------------------------
  // Deteccao de navegacao SPA
  // ---------------------------------------------------------------------------

  /**
   * Chamado quando detectamos mudanca de URL (troca de episodio ou conteudo).
   * Re-resolve o <video> e reconfigura todos os listeners.
   *
   * Single-flight por token de sequencia:
   * - Incrementa navigationSeq ao entrar; cancela o aguardarVideoAppleTv anterior.
   * - Apos cada await, verifica se o token ainda e o atual; se nao, aborta.
   * - Remove handlers do video anterior SOMENTE apos resolucao bem-sucedida,
   *   evitando estado zumbi quando aguardarVideoAppleTv expira sem resultado.
   * - Retry leve enquanto estiver em path de player (uma nova tentativa apos timeout).
   */
  async function onSpaNavegacao(): Promise<void> {
    // Cancela qualquer aguardar em andamento e captura o token local
    aguardarAbortController?.abort()
    const controller = new AbortController()
    aguardarAbortController = controller

    navigationSeq++
    const meuSeq = navigationSeq

    const tentarReligar = async (): Promise<boolean> => {
      // Aguarda um tick antes de re-selecionar para nao pegar o elemento
      // antigo que ainda permanece no DOM nos primeiros 100-300ms apos a navegacao SPA.
      await new Promise<void>((r) => setTimeout(r, SPA_RENAVIGATE_DELAY_MS))
      if (meuSeq !== navigationSeq || controller.signal.aborted) return false

      const novoVideo = await aguardarVideoAppleTv(controller.signal)

      // Verifica se a navegacao ainda e a mais recente
      if (meuSeq !== navigationSeq) return false
      if (controller.signal.aborted) return false

      if (!novoVideo) return false

      // Remove handlers do video anterior somente apos resolucao bem-sucedida
      removerHandlersNativos()
      registrarHandlersNativos(novoVideo)
      configurarAdObserver()
      eraAnuncio = detectarAnuncioAppleTv()
      console.debug('[OpenParty AppleTV] adapter re-ligado apos navegacao SPA')
      return true
    }

    const ok = await tentarReligar()

    // Retry leve - se timeout e ainda estamos em path de player, tenta mais uma vez
    if (!ok && meuSeq === navigationSeq && !controller.signal.aborted && SPA_PATH_REGEX.test(new URL(location.href).pathname)) {
      console.debug('[OpenParty AppleTV] retry de re-ligacao apos timeout em path de player')
      await tentarReligar()
    }

    if (meuSeq === navigationSeq) {
      aguardarAbortController = null
    }
  }

  const spaNavegacaoHandler = (): void => {
    onSpaNavegacao().catch((err) => {
      console.warn('[OpenParty AppleTV] erro ao religar adapter apos SPA:', err)
    })
  }

  /**
   * Inicia o polling leve de location.href para detectar mudancas de URL SPA.
   * O Apple TV+ usa pushState ao trocar de episodio; popstate cobre apenas back/forward.
   */
  function iniciarSpaPolling(): void {
    if (spaPollingId !== null) return

    spaPollingId = setInterval(() => {
      const novaUrl = location.href
      if (novaUrl !== urlAtual) {
        urlAtual = novaUrl
        // Usa pathname via new URL para consistencia com o popstate handler
        // Apenas reage se for uma URL de player (evita reagir a navegacao ao catalogo)
        if (SPA_PATH_REGEX.test(new URL(novaUrl).pathname)) {
          spaNavegacaoHandler()
        }
      }
    }, SPA_POLL_INTERVAL_MS)
  }

  function pararSpaPolling(): void {
    if (spaPollingId !== null) {
      clearInterval(spaPollingId)
      spaPollingId = null
    }
  }

  // ---------------------------------------------------------------------------
  // Inicializacao
  // ---------------------------------------------------------------------------

  // Handler de popstate filtrado: reage apenas quando a URL resultante e de player
  // (sem este filtro popstate reagia a qualquer navegacao back/forward, inclusive
  //  saindo do player para o catalogo ou pagina inicial)
  const spaPopstateHandler = (): void => {
    if (!SPA_PATH_REGEX.test(window.location.pathname)) return
    spaNavegacaoHandler()
  }

  // Registra handler de popstate (back/forward do browser)
  window.addEventListener('popstate', spaPopstateHandler)

  // Inicia polling de URL para capturar pushState (troca de episodio)
  iniciarSpaPolling()

  // Registra handlers nativos no video encontrado
  registrarHandlersNativos(video)

  // Configura observer de anuncio (scaffolding; Apple TV+ nao tem anuncios)
  configurarAdObserver()

  // ---------------------------------------------------------------------------
  // Implementacao da interface ServiceAdapter
  // ---------------------------------------------------------------------------

  const adapter: ServiceAdapter = {
    /** Inicia reproducao no player Apple TV+ */
    async play(): Promise<void> {
      await videoAtual.play()
    },

    /** Pausa reproducao no player Apple TV+ */
    async pause(): Promise<void> {
      videoAtual.pause()
    },

    /** Salta para `secs` segundos no player Apple TV+ */
    async seekTo(secs: number): Promise<void> {
      videoAtual.currentTime = secs
    },

    /** Retorna posicao atual em segundos */
    getCurrentTime(): number {
      return videoAtual.currentTime
    },

    /** Retorna duracao total em segundos (0 se desconhecida) */
    getDuration(): number {
      const d = videoAtual.duration
      return Number.isFinite(d) ? d : 0
    },

    /**
     * Retorna true se o player esta exibindo um anuncio.
     * O Apple TV+ nao tem anuncios; retorna sempre false.
     */
    isAd(): boolean {
      return detectarAnuncioAppleTv()
    },

    /** Retorna o estado atual do player */
    getPlaybackState(): PlaybackState {
      if (detectarAnuncioAppleTv()) return 'ad'
      if (videoAtual.readyState < HAVE_METADATA) return 'buffering'
      if (!videoAtual.paused) return 'playing'
      return 'paused'
    },

    /** Retorna o tipo de servico - usado por decideSyncAction para thresholds corretos */
    getServiceType(): StreamingServiceType {
      return 'native-html5'
    },

    /** Registra listener para evento do player */
    on(event: AdapterEventName, handler: () => void): void {
      if (!listenerMap.has(event)) {
        listenerMap.set(event, new Set())
      }
      listenerMap.get(event)!.add(handler)
    },

    /** Remove listener registrado anteriormente */
    off(event: AdapterEventName, handler: () => void): void {
      listenerMap.get(event)?.delete(handler)
    },

    /** Libera todos os recursos e remove todos os listeners */
    destroy(): void {
      // Cancela qualquer aguardarVideoAppleTv em andamento
      aguardarAbortController?.abort()
      aguardarAbortController = null

      // Invalida qualquer onSpaNavegacao em voo incrementando o token
      navigationSeq++

      // Remove handlers nativos do video
      removerHandlersNativos()

      // Desconecta o observer de anuncio
      adObserver?.disconnect()
      adObserver = null

      // Remove listener de popstate
      window.removeEventListener('popstate', spaPopstateHandler)

      // Para o polling de URL SPA
      pararSpaPolling()

      // Limpa todos os listeners registrados pelo usuario
      listenerMap.clear()
    },
  }

  return adapter
}
