import { brandingAssets } from '../config/branding'
import { useSiteSettingsContent } from '../hooks/useSiteSettingsContent'
import { COMPANY, publicContactEmail } from '../config/company.js'

function Footer() {
  const siteSettings = useSiteSettingsContent()
  const footer = siteSettings.footer || {}
  const quickLinks = footer.quickLinks || []
  const socialLinks = footer.socialLinks || []

  return (
    <footer className="mt-16 border-t border-slate-200/80 bg-white/85 backdrop-blur-sm">
      <div className="mx-auto max-w-7xl px-4 py-8 text-sm text-slate-600 sm:px-6 lg:px-6">
        <div className="flex flex-col gap-8 text-center md:flex-row md:items-start md:justify-between md:text-left">
          <div className="mb-4 flex flex-1 flex-col items-center md:mb-0 md:items-start">
            <img
              src={brandingAssets.logoSideUrl}
              alt="DevLab Studios"
              className="mb-3 h-12 w-auto object-contain"
              loading="lazy"
              onError={(event) => {
                event.currentTarget.style.display = 'none'
              }}
            />
            <p className="mb-1 text-lg font-semibold text-brand-ink">{footer.companyName || 'DevLab Studios'}</p>
            <p className="mb-3 whitespace-normal text-slate-500 md:whitespace-nowrap">
              {String(footer.tagline || COMPANY.description).replace(' - ', ' — ')}
            </p>
            <a href={`mailto:${publicContactEmail(footer.email)}`} className="mb-1 block text-slate-700 hover:text-brand-teal hover:underline">
              {publicContactEmail(footer.email)}
            </a>
            <span className="block text-slate-500">{footer.location || 'Lapu-Lapu City, Cebu, PH'}</span>
          </div>

          <div className="mb-4 flex flex-1 flex-col items-center md:mb-0">
            <p className="mb-2 font-semibold text-brand-ink">Quick Links</p>
            <ul className="space-y-1">
              {quickLinks.map((item) => (
                <li key={`${item.label}-${item.href}`}>
                  <a href={item.href} className="hover:text-brand-teal hover:underline">
                    {item.label}
                  </a>
                </li>
              ))}
            </ul>
          </div>

          <div className="flex flex-1 flex-col items-center md:items-end">
            <p className="mb-2 font-semibold text-brand-ink">Connect</p>
            <div className="flex gap-4">
              {socialLinks.map((item) => (
                <a
                  key={`${item.label}-${item.href}`}
                  href={item.href}
                  target={item.href.startsWith('http') ? '_blank' : undefined}
                  rel={item.href.startsWith('http') ? 'noopener noreferrer' : undefined}
                  aria-label={item.label}
                  className="hover:text-brand-teal"
                >
                  {item.label}
                </a>
              ))}
            </div>
          </div>
        </div>
        <div className="mt-8 flex flex-col gap-2 border-t border-slate-200 pt-4 text-center text-xs text-slate-500 md:flex-row md:items-center md:justify-between md:text-left">
          <span>{footer.copyright || '© 2026 DevLab Studios. All rights reserved.'}</span>
          <span>{footer.legalText || 'Privacy Policy | Terms of Service'}</span>
        </div>
      </div>
    </footer>
  )
}

export default Footer
