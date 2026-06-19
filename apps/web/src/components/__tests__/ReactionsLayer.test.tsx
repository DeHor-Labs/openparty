// apps/web/src/components/__tests__/ReactionsLayer.test.tsx
import { render, screen, fireEvent, cleanup, act } from '@testing-library/react'
import { vi, describe, it, expect, afterEach, beforeEach } from 'vitest'
import type { ReactionItem } from '../../hooks/useRoom'
import { ReactionsLayer } from '../room/ReactionsLayer'

// FLOAT_DURATION_MS do componente (2500ms); reactions com age > esse valor expiram
const FLOAT_DURATION_MS = 2500

describe('ReactionsLayer', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    // Ponto de referencia: qualquer instante controlado, sem valor absoluto fixo
    vi.setSystemTime(0)
  })

  afterEach(() => {
    vi.useRealTimers()
    cleanup()
  })

  it('exibe emojis ativos', () => {
    // Timestamps relativos: reactions enviadas 1000ms atras (dentro do FLOAT_DURATION_MS)
    const now = Date.now()
    const reactions: ReactionItem[] = [
      { id: 'r1', userId: 'u1', emoji: '❤️', ts: now - 1000 },
      { id: 'r2', userId: 'u2', emoji: '😂', ts: now - 500 },
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
    const now = Date.now()
    // Reaction 1000ms atras: dentro do FLOAT_DURATION_MS
    const r1: ReactionItem = { id: 'r1', userId: 'u1', emoji: '🔥', ts: now - 1000 }

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

    // Nova reaction chega 500ms depois - r1 deve manter mesma posicao x
    const r2: ReactionItem = { id: 'r2', userId: 'u2', emoji: '💯', ts: now - 500 }
    act(() => {
      rerender(<ReactionsLayer reactions={[r1, r2]} onReact={vi.fn()} />)
    })

    const leftAfter = getR1Left()
    expect(leftAfter).toBe(leftBefore)
  })

  it('remove emojis expirados periodicamente mesmo sem novas reactions chegando', () => {
    // Reaction enviada 1000ms atras: visivel agora (now=0, ts=-1000, age=1000 < 2500)
    const now = Date.now()
    const reactions: ReactionItem[] = [
      { id: 'r1', userId: 'u1', emoji: '❤️', ts: now - 1000 },
    ]

    const { container } = render(<ReactionsLayer reactions={reactions} onReact={vi.fn()} />)

    const getEmojiCount = () =>
      container.querySelectorAll('span.absolute').length

    expect(getEmojiCount()).toBeGreaterThan(0)

    // Avanca tempo para alem da expiracao: age = 1000 + avanço > FLOAT_DURATION_MS
    act(() => {
      vi.advanceTimersByTime(FLOAT_DURATION_MS)
    })

    // Com o interval de limpeza, o emoji deve ter sido removido
    expect(getEmojiCount()).toBe(0)
  })

  it('nao exibe emojis expirados apos reactions mudar para array diferente', () => {
    // Garante que o state nao fica obsoleto apos troca de reactions prop
    const now = Date.now()
    const r1: ReactionItem = { id: 'r1', userId: 'u1', emoji: '🔥', ts: now - 1000 }
    const { rerender, container } = render(
      <ReactionsLayer reactions={[r1]} onReact={vi.fn()} />
    )

    // Avanca o tempo para expirar r1
    act(() => {
      vi.advanceTimersByTime(FLOAT_DURATION_MS + 100)
    })

    // Passa array vazio (r1 removida pelo produtor)
    act(() => {
      rerender(<ReactionsLayer reactions={[]} onReact={vi.fn()} />)
    })

    // Nenhum emoji deve aparecer - closure nao deve usar reactions antigo
    expect(container.querySelectorAll('span.absolute').length).toBe(0)
  })

  it('cleanup do interval ocorre corretamente apos unmount (sem timers vazando)', () => {
    const now = Date.now()
    const reactions: ReactionItem[] = [
      { id: 'r1', userId: 'u1', emoji: '❤️', ts: now - 500 },
    ]
    const { unmount } = render(<ReactionsLayer reactions={reactions} onReact={vi.fn()} />)

    // Desmonta - nao deve lancar excecao nem ter timers ativos
    expect(() => unmount()).not.toThrow()

    // Avanca tempo: nao deve haver setFloating em componente desmontado
    act(() => {
      vi.advanceTimersByTime(2000)
    })
  })
})
