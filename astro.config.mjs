import { defineConfig } from 'astro/config'
import cloudflare from '@astrojs/cloudflare'
import react from '@astrojs/react'
import tailwind from '@astrojs/tailwind'
import { SCRIPT_SOURCES } from './src/config/cspSources.js'

// The e2e static preview server gets its own local state so it never shares
// D1 files with `wrangler dev` -- see scripts/e2e/snapshot-static-state.mjs.
// Unset everywhere else, which keeps the default `.wrangler/state`.
//
// The e2e server also runs with remote bindings off. Workers AI is always a
// remote binding, so with them on the preview opens a proxy session to the
// Cloudflare account -- which fails without a login (CI) or when the login
// can see more than one account, and would bill AI calls for a test run. No
// public page calls AI (only the daily digest cron does).
const staticE2EPersist = process.env.E2E_STATIC_PERSIST

export default defineConfig({
  output: 'server',
  adapter: cloudflare(
    staticE2EPersist ? { persistState: { path: staticE2EPersist }, remoteBindings: false } : {},
  ),
  // SEC-07: a CSP <meta> on every page with a hash for each script Astro
  // renders, so inline scripts need no 'unsafe-inline'. Styles keep
  // 'unsafe-inline' (server-rendered style attributes such as scene aspect
  // ratios need it), which also tells Astro not to emit style hashes.
  security: {
    csp: {
      scriptDirective: { resources: SCRIPT_SOURCES },
      styleDirective: { resources: ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'] },
    },
  },
  image: {
    remotePatterns: [
      { protocol: 'https', hostname: 'pub-401ca3448c3348158cdb3e4e9a9dcb20.r2.dev' },
      { protocol: 'https', hostname: 'pub-2450236b7cbf4d68aa4bc07f9b606e29.r2.dev' },
    ],
  },
  integrations: [
    react(),
    tailwind({ applyBaseStyles: false }),
  ],
  vite: {
    ssr: {
      noExternal: ['react-router-dom', 'react-router', 'lucide-react', 'clsx'],
    },
  },
})
