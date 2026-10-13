import type { APIRoute } from 'astro'
import { getEnv } from '../../../lib/env'
import { deleteMediaAsset, findMediaReferences, findMediaReferencesForAssets, listMediaAssets, recordMediaAsset, replaceMediaReferences } from '../../../worker/repositories/mediaAssets.js'
import { logAuditFailure, recordAuditEvent } from '../../../worker/repositories/auditLog.js'
import { checkRateLimit, clientIp, rateLimitedResponse } from '../../../worker/rateLimit.js'
import { isManageableMediaKey, isManageableMediaObject } from '../../../lib/mediaKeys'
import { withAdmin } from '../../../lib/adminGuard'

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
}

function nowIso(): string {
  return new Date().toISOString()
}

function inferContentType(key: string): string {
  const extension = key.split('.').pop()?.toLowerCase()
  const types: Record<string, string> = {
    avif: 'image/avif', gif: 'image/gif', jpeg: 'image/jpeg', jpg: 'image/jpeg',
    png: 'image/png', svg: 'image/svg+xml', webp: 'image/webp',
  }
  return extension ? types[extension] || 'application/octet-stream' : 'application/octet-stream'
}

function filenameFromKey(key: string): string {
  const filename = key.split('/').pop() || key
  try { return decodeURIComponent(filename) } catch { return filename }
}

const MAX_UPLOAD_BYTES = 12 * 1024 * 1024
const MAX_DIMENSION_PX = 6000

// Every mutating media route goes through this. These are all
// session-gated, so the point is not to stop an anonymous flood but to bound
// what a single compromised or misbehaving admin session (or a runaway
// client retry loop) can spend on R2 storage and D1 writes. Set generously
// enough that a real admin adding a whole project gallery in one sitting
// never notices it.
const MEDIA_WRITE_BUCKET = 'admin-media-write'
const MEDIA_WRITE_LIMIT = 60
const MEDIA_WRITE_WINDOW_MS = 5 * 60 * 1000

/**
 * Keyed on the admin identity rather than the address: these routes are
 * already authenticated, so the session is the meaningful unit, and it keeps
 * two admins behind one office NAT from sharing a budget.
 */
async function checkMediaWriteLimit(
  env: { RATE_LIMITER?: DurableObjectNamespace },
  request: Request,
  adminEmail: unknown,
): Promise<Response | null> {
  const identity = String(adminEmail || '').trim().toLowerCase() || clientIp(request)
  const rate = await checkRateLimit(env, MEDIA_WRITE_BUCKET, identity, {
    limit: MEDIA_WRITE_LIMIT,
    windowMs: MEDIA_WRITE_WINDOW_MS,
  })

  return rate.limited
    ? rateLimitedResponse('Too many media changes in a short time. Try again shortly.', rate.retryAfterSeconds)
    : null
}

/** Reads real pixel dimensions from a WebP file's VP8/VP8L/VP8X chunk, independent of any client-reported metadata. */
function readWebpDimensions(bytes: Uint8Array): { width: number; height: number } | null {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const chunkFourCc = String.fromCharCode(bytes[12], bytes[13], bytes[14], bytes[15])

  if (chunkFourCc === 'VP8X' && bytes.length >= 30) {
    const width = 1 + (bytes[24] | (bytes[25] << 8) | (bytes[26] << 16))
    const height = 1 + (bytes[27] | (bytes[28] << 8) | (bytes[29] << 16))
    return { width, height }
  }

  if (chunkFourCc === 'VP8 ' && bytes.length >= 30) {
    const width = view.getUint16(26, true) & 0x3fff
    const height = view.getUint16(28, true) & 0x3fff
    return { width, height }
  }

  if (chunkFourCc === 'VP8L' && bytes.length >= 25) {
    const bits = view.getUint32(21, true)
    const width = (bits & 0x3fff) + 1
    const height = ((bits >> 14) & 0x3fff) + 1
    return { width, height }
  }

  return null
}

