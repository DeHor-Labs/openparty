// src/adapters/disney.ts
// Adapter do Disney+ para a extensao OpenParty.
//
// Controla o player via elemento <video> nativo em paginas disneyplus.com/video/* e /play/*.
// Nao usa nenhuma API privada do Disney+ - apenas HTMLVideoElement padrao.
//
// Heuristica de selecao do <video>:
//   O Disney+ costuma ter varios elementos <video> na pagina (player principal,
//   thumbnails de hover, trailers de catalogo). A selecao usa checkVisibility()
//   como primeiro filtro (requer visibilidade real no viewport), e em seguida:
//   1. Entre os visiveis, escolhe o de maior duracao (conteudo > trailers curtos)
//   2. Se nenhum tem duracao conhecida, escolhe o de maior area renderizada
//   Fallback: qualquer <video> com area minima de VIDEO_AREA_MINIMA_PX2.
//
// Navegacao SPA:
//   O Disney+ troca de episodio via History API (pushState) sem recarregar a pagina.
//   Usamos dois mecanismos combinados:
//     - Listener em popstate (navegacao com back/forward)
//     - Polling leve de location.href a cada SPA_POLL_INTERVAL_MS, limpado no destroy()
//   O filtro de path e aplicado em ambos os mecanismos: reage apenas quando a URL
//   contem /video/ ou /play/ (rotas de reproducao do Disney+).
//
// Deteccao de anuncio:
//   O Disney+ exibe anuncios (plano com publicidade) no mesmo elemento <video>.
//   Heuristicas de deteccao (do mais ao menos confiavel):
//     1. Web Component <ad-badge-overlay> com shadow DOM contendo tempo restante.
//        Confirmado pela extensao Netflix-Prime-Auto-Skip (Dreamlinerm).
//     2. Elemento .ad-badge presente no DOM do player.
//     3. Elemento [data-testid="ad-badge"] presente no DOM.
//     4. Container .controls__infobar com classe indicativa de anuncio.
//   Estas heuristicas sao observadas via MutationObserver no body.
//   LIMITACAO CONHECIDA: o Disney+ usa Web Components com shadow DOM em alguns
//   elementos de UI (skip-overlay, title-bug, ad-badge-overlay). Seletores de
//   shadow DOM nao sao acessiveis diretamente por querySelectorAll - apenas via
//   shadowRoot do elemento pai. A deteccao de anuncio aqui usa seletores do DOM
//   flat (sem shadow DOM) como primeiro filtro, mais o selector do custom element
//   <ad-badge-overlay> que e acessivel no DOM principal.
//
// Seletores pesquisados e validados (fonte: Dreamlinerm/Netflix-Prime-Auto-Skip,
// extensoes de velocidade/skip do Chrome para Disney+, inspecao manual do DOM):
//   - Video: Array.from(querySelectorAll("video")).find(v => v.checkVisibility())
//   - Container do player: div com classe .controls__right (controles do player)
//   - Anuncio (Web Component): elemento <ad-badge-overlay> no DOM
//   - Anuncio (shadow DOM): ad-badge-overlay.shadowRoot .ad-badge-overlay__content--time-display
//   - Anuncio (fallback): .ad-badge, [data-testid="ad-badge"]
//   - Rotas de video: /video/:id e /play/:id

import type { AdapterEventName, PlaybackState, ServiceAdapter } from './interface'
import type { StreamingServiceType } from '../lib/sync'

// ---------------------------------------------------------------------------
// Constantes
// ---------------------------------------------------------------------------

/** Seletor fallback - qualquer <video> na pagina */
const VIDEO_SELETOR_FALLBACK = 'video'

/** Web Component de badge de anuncio do Disney+ (DOM principal, sem shadow DOM) */
const AD_BADGE_CUSTOM_ELEMENT = 'ad-badge-overlay'

/** Seletores de anuncio acessiveis no DOM flat (sem shadow DOM) */
const AD_SELETORES_FLAT = [
  AD_BADGE_CUSTOM_ELEMENT,
  '.ad-badge',
  '[data-testid="ad-badge"]',
]

/** readyState minimo para considerar o <video> carregado */
const HAVE_METADATA = 2

/** Area minima (pixels quadrados) para considerar o <video> como player principal e nao preview */
const VIDEO_AREA_MINIMA_PX2 = 40_000 // ~200x200px - exclui thumbnails de hover

