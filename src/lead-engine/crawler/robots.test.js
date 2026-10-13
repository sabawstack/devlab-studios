import { describe, expect, it } from 'vitest'
import { fetchRobots, isPathAllowed, parseRobots } from './robots.js'

const AGENT = 'devlabresearchbot/1.0 (+https://www.devlabstudios.com/crawler)'

function allows(text, path, agent = AGENT) {
  return isPathAllowed(parseRobots(text, agent), path)
}

describe('parseRobots', () => {
  it('applies wildcard rules when no group names us', () => {
    const text = 'User-agent: *\nDisallow: /private\n'
    expect(allows(text, '/')).toBe(true)
    expect(allows(text, '/private')).toBe(false)
    expect(allows(text, '/private/page')).toBe(false)
  })

  it('prefers a group that names us over the wildcard group', () => {
    const text = [
      'User-agent: *',
      'Disallow: /',
      '',
      'User-agent: DevLabResearchBot',
      'Disallow: /admin',
    ].join('\n')

    expect(allows(text, '/contact')).toBe(true)
    expect(allows(text, '/admin')).toBe(false)
    expect(parseRobots(text, AGENT).matchedSpecificAgent).toBe(true)
  })

  it('does not merge the wildcard group into a named group', () => {
    // The bug this guards: treating a User-agent line after a rule line as
    // continuing the previous group, which would apply "/" to us.
    const text = ['User-agent: DevLabResearchBot', 'Allow: /', 'User-agent: *', 'Disallow: /'].join('\n')
    expect(allows(text, '/anything')).toBe(true)
  })

  it('shares one group between consecutive user-agent lines', () => {
    const text = ['User-agent: SomeBot', 'User-agent: DevLabResearchBot', 'Disallow: /nope'].join('\n')
    expect(allows(text, '/nope')).toBe(false)
    expect(allows(text, '/yes')).toBe(true)
  })

  it('treats an empty Disallow as allowing everything', () => {
    expect(allows('User-agent: *\nDisallow:\n', '/anything')).toBe(true)
  })

  it('lets the longest match win, with Allow winning ties', () => {
    const text = 'User-agent: *\nDisallow: /docs\nAllow: /docs/public\n'
    expect(allows(text, '/docs/secret')).toBe(false)
    expect(allows(text, '/docs/public/a')).toBe(true)

    expect(allows('User-agent: *\nDisallow: /\nAllow: /\n', '/x')).toBe(true)
  })

  it('supports * wildcards and the $ anchor', () => {
    expect(allows('User-agent: *\nDisallow: /*.pdf$\n', '/forms/application.pdf')).toBe(false)
    expect(allows('User-agent: *\nDisallow: /*.pdf$\n', '/forms/application.pdf.html')).toBe(true)
    expect(allows('User-agent: *\nDisallow: /a/*/c\n', '/a/b/c')).toBe(false)
  })

  it('ignores comments and malformed lines', () => {
    const text = ['# comment', 'User-agent: *', 'Disallow: /x  # trailing', 'garbage line', 'Disallow /y'].join('\n')
    expect(allows(text, '/x')).toBe(false)
    expect(allows(text, '/y')).toBe(true)
  })

  it('reads crawl-delay', () => {
    expect(parseRobots('User-agent: *\nCrawl-delay: 5\n', AGENT).crawlDelay).toBe(5)
  })

  it('allows everything for an empty file', () => {
    expect(allows('', '/anything')).toBe(true)
  })
})

