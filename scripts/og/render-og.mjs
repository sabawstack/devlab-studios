#!/usr/bin/env node
/**
 * Renders the social cards in public/og/ (audit SEO-02 / WEB-08): one 1200x630
 * PNG per business page, in the brand's paper/ink system with the self-hosted
 * fonts, each well under the 200 KB budget. Also writes public/og.png (the
 * site default) from the home card.
 *
 * Run after changing a page's title or adding a page:
 *   node scripts/og/render-og.mjs
 * The cards are committed; nothing renders at request time.
 */
import { chromium } from 'playwright'
import { readFileSync, mkdirSync, copyFileSync, statSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const font = (file) => `data:font/woff2;base64,${readFileSync(resolve(root, 'public/fonts', file)).toString('base64')}`
const BUDGET_BYTES = 200 * 1024

export const CARDS = [
  { name: 'home', eyebrow: 'Operations software', title: 'We build and run the systems behind your inquiries, handoffs and reports.' },
  { name: 'solutions', eyebrow: 'Solutions', title: 'Operational software, built to be run.' },
  { name: 'lead-intake-and-follow-up', eyebrow: 'Service line', title: 'Lead intake and follow-up' },
  { name: 'workflow-and-ai-automation', eyebrow: 'Service line', title: 'Workflow and AI automation' },
  { name: 'custom-software-and-operations', eyebrow: 'Service line', title: 'Custom software and operations systems' },
  { name: 'workflow-systems-audit', eyebrow: 'Start here', title: 'Workflow Systems Audit' },
  { name: 'work', eyebrow: 'Work', title: 'Real systems, honestly described.' },
  { name: 'insights', eyebrow: 'Insights', title: 'Notes on the problems behind operations work.' },
  { name: 'about', eyebrow: 'About', title: 'A small studio that builds operational software properly.' },
  { name: 'profile', eyebrow: 'Founder profile', title: 'Stephen Rey Agustinez' },
  { name: 'contact', eyebrow: 'Contact', title: 'Tell us about the system you need.' },
  { name: 'products', eyebrow: 'Products', title: 'What we build and run ourselves.' },
]

const escape = (value) => value.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c])

function html(card) {
  return `<!doctype html><html><head><meta charset="utf-8"><style>
@font-face { font-family: 'Bricolage Grotesque'; src: url(${font('bricolage-grotesque-latin-opsz.woff2')}) format('woff2'); font-weight: 200 800; }
@font-face { font-family: 'Martian Mono'; src: url(${font('martian-mono-latin-wght.woff2')}) format('woff2'); font-weight: 100 800; }
* { margin: 0; box-sizing: border-box; }
body { width: 1200px; height: 630px; background: #f6f3ec; color: #14130f; font-family: 'Bricolage Grotesque'; display: flex; flex-direction: column; }
main { flex: 1; padding: 72px 80px 0; border-bottom: 1px solid #d5d0c4; }
.label { font-family: 'Martian Mono'; font-size: 22px; letter-spacing: 0.08em; text-transform: uppercase; color: #65615a; }
h1 { margin-top: 28px; font-size: ${card.title.length > 48 ? 64 : 80}px; line-height: 1.05; letter-spacing: -0.02em; font-weight: 650; font-variation-settings: 'opsz' 96; max-width: 1000px; }
footer { height: 112px; background: #14130f; color: #f6f3ec; display: flex; align-items: center; justify-content: space-between; padding: 0 80px; }
footer strong { font-size: 30px; font-weight: 600; }
footer span { font-family: 'Martian Mono'; font-size: 20px; letter-spacing: 0.06em; color: #a6a092; }
.mark { position: absolute; right: 80px; top: 72px; width: 14px; height: 14px; border-radius: 50%; background: #c8331b; }
</style></head><body><div class="mark"></div><main><p class="label">${escape(card.eyebrow)}</p><h1>${escape(card.title)}</h1></main>
<footer><strong>DevLab Studios</strong><span>devlabstudios.com</span></footer></body></html>`
}

const outDir = resolve(root, 'public/og')
mkdirSync(outDir, { recursive: true })
const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1200, height: 630 } })
for (const card of CARDS) {
  await page.setContent(html(card), { waitUntil: 'load' })
  await page.evaluate(() => document.fonts.ready)
  const file = resolve(outDir, `${card.name}.png`)
  await page.screenshot({ path: file })
  const size = statSync(file).size
  if (size > BUDGET_BYTES) throw new Error(`${card.name}.png is ${size} bytes, over the ${BUDGET_BYTES} budget`)
  console.log(`${card.name}.png ${Math.round(size / 1024)} KB`)
}
await browser.close()
copyFileSync(resolve(outDir, 'home.png'), resolve(root, 'public/og.png'))
console.log('og.png <- og/home.png')
