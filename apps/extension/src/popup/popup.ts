// src/popup/popup.ts
// UI do popup da extensao OpenParty.
// Funcionalidades: criar sala, entrar por link/codigo, status de conexao,
// contagem de participantes, copiar link de convite.

// ---------------------------------------------------------------------------
// Tipos de mensagem com o background
// ---------------------------------------------------------------------------

interface StatusResponse {
  ok: boolean
  roomId: string | null
  wsState: number
  peers: number
}

interface JoinRoomResponse {
  ok: boolean
  error?: string
}

// ---------------------------------------------------------------------------
// Utilitarios de DOM
// ---------------------------------------------------------------------------

function el<T extends HTMLElement>(id: string): T {
  const elem = document.getElementById(id)
  if (!elem) throw new Error(`Elemento nao encontrado: #${id}`)
  return elem as T
}

// ---------------------------------------------------------------------------
// Comunicacao com o background
// ---------------------------------------------------------------------------

async function sendMessage<T>(message: Record<string, unknown>): Promise<T> {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage(message, (response: T) => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message))
        return
      }
      resolve(response)
    })
  })
}

async function obterStatus(): Promise<StatusResponse> {
  try {
    return await sendMessage<StatusResponse>({ type: 'get-status' })
  } catch {
    return { ok: false, roomId: null, wsState: WebSocket.CLOSED, peers: 0 }
  }
}

// ---------------------------------------------------------------------------
// Gerador de ID de sala
// ---------------------------------------------------------------------------

/** Gera um ID de sala de 8 caracteres alfanumericos aleatorios */
function gerarRoomId(): string {
  const chars = 'abcdefghijklmnopqrstuvwxyz0123456789'
  return Array.from({ length: 8 }, () => chars[Math.floor(Math.random() * chars.length)]).join('')
}

// ---------------------------------------------------------------------------
// Renderizacao de estado
// ---------------------------------------------------------------------------

const ESTADO_CONECTADO = '🟢 Conectado'
const ESTADO_CONECTANDO = '🟡 Conectando...'
const ESTADO_DESCONECTADO = '🔴 Desconectado'

function labelEstadoWs(wsState: number): string {
  if (wsState === WebSocket.OPEN) return ESTADO_CONECTADO
  if (wsState === WebSocket.CONNECTING) return ESTADO_CONECTANDO
  return ESTADO_DESCONECTADO
}

function mostrarTelaEntrada(): void {
  el('tela-entrada').style.display = 'block'
  el('tela-sala').style.display = 'none'
}

function mostrarTelaSala(roomId: string, wsState: number, peers: number): void {
  el('tela-entrada').style.display = 'none'
  el('tela-sala').style.display = 'block'
  el<HTMLInputElement>('link-convite').value = `https://openparty.dehor.com.br/join/${roomId}`
  el('status-ws').textContent = labelEstadoWs(wsState)
  el('contagem-peers').textContent = `${peers} participante${peers !== 1 ? 's' : ''}`
}

async function atualizarInterface(): Promise<void> {
  const status = await obterStatus()
  if (status.roomId) {
    mostrarTelaSala(status.roomId, status.wsState, status.peers)
  } else {
    mostrarTelaEntrada()
  }
}

// ---------------------------------------------------------------------------
// Acoes do usuario
// ---------------------------------------------------------------------------

async function criarSala(): Promise<void> {
  const roomId = gerarRoomId()
  const btnCriar = el<HTMLButtonElement>('btn-criar')
  btnCriar.disabled = true
  btnCriar.textContent = 'Criando...'

  try {
    const response = await sendMessage<JoinRoomResponse>({ type: 'join-room', roomId })
    if (!response.ok) {
      mostrarErro(response.error ?? 'Erro ao criar sala')
      return
    }
    await atualizarInterface()
  } catch (err) {
    mostrarErro('Nao foi possivel criar a sala')
    console.error('[OpenParty Popup] erro ao criar sala:', err)
  } finally {
    btnCriar.disabled = false
    btnCriar.textContent = 'Criar nova sala'
  }
}

async function entrarPorLink(): Promise<void> {
  const inputLink = el<HTMLInputElement>('input-link')
  const valor = inputLink.value.trim()

  if (!valor) {
    mostrarErro('Cole o link ou codigo de convite')
    return
  }

  // Aceita tanto o link completo quanto apenas o codigo de 8 caracteres
  const match = valor.match(/([a-z0-9]{8})$/)
  if (!match) {
    mostrarErro('Link ou codigo invalido')
    return
  }

  const roomId = match[1]
  const btnEntrar = el<HTMLButtonElement>('btn-entrar')
  btnEntrar.disabled = true
  btnEntrar.textContent = 'Entrando...'

  try {
    const response = await sendMessage<JoinRoomResponse>({ type: 'join-room', roomId })
    if (!response.ok) {
      mostrarErro(response.error ?? 'Erro ao entrar na sala')
      return
    }
    await atualizarInterface()
  } catch (err) {
    mostrarErro('Nao foi possivel entrar na sala')
    console.error('[OpenParty Popup] erro ao entrar na sala:', err)
  } finally {
    btnEntrar.disabled = false
    btnEntrar.textContent = 'Entrar'
  }
}

async function sairDaSala(): Promise<void> {
  try {
    await sendMessage({ type: 'leave-room' })
    await atualizarInterface()
  } catch (err) {
    console.error('[OpenParty Popup] erro ao sair da sala:', err)
  }
}

async function copiarLink(): Promise<void> {
  const linkEl = el<HTMLInputElement>('link-convite')
  await navigator.clipboard.writeText(linkEl.value)

  const btnCopiar = el<HTMLButtonElement>('btn-copiar')
  const textoOriginal = btnCopiar.textContent ?? 'Copiar'
  btnCopiar.textContent = 'Copiado!'
  setTimeout(() => { btnCopiar.textContent = textoOriginal }, 1_500)
}

function mostrarErro(mensagem: string): void {
  const erroEl = el('mensagem-erro')
  erroEl.textContent = mensagem
  erroEl.style.display = 'block'
  setTimeout(() => { erroEl.style.display = 'none' }, 3_000)
}

// ---------------------------------------------------------------------------
// Inicializacao
// ---------------------------------------------------------------------------

document.addEventListener('DOMContentLoaded', () => {
  el('btn-criar').addEventListener('click', () => { criarSala().catch(console.error) })
  el('btn-entrar').addEventListener('click', () => { entrarPorLink().catch(console.error) })
  el('btn-sair').addEventListener('click', () => { sairDaSala().catch(console.error) })
  el('btn-copiar').addEventListener('click', () => { copiarLink().catch(console.error) })

  // Permite entrar pressionando Enter no campo de link
  el('input-link').addEventListener('keydown', (evt: KeyboardEvent) => {
    if (evt.key === 'Enter') entrarPorLink().catch(console.error)
  })

  atualizarInterface().catch(console.error)
})
