// Which deployment answered (ADMIN-09). The deployment's own variable decides;
// a localhost request is always "local" (wrangler dev reads the production
// vars), and an unset or unknown value falls back to the hostname.
export type DeploymentEnvironment = 'production' | 'preview' | 'local'

export function deploymentEnvironment(configured: string | undefined, hostname: string): DeploymentEnvironment {
  if (hostname === 'localhost' || hostname === '127.0.0.1') return 'local'
  if (configured === 'production' || configured === 'preview') return configured
  return hostname === 'www.devlabstudios.com' || hostname === 'devlabstudios.com' ? 'production' : 'preview'
}
