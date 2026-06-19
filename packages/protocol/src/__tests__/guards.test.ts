import { describe, it, expect } from 'vitest'
import {
  isClientEvent,
  isPlayClientEvent,
  isPauseClientEvent,
  isSeekClientEvent,
  isClockPingEvent,
  isChatClientEvent,
  isReactionClientEvent,
  isBufferingStartEvent,
  isBufferingEndEvent,
} from '../events'

describe('isClientEvent', () => {
  it('retorna true para objeto com campo type string', () => {
    expect(isClientEvent({ type: 'play', time: 0 })).toBe(true)
  })

  it('retorna false para null', () => {
    expect(isClientEvent(null)).toBe(false)
  })

  it('retorna false para string', () => {
    expect(isClientEvent('play')).toBe(false)
  })

  it('retorna false para objeto sem campo type', () => {
    expect(isClientEvent({ time: 0 })).toBe(false)
  })

  it('retorna false para objeto com type nao-string', () => {
    expect(isClientEvent({ type: 42 })).toBe(false)
  })
})

describe('isPlayClientEvent', () => {
  it('retorna true para evento play valido', () => {
    expect(isPlayClientEvent({ type: 'play', time: 10 })).toBe(true)
  })

  it('retorna false para pause', () => {
    expect(isPlayClientEvent({ type: 'pause', time: 10 })).toBe(false)
  })
})

describe('isPauseClientEvent', () => {
  it('retorna true para evento pause valido', () => {
    expect(isPauseClientEvent({ type: 'pause', time: 5 })).toBe(true)
  })

  it('retorna false para play', () => {
    expect(isPauseClientEvent({ type: 'play', time: 5 })).toBe(false)
  })
})

describe('isSeekClientEvent', () => {
  it('retorna true para evento seek valido', () => {
    expect(isSeekClientEvent({ type: 'seek', time: 90 })).toBe(true)
  })

  it('retorna false para pause', () => {
    expect(isSeekClientEvent({ type: 'pause', time: 90 })).toBe(false)
  })
})

describe('isClockPingEvent', () => {
  it('retorna true para clock-ping valido', () => {
    expect(isClockPingEvent({ type: 'clock-ping', t1: Date.now() })).toBe(true)
  })

  it('retorna false para outro tipo', () => {
    expect(isClockPingEvent({ type: 'play', time: 0 })).toBe(false)
  })
})

describe('isChatClientEvent', () => {
  it('retorna true para chat valido', () => {
    expect(isChatClientEvent({ type: 'chat', text: 'oi' })).toBe(true)
  })

  it('retorna false para reaction', () => {
    expect(isChatClientEvent({ type: 'reaction', emoji: '😂' })).toBe(false)
  })
})

describe('isReactionClientEvent', () => {
  it('retorna true para reaction valido', () => {
    expect(isReactionClientEvent({ type: 'reaction', emoji: '👏' })).toBe(true)
  })

  it('retorna false para chat', () => {
    expect(isReactionClientEvent({ type: 'chat', text: 'ok' })).toBe(false)
  })
})

describe('isBufferingStartEvent', () => {
  it('retorna true para buffering-start', () => {
    expect(isBufferingStartEvent({ type: 'buffering-start' })).toBe(true)
  })

  it('retorna false para buffering-end', () => {
    expect(isBufferingStartEvent({ type: 'buffering-end' })).toBe(false)
  })
})

describe('isBufferingEndEvent', () => {
  it('retorna true para buffering-end', () => {
    expect(isBufferingEndEvent({ type: 'buffering-end' })).toBe(true)
  })

  it('retorna false para buffering-start', () => {
    expect(isBufferingEndEvent({ type: 'buffering-start' })).toBe(false)
  })
})
