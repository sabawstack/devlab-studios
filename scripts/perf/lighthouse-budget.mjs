/**
 * Runs mobile Lighthouse on the budget pages of a deployed site and fails
 * (exit 1) when any page misses the budget in scripts/perf/budget.js (OPS-04).
 * Each page gets two runs and keeps the better one, so one noisy CI run does
 * not fail a deploy that is within budget.
 *
 *   CHROME_PATH=<chromium> node scripts/perf/lighthouse-budget.mjs https://preview.example.com
 */
import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { BUDGET_PATHS, budgetFailures, readReport } from './budget.js'

const base = (process.argv[2] || '').replace(/\/$/, '')
if (!base) throw new Error('Usage: node scripts/perf/lighthouse-budget.mjs <baseUrl>')
const dir = mkdtempSync(join(tmpdir(), 'lh-'))

function run(path, attempt) {
  const output = join(dir, `${path.replace(/\W+/g, '_') || 'home'}-${attempt}.json`)
  execFileSync('npx', ['-y', 'lighthouse@12', `${base}${path}`, '--quiet', '--chrome-flags=--headless=new --no-sandbox',
    '--only-categories=performance,accessibility', '--output=json', `--output-path=${output}`], { stdio: 'inherit' })
  return readReport(JSON.parse(readFileSync(output, 'utf8')))
}

let failed = false
for (const path of BUDGET_PATHS) {
  const results = [run(path, 1)]
  if (budgetFailures(results[0]).length) results.push(run(path, 2))
  const best = results.reduce((a, b) => (budgetFailures(a).length <= budgetFailures(b).length && a.performance >= b.performance ? a : b))
  const failures = budgetFailures(best)
  console.log(`${path}: performance ${best.performance}, accessibility ${best.accessibility}, LCP ${best.lcpMs} ms, CLS ${best.cls}${failures.length ? ` — OVER BUDGET: ${failures.join('; ')}` : ' — ok'}`)
  if (failures.length) failed = true
}
process.exit(failed ? 1 : 0)
