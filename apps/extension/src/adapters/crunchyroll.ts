// src/adapters/crunchyroll.ts
// Adapter do Crunchyroll para a extensao OpenParty.
//
// Controla o player via elemento <video> nativo em paginas crunchyroll.com/watch/*.
// Nao usa nenhuma API privada do Crunchyroll - apenas HTMLVideoElement padrao.
//
// NOTA DE PLATAFORMA: O Crunchyroll beta (crunchyroll.com) renderiza o
// elemento <video> diretamente no DOM da pagina principal (sem iframe cross-origin).
// O player antigo usava um iframe "vilos-player" (same-origin), mas o site beta
// atual expoe o <video> nativamente. Se em algum momento o player retornar a
// um iframe, o adapter retornara null (LIMITACAO CONHECIDA documentada abaixo).
//
// Heuristica de selecao do <video>:
//   1. Seletor especifico do wrapper do player: `.video-player-wrapper video`
//      - Validado por area minima para excluir previews de hover no catalogo
//   2. Fallback: `.erc-player video` (seletor de componente de player da Crunchyroll)
//   3. Fallback geral: todos os <video> da pagina, filtrados por:
//      - readyState >= HAVE_METADATA (2): duracao conhecida
//      - Maior duracao (conteudo principal sempre mais longo que previews)
//      - Alternativa: maior area renderizada (offsetWidth * offsetHeight)
//   O primeiro criterio estavel encontrado vence.
//
// Gate de path (rota de player):
//   O adapter so seleciona o <video> se o pathname comeca com /watch/.
//   Fora dessa rota (catalogo, home, perfil), retorna null sem tentar localizar
//   o player. Isso e consistente com o comportamento do netflix.ts e prime.ts.
//
// Navegacao SPA:
//   O Crunchyroll usa History API (pushState) ao trocar de episodio sem
//   recarregar a pagina. Dois mecanismos combinados:
//     - Listener em popstate (navegacao back/forward)
//     - Polling leve de location.href a cada SPA_POLL_INTERVAL_MS, limpado no destroy()
//   Ao detectar mudanca para /watch/, re-resolve o <video> e reconfigura os listeners.
//
// Deteccao de anuncio (plano gratuito):
//   O Crunchyroll exibe anuncios pre-roll no plano gratuito. Heuristicas (do
//   mais ao menos estavel):
//     1. Presenca de `[data-testid="ad-ui"]` - atributo data-testid da UI de anuncio
//        (mais estavel por ser atributo de acessibilidade/teste do proprio Crunchyroll)
//     2. Presenca de `[data-testid="ad-skip-button"]` - botao de pular anuncio
//     3. Presenca de `[data-testid="ad-duration"]` - contador de duracao de anuncio
//     4. Presenca de `.ads-container` - container geral de anuncios
//     5. Presenca de `[class*="adContainer"]` - classe de container de anuncio (menos estavel)
//   Todos os seletores exigem visibilidade via elementoVisivel() antes de confirmar anuncio.
//
// LIMITACOES CONHECIDAS:
//   - Se o Crunchyroll reverter para iframe cross-origin (vilos-player), o adapter
//     retornara null pois nao ha acesso ao <video> dentro de iframes cross-origin.
//   - Os seletores de anuncio sao inferidos a partir de analise de projetos open-source
//     e podem mudar com atualizacoes do frontend do Crunchyroll (que usa classes com
//     prefixo `kat:` de um sistema atomico de CSS e `erc-` para componentes).
//   - A deteccao de anuncio e best-effort; o Crunchyroll pode reorganizar o DOM
//     de anuncios sem aviso.

import type { AdapterEventName, PlaybackState, ServiceAdapter } from './interface'
import type { StreamingServiceType } from '../lib/sync'

// ---------------------------------------------------------------------------
// Constantes
// ---------------------------------------------------------------------------

/** Seletor preferencial do <video> no wrapper do player de watch */
const VIDEO_SELETOR_PRIMARIO = '.video-player-wrapper video'

/** Seletor alternativo: componente de player da Crunchyroll (React) */
const VIDEO_SELETOR_ERC = '.erc-player video'

