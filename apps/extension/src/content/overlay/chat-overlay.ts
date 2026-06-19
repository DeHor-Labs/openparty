// src/content/overlay/chat-overlay.ts
// Chat overlay injetado via Shadow DOM na pagina do player.
// CSS isolado, sem React, sem dependencias de framework.
// Todos os textos inseridos no DOM usam textContent (sem innerHTML).

import type { PresencePeer } from '@openparty/protocol'
import type { ChatMessageItem, ChatOverlayCallbacks, ChatOverlayHandle, SyncStatus } from './types'
import { ReactionsLayer } from './reactions'
import { OVERLAY_CSS } from './styles'

// ---------------------------------------------------------------------------
// Constantes
// ---------------------------------------------------------------------------

const EMOJIS_RAPIDOS = ['❤️', '😂', '😮', '👏', '🔥', '💯'] as const
const MAX_MENSAGENS_EXIBIDAS = 100
const SHADOW_HOST_ID = 'openparty-shadow-host'

/**
 * Objeto de configuracao de verificacao de confianca, substituivel em testes.
 *
 * HIGH-1: em producao, verifica e.isTrusted para ignorar eventos sinteticos
 * disparados por scripts da pagina (XSS, automacao maliciosa).
 * Em testes (jsdom), isTrusted e sempre false para eventos JS; o ambiente
 * de teste pode substituir confiancaConfig.verificar para simular eventos confiaveis.
 *
 * Usamos um objeto mutavel (em vez de export let) porque ES modules nao permitem
 * atribuicao direta de variaveis exportadas de fora do modulo.
 *
 * @internal exportado apenas para uso em testes unitarios
 */
export const _confiancaConfig = {
  verificar: (e: Event): boolean => e.isTrusted,
}

// Textos da UI em pt-BR
const LABEL_MENSAGEM = 'Mensagem...'
const LABEL_ENVIAR = 'Enviar'
const LABEL_PARTICIPANTES = 'Participantes'
const LABEL_CHAT = 'Chat'
const HINT_SEM_MENSAGENS = 'Seja o primeiro a enviar uma mensagem...'
const LABEL_TOGGLE_ABRIR = 'Abrir chat'
const LABEL_TOGGLE_FECHAR = 'Fechar chat'

// Textos do SyncBadge em pt-BR
const STATUS_TEXTO: Record<SyncStatus, string> = {
  'conectando': 'Conectando',
  'calibrando': 'Calibrando',
  'em-sync': 'Em sync',
  'corrigindo': 'Corrigindo',
  'desconectado': 'Desconectado',
}

// ---------------------------------------------------------------------------
// Helpers DOM (sem innerHTML)
// ---------------------------------------------------------------------------

/** Cria um elemento com atributos opcionais e filhos de texto */
function criarEl<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs: Record<string, string> = {},
  texto?: string,
): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag)
  for (const [k, v] of Object.entries(attrs)) {
    el.setAttribute(k, v)
  }
  if (texto !== undefined) {
    el.textContent = texto
  }
  return el
}

/** Formata timestamp Unix (ms) como HH:MM */
function formatarHora(ts: number): string {
  const d = new Date(ts)
  const h = String(d.getHours()).padStart(2, '0')
  const m = String(d.getMinutes()).padStart(2, '0')
  return `${h}:${m}`
}

// ---------------------------------------------------------------------------
// ChatOverlay: implementacao principal
// ---------------------------------------------------------------------------

/**
 * Cria e injeta o chat overlay na pagina via Shadow DOM.
 * O shadow root isola completamente o CSS do host (Netflix, YouTube, etc).
 *
 * M3: idempotente - se ja existir um host com o mesmo ID, retorna o handle
 * existente sem recriar o overlay (evita dois ReactionsLayer com setInterval duplo).
 *
 * @param callbacks Handlers para eventos de saida (envio de chat e reacao)
 * @returns Handle publico para controlar o overlay
 */

/**
 * Handle ativo em uso pelo overlay atual (singleton).
 * Mantido internamente para garantir idempotencia de criarChatOverlay.
 */
let _handleAtivo: ChatOverlayHandle | null = null

