// src/content/content-main.ts
// Entry point injetado em todas as paginas de streaming suportadas.
// Detecta o servico pelo hostname, instancia o adapter correto,
// e faz o roteamento bidirecional entre adapter <-> background service worker.

import type { AdapterFactory, ServiceAdapter } from '../adapters/interface'
import { createYouTubeAdapter } from '../adapters/youtube'
import { createNetflixAdapter } from '../adapters/netflix'
import { createPrimeVideoAdapter } from '../adapters/prime'
import { createDisneyAdapter } from '../adapters/disney'
import { createMaxAdapter } from '../adapters/max'
// Sprint 5: novos servicos de streaming
import { createHuluAdapter } from '../adapters/hulu'
import { createCrunchyrollAdapter } from '../adapters/crunchyroll'
import { createAppleTvAdapter } from '../adapters/appletv'
import { createParamountAdapter } from '../adapters/paramount'
import type { ServerEvent } from '@openparty/protocol'
import { computeClockOffset, selectBestOffset } from '../lib/clock'
import { decideSyncAction } from '../lib/sync'
import type { ClockSample } from '../lib/clock'
import type { ClockPingEvent } from '@openparty/protocol'
import { criarChatOverlay } from './overlay/chat-overlay'
import type { ChatOverlayHandle } from './overlay/types'

// ---------------------------------------------------------------------------
// Registry: hostname -> factory do adapter
// ---------------------------------------------------------------------------

const ADAPTER_REGISTRY: Record<string, AdapterFactory> = {
  // YouTube
  'www.youtube.com': createYouTubeAdapter,
  // Netflix
  'www.netflix.com': createNetflixAdapter,
  'netflix.com': createNetflixAdapter,
  // Prime Video (Sprint 3)
  'www.primevideo.com': createPrimeVideoAdapter,
  // Disney+ (Sprint 3)
  'www.disneyplus.com': createDisneyAdapter,
  // Max (Sprint 3)
  'www.max.com': createMaxAdapter,
  // Hulu (Sprint 5)
  'www.hulu.com': createHuluAdapter,
  // Crunchyroll (Sprint 5)
  'www.crunchyroll.com': createCrunchyrollAdapter,
  // Apple TV+ (Sprint 5) - dominio sem subdominio www
  'tv.apple.com': createAppleTvAdapter,
  // Paramount+ (Sprint 5)
  'www.paramountplus.com': createParamountAdapter,
}

// ---------------------------------------------------------------------------
// Constantes de sincronizacao
// ---------------------------------------------------------------------------

/** Numero de amostras de ping/pong coletadas na calibracao inicial */
const CALIBRATION_PING_COUNT = 5

/** Intervalo entre cada ping de calibracao em ms */
const CALIBRATION_PING_INTERVAL_MS = 200

// ---------------------------------------------------------------------------
// Estado local do content script
// ---------------------------------------------------------------------------

let port: chrome.runtime.Port | null = null
let adapter: ServiceAdapter | null = null
let reconnectTimer: ReturnType<typeof setTimeout> | null = null
let overlay: ChatOverlayHandle | null = null

/**
 * Offset estimado entre o clock do cliente e do servidor (em ms).
 * Positivo = servidor adiantado em relacao ao cliente.
 * Aplicar: serverNow = Date.now() + clockOffsetMs
 */
let clockOffsetMs = 0

/**
 * H1: Supressao robusta por tipo de operacao.
 * Contador por tipo: enquanto > 0, o eco do evento correspondente e descartado
 * e o contador decrementado.
 */
const suppressCount = { play: 0, pause: 0, seek: 0 }

type SuppressableOp = keyof typeof suppressCount

/**
 * Suprime o proximo eco de um tipo especifico de evento.
 */
function suppressNext(op: SuppressableOp): void {
  suppressCount[op]++
}

/**
 * Verifica e consome uma supressao para o tipo de evento.
 * Retorna true se o evento deve ser descartado (suprimido).
 */
function consumeSuppress(op: SuppressableOp): boolean {
  if (suppressCount[op] > 0) {
    suppressCount[op]--
    return true
  }
  return false
}

// ---------------------------------------------------------------------------
// Calibracao de clock (NTP-like)
// ---------------------------------------------------------------------------

