// No I, L, O, 0 or 1: a code is read off a phone held up at the court and
// typed by hand, so characters that look alike are excluded.
export const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'
export const CODE_LENGTH = 10
const CODE_PATTERN = /^[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{10}$/
// Largest multiple of 31 below 256; bytes at or above it are discarded so
// every character is equally likely (no modulo bias).
const UNBIASED_LIMIT = 256 - (256 % CODE_ALPHABET.length)

function cryptoBytes(length: number): Uint8Array {
  return crypto.getRandomValues(new Uint8Array(length))
}

export function generatePublicCode(randomBytes: (length: number) => Uint8Array = cryptoBytes): string {
  let code = ''
  while (code.length < CODE_LENGTH) {
    for (const byte of randomBytes(16)) {
      if (byte < UNBIASED_LIMIT && code.length < CODE_LENGTH) code += CODE_ALPHABET[byte % CODE_ALPHABET.length]
    }
  }
  return code
}

export function normalizePublicCode(input: string): string | null {
  const code = input.toUpperCase().replace(/[\s-]/g, '')
  return CODE_PATTERN.test(code) ? code : null
}

export function formatPublicCode(code: string): string {
  return `${code.slice(0, 5)}-${code.slice(5)}`
}
