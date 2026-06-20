// src/adapters/paramount.ts
// Adapter do Paramount+ para a extensao OpenParty.
//
// Controla o player via elemento <video> nativo em paginas paramountplus.com.
// Nao usa nenhuma API privada do Paramount+ - apenas HTMLVideoElement padrao.
//
// Heuristica de selecao do <video>:
//   1. Qualquer <video> na pagina validado por area minima e duracao conhecida.
//      O Paramount+ utiliza apenas um unico <video> na pagina durante reproducao,
//      conforme verificado em multiplas extensoes open source (Netflix-Prime-Auto-Skip,
//      Paramount-Tools) que usam document.querySelector("video") diretamente.
//   2. Fallback: entre todos os <video>, escolhe o de maior duracao.
//   3. Fallback final: video de maior area renderizada.
//
// Gate de path (rota de player):
//   So seleciona o <video> quando o pathname corresponde a rota de player:
//   - /shows/video/ (episodios de series)
//   - /movies/video/ (filmes)
//   SPA_PATH_REGEX valida o pathname antes de tentar encontrar o video.
//
// Navegacao SPA:
//   O Paramount+ troca de episodio via History API (pushState) sem recarregar a pagina.
//   Usamos dois mecanismos combinados:
//     - Listener em popstate (navegacao com back/forward)
//     - Polling leve de location.href a cada SPA_POLL_INTERVAL_MS, limpado no destroy()
//   Ambos verificam SPA_PATH_REGEX antes de acionar re-resolucao do video.
//
// Deteccao de anuncio (plano Essential com publicidade):
//   O Paramount+ exibe anuncios no mesmo elemento <video> principal.
//   Heuristicas de deteccao (do mais ao menos estavel):
//     1. Presenca de `div.ad-info-manager-circular-loader-copy` - container do
//        contador de tempo restante do anuncio (progressbar circular). Observado
//        em Dreamlinerm/Netflix-Prime-Auto-Skip e beingenfa/ad-muter-paramountplus.
//     2. Presenca de `div.ad-click-overlay` - overlay clicavel exibido durante
//        anuncios no plano Essential do Paramount+.
//     3. Presenca de `[class*="ad-info-manager"]` - fallback por correspondencia
//        parcial de classe, mais tolerante a variações de sufixo.
//   CR-MAJOR: so considera anuncio se o elemento estiver visivel (elementoVisivel).
//
// LIMITACAO CONHECIDA: Os seletores de anuncio do Paramount+ podem mudar com
// atualizacoes do player. Os seletores acima sao baseados em analise de extensoes
// open source ativas (Netflix-Prime-Auto-Skip, beingenfa/ad-muter-paramountplus) e
// na estrutura do DOM verificada por multiplos projetos. O seletor
// `div.ad-info-manager-circular-loader-copy` e o mais estavel por corresponder
// a um componente de UI de anuncio com nome semantico.

import type { AdapterEventName, PlaybackState, ServiceAdapter } from './interface'
import type { StreamingServiceType } from '../lib/sync'

// ---------------------------------------------------------------------------
// Constantes
// ---------------------------------------------------------------------------

/** Seletor fallback: qualquer <video> na pagina */
const VIDEO_SELETOR_FALLBACK = 'video'

/** Container de controles do player (usado no MutationObserver de anuncio) */
const PLAYER_CONTAINER_SELETOR = '.controls-bottom-right'

/** Container alternativo do player */
const PLAYER_CONTAINER_SELETOR_ALT = '.controls-bottom-center-wrapper'

/**
 * Seletores de UI de anuncio do Paramount+.
 * Listados do mais estavel (semantico) ao menos estavel (correspondencia parcial).
 * Fontes: Netflix-Prime-Auto-Skip/src/content-script/paramount.ts,
 *         beingenfa/ad-muter-paramountplus.
 */
const AD_SELETORES = [
  // Contador circular de tempo restante do anuncio Essential (mais estavel)
  'div.ad-info-manager-circular-loader-copy',
  // Overlay clicavel exibido durante reproducao de anuncio
  'div.ad-click-overlay',
  // Fallback por correspondencia parcial (tolera mudancas de sufixo)
  '[class*="ad-info-manager"]',
]

/** readyState minimo para considerar o <video> com metadados carregados */
const HAVE_METADATA = 2

/** Area minima (pixels quadrados) para considerar o <video> como player principal */
const VIDEO_AREA_MINIMA_PX2 = 40_000 // ~200x200px - descarta previews de hover

/** Tempo maximo de espera pelo <video> aparecer apos navegacao SPA (ms) */
const VIDEO_WAIT_TIMEOUT_MS = 8_000

/** Intervalo de polling interno do aguardarVideo (ms) */
const VIDEO_POLL_INTERVAL_MS = 300

