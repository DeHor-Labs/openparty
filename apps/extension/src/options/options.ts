// src/options/options.ts
// Pagina de opcoes da extensao OpenParty.
// Permite configurar: URL do servidor WS, nome de exibicao e avatar.

import { storageGet, storageSet } from '../lib/storage'

// ---------------------------------------------------------------------------
// Utilitarios de DOM
// ---------------------------------------------------------------------------

/**
 * Recupera um elemento do DOM pelo id com tipagem.
 * Lanca erro se o elemento nao for encontrado.
 */
function el<T extends HTMLElement>(id: string): T {
  const elem = document.getElementById(id)
  if (!elem) throw new Error(`Elemento nao encontrado: #${id}`)
  return elem as T
}

/**
 * Exibe uma mensagem de feedback temporaria na tela.
 */
function mostrarFeedback(mensagem: string, tipo: 'sucesso' | 'erro'): void {
  const feedbackEl = el('feedback')
  feedbackEl.textContent = mensagem
  feedbackEl.className = `feedback ${tipo}`
  feedbackEl.style.display = 'block'
  setTimeout(() => { feedbackEl.style.display = 'none' }, 3_000)
}

// ---------------------------------------------------------------------------
// Validacao da URL do servidor (M4)
// ---------------------------------------------------------------------------

/**
 * Verifica se o host e localhost ou 127.0.0.1.
 */
function isLocalhost(host: string): boolean {
  return host === 'localhost' || host === '127.0.0.1'
}

/**
 * Valida a URL do servidor WebSocket.
 * M4: exige wss:// fora de localhost; aceita ws:// apenas para localhost/127.0.0.1.
 * Retorna null se valida, ou uma mensagem de erro.
 */
function validarServerUrl(url: string): string | null {
  if (!url) {
    return 'URL do servidor e obrigatoria'
  }

  const ehWs = url.startsWith('ws://')
  const ehWss = url.startsWith('wss://')

  if (!ehWs && !ehWss) {
    return 'URL deve comecar com ws:// ou wss://'
  }

  // Extrai o host para verificar se e localhost
  try {
    const parsed = new URL(url)
    const host = parsed.hostname

    if (ehWs && !isLocalhost(host)) {
      return 'Conexoes inseguras (ws://) so sao permitidas em localhost ou 127.0.0.1. Use wss:// para outros hosts.'
    }
  } catch {
    return 'URL do servidor invalida'
  }

  return null
}

// ---------------------------------------------------------------------------
// Carregar configuracoes existentes
// ---------------------------------------------------------------------------

/**
 * Carrega as configuracoes salvas e preenche o formulario.
 */
async function carregarConfiguracoes(): Promise<void> {
  const dados = await storageGet(['serverUrl', 'displayName', 'avatar'])
  el<HTMLInputElement>('input-server-url').value = dados.serverUrl
  el<HTMLInputElement>('input-display-name').value = dados.displayName
  el<HTMLInputElement>('input-avatar').value = dados.avatar
}

// ---------------------------------------------------------------------------
// Salvar configuracoes
// ---------------------------------------------------------------------------

/**
 * Valida e persiste as configuracoes do formulario.
 * M4: valida a URL exigindo wss:// fora de localhost.
 */
async function salvarConfiguracoes(): Promise<void> {
  const serverUrl = el<HTMLInputElement>('input-server-url').value.trim()
  const displayName = el<HTMLInputElement>('input-display-name').value.trim()
  const avatar = el<HTMLInputElement>('input-avatar').value.trim()

  const erroUrl = validarServerUrl(serverUrl)
  if (erroUrl) {
    mostrarFeedback(erroUrl, 'erro')
    return
  }

  if (!displayName) {
    mostrarFeedback('Nome de exibicao e obrigatorio', 'erro')
    return
  }

  const btnSalvar = el<HTMLButtonElement>('btn-salvar')
  btnSalvar.disabled = true

  try {
    await storageSet({ serverUrl, displayName, avatar: avatar || '🎬' })
    mostrarFeedback('Configuracoes salvas', 'sucesso')
  } catch (err) {
    mostrarFeedback('Erro ao salvar configuracoes', 'erro')
    console.error('[OpenParty Options] erro ao salvar:', err)
  } finally {
    btnSalvar.disabled = false
  }
}

// ---------------------------------------------------------------------------
// Inicializacao
// CR: remove listener de click no botao; mantém apenas submit do form
// ---------------------------------------------------------------------------

document.addEventListener('DOMContentLoaded', () => {
  carregarConfiguracoes().catch(console.error)

  // Usa apenas o evento submit do form (cobre Enter + clique no botao type=submit).
  // Nao registra listener de click no botao separadamente para evitar dupla persistencia.
  el('form-opcoes').addEventListener('submit', (evt) => {
    evt.preventDefault()
    salvarConfiguracoes().catch(console.error)
  })
})
