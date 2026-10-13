/**
 * Which R2 objects the admin media library may replace or delete.
 *
 * PATCH/DELETE /api/admin/media used to act on ANY key in MEDIA_BUCKET. The
 * library only ever lists images (see the GET handler), so that is now also
 * the limit of what it can change: a well-formed key (no empty, "." or ".."
 * segments, no control characters, bounded length) whose object is an image.
 */

export const MAX_MEDIA_KEY_LENGTH = 512

const IMAGE_EXTENSIONS = new Set(['avif', 'gif', 'jpeg', 'jpg', 'png', 'svg', 'webp'])

/** True for a key shaped like something the media library could have listed. */
export function isManageableMediaKey(key: string): boolean {
  if (!key || key.length > MAX_MEDIA_KEY_LENGTH) return false
  if (/[\u0000-\u001f\u007f\\]/.test(key)) return false
  return key.split('/').every((segment) => segment !== '' && segment !== '.' && segment !== '..')
}

interface MediaObjectHead {
  httpMetadata?: { contentType?: string }
}

/** True when the stored object is an image the library would display. */
export function isManageableMediaObject(key: string, object: MediaObjectHead): boolean {
  const contentType = String(object.httpMetadata?.contentType || '').toLowerCase()
  if (contentType) return contentType.startsWith('image/')
  const extension = key.split('.').pop()?.toLowerCase() || ''
  return IMAGE_EXTENSIONS.has(extension)
}
