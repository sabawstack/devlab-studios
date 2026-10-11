//
// TEST-ONLY. A minimal D1 stand-in over node:sqlite so repository code can be
// exercised by vitest against the real migration SQL. Never imported by
// application code (nothing outside *.test.ts may import this file).
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'

type Bindable = string | number | null

class Statement {
  constructor(
    private readonly db: DatabaseSync,
    private readonly sql: string,
    private readonly params: readonly Bindable[] = [],
  ) {}

  bind(...params: Bindable[]): Statement {
    return new Statement(this.db, this.sql, params)
  }

  async all<T>(): Promise<{ results: T[]; success: true; meta: Record<string, never> }> {
    return { results: this.db.prepare(this.sql).all(...this.params) as T[], success: true, meta: {} }
  }

  async first<T>(): Promise<T | null> {
    return (this.db.prepare(this.sql).get(...this.params) as T | undefined) ?? null
  }

  async run(): Promise<{ success: true; meta: { changes: number } }> {
    const result = this.db.prepare(this.sql).run(...this.params)
    return { success: true, meta: { changes: Number(result.changes) } }
  }

  runSync(): { changes: number } {
    const result = this.db.prepare(this.sql).run(...this.params)
    return { changes: Number(result.changes) }
  }
}

export function createSqliteD1(migrationFiles: readonly string[]): { d1: D1Database; raw: DatabaseSync } {
  const raw = new DatabaseSync(':memory:')
  raw.exec('PRAGMA foreign_keys = ON')
  for (const file of migrationFiles) raw.exec(readFileSync(join(process.cwd(), file), 'utf8'))

  const d1 = {
    prepare: (sql: string) => new Statement(raw, sql),
    batch: async (statements: Statement[]) => {
      raw.exec('BEGIN')
      try {
        const results = statements.map((statement) => statement.runSync())
        raw.exec('COMMIT')
        return results.map((result) => ({ success: true, meta: { changes: result.changes } }))
      } catch (error) {
        raw.exec('ROLLBACK')
        throw error
      }
    },
  }
  return { d1: d1 as unknown as D1Database, raw }
}
