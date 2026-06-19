// apps/web/src/hooks/useTheme.ts
import { useContext } from 'react'
import { ThemeContext } from '../lib/ThemeContext'
import type { Theme } from '../lib/theme'

export function useTheme(): { theme: Theme; toggle: () => void } {
  const ctx = useContext(ThemeContext)
  if (!ctx) throw new Error('useTheme deve ser usado dentro de ThemeProvider')
  return ctx
}
