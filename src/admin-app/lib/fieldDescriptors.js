// Field descriptors pair with the Zod schemas in src/lib/schemas/ for UI
// rendering purposes only — Zod stays the single source of truth for what's
// *valid*; these describe how to *edit* it (widget, label, help text).
// This is what makes the admin schema-driven rather than ad-hoc: every
// collection's edit form is generated from one declaration, not hand-built
// JSX per field.

export const STATUS_OPTIONS = [
  { value: 'draft', label: 'Draft' },
  { value: 'published', label: 'Published' },
  { value: 'archived', label: 'Archived' },
]

export const testimonialFields = [
  { name: 'quote', label: 'Quote', type: 'textarea', required: true },
  { name: 'authorName', label: 'Author Name', type: 'text', required: true },
  { name: 'authorTitle', label: 'Author Title', type: 'text' },
  { name: 'authorCompany', label: 'Author Company', type: 'text' },
  { name: 'authorPhotoUrl', label: 'Author Photo URL', type: 'url' },
  { name: 'isFeatured', label: 'Featured', type: 'boolean' },
  { name: 'status', label: 'Status', type: 'select', options: STATUS_OPTIONS },
  { name: 'sortOrder', label: 'Sort Order', type: 'number' },
]

export const certificationFields = [
  { name: 'name', label: 'Certificate Name', type: 'text', required: true },
  { name: 'issuer', label: 'Issuer', type: 'text', required: true },
  { name: 'issuedDate', label: 'Issued Date', type: 'date' },
  { name: 'credentialUrl', label: 'Credential URL', type: 'url' },
  { name: 'badgeImageUrl', label: 'Badge Image URL', type: 'url', help: 'Leave blank to use the bundled badge image, if one is mapped by id.' },
  { name: 'status', label: 'Status', type: 'select', options: STATUS_OPTIONS },
  { name: 'sortOrder', label: 'Sort Order', type: 'number' },
]

export const redirectFields = [
  { name: 'fromPath', label: 'From Path', type: 'text', required: true, help: 'Must start with / — e.g. /old-page. End it with /* to match every path below it, e.g. /old-section/*.' },
  { name: 'toPath', label: 'To Path', type: 'text', required: true },
  { name: 'statusCode', label: 'Status Code', type: 'select', options: [{ value: 301, label: '301 (Permanent)' }, { value: 302, label: '302 (Temporary)' }] },
  { name: 'note', label: 'Note', type: 'textarea' },
]

// caseStudySchema also has metrics[]/screenshots[]/projectIds[] array fields
// and an optional seo{} block — left out of this v1 form since SchemaForm
// doesn't yet support nested array/object field types (see PAGE_BLOCK_TYPES
// editor for where that's needed next). Ships empty today per
// docs/content-model.md, so nothing is lost by keeping this form scoped to
// the flat fields for now.
export const caseStudyFields = [
  { name: 'title', label: 'Title', type: 'text', required: true },
  { name: 'slug', label: 'Slug', type: 'text', required: true, help: 'Lowercase, hyphen-separated.' },
  { name: 'summary', label: 'Summary', type: 'textarea' },
  { name: 'clientName', label: 'Client Name', type: 'text' },
  { name: 'industry', label: 'Industry', type: 'text' },
  { name: 'problem', label: 'Problem', type: 'textarea' },
  { name: 'constraints', label: 'Constraints', type: 'textarea' },
  { name: 'architecture', label: 'Architecture', type: 'textarea' },
  { name: 'implementation', label: 'Implementation', type: 'textarea' },
  { name: 'outcomes', label: 'Outcomes', type: 'textarea' },
  { name: 'coverImageUrl', label: 'Cover Image URL', type: 'url' },
  { name: 'isFeatured', label: 'Featured', type: 'boolean' },
  { name: 'status', label: 'Status', type: 'select', options: STATUS_OPTIONS },
  { name: 'sortOrder', label: 'Sort Order', type: 'number' },
]

export const REPLACE_ALL_REGISTRY = {
  testimonials: { label: 'Testimonials', fields: testimonialFields, apiPath: '/api/admin/collections/testimonials', emptyItem: { quote: '', authorName: '', authorTitle: '', authorCompany: '', authorPhotoUrl: '', isFeatured: false, status: 'draft', sortOrder: 999 } },
  certifications: { label: 'Certifications', fields: certificationFields, apiPath: '/api/admin/collections/certifications', emptyItem: { name: '', issuer: '', issuedDate: '', credentialUrl: '', badgeImageUrl: '', status: 'draft', sortOrder: 999 } },
}

export const PER_ITEM_REGISTRY = {
  redirects: { label: 'Redirects', fields: redirectFields, apiPath: '/api/admin/collections/redirects', emptyItem: { fromPath: '', toPath: '', statusCode: 301, note: '' }, itemLabel: (item) => `${item.fromPath} → ${item.toPath}` },
  'case-studies': { label: 'Case Studies', fields: caseStudyFields, apiPath: '/api/admin/collections/case-studies', emptyItem: { title: '', slug: '', summary: '', clientName: '', industry: '', problem: '', constraints: '', architecture: '', implementation: '', outcomes: '', coverImageUrl: '', isFeatured: false, status: 'draft', sortOrder: 999 }, itemLabel: (item) => item.title },
}
