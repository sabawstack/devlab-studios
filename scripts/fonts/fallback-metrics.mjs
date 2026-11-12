/**
 * Computes `@font-face` fallback overrides (size-adjust, ascent-override,
 * descent-override, line-gap-override) for the self-hosted brand fonts, so a
 * local fallback occupies the same space and the swap causes no layout shift
 * (audit UX-01: CLS <= 0.05 on font load).
 *
 * Reads the real metrics from each WOFF2 file: WOFF2 stores 'head', 'hhea' and
 * 'OS/2' untransformed inside one Brotli stream, so they can be sliced out
 * without a font library. The method is the one capsize/fontaine use:
 * size-adjust from the average character width relative to the fallback.
 *
 *   node scripts/fonts/fallback-metrics.mjs
 *
 * Paste the printed values into src/styles/brand.css when a font file changes.
 */
import { readFileSync } from 'node:fs'
import { brotliDecompressSync } from 'node:zlib'

// Arial's metrics (unitsPerEm 2048): the fallback every target platform has.
const ARIAL = { unitsPerEm: 2048, xAvgCharWidth: 904 }
const COURIER_NEW = { unitsPerEm: 2048, xAvgCharWidth: 1229 }
const TIMES_NEW_ROMAN = { unitsPerEm: 2048, xAvgCharWidth: 821 }

const KNOWN_TAGS = ['cmap', 'head', 'hhea', 'hmtx', 'maxp', 'name', 'OS/2', 'post', 'cvt ', 'fpgm', 'glyf', 'loca', 'prep', 'CFF ', 'VORG', 'EBDT', 'EBLC', 'gasp', 'hdmx', 'kern', 'LTSH', 'PCLT', 'VDMX', 'vhea', 'vmtx', 'BASE', 'GDEF', 'GPOS', 'GSUB', 'EBSC', 'JSTF', 'MATH', 'CBDT', 'CBLC', 'COLR', 'CPAL', 'SVG ', 'sbix', 'acnt', 'avar', 'bdat', 'bloc', 'bsln', 'cvar', 'fdsc', 'feat', 'fmtx', 'fvar', 'gvar', 'hsty', 'just', 'lcar', 'mort', 'morx', 'opbd', 'prop', 'trak', 'Zapf', 'Silf', 'Glat', 'Gloc', 'Feat', 'Sill']

function readBase128(buffer, offset) {
  let value = 0
  for (let i = 0; i < 5; i += 1) {
    const byte = buffer[offset + i]
    value = (value << 7) | (byte & 0x7f)
    if ((byte & 0x80) === 0) return { value, next: offset + i + 1 }
  }
  throw new Error('Bad UIntBase128')
}

function woff2Tables(file) {
  const buffer = readFileSync(file)
  if (buffer.toString('ascii', 0, 4) !== 'wOF2') throw new Error(`${file} is not WOFF2`)
  const numTables = buffer.readUInt16BE(12)
  const totalCompressedSize = buffer.readUInt32BE(20)
  let offset = 48
  const tables = []
  for (let i = 0; i < numTables; i += 1) {
    const flags = buffer[offset]
    offset += 1
    const tagIndex = flags & 0x3f
    let tag
    if (tagIndex === 63) {
      tag = buffer.toString('ascii', offset, offset + 4)
      offset += 4
    } else {
      tag = KNOWN_TAGS[tagIndex]
    }
    const transform = (flags >> 6) & 0x03
    const orig = readBase128(buffer, offset)
    offset = orig.next
    let length = orig.value
    const transformed = (tag === 'glyf' || tag === 'loca') ? transform === 0 : transform !== 0
    if (transformed) {
      const t = readBase128(buffer, offset)
      offset = t.next
      length = t.value
    }
    tables.push({ tag, length })
  }
  const data = brotliDecompressSync(buffer.subarray(offset, offset + totalCompressedSize))
  const byTag = {}
  let cursor = 0
  for (const table of tables) {
    byTag[table.tag] = data.subarray(cursor, cursor + table.length)
    cursor += table.length
  }
  return byTag
}

function metrics(file) {
  const t = woff2Tables(file)
  const unitsPerEm = t.head.readUInt16BE(18)
  const os2 = t['OS/2']
  const xAvgCharWidth = os2.readInt16BE(2)
  const useTypo = (os2.readUInt16BE(62) & (1 << 7)) !== 0
  const ascent = useTypo ? os2.readInt16BE(68) : t.hhea.readInt16BE(4)
  const descent = useTypo ? os2.readInt16BE(70) : t.hhea.readInt16BE(6)
  const lineGap = useTypo ? os2.readInt16BE(72) : t.hhea.readInt16BE(8)
  return { unitsPerEm, xAvgCharWidth, ascent, descent: Math.abs(descent), lineGap }
}

function overrides(font, fallback) {
  const sizeAdjust = (font.xAvgCharWidth / font.unitsPerEm) / (fallback.xAvgCharWidth / fallback.unitsPerEm)
  const pct = (value) => `${((value / font.unitsPerEm / sizeAdjust) * 100).toFixed(2)}%`
  return {
    'size-adjust': `${(sizeAdjust * 100).toFixed(2)}%`,
    'ascent-override': pct(font.ascent),
    'descent-override': pct(font.descent),
    'line-gap-override': pct(font.lineGap),
  }
}

for (const [label, file, fallback] of [
  ['Bricolage Grotesque vs Arial', 'public/fonts/bricolage-grotesque-latin-opsz.woff2', ARIAL],
  ['Martian Mono vs Courier New', 'public/fonts/martian-mono-latin-wght.woff2', COURIER_NEW],
  ['Newsreader vs Times New Roman', 'public/fonts/newsreader-latin-wght.woff2', TIMES_NEW_ROMAN],
]) {
  const font = metrics(file)
  console.log(label, JSON.stringify(font))
  console.log('  ', JSON.stringify(overrides(font, fallback)))
}
