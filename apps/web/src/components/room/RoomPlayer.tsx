// apps/web/src/components/room/RoomPlayer.tsx
import { useEffect, useRef } from 'react'
import type { RoomState } from '@openparty/protocol'
import type { PlayerAdapter } from '../../lib/players/index'
import { createYouTubeAdapter, createHtml5Adapter } from '../../lib/players/index'

interface RoomPlayerProps {
  roomState: RoomState
  onAdapterReady: (adapter: PlayerAdapter) => void
}

export function RoomPlayer({ roomState, onAdapterReady }: RoomPlayerProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const videoRef = useRef<HTMLVideoElement>(null)
  const adapterRef = useRef<PlayerAdapter | null>(null)

  useEffect(() => {
    const { mediaUrl, mediaType } = roomState
    let destroyed = false

    async function init() {
      if (!containerRef.current && !videoRef.current) return

      let adapter: PlayerAdapter

      if (mediaType === 'youtube') {
        const videoId = extractYouTubeId(mediaUrl)
        if (!videoId || !containerRef.current) return
        adapter = await createYouTubeAdapter(containerRef.current, videoId)
      } else {
        if (!videoRef.current) return
        adapter = createHtml5Adapter(videoRef.current)
      }

      if (destroyed) {
        adapter.destroy()
        return
      }

      adapterRef.current = adapter
      onAdapterReady(adapter)
    }

    init()

    return () => {
      destroyed = true
      adapterRef.current?.destroy()
      adapterRef.current = null
    }
  }, [roomState.mediaUrl, roomState.mediaType])

  if (roomState.mediaType === 'youtube') {
    return (
      <div className="w-full aspect-video bg-black">
        <div ref={containerRef} className="w-full h-full" />
      </div>
    )
  }

  return (
    <div className="w-full aspect-video bg-black">
      <video
        ref={videoRef}
        src={roomState.mediaUrl}
        className="w-full h-full"
        playsInline
      />
    </div>
  )
}

function extractYouTubeId(url: string): string | null {
  const patterns = [
    /youtu\.be\/([^?&]+)/,
    /[?&]v=([^?&]+)/,
    /^([a-zA-Z0-9_-]{11})$/,
  ]
  for (const re of patterns) {
    const m = url.match(re)
    if (m) return m[1]
  }
  return null
}
