// tests/overlay/reactions.test.ts
// Testes unitarios de ReactionsLayer: aparecimento, expiracao e limpeza.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { ReactionsLayer } from '../../src/content/overlay/reactions'

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

let container: HTMLElement

beforeEach(() => {
  container = document.createElement('div')
  document.body.appendChild(container)
  vi.useFakeTimers()
})

afterEach(() => {
  container.remove()
  vi.useRealTimers()
})

// ---------------------------------------------------------------------------
// Aparecimento de reacoes
// ---------------------------------------------------------------------------

describe('ReactionsLayer - aparecimento', () => {
  it('adicionar reacao cria elemento no container', () => {
    const layer = new ReactionsLayer(container)

    layer.adicionarReacao('r1', '❤️')

    const el = container.querySelector('#reaction-r1')
    expect(el).not.toBeNull()
    expect(el?.textContent).toBe('❤️')

    layer.destruir()
  })

  it('elemento tem classe floating-reaction', () => {
    const layer = new ReactionsLayer(container)

    layer.adicionarReacao('r1', '🔥')

    const el = container.querySelector('.floating-reaction')
    expect(el).not.toBeNull()

    layer.destruir()
  })

  it('posicao horizontal (left) e definida', () => {
    const layer = new ReactionsLayer(container)

    layer.adicionarReacao('r1', '😂')

    const el = container.querySelector<HTMLElement>('.floating-reaction')!
    const left = el.style.left
    // Deve ter valor percentual entre 10% e 80%
    const valor = parseFloat(left)
    expect(left).toContain('%')
    expect(valor).toBeGreaterThanOrEqual(10)
    expect(valor).toBeLessThanOrEqual(80)

    layer.destruir()
  })

  it('ID duplicado nao cria segundo elemento', () => {
    const layer = new ReactionsLayer(container)

    layer.adicionarReacao('r1', '👏')
    layer.adicionarReacao('r1', '👏') // duplicata

    const elementos = container.querySelectorAll('.floating-reaction')
    expect(elementos.length).toBe(1)

    layer.destruir()
  })

  it('multiplas reacoes distintas sao todas renderizadas', () => {
    const layer = new ReactionsLayer(container)

    layer.adicionarReacao('r1', '❤️')
    layer.adicionarReacao('r2', '😂')
    layer.adicionarReacao('r3', '🔥')

    expect(container.querySelectorAll('.floating-reaction').length).toBe(3)
    expect(layer.quantidadeAtiva).toBe(3)

    layer.destruir()
  })
})

// ---------------------------------------------------------------------------
// Expiracao com fake timers
// ---------------------------------------------------------------------------

describe('ReactionsLayer - expiracao', () => {
  it('reacao e removida apos 2500ms (FLOAT_DURATION_MS)', () => {
    const layer = new ReactionsLayer(container)

    layer.adicionarReacao('r1', '❤️')
    expect(layer.quantidadeAtiva).toBe(1)

    // Avanca 3000ms (alem de FLOAT_DURATION_MS=2500 + CLEANUP_INTERVAL=500)
    vi.advanceTimersByTime(3000)

    expect(layer.quantidadeAtiva).toBe(0)
    expect(container.querySelector('#reaction-r1')).toBeNull()

    layer.destruir()
  })

  it('reacao ainda visivel antes do tempo de expiracao', () => {
    const layer = new ReactionsLayer(container)

    layer.adicionarReacao('r1', '🔥')

    // Avanca apenas 1000ms (menos que 2500ms)
    vi.advanceTimersByTime(1000)

    expect(layer.quantidadeAtiva).toBe(1)
    expect(container.querySelector('#reaction-r1')).not.toBeNull()

    layer.destruir()
  })

  it('reacoes diferentes expiram independentemente', () => {
    const layer = new ReactionsLayer(container)

    layer.adicionarReacao('r1', '❤️')

    // Avanca 1500ms e adiciona segunda reacao
    vi.advanceTimersByTime(1500)
    layer.adicionarReacao('r2', '😂')

    // Avanca mais 1500ms: r1 expirou (3000ms total), r2 ainda ativa (1500ms)
    vi.advanceTimersByTime(1500)

    expect(container.querySelector('#reaction-r1')).toBeNull()
    expect(container.querySelector('#reaction-r2')).not.toBeNull()

    layer.destruir()
  })

  it('limpeza periodica remove elemento do DOM', () => {
    const layer = new ReactionsLayer(container)

    layer.adicionarReacao('r1', '💯')

    vi.advanceTimersByTime(3100)

    // Elemento fisico deve ter sido removido do container
    expect(container.children.length).toBe(0)

    layer.destruir()
  })
})

