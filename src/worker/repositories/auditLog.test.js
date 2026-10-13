import { afterEach, describe, expect, it, vi } from 'vitest'
import { logAuditFailure, recordAuditEvent } from './auditLog.js'

afterEach(() => {
  vi.restoreAllMocks()
})

describe('audit log write failures are visible', () => {
  it('logs a structured error instead of dropping the failure silently', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    const db = {
      prepare() {
        return { bind() { return this }, async run() { throw new Error('D1_ERROR: no such table: audit_log') } }
      },
    }

    await recordAuditEvent(db, { action: 'delete', entityType: 'media', entityId: 'k' }).catch(logAuditFailure)

    expect(error).toHaveBeenCalledOnce()
    const logged = JSON.parse(error.mock.calls[0][0])
    expect(logged).toMatchObject({ event: 'audit_log_write', outcome: 'failure' })
    expect(logged.errorMessage).toContain('no such table')
  })

  it('handles non-Error rejections', () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    logAuditFailure('boom')
    expect(JSON.parse(error.mock.calls[0][0]).errorMessage).toBe('boom')
  })
})
