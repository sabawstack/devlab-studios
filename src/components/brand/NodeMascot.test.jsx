import { readFileSync, statSync } from 'node:fs'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import NodeMascot from './NodeMascot.jsx'
import { NODE_ART, NODE_STATES, NODE_TIERS, isNodeReady } from '../../config/node.js'

// Node, the DevLab router: the redraw of spec G.3 / G.4 (MASCOT-01, MASCOT-02).
// `review` renders a state that the owner has not approved yet (the /brand page).
const render = (props = {}) => renderToStaticMarkup(<NodeMascot review {...props} />)

describe('NodeMascot: the character system (MASCOT-01)', () => {
  it('has four states and three tiers', () => {
    expect(NODE_STATES).toEqual(['idle', 'holding', 'confirming', 'needs-person'])
    expect(Object.keys(NODE_TIERS)).toEqual(['mark', 'figure', 'scene'])
    expect(Object.values(NODE_TIERS).map((tier) => tier.size)).toEqual([24, 96, 240])
  })

  it('is decorative by default (spec G.3)', () => {
    const html = render()
    expect(html).toMatch(/aria-hidden="true"/)
    expect(html).not.toMatch(/role="img"|<title/)
  })

  it('carries a state-specific accessible name when the state carries meaning', () => {
    const html = render({ state: 'needs-person', decorative: false, id: 'n' })
    expect(html).toMatch(/^<svg[^>]*role="img"[^>]*aria-labelledby="n-title"/)
    expect(html).toMatch(/<title id="n-title">Node, the DevLab router, waiting for a person<\/title>/)
  })

  it.each(NODE_STATES)('reflects the %s state on the root', (state) => {
    expect(render({ state })).toMatch(new RegExp(`data-state="${state}"`))
  })

  it('falls back to idle for an unknown or retired state', () => {
    for (const state of ['party', 'active', 'diagnostic']) expect(render({ state })).toMatch(/data-state="idle"/)
  })

  it('has one round head lamp and no visor', () => {
    for (const tier of Object.keys(NODE_TIERS)) {
      const html = render({ tier })
      expect(html.match(/class="node-lamp"/g), tier).toHaveLength(1)
      expect(html, tier).not.toMatch(/visor|node-eye/)
    }
  })

  it('draws the side plates 1.6 times narrower than the centre plate (figure tier)', () => {
    const html = render({ tier: 'figure' })
    expect(html).toMatch(/class="node-plate node-plate--centre"[^>]*width="16"/)
    // Side plate thickness, measured horizontally between its outer and inner edges.
    expect(html).toMatch(/class="node-plate node-plate--left" points="26,36 36,36/)
  })

  it('simplifies the mark tier: centre plate, lamp and two side strokes; no terminals or hands', () => {
    const html = render({ tier: 'mark' })
    expect(html).toMatch(/viewBox="0 0 24 28"/)
    expect(html).not.toMatch(/node-terminal|node-hand|node-slate|node-packet/)
  })

  it('holds a slate when holding, stamps it when confirming, shows a person when one is needed', () => {
    expect(render({ state: 'holding' })).toMatch(/data-node-slate/)
    expect(render({ state: 'confirming' })).toMatch(/data-node-stamp/)
    expect(render({ state: 'needs-person' })).toMatch(/data-node-person/)
    expect(render({ state: 'idle' })).not.toMatch(/data-node-slate|data-node-person/)
  })

  it('only the scene tier carries the hand-off path and its person', () => {
    expect(render({ tier: 'scene', state: 'confirming' })).toMatch(/data-node-handoff/)
    expect(render({ tier: 'figure', state: 'confirming' })).not.toMatch(/data-node-handoff/)
  })

  it('takes its size from the tier, or from size, keeping the tier ratio', () => {
    expect(render({ tier: 'figure' })).toMatch(/width="96" height="112"/)
    expect(render({ tier: 'mark' })).toMatch(/width="24" height="28"/)
    expect(render({ tier: 'scene' })).toMatch(/width="240" height="134"/)
    expect(render({ tier: 'figure', size: 48 })).toMatch(/width="48" height="56"/)
  })

  it('gives two instances distinct ids', () => {
    const ids = (html) => [...html.matchAll(/id="([^"]+)"/g)].map((match) => match[1])
    const first = ids(render({ decorative: false }))
    const second = ids(render({ decorative: false }))
    expect(first.length).toBeGreaterThan(0)
    for (const id of first) expect(second).not.toContain(id)
  })

  it('has no SMIL, no script, no inline handler, no gradient and no raw hex colour', () => {
    for (const state of NODE_STATES) {
      for (const tier of Object.keys(NODE_TIERS)) {
        const html = render({ state, tier, run: 'receive' })
        expect(html).not.toMatch(/<animate|<set\b|<script|\son[a-z]+=|Gradient|#[0-9a-f]{3,6}\b/i)
      }
    }
  })

  it('stays under 6 KB per state and tier', () => {
    for (const state of NODE_STATES) {
      for (const tier of Object.keys(NODE_TIERS)) expect(render({ state, tier, decorative: false }).length).toBeLessThanOrEqual(6 * 1024)
    }
  })

  it.each(NODE_STATES.flatMap((state) => Object.keys(NODE_TIERS).map((tier) => [state, tier])))('snapshot: %s, %s tier', (state, tier) => {
    expect(render({ state, tier, id: 'snap', decorative: false })).toMatchSnapshot()
  })
})

describe('Node motion (MASCOT-02, spec G.4)', () => {
  it('marks a single run with data-run; no run by default', () => {
    expect(render({ run: 'receive' })).toMatch(/data-run="receive"/)
    expect(render({ tier: 'scene', state: 'confirming', run: 'handoff' })).toMatch(/data-run="handoff"/)
    expect(render()).not.toMatch(/data-run=/)
  })

  it('draws the packet at its final position, so reduced motion and no-JS show the last frame', () => {
    expect(render({ tier: 'figure', state: 'holding' })).toMatch(/class="node-packet node-packet--receive" cx="48" cy="64"/)
    expect(render({ tier: 'scene', state: 'confirming' })).toMatch(/class="node-packet node-packet--handoff" cx="150" cy="66"/)
  })

  const css = readFileSync('src/styles/brand.css', 'utf8')
  const keyframes = (name) => new RegExp(`@keyframes ${name}\\b`).test(css)

  it('defines the receive, hand-off and lamp sequences in CSS, each within 1.2 s and run once', () => {
    for (const name of ['node-receive', 'node-handoff', 'node-lamp-confirm']) expect(keyframes(name), name).toBe(true)
    const runs = [...css.matchAll(/animation:\s*(node-[a-z-]+)\s+(\d+)ms[^;]*;/g)]
    expect(runs.length).toBeGreaterThanOrEqual(3)
    for (const [rule, , duration] of runs) {
      expect(rule).not.toMatch(/infinite/)
      const delay = Number(/(\d+)ms\s+(\d+)ms/.exec(rule)?.[2] ?? 0)
      expect(Number(duration) + delay, rule).toBeLessThanOrEqual(1200)
    }
  })

  it('stops the sequences under reduced motion and pauses them when the page is hidden', () => {
    expect(css).toMatch(/@media \(prefers-reduced-motion: reduce\)\s*\{[^}]*\.node-mascot[^{]*\{[^}]*animation:\s*none/)
    expect(css).toMatch(/\[data-page-hidden\][^{]*\.node-mascot[^{]*\{[^}]*animation-play-state:\s*paused/)
  })
})

describe('Node approval gate (spec G.3, Q-13)', () => {
  it('no state is approved until the owner signs off on /brand', () => {
    for (const state of NODE_STATES) expect(isNodeReady(state), state).toBe(NODE_ART.states[state] === true)
  })

  it('renders nothing for an unapproved state outside the review page', () => {
    const state = NODE_STATES.find((name) => !isNodeReady(name))
    if (!state) return
    expect(renderToStaticMarkup(<NodeMascot state={state} />)).toBe('')
  })

  it('ships a static SVG export per state and tier, each under 6 KB', () => {
    for (const state of NODE_STATES) {
      for (const tier of Object.keys(NODE_TIERS)) {
        const path = `public/branding/node/node-${state}-${tier}.svg`
        expect(statSync(path).size, path).toBeLessThanOrEqual(6 * 1024)
      }
    }
  })
})
