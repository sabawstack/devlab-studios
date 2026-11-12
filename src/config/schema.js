// Schema.js - JSON-LD structured data helpers
import aboutData from '../data/about.js'
import { COMPANY, ORGANIZATION_ID, PERSON_ID } from './company.js'

/** City-level only: no street, postal code or telephone in any schema (audit PROF-02). */
const CITY_ADDRESS = {
  '@type': 'PostalAddress',
  addressLocality: COMPANY.location.locality,
  addressCountry: COMPANY.location.countryCode,
}

/** "University X, Campus, City" -> "University X". */
function schoolName(school) {
  return String(school || '').split(',')[0].replace(/\s+-\s+.*$/, '').trim()
}

/**
 * The founder (SEO-04). One node with a stable @id, linked to the
 * Organization, pointing at the profile page; `image` is the portrait and
 * `credentials` the certification names the profile page renders.
 */
/** @param {{ image?: string, credentials?: string[] }} [options] */
export const getPersonSchema = ({ image, credentials = [] } = {}) => ({
  '@context': 'https://schema.org',
  '@type': 'Person',
  '@id': PERSON_ID,
  name: COMPANY.founder.name,
  url: `${COMPANY.url}${COMPANY.founder.profilePath}`,
  description:
    'Software engineer and AI automation specialist building backend systems, API integrations, websites, and workflow automations for modern businesses worldwide.',
  jobTitle: 'Founder, Full-Stack Developer & AI Automation Architect',
  knowsAbout: [
    'Website Development',
    'Software Engineering',
    'Backend Development',
    'AI Automation',
    'Workflow Automation',
    'Business Process Automation',
    'Java',
    'Spring Boot',
    'React',
    'Next.js',
    'Tailwind CSS',
    'Laravel',
    'Zapier',
    'n8n',
    'Make.com',
    'REST APIs',
    'SQL',
    'API Integrations',
    'Full Stack Development',
    'Power BI',
    'CRM Automation',
    'Data Modeling',
  ],
  hasOccupation: {
    '@type': 'Occupation',
    name: 'Full-Stack Developer & AI Automation Architect',
    description:
      'Builds backend systems, websites, API integrations, and AI-driven automation systems for businesses, enabling reliable delivery, process efficiency, and operational scaling.',
    skills:
      'Java, Spring Boot, Laravel, React, Next.js, SQL, REST APIs, Zapier, n8n, Make.com, Business Process Automation, Full Stack Development',
    occupationLocation: {
      '@type': 'Country',
      name: 'Philippines',
    },
  },
  offers: [
    {
      '@type': 'Offer',
      name: 'Website Development',
      description:
        'Conversion-focused websites, landing pages, and full-stack web applications built with React, Tailwind CSS, and Laravel.',
      url: 'https://www.devlabstudios.com/solutions',
    },
    {
      '@type': 'Offer',
      name: 'AI Automation & Workflow Automation',
      description:
        'Business process automations using Zapier, n8n, Make.com, OpenAI, and Claude. Includes email automation, CRM integration, lead enrichment, and AI-assisted workflow systems.',
      url: 'https://www.devlabstudios.com/solutions',
    },
    {
      '@type': 'Offer',
      name: 'Backend & API Integration Support',
      description:
        'Backend and integration work across Java, Spring Boot, Laravel, SQL-backed workflows, REST APIs, and structured data handling for production-ready systems.',
      url: 'https://www.devlabstudios.com/solutions',
    },
  ],
  areaServed: 'Worldwide',
  worksFor: { '@id': ORGANIZATION_ID },
  sameAs: COMPANY.sameAs,
  image: image || COMPANY.logo,
  address: CITY_ADDRESS,
  alumniOf: (aboutData.education || [])
    .map((entry) => schoolName(entry.school))
    .filter(Boolean)
    .map((name) => ({ '@type': /university|college/i.test(name) ? 'CollegeOrUniversity' : 'EducationalOrganization', name })),
  ...(credentials.length
    ? { hasCredential: credentials.map((name) => ({ '@type': 'EducationalOccupationalCredential', name })) }
    : {}),
})

export const getPortfolioItemSchema = (project) => ({
  '@context': 'https://schema.org',
  '@type': 'CreativeWork',
  name: project.title,
  description: project.description,
  url: project.link || `https://www.devlabstudios.com/profile#${project.id}`,
  image: project.image,
  author: {
    '@type': 'Person',
    name: 'Stephen Rey G. Agustinez',
    jobTitle: 'Founder, Full-Stack Developer & AI Automation Architect',
  },
  datePublished: project.datePublished || '2026-03-11',
})