/** Seletor fallback final: qualquer <video> na pagina */
const VIDEO_SELETOR_FALLBACK = 'video'

/** Container geral do player (usado para o MutationObserver de anuncio) */
const PLAYER_CONTAINER_SELETOR = '.video-player-wrapper'

/** Container alternativo (fallback para o MutationObserver) */
const PLAYER_CONTAINER_SELETOR_ALT = '[data-testid="player-controls-root"]'

/**
 * Seletores de UI de anuncio do Crunchyroll (do mais ao menos estavel).
 * Referencia: analise de crunchyroll.ts do Netflix-Prime-Auto-Skip e
 * inspecao de DOM reportada pela comunidade (reddit.com/r/CrunchyrollBeta).
 * Os seletores data-testid sao os mais estaveis (parte do design system
 * de testes do Crunchyroll frontend).
 */
const AD_SELETORES = [
  '[data-testid="ad-ui"]',
  '[data-testid="ad-skip-button"]',
  '[data-testid="ad-duration"]',
  '.ads-container',
  '[class*="adContainer"]',
]

/** Prefixo de rota onde o player de conteudo esta disponivel */
const WATCH_PATH_PREFIX = '/watch/'

/** readyState minimo para considerar o <video> carregado */
const HAVE_METADATA = 2

/**
 * Area minima (pixels quadrados) para considerar o <video> como player
 * principal e nao um preview de hover no catalogo.
 * ~200x200px exclui thumbnails e previews pequenos.
 */
const VIDEO_AREA_MINIMA_PX2 = 40_000

/** Tempo maximo de espera pelo <video> aparecer (ms) */
const VIDEO_WAIT_TIMEOUT_MS = 8_000

/** Intervalo de polling fallback dentro de aguardarVideo (ms) */
const VIDEO_POLL_INTERVAL_MS = 300

/** Intervalo de polling para detectar navegacao SPA (ms) */
const SPA_POLL_INTERVAL_MS = 800

/**
 * Atraso antes de re-selecionar o <video> apos navegacao SPA.
 * Evita retornar o elemento antigo que ainda permanece no DOM
 * nos primeiros 100-300ms apos a transicao de conteudo.
 */
const SPA_RENAVIGATE_DELAY_MS = 150

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
 * Verifica se a URL atual corresponde a uma rota de player do Crunchyroll.
 * Retorna true apenas para pathnames comecando com /watch/.
 */
function eRotaDePlayer(): boolean {
  const pathname = new URL(location.href).pathname
  return pathname.startsWith(WATCH_PATH_PREFIX)
}

/**
 * Verifica se um elemento <video> tem area de renderizacao suficiente para
 * ser considerado o player principal (nao um preview de hover ou thumbnail).
 * Usa getBoundingClientRect para obter dimensoes reais renderizadas.
 */
function videoTemAreaSuficiente(v: HTMLVideoElement): boolean {
  const rect = v.getBoundingClientRect()
  return rect.width * rect.height >= VIDEO_AREA_MINIMA_PX2
}

/**
 * Seleciona o elemento <video> principal do player Crunchyroll.
 *
 * Aplica gate de path: retorna null fora de /watch/*.
 *
 * Heuristica em ordem de prioridade:
 * 1. `.video-player-wrapper video` com area minima
 * 2. `.erc-player video` com area minima
 * 3. Entre todos os <video> com area suficiente: maior duracao
 * 4. Entre todos os <video>: maior area renderizada
 * 5. Primeiro candidato disponivel
 */
