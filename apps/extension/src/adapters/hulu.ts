// src/adapters/hulu.ts
// Adapter do Hulu para a extensao OpenParty.
//
// Controla o player via elemento <video> nativo em paginas hulu.com/watch/:id.
// Nao usa nenhuma API privada do Hulu - apenas HTMLVideoElement padrao.
//
// Heuristica de selecao do <video>:
//   1. Seletor especifico do container do player: `#content-video-player video`
//      - Validado por area minima para excluir previews de hover do catalogo
//   2. Fallback por classes do player:
//      - `[class*="PlayerControls"] video` (controles embutidos no container)
//      - `.PlayerControls--control-element video`
//   3. Fallback geral: todos os <video> da pagina filtrados por:
//      - readyState >= HAVE_METADATA: duracao conhecida
//      - Maior duracao (conteudo principal sempre maior que trailers)
//      - Alternativa: maior area renderizada (offsetWidth * offsetHeight)
//   O primeiro criterio estavel encontrado vence.
//
// Gate de path:
//   O adapter so seleciona o <video> quando a URL e de player (/watch/).
//   Fora do player (catalogo, home), selecionarVideoHulu() retorna null.
//
// Navegacao SPA:
//   O Hulu troca de episodio via History API (pushState) sem recarregar a pagina.
//   Usamos dois mecanismos combinados:
//     - Listener em popstate (navegacao com back/forward)
//     - Polling leve de location.href a cada SPA_POLL_INTERVAL_MS, limpado no destroy()
//   O handler de popstate filtra por URLs que contenham /watch/ para evitar
//   reagir a navegacao fora do player.
//
// Deteccao de anuncio (SSAI - Server-Side Ad Insertion):
//   O Hulu usa SSAI na maior parte dos seus planos com publicidade: os anuncios sao
//   inseridos diretamente no stream, sem trocar o elemento <video> nem a URL.
//   Por isso a deteccao e feita por elementos de UI sobrepostos ao player
//   que aparecem durante os intervalos comerciais. Heuristicas (do mais ao menos
//   estavel):
//     1. `[data-testid="ads-ui"]` - container de UI de anuncio (data-testid estavel)
//     2. `[data-testid="ad-badge"]` - badge de anuncio (ex: "AD" no canto)
//     3. `.HuluPlayer--ad-container` - container de anuncio do player Hulu
//     4. `[class*="AdBreakBadge"]` - badge gerado dinamicamente com hash de classe
//     5. `[class*="ad-ui-container"]` - container generico de UI de anuncio
//   LIMITACAO CONHECIDA: O Hulu usa CSS Modules com hashes nas classes (ex: `_3Aas2`).
//   Seletores baseados em `[class*="..."]` podem quebrar em deploys. Preferir
//   sempre atributos `data-testid` que sao mais estaveis (mantidos para QA interno).
//
// Seletores pesquisados e validados (fontes: inspecao do DOM publico do Hulu,
// extensoes de watch party da comunidade, CSS publico do hulu.com):
//   - Video: #content-video-player video (container principal do player)
//   - Anuncio: [data-testid="ads-ui"], [data-testid="ad-badge"]
//   - Rota de player: /watch/:id

import type { AdapterEventName, PlaybackState, ServiceAdapter } from './interface'
import type { StreamingServiceType } from '../lib/sync'

// ---------------------------------------------------------------------------
// Constantes
// ---------------------------------------------------------------------------

/** Seletor preferencial: container interno do player de video do Hulu */
const VIDEO_SELETOR_PRIMARIO = '#content-video-player video'

/** Seletor alternativo 1: video dentro de qualquer elemento com classe PlayerControls */
const VIDEO_SELETOR_PLAYER_CONTROLS = '[class*="PlayerControls"] video'

/** Seletor alternativo 2: video dentro do elemento de controle individual */
const VIDEO_SELETOR_CONTROLE = '.PlayerControls--control-element video'

/** Seletor fallback final: qualquer <video> na pagina */
const VIDEO_SELETOR_FALLBACK = 'video'

/** Container geral do player Hulu (usado para MutationObserver de anuncio) */
const PLAYER_CONTAINER_SELETOR = '#content-video-player'

/** Container alternativo (fallback para o MutationObserver) */
const PLAYER_CONTAINER_SELETOR_ALT = '[class*="PlayerControls"]'

/**
 * Seletores de UI de anuncio do Hulu.
 * data-testid e mais estavel pois e mantido para testes de QA internos.
 * Seletores com [class*="..."] cobrem variantes com CSS Modules mas sao
 * mais frageis a deploys.
 */
