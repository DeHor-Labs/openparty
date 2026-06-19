// apps/web/src/components/__tests__/ReactionsLayer.test.tsx
import { render, screen, fireEvent, cleanup, act } from '@testing-library/react'
import { vi, describe, it, expect, afterEach, beforeEach } from 'vitest'
import type { ReactionItem } from '../../hooks/useRoom'
import { ReactionsLayer } from '../room/ReactionsLayer'

describe('ReactionsLayer', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    // Define "agora" para que reactions recentes (ts=Date.now()) sejam exibidas
    vi.setSystemTime(5000)
  })

  afterEach(() => {
    vi.useRealTimers()
    cleanup()
  })

  it('exibe emojis ativos', () => {
    const reactions: ReactionItem[] = [
      { id: 'r1', userId: 'u1', emoji: '❤️', ts: 4000 },
      { id: 'r2', userId: 'u2', emoji: '😂', ts: 4500 },
    ]
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

  it('mantém posicao x estavel para reaction existente ao chegar nova reaction', () => {
    const r1: ReactionItem = { id: 'r1', userId: 'u1', emoji: '🔥', ts: 4000 }

    const { rerender, container } = render(
      <ReactionsLayer reactions={[r1]} onReact={vi.fn()} />
    )

    // Captura estilo do primeiro span flutuante (emoji r1)
    const getR1Left = () => {
      const spans = container.querySelectorAll('span.absolute')
      for (const span of spans) {
        if (span.textContent === '🔥') {
          return (span as HTMLElement).style.left
        }
      }
      return null
    }

    const leftBefore = getR1Left()
    expect(leftBefore).not.toBeNull()

    // Nova reaction chega - r1 deve manter mesma posicao x
    const r2: ReactionItem = { id: 'r2', userId: 'u2', emoji: '💯', ts: 4500 }
    act(() => {
      rerender(<ReactionsLayer reactions={[r1, r2]} onReact={vi.fn()} />)
    })

    const leftAfter = getR1Left()
    expect(leftAfter).toBe(leftBefore)
  })
})
