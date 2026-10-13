import { describe, expect, it } from 'vitest'
import { isAdminApiPath, routePath } from './routePath'

describe('routePath', () => {
  it('leaves a plain path alone', () => {
    expect(routePath('/api/admin/session')).toBe('/api/admin/session')
  })

  it('decodes percent-escapes so an encoded admin path is still recognised', () => {
    expect(routePath('/api/%61dmin/session')).toBe('/api/admin/session')
    expect(routePath('/api/%41DMIN/session')).toBe('/api/ADMIN/session')
    expect(routePath('/api/admin%2Fsession')).toBe('/api/admin/session')
  })

  it('decodes double encoding', () => {
    expect(routePath('/api/%2561dmin/session')).toBe('/api/admin/session')
  })

  it('collapses repeated slashes and backslashes', () => {
    expect(routePath('/api//admin///session')).toBe('/api/admin/session')
    expect(routePath('/api\\admin\\session')).toBe('/api/admin/session')
  })

  it('refuses malformed or still-encoded paths', () => {
    expect(routePath('/api/%E0%A4%A')).toBeNull()
    expect(routePath('/api/%25252561dmin')).toBeNull()
  })
})

describe('isAdminApiPath', () => {
  it('matches the admin API and everything below it in any letter case', () => {
    expect(isAdminApiPath('/api/admin')).toBe(true)
    expect(isAdminApiPath('/api/admin/leads')).toBe(true)
    expect(isAdminApiPath('/API/Admin/leads')).toBe(true)
  })

  it('does not match neighbours', () => {
    expect(isAdminApiPath('/api/administrator')).toBe(false)
    expect(isAdminApiPath('/api/contact')).toBe(false)
    expect(isAdminApiPath('/admin')).toBe(false)
  })
})
