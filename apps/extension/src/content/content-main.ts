// src/content/content-main.ts
// Entry point injetado em todas as paginas de streaming suportadas.
// Detecta o servico pelo hostname, instancia o adapter correto,
// e faz o roteamento bidirecional entre adapter <-> background service worker.

import type { AdapterFactory, ServiceAdapter } from '../adapters/interface'
import { createYouTubeAdapter } from '../adapters/youtube'
import type { ServerEvent } from '@openparty/protocol'
import { computeClockOffset, selectBestOffset } from '../lib/clock'
import { decideSyncAction } from '../lib/sync'
import type { ClockSample } from '../lib/clock'
import type { ClockPingEvent } from '@openparty/protocol'

// ---------------------------------------------------------------------------
// Registry: hostname -> factory do adapter
// ---------------------------------------------------------------------------

const ADAPTER_REGISTRY: Record<string, AdapterFactory> = {
  'www.youtube.com': createYouTubeAdapter,
  // Demais adapters adicionados nas proximas sprints:
  // 'www.netflix.com': createNetflixAdapter,
  // 'www.primevideo.com': createPrimeAdapter,
  // 'www.amazon.com': createPrimeAdapter,
  // 'www.disneyplus.com': createDisneyAdapter,
  // 'www.max.com': createMaxAdapter,
  // 'www.hulu.com': createHuluAdapter,
  // 'www.crunchyroll.com': createCrunchyrollAdapter,
  // 'tv.apple.com': createAppleTvAdapter,
  // 'www.paramountplus.com': createParamountAdapter,
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
      const decisao = decideSyncAction(posicaoAtual, posicaoEsperada, 'youtube')

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
      break
    }

    case 'clock-pong':
      // Tratado pela calibracao de clock - nao e um comando de playback
      break

    default:
      // Outros eventos (chat, reaction, join, leave, etc.) sao tratados pelo overlay (Sprint 2)
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
  if (reconnectTimer !== null) {
    clearTimeout(reconnectTimer)
    reconnectTimer = null
  }
  port?.disconnect()
  port = null
  adapter?.destroy()
  adapter = null
})

// ---------------------------------------------------------------------------
// Inicializacao
// L1: cria o adapter ANTES de abrir a Port; so abre a Port se o adapter existir
// ---------------------------------------------------------------------------

/**
 * Ponto de entrada do content script.
 * L1: instancia o adapter ANTES de abrir a Port para evitar Port orfas em
 * paginas sem <video> carregado (ex: pagina inicial do YouTube).
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
    console.warn('[OpenParty Content] adapter nao encontrou elemento de video em', hostname)
    return
  }

  adapter = instancia
  registrarListenersDoAdapter(adapter)

  conectarAoBackground()

  console.debug('[OpenParty Content] adapter pronto para', hostname)
}

init().catch((err) => {
  console.error('[OpenParty Content] erro na inicializacao:', err)
})
