import { describe, expect, it, vi, beforeEach } from 'vitest'
import { createHtml5Adapter } from '../html5'

function makeVideoElement(): HTMLVideoElement {
  const el = document.createElement('video')
  // jsdom nao implementa play/pause; precisamos fazer stub
  el.play = vi.fn().mockResolvedValue(undefined)
  el.pause = vi.fn()
  return el
}

describe('createHtml5Adapter', () => {
  let el: HTMLVideoElement

  beforeEach(() => {
    el = makeVideoElement()
  })

  it('retorna adapter com os metodos esperados', () => {
    const adapter = createHtml5Adapter(el)
    expect(typeof adapter.play).toBe('function')
    expect(typeof adapter.pause).toBe('function')
    expect(typeof adapter.seekTo).toBe('function')
    expect(typeof adapter.getCurrentTime).toBe('function')
    expect(typeof adapter.setPlaybackRate).toBe('function')
    expect(typeof adapter.on).toBe('function')
    expect(typeof adapter.off).toBe('function')
    expect(typeof adapter.destroy).toBe('function')
  })

  it('chama el.play ao invocar adapter.play()', async () => {
    const adapter = createHtml5Adapter(el)
    await adapter.play()
    expect(el.play).toHaveBeenCalledOnce()
  })

  it('chama el.pause ao invocar adapter.pause()', async () => {
    const adapter = createHtml5Adapter(el)
    await adapter.pause()
    expect(el.pause).toHaveBeenCalledOnce()
  })

  it('define el.currentTime ao invocar seekTo()', async () => {
    const adapter = createHtml5Adapter(el)
    await adapter.seekTo(42.5)
    expect(el.currentTime).toBe(42.5)
  })

  it('retorna el.currentTime via getCurrentTime()', () => {
    el.currentTime = 15
    const adapter = createHtml5Adapter(el)
    expect(adapter.getCurrentTime()).toBe(15)
  })

  it('define el.playbackRate via setPlaybackRate()', () => {
    const adapter = createHtml5Adapter(el)
    adapter.setPlaybackRate(1.5)
    expect(el.playbackRate).toBe(1.5)
  })

  it('registra e dispara handler via on/off', () => {
    const adapter = createHtml5Adapter(el)
    const handler = vi.fn()
    adapter.on('play', handler)

    // Simular evento nativo
    el.dispatchEvent(new Event('play'))
    expect(handler).toHaveBeenCalledOnce()

    adapter.off('play', handler)
    el.dispatchEvent(new Event('play'))
    // Nao deve chamar de novo apos off
    expect(handler).toHaveBeenCalledTimes(1)
  })

  it('remove todos os listeners ao invocar destroy()', () => {
    const adapter = createHtml5Adapter(el)
    const handler = vi.fn()
    adapter.on('play', handler)
    adapter.destroy()

    el.dispatchEvent(new Event('play'))
    expect(handler).not.toHaveBeenCalled()
  })
})
