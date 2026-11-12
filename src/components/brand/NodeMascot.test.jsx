import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import NodeMascot from './NodeMascot.jsx'

const render = (props = {}) => renderToStaticMarkup(<NodeMascot {...props} />)

describe('NodeMascot (ADR 0014)', () => {
  it('renders an accessible svg with its title by default', () => {
    const html = render({ title: 'Node, the routing engine' })
    expect(html).toMatch(/^<svg[^>]*role="img"/)
    expect(html).toMatch(/<title id="[^"]+">Node, the routing engine<\/title>/)
    expect(html).toMatch(/aria-labelledby="[^"]+"/)
  })

  it('is hidden from assistive technology when decorative', () => {
    const html = render({ decorative: true })
    expect(html).toMatch(/aria-hidden="true"/)
    expect(html).not.toMatch(/role="img"/)
    expect(html).not.toMatch(/<title/)
  })

  it.each(['idle', 'active', 'diagnostic'])('reflects the %s state on the root', (state) => {
    expect(render({ state })).toMatch(new RegExp(`data-state="${state}"`))
  })

  it('falls back to idle for an unknown state', () => {
    expect(render({ state: 'party' })).toMatch(/data-state="idle"/)
  })

  it('gives two instances distinct gradient and title ids', () => {
    const ids = (html) => [...html.matchAll(/id="([^"]+)"/g)].map((match) => match[1])
    const first = ids(render({ title: 'A' }))
    const second = ids(render({ title: 'B' }))
    expect(first.length).toBeGreaterThan(0)
    for (const id of first) expect(second).not.toContain(id)
  })

  it('uses an explicit id prefix when given one', () => {
    expect(render({ id: 'hero-node' })).toMatch(/id="hero-node-gradient"/)
  })

  it('shows the slate and the amber visor only in diagnostic', () => {
    const diagnostic = render({ state: 'diagnostic' })
    expect(diagnostic).toMatch(/data-node-slate/)
    expect(diagnostic).toMatch(/class="[^"]*node-visor--amber/)
    const idle = render({ state: 'idle' })
    expect(idle).not.toMatch(/data-node-slate/)
    expect(idle).not.toMatch(/node-visor--amber/)
  })

  it('carries data packets only when active', () => {
    expect(render({ state: 'active' })).toMatch(/<animateMotion/)
    expect(render({ state: 'idle' })).not.toMatch(/<animateMotion/)
  })

  it('takes its size from the size prop, keeping the 96:112 ratio', () => {
    const html = render({ size: 48 })
    expect(html).toMatch(/width="48"/)
    expect(html).toMatch(/height="56"/)
    expect(html).toMatch(/viewBox="0 0 96 112"/)
  })

  it('has no script, no inline handler and no raw hex colour', () => {
    for (const state of ['idle', 'active', 'diagnostic']) {
      const html = render({ state })
      expect(html).not.toMatch(/<script|\son[a-z]+=/i)
      expect(html).not.toMatch(/#[0-9a-f]{3,6}\b/i)
    }
  })

  it('stays under 6 KB of markup', () => {
    for (const state of ['idle', 'active', 'diagnostic']) expect(render({ state, title: 'Node' }).length).toBeLessThanOrEqual(6 * 1024)
  })
})
