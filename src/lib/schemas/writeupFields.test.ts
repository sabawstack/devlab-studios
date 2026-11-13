import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import { projectEditorialFields } from './collections'
import { buildWorkEntries } from '../content/workEntries'

// CMS-01: the write-up fields' validation and their path to the public page.
const fields = z.object(projectEditorialFields)

describe('write-up field validation (CMS-01)', () => {
  it('defaults every field to empty', () => {
    expect(fields.parse({})).toMatchObject({ situation: '', decisions: [], scope: '', inOperationSince: '' })
  })

  it('accepts year-month or a full date for "in operation since", and nothing else', () => {
    for (const value of ['', '2026-04', '2026-04-30']) expect(fields.safeParse({ inOperationSince: value }).success, value).toBe(true)
    for (const value of ['April 2026', '2026-13', '26-04', '2026-04-32']) expect(fields.safeParse({ inOperationSince: value }).success, value).toBe(false)
  })

  it('caps decisions at four, each one line', () => {
    expect(fields.safeParse({ decisions: ['a', 'b', 'c', 'd', 'e'] }).success).toBe(false)
    expect(fields.safeParse({ decisions: ['x'.repeat(201)] }).success).toBe(false)
  })
})

describe('write-up fields reach the work entry', () => {
  const project = { id: 'p10-automated-lead-qualification', title: 'Lead qualification', description: 'd', type: 'Automation' }
  const item = { status: 'published', projectId: project.id, description: 'Summary' }

  it('carries the written fields, trimmed, and empty values when unwritten', () => {
    const [written] = buildWorkEntries([item], [{ ...project, situation: 'A property firm.', decisions: [' Rules route ', ''], scope: 'We built the flow.', inOperationSince: '2026-04' }])
    expect(written).toMatchObject({ situation: 'A property firm.', decisions: ['Rules route'], scope: 'We built the flow.', inOperationSince: '2026-04' })
    const [unwritten] = buildWorkEntries([item], [project])
    expect(unwritten).toMatchObject({ situation: '', decisions: [], scope: '', inOperationSince: '' })
  })
})
