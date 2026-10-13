/**
 * Reading a DMARC aggregate report.
 *
 * WHY THIS EXISTS. The reports arrived and were stored, and that was all. To
 * learn whether anyone was forging our domain you had to download a zip, unzip
 * it, and read XML — which means nobody would, and a folder quietly accumulated
 * evidence that nothing acted on. A report only has value if it is read.
 *
 * WHAT IS WORTH READING IN ONE. Almost nothing, most days: every row says our
 * own IP passed. The single question that matters is whether a source appears
 * that should not, or a row that did not pass — which is why the parsed shape
 * below keeps per-source rows rather than only totals.
 *
 * NO XML LIBRARY, AND NO DOMParser. Workers has no DOMParser, and a general XML
 * parser is a large dependency and a large attack surface for input a stranger
 * can send us. DMARC's schema is small, flat, and fixed by RFC 7489, so this
 * reads the handful of elements it defines and ignores everything else. Text is
 * never evaluated, only extracted — the same posture as sanitizeHtml.js.
 */

/** Anything larger is not a report; it is someone testing our memory limits. */
const MAX_DECOMPRESSED_BYTES = 8 * 1024 * 1024

/** A report with more sources than this is truncated rather than stored whole. */
const MAX_RECORDS = 500

/**
 * Whether an attachment looks like an aggregate report we can read.
 *
 * Reports arrive as `.zip` (Google, Microsoft), `.gz` (many others), or bare
 * `.xml`. The content type is unreliable — plenty of senders label a zip
 * `application/octet-stream` — so the filename is consulted too.
 *
 * @param {{ filename?: string|null, contentType?: string|null }} attachment
 */
export function looksLikeDmarcReport(attachment) {
  const name = String(attachment?.filename ?? '').toLowerCase()
  const type = String(attachment?.contentType ?? '').toLowerCase()

  return (
    name.endsWith('.zip') ||
    name.endsWith('.gz') ||
    name.endsWith('.xml') ||
    type.includes('zip') ||
    type.includes('gzip') ||
    type.includes('xml')
  )
}

/**
 * Reads the single entry out of a ZIP.
 *
 * Deliberately minimal: DMARC reports are one file per archive, stored or
 * deflated, and nothing here needs to handle spanning, encryption or
 * directories. The CENTRAL DIRECTORY is read rather than the local header
 * because when a writer sets the data-descriptor flag the local header carries
 * zeroes for both sizes, and reading those as truth yields an empty file.
 *
 * @param {Uint8Array} bytes
 * @returns {Promise<Uint8Array>}
 */
async function unzipSingleEntry(bytes) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)

  // End of central directory: fixed 22-byte record, scanned backwards because
  // it may be followed by a variable-length comment.
  let eocd = -1
  for (let index = bytes.length - 22; index >= 0; index -= 1) {
    if (view.getUint32(index, true) === 0x06054b50) {
      eocd = index
      break
    }
  }
  if (eocd === -1) throw new Error('Not a ZIP archive: no end-of-central-directory record.')

  const centralOffset = view.getUint32(eocd + 16, true)
  if (view.getUint32(centralOffset, true) !== 0x02014b50) {
    throw new Error('ZIP central directory is malformed.')
  }

  const method = view.getUint16(centralOffset + 10, true)
  const compressedSize = view.getUint32(centralOffset + 20, true)
  const uncompressedSize = view.getUint32(centralOffset + 24, true)
  const nameLength = view.getUint16(centralOffset + 28, true)
  const extraLength = view.getUint16(centralOffset + 30, true)
  const commentLength = view.getUint16(centralOffset + 32, true)
  const localOffset = view.getUint32(centralOffset + 42, true)

  void nameLength
  void extraLength
  void commentLength

  if (uncompressedSize > MAX_DECOMPRESSED_BYTES) {
    throw new Error('That report expands to more than we will read.')
  }

  // The local header's own name/extra lengths decide where the data starts;
  // they are permitted to differ from the central directory's.
  if (view.getUint32(localOffset, true) !== 0x04034b50) {
    throw new Error('ZIP local header is malformed.')
  }
  const localNameLength = view.getUint16(localOffset + 26, true)
  const localExtraLength = view.getUint16(localOffset + 28, true)
  const dataStart = localOffset + 30 + localNameLength + localExtraLength
  const data = bytes.subarray(dataStart, dataStart + compressedSize)

  if (method === 0) return data
  if (method !== 8) throw new Error(`Unsupported ZIP compression method ${method}.`)

  return inflate(data, 'deflate-raw')
}

/**
 * @param {Uint8Array} bytes
 * @param {'gzip'|'deflate-raw'} format
 * @returns {Promise<Uint8Array>}
 */
export async function inflate(bytes, format, maxBytes = MAX_DECOMPRESSED_BYTES) {
  // STREAMED, with the ceiling enforced per chunk. Buffering the whole output
  // first and checking its size afterwards (the previous shape) let a few KB
  // of compressed input expand to gigabytes in memory before the check ran —
  // a decompression bomb only needs the check to come late. The declared ZIP
  // size is attacker-chosen too, so it cannot be the only guard.
  const reader = new Blob([bytes]).stream().pipeThrough(new DecompressionStream(format)).getReader()
  const chunks = []
  let total = 0

  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      if (!value) continue
      total += value.byteLength
      if (total > maxBytes) {
        throw new Error('That report expands to more than we will read.')
      }
      chunks.push(value)
    }
  } finally {
    // Stops the decompressor rather than letting it run on into the bomb.
    await reader.cancel().catch(() => {})
  }

  const out = new Uint8Array(total)
  let offset = 0
  for (const chunk of chunks) {
    out.set(chunk, offset)
    offset += chunk.byteLength
  }
  return out
}

