import { Briefcase, FileText, Home, Info, Settings, User, Wrench } from '../components/icons/icons'

/**
 * The public information architecture in one place. Admin navigation and
 * usage guidance consume this registry so CMS labels cannot drift from the
 * routes visitors actually see.
 */
export const PUBLIC_SURFACES = [
  { key: 'home', label: 'Home', publicPath: '/', adminPath: '/admin/pages/home', icon: Home, primary: true, codeComposed: true, description: 'Composed in code since 2.4.0 (copy in src/data/site/content.js). Its Work section shows the Work page narratives; edits to these blocks are kept but not shown.' },
  { key: 'about', label: 'About', publicPath: '/about', adminPath: '/admin/pages/about', icon: Info, primary: true, codeComposed: true, description: 'Composed in code since 2.4.0, including "How we work" (formerly /process). Edits to these blocks are kept but not shown.' },
  { key: 'solutions', label: 'Solutions', publicPath: '/solutions', adminPath: '/admin/pages/solutions', icon: Settings, primary: true, codeComposed: true, description: 'Composed in code since 2.4.0: the three service lines, their pages under /solutions/<line>, and the Workflow Systems Audit. Edits to these blocks are kept but not shown.' },
  { key: 'work', label: 'Work', publicPath: '/work', adminPath: '/admin/pages/work', icon: Briefcase, primary: true, description: 'The Work narratives: each published entry is a write-up at /work/<project slug> and may appear on Home, Solutions and Profile.' },
  { key: 'insights', label: 'Insights', publicPath: '/insights', adminPath: '/admin/pages/insights', icon: FileText, primary: true, codeComposed: true, description: 'The page frame is composed in code since 2.4.0; the articles themselves are edited under Insights. Edits to these blocks are kept but not shown.' },
  { key: 'profile', label: 'Founder Profile', publicPath: '/profile', adminPath: '/admin/content/profile', icon: User, primary: true, description: 'Founder profile: background, experience, education, skills and certifications.' },
  { key: 'process', label: 'Process (retired)', publicPath: '/about#how-we-work', adminPath: '/admin/pages/process', icon: Wrench, primary: false, codeComposed: true, description: 'Retired in 2.4.0: /process now redirects to About. Edits here are kept but not shown.' },
  { key: 'contact', label: 'Contact', publicPath: '/contact', adminPath: '/admin/pages/contact', icon: FileText, primary: false, codeComposed: true, description: 'Composed in code since 2.4.0. The inquiry form fields, validation and routing are application code, not CMS content.' },
]

export const PRIMARY_PUBLIC_SURFACES = PUBLIC_SURFACES.filter((surface) => surface.primary)
export const SUPPORTING_PUBLIC_SURFACES = PUBLIC_SURFACES.filter((surface) => !surface.primary)

export const CONTENT_USAGE = {
  projects: { label: 'Projects', publicPaths: ['/work', 'Work write-ups', '/profile'], description: 'Project records are written up through the Work page; a project\'s slug, outcome statements, drawing and evidence note appear on its write-up.' },
  services: { label: 'Service Catalog', publicPaths: [], description: 'Not shown on the public site since 2.4.0 (the service lines are composed in code). Kept for reference and history.' },
  resources: { label: 'Insights', publicPaths: ['/insights'], description: 'Each record is an article published in the public Insights feed.' },
  profile: { label: 'Profile', publicPaths: ['/profile'], description: 'Controls the public Profile page.' },
  certifications: { label: 'Certifications', publicPaths: ['/profile'], description: 'Certification records are displayed inside Profile.' },
  'site-settings': { label: 'Navigation & Footer', publicPaths: ['All public pages'], description: 'Controls shared navigation, calls to action, footer links, and contact details.' },
  seo: { label: 'SEO', publicPaths: ['All public pages'], description: 'Controls page titles, descriptions, canonical URLs, and social metadata.' },
}

export function getContentUsage(type) {
  return CONTENT_USAGE[type] || null
}
