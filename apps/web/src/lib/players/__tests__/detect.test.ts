import { describe, expect, it } from 'vitest'
import { detectMediaType } from '../index'

describe('detectMediaType', () => {
  it('detecta youtube.com/watch', () => {
    expect(detectMediaType('https://www.youtube.com/watch?v=dQw4w9WgXcQ')).toBe('youtube')
  })

  it('detecta youtu.be', () => {
    expect(detectMediaType('https://youtu.be/dQw4w9WgXcQ')).toBe('youtube')
  })

  it('detecta youtube.com/embed', () => {
    expect(detectMediaType('https://www.youtube.com/embed/dQw4w9WgXcQ')).toBe('youtube')
  })

  it('detecta ID puro de 11 chars', () => {
    expect(detectMediaType('dQw4w9WgXcQ')).toBe('youtube')
  })

  it('nao confunde string de 11 chars que nao e ID (com caracteres invalidos)', () => {
    // IDs do YouTube usam [A-Za-z0-9_-]; espaco invalido
    expect(detectMediaType('dQw4w9 XcQ1')).toBe('mp4')
  })

  it('detecta URL .mp4', () => {
    expect(detectMediaType('https://example.com/video.mp4')).toBe('mp4')
  })

  it('detecta URL .webm', () => {
    expect(detectMediaType('https://example.com/video.webm')).toBe('mp4')
  })

  it('detecta URL .m3u8 como mp4 (streaming direto)', () => {
    expect(detectMediaType('https://example.com/stream.m3u8')).toBe('mp4')
  })

  it('retorna mp4 para URL nao reconhecida como fallback', () => {
    expect(detectMediaType('https://example.com/video')).toBe('mp4')
  })

  it('nao confunde "notyoutube.com" com youtube (match deve ser exato)', () => {
    // BUG: hostname.includes('youtube.com') casa 'notyoutube.com' como YouTube
    // FIX: deve casar apenas youtu.be, youtube.com, www.youtube.com, m.youtube.com
    expect(detectMediaType('https://notyoutube.com/watch?v=dQw4w9WgXcQ')).toBe('mp4')
  })

  it('aceita m.youtube.com como YouTube', () => {
    expect(detectMediaType('https://m.youtube.com/watch?v=dQw4w9WgXcQ')).toBe('youtube')
  })

  it('nao confunde "fakeyoutu.be" com youtu.be (match exato do hostname)', () => {
    expect(detectMediaType('https://fakeyoutu.be/dQw4w9WgXcQ')).toBe('mp4')
  })

  // Novos hostnames espelhados do servidor (item 10)
  it('detecta music.youtube.com como YouTube', () => {
    expect(detectMediaType('https://music.youtube.com/watch?v=dQw4w9WgXcQ')).toBe('youtube')
  })

  it('detecta www.youtube-nocookie.com como YouTube', () => {
    expect(detectMediaType('https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ')).toBe('youtube')
  })
})
