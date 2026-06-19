// apps/web/src/components/room/RoomControls.tsx
import type { RoomState } from '@openparty/protocol'

interface RoomControlsProps {
  roomState: RoomState
  isHost: boolean
  onPlay: (time: number) => void
  onPause: (time: number) => void
  onSeek: (time: number) => void
}

export function RoomControls({ roomState, isHost, onPlay, onPause, onSeek }: RoomControlsProps): JSX.Element {
  const { playing, positionSecs, hostLock } = roomState

  function handleSeekChange(e: React.ChangeEvent<HTMLInputElement>) {
    onSeek(Number(e.target.value))
  }

  return (
    <div className="flex flex-col gap-2 px-4 py-3 bg-card border-t border-border">
      <div className="flex items-center gap-3">
        {playing ? (
          <button
            aria-label="pause"
            onClick={() => onPause(positionSecs)}
            className="rounded-md bg-primary text-primary-foreground px-4 py-1.5 text-sm font-medium hover:bg-primary/90 transition-colors"
          >
            Pause
          </button>
        ) : (
          <button
            aria-label="play"
            onClick={() => onPlay(positionSecs)}
            className="rounded-md bg-primary text-primary-foreground px-4 py-1.5 text-sm font-medium hover:bg-primary/90 transition-colors"
          >
            Play
          </button>
        )}

        <input
          type="range"
          min={0}
          max={3600}
          step={1}
          value={positionSecs}
          onChange={handleSeekChange}
          aria-label="seek"
          className="flex-1 accent-primary"
        />

        <span className="text-xs text-muted-foreground tabular-nums w-12 text-right">
          {formatTime(positionSecs)}
        </span>

        {isHost && (
          <span
            role="switch"
            aria-label="host-lock"
            aria-checked={hostLock}
            onClick={() => {
              // toggle handler delegado ao RoomPage via prop futura
            }}
            className={`relative inline-flex h-5 w-9 cursor-pointer items-center rounded-full transition-colors ${
              hostLock ? 'bg-primary' : 'bg-muted'
            }`}
          >
            <span
              className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white shadow transition-transform ${
                hostLock ? 'translate-x-4' : 'translate-x-1'
              }`}
            />
          </span>
        )}
      </div>
    </div>
  )
}

function formatTime(secs: number): string {
  const m = Math.floor(secs / 60)
  const s = Math.floor(secs % 60)
  return `${m}:${s.toString().padStart(2, '0')}`
}
