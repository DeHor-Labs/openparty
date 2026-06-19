// src/content/overlay/styles.ts
// CSS injetado no Shadow Root do overlay.
// Isolado do CSS da pagina host (Netflix/YouTube) por design.

/** CSS completo do overlay injetado no shadow root */
export const OVERLAY_CSS = `
  :host {
    all: initial;
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
  }

  /* -------------------------------------------------------------------------
   * Container principal fixo no canto direito
   * ------------------------------------------------------------------------ */
  #openparty-root {
    position: fixed;
    top: 12px;
    right: 12px;
    z-index: 2147483647;
    display: flex;
    flex-direction: column;
    align-items: flex-end;
    gap: 8px;
    pointer-events: none;
  }

  /* -------------------------------------------------------------------------
   * Badge de sincronizacao
   * ------------------------------------------------------------------------ */
  #sync-badge {
    pointer-events: none;
    display: flex;
    align-items: center;
    gap: 6px;
    background: rgba(0, 0, 0, 0.65);
    backdrop-filter: blur(8px);
    -webkit-backdrop-filter: blur(8px);
    border-radius: 20px;
    padding: 4px 10px;
    font-size: 11px;
    color: rgba(255, 255, 255, 0.9);
    border: 1px solid rgba(255, 255, 255, 0.12);
    white-space: nowrap;
    transition: opacity 200ms ease;
  }

  #sync-badge .dot {
    width: 7px;
    height: 7px;
    border-radius: 50%;
    flex-shrink: 0;
    transition: background-color 300ms ease;
  }

  #sync-badge.status-conectando .dot   { background: #f59e0b; }
  #sync-badge.status-calibrando .dot   { background: #3b82f6; }
  #sync-badge.status-em-sync .dot      { background: #22c55e; }
  #sync-badge.status-corrigindo .dot   { background: #f97316; }
  #sync-badge.status-desconectado .dot { background: #ef4444; }

  @media (prefers-reduced-motion: no-preference) {
    #sync-badge.status-calibrando .dot  { animation: pulse-dot 1s infinite; }
    #sync-badge.status-corrigindo .dot  { animation: pulse-dot 0.8s infinite; }

    @keyframes pulse-dot {
      0%, 100% { opacity: 1; }
      50%       { opacity: 0.4; }
    }
  }

  /* -------------------------------------------------------------------------
   * Botao flutuante de toggle (sempre visivel)
   * ------------------------------------------------------------------------ */
  #toggle-btn {
    pointer-events: auto;
    cursor: pointer;
    width: 36px;
    height: 36px;
    border-radius: 50%;
    background: rgba(0, 0, 0, 0.72);
    backdrop-filter: blur(8px);
    -webkit-backdrop-filter: blur(8px);
    border: 1px solid rgba(255, 255, 255, 0.18);
    color: #fff;
    font-size: 16px;
    display: flex;
    align-items: center;
    justify-content: center;
    transition: background 150ms ease, transform 150ms ease;
    box-shadow: 0 2px 8px rgba(0,0,0,0.4);
  }

  #toggle-btn:hover { background: rgba(0, 0, 0, 0.88); transform: scale(1.07); }
  #toggle-btn:focus-visible {
    outline: 2px solid #60a5fa;
    outline-offset: 2px;
  }

  /* -------------------------------------------------------------------------
   * Painel lateral de chat
   * ------------------------------------------------------------------------ */
  #chat-panel {
    pointer-events: auto;
    display: flex;
    flex-direction: column;
    width: 280px;
    max-height: 420px;
    background: rgba(12, 12, 14, 0.82);
    backdrop-filter: blur(12px);
    -webkit-backdrop-filter: blur(12px);
    border-radius: 12px;
    border: 1px solid rgba(255, 255, 255, 0.1);
    box-shadow: 0 8px 32px rgba(0, 0, 0, 0.5);
    overflow: hidden;
    transition: opacity 180ms ease, transform 180ms ease;
  }

  #chat-panel.hidden {
    opacity: 0;
    pointer-events: none;
    transform: translateX(8px) scale(0.97);
  }

  /* Cabecalho do painel */
  #chat-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 8px 12px;
    border-bottom: 1px solid rgba(255, 255, 255, 0.08);
    flex-shrink: 0;
  }

  #chat-title {
    font-size: 12px;
    font-weight: 600;
    color: rgba(255, 255, 255, 0.9);
    letter-spacing: 0.02em;
  }

  #participants-count {
    font-size: 11px;
    color: rgba(255, 255, 255, 0.5);
    margin-left: 6px;
  }

  /* Lista de mensagens */
  #messages-list {
    flex: 1;
    overflow-y: auto;
    padding: 8px;
    display: flex;
    flex-direction: column;
    gap: 6px;
    scroll-behavior: smooth;
    min-height: 0;
  }

  #messages-list::-webkit-scrollbar { width: 4px; }
  #messages-list::-webkit-scrollbar-track { background: transparent; }
  #messages-list::-webkit-scrollbar-thumb {
    background: rgba(255,255,255,0.15);
    border-radius: 2px;
  }

  .chat-msg {
    font-size: 12.5px;
    line-height: 1.4;
    color: rgba(255, 255, 255, 0.88);
    word-break: break-word;
  }

  .chat-msg .author {
    font-weight: 600;
    color: #93c5fd;
    margin-right: 4px;
  }

  .chat-msg .time {
    font-size: 10px;
    color: rgba(255, 255, 255, 0.35);
    margin-left: 4px;
  }

  /* Mensagem vazia */
  .empty-hint {
    font-size: 11.5px;
    color: rgba(255,255,255,0.3);
    text-align: center;
    padding: 16px 8px;
  }

  /* Formulario de envio */
  #chat-form {
    display: flex;
    gap: 6px;
    padding: 8px;
    border-top: 1px solid rgba(255, 255, 255, 0.08);
    flex-shrink: 0;
  }

  #chat-input-label {
    display: flex;
    flex: 1;
  }

  #chat-input {
    flex: 1;
    background: rgba(255, 255, 255, 0.08);
    border: 1px solid rgba(255, 255, 255, 0.12);
    border-radius: 8px;
    color: #fff;
    font-size: 12px;
    padding: 6px 10px;
    outline: none;
    font-family: inherit;
    transition: border-color 150ms ease;
    min-width: 0;
  }

  #chat-input::placeholder { color: rgba(255,255,255,0.3); }

  #chat-input:focus {
    border-color: rgba(96, 165, 250, 0.6);
    background: rgba(255,255,255,0.11);
  }

  #send-btn {
    cursor: pointer;
    background: rgba(59, 130, 246, 0.85);
    border: none;
    border-radius: 8px;
    color: #fff;
    font-size: 11px;
    font-weight: 600;
    padding: 6px 10px;
    font-family: inherit;
    transition: background 150ms ease;
    white-space: nowrap;
  }

  #send-btn:hover { background: rgba(59, 130, 246, 1); }
  #send-btn:focus-visible {
    outline: 2px solid #60a5fa;
    outline-offset: 2px;
  }

  /* -------------------------------------------------------------------------
   * Reacoes flutuantes (sobrepostas, pointer-events none)
   * ------------------------------------------------------------------------ */
  #reactions-layer {
    position: fixed;
    inset: 0;
    pointer-events: none;
    overflow: hidden;
    z-index: 2147483646;
  }

  .floating-reaction {
    position: absolute;
    bottom: 100px;
    font-size: 28px;
    user-select: none;
    line-height: 1;
    pointer-events: none;
  }

  @media (prefers-reduced-motion: no-preference) {
    .floating-reaction {
      animation: float-up 2.5s ease-out forwards;
    }
  }

  @keyframes float-up {
    0%   { transform: translateY(0) scale(1); opacity: 1; }
    60%  { opacity: 0.9; }
    100% { transform: translateY(-200px) scale(0.7); opacity: 0; }
  }

  /* Barra de reacoes rapidas */
  #quick-reactions {
    pointer-events: auto;
    display: flex;
    gap: 4px;
    background: rgba(0, 0, 0, 0.65);
    backdrop-filter: blur(8px);
    -webkit-backdrop-filter: blur(8px);
    border-radius: 20px;
    padding: 4px 8px;
    border: 1px solid rgba(255, 255, 255, 0.1);
  }

  #quick-reactions.hidden {
    opacity: 0;
    pointer-events: none;
  }

  .reaction-btn {
    cursor: pointer;
    background: none;
    border: none;
    font-size: 18px;
    padding: 2px 3px;
    border-radius: 6px;
    line-height: 1;
    transition: transform 120ms ease;
  }

  .reaction-btn:hover { transform: scale(1.35); }
  .reaction-btn:active { transform: scale(0.9); }
  .reaction-btn:focus-visible {
    outline: 2px solid #60a5fa;
    border-radius: 6px;
  }
`
