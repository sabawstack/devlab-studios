/**
 * The performance and accessibility budget (spec P, OPS-04): mobile
 * Lighthouse on preview must keep performance >= 90, LCP <= 2.5 s,
 * CLS <= 0.1 and accessibility at 100 for the four reference pages.
 */
export const BUDGET = Object.freeze({ performance: 90, accessibility: 100, lcpMs: 2500, cls: 0.1 })
export const BUDGET_PATHS = Object.freeze(['/', '/solutions', '/work/automated-lead-qualification', '/contact'])

/** Reads the numbers from a Lighthouse JSON report. */
export function readReport(report) {
  return {
    performance: Math.round((report.categories?.performance?.score ?? 0) * 100),
    accessibility: Math.round((report.categories?.accessibility?.score ?? 0) * 100),
    lcpMs: Math.round(report.audits?.['largest-contentful-paint']?.numericValue ?? Infinity),
    cls: Number((report.audits?.['cumulative-layout-shift']?.numericValue ?? Infinity).toFixed(3)),
  }
}

/** The ways a result misses the budget; empty when it passes. */
export function budgetFailures(result, budget = BUDGET) {
  const failures = []
  if (result.performance < budget.performance) failures.push(`performance ${result.performance} < ${budget.performance}`)
  if (result.accessibility < budget.accessibility) failures.push(`accessibility ${result.accessibility} < ${budget.accessibility}`)
  if (result.lcpMs > budget.lcpMs) failures.push(`LCP ${result.lcpMs} ms > ${budget.lcpMs} ms`)
  if (result.cls > budget.cls) failures.push(`CLS ${result.cls} > ${budget.cls}`)
  return failures
}