describe('fetchRobots', () => {
  function stubFetch(response) {
    return async () => response
  }

  it('allows everything when robots.txt is absent', async () => {
    const robots = await fetchRobots('https://example.com', {
      fetchImpl: stubFetch(new Response('', { status: 404 })),
    })
    expect(robots.status).toBe('absent')
    expect(robots.allowed('/anything')).toBe(true)
  })

  it('refuses everything when the server is failing', async () => {
    const robots = await fetchRobots('https://example.com', {
      fetchImpl: stubFetch(new Response('', { status: 503 })),
    })
    expect(robots.status).toBe('server_error')
    expect(robots.allowed('/')).toBe(false)
  })

  it('refuses everything when robots.txt is unreachable', async () => {
    const robots = await fetchRobots('https://example.com', {
      fetchImpl: async () => {
        throw new Error('network down')
      },
    })
    expect(robots.status).toBe('unreachable')
    expect(robots.allowed('/')).toBe(false)
  })

  it('applies rules from a served robots.txt', async () => {
    const robots = await fetchRobots('https://example.com', {
      fetchImpl: stubFetch(new Response('User-agent: *\nDisallow: /private\nCrawl-delay: 2\n', { status: 200 })),
    })
    expect(robots.allowed('/contact')).toBe(true)
    expect(robots.allowed('/private/x')).toBe(false)
    expect(robots.crawlDelayMs).toBe(2000)
  })

  it('caps an absurd crawl-delay rather than stalling a run', async () => {
    const robots = await fetchRobots('https://example.com', {
      fetchImpl: stubFetch(new Response('User-agent: *\nCrawl-delay: 86400\n', { status: 200 })),
    })
    expect(robots.crawlDelayMs).toBe(30_000)
  })
})

describe('fetchRobots redirects and size (F7)', () => {
  function redirect(location, status = 301) {
    return new Response(null, { status, headers: { location } })
  }

  it('follows redirects manually and only within the site', async () => {
    const seen = []
    const robots = await fetchRobots('https://example.com', {
      fetchImpl: async (url, init) => {
        seen.push({ url, redirect: init.redirect })
        return seen.length === 1
          ? redirect('https://www.example.com/robots.txt')
          : new Response('User-agent: *\nDisallow: /x\n', { status: 200 })
      },
    })
    expect(seen.map((call) => call.redirect)).toEqual(['manual', 'manual'])
    expect(seen[1].url).toBe('https://www.example.com/robots.txt')
    expect(robots.allowed('/x/y')).toBe(false)
  })

  it('refuses to follow a redirect into private address space', async () => {
    let calls = 0
    const robots = await fetchRobots('https://example.com', {
      fetchImpl: async () => {
        calls += 1
        return redirect('http://169.254.169.254/latest/meta-data')
      },
    })
    expect(calls).toBe(1)
    expect(robots.allowed('/')).toBe(false)
    expect(robots.status).toMatch(/^unsafe_redirect/)
  })

  it('does not follow an off-site redirect', async () => {
    const robots = await fetchRobots('https://example.com', {
      fetchImpl: async () => redirect('https://elsewhere.example.org/robots.txt'),
    })
    expect(robots.status).toBe('offsite_redirect')
    expect(robots.allowed('/')).toBe(false)
  })

  it('gives up on a redirect loop', async () => {
    const robots = await fetchRobots('https://example.com', {
      fetchImpl: async () => redirect('https://example.com/robots.txt'),
    })
    expect(robots.status).toBe('too_many_redirects')
  })

  it('refuses an unsafe origin without fetching', async () => {
    let calls = 0
    const robots = await fetchRobots('http://127.0.0.1', {
      fetchImpl: async () => {
        calls += 1
        return new Response('', { status: 404 })
      },
    })
    expect(calls).toBe(0)
    expect(robots.allowed('/')).toBe(false)
  })

  it('stops reading an enormous body at the ceiling and cancels the stream', async () => {
    let pulled = 0
    let cancelled = false
    const chunk = new TextEncoder().encode('# '.padEnd(64 * 1024, 'x') + '\n')
    const body = new ReadableStream({
      pull(controller) {
        pulled += 1
        controller.enqueue(chunk)
      },
      cancel() {
        cancelled = true
      },
    })
    const robots = await fetchRobots('https://example.com', {
      fetchImpl: async () => new Response(body, { status: 200 }),
    })
    expect(robots.status).toBe('matched_wildcard')
    expect(cancelled).toBe(true)
    // 200 KB ceiling at 64 KB per chunk: a handful of pulls, not an endless read.
    expect(pulled).toBeLessThan(10)
  })
})
