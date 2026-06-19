import { describe, it, expect } from 'vitest'
import { computeCurrentPosition, applyPlay, applyPause, applySeek } from '../state'
import type { RoomState } from '@openparty/protocol'

// Estado base reutilizado pelos testes - imutavel por convencao
const BASE_STATE: RoomState = {
  roomId: 'room-1',
  mediaUrl: 'https://example.com/video.mp4',
  mediaType: 'mp4',
  playing: false,
  positionSecs: 0,
  lastEventAt: 1000,
  playbackRate: 1.0,
  hostId: 'user-1',
  hostLock: false,
}

// -----------------------------------------------------------------------
// computeCurrentPosition
// -----------------------------------------------------------------------

describe('computeCurrentPosition', () => {
  it('retorna positionSecs quando playing=false (posicao congelada)', () => {
    const state: RoomState = { ...BASE_STATE, playing: false, positionSecs: 42 }
    expect(computeCurrentPosition(state)).toBe(42)
  })

  it('avanca posicao com base no tempo decorrido quando playing=true', () => {
    const state: RoomState = {
      ...BASE_STATE,
      playing: true,
      positionSecs: 10,
      lastEventAt: 0,
      playbackRate: 1.0,
    }
    // serverNow = 5000ms -> 5s decorridos
    const result = computeCurrentPosition(state, 5000)
    expect(result).toBeCloseTo(15, 5)
  })

  it('respeita playbackRate diferente de 1', () => {
    const state: RoomState = {
      ...BASE_STATE,
      playing: true,
      positionSecs: 0,
      lastEventAt: 0,
      playbackRate: 2.0,
    }
    // 3s reais -> 6s de midia
    const result = computeCurrentPosition(state, 3000)
    expect(result).toBeCloseTo(6, 5)
  })

  it('retorna valor correto com playbackRate 0.5', () => {
    const state: RoomState = {
      ...BASE_STATE,
      playing: true,
      positionSecs: 20,
      lastEventAt: 0,
      playbackRate: 0.5,
    }
    // 10s reais -> 5s de midia
    const result = computeCurrentPosition(state, 10000)
    expect(result).toBeCloseTo(25, 5)
  })

  it('usa Date.now() como fallback quando serverNow nao e fornecido e playing=false', () => {
    const state: RoomState = { ...BASE_STATE, playing: false, positionSecs: 99 }
    expect(computeCurrentPosition(state)).toBe(99)
  })
})

// -----------------------------------------------------------------------
// applyPlay
// -----------------------------------------------------------------------

describe('applyPlay', () => {
  it('retorna novo estado com playing=true', () => {
    const state: RoomState = { ...BASE_STATE, playing: false, positionSecs: 30 }
    const next = applyPlay(state, 30, 5000)
    expect(next.playing).toBe(true)
  })

  it('atualiza positionSecs com o time recebido', () => {
    const next = applyPlay(BASE_STATE, 45, 5000)
    expect(next.positionSecs).toBe(45)
  })

  it('atualiza lastEventAt com serverNow', () => {
    const next = applyPlay(BASE_STATE, 0, 9999)
    expect(next.lastEventAt).toBe(9999)
  })

  it('nao muta o estado original', () => {
    const original = { ...BASE_STATE, positionSecs: 10 }
    applyPlay(original, 20, 1000)
    expect(original.positionSecs).toBe(10)
    expect(original.playing).toBe(false)
  })

  it('preserva campos nao alterados', () => {
    const next = applyPlay(BASE_STATE, 0, 0)
    expect(next.roomId).toBe(BASE_STATE.roomId)
    expect(next.mediaUrl).toBe(BASE_STATE.mediaUrl)
    expect(next.hostId).toBe(BASE_STATE.hostId)
    expect(next.playbackRate).toBe(BASE_STATE.playbackRate)
  })

  it('funciona quando ja estava playing (idempotente no campo playing)', () => {
    const state: RoomState = { ...BASE_STATE, playing: true, positionSecs: 5 }
    const next = applyPlay(state, 5, 2000)
    expect(next.playing).toBe(true)
    expect(next.positionSecs).toBe(5)
  })
})

// -----------------------------------------------------------------------
// applyPause
// -----------------------------------------------------------------------

describe('applyPause', () => {
  it('retorna novo estado com playing=false', () => {
    const state: RoomState = { ...BASE_STATE, playing: true, positionSecs: 60 }
    const next = applyPause(state, 60, 8000)
    expect(next.playing).toBe(false)
  })

  it('atualiza positionSecs com o time recebido', () => {
    const state: RoomState = { ...BASE_STATE, playing: true }
    const next = applyPause(state, 77, 8000)
    expect(next.positionSecs).toBe(77)
  })

  it('atualiza lastEventAt com serverNow', () => {
    const state: RoomState = { ...BASE_STATE, playing: true }
    const next = applyPause(state, 0, 12345)
    expect(next.lastEventAt).toBe(12345)
  })

  it('nao muta o estado original', () => {
    const original: RoomState = { ...BASE_STATE, playing: true, positionSecs: 50 }
    applyPause(original, 50, 1000)
    expect(original.playing).toBe(true)
    expect(original.positionSecs).toBe(50)
  })

  it('funciona quando ja estava pausado (idempotente no campo playing)', () => {
    const state: RoomState = { ...BASE_STATE, playing: false, positionSecs: 20 }
    const next = applyPause(state, 20, 500)
    expect(next.playing).toBe(false)
    expect(next.positionSecs).toBe(20)
  })

  it('preserva playbackRate', () => {
    const state: RoomState = { ...BASE_STATE, playing: true, playbackRate: 1.5 }
    const next = applyPause(state, 10, 0)
    expect(next.playbackRate).toBe(1.5)
  })
})

// -----------------------------------------------------------------------
// applySeek
// -----------------------------------------------------------------------

describe('applySeek', () => {
  it('atualiza positionSecs com o time recebido', () => {
    const next = applySeek(BASE_STATE, 120, 3000)
    expect(next.positionSecs).toBe(120)
  })

  it('atualiza lastEventAt com serverNow', () => {
    const next = applySeek(BASE_STATE, 0, 7777)
    expect(next.lastEventAt).toBe(7777)
  })

  it('preserva o campo playing existente quando era false', () => {
    const state: RoomState = { ...BASE_STATE, playing: false }
    const next = applySeek(state, 50, 0)
    expect(next.playing).toBe(false)
  })

  it('preserva o campo playing existente quando era true', () => {
    const state: RoomState = { ...BASE_STATE, playing: true }
    const next = applySeek(state, 50, 0)
    expect(next.playing).toBe(true)
  })

  it('nao muta o estado original', () => {
    const original = { ...BASE_STATE, positionSecs: 0 }
    applySeek(original, 999, 0)
    expect(original.positionSecs).toBe(0)
  })

  it('funciona com seek para posicao zero', () => {
    const state: RoomState = { ...BASE_STATE, positionSecs: 300 }
    const next = applySeek(state, 0, 0)
    expect(next.positionSecs).toBe(0)
  })

  it('preserva playbackRate e outros campos', () => {
    const state: RoomState = { ...BASE_STATE, playbackRate: 2.0 }
    const next = applySeek(state, 10, 0)
    expect(next.playbackRate).toBe(2.0)
    expect(next.roomId).toBe(BASE_STATE.roomId)
  })
})
