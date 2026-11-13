/**
 * Writes a standalone SVG per Node state and tier to public/branding/node/
 * (spec G.3, MASCOT-01) for use outside the site (documents, the character
 * sheet, a designer). Rendered from NodeMascot.jsx itself, with the stone
 * palette's values resolved into an embedded style block, so the exports
 * cannot drift from the component.
 *
 *   node scripts/brand/export-node.mjs
 */
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { build } from 'esbuild'

const OUT = 'public/branding/node'
const bundle = await build({
  stdin: {
    contents: `
      import { renderToStaticMarkup } from 'react-dom/server'
      import { createElement } from 'react'
      import NodeMascot from './src/components/brand/NodeMascot.jsx'
      export { NODE_STATES, NODE_TIERS } from './src/config/node.js'
      export const render = (props) => renderToStaticMarkup(createElement(NodeMascot, props))`,
    resolveDir: process.cwd(),
    loader: 'jsx',
  },
  bundle: true, write: false, format: 'esm', platform: 'node', jsx: 'automatic', external: ['react', 'react-dom'],
})
// Written inside node_modules so `react` resolves from the project; removed after.
const temp = `${process.cwd()}/node_modules/.node-export-${process.pid}.mjs`
writeFileSync(temp, bundle.outputFiles[0].text)
const { render, NODE_STATES, NODE_TIERS } = await import(temp).finally(() => rmSync(temp, { force: true }))

// Token values from brand.css (the stone palette).
const css = readFileSync('src/styles/brand.css', 'utf8')
const value = (name) => new RegExp(`--${name}:\\s*(#[0-9a-f]{6})`, 'i').exec(css)[1]
const style = `<style>.node-mascot{color:${value('ink')}}.node-line,.node-plate,.node-terminal,.node-slate,.node-person{fill:${value('paper')};stroke:currentColor;stroke-width:1.5;stroke-linecap:round;stroke-linejoin:round}.node-line{fill:none}.node-mascot--mark .node-line,.node-mascot--mark .node-plate{stroke-width:1.75}.node-path{stroke:${value('ink-3')};stroke-dasharray:2 3}.node-hand,.node-packet{fill:currentColor}.node-lamp{fill:${value('paper')};stroke:currentColor;stroke-width:1.5}[data-state=holding] .node-lamp{fill:${value('redline')}}[data-state=confirming] .node-lamp{fill:${value('ok')}}[data-state=confirming] .node-stamp{stroke:${value('ok')}}[data-state=needs-person] .node-lamp{fill:currentColor}.node-packet--handoff{display:none}</style>`

mkdirSync(OUT, { recursive: true })
for (const state of NODE_STATES) {
  for (const tier of Object.keys(NODE_TIERS)) {
    const svg = render({ state, tier, review: true, decorative: false, id: `node-${state}-${tier}` }).replace(/(<svg[^>]*>)/, `$1${style}`)
    writeFileSync(`${OUT}/node-${state}-${tier}.svg`, `${svg}\n`)
  }
}
console.log(`wrote ${NODE_STATES.length * Object.keys(NODE_TIERS).length} files to ${OUT}`)
