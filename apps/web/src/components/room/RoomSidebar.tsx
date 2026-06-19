// apps/web/src/components/room/RoomSidebar.tsx
import { useState } from 'react'
import type { PresencePeer } from '@openparty/protocol'
import type { ChatMessage } from '../../hooks/useRoom'

interface RoomSidebarProps {
  peers: PresencePeer[]
  messages: ChatMessage[]
  onSendMessage: (text: string) => void
}

type Tab = 'presence' | 'chat'

export function RoomSidebar({ peers, messages, onSendMessage }: RoomSidebarProps) {
  const [tab, setTab] = useState<Tab>('presence')
  const [draft, setDraft] = useState('')

  function handleChatSubmit(e: React.FormEvent) {
    e.preventDefault()
    const text = draft.trim()
    if (!text) return
    onSendMessage(text)
    setDraft('')
  }

  return (
    <aside className="hidden md:flex flex-col w-72 border-l border-border bg-card h-full">
      <div className="flex border-b border-border" role="tablist">
        <button
          role="tab"
          aria-label="Presenca"
          aria-selected={tab === 'presence'}
          onClick={() => setTab('presence')}
          className={`flex-1 py-2.5 text-sm font-medium transition-colors ${
            tab === 'presence'
              ? 'border-b-2 border-primary text-foreground'
              : 'text-muted-foreground hover:text-foreground'
          }`}
        >
          Presenca ({peers.length})
        </button>
        <button
          role="tab"
          aria-label="Chat"
          aria-selected={tab === 'chat'}
          onClick={() => setTab('chat')}
          className={`flex-1 py-2.5 text-sm font-medium transition-colors ${
            tab === 'chat'
              ? 'border-b-2 border-primary text-foreground'
              : 'text-muted-foreground hover:text-foreground'
          }`}
        >
          Chat
        </button>
      </div>

      {tab === 'presence' && (
        <ul className="flex-1 overflow-y-auto p-3 space-y-2">
          {peers.map((peer) => (
            <li key={peer.userId} className="flex items-center gap-2 text-sm">
              <span className="text-xl">{peer.avatar}</span>
              <span className="font-medium">{peer.displayName}</span>
            </li>
          ))}
        </ul>
      )}

      {tab === 'chat' && (
        <>
          <ul className="flex-1 overflow-y-auto p-3 space-y-2">
            {messages.map((msg) => (
              <li key={`${msg.userId}-${msg.ts}`} className="text-sm space-y-0.5">
                <span className="font-medium text-foreground">{msg.displayName}</span>
                <span className="text-muted-foreground ml-1">{msg.text}</span>
              </li>
            ))}
          </ul>
          <form onSubmit={handleChatSubmit} className="p-3 border-t border-border flex gap-2">
            <input
              type="text"
              placeholder="Mensagem..."
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              className="flex-1 rounded-md border border-input bg-background px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
            />
            <button
              type="submit"
              className="rounded-md bg-primary text-primary-foreground px-3 py-1.5 text-sm font-medium hover:bg-primary/90 transition-colors"
            >
              Enviar
            </button>
          </form>
        </>
      )}
    </aside>
  )
}
