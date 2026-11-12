import sharp from 'sharp'
import { mkdirSync, writeFileSync } from 'fs'

const SOURCE = 'src/assets/devlabstudios-logo-only.png'
const BACKGROUND = '#050b14' // Blueprint --bg-studio (ADR 0014)
const CANVAS_SIZE = 1024
const MARK_SCALE = 0.62 // fraction of canvas the logo mark occupies, leaving safe padding for icon masking

const OUTPUTS = [
  { file: 'public/apple-touch-icon.png', size: 180 },
  { file: 'public/icon-192.png', size: 192 },
  { file: 'public/icon-512.png', size: 512 },
]

mkdirSync('public', { recursive: true })

const markSize = Math.round(CANVAS_SIZE * MARK_SCALE)
const mark = await sharp(SOURCE).resize(markSize, markSize, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } }).toBuffer()

const canvas = sharp({
  create: {
    width: CANVAS_SIZE,
    height: CANVAS_SIZE,
    channels: 4,
    background: BACKGROUND,
  },
}).composite([{ input: mark, gravity: 'center' }])

const master = await canvas.png().toBuffer()

for (const { file, size } of OUTPUTS) {
  await sharp(master).resize(size, size).png().toFile(file)
  console.log(`wrote ${file} (${size}x${size})`)
}

/**
 * favicon.ico, assembled by hand because sharp has no ICO encoder.
 *
 * WHY AN .ICO AT ALL, when every page carries a `<link rel="icon">` pointing at
 * a PNG: browsers request /favicon.ico on their own whenever the link is
 * missing or has not been parsed yet, and so do bookmark managers, feed
 * readers and link unfurlers that never run the page. Ours answered 404.
 *
 * WHY NOT JUST COPY THE PNG TO favicon.ico: public/_headers sets
 * `X-Content-Type-Options: nosniff` on every route. The file would be served as
 * image/vnd.microsoft.icon from its extension, and nosniff forbids the browser
 * from correcting that by inspecting the bytes — so it would be rejected rather
 * than rendered. The container has to be genuine.
 *
 * The entries hold PNG data rather than BMP. ICO has permitted that since
 * Windows Vista and every browser in use understands it; it keeps the file
 * small and avoids hand-rolling a DIB with its upside-down rows and AND mask.
 */
const ICO_SIZES = [16, 32, 48]

const icoImages = await Promise.all(
  ICO_SIZES.map(async (size) => ({ size, data: await sharp(master).resize(size, size).png().toBuffer() })),
)

const ICONDIR_BYTES = 6
const ICONDIRENTRY_BYTES = 16

const header = Buffer.alloc(ICONDIR_BYTES)
header.writeUInt16LE(0, 0) // reserved
header.writeUInt16LE(1, 2) // 1 = icon (2 would be a cursor)
header.writeUInt16LE(icoImages.length, 4)

let offset = ICONDIR_BYTES + ICONDIRENTRY_BYTES * icoImages.length

const directory = icoImages.map(({ size, data }) => {
  const entry = Buffer.alloc(ICONDIRENTRY_BYTES)
  // 0 means 256 in this field; none of our sizes reach it, but the modulo
  // documents the rule rather than leaving it to be rediscovered.
  entry.writeUInt8(size % 256, 0)
  entry.writeUInt8(size % 256, 1)
  entry.writeUInt8(0, 2) // palette size, 0 for truecolour
  entry.writeUInt8(0, 3) // reserved
  entry.writeUInt16LE(1, 4) // colour planes
  entry.writeUInt16LE(32, 6) // bits per pixel
  entry.writeUInt32LE(data.length, 8)
  entry.writeUInt32LE(offset, 12)
  offset += data.length
  return entry
})

const ico = Buffer.concat([header, ...directory, ...icoImages.map((image) => image.data)])
writeFileSync('public/favicon.ico', ico)
console.log(`wrote public/favicon.ico (${ICO_SIZES.join(', ')} px, ${ico.length} bytes)`)
