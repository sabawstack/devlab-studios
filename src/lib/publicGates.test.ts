import { describe, expect, it, vi } from 'vitest'
import { readMaintenanceMode, findRedirectSafely } from './publicGates'

function dbReturning(row: unknown) {
  return {
    prepare: () => ({ bind: () => ({ first: async () => row }) }),
  } as unknown as D1Database
}

function dbThrowing(message = 'D1_ERROR: no such table: site_settings') {
  return {
    prepare: () => ({
      bind: () => ({
        first: async () => {
          throw new Error(message)
        },
      }),
    }),
  } as unknown as D1Database
}

describe('readMaintenanceMode', () => {
  it('is off when there is no database binding', async () => {
    expect(await readMaintenanceMode(undefined)).toBe(false)
  })

  it('reads the stored flag', async () => {
    expect(await readMaintenanceMode(dbReturning({ value_json: 'true' }))).toBe(true)
    expect(await readMaintenanceMode(dbReturning({ value_json: 'false' }))).toBe(false)
  })

  it('fails open (site stays up) when the database read throws', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {})
    expect(await readMaintenanceMode(dbThrowing())).toBe(false)
    expect(log).toHaveBeenCalled()
    log.mockRestore()
  })
})

describe('findRedirectSafely', () => {
  it('returns null without a database binding', async () => {
    expect(await findRedirectSafely(undefined, '/old')).toBeNull()
  })

  it('returns null instead of throwing when the database read fails', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {})
    expect(await findRedirectSafely(dbThrowing(), '/old')).toBeNull()
    log.mockRestore()
  })

  it('returns a stored redirect', async () => {
    const row = { id: 'r1', from_path: '/old', to_path: '/new', status_code: 301, note: '', created_at: '', updated_at: '' }
    const redirect = await findRedirectSafely(dbReturning(row), '/old')
    expect(redirect).toMatchObject({ toPath: '/new', statusCode: 301 })
  })
})
