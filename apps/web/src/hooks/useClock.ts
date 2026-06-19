import { useCallback, useEffect, useRef, useState } from 'react'
import type { WsClient } from '../lib/ws-client'
import { computeClockOffset, selectBestOffset, type ClockSample } from '../lib/clock'

const INITIAL_PINGS = 8
const RECALIBRATE_PINGS = 3
const RECALIBRATE_INTERVAL_MS = 60_000
const PING_INTERVAL_MS = 80

/** Handler chamado por useRoom ao receber um evento clock-pong do servidor */
export type ClockPongHandler = (
  t1: number,
  t2: number,
  t3: number,
  totalPings: number
) => void

export interface UseClockResult {
  /** Date.now() + offset calibrado */
  serverNow: () => number
  /** true enquanto calibracao inicial (8 pings) nao terminou */
  calibrating: boolean
  /**
   * Handler que deve ser chamado por useRoom ao receber clock-pong.
   * Recebe os quatro campos (t1, t2, t3, totalPings) e atualiza o offset.
   */
  onPong: ClockPongHandler
}

/**
 * Envia INITIAL_PINGS pings na entrada e recalibra com RECALIBRATE_PINGS pings
 * a cada RECALIBRATE_INTERVAL_MS.
 *
 * Recebe o WsClient via useState (nao via ref) para garantir que o effect
 * de envio de pings seja disparado quando o cliente estiver disponivel.
 * Ignora silenciosamente se wsClient for null.
 */
export function useClock(wsClient: WsClient | null): UseClockResult {
  const [calibrating, setCalibrating] = useState(true)
  const offsetRef = useRef(0)
  const pendingRef = useRef<Map<number, number>>(new Map())
  const samplesRef = useRef<ClockSample[]>([])

  const serverNow = useCallback(() => Date.now() + offsetRef.current, [])

  const sendPing = useCallback(() => {
    if (!wsClient) return
    const t1 = Date.now()
    pendingRef.current.set(t1, t1)
    wsClient.send({ type: 'clock-ping', t1 })
  }, [wsClient])

  const onPong = useCallback<ClockPongHandler>(
    (t1, t2, t3, totalPings) => {
      const t4 = Date.now()
      if (!pendingRef.current.has(t1)) return
      pendingRef.current.delete(t1)

      const sample = computeClockOffset(t1, t2, t3, t4)
      samplesRef.current.push(sample)

      if (samplesRef.current.length >= totalPings) {
        offsetRef.current = selectBestOffset(samplesRef.current)
        samplesRef.current = []
        setCalibrating(false)
      }
    },
    []
  )

  // Calibracao inicial: enviar INITIAL_PINGS pings espacados por PING_INTERVAL_MS
  useEffect(() => {
    if (!wsClient) return

    let sent = 0
    const interval = setInterval(() => {
      if (sent >= INITIAL_PINGS) {
        clearInterval(interval)
        return
      }
      sendPing()
      sent++
    }, PING_INTERVAL_MS)

    return () => clearInterval(interval)
  }, [wsClient, sendPing])

  // Recalibracao periodica apos calibracao inicial concluida
  useEffect(() => {
    if (!wsClient || calibrating) return

    const timer = setInterval(() => {
      samplesRef.current = []
      let sent = 0
      const inner = setInterval(() => {
        if (sent >= RECALIBRATE_PINGS) {
          clearInterval(inner)
          return
        }
        sendPing()
        sent++
      }, PING_INTERVAL_MS)
    }, RECALIBRATE_INTERVAL_MS)

    return () => clearInterval(timer)
  }, [wsClient, calibrating, sendPing])

  return { serverNow, calibrating, onPong }
}
