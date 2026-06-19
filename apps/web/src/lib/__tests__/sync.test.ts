import { describe, expect, it } from 'vitest'
import { decideSyncAction } from '../sync'

describe('decideSyncAction - mp4', () => {
  it('ignora quando drift eh menor que 0.3s', () => {
    const result = decideSyncAction(10.1, 10.0, 'mp4')
    expect(result.action).toBe('ignore')
  })

  it('ignora quando drift eh exatamente 0 (sincronizado)', () => {
    const result = decideSyncAction(30.0, 30.0, 'mp4')
    expect(result.action).toBe('ignore')
  })

  it('ignora quando drift negativo menor que 0.3s', () => {
    // atual 10.2, esperado 10.0 -> drift = 0.2, dentro do limiar
    const result = decideSyncAction(10.2, 10.0, 'mp4')
    expect(result.action).toBe('ignore')
  })

  it('ajusta taxa quando drift esta entre 0.3s e 0.5s (cliente atrasado)', () => {
    // atual 10.0, esperado 10.4 -> drift = -0.4 (cliente esta 0.4s atrasado)
    const result = decideSyncAction(10.0, 10.4, 'mp4')
    expect(result.action).toBe('adjust-rate')
    if (result.action === 'adjust-rate') {
      expect(result.rate).toBeGreaterThan(1.0)
    }
  })

  it('ajusta taxa quando drift esta entre 0.3s e 0.5s (cliente adiantado)', () => {
    // atual 10.5, esperado 10.1 -> drift = 0.4 (cliente esta 0.4s adiantado)
    const result = decideSyncAction(10.5, 10.1, 'mp4')
    expect(result.action).toBe('adjust-rate')
    if (result.action === 'adjust-rate') {
      expect(result.rate).toBeLessThan(1.0)
    }
  })

  it('busca seek quando drift maior que 0.5s', () => {
    // atual 10.0, esperado 11.0 -> drift = -1.0
    const result = decideSyncAction(10.0, 11.0, 'mp4')
    expect(result.action).toBe('seek')
    if (result.action === 'seek') {
      expect(result.targetSecs).toBe(11.0)
    }
  })

  it('busca seek quando drift negativo maior que 0.5s', () => {
    // atual 11.0, esperado 9.8 -> drift = 1.2
    const result = decideSyncAction(11.0, 9.8, 'mp4')
    expect(result.action).toBe('seek')
    if (result.action === 'seek') {
      expect(result.targetSecs).toBe(9.8)
    }
  })

  it('seek exatamente no limiar de 0.5s', () => {
    // drift = 0.5: deve ser seek (> 0.5 inclusive)
    const result = decideSyncAction(10.0, 10.5, 'mp4')
    expect(result.action).toBe('seek')
  })
})

describe('decideSyncAction - youtube', () => {
  it('ignora quando drift eh menor que 0.3s', () => {
    const result = decideSyncAction(10.1, 10.0, 'youtube')
    expect(result.action).toBe('ignore')
  })

  it('ignora quando drift esta na faixa media (0.3s-0.5s) - YouTube nao ajusta taxa', () => {
    // Para YouTube, adjust-rate nao e retornado; permanece ignore na faixa media
    const result = decideSyncAction(10.0, 10.4, 'youtube')
    expect(result.action).toBe('ignore')
  })

  it('busca seek quando drift maior que 0.5s no YouTube', () => {
    const result = decideSyncAction(10.0, 11.0, 'youtube')
    expect(result.action).toBe('seek')
    if (result.action === 'seek') {
      expect(result.targetSecs).toBe(11.0)
    }
  })
})