async function validateOptimizedImage(file: File): Promise<string | null> {
  if (file.size <= 0) return 'Uploaded image is empty.'
  if (file.size > MAX_UPLOAD_BYTES) return 'Uploaded image exceeds the 12 MB limit.'
  if (file.type !== 'image/webp') return 'Images must be optimized to WebP before upload.'
  const header = new Uint8Array(await file.slice(0, 30).arrayBuffer())
  const signature = String.fromCharCode(...header.slice(0, 12))
  if (signature.slice(0, 4) !== 'RIFF' || signature.slice(8, 12) !== 'WEBP') return 'The uploaded file is not a valid WebP image.'
  const dimensions = readWebpDimensions(header)
  if (!dimensions) return 'The uploaded WebP file is malformed or uses an unsupported chunk type.'
  if (dimensions.width <= 0 || dimensions.height <= 0) return 'The uploaded WebP file reports invalid dimensions.'
  if (dimensions.width > MAX_DIMENSION_PX || dimensions.height > MAX_DIMENSION_PX) {
    return `Image dimensions exceed the ${MAX_DIMENSION_PX}px limit (received ${dimensions.width}×${dimensions.height}).`
  }
  return null
}

function objectUrl(baseUrl: string, key: string): string {
  return `${baseUrl.replace(/\/$/, '')}/${key.split('/').map(encodeURIComponent).join('/')}`
}

const unguardedGET: APIRoute = async ({ url }) => {
  const env = getEnv()
  if (!env.MEDIA_BUCKET) return jsonResponse({ error: 'R2 MEDIA_BUCKET binding is not configured.' }, 503)

  const prefix = String(url.searchParams.get('prefix') || '').replace(/^\/+/, '')
  const cursor = url.searchParams.get('cursor') || undefined
  const requestedLimit = Number(url.searchParams.get('limit')) || 250
  const limit = Math.min(Math.max(requestedLimit, 1), 500)
  const publicBaseUrl = String(env.R2_PUBLIC_BASE_URL || '').replace(/\/$/, '')
  const listed = await env.MEDIA_BUCKET.list({
    prefix: prefix || undefined,
    cursor,
    limit,
    include: ['httpMetadata', 'customMetadata'],
  })

  const trackedAssets = env.DB ? await listMediaAssets(env.DB, { limit: 1000 }).catch(() => []) : []
  const trackedByKey = new Map(trackedAssets.map((asset) => [asset.key, asset]))
  const baseAssets = listed.objects.map((object) => {
    const tracked = trackedByKey.get(object.key)
    const contentType = String(object.httpMetadata?.contentType || tracked?.contentType || inferContentType(object.key))
    const folder = object.key.includes('/') ? object.key.slice(0, object.key.lastIndexOf('/')) : 'root'
    const url = publicBaseUrl ? `${publicBaseUrl}/${object.key.split('/').map(encodeURIComponent).join('/')}` : tracked?.url || ''
    return {
      id: tracked?.id || object.key,
      key: object.key,
      url,
      filename: tracked?.filename || filenameFromKey(object.key),
      contentType,
      size: object.size,
      altText: tracked?.altText || '',
      folder,
      uploadedAt: object.uploaded.toISOString(),
      etag: object.httpEtag,
      trackedInD1: Boolean(tracked),
    }
  })

  // The library only ever renders optimized images, and the client used to
  // discard everything else after the fact — which left the summary tiles
  // counting objects that were never displayed. Filtering here instead means
  // the counts and the grid always describe the same set, and reference
  // lookups below are not spent on objects nobody will see.
  const displayableAssets = baseAssets.filter(
    (asset) => asset.size > 0 && asset.contentType.startsWith('image/'),
  )

  let usedByKey = new Map<string, Array<{ type: string; id: string; label: string; isThumbnail: boolean }>>()
  if (env.DB) {
    try {
      usedByKey = await findMediaReferencesForAssets(env.DB, displayableAssets)
    } catch (error) {
      console.error(
        JSON.stringify({
          event: 'media_reference_lookup',
          outcome: 'failure',
          errorMessage: error instanceof Error ? error.message : String(error),
        }),
      )
    }
  }
  const assets = displayableAssets.map((asset) => ({ ...asset, usedBy: usedByKey.get(asset.key) || [] }))

  return jsonResponse({
    assets,
    summary: {
      objectCount: assets.length,
      totalBytes: assets.reduce((total, asset) => total + asset.size, 0),
      trackedCount: assets.filter((asset) => asset.trackedInD1).length,
      imageCount: assets.length,
      prefix,
      // Per-page, not bucket-wide: R2 lists lazily, so "how many images
      // exist in total" isn't knowable without walking every page. The
      // client accumulates its own totals as it pages and uses `cursor` to
      // decide whether more remain.
      isComplete: !listed.truncated,
    },
    cursor: listed.truncated ? listed.cursor : null,
  })
}

