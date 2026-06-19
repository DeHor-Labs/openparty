// tests/sync.test.ts
// Testes unitarios para a logica de sincronizacao de posicao.
// Nao depende de DOM nem de browser APIs.

import { describe, it, expect } from 'vitest'
import { decideSyncAction } from '../src/lib/sync'

describe('decideSyncAction', () => {
  it('ignora drift abaixo do limiar de 0.3s', () => {
    const result = decideSyncAction(10.1, 10.0, 'native-html5')
    expect(result.action).toBe('ignore')
  })

  it('faz seek quando drift >= 0.5s (cliente atrasado)', () => {
    const result = decideSyncAction(9.4, 10.0, 'native-html5')
    expect(result.action).toBe('seek')
    if (result.action === 'seek') {
      expect(result.targetSecs).toBe(10.0)
    }
  })

  it('faz seek quando drift >= 0.5s (cliente adiantado)', () => {
    const result = decideSyncAction(10.6, 10.0, 'native-html5')
    expect(result.action).toBe('seek')
  })

  it('reduz taxa quando cliente adiantado na faixa intermediaria (native-html5)', () => {
    const result = decideSyncAction(10.4, 10.0, 'native-html5')
    expect(result.action).toBe('adjust-rate')
    if (result.action === 'adjust-rate') {
      expect(result.rate).toBeLessThan(1.0)
    }
  })

  it('aumenta taxa quando cliente atrasado na faixa intermediaria (native-html5)', () => {
    const result = decideSyncAction(9.6, 10.0, 'native-html5')
    expect(result.action).toBe('adjust-rate')
    if (result.action === 'adjust-rate') {
      expect(result.rate).toBeGreaterThan(1.0)
    }
  })

  it('ignora faixa intermediaria para youtube (sem adjust-rate)', () => {
    const result = decideSyncAction(10.4, 10.0, 'youtube')
    expect(result.action).toBe('ignore')
  })

  // Limites exatos dos comparadores (CR item 4)

  // Limites exatos dos comparadores (CR item 4)
  // IGNORE_THRESHOLD = 0.3 usa '<' (exclusivo), entao 0.3 NAO e ignorado

  it('drift exatamente +0.3 usa adjust-rate (limiar exclusivo: < 0.3 ignora, >= 0.3 age)', () => {
    const result = decideSyncAction(10.3, 10.0, 'native-html5')
    // absDrift = 0.3 >= IGNORE_THRESHOLD e < SEEK_THRESHOLD -> adjust-rate para native-html5
    expect(result.action).toBe('adjust-rate')
  })

  it('drift exatamente -0.3 usa adjust-rate (limiar exclusivo)', () => {
    const result = decideSyncAction(9.7, 10.0, 'native-html5')
    // absDrift = 0.3 >= IGNORE_THRESHOLD e < SEEK_THRESHOLD -> adjust-rate para native-html5
    expect(result.action).toBe('adjust-rate')
  })

  it('drift imediatamente abaixo de 0.3 (0.29) e ignorado', () => {
    const result = decideSyncAction(10.29, 10.0, 'native-html5')
    // absDrift = 0.29 < IGNORE_THRESHOLD -> ignore
    expect(result.action).toBe('ignore')
  })

  it('drift exatamente +0.5 faz seek (SEEK_THRESHOLD inclusivo: >= 0.5 seek)', () => {
    const result = decideSyncAction(10.5, 10.0, 'native-html5')
    // absDrift = 0.5 >= SEEK_THRESHOLD -> seek
    expect(result.action).toBe('seek')
  })

  it('drift exatamente -0.5 faz seek (SEEK_THRESHOLD inclusivo)', () => {
    const result = decideSyncAction(9.5, 10.0, 'native-html5')
    // absDrift = 0.5 >= SEEK_THRESHOLD -> seek
    expect(result.action).toBe('seek')
  })

  it('drift imediatamente acima de 0.3 (0.31) usa adjust-rate para native-html5', () => {
    const result = decideSyncAction(10.31, 10.0, 'native-html5')
    // absDrift = 0.31 >= IGNORE_THRESHOLD e < SEEK_THRESHOLD -> adjust-rate
    expect(result.action).toBe('adjust-rate')
  })

  it('drift imediatamente abaixo de 0.5 (0.49) usa adjust-rate para native-html5', () => {
    const result = decideSyncAction(10.49, 10.0, 'native-html5')
    // absDrift = 0.49 < SEEK_THRESHOLD -> adjust-rate
    expect(result.action).toBe('adjust-rate')
  })
})
