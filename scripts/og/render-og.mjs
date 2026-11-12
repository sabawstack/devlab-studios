#!/usr/bin/env node
/**
 * Renders the social cards in public/og/ (audit SEO-02 / WEB-08): one 1200x630
 * PNG per business page, in the Blueprint palette (ADR 0014: navy canvas and
 * grid, the logo mark, a gradient rule) with the self-hosted fonts, each well
 * under the 200 KB budget. Also writes public/og.png (the
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
const logo = `data:image/svg+xml;base64,${readFileSync(resolve(root, 'public/branding/logo-only.svg')).toString('base64')}`
const font = (file) => `data:font/woff2;base64,${readFileSync(resolve(root, 'public/fonts', file)).toString('base64')}`
const BUDGET_BYTES = 200 * 1024

export const CARDS = [
  { name: 'home', eyebrow: 'Systems architecture', title: "Systems that don't silently fail." },
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

// Values mirror src/styles/brand.css (Blueprint tokens); the card renders outside the site, so they are literal here.
function html(card) {
  return `<!doctype html><html><head><meta charset="utf-8"><style>
@font-face { font-family: 'Space Grotesk'; src: url(${font('space-grotesk-latin-wght.woff2')}) format('woff2'); font-weight: 300 700; }
@font-face { font-family: 'JetBrains Mono'; src: url(${font('jetbrains-mono-latin-wght.woff2')}) format('woff2'); font-weight: 100 800; }
* { margin: 0; box-sizing: border-box; }
body { position: relative; width: 1200px; height: 630px; color: #f8fafc; font-family: 'Space Grotesk'; display: flex; flex-direction: column;
  background-color: #050b14;
  background-image: linear-gradient(rgba(148, 163, 184, 0.08) 1px, transparent 1px), linear-gradient(90deg, rgba(148, 163, 184, 0.08) 1px, transparent 1px);
  background-size: 32px 32px; }
main { flex: 1; padding: 72px 80px 0; }
.label { font-family: 'JetBrains Mono'; font-size: 22px; letter-spacing: 0.12em; text-transform: uppercase; color: #94a3b8; }
h1 { margin-top: 28px; font-size: ${card.title.length > 48 ? 64 : 84}px; line-height: 1.05; letter-spacing: -0.03em; font-weight: 600; max-width: 980px; }
.rule { height: 4px; background: linear-gradient(90deg, #e100ff 0%, #7b2cbf 50%, #0048ba 100%); }
footer { height: 108px; background: #0f172a; display: flex; align-items: center; justify-content: space-between; padding: 0 80px; }
footer strong { display: flex; align-items: center; gap: 16px; font-size: 30px; font-weight: 600; }
footer img { width: 44px; height: 44px; }
footer span { font-family: 'JetBrains Mono'; font-size: 20px; letter-spacing: 0.08em; color: #94a3b8; }
.mark { position: absolute; right: 80px; top: 64px; width: 72px; height: 72px; }
</style></head><body><img class="mark" src="${logo}" alt=""><main><p class="label">[ ${escape(card.eyebrow)} ]</p><h1>${escape(card.title)}</h1></main>
<div class="rule"></div><footer><strong><img src="${logo}" alt="">DevLab Studios</strong><span>devlabstudios.com</span></footer></body></html>`
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
