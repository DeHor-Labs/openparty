// src/adapters/max.ts
// Adapter do Max (max.com) para a extensao OpenParty.
//
// Controla o player via elemento <video> nativo em paginas max.com/play/*.
// Nao usa nenhuma API privada do Max - apenas HTMLVideoElement padrao.
//
// Heuristica de selecao do <video>:
//   1. Tenta o seletor especifico do container do player:
//      `[data-testid="player-ux-root"] video`
//   2. Fallback: `[class*="PlayerContainer"] video`
//   3. Fallback final: todos os elementos <video> da pagina, filtrando por:
//      - Maior duracao (conteudo principal tem duracao > trailers e previews)
//      - Maior area renderizada (offsetWidth * offsetHeight)
//      - Area minima para excluir thumbnails e previews de hover
//
// Seletores confirmados por inspeçao de extensoes reais (np-auto-skip):
//   - `[data-testid="player-ux-root"]` - container raiz do player Max
//   - `[data-testid="player-ux-season-episode"]` - metadados do episodio
//   - `[data-testid="player-ux-fullscreen-button"]` - botao fullscreen
//   - `button[class*="SkipButton-"]` - botao de pular intro/recap
//   - `div[class*="ControlsFooterBottomRight-"]` - area de controles
//
// Deteccao de anuncio:
//   O Max exibe anuncios (plano com publicidade) via SSAI (Server-Side Ad Insertion).
//   Isso significa que os anuncios sao segmentos do proprio stream; o elemento
//   <video> e o mesmo. Detectamos por heuristicas de UI, escopadas ao container
//   do player ([data-testid="player-ux-root"]) para evitar falso positivo:
//     1. Whitelist de data-testid exatos: ad-badge, ad-timer, ad-countdown, ad-panel,
//        ad-overlay, ad-skip-button, ad-break. Evita falso positivo com testids que
//        contem a substring "ad" (ex: add-to-watchlist, loaded, metadata).
//     2. Seletores de classe CSS: [class*="AdBreak"], [class*="AdTimer"],
//        [class*="AdPanel"], [class*="AdOverlay"], [class*="AdCountdown"], [class*="SkipAd"].
//   LIMITACAO CONHECIDA: Classes CSS do Max sao geradas por CSS Modules com hashes
//   (ex: `AdBreak-abc123`). O seletor `[class*="AdBreak"]` captura o nome base
//   mesmo com hash, mas pode quebrar se o Max renomear o componente.
//   LIMITACAO SSAI: Como os anuncios estao inseridos no stream, nao ha como
//   detectar o inicio/fim de anuncio com 100% de confiabilidade apenas por DOM.
//   A heuristica e best-effort; falsos negativos sao possiveis.
//
// Navegacao SPA:
//   O Max e uma SPA React. Troca de conteudo via History API (pushState).
//   Paginas de reproducao seguem o padrao `/play/<id>` em max.com.
//   Usamos dois mecanismos combinados:
//     - Listener em popstate (navegacao com back/forward)
//     - Polling leve de location.href a cada SPA_POLL_INTERVAL_MS

import type { AdapterEventName, PlaybackState, ServiceAdapter } from './interface'
import type { StreamingServiceType } from '../lib/sync'

// ---------------------------------------------------------------------------
// Constantes
// ---------------------------------------------------------------------------

/** Seletor preferencial do <video> via container raiz do player */
const VIDEO_SELETOR_PRIMARIO = '[data-testid="player-ux-root"] video'

/** Seletor secundario via classe CSS do container do player */
const VIDEO_SELETOR_SECUNDARIO = '[class*="PlayerContainer"] video'

/** Seletor fallback - qualquer <video> na pagina */
const VIDEO_SELETOR_FALLBACK = 'video'

/** Container raiz do player Max (usado para o MutationObserver de anuncio) */
const PLAYER_CONTAINER_SELETOR = '[data-testid="player-ux-root"]'

/**
 * data-testid exatos de elementos de anuncio do Max.
 * Whitelist restrita para evitar falso positivo com "add-to-watchlist",
 * "loaded", "metadata" e outros testids que contem a substring "ad".
 *
 * HIGH-2: substituiu o seletor amplo [data-testid*="ad"] que casava com
 * qualquer atributo contendo a substring, gerando falso positivo e suprimindo
 * o sync incorretamente em paginas de catalogo.
 */
const AD_DATA_TESTIDS: readonly string[] = [
  'ad-badge',
  'ad-timer',
  'ad-countdown',
  'ad-panel',
  'ad-overlay',
  'ad-skip-button',
  'ad-break',
]

