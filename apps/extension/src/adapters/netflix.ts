// src/adapters/netflix.ts
// Adapter de Netflix para a extensao OpenParty.
//
// Controla o player via elemento <video> nativo em paginas netflix.com/watch/*.
// Nao usa nenhuma API privada do Netflix - apenas HTMLVideoElement padrao.
//
// Heuristica de selecao do <video>:
//   1. Tenta o seletor especifico do container do player: `.watch-video--player-view video`
//   2. Fallback: todos os elementos <video> da pagina, filtrando por:
//      - readyState >= HAVE_METADATA (2), ou seja, duracao conhecida
//      - Maior duracao (o conteudo principal sempre tem duracao > trailers curtos)
//      - Alternativa: maior area renderizada (offsetWidth * offsetHeight)
//   O primeiro criterio estavel encontrado vence.
//
// Navegacao SPA:
//   O Netflix troca de episodio via History API (pushState) sem recarregar a pagina.
//   Como o Netflix nao emite um evento customizado (ao contrario do YouTube com
//   yt-navigate-finish), usamos dois mecanismos combinados:
//     - Listener em popstate (navegacao com back/forward)
//     - Polling leve de location.href a cada SPA_POLL_INTERVAL_MS (apenas enquanto
//       o adapter estiver ativo), limpado no destroy()
//
// Deteccao de anuncio:
//   O Netflix exibe anuncios (plano basico com publicidade) no mesmo elemento <video>.
//   Heuristicas de deteccao (do mais ao menos confiavel):
//     1. Atributo `data-uia` nos elementos de UI do player: procura por valores que
//        indiquem controles de anuncio ('ad-ui', 'ad-skip-button', 'ad-countdown').
//     2. Elemento com seletor `.watch-video--skip-ad` ou `.ltr-fkm5f6` presente no DOM.
//     3. Presenca do container `.nf-player-container [class*="AdBreak"]`
//   Estas heuristicas sao observadas via MutationObserver no container do player.
//   LIMITACAO CONHECIDA: Os seletores de UI de anuncio do Netflix sao ofuscados
//   periodicamente (classes CSS com hashes como `.ltr-xxxxx`). A heuristica pode
//   precisar de atualizacao se o Netflix mudar a estrutura do DOM. A deteccao por
//   data-uia e mais estavel pois e um atributo de acessibilidade.

import type { AdapterEventName, PlaybackState, ServiceAdapter } from './interface'
import type { StreamingServiceType } from '../lib/sync'

// ---------------------------------------------------------------------------
// Constantes
// ---------------------------------------------------------------------------

/** Seletor preferencial do <video> no container do player de watch */
const VIDEO_SELETOR_PRIMARIO = '.watch-video--player-view video'

/** Seletor fallback - qualquer <video> na pagina */
const VIDEO_SELETOR_FALLBACK = 'video'

/** Container geral do player Netflix (usado para o MutationObserver de anuncio) */
const PLAYER_CONTAINER_SELETOR = '.watch-video'

/** Seletores de UI de anuncio do Netflix (do mais estavel ao menos estavel) */
const AD_SELETORES = [
  '[data-uia="ad-ui"]',
  '[data-uia="ad-skip-button"]',
  '[data-uia="ad-countdown"]',
  '.watch-video--skip-ad',
  '.nfp-ad-ui',
]

/** readyState minimo para considerar o <video> carregado */
const HAVE_METADATA = 2

/** Area minima (pixels quadrados) para considerar o <video> como player principal e nao preview */
const VIDEO_AREA_MINIMA_PX2 = 40_000 // ~200x200px - exclui previews de hover

/** Tempo maximo de espera pelo <video> aparecer (ms) */
const VIDEO_WAIT_TIMEOUT_MS = 8_000

/** Intervalo de polling fallback dentro de aguardarVideo (ms) */
const VIDEO_POLL_INTERVAL_MS = 300

/** Intervalo de polling para detectar navegacao SPA (ms) */
const SPA_POLL_INTERVAL_MS = 800

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
 * ser considerado o player principal (nao um preview de hover).
 *
 * M1: usa getBoundingClientRect para obter dimensoes reais renderizadas
 * (mais preciso que offsetWidth/offsetHeight para elementos transformed).
 */
function videoTemAreaSuficiente(v: HTMLVideoElement): boolean {
  const rect = v.getBoundingClientRect()
  return rect.width * rect.height >= VIDEO_AREA_MINIMA_PX2
}

