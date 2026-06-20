// src/background/service-worker.ts
// Background service worker MV3 do OpenParty.
//
// Responsabilidades:
//   - Manter conexao WebSocket com apps/server
//   - Manter estado da sala em memoria
//   - Rotear mensagens entre content scripts (via Port) e o servidor WS
//   - Persistir estado em chrome.storage.local para sobreviver a terminacoes do SW
//
// Nota MV3: o service worker pode ser terminado pelo browser quando inativo.
// A combinacao de chrome.runtime.Port aberta + WebSocket ativo mantem o SW vivo
// desde Chrome 116. Estado critico e persistido em chrome.storage.local.

import { createWsClient } from '../lib/ws-client'
import { storageGet, storageSet } from '../lib/storage'
import type { WsClient } from '../lib/ws-client'
import type { ServerEvent } from '@openparty/protocol'
import { isClientEvent } from '@openparty/protocol'

// ---------------------------------------------------------------------------
// Chave usada para cache de room-state no chrome.storage.local
// ---------------------------------------------------------------------------

const CACHED_ROOM_STATE_KEY = 'cachedRoomState'

// ---------------------------------------------------------------------------
// Estado em memoria (reinicializado quando o SW e terminado e retomado)
// ---------------------------------------------------------------------------

/** Portas abertas pelos content scripts - uma por aba ativa na sala */
const activePorts = new Map<number, chrome.runtime.Port>()

let wsClient: WsClient | null = null
let currentRoomId: string | null = null

// ---------------------------------------------------------------------------
// Roteamento: servidor -> content scripts
// ---------------------------------------------------------------------------

/**
 * Distribui um evento recebido do servidor para todas as portas abertas.
 * Cada porta representa um content script em uma aba de streaming.
 */
function broadcastParaContentScripts(event: ServerEvent): void {
  for (const port of activePorts.values()) {
    try {
      port.postMessage(event)
    } catch {
      // Porta pode ter sido fechada entre o iterate e o postMessage - ignorar
    }
  }
}

// ---------------------------------------------------------------------------
// Conexao WebSocket
// C2: a URL inclui o roomId como segmento de path (/ws/:roomId)
// ---------------------------------------------------------------------------

/**
 * Monta a URL completa do WebSocket incluindo o roomId no path.
 * serverUrl deve ser a base sem trailing slash (ex: wss://openparty.dehor.com.br/ws).
 * A URL final sera: <serverUrl>/<roomId>.
 */
function montarWsUrl(serverUrl: string, roomId: string): string {
  const base = serverUrl.endsWith('/') ? serverUrl.slice(0, -1) : serverUrl
  return `${base}/${roomId}`
}

/**
 * Abre a conexao WebSocket com o servidor usando a URL que inclui o roomId.
 * C2: a URL e montada por montarWsUrl para incluir /:roomId no path.
 * Nao-operacional se uma conexao ja estiver ativa.
 */
async function conectarWs(roomId: string): Promise<void> {
  if (wsClient) return

  const { serverUrl, displayName, avatar } = await storageGet([
    'serverUrl',
    'displayName',
    'avatar',
  ])

  // C2: usa /ws/:roomId na URL conforme o protocolo do servidor
  const wsUrl = montarWsUrl(serverUrl, roomId)

  wsClient = createWsClient({
    url: wsUrl,
    handshake: { displayName, avatar },
    onEvent: (event: ServerEvent) => {
      // H4: persiste o room-state para recuperar apos restart do SW
      if (event.type === 'room-state') {
        chrome.storage.local.set({ [CACHED_ROOM_STATE_KEY]: event }).catch(() => {
          // falha silenciosa - cache e best-effort
        })
      }
      broadcastParaContentScripts(event)
    },
    onClose: () => {
      // Reconexao automatica e gerenciada pelo ws-client com backoff exponencial
    },
  })
}

/**
 * Fecha a conexao WebSocket e libera o cliente.
 * Chamada quando nenhuma aba ativa esta conectada ou ao sair de sala.
 */
function desconectarWs(): void {
  wsClient?.close()
  wsClient = null
}

// ---------------------------------------------------------------------------
// Listener: content script conecta via Port ao abrir pagina de streaming
// ---------------------------------------------------------------------------

