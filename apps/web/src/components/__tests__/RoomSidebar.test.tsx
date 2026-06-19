// apps/web/src/components/__tests__/RoomSidebar.test.tsx
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import { vi, describe, it, expect, afterEach } from 'vitest'
import type { PresencePeer } from '@openparty/protocol'
import type { ChatMessage } from '../../hooks/useRoom'
import { RoomSidebar } from '../room/RoomSidebar'

const peers: PresencePeer[] = [
  { userId: 'u1', displayName: 'Nikolas', avatar: '🦊' },
  { userId: 'u2', displayName: 'Angélica', avatar: '🐼' },
]

const messages: ChatMessage[] = [
  { userId: 'u1', displayName: 'Nikolas', text: 'Oi!', ts: 1000 },
  { userId: 'u2', displayName: 'Angélica', text: 'Ola!', ts: 2000 },
]

describe('RoomSidebar', () => {
  afterEach(() => {
    cleanup()
  })

  it('exibe os peers na aba Presenca', () => {
    render(<RoomSidebar peers={peers} messages={messages} onSendMessage={vi.fn()} />)
    expect(screen.getByText('Nikolas')).toBeDefined()
    expect(screen.getByText('Angélica')).toBeDefined()
  })

  it('alterna para aba Chat e exibe mensagens', () => {
    render(<RoomSidebar peers={peers} messages={messages} onSendMessage={vi.fn()} />)
    fireEvent.click(screen.getByRole('tab', { name: /chat/i }))
    expect(screen.getByText('Oi!')).toBeDefined()
    expect(screen.getByText('Ola!')).toBeDefined()
  })

  it('chama onSendMessage ao submeter o formulario de chat', () => {
    const onSendMessage = vi.fn()
    render(<RoomSidebar peers={peers} messages={[]} onSendMessage={onSendMessage} />)
    fireEvent.click(screen.getByRole('tab', { name: /chat/i }))
    const input = screen.getByPlaceholderText(/mensagem/i)
    fireEvent.change(input, { target: { value: 'Teste' } })
    fireEvent.submit(input.closest('form')!)
    expect(onSendMessage).toHaveBeenCalledWith('Teste')
  })
})