/**
 * Turns a stored attachment into the report XML.
 *
 * @param {Uint8Array} bytes
 * @param {{ filename?: string|null, contentType?: string|null }} attachment
 * @returns {Promise<string>}
 */
export async function decompressReport(bytes, attachment = {}) {
  const name = String(attachment.filename ?? '').toLowerCase()
  const input = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes)

  // Sniffed from the magic bytes rather than trusted from the filename: a
  // report named `.xml` that is really a gzip is common enough, and the two
  // signatures are unambiguous.
  const isZip = input[0] === 0x50 && input[1] === 0x4b
  const isGzip = input[0] === 0x1f && input[1] === 0x8b

  const xml = isZip
    ? await unzipSingleEntry(input)
    : isGzip
      ? await inflate(input, 'gzip')
      : name.endsWith('.gz')
        ? await inflate(input, 'gzip')
        : input

  return new TextDecoder().decode(xml)
}

/**
 * First value of `<tag>` inside `scope`, with entities resolved.
 *
 * @param {string} scope
 * @param {string} tag
 */
function tagValue(scope, tag) {
  const match = new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)</${tag}>`, 'i').exec(scope)
  if (!match) return null

  return match[1]
    .trim()
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&')
}

/** @param {string} scope @param {string} tag */
function tagNumber(scope, tag) {
  const raw = tagValue(scope, tag)
  if (raw === null) return null
  const value = Number.parseInt(raw, 10)
  return Number.isFinite(value) ? value : null
}

/** Unix seconds to ISO, or null. @param {number|null} seconds */
function isoFrom(seconds) {
  if (seconds === null || !Number.isFinite(seconds)) return null
  return new Date(seconds * 1000).toISOString()
}

/**
 * Parses an aggregate report into the shape the UI and the repository use.
 *
 * Throws only when the document is not a report at all. A report missing
 * optional elements yields nulls rather than an exception — receivers differ in
 * what they include, and refusing a slightly sparse report would mean losing
 * the one that finally shows a problem.
 *
 * @param {string} xml
 */
export function parseDmarcReport(xml) {
  const source = String(xml ?? '')
  if (!/<feedback\b/i.test(source)) {
    throw new Error('That file is not a DMARC aggregate report.')
  }

  const metadata = /<report_metadata\b[^>]*>([\s\S]*?)<\/report_metadata>/i.exec(source)?.[1] ?? ''
  const policy = /<policy_published\b[^>]*>([\s\S]*?)<\/policy_published>/i.exec(source)?.[1] ?? ''
  const range = /<date_range\b[^>]*>([\s\S]*?)<\/date_range>/i.exec(metadata)?.[1] ?? ''

  const records = []
  const pattern = /<record\b[^>]*>([\s\S]*?)<\/record>/gi
  let match = pattern.exec(source)
  while (match && records.length < MAX_RECORDS) {
    const record = match[1]
    const row = /<row\b[^>]*>([\s\S]*?)<\/row>/i.exec(record)?.[1] ?? record
    const evaluated = /<policy_evaluated\b[^>]*>([\s\S]*?)<\/policy_evaluated>/i.exec(row)?.[1] ?? ''
    const identifiers = /<identifiers\b[^>]*>([\s\S]*?)<\/identifiers>/i.exec(record)?.[1] ?? ''
    const auth = /<auth_results\b[^>]*>([\s\S]*?)<\/auth_results>/i.exec(record)?.[1] ?? ''
    const dkim = /<dkim\b[^>]*>([\s\S]*?)<\/dkim>/i.exec(auth)?.[1] ?? ''
    const spf = /<spf\b[^>]*>([\s\S]*?)<\/spf>/i.exec(auth)?.[1] ?? ''

    records.push({
      sourceIp: tagValue(row, 'source_ip'),
      count: tagNumber(row, 'count') ?? 0,
      disposition: tagValue(evaluated, 'disposition'),
      // These are the ALIGNMENT results, which is what DMARC actually judges —
      // not the raw DKIM/SPF results in auth_results. A message can carry a
      // valid signature for another domain and fail here, and that gap is the
      // whole point of the mechanism.
      dkim: tagValue(evaluated, 'dkim'),
      spf: tagValue(evaluated, 'spf'),
      headerFrom: tagValue(identifiers, 'header_from'),
      dkimDomain: tagValue(dkim, 'domain'),
      dkimSelector: tagValue(dkim, 'selector'),
      spfDomain: tagValue(spf, 'domain'),
    })

    match = pattern.exec(source)
  }

  const passed = records.filter((record) => record.dkim === 'pass' || record.spf === 'pass')
  const messages = records.reduce((sum, record) => sum + record.count, 0)
  const passingMessages = passed.reduce((sum, record) => sum + record.count, 0)

  return {
    org: tagValue(metadata, 'org_name'),
    orgEmail: tagValue(metadata, 'email'),
    reportId: tagValue(metadata, 'report_id'),
    begin: isoFrom(tagNumber(range, 'begin')),
    end: isoFrom(tagNumber(range, 'end')),
    domain: tagValue(policy, 'domain'),
    policy: {
      p: tagValue(policy, 'p'),
      sp: tagValue(policy, 'sp'),
      adkim: tagValue(policy, 'adkim'),
      aspf: tagValue(policy, 'aspf'),
      pct: tagNumber(policy, 'pct'),
    },
    messages,
    passingMessages,
    // The number worth alerting on. DMARC passes if EITHER mechanism aligns,
    // so a failure here means neither did — someone sent mail as us, or one of
    // our own paths is misconfigured.
    failingMessages: messages - passingMessages,
    records,
  }
}