/**
 * Executa a calibracao de clock enviando N pings para o background,
 * que os repassa ao servidor. Ao receber os pongs via mensagens do
 * background, coleta amostras e seleciona o offset de menor RTT.
 *
 * Os pongs chegam via onMessage do port (tratados em aplicarComandoDoServidor).
 */
async function calibrarClock(): Promise<void> {
  const amostras: ClockSample[] = []

  // Pendentes: t1 de cada ping enviado
  const pingsPendentes = new Map<number, number>()

  // Listener temporario para capturar clock-pong antes de registrar o listener principal
  const capturarPong = (msg: unknown): void => {
    if (
      typeof msg !== 'object' ||
      msg === null ||
      (msg as Record<string, unknown>)['type'] !== 'clock-pong'
    ) {
      return
    }

    const pong = msg as { type: 'clock-pong'; t1: number; t2: number; t3: number }
    const t4 = Date.now()
    const t1 = pingsPendentes.get(pong.t1)
    if (t1 === undefined) return

    pingsPendentes.delete(pong.t1)
    amostras.push(computeClockOffset(t1, pong.t2, pong.t3, t4))
  }

  port?.onMessage.addListener(capturarPong)

  for (let i = 0; i < CALIBRATION_PING_COUNT; i++) {
    const t1 = Date.now()
    pingsPendentes.set(t1, t1)
    const pingEvento: ClockPingEvent = { type: 'clock-ping', t1, totalPings: CALIBRATION_PING_COUNT }
    port?.postMessage(pingEvento)
    await new Promise<void>((r) => setTimeout(r, CALIBRATION_PING_INTERVAL_MS))
  }

  // Remove o listener temporario apos coletar as amostras
  port?.onMessage.removeListener(capturarPong)

  if (amostras.length > 0) {
    clockOffsetMs = selectBestOffset(amostras)
    console.debug('[OpenParty Content] clock calibrado, offset:', clockOffsetMs, 'ms')
  }
}

// ---------------------------------------------------------------------------
// Roteamento: adapter -> background
// ---------------------------------------------------------------------------

/**
 * Registra os listeners do adapter para encaminhar eventos ao background.
 * Usa suppressCount para evitar eco de comandos originados pelo servidor.
 */
function registrarListenersDoAdapter(adapterInstancia: ServiceAdapter): void {
  adapterInstancia.on('play', () => {
    if (consumeSuppress('play')) return
    if (adapterInstancia.isAd()) return
    port?.postMessage({ type: 'play', time: adapterInstancia.getCurrentTime() })
  })

  adapterInstancia.on('pause', () => {
    if (consumeSuppress('pause')) return
    if (adapterInstancia.isAd()) return
    port?.postMessage({ type: 'pause', time: adapterInstancia.getCurrentTime() })
  })

  adapterInstancia.on('seek', () => {
    if (consumeSuppress('seek')) return
    if (adapterInstancia.isAd()) return
    port?.postMessage({ type: 'seek', time: adapterInstancia.getCurrentTime() })
  })

  adapterInstancia.on('ad-start', () => {
    // Durante anuncios os eventos de sync sao suspensos automaticamente pelo
    // guard isAd() nos handlers acima. Nenhuma acao adicional necessaria.
  })

  adapterInstancia.on('ad-end', () => {
    // Quando o anuncio termina o servidor vai sincronizar via room-state
  })
}

// ---------------------------------------------------------------------------
// Roteamento: background -> adapter
// C1: sync real com agendamento via `when` e reconciliacao de drift
// ---------------------------------------------------------------------------

/**
 * Aplica um evento de play com suporte ao campo `when` do protocolo.
 * Se `when` e futuro, agenda o play para aquele instante.
 * H1: suprime play + seek juntos quando room-state e aplicado.
 */
function agendarOuAplicarPlay(when: number | undefined): void {
  if (!adapter) return

  const serverNow = Date.now() + clockOffsetMs
  const delay = when !== undefined ? when - serverNow : 0

  if (delay > 0) {
    setTimeout(() => {
      if (!adapter) return
      suppressNext('play')
      adapter.play().catch((err) => {
        console.error('[OpenParty Content] erro ao aplicar play agendado:', err)
      })
    }, delay)
  } else {
    suppressNext('play')
    adapter.play().catch((err) => {
      console.error('[OpenParty Content] erro ao aplicar play:', err)
    })
  }
}

