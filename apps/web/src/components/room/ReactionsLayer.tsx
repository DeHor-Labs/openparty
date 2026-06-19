// apps/web/src/components/room/ReactionsLayer.tsx
import { useCallback, useEffect, useRef, useState } from 'react'
import type { ReactionItem } from '../../hooks/useRoom'

const QUICK_EMOJIS = ['❤️', '😂', '😮', '👏', '🔥', '💯']
// Duracao de exibicao de cada emoji flutuante em ms
const FLOAT_DURATION_MS = 2500
// Intervalo de limpeza periodica de emojis expirados
const CLEANUP_INTERVAL_MS = 500

interface FloatingEmoji {
  id: string
  emoji: string
  x: number
}

interface ReactionsLayerProps {
  reactions: ReactionItem[]
  onReact: (emoji: string) => void
}

export function ReactionsLayer({ reactions, onReact }: ReactionsLayerProps) {
  const [floating, setFloating] = useState<FloatingEmoji[]>([])
  // Mapa de posicao horizontal por reaction.id para evitar que o emoji
  // "pule" quando uma nova reaction chega e o array e recalculado.
  const xPositionsRef = useRef<Map<string, number>>(new Map())

  /**
   * Recalcula quais reactions ainda estao dentro do FLOAT_DURATION_MS.
   * Envolto em useCallback com deps corretas para evitar closures desatualizadas
   * e satisfazer exhaustive-deps nos effects que o consomem.
   */
  const applyReactions = useCallback((currentReactions: ReactionItem[]) => {
    const now = Date.now()
    const recent = currentReactions.filter((r) => now - r.ts < FLOAT_DURATION_MS)

    // Garante posicao x estavel: reutiliza valor ja gerado para ids conhecidos
    const nextMap = new Map<string, number>()
    recent.forEach((r) => {
      const existing = xPositionsRef.current.get(r.id)
      nextMap.set(r.id, existing ?? Math.random() * 80 + 10)
    })
    // Descarta ids que saíram (nao estao mais em recent)
    xPositionsRef.current = nextMap

    setFloating(
      recent.map((r) => ({
        id: r.id,
        emoji: r.emoji,
        x: xPositionsRef.current.get(r.id)!,
      }))
    )
  }, [])

  // Aplica reactions imediatamente ao mudar o array E executa limpeza periodica
  // de emojis expirados via setInterval, tudo em um unico effect para evitar
  // janela de closure desatualizada entre dois effects separados.
  useEffect(() => {
    applyReactions(reactions)

    const timer = setInterval(() => {
      applyReactions(reactions)
    }, CLEANUP_INTERVAL_MS)

    return () => clearInterval(timer)
  }, [reactions, applyReactions])

  return (
    <div className="absolute inset-0 pointer-events-none overflow-hidden">
      {/* Emojis flutuantes - animacao via transform/opacity */}
      {floating.map((item) => (
        <span
          key={item.id}
          className="absolute bottom-16 text-3xl select-none motion-safe:animate-float-up"
          style={{ left: `${item.x}%` }}
        >
          {item.emoji}
        </span>
      ))}

      {/* Seletor de reacoes - pointer-events re-habilitado */}
      <div className="absolute bottom-4 left-1/2 -translate-x-1/2 pointer-events-auto flex gap-1.5 bg-background/80 backdrop-blur-sm rounded-full px-3 py-1.5 border border-border shadow-md">
        {QUICK_EMOJIS.map((em) => (
          <button
            key={em}
            aria-label={em}
            onClick={() => onReact(em)}
            className="text-xl hover:scale-125 transition-transform active:scale-95"
          >
            {em}
          </button>
        ))}
      </div>
    </div>
  )
}