chrome.runtime.onConnect.addListener((port) => {
  const tabId = port.sender?.tab?.id
  if (tabId === undefined) return

  // Guard contra Port ja existente para a mesma aba
  if (activePorts.has(tabId)) {
    const portaAnterior = activePorts.get(tabId)
    try { portaAnterior?.disconnect?.() } catch { /* ja fechada */ }
  }

  activePorts.set(tabId, port)

  // H4: ao receber nova conexao, envia o room-state cacheado ao content script
  chrome.storage.local.get(CACHED_ROOM_STATE_KEY).then((result) => {
    const cached = result[CACHED_ROOM_STATE_KEY]
    if (cached && typeof cached === 'object') {
      try {
        port.postMessage(cached)
      } catch {
        // porta pode ter fechado antes do handshake
      }
    }
  }).catch(() => { /* cache ausente e normal */ })

  port.onMessage.addListener((message: unknown) => {
    // M1: valida com o type guard real do protocolo antes de repassar ao WS
    if (wsClient && isClientEvent(message)) {
      wsClient.send(message)
    }
  })

  port.onDisconnect.addListener(() => {
    activePorts.delete(tabId)
    // Se nao houver mais abas ativas e sem sala, desconectar WS para poupar recursos
    if (activePorts.size === 0 && !currentRoomId) {
      desconectarWs()
    }
  })
})

// ---------------------------------------------------------------------------
// Listener: mensagens one-shot do popup (entrar/sair de sala, status)
// ---------------------------------------------------------------------------

chrome.runtime.onMessage.addListener(
  (message: unknown, _sender, sendResponse) => {
    handlePopupMessage(message, sendResponse)
    return true // indica resposta assincrona
  },
)

/**
 * Trata mensagens one-shot enviadas pelo popup via chrome.runtime.sendMessage.
 * Suporta: join-room, leave-room, get-status.
 */
function handlePopupMessage(
  message: unknown,
  sendResponse: (response: unknown) => void,
): void {
  if (typeof message !== 'object' || message === null) {
    sendResponse({ ok: false, error: 'mensagem invalida' })
    return
  }

  const msg = message as Record<string, unknown>

  switch (msg['type']) {
    case 'join-room': {
      const roomId = typeof msg['roomId'] === 'string' ? msg['roomId'] : null
      if (!roomId) {
        sendResponse({ ok: false, error: 'roomId ausente' })
        return
      }
      currentRoomId = roomId
      storageSet({ roomId })
        .then(() => {
          // C2: passa o roomId para montar a URL correta
          conectarWs(roomId).catch((err) => {
            console.error('[OpenParty SW] erro ao conectar WS:', err)
          })
          sendResponse({ ok: true })
        })
        .catch(() => sendResponse({ ok: false, error: 'falha ao persistir sala' }))
      break
    }

    case 'leave-room': {
      currentRoomId = null
      storageSet({ roomId: null })
        .then(() => {
          if (activePorts.size === 0) desconectarWs()
          // Limpa o cache de room-state ao sair
          chrome.storage.local.remove(CACHED_ROOM_STATE_KEY).catch(() => { /* best-effort */ })
          sendResponse({ ok: true })
        })
        .catch(() => sendResponse({ ok: false, error: 'falha ao limpar sala' }))
      break
    }

    case 'get-status': {
      sendResponse({
        ok: true,
        roomId: currentRoomId,
        wsState: wsClient?.readyState ?? WebSocket.CLOSED,
        peers: activePorts.size,
      })
      break
    }

    default:
      sendResponse({ ok: true })
  }
}

// ---------------------------------------------------------------------------
// Inicializacao: restaurar estado persistido apos terminacao do SW
// ---------------------------------------------------------------------------

/**
 * Inicializa o service worker restaurando estado persistido.
 * Se houver roomId salvo, reconecta ao servidor automaticamente.
 */
async function init(): Promise<void> {
  const { roomId } = await storageGet(['roomId'])
  if (roomId) {
    currentRoomId = roomId
    // C2: reconecta usando o roomId persistido
    await conectarWs(roomId)
  }
  console.debug('[OpenParty SW] service worker iniciado')
}

init().catch((err) => {
  console.error('[OpenParty SW] erro na inicializacao:', err)
})