/**
 * Aplica um evento recebido do servidor via background.
 * C1: usa clockOffsetMs para corrigir timing; decide seek vs ignore via decideSyncAction.
 */
function aplicarComandoDoServidor(message: unknown): void {
  if (!adapter) return
  if (typeof message !== 'object' || message === null) return

  const evento = message as ServerEvent

  switch (evento.type) {
    case 'play': {
      // C1: agenda o play para o instante `when` usando o clock calibrado
      agendarOuAplicarPlay(evento.when)
      break
    }

    case 'pause': {
      suppressNext('pause')
      adapter.pause().catch((err) => {
        console.error('[OpenParty Content] erro ao aplicar pause:', err)
      })
      break
    }

    case 'seek': {
      suppressNext('seek')
      adapter.seekTo(evento.time).catch((err) => {
        console.error('[OpenParty Content] erro ao aplicar seek:', err)
      })
      break
    }

    case 'room-state': {
      // C1: reconciliacao de posicao usando serverNow e decideSyncAction
      if (adapter.isAd()) break

      const serverNow = Date.now() + clockOffsetMs
      // Posicao esperada: posicao salva + tempo decorrido desde o ultimo evento (se tocando)
      const tempoDecorrido = evento.playing
        ? Math.max(0, (serverNow - evento.lastEventAt) / 1000)
        : 0
      const posicaoEsperada = evento.positionSecs + tempoDecorrido

      const posicaoAtual = adapter.getCurrentTime()
      const decisao = decideSyncAction(posicaoAtual, posicaoEsperada, adapter.getServiceType())

      if (decisao.action === 'seek') {
        // H1: suprime todos os ecos que room-state vai disparar
        suppressNext('seek')
        adapter.seekTo(decisao.targetSecs).catch((err) => {
          console.error('[OpenParty Content] erro ao aplicar room-state seek:', err)
        })
      }
      // 'ignore' e 'adjust-rate' (youtube nao usa): nada a fazer na posicao

      if (evento.playing) {
        agendarOuAplicarPlay(undefined)
      } else {
        suppressNext('pause')
        adapter.pause().catch((err) => {
          console.error('[OpenParty Content] erro ao aplicar room-state pause:', err)
        })
      }

      // Atualiza presenca no overlay (Sprint 2)
      overlay?.atualizarParticipantes(evento.peers ?? [])
      overlay?.atualizarSyncStatus('em-sync')
      break
    }

    case 'clock-pong':
      // Tratado pela calibracao de clock - nao e um comando de playback
      break

    case 'welcome':
      overlay?.atualizarSyncStatus('calibrando')
      break

    case 'chat':
      overlay?.adicionarMensagem({
        userId: evento.userId,
        displayName: evento.displayName,
        text: evento.text,
        ts: evento.ts,
      })
      break

    case 'reaction':
      overlay?.adicionarReacao(`${evento.userId}-${evento.ts}`, evento.emoji)
      break

    case 'join':
    case 'leave':
      // Presenca incremental: sem lista completa, aguarda proximo room-state
      break

    case 'host-change':
    case 'host-lock':
      // Nao afeta o overlay
      break

    default:
      break
  }
}

// ---------------------------------------------------------------------------
// Conexao com o background service worker
// H3: guarda referencia do reconnectTimer e limpa antes de reconectar
// ---------------------------------------------------------------------------

/**
 * Abre uma Port com o background service worker.
 * H3: nao-operacional se uma Port ja estiver aberta (guard contra dupla conexao).
 * Registra onMessage para aplicar comandos do servidor no adapter.
 * Inicia a calibracao de clock NTP-like apos conectar.
 */
function conectarAoBackground(): void {
  // H3: guard contra Port ja existente
  if (port) return

  port = chrome.runtime.connect({ name: 'openparty-content' })

  port.onMessage.addListener((message: unknown) => {
    aplicarComandoDoServidor(message)
  })

  port.onDisconnect.addListener(() => {
    port = null

    // H3: limpa timer anterior antes de agendar nova tentativa
    if (reconnectTimer !== null) {
      clearTimeout(reconnectTimer)
      reconnectTimer = null
    }

    // Tenta reconectar apos 2 segundos - o SW pode ter sido terminado e reiniciado
    reconnectTimer = setTimeout(() => {
      reconnectTimer = null
      if (adapter) conectarAoBackground()
    }, 2_000)
  })

  // Inicia calibracao de clock apos conectar
  calibrarClock().catch((err) => {
    console.warn('[OpenParty Content] falha na calibracao de clock:', err)
  })
}

