// apps/web/src/components/room/RoomControls.tsx
import type { RoomState } from '@openparty/protocol'

interface RoomControlsProps {
  roomState: RoomState
  isHost: boolean
  onPlay: (time: number) => void
  onPause: (time: number) => void
  onSeek: (time: number) => void
  /** Chamado pelo host ao clicar no toggle de host-lock */
  onSetHostLock?: (locked: boolean) => void
  /**
   * Duracao real do video em segundos; usada como max do slider de seek.
   * Obrigatorio: o caller deve passar a duracao real do adapter/player.
   * Passar 0 enquanto o player nao estiver pronto e valido; o slider nao
   * se move se o video ainda nao carregou.
   */
  durationSecs: number
}

export function RoomControls({
  roomState,
  isHost,
  onPlay,
  onPause,
  onSeek,
  onSetHostLock,
  durationSecs,
}: RoomControlsProps) {
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
          max={durationSecs}
          step={1}
          value={positionSecs}
          onChange={handleSeekChange}
          aria-label="seek"
          className="flex-1 accent-primary"
        />

        <span className="text-xs text-muted-foreground tabular-nums w-12 text-right">
          {formatTime(positionSecs)}
        </span>

        {/* Toggle de host-lock: visivel para todos, mas desabilitado para nao-host */}
        <span
          role="switch"
          aria-label="host-lock"
          aria-checked={hostLock}
          onClick={() => {
            if (isHost) {
              onSetHostLock?.(!hostLock)
            }
          }}
          aria-disabled={!isHost}
          className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${
            isHost ? 'cursor-pointer' : 'cursor-not-allowed opacity-50'
          } ${hostLock ? 'bg-primary' : 'bg-muted'}`}
        >
          <span
            className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white shadow transition-transform ${
              hostLock ? 'translate-x-4' : 'translate-x-1'
            }`}
          />
        </span>
      </div>
    </div>
  )
}

function formatTime(secs: number): string {
  const m = Math.floor(secs / 60)
  const s = Math.floor(secs % 60)
  return `${m}:${s.toString().padStart(2, '0')}`
}
