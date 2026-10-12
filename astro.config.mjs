import { defineConfig } from 'astro/config'
import cloudflare from '@astrojs/cloudflare'
import react from '@astrojs/react'
import tailwind from '@astrojs/tailwind'

// The e2e static preview server gets its own local state so it never shares
// D1 files with `wrangler dev` -- see scripts/e2e/snapshot-static-state.mjs.
// Unset everywhere else, which keeps the default `.wrangler/state`.
const staticE2EPersist = process.env.E2E_STATIC_PERSIST

export default defineConfig({
  output: 'server',
  adapter: cloudflare(staticE2EPersist ? { persistState: { path: staticE2EPersist } } : {}),
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
      noExternal: ['react-helmet-async', 'react-router-dom', 'react-router', 'lucide-react', 'clsx'],
    },
  },
})
