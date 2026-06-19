// apps/web/src/components/room/ReactionsLayer.tsx
import { useEffect, useState } from 'react'
import type { ReactionItem } from '../../hooks/useRoom'

const QUICK_EMOJIS = ['❤️', '😂', '😮', '👏', '🔥', '💯']
// Duracao de exibicao de cada emoji flutuante em ms
const FLOAT_DURATION_MS = 2500

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

  // Converte reactions recentes em emojis flutuantes
  useEffect(() => {
    const now = Date.now()
    const recent = reactions.filter((r) => now - r.ts < FLOAT_DURATION_MS)
    setFloating(
      recent.map((r) => ({
        id: r.id,
        emoji: r.emoji,
        x: Math.random() * 80 + 10, // % horizontal
      }))
    )
  }, [reactions])

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
