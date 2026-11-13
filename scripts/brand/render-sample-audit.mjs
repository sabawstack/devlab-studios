/**
 * Renders the sample audit deliverable (CONVERT-05; owner default Q-03):
 * public/samples/workflow-systems-audit-sample.pdf (two pages, synthetic) and
 * its page-one thumbnail src/assets/samples/audit-sample-page-1.webp.
 *   node scripts/brand/render-sample-audit.mjs
 */
import { chromium } from '@playwright/test'
import { mkdirSync, readFileSync, statSync } from 'node:fs'
import sharp from 'sharp'

const font = `data:font/woff2;base64,${readFileSync('public/fonts/space-grotesk-latin-wght.woff2').toString('base64')}`
const html = readFileSync('scripts/brand/sample-audit.html', 'utf8')
  .replace('<style>', `<style>@font-face { font-family: 'Space Grotesk'; src: url(${font}) format('woff2'); font-weight: 300 700; }`)
mkdirSync('public/samples', { recursive: true })
mkdirSync('src/assets/samples', { recursive: true })
const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 794, height: 1123 } })
await page.setContent(html, { waitUntil: 'load' })
await page.evaluate(() => document.fonts.ready)
await page.pdf({ path: 'public/samples/workflow-systems-audit-sample.pdf', format: 'A4', printBackground: true })
await page.evaluate(() => { for (const section of [...document.querySelectorAll('section')].slice(1)) section.style.display = 'none' })
const shot = await page.screenshot({ clip: { x: 0, y: 0, width: 794, height: 1123 } })
await sharp(shot).resize(480).webp({ quality: 80 }).toFile('src/assets/samples/audit-sample-page-1.webp')
await browser.close()
const size = statSync('public/samples/workflow-systems-audit-sample.pdf').size
if (size > 500 * 1024) throw new Error(`PDF is ${size} bytes, over 500 KB`)
console.log(`pdf ${Math.round(size / 1024)} KB, thumbnail ${Math.round(statSync('src/assets/samples/audit-sample-page-1.webp').size / 1024)} KB`)
