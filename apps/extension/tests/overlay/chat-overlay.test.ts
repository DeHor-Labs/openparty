// tests/overlay/chat-overlay.test.ts
// Testes unitarios do chat overlay via Shadow DOM.
// Usa jsdom (configurado no vite.config.ts da extension).

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { criarChatOverlay } from '../../src/content/overlay/chat-overlay'
import * as overlayModule from '../../src/content/overlay/chat-overlay'
import type { ChatOverlayCallbacks, SyncStatus } from '../../src/content/overlay/types'
import type { PresencePeer } from '@openparty/protocol'

// ---------------------------------------------------------------------------
// Interceptacao de attachShadow para testes com mode:'closed'
//
// HIGH-1: o codigo de producao usa attachShadow({ mode: 'closed' }), o que faz
// host.shadowRoot retornar null. Para que os testes possam inspecionar o DOM
// interno do overlay, interceptamos attachShadow e guardamos a referencia.
// ---------------------------------------------------------------------------

let _ultimoShadowRoot: ShadowRoot | null = null

const _attachShadowOriginal = Element.prototype.attachShadow

beforeEach(() => {
  _ultimoShadowRoot = null
  Element.prototype.attachShadow = function (init: ShadowRootInit): ShadowRoot {
    // Chama o metodo original com o 'this' correto (a instancia do elemento)
    const sr = _attachShadowOriginal.call(this, init)
    _ultimoShadowRoot = sr
    return sr
  }
})

afterEach(() => {
  Element.prototype.attachShadow = _attachShadowOriginal
})

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Cria callbacks mockados para o overlay */
function criarCallbacks(): ChatOverlayCallbacks & {
  onEnviarMensagem: ReturnType<typeof vi.fn>
  onEnviarReacao: ReturnType<typeof vi.fn>
} {
  return {
    onEnviarMensagem: vi.fn(),
    onEnviarReacao: vi.fn(),
  }
}

/** Retorna o shadow root capturado pela interceptacao de attachShadow */
function obterShadowRoot(): ShadowRoot {
  if (!_ultimoShadowRoot) throw new Error('Shadow root nao capturado - criarChatOverlay nao foi chamado')
  return _ultimoShadowRoot
}

/**
 * Dispara um clique que sera tratado como confiavel pelos handlers de producao.
 *
 * Em jsdom, eventos JS sempre tem isTrusted=false e a propriedade e nao-configuravel.
 * O modulo chat-overlay exporta _verificarConfianca para permitir que testes
 * substituam a logica de verificacao. Os testes funcionais setam _verificarConfianca
 * para aceitar todos os eventos (simulando cliques reais do usuario).
 * Os testes de HIGH-1 restauram o comportamento padrao para verificar que eventos
 * sinteticos sao corretamente bloqueados.
 */
function clicarConfiavel(el: HTMLElement): void {
  el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
}

function submeterConfiavel(form: HTMLFormElement): void {
  form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
}

// ---------------------------------------------------------------------------
// Setup / Teardown
// ---------------------------------------------------------------------------

beforeEach(() => {
  // Garante body limpo entre testes
  document.body.innerHTML = ''

  // Por padrao nos testes funcionais, todos os eventos sao tratados como confiaveis.
  // Isso contorna a limitacao do jsdom onde isTrusted e sempre false para eventos JS.
  // Os testes de HIGH-1 substituem _verificarConfianca para testar o comportamento real.
  overlayModule._confiancaConfig.verificar = () => true
})

afterEach(() => {
  // Restaura a verificacao padrao de isTrusted apos cada teste
  overlayModule._confiancaConfig.verificar = (e) => e.isTrusted

  // Remove qualquer shadow host que tenha ficado
  document.querySelector('#openparty-shadow-host')?.remove()
})

// ---------------------------------------------------------------------------
// Montagem
// ---------------------------------------------------------------------------

