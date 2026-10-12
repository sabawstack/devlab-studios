// src/pickleball-open/lib/shareResults.test.js
import { describe, expect, it, vi } from 'vitest'
import { shareResults } from './shareResults'

const DATA = { title: 'Final standings · Sunday', text: '🏆 Sunday — final standings\nFull results: https://x.test/pickleball/s/ABC', url: 'https://x.test/pickleball/s/ABC' }

describe('shareResults', () => {
  it('uses the Web Share API with title, text and url when there is one', async () => {
    const share = vi.fn().mockResolvedValue(undefined)
    const writeText = vi.fn()
    expect(await shareResults(DATA, { share, clipboard: { writeText } })).toEqual({ kind: 'shared' })
    expect(share).toHaveBeenCalledWith(DATA)
    expect(writeText).not.toHaveBeenCalled()
  })

  it('does nothing more when the person closes the share sheet', async () => {
    const share = vi.fn().mockRejectedValue(Object.assign(new Error('cancel'), { name: 'AbortError' }))
    const writeText = vi.fn()
    expect(await shareResults(DATA, { share, clipboard: { writeText } })).toEqual({ kind: 'cancelled' })
    expect(writeText).not.toHaveBeenCalled()
  })

  it('copies the text (which ends with the link) when there is no share sheet', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    expect(await shareResults(DATA, { clipboard: { writeText } })).toEqual({ kind: 'copied' })
    expect(writeText).toHaveBeenCalledWith(DATA.text)
  })

  it('falls back to copying when sharing fails for another reason', async () => {
    const share = vi.fn().mockRejectedValue(Object.assign(new Error('nope'), { name: 'NotAllowedError' }))
    const writeText = vi.fn().mockResolvedValue(undefined)
    expect(await shareResults(DATA, { share, clipboard: { writeText } })).toEqual({ kind: 'copied' })
  })

  it('reports a failure when the copy is refused or there is no clipboard', async () => {
    expect(await shareResults(DATA, { clipboard: { writeText: vi.fn().mockRejectedValue(new Error('denied')) } })).toEqual({ kind: 'failed' })
    expect(await shareResults(DATA, {})).toEqual({ kind: 'failed' })
    expect(await shareResults(DATA, undefined)).toEqual({ kind: 'failed' })
  })
})
