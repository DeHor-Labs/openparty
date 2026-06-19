// src/content/overlay/reactions.ts
// Logica de reacoes flutuantes - emojis que sobem e somem.
// Reimplementa a logica do ReactionsLayer da Fase 1 em vanilla TS para o Shadow DOM.

import type { FloatingReactionItem } from './types'

/** Duracao de exibicao de cada emoji flutuante em ms */
const FLOAT_DURATION_MS = 2500
/** Intervalo de limpeza periodica de emojis expirados em ms */
const CLEANUP_INTERVAL_MS = 500

/**
 * Gerencia a camada de reacoes flutuantes no shadow root.
 * Cria, exibe e remove emojis animados independentemente do painel de chat.
 */
export class ReactionsLayer {
  private readonly container: HTMLElement

  // M5: guarda referencia direta ao HTMLElement no Map (em vez de buscar por querySelector).
  // Evita SyntaxError ao chamar querySelector com id derivado de userId com aspas ou
  // caracteres especiais, que quebra o seletor [id="reaction-${id}"] em loop a cada 500ms.
  private reactions: Map<string, FloatingReactionItem> = new Map()
  private reactionEls: Map<string, HTMLElement> = new Map()

  private cleanupTimer: ReturnType<typeof setInterval> | null = null

  constructor(container: HTMLElement) {
    this.container = container
    this.iniciarLimpezaPeriodica()
  }

  /**
   * Adiciona uma nova reacao flutuante ao layer.
   * @param id ID unico (ex: userId+ts)
   * @param emoji Emoji a exibir
   */
  adicionarReacao(id: string, emoji: string): void {
    if (this.reactions.has(id)) return

    const x = Math.random() * 70 + 10 // 10-80% horizontal
    const item: FloatingReactionItem = { id, emoji, x, ts: Date.now() }

    this.reactions.set(id, item)
    this.renderizarReacao(item)
  }

  /** Renderiza um emoji flutuante no DOM e guarda referencia direta */
  private renderizarReacao(item: FloatingReactionItem): void {
    const span = document.createElement('span')
    span.className = 'floating-reaction'
    // M5: id ainda e definido para acessibilidade/debug, mas a remocao usa a referencia direta
    span.id = `reaction-${item.id}`
    span.textContent = item.emoji
    span.style.left = `${item.x}%`
    span.setAttribute('aria-hidden', 'true')
    this.container.appendChild(span)

    // M5: guarda referencia direta evitando querySelector com id arbitrario
    this.reactionEls.set(item.id, span)
  }

  /**
   * Remove reacoes expiradas do DOM e do estado interno.
   * M5: usa referencia direta guardada em reactionEls (sem querySelector).
   */
  private limparExpiradas(): void {
    const agora = Date.now()

    for (const [id, item] of this.reactions) {
      if (agora - item.ts >= FLOAT_DURATION_MS) {
        this.reactions.delete(id)

        // M5: remove via referencia direta - seguro com qualquer conteudo de userId
        const el = this.reactionEls.get(id)
        el?.remove()
        this.reactionEls.delete(id)
      }
    }
  }

  /** Inicia o timer de limpeza periodica */
  private iniciarLimpezaPeriodica(): void {
    // L1: cleanupTimer e sempre nulo aqui (construtor), mas o guard evita duplo setInterval
    if (this.cleanupTimer !== null) return
    this.cleanupTimer = setInterval(() => {
      this.limparExpiradas()
    }, CLEANUP_INTERVAL_MS)
  }

  /** Para o timer e remove todos os emojis flutuantes */
  destruir(): void {
    // L1: clearInterval robusto com guard de nulidade
    if (this.cleanupTimer !== null) {
      clearInterval(this.cleanupTimer)
      this.cleanupTimer = null
    }

    this.reactions.clear()
    this.reactionEls.clear()

    // L2: replaceChildren() e mais explicito que innerHTML = '' e nao e interpretado como HTML
    this.container.replaceChildren()
  }

  /** Retorna quantas reacoes ativas existem (util para testes) */
  get quantidadeAtiva(): number {
    return this.reactions.size
  }
}
