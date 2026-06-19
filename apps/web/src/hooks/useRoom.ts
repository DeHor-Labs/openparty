import { useCallback, useEffect, useRef, useState } from 'react'
import type {
  RoomState,
  PresencePeer,
  ServerEvent,
} from '@openparty/protocol'
import { createWsClient, type WsClient } from '../lib/ws-client'
import { useClock } from './useClock'
import { useSync } from './useSync'
import type { PlayerAdapter } from '../lib/players/index'

/** Numero maximo de mensagens e reactions mantidas no estado */
const MAX_HISTORY = 200

export interface RoomIdentity {
  displayName: string
  avatar: string
}

export interface ChatMessage {
  userId: string
  displayName: string
  text: string
  ts: number
}

export interface ReactionItem {
  id: string
  userId: string
  emoji: string
  ts: number
}

export interface UseRoomResult {
  /** null enquanto nao recebeu room-state inicial */
  roomState: RoomState | null
  peers: PresencePeer[]
  messages: ChatMessage[]
  reactions: ReactionItem[]
  /** userId proprio do cliente (enviado pelo servidor via evento welcome) */
  localUserId: string | null
  /** Envia play para o servidor */
  sendPlay(time: number): void
  sendPause(time: number): void
  sendSeek(time: number): void
  sendChat(text: string): void
  sendReaction(emoji: string): void
  /** Envia set-host-lock; o servidor ignora se o remetente nao for o host */
  sendSetHostLock(locked: boolean): void
  connected: boolean
  /** Adapter injetado por RoomPlayer; useSync usa internamente */
  _setAdapter?: (adapter: PlayerAdapter | null) => void
}

let reactionCounter = 0

function uniqueReactionId(): string {
  return `reaction-${Date.now()}-${++reactionCounter}`
}

export function useRoom(roomId: string, identity: RoomIdentity): UseRoomResult {
  const [roomState, setRoomState] = useState<RoomState | null>(null)
  const [peers, setPeers] = useState<PresencePeer[]>([])
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [reactions, setReactions] = useState<ReactionItem[]>([])
  const [connected, setConnected] = useState(false)
  const [adapter, setAdapter] = useState<PlayerAdapter | null>(null)
  /** userId informado pelo servidor via evento welcome */
  const [localUserId, setLocalUserId] = useState<string | null>(null)

  // wsClient via state para que useClock reaja quando o cliente estiver disponivel
  const [wsClient, setWsClient] = useState<WsClient | null>(null)
  const wsClientRef = useRef<WsClient | null>(null)

  const { serverNow, onPong } = useClock(wsClient)
  useSync(roomState, adapter, serverNow)

  const handleEvent = useCallback(
    (event: ServerEvent) => {
      switch (event.type) {
        case 'welcome':
          setLocalUserId(event.userId)
          break

        case 'room-state':
          setRoomState({
            roomId: event.roomId,
            mediaUrl: event.mediaUrl,
            mediaType: event.mediaType,
            playing: event.playing,
            positionSecs: event.positionSecs,
            lastEventAt: event.lastEventAt,
            playbackRate: event.playbackRate,
            hostId: event.hostId,
            hostLock: event.hostLock,
          })
          setPeers(event.peers)
          setConnected(true)
          break

        case 'play':
          setRoomState((prev) =>
            prev
              ? {
                  ...prev,
                  playing: true,
                  positionSecs: event.time,
                  lastEventAt: event.when - 300,
                }
              : prev
          )
          break

        case 'pause':
          setRoomState((prev) =>
            prev
              ? {
                  ...prev,
                  playing: false,
                  positionSecs: event.time,
                  lastEventAt: event.serverTime,
                }
              : prev
          )
          break

        case 'seek':
          setRoomState((prev) =>
            prev
              ? { ...prev, positionSecs: event.time, lastEventAt: Date.now() }
              : prev
          )
          break

        case 'join':
          setPeers((prev) => {
            if (prev.some((p) => p.userId === event.userId)) return prev
            return [
              ...prev,
              {
                userId: event.userId,
                displayName: event.displayName,
                avatar: event.avatar,
              },
            ]
          })
          break

        case 'leave':
          setPeers((prev) => prev.filter((p) => p.userId !== event.userId))
          break

        case 'host-change':
          setRoomState((prev) =>
            prev ? { ...prev, hostId: event.hostId } : prev
          )
          break

        case 'host-lock':
          setRoomState((prev) =>
            prev ? { ...prev, hostLock: event.locked } : prev
          )
          break

        case 'chat':
          setMessages((prev) => {
            const next = [
              ...prev,
              {
                userId: event.userId,
                displayName: event.displayName,
                text: event.text,
                ts: event.ts,
              },
            ]
            return next.length > MAX_HISTORY ? next.slice(-MAX_HISTORY) : next
          })
          break

        case 'reaction':
          setReactions((prev) => {
            const next = [
              ...prev,
              {
                id: uniqueReactionId(),
                userId: event.userId,
                emoji: event.emoji,
                ts: event.ts,
              },
            ]
            return next.length > MAX_HISTORY ? next.slice(-MAX_HISTORY) : next
          })
          break

        case 'clock-pong':
          // Delega para o handler exposto por useClock via retorno do hook
          onPong(event.t1, event.t2, event.t3, 8)
          break
      }
    },
    [onPong]
  )

  useEffect(() => {
    // Determina a URL do WS:
    // - Se VITE_SERVER_URL estiver definida (producao/Docker), usa-a como base.
    // - Sem a env var, cai no proxy Vite (/ws/...) que aponta para localhost:3000.
    const serverUrl = import.meta.env.VITE_SERVER_URL
    const wsUrl = serverUrl
      ? serverUrl.replace(/^http/, 'ws') + '/ws/' + roomId
      : '/ws/' + roomId

    const client = createWsClient({
      url: wsUrl,
      onEvent: handleEvent,
      // Handshake de identidade reenviado em toda (re)abertura do socket.
      handshake: { displayName: identity.displayName, avatar: identity.avatar },
      onOpen: () => {
        setConnected(true)
      },
      onClose: () => setConnected(false),
    })

    wsClientRef.current = client
    setWsClient(client)

    return () => {
      client.close()
      wsClientRef.current = null
      setWsClient(null)
      setConnected(false)
      setRoomState(null)
      setPeers([])
      setMessages([])
      setReactions([])
      setLocalUserId(null)
    }
  }, [roomId, identity.displayName, identity.avatar, handleEvent])

  const sendPlay = useCallback((time: number) => {
    wsClientRef.current?.send({ type: 'play', time })
  }, [])

  const sendPause = useCallback((time: number) => {
    wsClientRef.current?.send({ type: 'pause', time })
  }, [])

  const sendSeek = useCallback((time: number) => {
    wsClientRef.current?.send({ type: 'seek', time })
  }, [])

  const sendChat = useCallback((text: string) => {
    wsClientRef.current?.send({ type: 'chat', text })
  }, [])

  const sendReaction = useCallback((emoji: string) => {
    wsClientRef.current?.send({ type: 'reaction', emoji })
  }, [])

  const sendSetHostLock = useCallback((locked: boolean) => {
    wsClientRef.current?.send({ type: 'set-host-lock', locked })
  }, [])

  return {
    roomState,
    peers,
    messages,
    reactions,
    localUserId,
    sendPlay,
    sendPause,
    sendSeek,
    sendChat,
    sendReaction,
    sendSetHostLock,
    connected,
    _setAdapter: setAdapter,
  }
}