describe('criarChatOverlay - montagem', () => {
  it('injeta o shadow host no body', () => {
    const cb = criarCallbacks()
    const handle = criarChatOverlay(cb)

    const host = document.querySelector('#openparty-shadow-host')
    expect(host).not.toBeNull()

    handle.destruir()
  })

  it('cria shadow root em modo closed (host.shadowRoot retorna null)', () => {
    const cb = criarCallbacks()
    const handle = criarChatOverlay(cb)

    // HIGH-1: modo 'closed' impede acesso externo via host.shadowRoot
    const host = document.querySelector('#openparty-shadow-host')
    expect(host?.shadowRoot).toBeNull()

    handle.destruir()
  })

  it('o shadow root contem o container raiz #openparty-root', () => {
    const cb = criarCallbacks()
    const handle = criarChatOverlay(cb)

    const shadow = obterShadowRoot()
    expect(shadow.querySelector('#openparty-root')).not.toBeNull()

    handle.destruir()
  })

  it('o painel de chat comeca oculto', () => {
    const cb = criarCallbacks()
    const handle = criarChatOverlay(cb)

    const shadow = obterShadowRoot()
    const panel = shadow.querySelector('#chat-panel')
    expect(panel?.classList.contains('hidden')).toBe(true)

    handle.destruir()
  })

  it('destruir() remove o shadow host do DOM', () => {
    const cb = criarCallbacks()
    const handle = criarChatOverlay(cb)

    handle.destruir()

    expect(document.querySelector('#openparty-shadow-host')).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// Toggle do painel
// ---------------------------------------------------------------------------

describe('toggle do painel de chat', () => {
  it('clicar no toggle-btn abre o painel', () => {
    const cb = criarCallbacks()
    const handle = criarChatOverlay(cb)
    const shadow = obterShadowRoot()

    const btn = shadow.querySelector<HTMLButtonElement>('#toggle-btn')!
    clicarConfiavel(btn)

    expect(shadow.querySelector('#chat-panel')?.classList.contains('hidden')).toBe(false)

    handle.destruir()
  })

  it('clicar no toggle-btn duas vezes fecha o painel', () => {
    const cb = criarCallbacks()
    const handle = criarChatOverlay(cb)
    const shadow = obterShadowRoot()

    const btn = shadow.querySelector<HTMLButtonElement>('#toggle-btn')!
    clicarConfiavel(btn) // abre
    clicarConfiavel(btn) // fecha

    expect(shadow.querySelector('#chat-panel')?.classList.contains('hidden')).toBe(true)

    handle.destruir()
  })

  it('aria-expanded e atualizado corretamente no toggle', () => {
    const cb = criarCallbacks()
    const handle = criarChatOverlay(cb)
    const shadow = obterShadowRoot()

    const btn = shadow.querySelector<HTMLButtonElement>('#toggle-btn')!
    expect(btn.getAttribute('aria-expanded')).toBe('false')

    clicarConfiavel(btn)
    expect(btn.getAttribute('aria-expanded')).toBe('true')

    clicarConfiavel(btn)
    expect(btn.getAttribute('aria-expanded')).toBe('false')

    handle.destruir()
  })
})

// ---------------------------------------------------------------------------
// Envio de mensagem
// ---------------------------------------------------------------------------

describe('envio de mensagem de chat', () => {
  it('submeter o formulario com texto chama onEnviarMensagem', () => {
    const cb = criarCallbacks()
    const handle = criarChatOverlay(cb)
    const shadow = obterShadowRoot()

    const input = shadow.querySelector<HTMLInputElement>('#chat-input')!
    const form = shadow.querySelector<HTMLFormElement>('#chat-form')!

    input.value = 'Ola pessoal!'
    submeterConfiavel(form)

    expect(cb.onEnviarMensagem).toHaveBeenCalledOnce()
    expect(cb.onEnviarMensagem).toHaveBeenCalledWith('Ola pessoal!')

    handle.destruir()
  })

  it('apos envio o input e limpo', () => {
    const cb = criarCallbacks()
    const handle = criarChatOverlay(cb)
    const shadow = obterShadowRoot()

    const input = shadow.querySelector<HTMLInputElement>('#chat-input')!
    const form = shadow.querySelector<HTMLFormElement>('#chat-form')!

    input.value = 'Teste'
    submeterConfiavel(form)

    expect(input.value).toBe('')

    handle.destruir()
  })

  it('texto vazio (so espacos) nao chama onEnviarMensagem', () => {
    const cb = criarCallbacks()
    const handle = criarChatOverlay(cb)
    const shadow = obterShadowRoot()

    const input = shadow.querySelector<HTMLInputElement>('#chat-input')!
    const form = shadow.querySelector<HTMLFormElement>('#chat-form')!

    input.value = '   '
    submeterConfiavel(form)

    expect(cb.onEnviarMensagem).not.toHaveBeenCalled()

    handle.destruir()
  })
})

// ---------------------------------------------------------------------------
// Recebimento e render de mensagens
// ---------------------------------------------------------------------------

describe('adicionarMensagem', () => {
  it('exibe mensagem recebida no DOM', () => {
    const cb = criarCallbacks()
    const handle = criarChatOverlay(cb)
    const shadow = obterShadowRoot()

    handle.adicionarMensagem({
      userId: 'u1',
      displayName: 'Ana',
      text: 'Boa noite!',
      ts: Date.now(),
    })

    const lista = shadow.querySelector('#messages-list')!
    expect(lista.textContent).toContain('Ana')
    expect(lista.textContent).toContain('Boa noite!')

    handle.destruir()
  })

  it('remove o hint vazio ao receber a primeira mensagem', () => {
    const cb = criarCallbacks()
    const handle = criarChatOverlay(cb)
    const shadow = obterShadowRoot()

    const hint = shadow.querySelector('.empty-hint')
    expect(hint).not.toBeNull() // existe antes

    handle.adicionarMensagem({ userId: 'u1', displayName: 'Bob', text: 'Oi', ts: Date.now() })

    expect(shadow.querySelector('.empty-hint')).toBeNull() // removido apos mensagem

    handle.destruir()
  })

  it('multiplas mensagens sao exibidas em ordem', () => {
    const cb = criarCallbacks()
    const handle = criarChatOverlay(cb)
    const shadow = obterShadowRoot()

    handle.adicionarMensagem({ userId: 'u1', displayName: 'Ana', text: 'Primeira', ts: 1000 })
    handle.adicionarMensagem({ userId: 'u2', displayName: 'Bob', text: 'Segunda', ts: 2000 })

    const msgs = shadow.querySelectorAll('.chat-msg')
    expect(msgs.length).toBe(2)
    expect(msgs[0].textContent).toContain('Primeira')
    expect(msgs[1].textContent).toContain('Segunda')

    handle.destruir()
  })

  it('usa textContent (nao innerHTML) - texto com < > e renderizado com seguranca', () => {
    const cb = criarCallbacks()
    const handle = criarChatOverlay(cb)
    const shadow = obterShadowRoot()

    handle.adicionarMensagem({
      userId: 'u1',
      displayName: '<script>',
      text: '<img src=x onerror=alert(1)>',
      ts: Date.now(),
    })

    // Nao deve existir elemento <script> nem <img> injetado
    expect(shadow.querySelector('script')).toBeNull()
    expect(shadow.querySelector('img')).toBeNull()

    // O texto bruto deve aparecer como texto, nao como HTML
    const lista = shadow.querySelector('#messages-list')!
    expect(lista.textContent).toContain('<script>')
    expect(lista.textContent).toContain('<img src=x onerror=alert(1)>')

    handle.destruir()
  })
})

// ---------------------------------------------------------------------------
// Participantes
// ---------------------------------------------------------------------------

describe('atualizarParticipantes', () => {
  it('atualiza o contador de participantes no cabecalho', () => {
    const cb = criarCallbacks()
    const handle = criarChatOverlay(cb)
    const shadow = obterShadowRoot()

    const peers: PresencePeer[] = [
      { userId: 'u1', displayName: 'Ana', avatar: '🐱' },
      { userId: 'u2', displayName: 'Bob', avatar: '🐶' },
    ]

    handle.atualizarParticipantes(peers)

    const counter = shadow.querySelector('#participants-count')!
    expect(counter.textContent).toContain('2')

    handle.destruir()
  })

  it('contador volta a 0 com lista vazia', () => {
    const cb = criarCallbacks()
    const handle = criarChatOverlay(cb)
    const shadow = obterShadowRoot()

    handle.atualizarParticipantes([{ userId: 'u1', displayName: 'Ana', avatar: '🐱' }])
    handle.atualizarParticipantes([])

    const counter = shadow.querySelector('#participants-count')!
    expect(counter.textContent).toContain('0')

    handle.destruir()
  })
})

// ---------------------------------------------------------------------------
// SyncBadge
// ---------------------------------------------------------------------------

describe('atualizarSyncStatus', () => {
  const statusCases: SyncStatus[] = ['conectando', 'calibrando', 'em-sync', 'corrigindo', 'desconectado']

  for (const status of statusCases) {
    it(`aplica classe status-${status} no badge`, () => {
      const cb = criarCallbacks()
      const handle = criarChatOverlay(cb)
      const shadow = obterShadowRoot()

      handle.atualizarSyncStatus(status)

      const badge = shadow.querySelector('#sync-badge')!
      expect(badge.classList.contains(`status-${status}`)).toBe(true)

      handle.destruir()
    })
  }

  it('troca de status remove a classe anterior', () => {
    const cb = criarCallbacks()
    const handle = criarChatOverlay(cb)
    const shadow = obterShadowRoot()

    handle.atualizarSyncStatus('calibrando')
    handle.atualizarSyncStatus('em-sync')

    const badge = shadow.querySelector('#sync-badge')!
    expect(badge.classList.contains('status-calibrando')).toBe(false)
    expect(badge.classList.contains('status-em-sync')).toBe(true)

    handle.destruir()
  })

  it('texto do badge reflete o status em pt-BR', () => {
    const cb = criarCallbacks()
    const handle = criarChatOverlay(cb)
    const shadow = obterShadowRoot()

    handle.atualizarSyncStatus('em-sync')
    const badge = shadow.querySelector('#sync-badge')!
    expect(badge.textContent).toContain('Em sync')

    handle.destruir()
  })
})

// ---------------------------------------------------------------------------
// Reacoes rapidas (botoes)
// ---------------------------------------------------------------------------

describe('botoes de reacao rapida', () => {
  it('clicar em um emoji chama onEnviarReacao com o emoji correto', () => {
    const cb = criarCallbacks()
    const handle = criarChatOverlay(cb)
    const shadow = obterShadowRoot()

    // Abre painel para mostrar reacoes (clique confiavel)
    clicarConfiavel(shadow.querySelector<HTMLButtonElement>('#toggle-btn')!)

    const botoesReacao = shadow.querySelectorAll<HTMLButtonElement>('.reaction-btn')
    expect(botoesReacao.length).toBeGreaterThan(0)

    clicarConfiavel(botoesReacao[0])

    expect(cb.onEnviarReacao).toHaveBeenCalledOnce()
    // O primeiro emoji deve ser ❤️
    expect(cb.onEnviarReacao).toHaveBeenCalledWith('❤️')

    handle.destruir()
  })
})

// ---------------------------------------------------------------------------
// Acessibilidade basica
// ---------------------------------------------------------------------------

describe('acessibilidade', () => {
  it('input de chat tem label associado', () => {
    const cb = criarCallbacks()
    const handle = criarChatOverlay(cb)
    const shadow = obterShadowRoot()

    const input = shadow.querySelector<HTMLInputElement>('#chat-input')!
    const label = shadow.querySelector<HTMLLabelElement>('label[for="chat-input"]')

    expect(label).not.toBeNull()
    expect(input.id).toBe('chat-input')

    handle.destruir()
  })

  it('toggle-btn tem aria-label descritivo', () => {
    const cb = criarCallbacks()
    const handle = criarChatOverlay(cb)
    const shadow = obterShadowRoot()

    const btn = shadow.querySelector<HTMLButtonElement>('#toggle-btn')!
    const label = btn.getAttribute('aria-label')
    expect(label).toBeTruthy()
    expect(label!.length).toBeGreaterThan(0)

    handle.destruir()
  })

  it('sync-badge tem role=status para leitores de tela', () => {
    const cb = criarCallbacks()
    const handle = criarChatOverlay(cb)
    const shadow = obterShadowRoot()

    const badge = shadow.querySelector('#sync-badge')!
    expect(badge.getAttribute('role')).toBe('status')

    handle.destruir()
  })
})

// ---------------------------------------------------------------------------
// HIGH-1: isTrusted - eventos sinteticos ignorados
// ---------------------------------------------------------------------------

describe('HIGH-1: eventos sinteticos (isTrusted=false) sao ignorados', () => {
  // Neste grupo, restauramos _verificarConfianca para o comportamento real
  // (verifica e.isTrusted) em vez do bypass padrao dos testes funcionais.
  beforeEach(() => {
    overlayModule._confiancaConfig.verificar = (e) => e.isTrusted
  })

  it('toggle com isTrusted=false nao abre o painel', () => {
    const cb = criarCallbacks()
    const handle = criarChatOverlay(cb)
    const shadow = obterShadowRoot()

    const btn = shadow.querySelector<HTMLButtonElement>('#toggle-btn')!

    // Em jsdom, eventos criados via JS tem isTrusted=false - simula script malicioso
    btn.dispatchEvent(new MouseEvent('click', { bubbles: true }))

    // Painel deve continuar oculto (evento rejeitado)
    expect(shadow.querySelector('#chat-panel')?.classList.contains('hidden')).toBe(true)

    handle.destruir()
  })

  it('submit sintetico (isTrusted=false) nao chama onEnviarMensagem', () => {
    const cb = criarCallbacks()
    const handle = criarChatOverlay(cb)
    const shadow = obterShadowRoot()

    const input = shadow.querySelector<HTMLInputElement>('#chat-input')!
    const form = shadow.querySelector<HTMLFormElement>('#chat-form')!

    input.value = 'mensagem sintetica'
    // Em jsdom, Event criado via JS tem isTrusted=false
    form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))

    expect(cb.onEnviarMensagem).not.toHaveBeenCalled()

    handle.destruir()
  })

  it('clique sintetico em botao de reacao (isTrusted=false) nao chama onEnviarReacao', () => {
    const cb = criarCallbacks()
    const handle = criarChatOverlay(cb)
    const shadow = obterShadowRoot()

    const botoesReacao = shadow.querySelectorAll<HTMLButtonElement>('.reaction-btn')
    expect(botoesReacao.length).toBeGreaterThan(0)

    // Em jsdom, MouseEvent criado via JS tem isTrusted=false
    botoesReacao[0].dispatchEvent(new MouseEvent('click', { bubbles: true }))

    expect(cb.onEnviarReacao).not.toHaveBeenCalled()

    handle.destruir()
  })
})

// ---------------------------------------------------------------------------
// M3: idempotencia de criarChatOverlay
// ---------------------------------------------------------------------------

describe('M3: idempotencia de criarChatOverlay', () => {
  it('chamar criarChatOverlay duas vezes sem destruir nao cria segundo host', () => {
    const cb = criarCallbacks()
    const handle1 = criarChatOverlay(cb)
    // Segunda chamada deve retornar o handle existente (idempotencia M3)
    criarChatOverlay(cb)

    const hosts = document.querySelectorAll('#openparty-shadow-host')
    expect(hosts.length).toBe(1)

    handle1.destruir()
    expect(document.querySelector('#openparty-shadow-host')).toBeNull()
  })

  it('chamar criarChatOverlay duas vezes sem destruir retorna o mesmo handle', () => {
    const cb = criarCallbacks()
    const handle1 = criarChatOverlay(cb)
    const handle2 = criarChatOverlay(cb)

    expect(handle1).toBe(handle2)

    handle1.destruir()
  })

  it('apos destruir() e possivel criar novo overlay', () => {
    const cb = criarCallbacks()
    const handle1 = criarChatOverlay(cb)
    handle1.destruir()

    // Deve ser possivel criar novo overlay apos destruicao
    const handle2 = criarChatOverlay(cb)
    expect(document.querySelector('#openparty-shadow-host')).not.toBeNull()

    handle2.destruir()
  })
})

// ---------------------------------------------------------------------------
// M4: cap no array de mensagens
// ---------------------------------------------------------------------------

describe('M4: cap no array de mensagens', () => {
  it('array interno e limitado a MAX_MENSAGENS_EXIBIDAS (100)', () => {
    const cb = criarCallbacks()
    const handle = criarChatOverlay(cb)
    const shadow = obterShadowRoot()

    // Adiciona 110 mensagens
    for (let i = 0; i < 110; i++) {
      handle.adicionarMensagem({ userId: `u${i}`, displayName: `User${i}`, text: `msg${i}`, ts: Date.now() + i })
    }

    // O DOM deve ter no maximo 100 elementos .chat-msg
    const msgs = shadow.querySelectorAll('.chat-msg')
    expect(msgs.length).toBeLessThanOrEqual(100)

    handle.destruir()
  })
})