/**
 * Seletores de classe CSS de UI de anuncio do Max (do mais estavel ao menos estavel).
 * Aplicados apenas dentro do container do player para evitar colisao com outros
 * elementos da pagina que possam ter classes com as mesmas substrings.
 * O Max usa SSAI, portanto a deteccao e exclusivamente por DOM da UI.
 */
const AD_SELETORES_CLASSE = [
  '[class*="AdBreak"]',
  '[class*="AdTimer"]',
  '[class*="AdPanel"]',
  '[class*="AdOverlay"]',
  '[class*="AdCountdown"]',
  '[class*="SkipAd"]',
]

/** readyState minimo para considerar o <video> carregado com metadados */
const HAVE_METADATA = 2

/** Area minima (pixels quadrados) para excluir thumbnails e previews de hover */
const VIDEO_AREA_MINIMA_PX2 = 40_000 // ~200x200px

/** Tempo maximo de espera pelo <video> aparecer no DOM (ms) */
const VIDEO_WAIT_TIMEOUT_MS = 8_000

/** Intervalo de polling fallback dentro de aguardarVideo (ms) */
const VIDEO_POLL_INTERVAL_MS = 300

/** Intervalo de polling para detectar navegacao SPA via pushState (ms) */
const SPA_POLL_INTERVAL_MS = 800

/**
 * MEDIUM-1: atraso minimo antes de re-selecionar o <video> apos navegacao SPA.
 * Evita retornar o elemento antigo que ainda permanece no DOM nos primeiros
 * 100-300ms apos a transicao de conteudo.
 */
const SPA_RENAVIGATE_DELAY_MS = 150

/** Segmento de path que identifica paginas de reproducao do Max */
const MAX_WATCH_PATH = '/play/'

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
 * Usa getBoundingClientRect para obter dimensoes reais renderizadas,
 * mais preciso que offsetWidth/offsetHeight para elementos transformed.
 */
function videoTemAreaSuficiente(v: HTMLVideoElement): boolean {
  const rect = v.getBoundingClientRect()
  return rect.width * rect.height >= VIDEO_AREA_MINIMA_PX2
}

/**
 * Seleciona o elemento <video> principal do player Max.
 *
 * Heuristica em ordem de prioridade:
 * 1. Seletor do container raiz `[data-testid="player-ux-root"] video`
 *    - Validado por area minima para excluir previews
 * 2. Seletor do container por classe `[class*="PlayerContainer"] video`
 *    - Validado por area minima
 * 3. Entre todos os <video> da pagina com area suficiente, o de maior duracao
 * 4. Entre todos os <video> da pagina, o de maior area renderizada
 *
 * Retorna null se nenhum <video> adequado for encontrado.
 */
