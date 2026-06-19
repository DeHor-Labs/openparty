// apps/web/src/pages/RoomPage.tsx
import { useState } from 'react'
import { useParams } from 'react-router-dom'
import { useRoom } from '../hooks/useRoom'
import { RoomPlayer } from '../components/room/RoomPlayer'
import { RoomSidebar } from '../components/room/RoomSidebar'
import { RoomControls } from '../components/room/RoomControls'
import { ReactionsLayer } from '../components/room/ReactionsLayer'
import { ThemeToggle } from '../components/ThemeToggle'
import type { PlayerAdapter } from '../lib/players/index'

export function RoomPage() {
  const { roomId = '' } = useParams()
  const displayName = sessionStorage.getItem('op_nickname') ?? 'Anonimo'
  const avatar = sessionStorage.getItem('op_avatar') ?? '🎬'

  const {
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
    _setAdapter,
  } = useRoom(roomId, { displayName, avatar })

  const [, setAdapter] = useState<PlayerAdapter | null>(null)

  function handleAdapterReady(adapter: PlayerAdapter) {
    setAdapter(adapter)
    _setAdapter?.(adapter)
  }

  if (!roomState) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <p className="text-muted-foreground">
          {connected ? 'Carregando sala...' : 'Conectando...'}
        </p>
      </div>
    )
  }

  const isHost = roomState.hostId === displayName

  return (
    <div className="flex h-screen overflow-hidden bg-background">
      <main className="flex flex-col flex-1 min-w-0">
        <div className="relative flex-1">
          <RoomPlayer roomState={roomState} onAdapterReady={handleAdapterReady} />
          <ReactionsLayer reactions={reactions} onReact={sendReaction} />
          {/* Toggle de tema fixo no canto superior direito da area de video */}
          <div className="absolute top-2 right-2 z-10">
            <ThemeToggle />
          </div>
        </div>
        <RoomControls
          roomState={roomState}
          isHost={isHost}
          onPlay={sendPlay}
          onPause={sendPause}
          onSeek={sendSeek}
        />
      </main>
      <RoomSidebar peers={peers} messages={messages} onSendMessage={sendChat} />
    </div>
  )
}
