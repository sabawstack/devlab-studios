/**
 * READ-ONLY. Lists the projects in the static fallback (src/data/projectRecords.js)
 * that are missing from a D1 `projects` table (audit CMS-02).
 *
 * The public site used to append every static project that D1 did not have,
 * so deleting a project in the admin never removed it from the site. Once D1
 * is the only source, those projects disappear from Work, Solutions and the
 * Profile. Run this first so the owner can decide which to seed (with the
 * upsert in scripts/cms/seed/project-seed.sql, preview first -- never the full
 * seed against a populated database).
 *
 *   node scripts/cms/static-projects-missing-from-d1.mjs --env preview
 *   node scripts/cms/static-projects-missing-from-d1.mjs --env production
 *   node scripts/cms/static-projects-missing-from-d1.mjs --local
 *
 * Runs one SELECT through wrangler; never writes. Needs a wrangler login (or
 * CLOUDFLARE_API_TOKEN) with read access for --env; set CLOUDFLARE_ACCOUNT_ID
 * when the login can see more than one account.
 */
import { execFileSync } from 'node:child_process'
import { projectRecords } from '../../src/data/projectRecords.js'

const args = process.argv.slice(2)
const local = args.includes('--local')
const envIndex = args.indexOf('--env')
const env = envIndex >= 0 ? args[envIndex + 1] : null

if (!local && !['preview', 'production'].includes(env)) {
  console.error('Usage: node scripts/cms/static-projects-missing-from-d1.mjs (--env preview|production | --local)')
  process.exit(1)
}

const database = env === 'preview' ? 'devlab-studios-cms-preview' : 'devlab-studios-cms'
const wranglerArgs = ['wrangler', 'd1', 'execute', database, '--json', '--command', 'SELECT id, title, status FROM projects ORDER BY id']
if (local) wranglerArgs.push('--local')
else wranglerArgs.push('--remote')
if (env === 'preview') wranglerArgs.push('--env', 'preview')

const output = execFileSync('npx', wranglerArgs, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'] })
const rows = JSON.parse(output)[0]?.results ?? []
const inD1 = new Map(rows.map((row) => [row.id, row]))

const missing = projectRecords.filter((record) => !inD1.has(record.id))
const d1Only = rows.filter((row) => !projectRecords.some((record) => record.id === row.id))

console.log(`D1 ${local ? 'local' : env}: ${rows.length} projects (${rows.filter((row) => row.status === 'published').length} published)`)
console.log(`Static fallback: ${projectRecords.length} projects`)
console.log(`\nIn the static fallback but NOT in D1 (would disappear from the site): ${missing.length}`)
for (const record of missing) console.log(`  ${record.id}  ${record.title}`)
console.log(`\nIn D1 but not in the static fallback: ${d1Only.length}`)
for (const row of d1Only) console.log(`  ${row.id}  ${row.title} [${row.status}]`)
