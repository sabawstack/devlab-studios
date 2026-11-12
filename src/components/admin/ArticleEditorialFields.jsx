import { ARTICLE_AUDIENCES, PROBLEM_TAGS } from '../../config/problemTags.js'
import { OG_IMAGE_VARIANTS } from '../../config/ogVariants.js'
import { SCENES } from '../../config/scenes'

/**
 * Audience, problem tag, header art and per-article search fields (audit
 * CMS-03 / SEO-08). Every select comes from a registry; the SEO title and
 * description carry the same limits the SEO screen enforces.
 */
const inputClass = 'rounded-md border border-slate-300 px-3 py-2 text-sm font-normal text-slate-800 outline-none transition focus:border-slate-500'
const labelClass = 'grid gap-1.5 text-sm font-semibold text-slate-800'

function ArticleEditorialFields({ post, onChange }) {
  return (
    <div className="grid gap-4 rounded-md border border-slate-200 bg-white p-4">
      <p className="text-sm font-semibold text-slate-950">Audience and search</p>

      <label className={labelClass}>
        Written for
        <select className={`${inputClass} bg-white`} value={post.audience || ''} onChange={(event) => onChange({ audience: event.target.value })}>
          <option value="">Not set</option>
          {ARTICLE_AUDIENCES.map((audience) => <option key={audience.id} value={audience.id}>{audience.label}</option>)}
        </select>
      </label>

      <label className={labelClass}>
        Problem tag
        <select className={`${inputClass} bg-white`} value={post.problemTag || ''} onChange={(event) => onChange({ problemTag: event.target.value })}>
          <option value="">Not set</option>
          {PROBLEM_TAGS.map((tag) => <option key={tag.id} value={tag.id}>{tag.label}</option>)}
        </select>
      </label>

      <label className={labelClass}>
        Header illustration
        <select className={`${inputClass} bg-white`} value={post.heroVisualId || ''} onChange={(event) => onChange({ heroVisualId: event.target.value })}>
          <option value="">None</option>
          {SCENES.map((scene) => <option key={scene.id} value={scene.id}>{`${scene.code} · ${scene.title}`}</option>)}
        </select>
      </label>

      <label className={labelClass}>
        Search title
        <input className={inputClass} maxLength={70} value={post.seoTitle || ''} onChange={(event) => onChange({ seoTitle: event.target.value })} />
        <span className="text-xs font-normal text-slate-500">{(post.seoTitle || '').length}/60 recommended, 70 max. Blank uses the post title.</span>
      </label>

      <label className={labelClass}>
        Search description
        <textarea className={inputClass} rows={3} maxLength={200} value={post.seoDescription || ''} onChange={(event) => onChange({ seoDescription: event.target.value })} />
        <span className="text-xs font-normal text-slate-500">{(post.seoDescription || '').length}/160 recommended. Blank uses the summary.</span>
      </label>

      <label className={labelClass}>
        Social card
        <select className={`${inputClass} bg-white`} value={post.ogVariant || ''} onChange={(event) => onChange({ ogVariant: event.target.value })}>
          {OG_IMAGE_VARIANTS.map((variant) => <option key={variant.id} value={variant.id}>{variant.label}</option>)}
        </select>
      </label>
    </div>
  )
}

export default ArticleEditorialFields