function selecionarVideoMax(): HTMLVideoElement | null {
  // Tentativa 1: seletor especifico via data-testid do player-ux-root
  const primario = document.querySelector<HTMLVideoElement>(VIDEO_SELETOR_PRIMARIO)
  if (primario && videoTemAreaSuficiente(primario)) return primario

  // Tentativa 2: seletor por classe CSS do container do player
  const secundario = document.querySelector<HTMLVideoElement>(VIDEO_SELETOR_SECUNDARIO)
  if (secundario && videoTemAreaSuficiente(secundario)) return secundario

  // Tentativa 3 e 4: heuristica entre todos os videos da pagina
  const todos = Array.from(document.querySelectorAll<HTMLVideoElement>(VIDEO_SELETOR_FALLBACK))
  if (todos.length === 0) return null

  const comAreaSuficiente = todos.filter(videoTemAreaSuficiente)
  const candidatos = comAreaSuficiente.length > 0 ? comAreaSuficiente : todos

  if (candidatos.length === 1) return candidatos[0]

  // Prioriza videos com duracao conhecida (conteudo > trailers)
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
 * Retorna true se o player Max esta exibindo um anuncio no momento.
 *
 * HIGH-2: a busca e escopada ao container do player ([data-testid="player-ux-root"])
 * para evitar falso positivo. Elementos como "add-to-watchlist", "metadata" e outros
 * que contem a substring "ad" no testid ficam fora do container do player.
 *
 * A deteccao usa duas estrategias complementares:
 *   1. Whitelist de data-testid exatos (AD_DATA_TESTIDS) dentro do container do player.
 *   2. Seletores de classe CSS de anuncio (AD_SELETORES_CLASSE) dentro do mesmo container.
 *
 * Ver AD_DATA_TESTIDS, AD_SELETORES_CLASSE e limitacoes SSAI no cabecalho do arquivo.
 */
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

function detectarAnuncioMax(): boolean {
  // Escopa a busca ao container do player; fallback para o body se o container
  // ainda nao foi inserido no DOM (improvavel em paginas de reproducao).
  const container = document.querySelector(PLAYER_CONTAINER_SELETOR) ?? document.body

  // Verifica data-testid exatos (whitelist) dentro do container
  // CR-MAJOR: exige visibilidade para evitar falso positivo com elementos ocultos
  for (const testid of AD_DATA_TESTIDS) {
    const el = container.querySelector(`[data-testid="${testid}"]`)
    if (el && elementoVisivel(el)) return true
  }

  // Verifica seletores de classe CSS de anuncio dentro do container
  // CR-MAJOR: exige visibilidade
  for (const seletor of AD_SELETORES_CLASSE) {
    const el = container.querySelector(seletor)
    if (el && elementoVisivel(el)) return true
  }

  return false
}

/**
 * Aguarda o elemento <video> principal do Max aparecer no DOM.
 *
 * Usa MutationObserver como mecanismo primario e polling como fallback.
 * Respeita VIDEO_WAIT_TIMEOUT_MS antes de desistir e retornar null.
 * Aceita AbortSignal para cancelamento antecipado (destroy ou nova navegacao).
 */
async function aguardarVideoMax(signal?: AbortSignal): Promise<HTMLVideoElement | null> {
  const existente = selecionarVideoMax()
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

    if (signal?.aborted) {
      resolve(null)
      return
    }
    signal?.addEventListener('abort', cancelar, { once: true })

    // MutationObserver como mecanismo primario
    observer = new MutationObserver(() => {
      if (signal?.aborted) return
      const v = selecionarVideoMax()
      if (v) encontrou(v)
    })
    observer.observe(document.body, { childList: true, subtree: true })

    // Polling como fallback (necessario quando o MutationObserver e throttled)
    pollingId = setInterval(() => {
      if (signal?.aborted) return
      const v = selecionarVideoMax()
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
 * Cria o adapter do Max conectando ao elemento <video> nativo do player.
 *
 * Retorna null se nenhum elemento <video> adequado for encontrado na pagina
 * (ex: pagina de catalogo do Max sem reproducao ativa).
 *
 * SPA: Detecta mudanca de URL (troca de conteudo) via polling de location.href
 * e via popstate. Ao detectar mudanca em /play/:id, re-resolve o <video> e
 * reconfigura todos os listeners.
 *
 * Anuncio: Observa a UI do player via MutationObserver para emitir ad-start/ad-end.
 * Limitacao SSAI: deteccao e best-effort via elementos de UI - ver cabecalho.
 */
export async function createMaxAdapter(): Promise<ServiceAdapter | null> {
  const video = await aguardarVideoMax()
  if (!video) return null

  // Mapa de listeners: AdapterEventName -> conjunto de handlers do usuario
  const listenerMap = new Map<AdapterEventName, Set<() => void>>()

  // Handlers nativos registrados no video - guardados para remocao no destroy()
  let nativeHandlers = new Map<string, EventListener>()

  // Estado de anuncio anterior (para o MutationObserver de ad-start/ad-end)
  let eraAnuncio = detectarAnuncioMax()

  // Observer para detectar transicao de anuncio
  let adObserver: MutationObserver | null = null

  // Referencia ao elemento video atual (pode mudar em navegacao SPA)
  let videoAtual: HTMLVideoElement = video

  // URL atual - usada para detectar mudanca de conteudo via polling
  let urlAtual = location.href

  // ID do intervalo de polling de URL (SPA)
  let spaPollingId: ReturnType<typeof setInterval> | null = null

  // Token de sequencia incrementado a cada navegacao SPA.
  // Apos cada await em onSpaNavegacao, verificamos se o token ainda e o atual.
  // Se nao for, a navegacao foi superada por uma mais recente e devemos abortar.
  let navigationSeq = 0

  // AbortController da aguardarVideoMax em andamento.
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
   * Observa o container raiz do player ou o body como fallback.
   * Emite ad-start quando o anuncio comeca, ad-end quando termina.
   */
  function configurarAdObserver(): void {
    adObserver?.disconnect()

    const alvo = document.querySelector(PLAYER_CONTAINER_SELETOR) ?? document.body

    adObserver = new MutationObserver(() => {
      const isAnuncio = detectarAnuncioMax()
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
      attributeFilter: ['data-testid', 'class'],
    })
  }

  // ---------------------------------------------------------------------------
  // Deteccao de navegacao SPA
  // ---------------------------------------------------------------------------

  /**
   * Chamado quando detectamos mudanca de URL (troca de conteudo no Max).
   * Re-resolve o <video> e reconfigura todos os listeners.
   *
   * Single-flight por token de sequencia:
   * - Incrementa navigationSeq ao entrar; cancela o aguardarVideoMax anterior.
   * - Apos cada await, verifica se o token ainda e o atual; se nao, aborta.
   * - Remove handlers do video anterior SOMENTE apos resolucao bem-sucedida,
   *   evitando estado zumbi quando aguardarVideoMax expira sem resultado.
   * - Retry leve enquanto estiver em /play/ (uma nova tentativa apos timeout).
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

      const novoVideo = await aguardarVideoMax(controller.signal)

      // Verifica se a navegacao ainda e a mais recente
      if (meuSeq !== navigationSeq) return false
      if (controller.signal.aborted) return false
      if (!novoVideo) return false

      // Remove handlers do video anterior somente apos resolucao bem-sucedida
      removerHandlersNativos()
      registrarHandlersNativos(novoVideo)
      configurarAdObserver()
      eraAnuncio = detectarAnuncioMax()
      console.debug('[OpenParty Max] adapter re-ligado apos navegacao SPA')
      return true
    }

    const ok = await tentarReligar()

    // Retry leve: se timeout e ainda em /play/, tenta mais uma vez
    // LOW-2: usa new URL(location.href).pathname para consistencia com o popstate handler
    if (!ok && meuSeq === navigationSeq && !controller.signal.aborted && new URL(location.href).pathname.includes(MAX_WATCH_PATH)) {
      console.debug('[OpenParty Max] retry de re-ligacao apos timeout em /play/')
      await tentarReligar()
    }

    if (meuSeq === navigationSeq) {
      aguardarAbortController = null
    }
  }

  const spaNavegacaoHandler = (): void => {
    onSpaNavegacao().catch((err) => {
      console.warn('[OpenParty Max] erro ao religar adapter apos SPA:', err)
    })
  }

  /**
   * Inicia o polling leve de location.href para detectar mudancas de URL SPA.
   * O Max usa pushState ao trocar de conteudo; popstate cobre apenas back/forward.
   * O polling garante captura de pushState sem monkey-patch.
   */
  function iniciarSpaPolling(): void {
    if (spaPollingId !== null) return

    spaPollingId = setInterval(() => {
      const novaUrl = location.href
      if (novaUrl !== urlAtual) {
        urlAtual = novaUrl
        // LOW-2: usa pathname via new URL para consistencia com o popstate handler
        // Apenas reage se for uma URL de reproducao (evita reagir a navegacao para catalogo)
        if (new URL(novaUrl).pathname.includes(MAX_WATCH_PATH)) {
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

  // Handler de popstate filtrado: reage apenas quando a URL resultante e /play/
  // (o polling ja filtra pushState; sem este filtro popstate reagia a qualquer
  //  navegacao back/forward, inclusive saindo do catalogo para a home).
  const spaPopstateHandler = (): void => {
    if (!window.location.pathname.includes(MAX_WATCH_PATH)) return
    spaNavegacaoHandler()
  }

  // Registra handler de popstate (back/forward do browser)
  window.addEventListener('popstate', spaPopstateHandler)

  // Inicia polling de URL para capturar pushState (troca de conteudo)
  iniciarSpaPolling()

  // Registra handlers nativos no video encontrado
  registrarHandlersNativos(video)

  // Configura observer de anuncio
  configurarAdObserver()

  // ---------------------------------------------------------------------------
  // Implementacao da interface ServiceAdapter
  // ---------------------------------------------------------------------------

  const adapter: ServiceAdapter = {
    /** Inicia reproducao no player Max */
    async play(): Promise<void> {
      await videoAtual.play()
    },

    /** Pausa reproducao no player Max */
    async pause(): Promise<void> {
      videoAtual.pause()
    },

    /** Salta para `secs` segundos no player Max */
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
      return detectarAnuncioMax()
    },

    /** Retorna o estado atual do player */
    getPlaybackState(): PlaybackState {
      if (detectarAnuncioMax()) return 'ad'
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
      // Cancela qualquer aguardarVideoMax em andamento
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