/** Intervalo de polling para detectar navegacao SPA via pushState (ms) */
const SPA_POLL_INTERVAL_MS = 800

/**
 * MEDIUM-1: atraso minimo antes de re-selecionar o <video> apos navegacao SPA.
 * Evita retornar o elemento antigo que ainda permanece no DOM nos primeiros
 * 100-300ms apos a transicao de conteudo.
 */
const SPA_RENAVIGATE_DELAY_MS = 150

/**
 * Regex que identifica URLs de reproducao do Paramount+.
 * Cobre /shows/video/ (episodios de series) e /movies/video/ (filmes).
 * Usado para filtrar o popstate e o polling de SPA.
 */
const SPA_PATH_REGEX = /\/(shows|movies)\/video\//i

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
 * Verifica se um elemento <video> tem area de renderizacao suficiente para
 * ser considerado o player principal (descarta previews de hover do catalogo).
 */
function videoTemAreaSuficiente(v: HTMLVideoElement): boolean {
  const rect = v.getBoundingClientRect()
  return rect.width * rect.height >= VIDEO_AREA_MINIMA_PX2
}

/**
 * Seleciona o elemento <video> principal do player Paramount+.
 *
 * Gate de path: retorna null imediatamente se o pathname nao for de player.
 * O Paramount+ usa um unico <video> durante reproducao; heuristica de area
 * e duracao e usada como desempate em casos raros (ex: video de preview).
 *
 * Heuristica em ordem de prioridade:
 * 1. Unico <video> na pagina com area suficiente (caso mais comum)
 * 2. Entre multiplos <video>, escolhe o de maior duracao (conteudo > trailers)
 * 3. Entre multiplos <video>, escolhe o de maior area renderizada
 * 4. Primeiro candidato da lista (ultimo recurso)
 *
 * Retorna null se nenhum <video> adequado for encontrado ou se fora de rota de player.
 */