/**
 * Seleciona o elemento <video> principal do player Netflix.
 *
 * Heuristica em ordem de prioridade:
 * 1. Seletor especifico do container `.watch-video--player-view video`
 *    - M1: validado por area minima para excluir previews de hover
 * 2. Entre todos os <video> da pagina com area suficiente, escolhe o de maior duracao
 * 3. Entre todos os <video> da pagina, escolhe o de maior area renderizada
 *
 * Retorna null se nenhum <video> adequado for encontrado.
 */
function selecionarVideoNetflix(): HTMLVideoElement | null {
  // Tentativa 1: seletor especifico do player de watch
  // M1: valida area minima para excluir preview de hover com o mesmo seletor
  const primario = document.querySelector<HTMLVideoElement>(VIDEO_SELETOR_PRIMARIO)
  if (primario && videoTemAreaSuficiente(primario)) return primario

  // Tentativa 2 e 3: entre todos os videos, filtra e escolhe o mais adequado
  const todos = Array.from(document.querySelectorAll<HTMLVideoElement>(VIDEO_SELETOR_FALLBACK))
  if (todos.length === 0) return null

  // M1: filtra por area minima antes de aplicar heuristica de duracao
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
 * Retorna true se o player Netflix esta exibindo um anuncio no momento.
 *
 * Verifica os seletores de UI de anuncio do Netflix. Ver lista AD_SELETORES
 * e LIMITACAO CONHECIDA no cabecalho do arquivo.
 */
function detectarAnuncioNetflix(): boolean {
  for (const seletor of AD_SELETORES) {
    if (document.querySelector(seletor)) return true
  }
  return false
}

/**
 * Aguarda o elemento <video> principal do Netflix aparecer no DOM.
 *
 * Usa MutationObserver como mecanismo primario e polling como fallback.
 * Respeita VIDEO_WAIT_TIMEOUT_MS antes de desistir e retornar null.
 * Aceita AbortSignal para cancelamento antecipado (destroy ou nova navegacao).
 */
async function aguardarVideoNetflix(signal?: AbortSignal): Promise<HTMLVideoElement | null> {
  const existente = selecionarVideoNetflix()
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

    const cancelar = (): void => {
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
      const v = selecionarVideoNetflix()
      if (v) encontrou(v)
    })
    observer.observe(document.body, { childList: true, subtree: true })

    // Polling como fallback (necessario quando o MutationObserver e throttled)
    pollingId = setInterval(() => {
      if (signal?.aborted) return
      const v = selecionarVideoNetflix()
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
 * Cria o adapter do Netflix conectando ao elemento <video> nativo do player.
 *
 * Retorna null se nenhum elemento <video> adequado for encontrado na pagina
 * (ex: pagina inicial do Netflix, catalogo sem reproducao ativa).
 *
 * SPA: Detecta mudanca de URL (troca de episodio/conteudo) via polling de
 * location.href e via popstate. Ao detectar mudanca em /watch/:id, re-resolve
 * o <video> e reconfigura todos os listeners.
 *
 * Anuncio: Observa a UI do player via MutationObserver para emitir ad-start/ad-end.
 */
export async function createNetflixAdapter(): Promise<ServiceAdapter | null> {
  const video = await aguardarVideoNetflix()
  if (!video) return null

  // Mapa de listeners: AdapterEventName -> conjunto de handlers do usuario
  const listenerMap = new Map<AdapterEventName, Set<() => void>>()

  // Handlers nativos registrados no video - guardados para remocao no destroy()
  let nativeHandlers = new Map<string, EventListener>()

  // Estado de anuncio anterior (para o MutationObserver de ad-start/ad-end)
  let eraAnuncio = detectarAnuncioNetflix()

  // Observer para detectar transicao de anuncio
  let adObserver: MutationObserver | null = null

  // Referencia ao elemento video atual (pode mudar em navegacao SPA)
  let videoAtual: HTMLVideoElement = video

  // URL atual - usada para detectar mudanca de episodio/conteudo via polling
  let urlAtual = location.href

  // ID do intervalo de polling de URL (SPA)
  let spaPollingId: ReturnType<typeof setInterval> | null = null

  // HIGH-2: token de sequencia incrementado a cada navegacao SPA.
  // Apos cada await em onSpaNavegacao, verificamos se o token ainda e o atual.
  // Se nao for, a navegacao foi superada por uma mais recente e devemos abortar.
  let navigationSeq = 0

  // HIGH-2: AbortController da aguardarVideoNetflix em andamento.
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
   * Observa o container do player e o body como fallback.
   * Emite ad-start quando o anuncio comeca, ad-end quando termina.
   */
  function configurarAdObserver(): void {
    adObserver?.disconnect()

    // Observa o container do player ou o body como fallback
    const alvo = document.querySelector(PLAYER_CONTAINER_SELETOR) ?? document.body

    adObserver = new MutationObserver(() => {
      const isAnuncio = detectarAnuncioNetflix()
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
      attributeFilter: ['data-uia', 'class'],
    })
  }

  // ---------------------------------------------------------------------------
  // Deteccao de navegacao SPA
  // ---------------------------------------------------------------------------

  /**
   * Chamado quando detectamos mudanca de URL (troca de episodio ou conteudo).
   * Re-resolve o <video> e reconfigura todos os listeners.
   *
   * HIGH-2: single-flight por token de sequencia.
   * - Incrementa navigationSeq ao entrar; cancela o aguardarVideoNetflix anterior.
   * - Apos cada await, verifica se o token ainda e o atual; se nao, aborta.
   * - M2: remove handlers do video anterior SOMENTE apos resolucao bem-sucedida,
   *   evitando estado zumbi quando aguardarVideoNetflix expira sem resultado.
   * - M2: retry leve enquanto estiver em /watch/ (uma nova tentativa apos timeout).
   */
  async function onSpaNavegacao(): Promise<void> {
    // HIGH-2: cancela qualquer aguardar em andamento e captura o token local
    aguardarAbortController?.abort()
    const controller = new AbortController()
    aguardarAbortController = controller

    navigationSeq++
    const meuSeq = navigationSeq

    const tentarReligar = async (): Promise<boolean> => {
      const novoVideo = await aguardarVideoNetflix(controller.signal)

      // HIGH-2: verifica se a navegacao ainda e a mais recente
      if (meuSeq !== navigationSeq) return false
      if (controller.signal.aborted) return false

      if (!novoVideo) return false

      // M2: remove handlers do video anterior somente apos resolucao bem-sucedida
      removerHandlersNativos()
      registrarHandlersNativos(novoVideo)
      configurarAdObserver()
      eraAnuncio = detectarAnuncioNetflix()
      console.debug('[OpenParty Netflix] adapter re-ligado apos navegacao SPA')
      return true
    }

    const ok = await tentarReligar()

    // M2: retry leve - se timeout e ainda estamos em /watch/, tenta mais uma vez
    if (!ok && meuSeq === navigationSeq && !controller.signal.aborted && location.href.includes('/watch/')) {
      console.debug('[OpenParty Netflix] retry de re-ligacao apos timeout em /watch/')
      await tentarReligar()
    }

    if (meuSeq === navigationSeq) {
      aguardarAbortController = null
    }
  }

  const spaNavegacaoHandler = (): void => {
    onSpaNavegacao().catch((err) => {
      console.warn('[OpenParty Netflix] erro ao religar adapter apos SPA:', err)
    })
  }

  /**
   * Inicia o polling leve de location.href para detectar mudancas de URL SPA.
   * O Netflix usa pushState ao trocar de episodio; popstate cobre apenas back/forward.
   * O polling garante captura de pushState sem monkey-patch.
   */
  function iniciarSpaPolling(): void {
    if (spaPollingId !== null) return

    spaPollingId = setInterval(() => {
      const novaUrl = location.href
      if (novaUrl !== urlAtual) {
        urlAtual = novaUrl
        // Apenas reage se for uma URL de watch (evita reagir a navegacao para catalogo)
        if (novaUrl.includes('/watch/')) {
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

  // Handler de popstate filtrado: reage apenas quando a URL resultante e /watch/
  // (o polling ja filtra pushState; sem este filtro popstate reagia a qualquer
  //  navegacao back/forward, inclusive saindo do catalogo para a home).
  const spaPopstateHandler = (): void => {
    if (!window.location.pathname.includes('/watch/')) return
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
    /** Inicia reproducao no player Netflix */
    async play(): Promise<void> {
      await videoAtual.play()
    },

    /** Pausa reproducao no player Netflix */
    async pause(): Promise<void> {
      videoAtual.pause()
    },

    /** Salta para `secs` segundos no player Netflix */
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
      return detectarAnuncioNetflix()
    },

    /** Retorna o estado atual do player */
    getPlaybackState(): PlaybackState {
      if (detectarAnuncioNetflix()) return 'ad'
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
      // HIGH-2: cancela qualquer aguardarVideoNetflix em andamento
      aguardarAbortController?.abort()
      aguardarAbortController = null

      // HIGH-2: invalida qualquer onSpaNavegacao em voo incrementando o token
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
