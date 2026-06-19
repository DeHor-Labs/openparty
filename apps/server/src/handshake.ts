// apps/server/src/handshake.ts
//
// Validacao do handshake inicial de identidade do WebSocket.
// Extraido de index.ts para ser importado tanto pelo servidor quanto pelos testes,
// eliminando a duplicacao de logica que existia em hardening.test.ts.

/** Comprimento maximo permitido para displayName no handshake */
export const HANDSHAKE_DISPLAY_NAME_MAX = 64

/** Comprimento maximo permitido para avatar no handshake */
export const HANDSHAKE_AVATAR_MAX = 16

export interface ValidHandshake {
  displayName: string
  avatar: string
}

export interface HandshakeResult {
  valid: true
  handshake: ValidHandshake
}

export interface HandshakeError {
  valid: false
  closeCode: 1008
  reason: string
}

export type HandshakeValidation = HandshakeResult | HandshakeError

/**
 * Valida o payload do handshake inicial WebSocket.
 *
 * - displayName: obrigatorio, string, 1..HANDSHAKE_DISPLAY_NAME_MAX chars.
 * - avatar: opcional; se presente, deve ser string com ate HANDSHAKE_AVATAR_MAX chars.
 *
 * Retorna `{ valid: true, handshake }` se valido, ou
 * `{ valid: false, closeCode: 1008, reason }` para fechar a conexao.
 */
export function validateHandshake(payload: unknown): HandshakeValidation {
  const h = (payload as Record<string, unknown>) ?? {}

  if (
    typeof h['displayName'] !== 'string' ||
    h['displayName'].length < 1 ||
    h['displayName'].length > HANDSHAKE_DISPLAY_NAME_MAX
  ) {
    return { valid: false, closeCode: 1008, reason: 'handshake invalido' }
  }

  const rawAvatar = h['avatar']
  if (rawAvatar !== undefined && rawAvatar !== null) {
    if (typeof rawAvatar !== 'string' || rawAvatar.length > HANDSHAKE_AVATAR_MAX) {
      return { valid: false, closeCode: 1008, reason: 'handshake invalido' }
    }
  }

  const displayName = h['displayName'] as string
  const avatar = typeof rawAvatar === 'string' ? rawAvatar : '🎬'

  return { valid: true, handshake: { displayName, avatar } }
}
