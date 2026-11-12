/**
 * Signed draft-preview links (audit CMS-04).
 *
 * An admin asks for a token for one page or article; the public route renders
 * that item's draft for a request carrying `?preview=<token>`, for one hour.
 * The token is bound to type + id and expiry, and signed with a key DERIVED
 * from ADMIN_SESSION_SECRET (not the secret itself) under a different prefix,
 * so a preview token can never be presented as an admin session and a session
 * token can never open a preview.
 */
export const PREVIEW_TOKEN_TTL_SECONDS = 60 * 60

export type PreviewTarget = { type: 'page' | 'article'; id: string }

const encoder = new TextEncoder()

function toBase64Url(bytes: Uint8Array): string {
  let binary = ''
  bytes.forEach((byte) => { binary += String.fromCharCode(byte) })
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '')
}

function fromBase64Url(value: string): Uint8Array<ArrayBuffer> {
  const padded = value.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(value.length / 4) * 4, '=')
  return Uint8Array.from(atob(padded), (char) => char.charCodeAt(0))
}

async function previewKey(secret: string, usage: 'sign' | 'verify'): Promise<CryptoKey> {
  // Domain separation: HMAC(secret, label) is the key, never the secret itself.
  const base = await crypto.subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  const derived = await crypto.subtle.sign('HMAC', base, encoder.encode('devlab-draft-preview-v1'))
  return crypto.subtle.importKey('raw', derived, { name: 'HMAC', hash: 'SHA-256' }, false, [usage])
}

export async function createPreviewToken(secret: string, target: PreviewTarget, now = new Date()): Promise<string> {
  if (!secret) throw new Error('ADMIN_SESSION_SECRET is required to issue preview links.')
  const payload = { t: target.type, i: target.id, exp: Math.floor(now.getTime() / 1000) + PREVIEW_TOKEN_TTL_SECONDS }
  const encoded = toBase64Url(encoder.encode(JSON.stringify(payload)))
  const signature = await crypto.subtle.sign('HMAC', await previewKey(secret, 'sign'), encoder.encode(encoded))
  return `p1.${encoded}.${toBase64Url(new Uint8Array(signature))}`
}

export async function verifyPreviewToken(
  token: string | null | undefined,
  secret: string,
  target: PreviewTarget,
  now = new Date(),
): Promise<boolean> {
  if (!token || !secret) return false
  const [version, encoded, signature] = token.split('.')
  if (version !== 'p1' || !encoded || !signature) return false
  try {
    const valid = await crypto.subtle.verify('HMAC', await previewKey(secret, 'verify'), fromBase64Url(signature), encoder.encode(encoded))
    if (!valid) return false
    const payload = JSON.parse(new TextDecoder().decode(fromBase64Url(encoded))) as { t?: string; i?: string; exp?: number }
    return payload.t === target.type && payload.i === target.id && typeof payload.exp === 'number' && now.getTime() < payload.exp * 1000
  } catch {
    return false
  }
}
