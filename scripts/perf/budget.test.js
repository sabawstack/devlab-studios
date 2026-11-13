import { describe, expect, it } from 'vitest'
import { BUDGET, BUDGET_PATHS, budgetFailures, readReport } from './budget.js'

describe('performance budget (OPS-04)', () => {
  it('holds the spec P thresholds and pages', () => {
    expect(BUDGET).toEqual({ performance: 90, accessibility: 100, lcpMs: 2500, cls: 0.1 })
    expect(BUDGET_PATHS).toEqual(['/', '/solutions', '/work/automated-lead-qualification', '/contact'])
  })

  it('reads a Lighthouse report', () => {
    const report = { categories: { performance: { score: 0.97 }, accessibility: { score: 1 } }, audits: { 'largest-contentful-paint': { numericValue: 2131.4 }, 'cumulative-layout-shift': { numericValue: 0.00012 } } }
    expect(readReport(report)).toEqual({ performance: 97, accessibility: 100, lcpMs: 2131, cls: 0 })
  })

  it('names every miss, and passes a result inside the budget', () => {
    expect(budgetFailures({ performance: 97, accessibility: 100, lcpMs: 2131, cls: 0 })).toEqual([])
    expect(budgetFailures({ performance: 85, accessibility: 98, lcpMs: 3100, cls: 0.2 })).toHaveLength(4)
  })
})
