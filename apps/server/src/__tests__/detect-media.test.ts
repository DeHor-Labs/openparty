// apps/server/src/__tests__/detect-media.test.ts
//
// Testes de detectMediaType (servidor) e rate-limiter com timestamps dispersos.

import { describe, it, expect, beforeEach } from 'vitest'
import { detectMediaType } from '../index'
import { applyRateLimit, resetRateLimit, RATE_WINDOW_MS } from '../rate-limiter'

// ---------------------------------------------------------------------------
// detectMediaType - logica de hostname exato
// ---------------------------------------------------------------------------

describe('detectMediaType - servidor', () => {
  // URLs validas do YouTube

  it('classifica youtube.com como youtube', () => {
    expect(detectMediaType('https://www.youtube.com/watch?v=dQw4w9WgXcQ')).toBe('youtube')
  })

  it('classifica youtu.be como youtube', () => {
    expect(detectMediaType('https://youtu.be/dQw4w9WgXcQ')).toBe('youtube')
  })

  it('classifica m.youtube.com como youtube', () => {
    expect(detectMediaType('https://m.youtube.com/watch?v=dQw4w9WgXcQ')).toBe('youtube')
  })

  it('classifica ID puro de 11 chars como youtube', () => {
    expect(detectMediaType('dQw4w9WgXcQ')).toBe('youtube')
  })

  // URLs que NAO sao YouTube (falsos positivos que includes() aceitaria)

  it('nao classifica evil.com/path/youtube.com/x como youtube', () => {
    // URL de ataque com "youtube.com" no path - includes() aceitaria, hostname exato nao
    expect(detectMediaType('https://evil.com/path/youtube.com/x')).toBe('mp4')
  })

  it('nao classifica fakeyoutu.be como youtube', () => {
    expect(detectMediaType('https://fakeyoutu.be/video')).toBe('mp4')
  })

  it('nao classifica notyoutube.com como youtube', () => {
    expect(detectMediaType('https://notyoutube.com/video')).toBe('mp4')
  })

  // Novos hostnames adicionados (item 5 - servidor) / item 10 (cliente)
  it('classifica music.youtube.com como youtube', () => {
    expect(detectMediaType('https://music.youtube.com/watch?v=dQw4w9WgXcQ')).toBe('youtube')
  })

  it('classifica www.youtube-nocookie.com como youtube', () => {
    expect(detectMediaType('https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ')).toBe('youtube')
  })

  it('classifica URL .mp4 generica como mp4', () => {
    expect(detectMediaType('https://example.com/video.mp4')).toBe('mp4')
  })

  it('classifica URL invalida sem lancer excecao (trata como mp4)', () => {
    // URL invalida nao deve propagar excecao
    expect(() => detectMediaType('nao-e-url')).not.toThrow()
    expect(detectMediaType('nao-e-url')).toBe('mp4')
  })

  it('classifica string vazia sem lancar excecao', () => {
    expect(() => detectMediaType('')).not.toThrow()
    expect(detectMediaType('')).toBe('mp4')
  })
})

// ---------------------------------------------------------------------------
// rate-limiter - timestamps dispersos (janela deslizante real)
// ---------------------------------------------------------------------------

describe('applyRateLimit - timestamps dispersos dentro da janela', () => {
  const CONN = 'conn-dispersos'

  beforeEach(() => {
    resetRateLimit(CONN)
  })

  it('aceita chegadas distribuidas dentro da janela ate o limite', () => {
    const base = Date.now()
    // 10 chegadas em momentos distintos dentro da janela (cada uma +100ms)
    for (let i = 0; i < 10; i++) {
      expect(applyRateLimit(CONN, 'chat', base + i * 100)).toBe(true)
    }
    // 11a chegada ainda dentro da janela: deve ser bloqueada
    expect(applyRateLimit(CONN, 'chat', base + 10 * 100)).toBe(false)
  })

  it('permite nova chegada quando a mais antiga sair da janela deslizante', () => {
    const base = Date.now()
    // Enche o limite em momentos distintos
    for (let i = 0; i < 10; i++) {
      applyRateLimit(CONN, 'chat', base + i * 100)
    }

    // No instante base + RATE_WINDOW_MS + 1ms a mensagem mais antiga (base + 0)
    // ja saiu da janela: deve liberar uma vaga
    const depois = base + RATE_WINDOW_MS + 1
    expect(applyRateLimit(CONN, 'chat', depois)).toBe(true)
  })

  it('nao conta chegadas fora da janela ao verificar o limite', () => {
    const base = Date.now()
    // 5 chegadas antigas (fora da janela)
    for (let i = 0; i < 5; i++) {
      applyRateLimit(CONN, 'chat', base - RATE_WINDOW_MS - 1000 + i)
    }
    // 10 chegadas recentes (dentro da janela)
    for (let i = 0; i < 10; i++) {
      applyRateLimit(CONN, 'chat', base + i * 10)
    }
    // Proxima deve ser bloqueada apenas pelas 10 recentes
    expect(applyRateLimit(CONN, 'chat', base + 200)).toBe(false)
  })
})
