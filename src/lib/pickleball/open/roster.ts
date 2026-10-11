import { LIMITS } from './types'

// "1." "12)" "3 -" "-" "*" "•" "·" "–" "—" at the start of a line.
const LIST_MARKER = /^\s*(?:\d+\s*[.):-]|[-*•·–—])\s*/u
const PICTOGRAPHIC = /[\p{Extended_Pictographic}\u{FE0F}\u{200D}\u{20E3}]/gu
// eslint-disable-next-line no-control-regex
const CONTROL = /[\u0000-\u001F\u007F]/g
const DUPR_ID = /^[A-Z0-9]{6}$/

export interface RosterEntry {
  name: string
  skill: number | null
  duprId: string | null
}

export function cleanName(raw: string): string {
  return raw
    .replace(LIST_MARKER, '')
    .replace(PICTOGRAPHIC, '')
    .replace(CONTROL, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, LIMITS.maxNameLength)
    .trim()
}

function seenSet(existing: readonly string[]): Set<string> {
  return new Set(existing.map((name) => name.toLocaleLowerCase()))
}

export function parseRoster(text: string, existing: readonly string[] = []): { names: string[]; duplicates: string[] } {
  const seen = seenSet(existing)
  const names: string[] = []
  const duplicates: string[] = []
  for (const line of text.split(/\r?\n/)) {
    for (const part of line.replace(LIST_MARKER, '').split(',')) {
      const name = cleanName(part)
      if (!name) continue
      const key = name.toLocaleLowerCase()
      if (seen.has(key)) {
        duplicates.push(name)
        continue
      }
      seen.add(key)
      names.push(name)
    }
  }
  return { names, duplicates }
}

function unquote(cell: string): string {
  return cell.trim().replace(/^"(.*)"$/, '$1').trim()
}

export function parseRosterCsv(
  text: string,
  existing: readonly string[] = [],
): { entries: RosterEntry[]; duplicates: string[]; warnings: string[] } {
  const seen = seenSet(existing)
  const entries: RosterEntry[] = []
  const duplicates: string[] = []
  const warnings: string[] = []

  text.split(/\r?\n/).forEach((line, index) => {
    if (!line.trim()) return
    const cells = line.split(',').map(unquote)
    if (index === 0 && cells[0]?.toLowerCase() === 'name') return
    const name = cleanName(cells[0] ?? '')
    if (!name) return
    const key = name.toLocaleLowerCase()
    if (seen.has(key)) {
      duplicates.push(name)
      return
    }
    seen.add(key)

    const skillRaw = cells[1] ?? ''
    let skill: number | null = null
    if (skillRaw) {
      const value = Number(skillRaw)
      if (Number.isFinite(value) && value >= 1 && value <= 8) skill = Math.round(value * 100) / 100
      else warnings.push(`Line ${index + 1}: skill "${skillRaw}" ignored (use 1 to 8).`)
    }

    const duprRaw = (cells[2] ?? '').toUpperCase()
    let duprId: string | null = null
    if (duprRaw) {
      if (DUPR_ID.test(duprRaw)) duprId = duprRaw
      else warnings.push(`Line ${index + 1}: DUPR ID "${cells[2]}" ignored (6 letters or digits).`)
    }

    entries.push({ name, skill, duprId })
  })

  return { entries, duplicates, warnings }
}