/** Tempo maximo de espera pelo <video> aparecer (ms) */
const VIDEO_WAIT_TIMEOUT_MS = 8_000

/** Intervalo de polling fallback dentro de aguardarVideo (ms) */
const VIDEO_POLL_INTERVAL_MS = 300

/** Intervalo de polling para detectar navegacao SPA (ms) */
const SPA_POLL_INTERVAL_MS = 800

/**
 * MEDIUM-1: atraso minimo antes de re-selecionar o <video> apos navegacao SPA.
 * Evita retornar o elemento antigo que ainda permanece no DOM nos primeiros
 * 100-300ms apos a transicao de conteudo.
 */
const SPA_RENAVIGATE_DELAY_MS = 150

/** Rotas de reproducao do Disney+ (filtro de path para reacao SPA) */
const SPA_PATH_REGEX = /\/(video|play)\//i

/** Mapeamento de eventos nativos do video para AdapterEventName */
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
 * Verifica se um elemento <video> tem area de renderizacao suficiente para
 * ser considerado o player principal (nao um thumbnail ou preview).
 *
 * Usa getBoundingClientRect para dimensoes reais renderizadas (mais preciso
 * que offsetWidth/offsetHeight para elementos com transform CSS).
 */
function videoTemAreaSuficiente(v: HTMLVideoElement): boolean {
  const rect = v.getBoundingClientRect()
  return rect.width * rect.height >= VIDEO_AREA_MINIMA_PX2
}

/**
 * Verifica se um <video> esta visivel no DOM de forma confiavel.
 *
 * Usa checkVisibility() quando disponivel (API moderna, Chrome 105+) e
 * cai em verificacao de area como fallback.
 */
function videoEstaVisivel(v: HTMLVideoElement): boolean {
  if (typeof v.checkVisibility === 'function') {
    return v.checkVisibility()
  }
  return videoTemAreaSuficiente(v)
}

/**
 * Seleciona o elemento <video> principal do player Disney+.
 *
 * MEDIUM-2: gate de path - retorna null imediatamente quando a rota atual
 * nao e uma rota de player (/video/ ou /play/), para nao capturar trailers
 * visiveis nas paginas de catalogo.
 *
 * Heuristica em ordem de prioridade:
 * 1. Entre todos os <video> visiveis (checkVisibility), escolhe o de maior duracao
 *    (conteudo principal sempre tem duracao > trailers ou thumbnails)
 * 2. Entre os visiveis sem duracao conhecida, escolhe o de maior area renderizada
 * 3. Fallback: qualquer <video> com area minima (VIDEO_AREA_MINIMA_PX2)
 *
 * Retorna null se nenhum <video> adequado for encontrado.
 */
function selecionarVideoDisney(): HTMLVideoElement | null {
  // MEDIUM-2: gate de path - catalogo nao deve selecionar video
  if (!SPA_PATH_REGEX.test(new URL(location.href).pathname)) return null

  const todos = Array.from(document.querySelectorAll<HTMLVideoElement>(VIDEO_SELETOR_FALLBACK))
  if (todos.length === 0) return null

  // Filtro 1: visiveis via checkVisibility (mais confiavel para Disney+)
  const visiveis = todos.filter(videoEstaVisivel)
  const candidatos = visiveis.length > 0 ? visiveis : todos.filter(videoTemAreaSuficiente)

  if (candidatos.length === 0) return null
  if (candidatos.length === 1) return candidatos[0]

  // Prioriza videos com duracao conhecida (conteudo principal vs trailers)
  const comDuracao = candidatos.filter(
    (v) => v.readyState >= HAVE_METADATA && Number.isFinite(v.duration) && v.duration > 0,
  )
  if (comDuracao.length > 0) {
    return comDuracao.reduce((melhor, atual) => (atual.duration > melhor.duration ? atual : melhor))
  }

  // Fallback: video com maior area renderizada
  const comArea = candidatos.filter((v) => v.offsetWidth > 0 && v.offsetHeight > 0)
  if (comArea.length > 0) {
    return comArea.reduce((melhor, atual) =>
      atual.offsetWidth * atual.offsetHeight > melhor.offsetWidth * melhor.offsetHeight ? atual : melhor,
    )
  }

  return candidatos[0] ?? null
}

