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
  type ClientEvent,
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
  it('aceita clock-ping com t1 finito e totalPings valido', () => {
    expect(isClientEvent({ type: 'clock-ping', t1: Date.now(), totalPings: 8 })).toBe(true)
  })

  it('aceita t1=0 com totalPings=1', () => {
    expect(isClientEvent({ type: 'clock-ping', t1: 0, totalPings: 1 })).toBe(true)
  })

  it('aceita totalPings=3 (recalibracao)', () => {
    expect(isClientEvent({ type: 'clock-ping', t1: 1000, totalPings: 3 })).toBe(true)
  })

  it('rejeita t1 ausente', () => {
    expect(isClientEvent({ type: 'clock-ping', totalPings: 8 })).toBe(false)
  })

  it('rejeita t1 null', () => {
    expect(isClientEvent({ type: 'clock-ping', t1: null, totalPings: 8 })).toBe(false)
  })

  it('rejeita t1 string', () => {
    expect(isClientEvent({ type: 'clock-ping', t1: '1000', totalPings: 8 })).toBe(false)
  })

  it('rejeita t1 NaN', () => {
    expect(isClientEvent({ type: 'clock-ping', t1: NaN, totalPings: 8 })).toBe(false)
  })

  it('rejeita t1 Infinity', () => {
    expect(isClientEvent({ type: 'clock-ping', t1: Infinity, totalPings: 8 })).toBe(false)
  })

  it('aceita clock-ping sem totalPings (campo opcional, compatibilidade retroativa)', () => {
    expect(isClientEvent({ type: 'clock-ping', t1: 1000 })).toBe(true)
  })

  it('rejeita totalPings=0 (deve ser >= 1)', () => {
    expect(isClientEvent({ type: 'clock-ping', t1: 1000, totalPings: 0 })).toBe(false)
  })

  it('rejeita totalPings negativo', () => {
    expect(isClientEvent({ type: 'clock-ping', t1: 1000, totalPings: -1 })).toBe(false)
  })

  it('rejeita totalPings string', () => {
    expect(isClientEvent({ type: 'clock-ping', t1: 1000, totalPings: '8' })).toBe(false)
  })

  it('rejeita totalPings decimal (deve ser inteiro)', () => {
    expect(isClientEvent({ type: 'clock-ping', t1: 1000, totalPings: 1.5 })).toBe(false)
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
    expect(isClockPingEvent({ type: 'clock-ping', t1: Date.now(), totalPings: 8 })).toBe(true)
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

// ---------------------------------------------------------------------------
// Casos negativos de shape malformada nos guards de subtipo
// Garante que guards rejeitam payloads com campos faltando ou tipos errados,
// mesmo quando o objeto passa pelo cast de ClientEvent.
// ---------------------------------------------------------------------------

describe('isClientEvent - casos negativos de shape por subtipo', () => {
  // play / pause / seek: campo time obrigatorio

  it('rejeita play sem campo time', () => {
    expect(isClientEvent({ type: 'play' })).toBe(false)
  })

  it('rejeita pause sem campo time', () => {
    expect(isClientEvent({ type: 'pause' })).toBe(false)
  })

  it('rejeita seek sem campo time', () => {
    expect(isClientEvent({ type: 'seek' })).toBe(false)
  })

  it('rejeita play com time undefined', () => {
    expect(isClientEvent({ type: 'play', time: undefined })).toBe(false)
  })

  it('rejeita pause com time boolean', () => {
    expect(isClientEvent({ type: 'pause', time: true })).toBe(false)
  })

  it('rejeita seek com time objeto', () => {
    expect(isClientEvent({ type: 'seek', time: {} })).toBe(false)
  })

  // clock-ping: campo t1 obrigatorio

  it('rejeita clock-ping sem t1 (mesmo com totalPings presente)', () => {
    expect(isClientEvent({ type: 'clock-ping', totalPings: 8 })).toBe(false)
  })

  it('rejeita clock-ping com t1 booleano', () => {
    expect(isClientEvent({ type: 'clock-ping', t1: false, totalPings: 8 })).toBe(false)
  })

  it('rejeita clock-ping com t1 objeto', () => {
    expect(isClientEvent({ type: 'clock-ping', t1: {}, totalPings: 8 })).toBe(false)
  })

  // chat: campo text obrigatorio e deve ser string

  it('rejeita chat com text number', () => {
    expect(isClientEvent({ type: 'chat', text: 0 })).toBe(false)
  })

  it('rejeita chat com text boolean', () => {
    expect(isClientEvent({ type: 'chat', text: true })).toBe(false)
  })

  it('rejeita chat com text array', () => {
    expect(isClientEvent({ type: 'chat', text: ['mensagem'] })).toBe(false)
  })

  it('rejeita chat com text objeto', () => {
    expect(isClientEvent({ type: 'chat', text: { conteudo: 'oi' } })).toBe(false)
  })

  it('rejeita chat com text undefined', () => {
    expect(isClientEvent({ type: 'chat', text: undefined })).toBe(false)
  })

  // reaction: campo emoji obrigatorio e deve ser string

  it('rejeita reaction com emoji number', () => {
    expect(isClientEvent({ type: 'reaction', emoji: 128512 })).toBe(false)
  })

  it('rejeita reaction com emoji booleano', () => {
    expect(isClientEvent({ type: 'reaction', emoji: true })).toBe(false)
  })

  it('rejeita reaction com emoji objeto', () => {
    expect(isClientEvent({ type: 'reaction', emoji: { code: '1f600' } })).toBe(false)
  })

  it('rejeita reaction com emoji undefined', () => {
    expect(isClientEvent({ type: 'reaction', emoji: undefined })).toBe(false)
  })

  // set-host-lock: campo locked obrigatorio e deve ser boolean

  it('rejeita set-host-lock com locked number', () => {
    expect(isClientEvent({ type: 'set-host-lock', locked: 1 })).toBe(false)
  })

  it('rejeita set-host-lock com locked string', () => {
    expect(isClientEvent({ type: 'set-host-lock', locked: 'true' })).toBe(false)
  })

  it('rejeita set-host-lock com locked undefined', () => {
    expect(isClientEvent({ type: 'set-host-lock', locked: undefined })).toBe(false)
  })

  it('rejeita set-host-lock com locked null', () => {
    expect(isClientEvent({ type: 'set-host-lock', locked: null })).toBe(false)
  })

  // Tipos completamente invalidos na raiz

  it('rejeita array vazio', () => {
    expect(isClientEvent([])).toBe(false)
  })

  it('rejeita objeto vazio', () => {
    expect(isClientEvent({})).toBe(false)
  })

  it('rejeita undefined', () => {
    expect(isClientEvent(undefined)).toBe(false)
  })

  it('rejeita boolean true', () => {
    expect(isClientEvent(true)).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// Casos negativos diretos nos guards de subtipo (via cast forcado)
// Garante que o guard de subtipo rejeita eventos do tipo errado
// com campos de shape diferentes.
// ---------------------------------------------------------------------------

describe('guards de subtipo - rejeicoes de tipo cruzado', () => {
  it('isPlayClientEvent retorna false para seek', () => {
    expect(isPlayClientEvent({ type: 'seek', time: 0 })).toBe(false)
  })

  it('isPlayClientEvent retorna false para clock-ping', () => {
    // Cast necessario: payload intencionalmente sem totalPings para testar o guard de subtipo
    expect(isPlayClientEvent({ type: 'clock-ping', t1: 0 } as unknown as ClientEvent)).toBe(false)
  })

  it('isPauseClientEvent retorna false para seek', () => {
    expect(isPauseClientEvent({ type: 'seek', time: 0 })).toBe(false)
  })

  it('isPauseClientEvent retorna false para chat', () => {
    expect(isPauseClientEvent({ type: 'chat', text: 'oi' })).toBe(false)
  })

  it('isSeekClientEvent retorna false para play', () => {
    expect(isSeekClientEvent({ type: 'play', time: 0 })).toBe(false)
  })

  it('isSeekClientEvent retorna false para reaction', () => {
    expect(isSeekClientEvent({ type: 'reaction', emoji: '👏' })).toBe(false)
  })

  it('isClockPingEvent retorna false para chat', () => {
    expect(isClockPingEvent({ type: 'chat', text: 'oi' })).toBe(false)
  })

  it('isClockPingEvent retorna false para seek', () => {
    expect(isClockPingEvent({ type: 'seek', time: 0 })).toBe(false)
  })

  it('isChatClientEvent retorna false para seek', () => {
    expect(isChatClientEvent({ type: 'seek', time: 0 })).toBe(false)
  })

  it('isChatClientEvent retorna false para play', () => {
    expect(isChatClientEvent({ type: 'play', time: 0 })).toBe(false)
  })

  it('isReactionClientEvent retorna false para play', () => {
    expect(isReactionClientEvent({ type: 'play', time: 0 })).toBe(false)
  })

  it('isReactionClientEvent retorna false para seek', () => {
    expect(isReactionClientEvent({ type: 'seek', time: 0 })).toBe(false)
  })

  it('isBufferingStartEvent retorna false para play', () => {
    expect(isBufferingStartEvent({ type: 'play', time: 0 })).toBe(false)
  })

  it('isBufferingStartEvent retorna false para chat', () => {
    expect(isBufferingStartEvent({ type: 'chat', text: 'oi' })).toBe(false)
  })

  it('isBufferingEndEvent retorna false para play', () => {
    expect(isBufferingEndEvent({ type: 'play', time: 0 })).toBe(false)
  })

  it('isBufferingEndEvent retorna false para chat', () => {
    expect(isBufferingEndEvent({ type: 'chat', text: 'oi' })).toBe(false)
  })

  it('isSetHostLockEvent retorna false para play', () => {
    expect(isSetHostLockEvent({ type: 'play', time: 0 })).toBe(false)
  })

  it('isSetHostLockEvent retorna false para buffering-start', () => {
    expect(isSetHostLockEvent({ type: 'buffering-start' })).toBe(false)
  })
})
