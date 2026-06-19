// apps/web/src/components/__tests__/ReactionsLayer.test.tsx
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import { vi, describe, it, expect, afterEach } from 'vitest'
import type { ReactionItem } from '../../hooks/useRoom'
import { ReactionsLayer } from '../room/ReactionsLayer'

const reactions: ReactionItem[] = [
  { id: 'r1', userId: 'u1', emoji: '❤️', ts: 1000 },
  { id: 'r2', userId: 'u2', emoji: '😂', ts: 2000 },
]

describe('ReactionsLayer', () => {
  afterEach(() => {
    cleanup()
  })

  it('exibe emojis ativos', () => {
    render(<ReactionsLayer reactions={reactions} onReact={vi.fn()} />)
    expect(screen.getAllByText('❤️').length).toBeGreaterThanOrEqual(1)
    expect(screen.getAllByText('😂').length).toBeGreaterThanOrEqual(1)
  })

  it('chama onReact ao clicar em emoji do seletor', () => {
    const onReact = vi.fn()
    render(<ReactionsLayer reactions={[]} onReact={onReact} />)
    fireEvent.click(screen.getByRole('button', { name: '❤️' }))
    expect(onReact).toHaveBeenCalledWith('❤️')
  })
})
