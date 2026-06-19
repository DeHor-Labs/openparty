import { useCallback, useEffect, useRef, useState } from 'react'
import type { WsClient } from '../lib/ws-client'
import { computeClockOffset, selectBestOffset, type ClockSample } from '../lib/clock'

const INITIAL_PINGS = 8
const RECALIBRATE_PINGS = 3
const RECALIBRATE_INTERVAL_MS = 60_000
const PING_INTERVAL_MS = 80
/** Tempo maximo esperando pong antes de descartar o ping pendente */
const PING_PONG_TIMEOUT_MS = 2_000
/**
 * Timeout maximo de toda a sessao de calibracao.
 * Se nao concluir neste prazo (ex: pongs perdidos), conclui com as amostras
 * disponiveies (se houver alguma) ou permanece calibrando para a proxima rodada.
 * Valor = INITIAL_PINGS * PING_INTERVAL_MS * 2 + PING_PONG_TIMEOUT_MS com margem.
 */
const CALIBRATION_TIMEOUT_MS = INITIAL_PINGS * PING_INTERVAL_MS * 2 + PING_PONG_TIMEOUT_MS + 500
/** Numero minimo de amostras para concluir calibracao mesmo com perdas */
const MIN_SAMPLES_TO_CALIBRATE = 3
/**
 * Codigo OPEN da interface WebSocket (igual a WebSocket.OPEN = 1).
 * Definido como constante para uso nos checks sem depender do global em testes.
 */
const WS_OPEN = 1

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
  /** Mapa de t1 -> timer de expiracao do ping */
  const pingTimeoutsRef = useRef<Map<number, ReturnType<typeof setTimeout>>>(new Map())
  /** Timer de timeout de toda a sessao de calibracao corrente */
  const calibrationTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  /** Ref do inner setInterval da recalibracao (para cleanup no unmount) */
  const innerRecalibrateRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const serverNow = useCallback(() => Date.now() + offsetRef.current, [])

  /** Conclui a calibracao corrente com as amostras acumuladas ate o momento */
  const concludeCalibration = useCallback(() => {
    if (calibrationTimeoutRef.current !== null) {
      clearTimeout(calibrationTimeoutRef.current)
      calibrationTimeoutRef.current = null
    }
    if (samplesRef.current.length >= MIN_SAMPLES_TO_CALIBRATE) {
      offsetRef.current = selectBestOffset(samplesRef.current)
    }
    samplesRef.current = []
    setCalibrating(false)
  }, [])

  /**
   * Envia um clock-ping com o `totalPings` da sessao corrente.
   * O servidor faz eco desse valor no pong, permitindo que o cliente saiba
   * quando acumulou amostras suficientes (calibracao inicial vs recalibracao).
   *
   * O timeout de expiracao e armado SOMENTE quando o WebSocket esta OPEN
   * para evitar que expire antes do envio real em rede ruim.
   */
  const sendPing = useCallback((totalPings: number) => {
    if (!wsClient) return
    // Arma o timeout de expiracao somente apos confirmar que o socket esta OPEN
    if (wsClient.readyState !== WS_OPEN) return
    const t1 = Date.now()
    pendingRef.current.set(t1, t1)

    // Agenda expiracao do ping: se pong nao chegar a tempo, remove da lista de pendentes
    const expiryTimer = setTimeout(() => {
      pendingRef.current.delete(t1)
      pingTimeoutsRef.current.delete(t1)
    }, PING_PONG_TIMEOUT_MS)
    pingTimeoutsRef.current.set(t1, expiryTimer)

    wsClient.send({ type: 'clock-ping', t1, totalPings })
  }, [wsClient])

  const onPong = useCallback<ClockPongHandler>(
    (t1, t2, t3, totalPings) => {
      const t4 = Date.now()
      if (!pendingRef.current.has(t1)) return
      pendingRef.current.delete(t1)

      // Cancela o timer de expiracao pois o pong chegou a tempo
      const expiryTimer = pingTimeoutsRef.current.get(t1)
      if (expiryTimer !== undefined) {
        clearTimeout(expiryTimer)
        pingTimeoutsRef.current.delete(t1)
      }

      const sample = computeClockOffset(t1, t2, t3, t4)
      samplesRef.current.push(sample)

      if (samplesRef.current.length >= totalPings) {
        concludeCalibration()
      }
    },
    [concludeCalibration]
  )

  // Cleanup de todos os timers de expiracao no unmount
  useEffect(() => {
    return () => {
      for (const timer of pingTimeoutsRef.current.values()) {
        clearTimeout(timer)
      }
      pingTimeoutsRef.current.clear()
      if (calibrationTimeoutRef.current !== null) {
        clearTimeout(calibrationTimeoutRef.current)
        calibrationTimeoutRef.current = null
      }
      if (innerRecalibrateRef.current !== null) {
        clearInterval(innerRecalibrateRef.current)
        innerRecalibrateRef.current = null
      }
    }
  }, [])

  // Calibracao inicial: enviar INITIAL_PINGS pings espacados por PING_INTERVAL_MS
  useEffect(() => {
    if (!wsClient) return

    // Timeout de seguranca: conclui calibracao mesmo se alguns pongs se perderem
    calibrationTimeoutRef.current = setTimeout(() => {
      calibrationTimeoutRef.current = null
      concludeCalibration()
    }, CALIBRATION_TIMEOUT_MS)

    let sent = 0
    const interval = setInterval(() => {
      if (sent >= INITIAL_PINGS) {
        clearInterval(interval)
        return
      }
      sendPing(INITIAL_PINGS)
      sent++
    }, PING_INTERVAL_MS)

    return () => {
      clearInterval(interval)
      if (calibrationTimeoutRef.current !== null) {
        clearTimeout(calibrationTimeoutRef.current)
        calibrationTimeoutRef.current = null
      }
    }
  }, [wsClient, sendPing, concludeCalibration])

  // Recalibracao periodica apos calibracao inicial concluida
  useEffect(() => {
    if (!wsClient || calibrating) return

    const timer = setInterval(() => {
      samplesRef.current = []
      let sent = 0
      // Guarda ref do inner para limpeza no unmount
      innerRecalibrateRef.current = setInterval(() => {
        if (sent >= RECALIBRATE_PINGS) {
          if (innerRecalibrateRef.current !== null) {
            clearInterval(innerRecalibrateRef.current)
            innerRecalibrateRef.current = null
          }
          return
        }
        sendPing(RECALIBRATE_PINGS)
        sent++
      }, PING_INTERVAL_MS)
    }, RECALIBRATE_INTERVAL_MS)

    return () => {
      clearInterval(timer)
      // Limpa o inner interval caso o componente desmonte no meio de uma rajada
      if (innerRecalibrateRef.current !== null) {
        clearInterval(innerRecalibrateRef.current)
        innerRecalibrateRef.current = null
      }
    }
  }, [wsClient, calibrating, sendPing])

  return { serverNow, calibrating, onPong }
}