// ---------------------------------------------------------------------------
// Limpeza ao navegar para fora da pagina
// H3: cancela reconnectTimer em pagehide
// ---------------------------------------------------------------------------

window.addEventListener('pagehide', () => {
  // HIGH-1: para o observador leve de URL (se ativo)
  pararUrlObserver()

  if (reconnectTimer !== null) {
    clearTimeout(reconnectTimer)
    reconnectTimer = null
  }
  port?.disconnect()
  port = null
  adapter?.destroy()
  adapter = null
  overlay?.destruir()
  overlay = null
})

// ---------------------------------------------------------------------------
// Inicializacao
// L1: cria o adapter ANTES de abrir a Port; so abre a Port se o adapter existir
// HIGH-1 + MEDIUM-3: observador leve de URL para renascer/destruir o adapter
//   em navegacoes SPA que ocorrem antes (ou depois) do adapter estar ativo.
// ---------------------------------------------------------------------------

/** Intervalo do observador leve de URL no content-main (ms) */
const OBSERVER_URL_INTERVAL_MS = 800

/** ID do intervalo do observador leve de URL (HIGH-1 / MEDIUM-3) */
let urlObserverIntervalId: ReturnType<typeof setInterval> | null = null

/** URL monitorada pelo observador leve de URL */
let urlObservada = location.href

/**
 * Para e limpa o observador leve de URL.
 */
function pararUrlObserver(): void {
  if (urlObserverIntervalId !== null) {
    clearInterval(urlObserverIntervalId)
    urlObserverIntervalId = null
  }
}

/**
 * Desmonta completamente o adapter e a sessao de sync atual.
 * Chamado quando o usuario navega do player de volta ao catalogo (MEDIUM-3).
 * Apos a desmontagem, retoma o observador leve para renascer se voltar ao player.
 */
function desmontarAdapter(): void {
  if (reconnectTimer !== null) {
    clearTimeout(reconnectTimer)
    reconnectTimer = null
  }
  port?.disconnect()
  port = null
  adapter?.destroy()
  adapter = null
  overlay?.destruir()
  overlay = null
}

/**
 * Monta o adapter, o overlay e a conexao com o background.
 * Chamado pelo observador leve quando a factory retorna uma instancia valida.
 */
async function montarAdapter(factory: AdapterFactory): Promise<void> {
  const instancia = await factory()
  if (!instancia) return

  // HIGH-1: se o adapter ja foi montado enquanto aguardavamos (race condition),
  // descarta a instancia recém criada para evitar duplicata.
  if (adapter) {
    instancia.destroy()
    return
  }

  adapter = instancia
  registrarListenersDoAdapter(adapter)

  overlay = criarChatOverlay({
    onEnviarMensagem: (text) => {
      port?.postMessage({ type: 'chat', text } satisfies { type: 'chat'; text: string })
    },
    onEnviarReacao: (emoji) => {
      port?.postMessage({ type: 'reaction', emoji } satisfies { type: 'reaction'; emoji: string })
    },
  })

  conectarAoBackground()

  // HIGH-1: adapter nasceu com sucesso, para o observador que fica tentando
  pararUrlObserver()

  console.debug('[OpenParty Content] adapter e overlay prontos para', window.location.hostname)
}

/**
 * Inicia o observador leve de mudanca de URL (HIGH-1 + MEDIUM-3).
 *
 * HIGH-1: se a factory retornou null no load (usuario estava no catalogo),
 * este observador fica monitorando location.href. Quando a URL mudar para
 * uma rota de player, tenta instanciar o adapter novamente.
 *
 * MEDIUM-3: quando o adapter ja esta ativo e o usuario navega de volta ao
 * catalogo (URL sai da rota de player), destroi o adapter e retoma o
 * observador para renascer se o usuario voltar ao player.
 *
 * O observador e limpo no pagehide e quando o adapter nasce com sucesso.
 */
