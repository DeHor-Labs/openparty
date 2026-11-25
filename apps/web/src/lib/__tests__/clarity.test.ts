// apps/web/src/lib/__tests__/clarity.test.ts
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { CLARITY_PROJECT_ID, initClarity, isClarityActive, shouldLoadClarity } from '../clarity'

function setLocation(hostname: string, pathname: string) {
  vi.stubGlobal('location', { ...window.location, hostname, pathname })
}

function clarityScripts() {
  return document.head.querySelectorAll(
    `script[src="https://www.clarity.ms/tag/${CLARITY_PROJECT_ID}"]`
  )
}

describe('shouldLoadClarity', () => {
  it('carrega no dominio de producao e no www', () => {
    expect(shouldLoadClarity('openparty.dehor.com.br', '/')).toBe(true)
    expect(shouldLoadClarity('www.openparty.dehor.com.br', '/privacidade.html')).toBe(true)
  })

  it('nao carrega em localhost, preview ou dominio parecido', () => {
    expect(shouldLoadClarity('localhost', '/')).toBe(false)
    expect(shouldLoadClarity('preview-123.pages.dev', '/')).toBe(false)
    expect(shouldLoadClarity('evil-openparty.dehor.com.br', '/')).toBe(false)
  })

  it('nao carrega nas rotas de sala', () => {
    expect(shouldLoadClarity('openparty.dehor.com.br', '/room/abc123')).toBe(false)
    expect(shouldLoadClarity('openparty.dehor.com.br', '/room')).toBe(false)
  })
})

describe('initClarity', () => {
  beforeEach(() => {
    document.head.innerHTML = ''
    delete (window as unknown as { clarity?: unknown }).clarity
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('nao injeta o script fora de producao', () => {
    setLocation('localhost', '/')
    initClarity()
    expect(clarityScripts()).toHaveLength(0)
    expect((window as unknown as { clarity?: unknown }).clarity).toBeUndefined()
  })

  it('injeta o script async em producao', () => {
    setLocation('openparty.dehor.com.br', '/')
    initClarity()
    const scripts = clarityScripts()
    expect(scripts).toHaveLength(1)
    expect((scripts[0] as HTMLScriptElement).async).toBe(true)
  })

  it('enfileira consentimento negado antes de carregar o script', () => {
    setLocation('openparty.dehor.com.br', '/')
    initClarity()
    const queue = (window as unknown as { clarity: { q: unknown[][] } }).clarity.q
    expect(queue[0]).toEqual(['consentv2', { ad_Storage: 'denied', analytics_Storage: 'denied' }])
    expect(document.cookie).not.toMatch(/_clck|_clsk/)
  })

  it('e idempotente', () => {
    setLocation('openparty.dehor.com.br', '/')
    initClarity()
    initClarity()
    expect(clarityScripts()).toHaveLength(1)
  })
})

describe('isClarityActive', () => {
  it('reflete se o snippet foi inicializado', () => {
    delete (window as unknown as { clarity?: unknown }).clarity
    expect(isClarityActive()).toBe(false)
    ;(window as unknown as { clarity: () => void }).clarity = () => {}
    expect(isClarityActive()).toBe(true)
    delete (window as unknown as { clarity?: unknown }).clarity
  })
})
