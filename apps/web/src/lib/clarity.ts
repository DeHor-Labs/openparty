// apps/web/src/lib/clarity.ts
// Microsoft Clarity (gravacao de sessao e mapa de calor), so na landing publica
// em producao e sem cookies. Nao e segredo: o ID identifica o projeto no Clarity.

export const CLARITY_PROJECT_ID = 'zixh9yg5c8'

const PRODUCTION_HOSTS = ['openparty.dehor.com.br', 'www.openparty.dehor.com.br']

// Salas (/room/:id) mostram nickname, chat e a URL carrega o convite da sala:
// o Clarity nunca e carregado nelas. Como nao ha API para parar a gravacao,
// quem sai da landing para uma sala deve usar carga completa de pagina
// (ver isClarityActive em Home.tsx).
const PRIVATE_PATH_PREFIXES = ['/room']

type ClarityFn = ((...args: unknown[]) => void) & { q?: unknown[] }

export function shouldLoadClarity(hostname: string, pathname: string): boolean {
  if (!PRODUCTION_HOSTS.includes(hostname)) return false
  return !PRIVATE_PATH_PREFIXES.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`)
  )
}

export function isClarityActive(): boolean {
  return typeof window !== 'undefined' && 'clarity' in window
}

export function initClarity(): void {
  if (typeof window === 'undefined') return
  if (!shouldLoadClarity(window.location.hostname, window.location.pathname)) return

  const w = window as unknown as { clarity?: ClarityFn }
  if (w.clarity) return

  // Snippet oficial: fila de comandos ate o script async carregar.
  w.clarity = function (...args: unknown[]) {
    ;(w.clarity!.q = w.clarity!.q ?? []).push(args)
  } as ClarityFn

  // Consentimento negado por padrao (Consent API v2): sem cookies _clck/_clsk.
  w.clarity('consentv2', { ad_Storage: 'denied', analytics_Storage: 'denied' })

  const script = document.createElement('script')
  script.async = true
  script.src = `https://www.clarity.ms/tag/${CLARITY_PROJECT_ID}`
  document.head.appendChild(script)
}
