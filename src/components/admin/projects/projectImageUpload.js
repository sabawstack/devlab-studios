import { adminFetch } from '../../../admin-app/lib/adminApi'
/**
 * Uploads every "pending" (not-yet-persisted) gallery item to R2 via the
 * existing media upload endpoint, returning a new array where pending items
 * are replaced with their real url/filename. Non-pending items pass through
 * unchanged. Throws on the first failed upload — callers should treat that
 * as "nothing was saved" (the caller submits the project payload only after
 * this resolves).
 */
export async function uploadPendingGalleryImages(galleryImages, onProgress) {
  const items = Array.isArray(galleryImages) ? galleryImages : []
  const uploaded = []

  for (const item of items) {
    if (!item.pending || !item.file) {
      uploaded.push(item)
      continue
    }

    onProgress?.(item.file.name)

    const formData = new FormData()
    formData.append('folder', 'projects')
    formData.append('file', item.file)

    const response = await adminFetch('/api/admin/media', { method: 'POST', body: formData })
    const data = await response.json()

    if (!response.ok) {
      throw new Error(data.error ? `${item.file.name}: ${data.error}` : `Upload failed for ${item.file.name} (${response.status}).`)
    }

    uploaded.push({ ...item, url: data.url, filename: data.filename, pending: false, file: null })
  }

  return uploaded
}
