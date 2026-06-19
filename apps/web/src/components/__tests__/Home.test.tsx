// apps/web/src/components/__tests__/Home.test.tsx
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest'
import { Home } from '../Home'

const mockNavigate = vi.fn()
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual('react-router-dom')
  return { ...actual, useNavigate: () => mockNavigate }
})

global.fetch = vi.fn()

describe('Home', () => {
  afterEach(() => {
    cleanup()
  })

  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('renderiza os inputs de URL, nickname e avatar', () => {
    render(<MemoryRouter><Home /></MemoryRouter>)
    expect(screen.getByPlaceholderText(/youtube\.com|youtu\.be/i)).toBeDefined()
    expect(screen.getByPlaceholderText(/nickname/i)).toBeDefined()
    expect(screen.getByRole('button', { name: /entrar|criar sala/i })).toBeDefined()
  })

  it('POST /rooms com mediaUrl e redireciona para /room/:roomId', async () => {
    ;(global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: true,
      json: async () => ({ roomId: 'abc123', url: '/room/abc123' }),
    })
    render(<MemoryRouter><Home /></MemoryRouter>)
    fireEvent.change(screen.getByPlaceholderText(/youtube\.com|youtu\.be/i), {
      target: { value: 'https://youtu.be/dQw4w9WgXcQ' },
    })
    fireEvent.change(screen.getByPlaceholderText(/nickname/i), {
      target: { value: 'Nikolas' },
    })
    fireEvent.click(screen.getByRole('button', { name: /entrar|criar sala/i }))
    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith(
        expect.stringContaining('/rooms'),
        expect.objectContaining({
          method: 'POST',
          body: expect.stringContaining('dQw4w9WgXcQ'),
        })
      )
      expect(mockNavigate).toHaveBeenCalledWith('/room/abc123')
    })
  })

  it('exibe erro se fetch falhar', async () => {
    ;(global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: false,
      json: async () => ({ error: 'URL invalida' }),
    })
    render(<MemoryRouter><Home /></MemoryRouter>)
    fireEvent.change(screen.getByPlaceholderText(/youtube\.com|youtu\.be/i), {
      target: { value: 'nao-e-url' },
    })
    fireEvent.change(screen.getByPlaceholderText(/nickname/i), {
      target: { value: 'Nikolas' },
    })
    fireEvent.click(screen.getByRole('button', { name: /entrar|criar sala/i }))
    await waitFor(() => {
      expect(screen.getByRole('alert')).toBeDefined()
    })
  })
})
