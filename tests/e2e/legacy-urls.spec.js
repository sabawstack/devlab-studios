import { test, expect } from '@playwright/test'
import { readFileSync } from 'node:fs'

// Section L rule 9: no externally linked URL may start returning 404 during
// the rebuild. tests/fixtures/legacy-sitemap.txt froze the live sitemap before
// any change; every path in it must answer 200, or redirect to a page that
// does. Runs in the static project against the built site.
const paths = readFileSync('tests/fixtures/legacy-sitemap.txt', 'utf8')
  .split('\n')
  .map((line) => line.trim())
  .filter((line) => line && !line.startsWith('#'))

test('the frozen sitemap lists the pre-rebuild URLs', () => {
  expect(paths.length).toBeGreaterThanOrEqual(30)
  expect(paths).toContain('/')
})

for (const path of paths) {
  test(`legacy URL ${path} still resolves`, async ({ request }) => {
    const first = await request.get(path, { maxRedirects: 0 })
    if ([301, 308].includes(first.status())) {
      const location = first.headers().location
      expect(location, 'a permanent redirect needs a Location').toBeTruthy()
      const final = await request.get(location)
      expect(final.status(), `${path} -> ${location}`).toBe(200)
    } else {
      expect(first.status()).toBe(200)
    }
  })
}

// TEST-01 / BUS-05 / PROF-02: no public page carries a personal mailbox or a
// phone link. Checked over every frozen URL plus the pages that are not in
// the sitemap.
for (const path of [...paths, '/maintenance']) {
  test(`no personal contact details on ${path}`, async ({ request }) => {
    const response = await request.get(path)
    const html = await response.text()
    expect(html).not.toMatch(/@(?:gmail|googlemail|yahoo|outlook|hotmail|icloud)\.com/i)
    expect(html).not.toMatch(/href="tel:/i)
  })
}
