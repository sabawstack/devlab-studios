import { getProfileContent } from '../../worker/repositories/content.js'
import { getStaticProfileContent } from '../../data/profileContent.js'
import { getEnv } from '../env'
import { optimizeImage, type OptimizedPicture } from '../images/optimizeImage'
import type { ImageMetadata } from 'astro'
import zapierBadge from '../../assets/certificates/Zapier_Certificate.png'
import makeBadge from '../../assets/certificates/Make_Certificate.png'
import n8nBadge from '../../assets/certificates/N8N_Certificate.png'
import highLevelBadge from '../../assets/certificates/HighLevelCertificate.png'
import { sanitizeLinkFields } from '../safeHref'

const BADGE_IMAGES: Record<string, ImageMetadata> = {
  'cert-zapier-no-code-automation': zapierBadge,
  'cert-make-no-code-automation': makeBadge,
  'cert-n8n-ai-automation': n8nBadge,
  'cert-highlevel-crm': highLevelBadge,
}

export interface AboutData {
  name?: string
  role?: string
  location?: string
  email?: string
  about?: string
  education?: Array<{ school: string; program: string; years: string }>
  achievementsAndResponsibilities?: Array<{ title: string; details: string }>
  certificatesAndLicenses?: Array<{ name: string; issuer: string | null; date: string | null }>
  [key: string]: unknown
}

export interface ExperienceItem {
  id: string
  title: string
  role: string
  company: string
  dates: string
  bullets: string[]
}

export interface CertificationItem {
  id: string
  name: string
  issuer: string
  issuedDate: string
  credentialUrl: string
  badgeImageUrl: string
  badgeSource?: ImageMetadata | string
  badgeImage?: OptimizedPicture | null
  badgeImageFull?: OptimizedPicture | null
  sortOrder: number
}

export interface ProfileContentData {
  about: AboutData
  experiences: ExperienceItem[]
  skills: { technical: string[]; personal: string[] }
  tools: unknown[]
  workflowPatterns: unknown[]
  systemCharacteristics: unknown[]
  certifications?: CertificationItem[]
}

// All four local certificate badges share a ~1.414:1 (document/ISO-216)
// aspect ratio — matching it here means `fit: 'contain'` needs no
// letterboxing, so the declared width/height match what's actually visible.
const BADGE_IMAGE_SIZE = { width: 240, height: 170, fit: 'contain' as const }
const BADGE_IMAGE_FULL_SIZE = { width: 1400, height: 990, fit: 'contain' as const }

function resolveBadgeImages(data: ProfileContentData): ProfileContentData {
  return {
    ...data,
    certifications: (data.certifications || []).map((cert) => {
      const localBadge = BADGE_IMAGES[cert.id]
      return {
        ...cert,
        badgeImageUrl: cert.badgeImageUrl || localBadge?.src || '',
        badgeSource: cert.badgeImageUrl || localBadge,
      }
    }),
  }
}

async function attachOptimizedBadges(data: ProfileContentData): Promise<ProfileContentData> {
  return {
    ...data,
    certifications: await Promise.all(
      (data.certifications || []).map(async (cert) => ({
        ...cert,
        badgeImage: await optimizeImage(cert.badgeSource, BADGE_IMAGE_SIZE),
        badgeImageFull: await optimizeImage(cert.badgeSource, BADGE_IMAGE_FULL_SIZE),
      })),
    ),
  }
}

const staticProfileContent = resolveBadgeImages(getStaticProfileContent() as ProfileContentData)

function hasContent(data: Partial<ProfileContentData> | null | undefined): boolean {
  return Boolean(
    data?.about?.name ||
      (Array.isArray(data?.experiences) && data.experiences.length > 0) ||
      (Array.isArray(data?.skills?.technical) && data.skills.technical.length > 0),
  )
}

/** Server-side equivalent of the old useProfileContent() client hook. */
export async function loadProfileContent(): Promise<ProfileContentData> {
  const env = getEnv()
  if (!env.DB) return attachOptimizedBadges(staticProfileContent)

  try {
    // Profile/certification links re-checked at read time; see src/lib/safeHref.ts.
    const data = sanitizeLinkFields(await getProfileContent(env.DB))
    if (!hasContent(data)) return await attachOptimizedBadges(staticProfileContent)
    return await attachOptimizedBadges(resolveBadgeImages(data as ProfileContentData))
  } catch {
    return attachOptimizedBadges(staticProfileContent)
  }
}