const AD_SELETORES = [
  // Container de UI de anuncio - data-testid (mais estavel)
  '[data-testid="ads-ui"]',
  // Badge de anuncio - data-testid (estavel)
  '[data-testid="ad-badge"]',
  // Container de anuncio do player Hulu (semi-estavel)
  '.HuluPlayer--ad-container',
  // Badge de intervalo comercial com classe CSS Modules (menos estavel)
  '[class*="AdBreakBadge"]',
  // Container generico de UI de anuncio com CSS Modules (menos estavel)
  '[class*="ad-ui-container"]',
]

/**
 * Regex que identifica URLs de reproducao do Hulu.
 * Cobre hulu.com/watch/:id.
 */
const SPA_PATH_REGEX = /\/watch\//i

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
 * Atraso minimo antes de re-selecionar o <video> apos navegacao SPA.
 * Evita retornar o elemento antigo que ainda permanece no DOM nos primeiros
 * 100-300ms apos a transicao de conteudo.
 */
const SPA_RENAVIGATE_DELAY_MS = 150

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
 * Retorna true se o pathname atual e de uma rota de player do Hulu (/watch/).
 * Usado como gate para evitar selecionar video fora do player.
 */
function eRotaDePlayer(): boolean {
  const pathname = new URL(location.href).pathname
  return SPA_PATH_REGEX.test(pathname)
}

/**
 * Verifica se um elemento <video> tem area de renderizacao suficiente para
 * ser considerado o player principal (descarta previews de hover do catalogo).
 */
function videoTemAreaSuficiente(v: HTMLVideoElement): boolean {
  const rect = v.getBoundingClientRect()
  return rect.width * rect.height >= VIDEO_AREA_MINIMA_PX2
}

/**
 * Seleciona o elemento <video> principal do player Hulu.
 *
 * Gate de path: retorna null se nao estivermos em rota de player (/watch/).
 *
 * Heuristica em ordem de prioridade:
 * 1. `#content-video-player video` - container primario do player de watch
 *    - Validado por area minima para excluir previews de hover
 * 2. `[class*="PlayerControls"] video` - container de controles do player
 * 3. `.PlayerControls--control-element video` - variante de controle individual
 * 4. Entre todos os <video> da pagina com area suficiente, escolhe o de maior duracao
 * 5. Entre todos os <video> da pagina, escolhe o de maior area renderizada
 *
 * Retorna null se nenhum <video> adequado for encontrado.
 */