function selecionarVideoParamount(): HTMLVideoElement | null {
  // Gate de path: so seleciona em rota de player
  if (!SPA_PATH_REGEX.test(new URL(location.href).pathname)) return null

  const todos = Array.from(document.querySelectorAll<HTMLVideoElement>(VIDEO_SELETOR_FALLBACK))
  if (todos.length === 0) return null

  // Filtra por area minima antes de aplicar heuristica de duracao
  const comAreaSuficiente = todos.filter(videoTemAreaSuficiente)
  const candidatos = comAreaSuficiente.length > 0 ? comAreaSuficiente : todos

  // Caso comum: um unico candidato
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

  // Ultimo recurso: primeiro candidato da lista
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
 * Retorna true se o player Paramount+ esta exibindo um anuncio no momento.
 *
 * Verifica os seletores de UI de anuncio. Ver lista AD_SELETORES
 * e LIMITACAO CONHECIDA no cabecalho do arquivo.
 * CR-MAJOR: exige que o elemento de anuncio esteja visivel (elementoVisivel).
 */
function detectarAnuncioParamount(): boolean {
  for (const seletor of AD_SELETORES) {
    const el = document.querySelector(seletor)
    if (el && elementoVisivel(el)) return true
  }
  return false
}

/**
 * Aguarda o elemento <video> principal do Paramount+ aparecer no DOM.
 *
 * Usa MutationObserver como mecanismo primario e polling como fallback.
 * Respeita VIDEO_WAIT_TIMEOUT_MS antes de desistir e retornar null.
 * Aceita AbortSignal para cancelamento antecipado (destroy ou nova navegacao).
 */
async function aguardarVideoParamount(signal?: AbortSignal): Promise<HTMLVideoElement | null> {
  const existente = selecionarVideoParamount()
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
      const v = selecionarVideoParamount()
      if (v) encontrou(v)
    })
    observer.observe(document.body, { childList: true, subtree: true })

    // Polling como fallback (necessario quando o MutationObserver e throttled)
    pollingId = setInterval(() => {
      if (signal?.aborted) return
      const v = selecionarVideoParamount()
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
 * Cria o adapter do Paramount+ conectando ao elemento <video> nativo do player.
 *
 * Retorna null se nenhum elemento <video> adequado for encontrado na pagina
 * (ex: pagina inicial do Paramount+, catalogo sem reproducao ativa, ou rota
 * que nao corresponde a SPA_PATH_REGEX).
 *
 * SPA: Detecta mudanca de URL (troca de episodio/conteudo) via polling de
 * location.href e via popstate. Ao detectar mudanca em path de player, re-resolve
 * o <video> e reconfigura todos os listeners com token de sequencia para cancelar
 * navegacoes concorrentes.
 *
 * Anuncio: Observa a UI do player via MutationObserver para emitir ad-start/ad-end.
 * Exige que o elemento de anuncio esteja visivel antes de emitir o evento.
 */
export async function createParamountAdapter(): Promise<ServiceAdapter | null> {
  const video = await aguardarVideoParamount()
  if (!video) return null

  // Mapa de listeners: AdapterEventName -> conjunto de handlers do usuario
  const listenerMap = new Map<AdapterEventName, Set<() => void>>()

  // Handlers nativos registrados no video - guardados para remocao no destroy()
  let nativeHandlers = new Map<string, EventListener>()

  // Estado de anuncio anterior (para o MutationObserver de ad-start/ad-end)
  let eraAnuncio = detectarAnuncioParamount()

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

  // AbortController da aguardarVideoParamount em andamento.
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
   * Configura MutationObserver para detectar transicoes de anuncio no Paramount+.
   * Observa o container de controles do player ou o body como fallback.
   * Emite ad-start quando o anuncio comeca, ad-end quando termina.
   */
  function configurarAdObserver(): void {
    adObserver?.disconnect()

    // Observa o container primario, alternativo ou body como ultimo recurso
    const alvo =
      document.querySelector(PLAYER_CONTAINER_SELETOR) ??
      document.querySelector(PLAYER_CONTAINER_SELETOR_ALT) ??
      document.body

    adObserver = new MutationObserver(() => {
      const isAnuncio = detectarAnuncioParamount()
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
   * - Incrementa navigationSeq ao entrar; cancela o aguardarVideoParamount anterior.
   * - Apos cada await, verifica se o token ainda e o atual; se nao, aborta.
   * - Remove handlers do video anterior SOMENTE apos resolucao bem-sucedida,
   *   evitando estado zumbi quando aguardarVideoParamount expira sem resultado.
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
      // MEDIUM-1: aguarda um tick antes de re-selecionar para nao pegar o elemento
      // antigo que ainda permanece no DOM nos primeiros 100-300ms apos a navegacao SPA.
      await new Promise<void>((r) => setTimeout(r, SPA_RENAVIGATE_DELAY_MS))
      if (meuSeq !== navigationSeq || controller.signal.aborted) return false

      const novoVideo = await aguardarVideoParamount(controller.signal)

      // Verifica se a navegacao ainda e a mais recente
      if (meuSeq !== navigationSeq) return false
      if (controller.signal.aborted) return false

      if (!novoVideo) return false

      // Remove handlers do video anterior somente apos resolucao bem-sucedida
      removerHandlersNativos()
      registrarHandlersNativos(novoVideo)
      configurarAdObserver()
      eraAnuncio = detectarAnuncioParamount()
      console.debug('[OpenParty Paramount+] adapter re-ligado apos navegacao SPA')
      return true
    }

    const ok = await tentarReligar()

    // Retry leve - se timeout e ainda estamos em path de player, tenta mais uma vez
    if (!ok && meuSeq === navigationSeq && !controller.signal.aborted && SPA_PATH_REGEX.test(new URL(location.href).pathname)) {
      console.debug('[OpenParty Paramount+] retry de re-ligacao apos timeout em path de player')
      await tentarReligar()
    }

    if (meuSeq === navigationSeq) {
      aguardarAbortController = null
    }
  }

  const spaNavegacaoHandler = (): void => {
    onSpaNavegacao().catch((err) => {
      console.warn('[OpenParty Paramount+] erro ao religar adapter apos SPA:', err)
    })
  }

  /**
   * Inicia o polling leve de location.href para detectar mudancas de URL SPA.
   * O Paramount+ usa pushState ao trocar de episodio; popstate cobre apenas back/forward.
   */
  function iniciarSpaPolling(): void {
    if (spaPollingId !== null) return

    spaPollingId = setInterval(() => {
      const novaUrl = location.href
      if (novaUrl !== urlAtual) {
        urlAtual = novaUrl
        // LOW-2: usa pathname via new URL para consistencia com o popstate handler e o retry
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

  // Configura observer de anuncio
  configurarAdObserver()

  // ---------------------------------------------------------------------------
  // Implementacao da interface ServiceAdapter
  // ---------------------------------------------------------------------------

  const adapter: ServiceAdapter = {
    /** Inicia reproducao no player Paramount+ */
    async play(): Promise<void> {
      await videoAtual.play()
    },

    /** Pausa reproducao no player Paramount+ */
    async pause(): Promise<void> {
      videoAtual.pause()
    },

    /** Salta para `secs` segundos no player Paramount+ */
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
      return detectarAnuncioParamount()
    },

    /** Retorna o estado atual do player */
    getPlaybackState(): PlaybackState {
      if (detectarAnuncioParamount()) return 'ad'
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
      // Cancela qualquer aguardarVideoParamount em andamento
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