const unguardedPOST: APIRoute = async ({ request, locals }) => {
  const env = getEnv()
  if (!env.MEDIA_BUCKET) return jsonResponse({ error: 'R2 MEDIA_BUCKET binding is not configured.' }, 503)
  if (!String(env.R2_PUBLIC_BASE_URL || '').trim()) {
    return jsonResponse({ error: 'R2_PUBLIC_BASE_URL is not configured.' }, 503)
  }
  const limited = await checkMediaWriteLimit(env, request, locals.adminEmail)
  if (limited) return limited

  const formData = await request.formData()
  const file = formData.get('file')
  const folder = String(formData.get('folder') || 'uploads').replace(/[^a-z0-9/_-]/gi, '')

  if (!file || typeof file === 'string') return jsonResponse({ error: 'A file upload is required.' }, 400)
  const validationError = await validateOptimizedImage(file)
  if (validationError) return jsonResponse({ error: validationError }, 400)

  const key = `${folder}/${crypto.randomUUID()}-${file.name.replace(/[^a-z0-9._-]/gi, '-')}`
  await env.MEDIA_BUCKET.put(key, file.stream(), {
    httpMetadata: { contentType: file.type || 'application/octet-stream' },
    customMetadata: { uploadedAt: nowIso() },
  })

  const publicBaseUrl = env.R2_PUBLIC_BASE_URL || ''
  const url = publicBaseUrl ? objectUrl(publicBaseUrl, key) : key

  if (env.DB) {
    try {
      await recordMediaAsset(env.DB, { key, url, filename: file.name, contentType: file.type, size: file.size, folder })
    } catch {
      // The R2 object is already stored — a metadata-tracking failure shouldn't fail the upload itself.
    }
  }

  // Best-effort for the same reason recordMediaAsset above is: the object is
  // already in R2, so the upload has succeeded. Letting an audit-log write
  // fail the response would tell the admin it failed, and the natural retry
  // then uploads a second copy under a fresh UUID key.
  if (env.DB) await recordAuditEvent(env.DB, { actorEmail: locals.adminEmail || null, action: 'create', entityType: 'media', entityId: key, metadata: { summary: `Uploaded media: ${file.name}.`, filename: file.name, contentType: file.type, size: file.size } }).catch(logAuditFailure)

  return jsonResponse({
    key,
    filename: file.name,
    contentType: file.type,
    size: file.size,
    url,
  }, 201)
}