/** The business (SEO-04 / BUS-05): one node with a stable @id; pages reference it rather than repeat it. */
export const getOrganizationSchema = () => ({
  '@context': 'https://schema.org',
  '@type': 'Organization',
  '@id': ORGANIZATION_ID,
  name: COMPANY.name,
  url: COMPANY.url,
  description:
    'DevLab Studios provides software engineering, website development, backend integration, and AI automation services for businesses worldwide.',
  logo: COMPANY.logo,
  email: COMPANY.publicEmail,
  foundingDate: COMPANY.foundingDate,
  address: CITY_ADDRESS,
  founder: { '@id': PERSON_ID },
  knowsAbout: [
    'Website Development',
    'Software Engineering',
    'Backend Development',
    'AI Automation',
    'Workflow Automation',
    'Business Process Automation',
    'React Development',
    'Spring Boot',
    'Laravel',
    'Zapier',
    'n8n',
  ],
  areaServed: 'Worldwide',
  sameAs: COMPANY.sameAs,
  contactPoint: {
    '@type': 'ContactPoint',
    contactType: 'Customer Support',
    email: COMPANY.publicEmail,
    url: `${COMPANY.url}/contact`,
  },
})

export const getWebsiteSchema = () => ({
  '@context': 'https://schema.org',
  '@type': 'WebSite',
  name: 'DevLab Studios - Software Engineering & AI Automation',
  url: 'https://www.devlabstudios.com',
  description:
    'DevLab Studios builds software, web interfaces, backend integrations, and AI automation workflows for modern businesses.',
  // No potentialAction: the site has no search, and a SearchAction pointing
  // at one is a false claim (audit SEO-F02).
  publisher: { '@id': ORGANIZATION_ID },
})

/**
 * FAQPage. Only ever called with the exact questions and answers the page
 * actually renders — Google's structured-data policy requires the content to
 * be visible, and a mismatch is a manual-action risk, not a clever trick.
 */
export const getFaqSchema = (faqs) => {
  const items = (faqs || []).filter((faq) => faq?.question && faq?.answer)
  if (!items.length) return null

  return {
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    mainEntity: items.map((faq) => ({
      '@type': 'Question',
      name: faq.question,
      acceptedAnswer: { '@type': 'Answer', text: faq.answer },
    })),
  }
}

/**
 * Service, for a solution category.
 *
 * Deliberately NOT LocalBusiness: DevLab Studios operates remotely and
 * serves clients worldwide, so the physical-premises fields a LocalBusiness
 * implies would be misleading. ProfessionalService/Organization plus
 * `areaServed: Worldwide` is what is actually true.
 */
export const getServiceSchema = (service) => ({
  '@context': 'https://schema.org',
  '@type': 'Service',
  name: service.title,
  description: service.description,
  serviceType: service.shortTitle || service.title,
  provider: {
    '@type': 'Organization',
    name: 'DevLab Studios',
    url: 'https://www.devlabstudios.com',
  },
  areaServed: 'Worldwide',
  url: `https://www.devlabstudios.com/solutions#${service.id}`,
  ...(service.capabilities?.length
    ? {
        hasOfferCatalog: {
          '@type': 'OfferCatalog',
          name: `${service.title} capabilities`,
          itemListElement: service.capabilities.map((capability) => ({
            '@type': 'Offer',
            itemOffered: { '@type': 'Service', name: capability },
          })),
        },
      }
    : {}),
})

/** BreadcrumbList. `items` is an ordered [{ name, path }] from the page itself. */
export const getBreadcrumbSchema = (items) => ({
  '@context': 'https://schema.org',
  '@type': 'BreadcrumbList',
  itemListElement: (items || []).map((item, index) => ({
    '@type': 'ListItem',
    position: index + 1,
    name: item.name,
    item: `https://www.devlabstudios.com${item.path}`,
  })),
})

/**
 * Article, for a published insight (SEO-03). Always carries an image (the
 * cover, else the brand logo until the generated social cards exist),
 * datePublished/dateModified, and references the founder and the business by
 * @id rather than repeating them.
 */
export const getArticleSchema = (article) => ({
  '@context': 'https://schema.org',
  '@type': 'Article',
  headline: article.title,
  description: article.summary,
  image: article.coverImageUrl || COMPANY.logo,
  ...(article.publishedAt ? { datePublished: article.publishedAt } : {}),
  ...(article.updatedAt || article.publishedAt ? { dateModified: article.updatedAt || article.publishedAt } : {}),
  author: { '@type': 'Person', '@id': PERSON_ID, name: COMPANY.founder.name, url: `${COMPANY.url}${COMPANY.founder.profilePath}` },
  publisher: { '@type': 'Organization', '@id': ORGANIZATION_ID, name: COMPANY.name, logo: { '@type': 'ImageObject', url: COMPANY.logo } },
  mainEntityOfPage: {
    '@type': 'WebPage',
    '@id': `${COMPANY.url}/insights/${article.slug}`,
  },
})
