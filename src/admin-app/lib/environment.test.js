import { describe, expect, it } from 'vitest'
import { currentEnvironment, environmentFromHostname } from './environment'

describe('admin environment (ADMIN-09)', () => {
  it('falls back to the hostname', () => {
    expect(environmentFromHostname('localhost')).toBe('local')
    expect(environmentFromHostname('www.devlabstudios.com')).toBe('production')
    expect(environmentFromHostname('devlab-studios-preview.stpnrey-agustinez.workers.dev')).toBe('preview')
  })

  it("prefers the deployment's own answer from the session", () => {
    expect(currentEnvironment({ environment: 'preview' }, 'www.devlabstudios.com')).toEqual({ key: 'preview', label: 'Preview' })
    expect(currentEnvironment({ environment: 'nonsense' }, 'localhost')).toEqual({ key: 'local', label: 'Local' })
    expect(currentEnvironment(null, 'www.devlabstudios.com')).toEqual({ key: 'production', label: 'Production' })
  })
})
