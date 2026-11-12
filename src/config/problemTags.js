/**
 * Problem tags for Insights articles (audit SEO-08). Articles are organised by
 * the operational problem a reader recognises, not by technology. The id is
 * stored; the label is shown as a mono tag.
 */
export const PROBLEM_TAGS = [
  { id: 'lead-intake', label: 'Lead intake' },
  { id: 'follow-up', label: 'Follow-up' },
  { id: 'data-consistency', label: 'Data consistency' },
  { id: 'handoffs', label: 'Handoffs' },
  { id: 'silent-failures', label: 'Silent failures' },
  { id: 'reporting', label: 'Reporting' },
  { id: 'integration-maintenance', label: 'Integration maintenance' },
  { id: 'choosing-tools', label: 'Choosing tools' },
]

export const PROBLEM_TAG_IDS = PROBLEM_TAGS.map((tag) => tag.id)

/** Who an article is written for. Business pages promote `owner` articles only. */
export const ARTICLE_AUDIENCES = [
  { id: 'owner', label: 'Business owners' },
  { id: 'ops', label: 'Operations' },
  { id: 'technical', label: 'Technical' },
]

export const ARTICLE_AUDIENCE_IDS = ARTICLE_AUDIENCES.map((audience) => audience.id)
