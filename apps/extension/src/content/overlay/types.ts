// src/content/overlay/types.ts
// Tipos compartilhados do chat overlay injetado via Shadow DOM.

import type { PresencePeer } from '@openparty/protocol'

// ---------------------------------------------------------------------------
// Estado de sincronizacao exibido pelo SyncBadge
// ---------------------------------------------------------------------------

/** Status de sincronizacao exibido no badge discreto */
export type SyncStatus =
  | 'conectando'
  | 'calibrando'
  | 'em-sync'
  | 'corrigindo'
  | 'desconectado'

// ---------------------------------------------------------------------------
// Mensagem de chat (espelha ChatServerEvent do protocolo)
// ---------------------------------------------------------------------------

export interface ChatMessageItem {
  /** userId do autor da mensagem */
  userId: string
  /** Nome de exibicao do autor */
  displayName: string
  /** Texto da mensagem */
  text: string
  /** Timestamp Unix em ms (usado para chave unica e hora exibida) */
  ts: number
}

// ---------------------------------------------------------------------------
// Reacao flutuante (espelha ReactionServerEvent do protocolo)
// ---------------------------------------------------------------------------

export interface FloatingReactionItem {
  /** ID unico da reacao (userId + ts) */
  id: string
  /** Emoji enviado */
  emoji: string
  /** Posicao horizontal em % (10-90) para evitar saida da tela */
  x: number
  /** Timestamp Unix em ms (para calculo de expiracao) */
  ts: number
}

// ---------------------------------------------------------------------------
// Interface publica do overlay (usada pelo content-main para integrar)
// ---------------------------------------------------------------------------

export interface ChatOverlayHandle {
  /**
   * Adiciona uma mensagem recebida do servidor ao painel de chat.
   * @param msg Mensagem de chat do servidor
   */
  adicionarMensagem(msg: ChatMessageItem): void

  /**
   * Adiciona uma reacao flutuante recebida do servidor.
   * @param id ID unico (ex: userId+ts)
   * @param emoji Emoji da reacao
   */
  adicionarReacao(id: string, emoji: string): void

  /**
   * Atualiza a lista de participantes presentes na sala.
   * @param peers Lista de participantes
   */
  atualizarParticipantes(peers: PresencePeer[]): void

  /**
   * Atualiza o status de sincronizacao exibido no badge.
   * @param status Novo status
   */
  atualizarSyncStatus(status: SyncStatus): void

  /**
   * Remove o overlay da pagina e limpa todos os recursos.
   * Deve ser chamado ao sair da sala ou no pagehide.
   */
  destruir(): void
}

// ---------------------------------------------------------------------------
// Callback do overlay para eventos de saida (chat e reacoes enviados)
// ---------------------------------------------------------------------------

export interface ChatOverlayCallbacks {
  /** Chamado quando o usuario digita e envia uma mensagem de chat */
  onEnviarMensagem: (text: string) => void
  /** Chamado quando o usuario clica em um botao de reacao rapida */
  onEnviarReacao: (emoji: string) => void
}
