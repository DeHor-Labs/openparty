// src/lib/storage.ts
// Wrapper tipado sobre chrome.storage.local para persistencia de estado da sala.
// chrome.storage.local e preferido sobre sync para dados volumosos e privados.

/** Dados persistidos localmente pela extensao */
export interface ExtensionStorage {
  /** ID da sala ativa (null quando fora de uma sala) */
  roomId: string | null
  /** ID do usuario local nesta sessao */
  userId: string | null
  /** Nome de exibicao escolhido pelo usuario */
  displayName: string
  /** Avatar (emoji ou URL) */
  avatar: string
  /** URL do servidor WebSocket configurado pelo usuario */
  serverUrl: string
  /** Offset de clock calibrado em relacao ao servidor (ms) */
  clockOffsetMs: number
}

const STORAGE_DEFAULTS: ExtensionStorage = {
  roomId: null,
  userId: null,
  displayName: 'Participante',
  avatar: '🎬',
  serverUrl: 'wss://openparty.app/ws',
  clockOffsetMs: 0,
}

/**
 * Le um ou mais campos do chrome.storage.local.
 * Retorna os defaults para campos ausentes.
 */
export async function storageGet<K extends keyof ExtensionStorage>(
  keys: K[],
): Promise<Pick<ExtensionStorage, K>> {
  const defaults: Partial<ExtensionStorage> = {}
  for (const k of keys) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (defaults as any)[k] = STORAGE_DEFAULTS[k]
  }
  const result = await chrome.storage.local.get(defaults)
  return result as Pick<ExtensionStorage, K>
}

/**
 * Persiste um subconjunto dos campos no chrome.storage.local.
 * Imutavel: nao altera campos nao listados em `data`.
 */
export async function storageSet(
  data: Partial<ExtensionStorage>,
): Promise<void> {
  await chrome.storage.local.set(data)
}

/**
 * Remove todos os dados da extensao do chrome.storage.local.
 * Usar ao sair de uma sala ou resetar configuracoes.
 */
export async function storageClear(): Promise<void> {
  await chrome.storage.local.clear()
}
