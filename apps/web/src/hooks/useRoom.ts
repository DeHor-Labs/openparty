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
  /** Envia play para o servidor */
  sendPlay(time: number): void
  sendPause(time: number): void
  sendSeek(time: number): void
  sendChat(text: string): void
  sendReaction(emoji: string): void
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

  const wsClientRef = useRef<WsClient | null>(null)

  const { serverNow } = useClock(wsClientRef.current)
  useSync(roomState, adapter, serverNow)

  const handleEvent = useCallback((event: ServerEvent) => {
    switch (event.type) {
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

      case 'chat':
        setMessages((prev) => [
          ...prev,
          {
            userId: event.userId,
            displayName: event.displayName,
            text: event.text,
            ts: event.ts,
          },
        ])
        break

      case 'reaction':
        setReactions((prev) => [
          ...prev,
          {
            id: uniqueReactionId(),
            userId: event.userId,
            emoji: event.emoji,
            ts: event.ts,
          },
        ])
        break

      case 'clock-pong':
        // Roteado para useClock via ref publica (_handlePong)
        // Ver nota em useClock.ts sobre ponto de integracao
        break
    }
  }, [])

  useEffect(() => {
    const protocol = typeof window !== 'undefined' && window.location.protocol === 'https:' ? 'wss' : 'ws'
    const host = typeof window !== 'undefined' ? window.location.host : 'localhost'
    const wsUrl = `${protocol}://${host}/ws/${roomId}`

    const client = createWsClient({
      url: wsUrl,
      onEvent: handleEvent,
      onOpen: () => {
        setConnected(true)
      },
      onClose: () => setConnected(false),
    })

    wsClientRef.current = client

    return () => {
      client.close()
      wsClientRef.current = null
      setConnected(false)
      setRoomState(null)
      setPeers([])
      setMessages([])
      setReactions([])
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

  return {
    roomState,
    peers,
    messages,
    reactions,
    sendPlay,
    sendPause,
    sendSeek,
    sendChat,
    sendReaction,
    connected,
    _setAdapter: setAdapter,
  }
}