/**
 * Retorna true se o elemento esta visivel no viewport de forma confiavel.
 *
 * CR-MAJOR: impede que um elemento de anuncio oculto (display:none,
 * visibility:hidden, opacity:0 ou sem layout) dispare isAd() incorretamente,
 * prendendo o sync em modo de anuncio sem razao.
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
 * Retorna true se o player Disney+ esta exibindo um anuncio no momento.
 *
 * Verifica os seletores de UI de anuncio do Disney+. Ver lista AD_SELETORES_FLAT
 * e LIMITACAO CONHECIDA no cabecalho do arquivo.
 * CR-MAJOR: exige que o elemento de anuncio esteja visivel (elementoVisivel).
 */
function detectarAnuncioDisney(): boolean {
  for (const seletor of AD_SELETORES_FLAT) {
    const el = document.querySelector(seletor)
    if (el && elementoVisivel(el)) return true
  }
  return false
}

/**
 * Aguarda o elemento <video> principal do Disney+ aparecer no DOM.
 *
 * Usa MutationObserver como mecanismo primario e polling como fallback.
 * Respeita VIDEO_WAIT_TIMEOUT_MS antes de desistir e retornar null.
 * Aceita AbortSignal para cancelamento antecipado (destroy ou nova navegacao).
 */
async function aguardarVideoDisney(signal?: AbortSignal): Promise<HTMLVideoElement | null> {
  const existente = selecionarVideoDisney()
  if (existente) return existente

  return new Promise<HTMLVideoElement | null>((resolve) => {
    let timeoutId: ReturnType<typeof setTimeout> | null = null
    let pollingId: ReturnType<typeof setInterval> | null = null
    let observer: MutationObserver | null = null
    // LOW-1: flag de idempotencia para evitar dupla resolucao
    let settled = false

    const cleanup = (): void => {
      if (timeoutId !== null) { clearTimeout(timeoutId); timeoutId = null }
      if (pollingId !== null) { clearInterval(pollingId); pollingId = null }
      observer?.disconnect()
      observer = null
      // LOW-1: remove o listener de abort para evitar vazamento de referencia
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
      const v = selecionarVideoDisney()
      if (v) encontrou(v)
    })
    observer.observe(document.body, { childList: true, subtree: true })

    // Polling como fallback (necessario quando o MutationObserver e throttled)
    pollingId = setInterval(() => {
      if (signal?.aborted) return
      const v = selecionarVideoDisney()
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
 * Cria o adapter do Disney+ conectando ao elemento <video> nativo do player.
 *
 * Retorna null se nenhum elemento <video> adequado for encontrado na pagina
 * (ex: pagina inicial do Disney+, catalogo sem reproducao ativa).
 *
 * SPA: Detecta mudanca de URL (troca de episodio/conteudo) via polling de
 * location.href e via popstate. Ao detectar mudanca em /video/:id ou /play/:id,
 * re-resolve o <video> e reconfigura todos os listeners.
 *
 * Anuncio: Observa a UI do player via MutationObserver para emitir ad-start/ad-end.
 * O Disney+ usa o custom element <ad-badge-overlay> para exibir o tempo restante
 * do anuncio - sua presenca no DOM e o sinal mais confiavel de anuncio ativo.
 */
export async function createDisneyAdapter(): Promise<ServiceAdapter | null> {
  const video = await aguardarVideoDisney()
  if (!video) return null

  // Mapa de listeners: AdapterEventName -> conjunto de handlers do usuario
  const listenerMap = new Map<AdapterEventName, Set<() => void>>()

  // Handlers nativos registrados no video - guardados para remocao no destroy()
  let nativeHandlers = new Map<string, EventListener>()

  // Estado de anuncio anterior (para o MutationObserver de ad-start/ad-end)
  let eraAnuncio = detectarAnuncioDisney()

  // Observer para detectar transicao de anuncio
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

  // AbortController da aguardarVideoDisney em andamento.
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
   * Observa o body (o Disney+ usa Web Components que aparecem no DOM principal).
   * Emite ad-start quando o anuncio comeca, ad-end quando termina.
   */
  function configurarAdObserver(): void {
    adObserver?.disconnect()

    adObserver = new MutationObserver(() => {
      const isAnuncio = detectarAnuncioDisney()
      if (isAnuncio && !eraAnuncio) {
        eraAnuncio = true
        emit('ad-start')
      } else if (!isAnuncio && eraAnuncio) {
        eraAnuncio = false
        emit('ad-end')
      }
    })

    adObserver.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['class', 'data-testid', 'style'],
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
   * - Incrementa navigationSeq ao entrar; cancela o aguardarVideoDisney anterior.
   * - Apos cada await, verifica se o token ainda e o atual; se nao, aborta.
   * - Remove handlers do video anterior SOMENTE apos resolucao bem-sucedida,
   *   evitando estado zumbi quando aguardarVideoDisney expira sem resultado.
   * - Retry leve enquanto estiver em /video/ ou /play/ (uma nova tentativa apos timeout).
   */
  async function onSpaNavegacao(): Promise<void> {
    // Cancela qualquer aguardar em andamento e captura o token local
    aguardarAbortController?.abort()
    const controller = new AbortController()
    aguardarAbortController = controller

    navigationSeq++
    const meuSeq = navigationSeq

    const tentarReligar = async (): Promise<boolean> => {
      // MEDIUM-1: aguarda um tick antes de re-selecionar para nao pegar o elemento
      // antigo que ainda permanece no DOM nos primeiros 100-300ms apos a navegacao SPA.
      await new Promise<void>((r) => setTimeout(r, SPA_RENAVIGATE_DELAY_MS))
      if (meuSeq !== navigationSeq || controller.signal.aborted) return false

      const novoVideo = await aguardarVideoDisney(controller.signal)

      // Verifica se a navegacao ainda e a mais recente
      if (meuSeq !== navigationSeq) return false
      if (controller.signal.aborted) return false
      if (!novoVideo) return false

      // Remove handlers do video anterior somente apos resolucao bem-sucedida
      removerHandlersNativos()
      registrarHandlersNativos(novoVideo)
      configurarAdObserver()
      eraAnuncio = detectarAnuncioDisney()
      console.debug('[OpenParty Disney+] adapter re-ligado apos navegacao SPA')
      return true
    }

    const ok = await tentarReligar()

    // Retry leve - se timeout e ainda estamos em /video/ ou /play/, tenta mais uma vez
    if (!ok && meuSeq === navigationSeq && !controller.signal.aborted && SPA_PATH_REGEX.test(location.pathname)) {
      console.debug('[OpenParty Disney+] retry de re-ligacao apos timeout em /video/ ou /play/')
      await tentarReligar()
    }

    if (meuSeq === navigationSeq) {
      aguardarAbortController = null
    }
  }

  const spaNavegacaoHandler = (): void => {
    onSpaNavegacao().catch((err) => {
      console.warn('[OpenParty Disney+] erro ao religar adapter apos SPA:', err)
    })
  }

  /**
   * Inicia o polling leve de location.href para detectar mudancas de URL SPA.
   * O Disney+ usa pushState ao trocar de episodio; popstate cobre apenas back/forward.
   * O polling garante captura de pushState sem monkey-patch.
   */
  function iniciarSpaPolling(): void {
    if (spaPollingId !== null) return

    spaPollingId = setInterval(() => {
      const novaUrl = location.href
      if (novaUrl !== urlAtual) {
        urlAtual = novaUrl
        // Apenas reage se for uma URL de reproducao (evita reagir a catalogo/home)
        if (SPA_PATH_REGEX.test(location.pathname)) {
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

  // Handler de popstate filtrado: reage apenas quando a URL resultante e /video/ ou /play/
  // (o polling ja filtra pushState; sem este filtro popstate reagia a qualquer
  //  navegacao back/forward, inclusive saindo do catalogo para a home).
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

  // Configura observer de anuncio
  configurarAdObserver()

  // ---------------------------------------------------------------------------
  // Implementacao da interface ServiceAdapter
  // ---------------------------------------------------------------------------

  const adapter: ServiceAdapter = {
    /** Inicia reproducao no player Disney+ */
    async play(): Promise<void> {
      await videoAtual.play()
    },

    /** Pausa reproducao no player Disney+ */
    async pause(): Promise<void> {
      videoAtual.pause()
    },

    /** Salta para `secs` segundos no player Disney+ */
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

    /** Retorna true se o player esta exibindo um anuncio (heuristica best-effort) */
    isAd(): boolean {
      return detectarAnuncioDisney()
    },

    /** Retorna o estado atual do player */
    getPlaybackState(): PlaybackState {
      if (detectarAnuncioDisney()) return 'ad'
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
      // Cancela qualquer aguardarVideoDisney em andamento
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
