/**
 * Moves stored media URLs from one host to another (audit OPS-07), e.g. from
 * the pub-*.r2.dev development URL to https://media.devlabstudios.com.
 *
 * DRY RUN by default: prints how many values in each column would change.
 * With --apply it rewrites them with REPLACE() in every place a media URL is
 * stored (the same places src/worker/repositories/mediaAssets.js
 * replaceMediaReferences updates). Reversible: run again with --from and --to
 * swapped. Take a backup first (OPS-04) and keep the old host serving until
 * every image is verified on the new one.
 *
 *   node scripts/cms/media-domain-rewrite.mjs --env preview --from https://pub-xxx.r2.dev --to https://media-preview.devlabstudios.com
 *   node scripts/cms/media-domain-rewrite.mjs --env preview --from ... --to ... --apply
 *
 * Production needs a token: CLOUDFLARE_API_TOKEN=<fresh token> node ... --env production ...
 */
import { execFileSync } from 'node:child_process'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const args = process.argv.slice(2)
const value = (flag) => {
  const index = args.indexOf(flag)
  return index >= 0 ? args[index + 1] : null
}
const env = value('--env')
const from = value('--from')
const to = value('--to')
const apply = args.includes('--apply')

const isOrigin = (url) => /^https:\/\/[a-z0-9.-]+$/i.test(url || '')
if (!['preview', 'production'].includes(env) || !isOrigin(from) || !isOrigin(to) || from === to) {
  console.error('Usage: node scripts/cms/media-domain-rewrite.mjs --env preview|production --from https://old.host --to https://new.host [--apply]')
  process.exit(1)
}

/** [table, column] pairs that can hold a media URL. */
export const MEDIA_COLUMNS = [
  ['projects', 'image_url'],
  ['project_gallery_images', 'url'],
  ['articles', 'cover_image_url'],
  ['certifications', 'badge_image_url'],
  ['experiences', 'image_url'],
  ['testimonials', 'author_photo_url'],
  ['case_studies', 'cover_image_url'],
  ['case_studies', 'screenshots_json'],
  ['page_sections', 'content_json'],
  ['site_settings', 'value_json'],
  ['seo_metadata', 'og_image'],
  ['seo_metadata', 'twitter_image'],
  ['media_assets', 'url'],
]

const database = env === 'preview' ? 'devlab-studios-cms-preview' : 'devlab-studios-cms'
const quote = (text) => `'${text.replace(/'/g, "''")}'`
const prefix = `${from}/`

function wrangler(extra) {
  const wranglerArgs = ['wrangler', 'd1', 'execute', database, '--remote', ...extra]
  if (env === 'preview') wranglerArgs.push('--env', 'preview')
  return execFileSync('npx', wranglerArgs, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'] })
}

/** One read-only statement, JSON result. */
function query(sql) {
  return JSON.parse(wrangler(['--json', '--command', sql]))
}

/** Several write statements from a file (wrangler prints progress, not JSON). */
function execute(sql) {
  const file = join(mkdtempSync(join(tmpdir(), 'media-rewrite-')), 'statement.sql')
  writeFileSync(file, sql)
  wrangler(['--file', file, '--yes'])
}

// One query per column: D1 limits the number of terms in a compound SELECT.
const countAll = () => MEDIA_COLUMNS.map(([table, column]) => ({
  place: `${table}.${column}`,
  n: Number(query(`SELECT COUNT(*) AS n FROM ${table} WHERE INSTR(${column}, ${quote(prefix)}) > 0`)[0]?.results?.[0]?.n ?? 0),
}))
const before = countAll()
console.log(`${apply ? 'Rewriting' : 'Dry run'}: ${from} -> ${to} on ${database}`)
for (const row of before) console.log(`  ${row.place}: ${row.n}`)

if (apply) {
  const updates = MEDIA_COLUMNS.map(([table, column]) =>
    `UPDATE ${table} SET ${column} = REPLACE(${column}, ${quote(prefix)}, ${quote(`${to}/`)}) WHERE INSTR(${column}, ${quote(prefix)}) > 0;`).join('\n')
  execute(updates)
  const after = countAll()
  const left = after.reduce((total, row) => total + Number(row.n), 0)
  console.log(left === 0 ? 'Done: no stored URL uses the old host.' : `WARNING: ${left} values still use the old host.`)
  if (left !== 0) process.exit(1)
}
