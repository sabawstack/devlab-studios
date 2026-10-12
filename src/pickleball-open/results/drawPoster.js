// src/pickleball-open/results/drawPoster.js
// Paints the results poster (posterLayout.js) on a 1080×1350 canvas and hands
// back a PNG blob. Browser only, nothing uploaded: the fonts are the site's,
// the logo is the copy bundled with the site (same origin, so the canvas is
// never tainted), and the QR is drawn module by module from `qrcode`.
import QRCode from 'qrcode'
import logoAsset from '../../assets/devlabstudios-logo-only.png'
import { posterLayout, posterText } from './posterLayout'

const FAMILY = '"Plus Jakarta Sans", Inter, system-ui, sans-serif'
const C = {
  ink: '#0b1426', navy950: '#0b1b34', navy900: '#11214d', navy800: '#152b66', brand: '#4500ff',
  neon: '#c6ff2e', teamb: '#8d9bff', mist: '#b5c4e1', white: '#ffffff', shell: '#f5f5fc', slate: '#3b4566',
  gold: '#f4c542', silver: '#d3dbea', bronze: '#d98b4f',
}
const MEDAL = { 1: C.gold, 2: C.silver, 3: C.bronze }
const STEP_FILL = { 1: C.neon, 2: C.teamb, 3: C.navy800 }
const STEP_TEXT = { 1: C.ink, 2: C.ink, 3: C.white }

const font = ({ size, weight = 700 }) => `${weight} ${size}px ${FAMILY}`

/**
 * The site font in every weight the poster uses, for the poster's own text: the
 * sample makes the browser fetch every subset those characters need (latin-ext,
 * Cyrillic, Vietnamese), not only latin. A failure falls back to system fonts, never blocks.
 */
async function loadFonts(sample) {
  if (typeof document === 'undefined' || !document.fonts) return
  await Promise.allSettled([400, 500, 600, 700].map((weight) => document.fonts.load(font({ size: 32, weight }), sample)))
  await document.fonts.ready
}

function loadImage(src) {
  return new Promise((resolve) => {
    const image = new Image()
    image.onload = () => resolve(image)
    // The credit band still draws its words when the logo cannot load.
    image.onerror = () => resolve(null)
    image.src = src
  })
}

function roundedTop(ctx, x, y, w, h, r) {
  ctx.beginPath()
  ctx.moveTo(x, y + h)
  ctx.lineTo(x, y + r)
  ctx.arcTo(x, y, x + r, y, r)
  ctx.lineTo(x + w - r, y)
  ctx.arcTo(x + w, y, x + w, y + r, r)
  ctx.lineTo(x + w, y + h)
  ctx.closePath()
}

function roundedRect(ctx, x, y, w, h, r) {
  ctx.beginPath()
  ctx.roundRect(x, y, w, h, r)
}

function text(ctx, value, x, y, { size, weight = 700, color = C.white, align = 'left' }) {
  ctx.font = font({ size, weight })
  ctx.fillStyle = color
  ctx.textAlign = align
  ctx.textBaseline = 'alphabetic'
  ctx.fillText(value, x, y)
}

function background(ctx, layout) {
  ctx.fillStyle = C.ink
  ctx.fillRect(0, 0, layout.width, layout.height)
  const glow = ctx.createRadialGradient(layout.width * 0.15, -80, 0, layout.width * 0.15, -80, 900)
  glow.addColorStop(0, 'rgba(69, 0, 255, 0.42)')
  glow.addColorStop(1, 'rgba(69, 0, 255, 0)')
  ctx.fillStyle = glow
  ctx.fillRect(0, 0, layout.width, layout.band.top)
  const spot = ctx.createRadialGradient(layout.width / 2, layout.podiumBase - 120, 0, layout.width / 2, layout.podiumBase - 120, 520)
  spot.addColorStop(0, 'rgba(198, 255, 46, 0.12)')
  spot.addColorStop(1, 'rgba(198, 255, 46, 0)')
  ctx.fillStyle = spot
  ctx.fillRect(0, 0, layout.width, layout.band.top)
}

