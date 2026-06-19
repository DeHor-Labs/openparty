import { describe, expect, it } from 'vitest'
import { computeClockOffset, selectBestOffset } from '../clock'

describe('computeClockOffset', () => {
  it('retorna rtt = (t4 - t1) e offset NTP correto quando sem atraso assimetrico', () => {
    // t1=1000, t2=1100 (chega no servidor 100ms depois)
    // t3=1105 (servidor processa 5ms e envia)
    // t4=1210 (chega no cliente 105ms depois)
    // RTT = (t4 - t1) - (t3 - t2) = (1210 - 1000) - (1105 - 1100) = 210 - 5 = 205
    // offset = ((t2 - t1) + (t3 - t4)) / 2 = ((1100-1000) + (1105-1210)) / 2 = (100 - 105) / 2 = -2.5
    const result = computeClockOffset(1000, 1100, 1105, 1210)
    expect(result.rtt).toBe(205)
    expect(result.offset).toBeCloseTo(-2.5, 5)
  })

  it('retorna offset positivo quando cliente esta atrasado em relacao ao servidor', () => {
    // cliente esta 500ms atrasado: servidor esta em t=1500 quando cliente esta em t=1000
    // t1=1000, t2=1500, t3=1500, t4=1001 (RTT=1ms)
    // offset = ((1500-1000) + (1500-1001)) / 2 = (500 + 499) / 2 = 499.5
    const result = computeClockOffset(1000, 1500, 1500, 1001)
    expect(result.offset).toBeCloseTo(499.5, 1)
    expect(result.rtt).toBe(1)
  })

  it('retorna offset zero quando clocks estao sincronizados e RTT eh simetrico', () => {
    // t1=1000, t2=1050, t3=1050, t4=1100 (50ms RTT simetrico)
    // offset = ((1050-1000) + (1050-1100)) / 2 = (50 + (-50)) / 2 = 0
    const result = computeClockOffset(1000, 1050, 1050, 1100)
    expect(result.offset).toBe(0)
    expect(result.rtt).toBe(100)
  })
})

describe('selectBestOffset', () => {
  it('retorna o offset da amostra com menor RTT', () => {
    const samples = [
      { rtt: 200, offset: 10 },
      { rtt: 50, offset: 7 },
      { rtt: 150, offset: 12 },
    ]
    expect(selectBestOffset(samples)).toBe(7)
  })

  it('retorna 0 quando array esta vazio', () => {
    expect(selectBestOffset([])).toBe(0)
  })

  it('retorna o unico offset quando ha uma so amostra', () => {
    expect(selectBestOffset([{ rtt: 100, offset: 42 }])).toBe(42)
  })
})