const unguardedPATCH: APIRoute = async ({ request, locals }) => {
  const env = getEnv()
  if (!env.MEDIA_BUCKET) return jsonResponse({ error: 'R2 MEDIA_BUCKET binding is not configured.' }, 503)
  if (!env.DB) return jsonResponse({ error: 'D1 DB binding is not configured.' }, 503)
  const limited = await checkMediaWriteLimit(env, request, locals.adminEmail)
  if (limited) return limited
  const publicBaseUrl = String(env.R2_PUBLIC_BASE_URL || '').trim()
  if (!publicBaseUrl) return jsonResponse({ error: 'R2_PUBLIC_BASE_URL is not configured.' }, 503)

  const formData = await request.formData()
  const oldKey = String(formData.get('oldKey') || '').replace(/^\/+/, '')
  const file = formData.get('file')
  if (!oldKey || !file || typeof file === 'string') return jsonResponse({ error: 'An existing key and replacement image are required.' }, 400)
  if (!isManageableMediaKey(oldKey)) return jsonResponse({ error: 'That media key is not valid.' }, 400)
  const oldObject = await env.MEDIA_BUCKET.head(oldKey)
  if (!oldObject) return jsonResponse({ error: 'Media object not found.' }, 404)
  if (!isManageableMediaObject(oldKey, oldObject)) return jsonResponse({ error: 'Only images in the media library can be replaced.' }, 400)
  const validationError = await validateOptimizedImage(file)
  if (validationError) return jsonResponse({ error: validationError }, 400)

  const folder = oldKey.includes('/') ? oldKey.slice(0, oldKey.lastIndexOf('/')) : 'uploads'
  const nextKey = `${folder}/${crypto.randomUUID()}-${file.name.replace(/[^a-z0-9._-]/gi, '-')}`
  const nextUrl = objectUrl(publicBaseUrl, nextKey)
  const oldUrl = objectUrl(publicBaseUrl, oldKey)
  await env.MEDIA_BUCKET.put(nextKey, file.stream(), { httpMetadata: { contentType: file.type }, customMetadata: { uploadedAt: nowIso(), replaces: oldKey } })

  let referencesUpdated = false
  try {
    const references = await findMediaReferences(env.DB, [oldKey, oldUrl])
    await recordMediaAsset(env.DB, { key: nextKey, url: nextUrl, filename: file.name, contentType: file.type, size: file.size, folder })
    await replaceMediaReferences(env.DB, [oldKey, oldUrl], nextUrl)
    referencesUpdated = true
    await env.MEDIA_BUCKET.delete(oldKey)

    // Point of no return: every reference now resolves to nextUrl and the
    // old object is gone from R2, so the replacement is committed. What
    // follows is bookkeeping only, and must stay best-effort — if it were
    // allowed to throw, the catch below would roll every reference back to
    // an oldUrl that no longer exists (404ing all of them) and then delete
    // nextKey, the sole surviving copy of the image.
    await deleteMediaAsset(env.DB, oldKey).catch(() => undefined)
    await recordAuditEvent(env.DB, { actorEmail: locals.adminEmail || null, action: 'replace', entityType: 'media', entityId: nextKey, metadata: { summary: `Replaced media ${oldKey} with ${file.name}; updated ${references.length} reference${references.length === 1 ? '' : 's'}.`, oldKey, nextKey, referenceCount: references.length } }).catch(logAuditFailure)
    return jsonResponse({ key: nextKey, url: nextUrl, filename: file.name, contentType: file.type, size: file.size, referencesUpdated: references.length })
  } catch (error) {
    if (referencesUpdated) {
      try {
        await replaceMediaReferences(env.DB, [nextKey, nextUrl], oldUrl)
        referencesUpdated = false
      } catch (rollbackError) {
        throw new Error(`Media replacement failed and its D1 references could not be rolled back: ${String(rollbackError)}`, { cause: error })
      }
    }
    await deleteMediaAsset(env.DB, nextKey).catch(() => undefined)
    await env.MEDIA_BUCKET.delete(nextKey).catch(() => undefined)
    throw error
  }
}

const unguardedDELETE: APIRoute = async ({ request, url, locals }) => {
  const env = getEnv()
  if (!env.MEDIA_BUCKET) return jsonResponse({ error: 'R2 MEDIA_BUCKET binding is not configured.' }, 503)
  if (!env.DB) return jsonResponse({ error: 'D1 DB binding is not configured.' }, 503)
  const limited = await checkMediaWriteLimit(env, request, locals.adminEmail)
  if (limited) return limited
  const key = String(url.searchParams.get('key') || '').replace(/^\/+/, '')
  if (!key) return jsonResponse({ error: 'A media key is required.' }, 400)
  if (!isManageableMediaKey(key)) return jsonResponse({ error: 'That media key is not valid.' }, 400)
  const object = await env.MEDIA_BUCKET.head(key)
  if (!object) return jsonResponse({ error: 'Media object not found.' }, 404)
  if (!isManageableMediaObject(key, object)) return jsonResponse({ error: 'Only images in the media library can be deleted.' }, 400)
  const publicBaseUrl = String(env.R2_PUBLIC_BASE_URL || '').trim()
  const publicUrl = publicBaseUrl ? objectUrl(publicBaseUrl, key) : key
  const references = await findMediaReferences(env.DB, [key, publicUrl])
  if (references.length) return jsonResponse({ error: 'This media is still in use. Replace it or remove its references before deleting it.', references }, 409)

  await env.MEDIA_BUCKET.delete(key)
  // Object is gone from R2; the delete has happened and cannot be undone, so
  // neither of these bookkeeping writes may turn it into a reported failure.
  await deleteMediaAsset(env.DB, key).catch(() => undefined)
  await recordAuditEvent(env.DB, { actorEmail: locals.adminEmail || null, action: 'delete', entityType: 'media', entityId: key, metadata: { summary: `Deleted unreferenced media: ${key}.`, key, size: object.size } }).catch(logAuditFailure)
  return jsonResponse({ key })
}

// Authenticated per handler as well as by src/middleware.ts; see src/lib/adminGuard.ts.
export const GET = withAdmin(unguardedGET)
export const POST = withAdmin(unguardedPOST)
export const PATCH = withAdmin(unguardedPATCH)
export const DELETE = withAdmin(unguardedDELETE)