function header(ctx, { header: h, width }) {
  const cx = width / 2
  for (const line of h.title.lines) text(ctx, line.text, cx, line.y, { size: h.title.size, align: 'center' })
  text(ctx, h.subtitle.text, cx, h.subtitle.y, { size: h.subtitle.size, color: C.neon, align: 'center' })
  for (const line of h.host?.lines ?? []) text(ctx, line.text, cx, line.y, { size: h.host.size, weight: 500, color: C.mist, align: 'center' })
}

function medal(ctx, { cx, cy, r }, place) {
  // Ribbon, then the disc with its number.
  ctx.fillStyle = place === 1 ? C.neon : C.teamb
  ctx.beginPath()
  ctx.moveTo(cx - r * 0.75, cy - r * 1.55)
  ctx.lineTo(cx - r * 0.15, cy - r * 1.55)
  ctx.lineTo(cx + r * 0.25, cy - r * 0.4)
  ctx.lineTo(cx - r * 0.35, cy - r * 0.4)
  ctx.closePath()
  ctx.fill()
  ctx.beginPath()
  ctx.moveTo(cx + r * 0.75, cy - r * 1.55)
  ctx.lineTo(cx + r * 0.15, cy - r * 1.55)
  ctx.lineTo(cx - r * 0.25, cy - r * 0.4)
  ctx.lineTo(cx + r * 0.35, cy - r * 0.4)
  ctx.closePath()
  ctx.fill()
  ctx.beginPath()
  ctx.arc(cx, cy, r, 0, Math.PI * 2)
  ctx.fillStyle = MEDAL[place]
  ctx.fill()
  ctx.lineWidth = Math.max(2, r * 0.12)
  ctx.strokeStyle = 'rgba(11, 20, 38, 0.25)'
  ctx.beginPath()
  ctx.arc(cx, cy, r * 0.78, 0, Math.PI * 2)
  ctx.stroke()
  text(ctx, String(place), cx, cy + r * 0.36, { size: Math.round(r * 1.05), weight: 700, color: C.ink, align: 'center' })
}

function podium(ctx, layout) {
  for (const step of layout.podium) {
    roundedTop(ctx, step.x, step.stepTop, step.width, step.stepHeight, 22)
    ctx.fillStyle = STEP_FILL[step.place]
    ctx.fill()
    if (step.place === 3) {
      ctx.lineWidth = 3
      ctx.strokeStyle = 'rgba(141, 155, 255, 0.6)'
      ctx.stroke()
    }
    const labelSize = Math.max(24, Math.min(46, Math.round(step.stepHeight * 0.36)))
    text(ctx, step.label, step.x + step.width / 2, step.stepTop + step.stepHeight / 2 + labelSize * 0.36, { size: labelSize, color: STEP_TEXT[step.place], align: 'center' })
    medal(ctx, step.medal, step.place)
    for (const entry of step.entries) {
      const cx = entry.x + entry.width / 2
      for (const line of entry.lines) text(ctx, line.text, cx, line.y, { size: step.nameSize, align: 'center' })
      text(ctx, entry.stat, cx, entry.statY, { size: step.statSize, weight: 600, color: C.mist, align: 'center' })
    }
  }
  if (layout.podium.length) {
    ctx.fillStyle = 'rgba(141, 155, 255, 0.35)'
    ctx.fillRect(layout.podium[0].x - 24, layout.podiumBase, layout.podium.at(-1).x + layout.podium.at(-1).width - layout.podium[0].x + 48, 3)
  }
}

function rest(ctx, layout) {
  for (const row of layout.rest.rows) {
    roundedRect(ctx, row.x, row.y, row.width, row.height, 16)
    ctx.fillStyle = 'rgba(17, 33, 77, 0.85)'
    ctx.fill()
    const mid = row.y + row.height / 2
    text(ctx, row.place, row.x + 40, mid + 10, { size: 28, color: C.neon, align: 'center' })
    const lineHeight = row.name.size * 1.16
    const top = mid - (lineHeight * row.name.lines.length) / 2
    row.name.lines.forEach((line, i) => text(ctx, line, row.name.x, top + lineHeight * i + row.name.size * 0.86, { size: row.name.size }))
    text(ctx, row.stat, row.x + row.width - 22, mid + 8, { size: row.statSize, weight: 600, color: C.mist, align: 'right' })
  }
  if (layout.rest.more) text(ctx, layout.rest.more.text, layout.width / 2, layout.rest.more.y, { size: layout.rest.more.size, weight: 600, color: C.mist, align: 'center' })
}