// ---------------------------------------------------------------------------
// Destruicao
// ---------------------------------------------------------------------------

describe('ReactionsLayer - destruir', () => {
  it('destruir() para o cleanup timer', () => {
    const clearIntervalSpy = vi.spyOn(globalThis, 'clearInterval')

    const layer = new ReactionsLayer(container)
    layer.destruir()

    expect(clearIntervalSpy).toHaveBeenCalled()
  })

  it('destruir() zera quantidadeAtiva', () => {
    const layer = new ReactionsLayer(container)

    layer.adicionarReacao('r1', '❤️')
    layer.adicionarReacao('r2', '😂')
    expect(layer.quantidadeAtiva).toBe(2)

    layer.destruir()

    expect(layer.quantidadeAtiva).toBe(0)
  })

  it('destruir() limpa o container DOM', () => {
    const layer = new ReactionsLayer(container)

    layer.adicionarReacao('r1', '❤️')
    layer.destruir()

    expect(container.children.length).toBe(0)
  })

  it('chamar destruir() duas vezes nao lanca erro', () => {
    const layer = new ReactionsLayer(container)
    layer.adicionarReacao('r1', '❤️')

    expect(() => {
      layer.destruir()
      layer.destruir()
    }).not.toThrow()
  })

  it('destruir() usa replaceChildren() - container fica sem filhos', () => {
    const layer = new ReactionsLayer(container)
    layer.adicionarReacao('r1', '❤️')
    layer.adicionarReacao('r2', '🔥')

    layer.destruir()

    // L2: replaceChildren() deve deixar o container completamente vazio
    expect(container.childNodes.length).toBe(0)
  })
})

// ---------------------------------------------------------------------------
// M5: userId com caracteres especiais (aspas, barras, etc.)
// ---------------------------------------------------------------------------

describe('M5: userId com caracteres especiais nao causa SyntaxError', () => {
  it('adicionar reacao com userId contendo aspas duplas nao lanca erro', () => {
    const layer = new ReactionsLayer(container)

    // userId com aspas duplas quebraria querySelector('[id="reaction-user"evil""]')
    expect(() => {
      layer.adicionarReacao('user"evil"quote', '😂')
    }).not.toThrow()

    expect(layer.quantidadeAtiva).toBe(1)

    layer.destruir()
  })

  it('adicionar reacao com userId contendo aspas simples nao lanca erro', () => {
    const layer = new ReactionsLayer(container)

    expect(() => {
      layer.adicionarReacao("user'single'quote", '👏')
    }).not.toThrow()

    expect(layer.quantidadeAtiva).toBe(1)

    layer.destruir()
  })

  it('reacao com userId especial expira corretamente sem SyntaxError', () => {
    const layer = new ReactionsLayer(container)

    layer.adicionarReacao('user"evil"-1234567890', '🔥')
    expect(layer.quantidadeAtiva).toBe(1)

    // Avanca alem do FLOAT_DURATION_MS (2500ms) + CLEANUP_INTERVAL (500ms)
    vi.advanceTimersByTime(3100)

    // Deve ter expirado sem lancar erro no limparExpiradas()
    expect(layer.quantidadeAtiva).toBe(0)
    expect(container.children.length).toBe(0)

    layer.destruir()
  })

  it('multiplas reacoes com ids especiais sao todas removidas no destruir()', () => {
    const layer = new ReactionsLayer(container)

    layer.adicionarReacao('a"b', '❤️')
    layer.adicionarReacao("c'd", '😂')
    layer.adicionarReacao('e]f[g', '🔥')

    expect(layer.quantidadeAtiva).toBe(3)

    layer.destruir()

    expect(layer.quantidadeAtiva).toBe(0)
    expect(container.children.length).toBe(0)
  })
})