function selecionarVideoCrunchyroll(): HTMLVideoElement | null {
  // Gate de path: nao seleciona fora da rota de player
  if (!eRotaDePlayer()) return null

  // Tentativa 1: wrapper especifico do player
  const primario = document.querySelector<HTMLVideoElement>(VIDEO_SELETOR_PRIMARIO)
  if (primario && videoTemAreaSuficiente(primario)) return primario

  // Tentativa 2: componente React de player (erc-player)
  const erc = document.querySelector<HTMLVideoElement>(VIDEO_SELETOR_ERC)
  if (erc && videoTemAreaSuficiente(erc)) return erc

  // Tentativa 3 e 4: entre todos os videos, filtra e escolhe o mais adequado
  const todos = Array.from(document.querySelectorAll<HTMLVideoElement>(VIDEO_SELETOR_FALLBACK))
  if (todos.length === 0) return null

  const comAreaSuficiente = todos.filter(videoTemAreaSuficiente)
  const candidatos = comAreaSuficiente.length > 0 ? comAreaSuficiente : todos

  if (candidatos.length === 1) return candidatos[0]

  // Prioriza videos com duracao conhecida (conteudo principal vs previews)
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
 * Impede que elemento de anuncio oculto (display:none, visibility:hidden,
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
 * Retorna true se o player Crunchyroll esta exibindo um anuncio no momento.
 *
 * Verifica os seletores de UI de anuncio. Exige visibilidade do elemento
 * antes de confirmar anuncio (via elementoVisivel). Ver AD_SELETORES e
 * LIMITACOES CONHECIDAS no cabecalho do arquivo.
 */
function detectarAnuncioCrunchyroll(): boolean {
  for (const seletor of AD_SELETORES) {
    const el = document.querySelector(seletor)
    if (el && elementoVisivel(el)) return true
  }
  return false
}

/**
 * Aguarda o elemento <video> principal do Crunchyroll aparecer no DOM.
 *
 * Usa MutationObserver como mecanismo primario e polling como fallback.
 * Respeita VIDEO_WAIT_TIMEOUT_MS antes de desistir e retornar null.
 * Aceita AbortSignal para cancelamento antecipado (destroy ou nova navegacao).
 */
async function aguardarVideoCrunchyroll(signal?: AbortSignal): Promise<HTMLVideoElement | null> {
  const existente = selecionarVideoCrunchyroll()
  if (existente) return existente

  return new Promise<HTMLVideoElement | null>((resolve) => {
    let timeoutId: ReturnType<typeof setTimeout> | null = null
    let pollingId: ReturnType<typeof setInterval> | null = null
    let observer: MutationObserver | null = null
    let settled = false

    const cleanup = (): void => {
      if (timeoutId !== null) { clearTimeout(timeoutId); timeoutId = null }
      if (pollingId !== null) { clearInterval(pollingId); pollingId = null }
      observer?.disconnect()
      observer = null
      // Remove listener de abort para evitar vazamento de referencia
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
      const v = selecionarVideoCrunchyroll()
      if (v) encontrou(v)
    })
    observer.observe(document.body, { childList: true, subtree: true })

    // Polling como fallback (necessario quando o MutationObserver e throttled)
    pollingId = setInterval(() => {
      if (signal?.aborted) return
      const v = selecionarVideoCrunchyroll()
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
 * Cria o adapter do Crunchyroll conectando ao elemento <video> nativo do player.
 *
 * Retorna null se:
 * - A pagina atual nao e uma rota de player (/watch/:id)
 * - Nenhum elemento <video> adequado for encontrado apos timeout
 *
 * SPA: Detecta mudanca de URL (troca de episodio) via polling de location.href
 * e via popstate. Ao detectar mudanca em /watch/, re-resolve o <video> e
 * reconfigura todos os listeners (single-flight com token de sequencia).
 *
 * Anuncio: Observa a UI do player via MutationObserver para emitir ad-start/ad-end.
 */
export async function createCrunchyrollAdapter(): Promise<ServiceAdapter | null> {
  // Gate de path: nao inicializa fora da rota de player
  if (!eRotaDePlayer()) return null

  const video = await aguardarVideoCrunchyroll()
  if (!video) return null

  // Mapa de listeners: AdapterEventName -> conjunto de handlers do usuario
  const listenerMap = new Map<AdapterEventName, Set<() => void>>()

  // Handlers nativos registrados no video - guardados para remocao no destroy()
  let nativeHandlers = new Map<string, EventListener>()

  // Estado de anuncio anterior (para o MutationObserver de ad-start/ad-end)
  let eraAnuncio = detectarAnuncioCrunchyroll()

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
  // Se nao for, a navegacao foi superada por uma mais recente e deve ser abortada.
  let navigationSeq = 0

  // AbortController da aguardarVideoCrunchyroll em andamento.
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
   * Observa o container do player ou o body como fallback.
   * Emite ad-start quando o anuncio comeca, ad-end quando termina.
   */
  function configurarAdObserver(): void {
    adObserver?.disconnect()

    const alvo =
      document.querySelector(PLAYER_CONTAINER_SELETOR) ??
      document.querySelector(PLAYER_CONTAINER_SELETOR_ALT) ??
      document.body

    adObserver = new MutationObserver(() => {
      const isAnuncio = detectarAnuncioCrunchyroll()
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
      attributeFilter: ['data-testid', 'class', 'style'],
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
   * - Incrementa navigationSeq ao entrar; cancela o aguardarVideoCrunchyroll anterior.
   * - Apos cada await, verifica se o token ainda e o atual; se nao, aborta.
   * - Remove handlers do video anterior SOMENTE apos resolucao bem-sucedida,
   *   evitando estado zumbi quando aguardarVideoCrunchyroll expira sem resultado.
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
      // Aguarda um tick antes de re-selecionar para nao pegar o elemento antigo
      // que ainda permanece no DOM nos primeiros 100-300ms apos a navegacao SPA.
      await new Promise<void>((r) => setTimeout(r, SPA_RENAVIGATE_DELAY_MS))
      if (meuSeq !== navigationSeq || controller.signal.aborted) return false

      const novoVideo = await aguardarVideoCrunchyroll(controller.signal)

      // Verifica se a navegacao ainda e a mais recente
      if (meuSeq !== navigationSeq) return false
      if (controller.signal.aborted) return false

      if (!novoVideo) return false

      // Remove handlers do video anterior somente apos resolucao bem-sucedida
      removerHandlersNativos()
      registrarHandlersNativos(novoVideo)
      configurarAdObserver()
      eraAnuncio = detectarAnuncioCrunchyroll()
      console.debug('[OpenParty Crunchyroll] adapter re-ligado apos navegacao SPA')
      return true
    }

    const ok = await tentarReligar()

    // Retry leve - se timeout e ainda estamos em /watch/, tenta mais uma vez
    if (!ok && meuSeq === navigationSeq && !controller.signal.aborted && eRotaDePlayer()) {
      console.debug('[OpenParty Crunchyroll] retry de re-ligacao apos timeout em /watch/')
      await tentarReligar()
    }

    if (meuSeq === navigationSeq) {
      aguardarAbortController = null
    }
  }

  const spaNavegacaoHandler = (): void => {
    onSpaNavegacao().catch((err) => {
      console.warn('[OpenParty Crunchyroll] erro ao religar adapter apos SPA:', err)
    })
  }

  /**
   * Inicia o polling leve de location.href para detectar mudancas de URL SPA.
   * O Crunchyroll usa pushState ao trocar de episodio; popstate cobre apenas
   * back/forward. O polling garante captura de pushState sem monkey-patch.
   */
  function iniciarSpaPolling(): void {
    if (spaPollingId !== null) return

    spaPollingId = setInterval(() => {
      const novaUrl = location.href
      if (novaUrl !== urlAtual) {
        urlAtual = novaUrl
        // Reage apenas se for uma URL de /watch/ (evita reagir a navegacao para catalogo)
        if (new URL(novaUrl).pathname.startsWith(WATCH_PATH_PREFIX)) {
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
    if (!eRotaDePlayer()) return
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
    /** Inicia reproducao no player Crunchyroll */
    async play(): Promise<void> {
      await videoAtual.play()
    },

    /** Pausa reproducao no player Crunchyroll */
    async pause(): Promise<void> {
      videoAtual.pause()
    },

    /** Salta para `secs` segundos no player Crunchyroll */
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
      return detectarAnuncioCrunchyroll()
    },

    /** Retorna o estado atual do player */
    getPlaybackState(): PlaybackState {
      if (detectarAnuncioCrunchyroll()) return 'ad'
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
      // Cancela qualquer aguardarVideoCrunchyroll em andamento
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