function qr(ctx, url, { x, y, size }) {
  const { modules } = QRCode.create(url, { errorCorrectionLevel: 'M' })
  const quiet = 2
  const cell = size / (modules.size + quiet * 2)
  roundedRect(ctx, x, y, size, size, 12)
  ctx.fillStyle = C.white
  ctx.fill()
  ctx.fillStyle = C.ink
  for (let row = 0; row < modules.size; row += 1) {
    for (let col = 0; col < modules.size; col += 1) {
      if (modules.get(row, col)) ctx.fillRect(x + (col + quiet) * cell, y + (row + quiet) * cell, Math.ceil(cell), Math.ceil(cell))
    }
  }
}

function band(ctx, layout, logo, qrUrl) {
  const { top, logo: box, text: words, qr: code, caption } = layout.band
  ctx.fillStyle = C.shell
  ctx.fillRect(0, top, layout.width, layout.height - top)
  ctx.fillStyle = C.neon
  ctx.fillRect(0, top, layout.width, 8)
  let textX = box.x
  if (logo) {
    const width = (logo.naturalWidth / logo.naturalHeight) * box.height
    ctx.drawImage(logo, box.x, box.y, width, box.height)
    textX = box.x + width + 30
  }
  const [made, free, site] = words.lines
  text(ctx, made, textX, top + 92, { size: 38, color: C.ink })
  text(ctx, free, textX, top + 136, { size: 27, weight: 500, color: C.slate })
  text(ctx, site, textX, top + 178, { size: 27, color: C.brand })
  ctx.strokeStyle = 'rgba(11, 20, 38, 0.12)'
  ctx.lineWidth = 2
  roundedRect(ctx, code.x - 1, code.y - 1, code.size + 2, code.size + 2, 13)
  ctx.stroke()
  qr(ctx, qrUrl, code)
  text(ctx, caption.text, caption.x, caption.y, { size: 18, weight: 600, color: C.slate, align: 'center' })
}

/** The page's CSP allows data: images (not blob:), so the preview and the download use a data URL. */
function dataUrlOf(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result))
    reader.onerror = () => reject(new Error('Could not make the poster image.'))
    reader.readAsDataURL(blob)
  })
}

/**
 * Draws the poster: the PNG (for sharing as a file) and the same PNG as a data URL (preview and download).
 * @param {{ model: ReturnType<typeof import('./posterLayout').posterModel>, qrUrl: string }} input
 * @returns {Promise<{ blob: Blob, dataUrl: string }>}
 */
export async function drawPoster({ model, qrUrl }) {
  const [, logo] = await Promise.all([loadFonts(posterText(model)), loadImage(logoAsset.src ?? logoAsset)])
  const canvas = document.createElement('canvas')
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('This browser cannot draw the poster.')
  const measure = (value, spec) => {
    ctx.font = font(spec)
    return ctx.measureText(value).width
  }
  const layout = posterLayout(model, measure)
  canvas.width = layout.width
  canvas.height = layout.height
  background(ctx, layout)
  header(ctx, layout)
  if (layout.empty) text(ctx, layout.empty.text, layout.width / 2, layout.empty.y, { size: 32, weight: 500, color: C.mist, align: 'center' })
  podium(ctx, layout)
  rest(ctx, layout)
  text(ctx, layout.summary.text, layout.width / 2, layout.summary.y, { size: layout.summary.size, weight: 600, color: C.mist, align: 'center' })
  band(ctx, layout, logo, qrUrl)
  const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'))
  if (!blob) throw new Error('Could not make the poster image.')
  return { blob, dataUrl: await dataUrlOf(blob) }
}
