// apps/server/src/__tests__/clock.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { ClockPingEvent } from '@openparty/protocol'
import type { RoomClient } from '../rooms'
import { handleClockPing } from '../handlers/clock'

describe('handleClockPing', () => {
  let mockSend: ReturnType<typeof vi.fn>
  let mockClient: RoomClient

  beforeEach(() => {
    mockSend = vi.fn()
    mockClient = {
      userId: 'user-1',
      displayName: 'Nikolas',
      avatar: '🎬',
      connectedAt: Date.now(),
      send: mockSend,
    }
  })

  it('responde com clock-pong ecoando t1 e registrando t2 e t3', () => {
    const before = Date.now()
    const event: ClockPingEvent = { type: 'clock-ping', t1: 1000 }

    handleClockPing(event, mockClient)

    const after = Date.now()

    expect(mockSend).toHaveBeenCalledOnce()
    const pong = mockSend.mock.calls[0][0]

    expect(pong.type).toBe('clock-pong')
    expect(pong.t1).toBe(1000)
    expect(pong.t2).toBeGreaterThanOrEqual(before)
    expect(pong.t2).toBeLessThanOrEqual(after)
    expect(pong.t3).toBeGreaterThanOrEqual(pong.t2)
    expect(pong.t3).toBeLessThanOrEqual(after)
  })

  it('t2 e t3 refletem timestamps reais do servidor (nao o t1 do cliente)', () => {
    const event: ClockPingEvent = { type: 'clock-ping', t1: 42 }

    handleClockPing(event, mockClient)

    const pong = mockSend.mock.calls[0][0]
    expect(pong.t2).not.toBe(42)
    expect(pong.t3).not.toBe(42)
  })

  it('t3 e sempre maior ou igual a t2 (envio ocorre apos recepcao)', () => {
    const event: ClockPingEvent = { type: 'clock-ping', t1: 999 }

    handleClockPing(event, mockClient)

    const pong = mockSend.mock.calls[0][0]
    expect(pong.t3).toBeGreaterThanOrEqual(pong.t2)
  })
})
