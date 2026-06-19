// apps/web/src/pages/RoomPage.tsx
import { useEffect, useState } from 'react'
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
    localUserId,
    sendPlay,
    sendPause,
    sendSeek,
    sendChat,
    sendReaction,
    sendSetHostLock,
    connected,
    _setAdapter,
  } = useRoom(roomId, { displayName, avatar })

  const [adapter, setAdapter] = useState<PlayerAdapter | null>(null)
  /**
   * Duracao real do video em segundos obtida do adapter.
   * Começa em 0 (player ainda nao carregou) e atualiza via evento 'ready'.
   */
  const [durationSecs, setDurationSecs] = useState(0)

  function handleAdapterReady(newAdapter: PlayerAdapter) {
    setAdapter(newAdapter)
    _setAdapter?.(newAdapter)
    // Tenta ler a duracao imediata (pode ser 0 para YouTube antes do onReady)
    const d = newAdapter.getDuration()
    if (d > 0) setDurationSecs(d)
  }

  // Registra listener 'ready' no adapter para capturar a duracao real
  // quando os metadados do video ficarem disponíveis apos o adapter pronto.
  useEffect(() => {
    if (!adapter) return
    function onReady() {
      const d = adapter!.getDuration()
      if (d > 0) setDurationSecs(d)
    }
    adapter.on('ready', onReady)
    return () => {
      adapter.off('ready', onReady)
    }
  }, [adapter])

  if (!roomState) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <p className="text-muted-foreground">
          {connected ? 'Carregando sala...' : 'Conectando...'}
        </p>
      </div>
    )
  }

  // Compara userId proprio (informado pelo servidor) com hostId da sala.
  // Enquanto localUserId for null (welcome ainda nao chegou), isHost permanece false.
  const isHost = localUserId != null && roomState.hostId === localUserId

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
          onSetHostLock={sendSetHostLock}
          durationSecs={durationSecs}
        />
      </main>
      <RoomSidebar peers={peers} messages={messages} onSendMessage={sendChat} />
    </div>
  )
}
