/**
 * Who a project was built for (audit CMS-03 / WEB-07). `template` projects are
 * samples and never appear on buyer-facing pages; '' means "not yet set".
 */
export const PROJECT_CLIENT_TYPES = [
  { id: '', label: 'Not set' },
  { id: 'client', label: 'Client system' },
  { id: 'internal', label: 'DevLab internal system' },
  { id: 'product', label: 'DevLab product' },
  { id: 'template', label: 'Template or sample (hidden from buyer pages)' },
]

export const PROJECT_CLIENT_TYPE_IDS = PROJECT_CLIENT_TYPES.map((type) => type.id)
