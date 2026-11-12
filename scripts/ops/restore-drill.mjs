/**
 * Restore drill for a D1 export (audit OPS-04): loads the SQL dump into a
 * fresh in-memory SQLite database and checks that the tables the site depends
 * on came back with rows. Proves the nightly export is usable, without
 * printing any row content (exports hold personal data).
 *
 *   node scripts/ops/restore-drill.mjs <dump.sql> [table:minRows ...]
 *
 * Exit code 1 if the dump does not load or a required table is missing/empty.
 */
import { readFileSync } from 'node:fs'
import { DatabaseSync } from 'node:sqlite'

const [file, ...requirements] = process.argv.slice(2)
if (!file) {
  console.error('Usage: node scripts/ops/restore-drill.mjs <dump.sql> [table:minRows ...]')
  process.exit(1)
}

const db = new DatabaseSync(':memory:')
db.exec(readFileSync(file, 'utf8'))

const tables = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%' ORDER BY name").all().map((row) => row.name)
console.log(`Restored ${tables.length} tables from ${file}.`)

let failed = false
for (const requirement of requirements) {
  const [table, minRows = '1'] = requirement.split(':')
  if (!tables.includes(table)) {
    console.error(`MISSING table ${table}`)
    failed = true
    continue
  }
  const { n } = db.prepare(`SELECT COUNT(*) AS n FROM "${table.replace(/"/g, '')}"`).get()
  const ok = n >= Number(minRows)
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${table}: ${n} rows (need >= ${minRows})`)
  if (!ok) failed = true
}
process.exit(failed ? 1 : 0)