export function criarChatOverlay(callbacks: ChatOverlayCallbacks): ChatOverlayHandle {
  // -------------------------------------------------------------------
  // M3: guard de idempotencia - nao recria se ja existe
  // -------------------------------------------------------------------
  const hostExistente = document.querySelector(`#${SHADOW_HOST_ID}`)
  if (hostExistente && _handleAtivo) {
    return _handleAtivo
  }

  // -------------------------------------------------------------------
  // Shadow DOM
  // -------------------------------------------------------------------

  const shadowHost = criarEl('div', { id: SHADOW_HOST_ID })
  shadowHost.style.cssText = 'position:fixed;top:0;left:0;width:0;height:0;z-index:2147483647;'
  document.body.appendChild(shadowHost)

  // HIGH-1: shadow em modo 'closed' impede scripts da pagina de acessar o shadow root.
  // A referencia interna e mantida pela closure desta funcao.
  const shadow = shadowHost.attachShadow({ mode: 'closed' })

  // Injeta CSS isolado via <style> no shadow root
  const styleEl = criarEl('style')
  styleEl.textContent = OVERLAY_CSS
  shadow.appendChild(styleEl)

  // -------------------------------------------------------------------
  // Estrutura do DOM do overlay
  // -------------------------------------------------------------------

  // Container raiz
  const root = criarEl('div', { id: 'openparty-root' })

  // Badge de sync
  const syncBadge = criarEl('div', { id: 'sync-badge', class: 'status-conectando', role: 'status', 'aria-live': 'polite' })
  const syncDot = criarEl('span', { class: 'dot', 'aria-hidden': 'true' })
  const syncTexto = criarEl('span', {}, STATUS_TEXTO['conectando'])
  syncBadge.appendChild(syncDot)
  syncBadge.appendChild(syncTexto)

  // Botao de toggle
  const toggleBtn = criarEl('button', {
    id: 'toggle-btn',
    type: 'button',
    'aria-label': LABEL_TOGGLE_ABRIR,
    'aria-expanded': 'false',
    'aria-controls': 'chat-panel',
  }, '💬')

  // Painel de chat
  const chatPanel = criarEl('div', { id: 'chat-panel', class: 'hidden', role: 'complementary', 'aria-label': LABEL_CHAT })

  // Cabecalho
  const chatHeader = criarEl('div', { id: 'chat-header' })
  const chatTitleWrapper = criarEl('div', { style: 'display:flex;align-items:center;' })
  const chatTitle = criarEl('span', { id: 'chat-title' }, LABEL_CHAT)
  const participantsCount = criarEl('span', { id: 'participants-count' }, `· 0 ${LABEL_PARTICIPANTES}`)
  chatTitleWrapper.appendChild(chatTitle)
  chatTitleWrapper.appendChild(participantsCount)
  chatHeader.appendChild(chatTitleWrapper)

  // Lista de mensagens
  const messagesList = criarEl('ul', { id: 'messages-list', 'aria-label': 'Mensagens do chat', 'aria-live': 'polite', 'aria-relevant': 'additions' })
  const emptyHint = criarEl('li', { class: 'empty-hint' }, HINT_SEM_MENSAGENS)
  messagesList.appendChild(emptyHint)

  // Formulario de chat
  const chatForm = criarEl('form', { id: 'chat-form', novalidate: '' })
  const chatInputLabel = criarEl('label', { id: 'chat-input-label', for: 'chat-input', style: 'flex:1;display:flex;' })
  // Label visualmente oculto mas acessivel
  const visuallyHiddenSpan = criarEl('span', { style: 'position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0,0,0,0);' }, 'Mensagem de chat')
  const chatInput = criarEl('input', {
    id: 'chat-input',
    type: 'text',
    placeholder: LABEL_MENSAGEM,
    maxlength: '500',
    autocomplete: 'off',
    autocorrect: 'off',
    spellcheck: 'false',
  }) as HTMLInputElement
  chatInputLabel.appendChild(visuallyHiddenSpan)
  chatInputLabel.appendChild(chatInput)
  const sendBtn = criarEl('button', { id: 'send-btn', type: 'submit' }, LABEL_ENVIAR)
  chatForm.appendChild(chatInputLabel)
  chatForm.appendChild(sendBtn)

  // Monta painel
  chatPanel.appendChild(chatHeader)
  chatPanel.appendChild(messagesList)
  chatPanel.appendChild(chatForm)

  // Barra de reacoes rapidas
  const quickReactions = criarEl('div', { id: 'quick-reactions', class: 'hidden', role: 'group', 'aria-label': 'Reacoes rapidas' })
  for (const emoji of EMOJIS_RAPIDOS) {
    const btn = criarEl('button', { class: 'reaction-btn', type: 'button', 'aria-label': emoji })
    btn.textContent = emoji
    // HIGH-1: ignora cliques sinteticos disparados por scripts da pagina
    btn.addEventListener('click', (e) => {
      if (!_confiancaConfig.verificar(e)) return
      callbacks.onEnviarReacao(emoji)
    })
    quickReactions.appendChild(btn)
  }

  // Camada de reacoes flutuantes
  const reactionsLayerEl = criarEl('div', { id: 'reactions-layer', 'aria-hidden': 'true' })

  // Monta root
  root.appendChild(syncBadge)
  root.appendChild(toggleBtn)
  root.appendChild(chatPanel)
  root.appendChild(quickReactions)

  shadow.appendChild(root)
  shadow.appendChild(reactionsLayerEl)

  // -------------------------------------------------------------------
  // Gerenciador de reacoes
  // -------------------------------------------------------------------

  const reactionsLayer = new ReactionsLayer(reactionsLayerEl)

  // -------------------------------------------------------------------
  // Estado local
  // -------------------------------------------------------------------

  let painelVisivel = false
  let participantes: PresencePeer[] = []
  let mensagens: ChatMessageItem[] = []

  // -------------------------------------------------------------------
  // Toggle do painel
  // -------------------------------------------------------------------

  function abrirPainel(): void {
    painelVisivel = true
    chatPanel.classList.remove('hidden')
    quickReactions.classList.remove('hidden')
    toggleBtn.setAttribute('aria-label', LABEL_TOGGLE_FECHAR)
    toggleBtn.setAttribute('aria-expanded', 'true')
    toggleBtn.textContent = '✕'
    rolarParaBaixo()
    chatInput.focus()
  }

  function fecharPainel(): void {
    painelVisivel = false
    chatPanel.classList.add('hidden')
    quickReactions.classList.add('hidden')
    toggleBtn.setAttribute('aria-label', LABEL_TOGGLE_ABRIR)
    toggleBtn.setAttribute('aria-expanded', 'false')
    toggleBtn.textContent = '💬'
  }

  // HIGH-1: ignora cliques sinteticos no toggle (scripts da pagina nao devem abrir/fechar)
  toggleBtn.addEventListener('click', (e) => {
    if (!_confiancaConfig.verificar(e)) return
    if (painelVisivel) {
      fecharPainel()
    } else {
      abrirPainel()
    }
  })

  // -------------------------------------------------------------------
  // Auto-scroll da lista de mensagens
  // -------------------------------------------------------------------

  function rolarParaBaixo(): void {
    messagesList.scrollTop = messagesList.scrollHeight
  }

  // -------------------------------------------------------------------
  // Renderizacao de mensagem individual (sem innerHTML)
  // -------------------------------------------------------------------

  function renderizarMensagem(msg: ChatMessageItem): void {
    // Remove hint vazio se existir
    const hint = messagesList.querySelector('.empty-hint')
    hint?.remove()

    const li = criarEl('li', { class: 'chat-msg' })

    const authorSpan = criarEl('span', { class: 'author' }, msg.displayName)
    const textSpan = criarEl('span', {}, msg.text)
    const timeSpan = criarEl('span', { class: 'time' }, formatarHora(msg.ts))

    li.appendChild(authorSpan)
    li.appendChild(textSpan)
    li.appendChild(timeSpan)

    messagesList.appendChild(li)

    // Limita mensagens exibidas (remove as mais antigas do DOM)
    const itens = messagesList.querySelectorAll('.chat-msg')
    if (itens.length > MAX_MENSAGENS_EXIBIDAS) {
      itens[0]?.remove()
    }

    if (painelVisivel) {
      rolarParaBaixo()
    }
  }

  // -------------------------------------------------------------------
  // Envio de mensagem via formulario
  // -------------------------------------------------------------------

  // HIGH-1: ignora submits sinteticos - apenas interacoes reais do usuario disparam envio
  chatForm.addEventListener('submit', (e) => {
    e.preventDefault()
    if (!_confiancaConfig.verificar(e)) return
    const texto = chatInput.value.trim()
    if (!texto) return
    callbacks.onEnviarMensagem(texto)
    chatInput.value = ''
  })

  // -------------------------------------------------------------------
  // Atualiza contagem de participantes no cabecalho
  // -------------------------------------------------------------------

  function atualizarContadorParticipantes(): void {
    participantsCount.textContent = `· ${participantes.length} ${LABEL_PARTICIPANTES}`
  }

  // -------------------------------------------------------------------
  // Interface publica
  // -------------------------------------------------------------------

  const handle: ChatOverlayHandle = {
    adicionarMensagem(msg: ChatMessageItem): void {
      // M4: cap no array para evitar crescimento ilimitado em sessoes longas
      mensagens = [...mensagens, msg].slice(-MAX_MENSAGENS_EXIBIDAS)
      renderizarMensagem(msg)
    },

    adicionarReacao(id: string, emoji: string): void {
      reactionsLayer.adicionarReacao(id, emoji)
    },

    atualizarParticipantes(peers: PresencePeer[]): void {
      participantes = [...peers]
      atualizarContadorParticipantes()
    },

    atualizarSyncStatus(status: SyncStatus): void {
      // Remove classe de status anterior
      for (const s of Object.keys(STATUS_TEXTO) as SyncStatus[]) {
        syncBadge.classList.remove(`status-${s}`)
      }
      syncBadge.classList.add(`status-${status}`)
      syncTexto.textContent = STATUS_TEXTO[status]
    },

    destruir(): void {
      reactionsLayer.destruir()
      fecharPainel()
      shadowHost.remove()
      mensagens = []
      participantes = []
      // M3: libera o singleton para permitir nova criacao apos destruicao
      _handleAtivo = null
    },
  }

  // M3: registra o handle ativo para o guard de idempotencia
  _handleAtivo = handle
  return handle
}
