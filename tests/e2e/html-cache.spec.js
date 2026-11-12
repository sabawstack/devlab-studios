import { test, expect } from '@playwright/test'

// OPS-01: business pages come from the edge HTML cache after the first render;
// drafts, admin and API responses never do.
test('a business page is served from the cache on the second request', async ({ request }) => {
  await request.get('/about?cachetest=1')
  const second = await request.get('/about?cachetest=1')
  expect(second.status()).toBe(200)
  expect(second.headers()['x-devlab-cache']).toBe('HIT')
  expect(second.headers()['cache-control']).toMatch(/max-age=0/)
  // Security headers are applied to cached responses too.
  expect(second.headers()['content-security-policy']).toBeTruthy()
  expect(second.headers()['strict-transport-security']).toBeTruthy()
})

test('tracking parameters share one cached copy', async ({ request }) => {
  await request.get('/solutions?utm_source=first')
  const other = await request.get('/solutions?utm_source=second&gclid=x')
  expect(other.headers()['x-devlab-cache']).toBe('HIT')
})

test('a preview link is never served from or stored in the cache', async ({ request }) => {
  for (let i = 0; i < 2; i += 1) {
    const response = await request.get('/process?preview=p1.not.valid')
    expect(response.headers()['x-devlab-cache']).toBeUndefined()
    expect(response.headers()['cache-control']).toMatch(/no-store/)
  }
})

test('admin and API responses are never cached', async ({ request }) => {
  for (const path of ['/admin', '/api/health']) {
    await request.get(path)
    const response = await request.get(path)
    expect(response.headers()['x-devlab-cache'], path).toBeUndefined()
  }
})
