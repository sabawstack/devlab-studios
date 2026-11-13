import { PROJECT_CLIENT_TYPES } from '../../../config/projectTypes.js'
import { SCENES } from '../../../config/scenes'

/**
 * Write-up fields for a project (audit CMS-03; spec K.2, CMS-01): the public
 * address, who it was built for, up to three outcome statements the owner can
 * verify, the system drawing, a note on the evidence, and the case-study
 * parts: the situation, the decisions that mattered, the scope and
 * responsibility line, and since when it has run. Selects are filled from the registries,
 * so only values the site can render are offered.
 */
const inputClass = 'rounded-md border border-slate-300 px-3 py-2 text-slate-800 outline-none transition focus:border-slate-500'
const labelClass = 'grid gap-1.5 text-sm font-semibold text-slate-800'

function ProjectEditorialFields({ project, onChange }) {
  const outcomes = [0, 1, 2].map((index) => project.outcomeStatements?.[index] || '')
  const decisions = [0, 1, 2, 3].map((index) => project.decisions?.[index] || '')
  const setDecision = (index, value) => {
    const next = [...decisions]
    next[index] = value
    onChange({ ...project, decisions: next })
  }
  const setOutcome = (index, value) => {
    const next = [...outcomes]
    next[index] = value
    onChange({ ...project, outcomeStatements: next })
  }

  return (
    <fieldset className="grid gap-4 rounded-lg border border-slate-200 p-4">
      <legend className="px-1 text-sm font-semibold text-slate-900">Write-up details</legend>

      <div className="grid gap-4 md:grid-cols-2">
        <label className={labelClass}>
          Page address (slug)
          <input
            className={inputClass}
            value={project.slug || ''}
            onChange={(event) => onChange({ ...project, slug: event.target.value })}
            placeholder="lead-intake-system"
            pattern="[a-z0-9-]*"
          />
          <span className="text-xs font-normal text-slate-500">Lowercase letters, numbers and hyphens. Becomes /work/&lt;slug&gt;.</span>
        </label>

        <label className={labelClass}>
          Built for
          <select className={`${inputClass} bg-white`} value={project.clientType || ''} onChange={(event) => onChange({ ...project, clientType: event.target.value })}>
            {PROJECT_CLIENT_TYPES.map((type) => (
              <option key={type.id} value={type.id}>{type.label}</option>
            ))}
          </select>
        </label>
      </div>

      <div className="grid gap-2">
        <span className="text-sm font-semibold text-slate-800">Outcome statements (up to 3, each verifiable, no invented numbers)</span>
        {outcomes.map((value, index) => (
          <input
            key={index}
            aria-label={`Outcome statement ${index + 1}`}
            className={inputClass}
            value={value}
            maxLength={160}
            onChange={(event) => setOutcome(index, event.target.value)}
          />
        ))}
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <label className={labelClass}>
          System drawing
          <select className={`${inputClass} bg-white`} value={project.systemDiagramId || ''} onChange={(event) => onChange({ ...project, systemDiagramId: event.target.value })}>
            <option value="">None</option>
            {SCENES.map((scene) => (
              <option key={scene.id} value={scene.id}>{`${scene.code} · ${scene.title}`}</option>
            ))}
          </select>
        </label>

        <label className={labelClass}>
          Evidence note
          <input
            className={inputClass}
            value={project.evidenceNote || ''}
            maxLength={400}
            onChange={(event) => onChange({ ...project, evidenceNote: event.target.value })}
            placeholder="Screenshots use synthetic data."
          />
        </label>
      </div>

      <label className={labelClass}>
        The situation
        <textarea
          className={inputClass}
          rows={3}
          value={project.situation || ''}
          maxLength={600}
          onChange={(event) => onChange({ ...project, situation: event.target.value })}
          placeholder="Who it was for, by type of business, and what was going on."
        />
      </label>

      <div className="grid gap-2">
        <span className="text-sm font-semibold text-slate-800">Decisions that mattered (up to 4, one line each)</span>
        {decisions.map((value, index) => (
          <input
            key={index}
            aria-label={`Decision ${index + 1}`}
            className={inputClass}
            value={value}
            maxLength={200}
            onChange={(event) => setDecision(index, event.target.value)}
          />
        ))}
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <label className={labelClass}>
          Scope and responsibility
          <textarea
            className={inputClass}
            rows={3}
            value={project.scope || ''}
            maxLength={600}
            onChange={(event) => onChange({ ...project, scope: event.target.value })}
            placeholder="What DevLab built, what the client or other vendors own, who maintains it."
          />
        </label>

        <label className={labelClass}>
          In operation since
          <input
            className={inputClass}
            value={project.inOperationSince || ''}
            onChange={(event) => onChange({ ...project, inOperationSince: event.target.value })}
            placeholder="2026-04"
            pattern="\d{4}-\d{2}(-\d{2})?"
          />
          <span className="text-xs font-normal text-slate-500">Only if it is true. Year and month, YYYY-MM.</span>
        </label>
      </div>
    </fieldset>
  )
}

export default ProjectEditorialFields