function iniciarUrlObserver(factory: AdapterFactory): void {
  if (urlObserverIntervalId !== null) return

  const popstateHandler = (): void => {
    // Popstate dispara de forma sincrona; atualizamos a URL observada e
    // verificamos o estado na proxima iteracao do setInterval (ja agendada).
    urlObservada = location.href
    verificarMudancaDeUrl()
  }

  const verificarMudancaDeUrl = (): void => {
    const novaUrl = location.href
    if (novaUrl === urlObservada && adapter !== null) return

    const urlAnterior = urlObservada
    urlObservada = novaUrl

    const urlAnteriorEraPlayer = adapter !== null

    // MEDIUM-3: estava no player e saiu para o catalogo
    // Detectamos "saiu do player" pela factory retornando null quando re-chamada
    // com a nova URL - mas a factory ja tem logica interna (aguardarVideo*) para
    // retornar null em rotas de catalogo (MEDIUM-2 / gate de path).
    // Usamos uma heuristica simples: se havia adapter ativo e a nova URL mudou
    // significativamente (diferente de pathname), disparamos a checagem.
    if (urlAnteriorEraPlayer && novaUrl !== urlAnterior) {
      // Tenta criar nova instancia para ver se ainda estamos em rota de player.
      // Se a factory retornar null (catalogo), desmontamos o adapter existente.
      factory().then((instancia) => {
        if (instancia) {
          // Ainda em rota de player (ex: troca de episodio) - descarta duplicata,
          // o adapter interno SPA (dentro do adapter) ja cuida da re-ligacao.
          instancia.destroy()
        } else if (adapter !== null) {
          // Saiu da rota de player - desmonta e retoma observador para renascer
          console.debug('[OpenParty Content] usuario saiu do player, desmontando adapter')
          desmontarAdapter()
          // O observador continua ativo para renascer quando voltar ao player
        }
      }).catch(() => { /* silencioso - factory lancando erro nao e fatal */ })
      return
    }

    // HIGH-1: sem adapter ativo - tenta montar
    if (!adapter) {
      montarAdapter(factory).catch((err) => {
        console.warn('[OpenParty Content] erro ao montar adapter via observador de URL:', err)
      })
    }
  }

  window.addEventListener('popstate', popstateHandler)

  urlObserverIntervalId = setInterval(verificarMudancaDeUrl, OBSERVER_URL_INTERVAL_MS)

  // Garante limpeza do popstate no pagehide.
  // O pagehide principal (registrado no topo do arquivo) ja chama pararUrlObserver,
  // que limpa o interval; aqui removemos tambem o listener de popstate.
  window.addEventListener('pagehide', () => {
    window.removeEventListener('popstate', popstateHandler)
  }, { once: true })
}

/**
 * Ponto de entrada do content script.
 * L1: instancia o adapter ANTES de abrir a Port para evitar Port orfas em
 * paginas sem <video> carregado (ex: pagina inicial do YouTube).
 * HIGH-1: se a factory retornar null no load (usuario no catalogo/home),
 * instala o observador leve de URL para tentar novamente quando entrar no player.
 */
async function init(): Promise<void> {
  const hostname = window.location.hostname
  const factory = ADAPTER_REGISTRY[hostname]

  if (!factory) {
    // Hostname nao e uma pagina de streaming suportada - nao faz nada
    return
  }

  // L1: instancia adapter antes de abrir a Port para evitar Port orfas na
  // pagina inicial do YouTube (sem <video> carregado)
  const instancia = await factory()
  if (!instancia) {
    // HIGH-1: factory retornou null (usuario esta na home/catalogo).
    // O Chrome nao reinjeta o content script em navegacoes SPA, entao
    // instalamos um observador leve de URL para tentar novamente quando
    // o usuario navegar para uma rota de player.
    console.debug('[OpenParty Content] adapter nao disponivel em', hostname, '- aguardando rota de player via observador de URL')
    iniciarUrlObserver(factory)
    return
  }

  adapter = instancia
  registrarListenersDoAdapter(adapter)

  // Monta o overlay de chat/reacoes antes de conectar ao background
  overlay = criarChatOverlay({
    onEnviarMensagem: (text) => {
      port?.postMessage({ type: 'chat', text } satisfies { type: 'chat'; text: string })
    },
    onEnviarReacao: (emoji) => {
      port?.postMessage({ type: 'reaction', emoji } satisfies { type: 'reaction'; emoji: string })
    },
  })

  conectarAoBackground()

  console.debug('[OpenParty Content] adapter e overlay prontos para', hostname)
}

init().catch((err) => {
  console.error('[OpenParty Content] erro na inicializacao:', err)
})
