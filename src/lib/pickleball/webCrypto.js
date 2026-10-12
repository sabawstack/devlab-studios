export function textBytes(value) {
  return new TextEncoder().encode(value)
}

export function bytesToBase64Url(bytes) {
  let binary = ''
  bytes.forEach((byte) => {
    binary += String.fromCharCode(byte)
  })

  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '')
}

export function base64UrlToBytes(value) {
  const base64 = value.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(value.length / 4) * 4, '=')
  const binary = atob(base64)
  const bytes = new Uint8Array(binary.length)

  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index)
  }

  return bytes
}

export function randomBase64Url(byteLength) {
  const bytes = new Uint8Array(byteLength)
  crypto.getRandomValues(bytes)
  return bytesToBase64Url(bytes)
}

export async function sha256Base64Url(value) {
  const digest = await crypto.subtle.digest('SHA-256', textBytes(value))
  return bytesToBase64Url(new Uint8Array(digest))
}

async function getHmacKey(secret) {
  return crypto.subtle.importKey('raw', textBytes(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify'])
}

export async function hmacSign(payload, secret) {
  const key = await getHmacKey(secret)
  const signature = await crypto.subtle.sign('HMAC', key, textBytes(payload))
  return bytesToBase64Url(new Uint8Array(signature))
}

export async function hmacVerify(payload, signature, secret) {
  const key = await getHmacKey(secret)
  try {
    return await crypto.subtle.verify('HMAC', key, base64UrlToBytes(signature), textBytes(payload))
  } catch {
    return false
  }
}

/**
 * A uniform integer in [0, maxExclusive) from crypto.getRandomValues. Rejection
 * sampling, not a bare modulo, so no value is favoured (random pairing and
 * seeding in tournaments depend on it being fair).
 */
export function randomInt(maxExclusive) {
  if (!Number.isInteger(maxExclusive) || maxExclusive < 1 || maxExclusive > 2 ** 32) {
    throw new RangeError('maxExclusive must be an integer from 1 to 2^32')
  }
  const limit = Math.floor(2 ** 32 / maxExclusive) * maxExclusive
  const buffer = new Uint32Array(1)
  for (;;) {
    crypto.getRandomValues(buffer)
    if (buffer[0] < limit) return buffer[0] % maxExclusive
  }
}
