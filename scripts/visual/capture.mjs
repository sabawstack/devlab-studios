/**
 * Captures full-page screenshots of the canonical public routes at the three
 * review viewports (audit TEST-04 / BR.15): 390x844, 820x1180, 1440x900.
 *
 * Used for the pre-rebuild baseline of production and for every page PR
 * against the preview URL, so "before" and "after" are taken the same way.
 *
 *   node scripts/visual/capture.mjs <baseUrl> <outDir> [--reduced-motion]
 *
 * JPEG at quality 70 keeps a full set to a few MB. Motion is settled by
 * scrolling to the bottom and back before the capture, so scroll-reveal
 * content is visible.
 */
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { chromium } from '@playwright/test'

const [baseUrl, outDir, ...flags] = process.argv.slice(2)
if (!baseUrl || !outDir) {
  console.error('Usage: node scripts/visual/capture.mjs <baseUrl> <outDir> [--reduced-motion]')
  process.exit(1)
}

export const VIEWPORTS = [
  { name: 'phone', width: 390, height: 844 },
  { name: 'tablet', width: 820, height: 1180 },
  { name: 'desktop', width: 1440, height: 900 },
]

// Canonical business routes plus one representative of each template.
export const ROUTES = [
  '/',
  '/solutions',
  '/work',
  '/insights',
  '/insights/lead-intake-automation-checklist',
  '/about',
  '/process',
  '/contact',
  '/profile',
  '/offers/lead-intake-checklist',
  '/pickleball',
  '/privacy',
]

const reducedMotion = flags.includes('--reduced-motion') ? 'reduce' : 'no-preference'
mkdirSync(outDir, { recursive: true })

const browser = await chromium.launch()
const failures = []
try {
  for (const viewport of VIEWPORTS) {
    const context = await browser.newContext({
      viewport: { width: viewport.width, height: viewport.height },
      reducedMotion,
      userAgent: 'devlab-visual-capture/1.0',
    })
    const page = await context.newPage()
    for (const route of ROUTES) {
      const file = join(outDir, `${route === '/' ? 'home' : route.slice(1).replace(/\//g, '__')}.${viewport.name}.jpg`)
      try {
        const response = await page.goto(new URL(route, baseUrl).toString(), { waitUntil: 'load', timeout: 60_000 })
        if (!response || response.status() >= 400) throw new Error(`HTTP ${response?.status()}`)
        await page.evaluate(async () => {
          for (let y = 0; y < document.body.scrollHeight; y += window.innerHeight / 2) {
            window.scrollTo(0, y)
            await new Promise((resolve) => setTimeout(resolve, 120))
          }
          window.scrollTo(0, 0)
        })
        await page.waitForTimeout(800)
        await page.screenshot({ path: file, fullPage: true, type: 'jpeg', quality: 70 })
        console.log(`ok   ${viewport.name.padEnd(7)} ${route}`)
      } catch (error) {
        failures.push(`${viewport.name} ${route}: ${error.message}`)
        console.error(`FAIL ${viewport.name.padEnd(7)} ${route}: ${error.message}`)
      }
    }
    await context.close()
  }
} finally {
  await browser.close()
}
if (failures.length) process.exit(1)
