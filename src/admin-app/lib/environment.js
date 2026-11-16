// Which deployment the Admin is talking to (ADMIN-09). The session answer
// (`environment`, from the deployment's own variable) wins; before sign-in, or
// against an older server, the browser's hostname decides.
const LABELS = { production: 'Production', preview: 'Preview', local: 'Local' }

export function environmentFromHostname(hostname) {
  if (hostname === 'localhost' || hostname === '127.0.0.1') return 'local'
  if (hostname === 'www.devlabstudios.com' || hostname === 'devlabstudios.com') return 'production'
  return 'preview'
}

/** { key, label } for a session (or none yet). */
export function currentEnvironment(session, hostname = globalThis.location?.hostname ?? '') {
  const key = LABELS[session?.environment] ? session.environment : environmentFromHostname(hostname)
  return { key, label: LABELS[key] }
}