function selecionarVideoHulu(): HTMLVideoElement | null {
  // Gate de path: so seleciona em rota de player
  if (!eRotaDePlayer()) return null

  // Tentativa 1: seletor primario do container do player
  const primario = document.querySelector<HTMLVideoElement>(VIDEO_SELETOR_PRIMARIO)
  if (primario && videoTemAreaSuficiente(primario)) return primario

  // Tentativa 2: container de controles do player (classe CSS Modules)
  const playerControls = document.querySelector<HTMLVideoElement>(VIDEO_SELETOR_PLAYER_CONTROLS)
  if (playerControls && videoTemAreaSuficiente(playerControls)) return playerControls

  // Tentativa 3: variante de controle individual
  const controle = document.querySelector<HTMLVideoElement>(VIDEO_SELETOR_CONTROLE)
  if (controle && videoTemAreaSuficiente(controle)) return controle

  // Tentativas 4 e 5: entre todos os videos, filtra e escolhe o mais adequado
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
 * Impede que um elemento de anuncio oculto (display:none, visibility:hidden,
 * opacity:0 ou sem layout) dispare isAd() incorretamente, prendendo o sync
 * em modo de anuncio sem razao.
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
 * Retorna true se o player Hulu esta exibindo um anuncio no momento.
 *
 * Verifica os seletores de UI de anuncio do Hulu. Ver lista AD_SELETORES
 * e LIMITACAO CONHECIDA no cabecalho do arquivo.
 * Exige que o elemento de anuncio esteja visivel (elementoVisivel).
 */
function detectarAnuncioHulu(): boolean {
  for (const seletor of AD_SELETORES) {
    const el = document.querySelector(seletor)
    if (el && elementoVisivel(el)) return true
  }
  return false
}

/**
 * Aguarda o elemento <video> principal do Hulu aparecer no DOM.
 *
 * Usa MutationObserver como mecanismo primario e polling como fallback.
 * Respeita VIDEO_WAIT_TIMEOUT_MS antes de desistir e retornar null.
 * Aceita AbortSignal para cancelamento antecipado (destroy ou nova navegacao).
 */
async function aguardarVideoHulu(signal?: AbortSignal): Promise<HTMLVideoElement | null> {
  const existente = selecionarVideoHulu()
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
      const v = selecionarVideoHulu()
      if (v) encontrou(v)
    })
    observer.observe(document.body, { childList: true, subtree: true })

    // Polling como fallback (necessario quando o MutationObserver e throttled)
    pollingId = setInterval(() => {
      if (signal?.aborted) return
      const v = selecionarVideoHulu()
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
 * Cria o adapter do Hulu conectando ao elemento <video> nativo do player.
 *
 * Retorna null se nenhum elemento <video> adequado for encontrado na pagina
 * (ex: pagina inicial do Hulu, catalogo sem reproducao ativa, ou URL fora de /watch/).
 *
 * SPA: Detecta mudanca de URL (troca de episodio/conteudo) via polling de
 * location.href e via popstate. Ao detectar mudanca em /watch/:id, re-resolve
 * o <video> e reconfigura todos os listeners.
 *
 * Anuncio: Observa a UI do player via MutationObserver para emitir ad-start/ad-end.
 * Como o Hulu usa SSAI, a deteccao e por elementos de UI sobrepostos ao video.
 */
export async function createHuluAdapter(): Promise<ServiceAdapter | null> {
  const video = await aguardarVideoHulu()
  if (!video) return null

  // Mapa de listeners: AdapterEventName -> conjunto de handlers do usuario
  const listenerMap = new Map<AdapterEventName, Set<() => void>>()

  // Handlers nativos registrados no video - guardados para remocao no destroy()
  let nativeHandlers = new Map<string, EventListener>()

  // Estado de anuncio anterior (para o MutationObserver de ad-start/ad-end)
  let eraAnuncio = detectarAnuncioHulu()

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

  // AbortController do aguardarVideoHulu em andamento.
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
   * Configura MutationObserver para detectar transicoes de anuncio no Hulu.
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
      const isAnuncio = detectarAnuncioHulu()
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
      attributeFilter: ['class', 'style', 'data-testid'],
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
   * - Incrementa navigationSeq ao entrar; cancela o aguardarVideoHulu anterior.
   * - Apos cada await, verifica se o token ainda e o atual; se nao, aborta.
   * - Remove handlers do video anterior SOMENTE apos resolucao bem-sucedida,
   *   evitando estado zumbi quando aguardarVideoHulu expira sem resultado.
   * - Retry leve enquanto estiver em /watch/ (uma nova tentativa apos timeout).
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

      const novoVideo = await aguardarVideoHulu(controller.signal)

      // Verifica se a navegacao ainda e a mais recente
      if (meuSeq !== navigationSeq) return false
      if (controller.signal.aborted) return false

      if (!novoVideo) return false

      // Remove handlers do video anterior somente apos resolucao bem-sucedida
      removerHandlersNativos()
      registrarHandlersNativos(novoVideo)
      configurarAdObserver()
      eraAnuncio = detectarAnuncioHulu()
      console.debug('[OpenParty Hulu] adapter re-ligado apos navegacao SPA')
      return true
    }

    const ok = await tentarReligar()

    // Retry leve - se timeout e ainda estamos em /watch/, tenta mais uma vez
    if (!ok && meuSeq === navigationSeq && !controller.signal.aborted && SPA_PATH_REGEX.test(new URL(location.href).pathname)) {
      console.debug('[OpenParty Hulu] retry de re-ligacao apos timeout em /watch/')
      await tentarReligar()
    }

    if (meuSeq === navigationSeq) {
      aguardarAbortController = null
    }
  }

  const spaNavegacaoHandler = (): void => {
    onSpaNavegacao().catch((err) => {
      console.warn('[OpenParty Hulu] erro ao religar adapter apos SPA:', err)
    })
  }

  /**
   * Inicia o polling leve de location.href para detectar mudancas de URL SPA.
   * O Hulu usa pushState ao trocar de episodio; popstate cobre apenas back/forward.
   */
  function iniciarSpaPolling(): void {
    if (spaPollingId !== null) return

    spaPollingId = setInterval(() => {
      const novaUrl = location.href
      if (novaUrl !== urlAtual) {
        urlAtual = novaUrl
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
  // (sem este filtro, popstate reagia a qualquer navegacao back/forward, inclusive
  //  saindo do player para o catalogo ou pagina inicial)
  const spaPopstateHandler = (): void => {
    if (!SPA_PATH_REGEX.test(new URL(location.href).pathname)) return
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
    /** Inicia reproducao no player Hulu */
    async play(): Promise<void> {
      await videoAtual.play()
    },

    /** Pausa reproducao no player Hulu */
    async pause(): Promise<void> {
      videoAtual.pause()
    },

    /** Salta para `secs` segundos no player Hulu */
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
      return detectarAnuncioHulu()
    },

    /** Retorna o estado atual do player */
    getPlaybackState(): PlaybackState {
      if (detectarAnuncioHulu()) return 'ad'
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
      // Cancela qualquer aguardarVideoHulu em andamento
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
