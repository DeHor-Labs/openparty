// src/adapters/prime.ts
// Adapter do Prime Video para a extensao OpenParty.
//
// Controla o player via elemento <video> nativo em paginas primevideo.com.
// Nao usa nenhuma API privada da Amazon - apenas HTMLVideoElement padrao.
//
// NOTA DE COBERTURA: Este adapter foca em www.primevideo.com. O player embutido
// em amazon.com/gp/video/ usa a mesma estrutura de DOM, mas pode precisar de
// ajuste no filtro de path do popstate (ver SPA_PATH_REGEX abaixo).
//
// Heuristica de selecao do <video>:
//   1. Seletor especifico do container do player: `.dv-player-fullscreen video`
//      - Validado por area minima para excluir previews de hover do catalogo
//   2. Fallback: `.webPlayerSDKContainer video` e `.webPlayerContainer video`
//      - Mesmos criterios de area minima
//   3. Fallback geral: todos os <video> da pagina, filtrados por:
//      - readyState >= HAVE_METADATA (2): duracao conhecida
//      - Maior duracao (conteudo principal sempre mais longo que trailers)
//      - Alternativa: maior area renderizada (offsetWidth * offsetHeight)
//   O primeiro criterio estavel encontrado vence.
//
// Navegacao SPA:
//   O Prime Video troca de episodio e titulo via History API (pushState) sem
//   recarregar a pagina. Usamos dois mecanismos combinados:
//     - Listener em popstate (navegacao com back/forward)
//     - Polling leve de location.href a cada SPA_POLL_INTERVAL_MS (apenas enquanto
//       o adapter estiver ativo), limpado no destroy()
//   O handler de popstate filtra por URLs que contenham path de player (/gp/video/
//   ou /detail/ ou /video/detail/) para evitar reagir a navegacao fora do player.
//
// Deteccao de anuncio (Freevee / Amazon Ads):
//   O Prime Video exibe anuncios da Freevee e anuncios proprios da Amazon no mesmo
//   elemento <video> principal. Heuristicas de deteccao (do mais ao menos estavel):
//     1. Presenca de `.atvwebplayersdk-ad-timer-remaining-time` com visibilidade -
//        indicador do contador de tempo do anuncio Freevee (estavel, SDK-level)
//     2. Presenca de `.atvwebplayersdk-adtimeindicator-text` - texto de tempo do
//        anuncio self-service da Amazon (ex: "Ad :30")
//     3. Presenca de `#dv-web-player` com display != none E container de ad-UI:
//        `.atvwebplayersdk-overlays-container` com filho `.fu4rd6c` (menos estavel)
//   LIMITACAO CONHECIDA: As classes com prefixo `f1` e `f[0-9]` do Prime Video sao
//   geradas por framework de styling atomico e mudam com atualizacoes de deploy.
//   Usar preferencialmente seletores com prefixo `atvwebplayersdk-` que sao parte
//   do SDK publico do player e mais estaveis.
//
// Deteccao SPA:
//   O Prime Video nao emite evento customizado de navegacao. Usamos polling de
//   location.href como mecanismo primario e popstate como secundario (back/forward).
//   Ambos chamam o mesmo onSpaNavegacao() que re-resolve o <video> e reconfigura
//   os listeners com token de sequencia para cancelar navegacoes concorrentes.
//
// Religacao de video:
//   Ao trocar de episodio, o mesmo elemento <video> pode ser reutilizado pelo
//   SDK do player, ou um novo pode ser inserido. O adapter re-resolve o video
//   apos cada navegacao SPA detectada (com retry se timeout).

import type { AdapterEventName, PlaybackState, ServiceAdapter } from './interface'
import type { StreamingServiceType } from '../lib/sync'

// ---------------------------------------------------------------------------
// Constantes
// ---------------------------------------------------------------------------

/** Seletor preferencial: container especifico do player fullscreen do Prime */
const VIDEO_SELETOR_PRIMARIO = '.dv-player-fullscreen video'

/** Seletor alternativo 1: container do SDK do player web (mais recente) */
const VIDEO_SELETOR_SDK = '.webPlayerSDKContainer video'

/** Seletor alternativo 2: container legado do player web */
const VIDEO_SELETOR_SDK_LEGADO = '.webPlayerContainer video'

