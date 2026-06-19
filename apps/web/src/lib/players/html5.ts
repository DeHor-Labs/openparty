import type { PlayerAdapter, PlayerEventName } from './index'

/** Mapeia PlayerEventName para o nome do evento nativo do HTMLVideoElement */
const EVENT_MAP: Record<PlayerEventName, string> = {
  play: 'play',
  pause: 'pause',
  seek: 'seeked',
  ended: 'ended',
  error: 'error',
  buffering: 'waiting',
  ready: 'canplay',
}

/**
 * Cria um PlayerAdapter sobre um elemento HTMLVideoElement existente.
 * Nao cria nem remove o elemento do DOM; o componente React e responsavel
 * pelo ciclo de vida do elemento.
 */
export function createHtml5Adapter(element: HTMLVideoElement): PlayerAdapter {
  // Map<PlayerEventName, Map<handler, nativeListener>>
  // necessario para poder remover listeners com a referencia correta
  const listenerMap = new Map<string, Map<() => void, () => void>>()

  function on(event: PlayerEventName, handler: () => void): void {
    const nativeEvent = EVENT_MAP[event]
    if (!listenerMap.has(event)) {
      listenerMap.set(event, new Map())
    }
    const inner = listenerMap.get(event)!
    if (inner.has(handler)) return // ja registrado

    const listener = () => handler()
    inner.set(handler, listener)
    element.addEventListener(nativeEvent, listener)
  }

  function off(event: PlayerEventName, handler: () => void): void {
    const nativeEvent = EVENT_MAP[event]
    const inner = listenerMap.get(event)
    if (!inner) return
    const listener = inner.get(handler)
    if (!listener) return
    element.removeEventListener(nativeEvent, listener)
    inner.delete(handler)
  }

  function destroy(): void {
    for (const [event, inner] of listenerMap.entries()) {
      const nativeEvent = EVENT_MAP[event as PlayerEventName]
      for (const listener of inner.values()) {
        element.removeEventListener(nativeEvent, listener)
      }
    }
    listenerMap.clear()
  }

  return {
    play: () => element.play(),
    pause: () => {
      element.pause()
      return Promise.resolve()
    },
    seekTo: (secs: number) => {
      element.currentTime = secs
      return Promise.resolve()
    },
    getCurrentTime: () => element.currentTime,
    setPlaybackRate: (rate: number) => {
      element.playbackRate = rate
    },
    on,
    off,
    destroy,
  }
}
