export const siteSettingsContent = {
  /**
   * Business-first order. The route was renamed `/services` -> `/solutions`
   * changes to "Solutions": renaming the path would need a redirect, would
   * reset the page's accumulated search signals, and buys nothing a label
   * change does not already achieve.
   */
  navigation: [
    { id: 'nav-home', label: 'Home', href: '/', sortOrder: 10, status: 'published' },
    { id: 'nav-services', label: 'Solutions', href: '/solutions', sortOrder: 20, status: 'published' },
    { id: 'nav-work', label: 'Work', href: '/work', sortOrder: 30, status: 'published' },
    { id: 'nav-resources', label: 'Insights', href: '/insights', sortOrder: 40, status: 'published' },
    { id: 'nav-about', label: 'About', href: '/about', sortOrder: 50, status: 'published' },
    { id: 'nav-profile', label: 'Profile', href: '/profile', sortOrder: 60, status: 'published' },
  ],
  ctas: {
    // Spec K.3 / CONTENT-02 (owner approved 2026-11-13); see src/config/ctas.js.
    navbarContactLabel: 'Talk to us',
    mobileContactLabel: 'Contact',
  },
  footer: {
    companyName: 'DevLab Studios',
    tagline: '',
    email: 'hello@devlabstudios.com',
    location: 'Cebu, Philippines',
    quickLinks: [
      { label: 'Home', href: '/' },
      { label: 'Solutions', href: '/solutions' },
      { label: 'Work', href: '/work' },
      { label: 'Insights', href: '/insights' },
      { label: 'About', href: '/about' },
      { label: 'Founder Profile', href: '/profile' },
      { label: 'Contact', href: '/contact' },
    ],
    socialLinks: [
      { label: 'LinkedIn', href: 'https://www.linkedin.com/in/stephen-rey-agustinez-8b86041b3' },
      { label: 'GitHub', href: 'https://github.com/stpn-dev' },
      { label: 'Email', href: 'mailto:hello@devlabstudios.com' },
    ],
    legalLinks: [
      { label: 'Privacy Policy', href: '/privacy' },
      { label: 'Terms of Service', href: '/terms' },
    ],
    copyright: '© 2026 DevLab Studios. All rights reserved.',
  },
  /**
   * Business details (CMS-02). Empty here on purpose: every field falls back
   * to src/config/business.js (the owner's decisions), and an admin overrides
   * a field in Site Settings, stored as site_settings `site_business`.
   */
  business: {},
}

export default siteSettingsContent
