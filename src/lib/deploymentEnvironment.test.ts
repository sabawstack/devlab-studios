import { describe, expect, it } from 'vitest'
import { deploymentEnvironment } from './deploymentEnvironment'

describe('deploymentEnvironment (ADMIN-09)', () => {
  it('trusts the deployment variable', () => {
    expect(deploymentEnvironment('preview', 'devlab-studios-preview.example.workers.dev')).toBe('preview')
    expect(deploymentEnvironment('production', 'www.devlabstudios.com')).toBe('production')
  })
  it('a localhost request is local even with production vars', () => {
    expect(deploymentEnvironment('production', 'localhost')).toBe('local')
    expect(deploymentEnvironment(undefined, '127.0.0.1')).toBe('local')
  })
  it('falls back to the hostname when the variable is unset or unknown', () => {
    expect(deploymentEnvironment(undefined, 'www.devlabstudios.com')).toBe('production')
    expect(deploymentEnvironment('staging', 'something.workers.dev')).toBe('preview')
  })
})
