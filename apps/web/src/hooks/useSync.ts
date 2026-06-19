import { useEffect } from 'react'
import type { RoomState } from '@openparty/protocol'
import type { PlayerAdapter } from '../lib/players/index'
import { decideSyncAction } from '../lib/sync'

const SYNC_LOOP_INTERVAL_MS = 1500

/**
 * Loop de sincronizacao que roda a cada SYNC_LOOP_INTERVAL_MS enquanto playing.
 *
 * Para cada tick:
 * 1. Calcula posicao esperada com base em roomState e serverNow
 * 2. Le posicao atual do adapter
 * 3. Chama decideSyncAction
 * 4. Aplica a acao no adapter (ignore/adjust-rate/seek)
 *
 * Ao decidir 'ignore', reseta a taxa de reproducao para roomState.playbackRate
 * para desfazer qualquer ajuste temporario de um ciclo anterior de 'adjust-rate'.
 */
export function useSync(
  roomState: RoomState | null,
  adapter: PlayerAdapter | null,
  serverNow: () => number
): void {
  useEffect(() => {
    if (!roomState || !adapter) return
    if (!roomState.playing) return

    const timer = setInterval(() => {
      const elapsed = (serverNow() - roomState.lastEventAt) / 1000
      const expectedPositionSecs =
        roomState.positionSecs + elapsed * roomState.playbackRate

      const currentPositionSecs = adapter.getCurrentTime()

      const decision = decideSyncAction(
        currentPositionSecs,
        expectedPositionSecs,
        roomState.mediaType
      )

      switch (decision.action) {
        case 'ignore':
          // Reseta taxa para o valor normal da sala, desfazendo adjust-rate anteriores
          adapter.setPlaybackRate(roomState.playbackRate)
          break
        case 'adjust-rate':
          adapter.setPlaybackRate(decision.rate)
          break
        case 'seek':
          adapter.seekTo(decision.targetSecs).catch(() => {
            // erro de seek: proximo tick vai detectar drift e tentar novamente
          })
          break
      }
    }, SYNC_LOOP_INTERVAL_MS)

    return () => clearInterval(timer)
  }, [roomState, adapter, serverNow])
}
