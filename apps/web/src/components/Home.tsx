// apps/web/src/components/Home.tsx
import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { ThemeToggle } from './ThemeToggle'

const AVATAR_OPTIONS = ['🎬', '🍿', '🎮', '🎵', '🦊', '🐻', '🐼', '🦁']

// Em modo single-origin (servidor servindo o web estatico), nao definir
// VITE_SERVER_URL no build - o fetch vai para o mesmo host/porta automaticamente.
// Em desenvolvimento local (Vite dev server separado), VITE_SERVER_URL aponta
// para http://localhost:3000 so para evitar CORS durante o dev.
const SERVER_URL = import.meta.env.VITE_SERVER_URL ?? ''

export function Home() {
  const navigate = useNavigate()
  const [url, setUrl] = useState('')
  const [nickname, setNickname] = useState('')
  const [avatar, setAvatar] = useState(AVATAR_OPTIONS[0])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleSubmit(e: React.SyntheticEvent<HTMLFormElement>) {
    e.preventDefault()
    setError(null)
    setLoading(true)
    try {
      const res = await fetch(`${SERVER_URL}/rooms`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mediaUrl: url }),
      })
      const data = await res.json()
      if (!res.ok) {
        setError(data.error ?? 'Erro ao criar sala')
        return
      }
      sessionStorage.setItem('op_nickname', nickname)
      sessionStorage.setItem('op_avatar', avatar)
      navigate(`/room/${data.roomId}`)
    } catch {
      setError('Falha de rede. Tente novamente.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <main className="min-h-screen flex items-center justify-center bg-background p-4">
      <header className="fixed top-0 right-0 p-3">
        <ThemeToggle />
      </header>
      <div className="w-full max-w-md space-y-6">
        <div className="text-center space-y-2">
          <h1 className="text-4xl font-bold tracking-tight">OpenParty</h1>
          <p className="text-muted-foreground">Assista junto, sincronizado.</p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-1">
            <label htmlFor="media-url" className="text-sm font-medium">
              URL do vídeo
            </label>
            <input
              id="media-url"
              type="text"
              required
              placeholder="youtube.com/watch?v=... ou youtu.be/..."
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
            />
          </div>

          <div className="space-y-1">
            <label htmlFor="nickname" className="text-sm font-medium">
              Seu nickname
            </label>
            <input
              id="nickname"
              type="text"
              required
              minLength={1}
              maxLength={32}
              placeholder="Nickname"
              value={nickname}
              onChange={(e) => setNickname(e.target.value)}
              className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
            />
          </div>

          <div className="space-y-1">
            <span className="text-sm font-medium">Avatar</span>
            <div className="flex gap-2 flex-wrap">
              {AVATAR_OPTIONS.map((em) => (
                <button
                  key={em}
                  type="button"
                  aria-label={`Avatar ${em}`}
                  onClick={() => setAvatar(em)}
                  className={`text-2xl p-2 rounded-md border transition-colors ${
                    avatar === em
                      ? 'border-primary bg-primary/10'
                      : 'border-transparent hover:border-muted'
                  }`}
                >
                  {em}
                </button>
              ))}
            </div>
          </div>

          {error && (
            <div
              role="alert"
              className="rounded-md bg-destructive/10 border border-destructive/30 px-3 py-2 text-sm text-destructive"
            >
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={loading}
            className="w-full rounded-md bg-primary text-primary-foreground px-4 py-2 text-sm font-medium hover:bg-primary/90 disabled:opacity-50 transition-colors"
          >
            {loading ? 'Criando sala...' : 'Entrar na sala'}
          </button>
        </form>

        <section id="faq" aria-labelledby="faq-title" className="space-y-3 border-t border-border pt-6">
          <h2 id="faq-title" className="text-xl font-semibold">Perguntas frequentes</h2>
          {[
            [
              'Quais vídeos funcionam?',
              'A sala reconhece links do YouTube e arquivos MP4 acessíveis pelo navegador. Serviços protegidos por DRM dependem da extensão e do adaptador correspondente.',
            ],
            [
              'Preciso criar uma conta?',
              'Não. Você informa um nickname e escolhe um avatar para entrar na sala.',
            ],
            [
              'A sala fica salva?',
              'Não nesta versão. A sala vive na memória do servidor e é removida quando a última pessoa sai.',
            ],
            [
              'O chat é armazenado?',
              'Não. As mensagens e reações são transmitidas às pessoas conectadas e não são gravadas em banco de dados pelo OpenParty.',
            ],
            [
              'Quem controla o vídeo?',
              'A primeira pessoa da sala assume o controle. Se ela sair, o servidor transfere a função para a pessoa conectada há mais tempo.',
            ],
          ].map(([question, answer]) => (
            <details key={question} className="rounded-md border border-input px-3 py-2 text-sm">
              <summary className="cursor-pointer font-medium">{question}</summary>
              <p className="mt-2 text-muted-foreground">{answer}</p>
            </details>
          ))}
        </section>

        <section id="privacidade" aria-labelledby="privacy-title" className="space-y-2 border-t border-border pt-6 text-sm">
          <h2 id="privacy-title" className="text-xl font-semibold">Privacidade nesta versão</h2>
          <p className="text-muted-foreground">
            Nickname e avatar ficam no sessionStorage do navegador e são enviados ao servidor durante
            a conexão. A URL do vídeo também é enviada para criar a sala. Estado, chat e reações ficam
            apenas na memória durante a sessão e não são usados para publicidade ou perfilamento pelo
            OpenParty.
          </p>
          <div className="flex flex-wrap gap-4 text-xs">
            <a href="/privacidade.html" className="underline underline-offset-4">Aviso completo de privacidade</a>
            <a href="/index.md" className="underline underline-offset-4">Versão em Markdown</a>
            <a href="/llms.txt" className="underline underline-offset-4">Guia para assistentes</a>
          </div>
        </section>
      </div>
    </main>
  )
}
