// apps/web/src/lib/__tests__/theme.test.ts
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { getInitialTheme, applyTheme } from '../theme'

describe('getInitialTheme', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  it('retorna dark quando prefers-color-scheme e dark e sem storage', () => {
    vi.stubGlobal('matchMedia', (query: string) => ({
      matches: query === '(prefers-color-scheme: dark)',
      media: query,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    }))

    expect(getInitialTheme()).toBe('dark')
  })

  it('retorna light quando prefers-color-scheme e light e sem storage', () => {
    vi.stubGlobal('matchMedia', (_query: string) => ({
      matches: false,
      media: _query,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    }))

    expect(getInitialTheme()).toBe('light')
  })

  it('respeita valor salvo no localStorage sobre prefers-color-scheme', () => {
    localStorage.setItem('openparty-theme', 'light')

    vi.stubGlobal('matchMedia', (query: string) => ({
      matches: query === '(prefers-color-scheme: dark)',
      media: query,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    }))

    expect(getInitialTheme()).toBe('light')
  })
})

describe('applyTheme', () => {
  it('adiciona classe dark em documentElement para tema dark', () => {
    applyTheme('dark')
    expect(document.documentElement.classList.contains('dark')).toBe(true)
    expect(localStorage.getItem('openparty-theme')).toBe('dark')
  })

  it('remove classe dark em documentElement para tema light', () => {
    document.documentElement.classList.add('dark')
    applyTheme('light')
    expect(document.documentElement.classList.contains('dark')).toBe(false)
    expect(localStorage.getItem('openparty-theme')).toBe('light')
  })
})
