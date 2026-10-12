// Loads synthetic mail into the LOCAL D1 so the mailbox e2e suite has
// something to exercise.
//
// WHY THE SUITE NEEDS THIS. Until now the mailbox specs could only test an
// empty mailbox: folder navigation, highlighting, and the 401s on every route.
// Those are worth having, but they cannot reach the screens that only exist
// once mail does — reading a message, loading its remote images, retrying a
// failed reply, or rendering a DMARC report. Four features shipped to
// production with no end-to-end coverage for exactly that reason.
//
// IT REUSES THE PREVIEW SEED rather than defining a second set of fixtures.
// scripts/cms/generate-mailbox-preview-seed.mjs already produces mail covering
// the states that matter, every address is in an RFC 2606 reserved domain, and
// a second copy would drift from it. The same rows that make preview reviewable
// by a person make it testable by Playwright.
//
// This runs BEFORE `wrangler dev` starts (see the `worker` webServer command in
// playwright.config.js) for the reason the pickleball fixture script documents:
// writing to the local D1 SQLite file while miniflare holds it open has been
// observed to drop in-flight connections, surfacing as unrelated specs failing
// with ECONNREFUSED.
//
// The seed deletes its own rows by the 'prev-' id prefix before inserting, so
// re-running across suite runs is a no-op rather than an accumulation.

import { execFileSync } from 'node:child_process'
import { existsSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { deflateRawSync } from 'node:zlib'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import process from 'node:process'

const require = createRequire(import.meta.url)

const SEED = 'scripts/cms/seed/mailbox-preview-seed.sql'
const DATABASE = 'devlab-studios-cms'
const BUCKET = 'devlab-mailbox'

/** Matches the r2_key the seed writes for the DMARC attachment. */
const DMARC_KEY = 'mailbox/att/preview/dmarc.zip'

/**
 * 'wrangler' resolves to <pkg>/wrangler-dist/cli.js; the launcher we want is
 * <pkg>/bin/wrangler.js, two levels up and back down.
 */
function resolveWranglerBin() {
  return join(dirname(require.resolve('wrangler')), '..', 'bin', 'wrangler.js')
}


/**
 * A DMARC aggregate report, zipped the way a receiver sends one.
 *
 * Written into the local R2 so the report view can be exercised for real:
 * fetch, decompress, parse, render. Without the bytes the component would only
 * ever reach its "could not be read" branch, which tests the error path and
 * nothing else.
 *
 * It reports a FAILING source on purpose. The passing case is what production
 * shows every day and what the unit tests already cover; the failing case is
 * the one the screen exists for and the one nobody has seen rendered.
 */
function dmarcReportZip() {
  const xml = `<?xml version="1.0" encoding="UTF-8" ?>
<feedback>
  <report_metadata>
    <org_name>example.net</org_name>
    <email>noreply-dmarc@example.net</email>
    <report_id>e2e-fixture-0001</report_id>
    <date_range><begin>1789948800</begin><end>1790035199</end></date_range>
  </report_metadata>
  <policy_published>
    <domain>devlabconnect.com</domain>
    <adkim>s</adkim><aspf>s</aspf><p>none</p><sp>none</sp><pct>100</pct>
  </policy_published>
  <record>
    <row>
      <source_ip>37.60.237.227</source_ip><count>4</count>
      <policy_evaluated><disposition>none</disposition><dkim>pass</dkim><spf>pass</spf></policy_evaluated>
    </row>
    <identifiers><header_from>devlabconnect.com</header_from></identifiers>
    <auth_results>
      <dkim><domain>devlabconnect.com</domain><result>pass</result><selector>s202609</selector></dkim>
      <spf><domain>devlabconnect.com</domain><result>pass</result></spf>
    </auth_results>
  </record>
  <record>
    <row>
      <source_ip>203.0.113.9</source_ip><count>128</count>
      <policy_evaluated><disposition>none</disposition><dkim>fail</dkim><spf>fail</spf></policy_evaluated>
    </row>
    <identifiers><header_from>devlabconnect.com</header_from></identifiers>
    <auth_results></auth_results>
  </record>
</feedback>`

  const name = Buffer.from('report.xml')
  const raw = Buffer.from(xml)
  const deflated = deflateRawSync(raw)

  const local = Buffer.alloc(30 + name.length)
  local.writeUInt32LE(0x04034b50, 0)
  local.writeUInt16LE(8, 8) // deflate
  local.writeUInt32LE(deflated.length, 18)
  local.writeUInt32LE(raw.length, 22)
  local.writeUInt16LE(name.length, 26)
  name.copy(local, 30)

  const central = Buffer.alloc(46 + name.length)
  central.writeUInt32LE(0x02014b50, 0)
  central.writeUInt16LE(8, 10)
  central.writeUInt32LE(deflated.length, 20)
  central.writeUInt32LE(raw.length, 24)
  central.writeUInt16LE(name.length, 28)
  central.writeUInt32LE(0, 42) // local header offset
  name.copy(central, 46)

  const eocd = Buffer.alloc(22)
  eocd.writeUInt32LE(0x06054b50, 0)
  eocd.writeUInt16LE(1, 8)
  eocd.writeUInt16LE(1, 10)
  eocd.writeUInt32LE(central.length, 12)
  eocd.writeUInt32LE(local.length + deflated.length, 16)

  return Buffer.concat([local, deflated, central, eocd])
}

if (!existsSync(SEED)) {
  // Generated and committed, so a missing file means someone deleted it rather
  // than that it needs building. Say which command restores it.
  console.error(`Missing ${SEED}. Run: npm run cms:seed:mailbox-preview`)
  process.exit(1)
}

// The token the mailbox launcher leaves in the environment is scoped to Email
// Routing on one zone, and wrangler prefers it over its OAuth login — which
// makes a purely LOCAL command fail with a 7403 that has nothing to do with
// anything local. Both variables have to go; clearing only the token is not
// enough.
const env = { ...process.env }
delete env.CLOUDFLARE_API_TOKEN
delete env.CLOUDFLARE_ACCOUNT_ID

// MIGRATIONS FIRST. Nothing else applies them to the local D1, so it sat at
// 0015 while production was on 0016 -- and the upload endpoint failed with a
// generic 500 because mailbox_outbound_attachments did not exist locally. An
// e2e environment a migration behind is worse than none: it reports failures
// that say nothing about the code under test, and it would pass a feature that
// is broken in production for the mirror-image reason. Applying them here keeps
// the suite honest about the schema it is testing against.
execFileSync(process.execPath, [resolveWranglerBin(), 'd1', 'migrations', 'apply', DATABASE, '--local'], {
  stdio: 'inherit',
  env,
})

execFileSync(process.execPath, [resolveWranglerBin(), 'd1', 'execute', DATABASE, '--local', `--file=${SEED}`], {
  stdio: 'inherit',
  env,
})

const scratch = mkdtempSync(join(tmpdir(), 'mailbox-e2e-'))
const zipPath = join(scratch, 'dmarc.zip')
writeFileSync(zipPath, dmarcReportZip())

execFileSync(
  process.execPath,
  [resolveWranglerBin(), 'r2', 'object', 'put', `${BUCKET}/${DMARC_KEY}`, `--file=${zipPath}`, '--local'],
  { stdio: 'inherit', env },
)

console.log('Mailbox e2e fixtures applied to the local D1 and R2.')
