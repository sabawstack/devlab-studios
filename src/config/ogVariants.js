/**
 * Social-card templates (audit WEB-08 / SEO-02). A page's SEO record picks a
 * variant; the card itself is generated from the brand template, never
 * uploaded per page. '' means "the default for this route".
 */
export const OG_IMAGE_VARIANTS = [
  { id: '', label: 'Default for this page' },
  { id: 'default', label: 'Studio' },
  { id: 'article', label: 'Article' },
  { id: 'work', label: 'Work write-up' },
  { id: 'offer', label: 'Offer' },
  { id: 'profile', label: 'Founder profile' },
]

export const OG_IMAGE_VARIANT_IDS = OG_IMAGE_VARIANTS.map((variant) => variant.id)
