// apps/web/src/components/__tests__/RoomControls.test.tsx
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import { vi, describe, it, expect, afterEach } from 'vitest'
import type { RoomState } from '@openparty/protocol'
import { RoomControls } from '../room/RoomControls'

function makeState(overrides: Partial<RoomState> = {}): RoomState {
  return {
    roomId: 'r1',
    mediaUrl: 'https://youtu.be/dQw4w9WgXcQ',
    mediaType: 'youtube',
    playing: false,
    positionSecs: 0,
    lastEventAt: Date.now(),
    playbackRate: 1,
    hostId: 'user-1',
    hostLock: false,
    ...overrides,
  }
}

describe('RoomControls', () => {
  afterEach(() => {
    cleanup()
  })

  it('chama onPlay com posicao atual quando play e clicado', () => {
    const onPlay = vi.fn()
    render(
      <RoomControls
        roomState={makeState({ positionSecs: 10 })}
        isHost
        onPlay={onPlay}
        onPause={vi.fn()}
        onSeek={vi.fn()}
      />
    )
    fireEvent.click(screen.getByRole('button', { name: /play/i }))
    expect(onPlay).toHaveBeenCalledWith(10)
  })

  it('chama onPause quando pause e clicado durante reproducao', () => {
    const onPause = vi.fn()
    render(
      <RoomControls
        roomState={makeState({ playing: true, positionSecs: 42 })}
        isHost
        onPlay={vi.fn()}
        onPause={onPause}
        onSeek={vi.fn()}
      />
    )
    fireEvent.click(screen.getByRole('button', { name: /pause/i }))
    expect(onPause).toHaveBeenCalledWith(42)
  })

  it('exibe toggle host-lock para nao-host com aria-disabled', () => {
    render(
      <RoomControls
        roomState={makeState()}
        isHost={false}
        onPlay={vi.fn()}
        onPause={vi.fn()}
        onSeek={vi.fn()}
      />
    )
    const toggle = screen.getByRole('switch', { name: /host.lock/i })
    expect(toggle).toBeDefined()
    expect(toggle.getAttribute('aria-disabled')).toBe('true')
  })

  it('exibe toggle host-lock para host sem aria-disabled', () => {
    render(
      <RoomControls
        roomState={makeState({ hostLock: false })}
        isHost
        onPlay={vi.fn()}
        onPause={vi.fn()}
        onSeek={vi.fn()}
      />
    )
    const toggle = screen.getByRole('switch', { name: /host.lock/i })
    expect(toggle).toBeDefined()
    expect(toggle.getAttribute('aria-disabled')).toBe('false')
  })

  it('chama onSetHostLock com true ao clicar no toggle quando hostLock=false e isHost', () => {
    const onSetHostLock = vi.fn()
    render(
      <RoomControls
        roomState={makeState({ hostLock: false })}
        isHost
        onPlay={vi.fn()}
        onPause={vi.fn()}
        onSeek={vi.fn()}
        onSetHostLock={onSetHostLock}
      />
    )
    fireEvent.click(screen.getByRole('switch', { name: /host.lock/i }))
    expect(onSetHostLock).toHaveBeenCalledWith(true)
  })

  it('chama onSetHostLock com false ao clicar no toggle quando hostLock=true e isHost', () => {
    const onSetHostLock = vi.fn()
    render(
      <RoomControls
        roomState={makeState({ hostLock: true })}
        isHost
        onPlay={vi.fn()}
        onPause={vi.fn()}
        onSeek={vi.fn()}
        onSetHostLock={onSetHostLock}
      />
    )
    fireEvent.click(screen.getByRole('switch', { name: /host.lock/i }))
    expect(onSetHostLock).toHaveBeenCalledWith(false)
  })

  it('nao chama onSetHostLock quando nao-host clica no toggle', () => {
    const onSetHostLock = vi.fn()
    render(
      <RoomControls
        roomState={makeState({ hostLock: false })}
        isHost={false}
        onPlay={vi.fn()}
        onPause={vi.fn()}
        onSeek={vi.fn()}
        onSetHostLock={onSetHostLock}
      />
    )
    fireEvent.click(screen.getByRole('switch', { name: /host.lock/i }))
    expect(onSetHostLock).not.toHaveBeenCalled()
  })
})