/** Seletor fallback final: qualquer <video> na pagina */
const VIDEO_SELETOR_FALLBACK = 'video'

/** Container geral do player Prime (usado para MutationObserver de anuncio) */
const PLAYER_CONTAINER_SELETOR = '.dv-player-fullscreen'

/** Container alternativo do player (usado como fallback no MutationObserver) */
const PLAYER_CONTAINER_SELETOR_ALT = '#dv-web-player'

/**
 * Seletores de UI de anuncio do Prime Video.
 * Prefixo `atvwebplayersdk-` e parte do SDK publico - mais estavel.
 * Classes atomicas como `fu4rd6c` mudam com deploys - usadas como fallback.
 */
const AD_SELETORES = [
  // Contador de tempo restante do anuncio Freevee (mais estavel)
  '.atvwebplayersdk-ad-timer-remaining-time',
  // Texto de indicador de tempo de anuncio self-service ("Ad :30")
  '.atvwebplayersdk-adtimeindicator-text',
  // Overlay de controles de anuncio (menos estavel - classe atomica)
  '.atvwebplayersdk-overlays-container .fu4rd6c',
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
 * Regex que identifica URLs de reproducao do Prime Video.
 * Cobre primevideo.com/detail/ e amazon.com/gp/video/.
 * Usado para filtrar o popstate e o polling de SPA.
 */
const SPA_PATH_REGEX = /\/(gp\/video|detail|video\/detail)\//i

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
 * Seleciona o elemento <video> principal do player Prime Video.
 *
 * Heuristica em ordem de prioridade:
 * 1. `.dv-player-fullscreen video` - container do player fullscreen (mais estavel)
 *    - M1: validado por area minima para excluir previews de hover do catalogo
 * 2. `.webPlayerSDKContainer video` e `.webPlayerContainer video` - containers SDK
 * 3. Entre todos os <video> da pagina com area suficiente, escolhe o de maior duracao
 * 4. Entre todos os <video> da pagina, escolhe o de maior area renderizada
 *
 * Retorna null se nenhum <video> adequado for encontrado.
 */
function selecionarVideoPrime(): HTMLVideoElement | null {
  // Tentativa 1: seletor primario do container fullscreen
  const primario = document.querySelector<HTMLVideoElement>(VIDEO_SELETOR_PRIMARIO)
  if (primario && videoTemAreaSuficiente(primario)) return primario

  // Tentativa 2: container do SDK (mais recente)
  const sdk = document.querySelector<HTMLVideoElement>(VIDEO_SELETOR_SDK)
  if (sdk && videoTemAreaSuficiente(sdk)) return sdk

  // Tentativa 3: container SDK legado
  const sdkLegado = document.querySelector<HTMLVideoElement>(VIDEO_SELETOR_SDK_LEGADO)
  if (sdkLegado && videoTemAreaSuficiente(sdkLegado)) return sdkLegado

  // Tentativa 4 e 5: entre todos os videos, filtra e escolhe o mais adequado
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
 * Retorna true se o player Prime Video esta exibindo um anuncio no momento.
 *
 * Verifica os seletores de UI de anuncio do Prime Video. Ver lista AD_SELETORES
 * e LIMITACAO CONHECIDA no cabecalho do arquivo.
 * CR-MAJOR: exige que o elemento de anuncio esteja visivel (elementoVisivel).
 */
function detectarAnuncioPrime(): boolean {
  for (const seletor of AD_SELETORES) {
    const el = document.querySelector(seletor)
    if (el && elementoVisivel(el)) return true
  }
  return false
}

/**
 * Aguarda o elemento <video> principal do Prime Video aparecer no DOM.
 *
 * Usa MutationObserver como mecanismo primario e polling como fallback.
 * Respeita VIDEO_WAIT_TIMEOUT_MS antes de desistir e retornar null.
 * Aceita AbortSignal para cancelamento antecipado (destroy ou nova navegacao).
 */
async function aguardarVideoPrime(signal?: AbortSignal): Promise<HTMLVideoElement | null> {
  const existente = selecionarVideoPrime()
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
      const v = selecionarVideoPrime()
      if (v) encontrou(v)
    })
    observer.observe(document.body, { childList: true, subtree: true })

    // Polling como fallback (necessario quando o MutationObserver e throttled)
    pollingId = setInterval(() => {
      if (signal?.aborted) return
      const v = selecionarVideoPrime()
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
 * Cria o adapter do Prime Video conectando ao elemento <video> nativo do player.
 *
 * Retorna null se nenhum elemento <video> adequado for encontrado na pagina
 * (ex: pagina inicial do Prime Video, catalogo sem reproducao ativa).
 *
 * SPA: Detecta mudanca de URL (troca de episodio/conteudo) via polling de
 * location.href e via popstate. Ao detectar mudanca em path de player, re-resolve
 * o <video> e reconfigura todos os listeners.
 *
 * Anuncio: Observa a UI do player via MutationObserver para emitir ad-start/ad-end.
 */
export async function createPrimeVideoAdapter(): Promise<ServiceAdapter | null> {
  const video = await aguardarVideoPrime()
  if (!video) return null

  // Mapa de listeners: AdapterEventName -> conjunto de handlers do usuario
  const listenerMap = new Map<AdapterEventName, Set<() => void>>()

  // Handlers nativos registrados no video - guardados para remocao no destroy()
  let nativeHandlers = new Map<string, EventListener>()

  // Estado de anuncio anterior (para o MutationObserver de ad-start/ad-end)
  let eraAnuncio = detectarAnuncioPrime()

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

  // AbortController da aguardarVideoPrime em andamento.
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
   * Configura MutationObserver para detectar transicoes de anuncio no Prime Video.
   * Observa o container do player ou o body como fallback.
   * Emite ad-start quando o anuncio comeca, ad-end quando termina.
   */
  function configurarAdObserver(): void {
    adObserver?.disconnect()

    // Observa o container primario, o alternativo ou o body como ultimo recurso
    const alvo =
      document.querySelector(PLAYER_CONTAINER_SELETOR) ??
      document.querySelector(PLAYER_CONTAINER_SELETOR_ALT) ??
      document.body

    adObserver = new MutationObserver(() => {
      const isAnuncio = detectarAnuncioPrime()
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
   * - Incrementa navigationSeq ao entrar; cancela o aguardarVideoPrime anterior.
   * - Apos cada await, verifica se o token ainda e o atual; se nao, aborta.
   * - Remove handlers do video anterior SOMENTE apos resolucao bem-sucedida,
   *   evitando estado zumbi quando aguardarVideoPrime expira sem resultado.
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

      const novoVideo = await aguardarVideoPrime(controller.signal)

      // Verifica se a navegacao ainda e a mais recente
      if (meuSeq !== navigationSeq) return false
      if (controller.signal.aborted) return false

      if (!novoVideo) return false

      // Remove handlers do video anterior somente apos resolucao bem-sucedida
      removerHandlersNativos()
      registrarHandlersNativos(novoVideo)
      configurarAdObserver()
      eraAnuncio = detectarAnuncioPrime()
      console.debug('[OpenParty Prime] adapter re-ligado apos navegacao SPA')
      return true
    }

    const ok = await tentarReligar()

    // Retry leve - se timeout e ainda estamos em path de player, tenta mais uma vez
    if (!ok && meuSeq === navigationSeq && !controller.signal.aborted && SPA_PATH_REGEX.test(location.pathname)) {
      console.debug('[OpenParty Prime] retry de re-ligacao apos timeout em path de player')
      await tentarReligar()
    }

    if (meuSeq === navigationSeq) {
      aguardarAbortController = null
    }
  }

  const spaNavegacaoHandler = (): void => {
    onSpaNavegacao().catch((err) => {
      console.warn('[OpenParty Prime] erro ao religar adapter apos SPA:', err)
    })
  }

  /**
   * Inicia o polling leve de location.href para detectar mudancas de URL SPA.
   * O Prime Video usa pushState ao trocar de episodio; popstate cobre apenas back/forward.
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
    /** Inicia reproducao no player Prime Video */
    async play(): Promise<void> {
      await videoAtual.play()
    },

    /** Pausa reproducao no player Prime Video */
    async pause(): Promise<void> {
      videoAtual.pause()
    },

    /** Salta para `secs` segundos no player Prime Video */
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
      return detectarAnuncioPrime()
    },

    /** Retorna o estado atual do player */
    getPlaybackState(): PlaybackState {
      if (detectarAnuncioPrime()) return 'ad'
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
      // Cancela qualquer aguardarVideoPrime em andamento
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
