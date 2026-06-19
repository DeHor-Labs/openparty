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
  isSetHostLockEvent,
  MAX_TIME_SECS,
  CHAT_MAX_LENGTH,
  EMOJI_MAX_LENGTH,
} from '../events'

// ---------------------------------------------------------------------------
// isClientEvent - rejeicoes gerais
// ---------------------------------------------------------------------------

describe('isClientEvent - rejeicoes gerais', () => {
  it('retorna false para null', () => {
    expect(isClientEvent(null)).toBe(false)
  })

  it('retorna false para string', () => {
    expect(isClientEvent('play')).toBe(false)
  })

  it('retorna false para numero', () => {
    expect(isClientEvent(42)).toBe(false)
  })

  it('retorna false para objeto sem campo type', () => {
    expect(isClientEvent({ time: 0 })).toBe(false)
  })

  it('retorna false para objeto com type nao-string', () => {
    expect(isClientEvent({ type: 42 })).toBe(false)
  })

  it('retorna false para tipo desconhecido', () => {
    expect(isClientEvent({ type: 'tipo-inexistente' })).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// play / pause / seek - validacao do campo time
// ---------------------------------------------------------------------------

describe.each(['play', 'pause', 'seek'] as const)('isClientEvent - %s - campo time', (tipo) => {
  it('aceita time=0 (limite inferior)', () => {
    expect(isClientEvent({ type: tipo, time: 0 })).toBe(true)
  })

  it(`aceita time=${MAX_TIME_SECS} (limite superior)`, () => {
    expect(isClientEvent({ type: tipo, time: MAX_TIME_SECS })).toBe(true)
  })

  it('aceita time intermediario valido', () => {
    expect(isClientEvent({ type: tipo, time: 3600 })).toBe(true)
  })

  it('rejeita time ausente', () => {
    expect(isClientEvent({ type: tipo })).toBe(false)
  })

  it('rejeita time null', () => {
    expect(isClientEvent({ type: tipo, time: null })).toBe(false)
  })

  it('rejeita time string', () => {
    expect(isClientEvent({ type: tipo, time: '10' })).toBe(false)
  })

  it('rejeita time NaN', () => {
    expect(isClientEvent({ type: tipo, time: NaN })).toBe(false)
  })

  it('rejeita time negativo', () => {
    expect(isClientEvent({ type: tipo, time: -1 })).toBe(false)
  })

  it(`rejeita time maior que ${MAX_TIME_SECS}`, () => {
    expect(isClientEvent({ type: tipo, time: MAX_TIME_SECS + 1 })).toBe(false)
  })

  it('rejeita time Infinity', () => {
    expect(isClientEvent({ type: tipo, time: Infinity })).toBe(false)
  })

  it('rejeita time -Infinity', () => {
    expect(isClientEvent({ type: tipo, time: -Infinity })).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// clock-ping - validacao do campo t1
// ---------------------------------------------------------------------------

describe('isClientEvent - clock-ping', () => {
  it('aceita clock-ping com t1 finito', () => {
    expect(isClientEvent({ type: 'clock-ping', t1: Date.now() })).toBe(true)
  })

  it('aceita t1=0', () => {
    expect(isClientEvent({ type: 'clock-ping', t1: 0 })).toBe(true)
  })

  it('rejeita t1 ausente', () => {
    expect(isClientEvent({ type: 'clock-ping' })).toBe(false)
  })

  it('rejeita t1 null', () => {
    expect(isClientEvent({ type: 'clock-ping', t1: null })).toBe(false)
  })

  it('rejeita t1 string', () => {
    expect(isClientEvent({ type: 'clock-ping', t1: '1000' })).toBe(false)
  })

  it('rejeita t1 NaN', () => {
    expect(isClientEvent({ type: 'clock-ping', t1: NaN })).toBe(false)
  })

  it('rejeita t1 Infinity', () => {
    expect(isClientEvent({ type: 'clock-ping', t1: Infinity })).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// chat - validacao do campo text
// ---------------------------------------------------------------------------

describe('isClientEvent - chat', () => {
  it('aceita texto com 1 caractere', () => {
    expect(isClientEvent({ type: 'chat', text: 'a' })).toBe(true)
  })

  it(`aceita texto com ${CHAT_MAX_LENGTH} caracteres (limite maximo)`, () => {
    expect(isClientEvent({ type: 'chat', text: 'x'.repeat(CHAT_MAX_LENGTH) })).toBe(true)
  })

  it('rejeita texto vazio', () => {
    expect(isClientEvent({ type: 'chat', text: '' })).toBe(false)
  })

  it(`rejeita texto com ${CHAT_MAX_LENGTH + 1} caracteres`, () => {
    expect(isClientEvent({ type: 'chat', text: 'x'.repeat(CHAT_MAX_LENGTH + 1) })).toBe(false)
  })

  it('rejeita text ausente', () => {
    expect(isClientEvent({ type: 'chat' })).toBe(false)
  })

  it('rejeita text null', () => {
    expect(isClientEvent({ type: 'chat', text: null })).toBe(false)
  })

  it('rejeita text numero', () => {
    expect(isClientEvent({ type: 'chat', text: 42 })).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// reaction - validacao do campo emoji
// ---------------------------------------------------------------------------

describe('isClientEvent - reaction', () => {
  it('aceita emoji com 1 caractere', () => {
    expect(isClientEvent({ type: 'reaction', emoji: '👏' })).toBe(true)
  })

  it(`aceita emoji string com length ${EMOJI_MAX_LENGTH} (limite maximo)`, () => {
    // Usa ASCII para garantir length correto (emoji ocupa 2 code units em JS)
    expect(isClientEvent({ type: 'reaction', emoji: 'x'.repeat(EMOJI_MAX_LENGTH) })).toBe(true)
  })

  it('rejeita emoji vazio', () => {
    expect(isClientEvent({ type: 'reaction', emoji: '' })).toBe(false)
  })

  it(`rejeita emoji com ${EMOJI_MAX_LENGTH + 1} caracteres`, () => {
    expect(isClientEvent({ type: 'reaction', emoji: 'x'.repeat(EMOJI_MAX_LENGTH + 1) })).toBe(false)
  })

  it('rejeita emoji ausente', () => {
    expect(isClientEvent({ type: 'reaction' })).toBe(false)
  })

  it('rejeita emoji null', () => {
    expect(isClientEvent({ type: 'reaction', emoji: null })).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// set-host-lock
// ---------------------------------------------------------------------------

describe('isClientEvent - set-host-lock', () => {
  it('aceita locked=true', () => {
    expect(isClientEvent({ type: 'set-host-lock', locked: true })).toBe(true)
  })

  it('aceita locked=false', () => {
    expect(isClientEvent({ type: 'set-host-lock', locked: false })).toBe(true)
  })

  it('rejeita locked ausente', () => {
    expect(isClientEvent({ type: 'set-host-lock' })).toBe(false)
  })

  it('rejeita locked string', () => {
    expect(isClientEvent({ type: 'set-host-lock', locked: 'true' })).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// buffering-start / buffering-end
// ---------------------------------------------------------------------------

describe('isClientEvent - buffering', () => {
  it('aceita buffering-start', () => {
    expect(isClientEvent({ type: 'buffering-start' })).toBe(true)
  })

  it('aceita buffering-end', () => {
    expect(isClientEvent({ type: 'buffering-end' })).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// Guards de subtipo - isPlayClientEvent, isPauseClientEvent, etc.
// ---------------------------------------------------------------------------

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

describe('isSetHostLockEvent', () => {
  it('retorna true para set-host-lock valido', () => {
    expect(isSetHostLockEvent({ type: 'set-host-lock', locked: true })).toBe(true)
  })

  it('retorna false para outro tipo', () => {
    expect(isSetHostLockEvent({ type: 'chat', text: 'oi' })).toBe(false)
  })
})
