import { Link } from 'react-router-dom'

/**
 * Shared presentational components for the Lead CRM screens.
 *
 * COMPONENTS ONLY. Constants, formatters and the data hook live in format.js
 * and useResource.js — a module exporting both components and plain values
 * defeats React Fast Refresh, which the project's lint config enforces.
 *
 * Built from the same Tailwind idioms as the existing Inquiries screen, so the
 * CRM reads as another section of this CMS rather than a bolted-on app.
 */

// ADMIN-06: the presentational pieces are the workspace primitives now.
export { Badge, EmptyState, Feedback, Field, Panel } from '../../primitives/index.jsx'

/**
 * The banner every Lead CRM screen shows when the engine is switched off.
 *
 * Explicit rather than silent. With the flags at their shipped defaults the
 * screens are reachable and empty, and without this an operator would
 * reasonably conclude the feature is broken rather than disabled.
 */
export function DisabledNotice({ flags }) {
  if (!flags || flags.engine) return null

  return (
    <div role="status" className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3">
      <p className="text-sm font-semibold text-amber-900">The Lead Intelligence Engine is switched off.</p>
      <p className="mt-1 text-xs text-amber-800">
        Nothing is being discovered, crawled, analysed or synchronized. Turn on the engine and the capabilities you
        need in{' '}
        {/* CRM-07: a router link, so the Admin is not reloaded. */}
        <Link className="font-semibold" to="/admin/lead-crm/settings">
          CRM Settings
        </Link>
        . Deployment-locked switches require their Worker var to permit them. Existing data stays readable.
      </p>
    </div>
  )
}
