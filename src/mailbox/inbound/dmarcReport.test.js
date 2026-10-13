import { describe, expect, it } from 'vitest'
import { decompressReport, looksLikeDmarcReport, parseDmarcReport } from './dmarcReport.js'

/**
 * The report in REPORT below is the first one this domain ever received, from
 * Google on 2026-09-22, byte for byte. It is here rather than a hand-written
 * fixture because a parser tested only against input its author invented
 * matches the author's idea of the format.
 */

const REPORT = `<?xml version="1.0" encoding="UTF-8" ?>
<feedback>
  <version>1.0</version>
  <report_metadata>
    <org_name>google.com</org_name>
    <email>noreply-dmarc-support@google.com</email>
    <extra_contact_info>https://support.google.com/a/answer/2466580</extra_contact_info>
    <report_id>775778697018431196</report_id>
    <date_range>
      <begin>1789948800</begin>
      <end>1790035199</end>
    </date_range>
  </report_metadata>
  <policy_published>
    <domain>devlabconnect.com</domain>
    <adkim>s</adkim>
    <aspf>s</aspf>
    <p>none</p>
    <sp>none</sp>
    <pct>100</pct>
    <np>none</np>
  </policy_published>
  <record>
    <row>
      <source_ip>37.60.237.227</source_ip>
      <count>1</count>
      <policy_evaluated>
        <disposition>none</disposition>
        <dkim>pass</dkim>
        <spf>pass</spf>
      </policy_evaluated>
    </row>
    <identifiers>
      <header_from>devlabconnect.com</header_from>
    </identifiers>
    <auth_results>
      <dkim>
        <domain>devlabconnect.com</domain>
        <result>pass</result>
        <selector>s202609</selector>
      </dkim>
      <spf>
        <domain>devlabconnect.com</domain>
        <result>pass</result>
      </spf>
    </auth_results>
  </record>
</feedback>`

describe('recognising a report', () => {
  it('accepts the shapes receivers actually send', () => {
    expect(looksLikeDmarcReport({ filename: 'google.com!x!1!2.zip' })).toBe(true)
    expect(looksLikeDmarcReport({ filename: 'report.xml.gz' })).toBe(true)
    expect(looksLikeDmarcReport({ filename: 'report.xml' })).toBe(true)
    // Content type alone, because plenty of senders label a zip octet-stream
    // and plenty label it correctly while naming the file oddly.
    expect(looksLikeDmarcReport({ filename: 'report', contentType: 'application/gzip' })).toBe(true)
  })

  it('ignores an ordinary attachment', () => {
    expect(looksLikeDmarcReport({ filename: 'proposal.pdf', contentType: 'application/pdf' })).toBe(false)
    expect(looksLikeDmarcReport({})).toBe(false)
  })
})

describe('the real Google report', () => {
  const parsed = parseDmarcReport(REPORT)

  it('reads who sent it and for what window', () => {
    expect(parsed.org).toBe('google.com')
    expect(parsed.reportId).toBe('775778697018431196')
    expect(parsed.domain).toBe('devlabconnect.com')
    expect(parsed.begin).toBe('2026-09-21T00:00:00.000Z')
    expect(parsed.end).toBe('2026-09-21T23:59:59.000Z')
  })

  it('reads the policy the receiver actually saw, which may differ from what we think we published', () => {
    expect(parsed.policy).toEqual({ p: 'none', sp: 'none', adkim: 's', aspf: 's', pct: 100 })
  })

  it('reads the per-source row', () => {
    expect(parsed.records).toHaveLength(1)
    expect(parsed.records[0]).toEqual({
      sourceIp: '37.60.237.227',
      count: 1,
      disposition: 'none',
      dkim: 'pass',
      spf: 'pass',
      headerFrom: 'devlabconnect.com',
      dkimDomain: 'devlabconnect.com',
      dkimSelector: 's202609',
      spfDomain: 'devlabconnect.com',
    })
  })

  it('counts nothing as failing', () => {
    expect(parsed.messages).toBe(1)
    expect(parsed.passingMessages).toBe(1)
    expect(parsed.failingMessages).toBe(0)
  })
})

describe('the case the folder exists for', () => {
  const FORGED = REPORT.replace(
    `<source_ip>37.60.237.227</source_ip>
      <count>1</count>
      <policy_evaluated>
        <disposition>none</disposition>
        <dkim>pass</dkim>
        <spf>pass</spf>
      </policy_evaluated>`,
    `<source_ip>203.0.113.9</source_ip>
      <count>412</count>
      <policy_evaluated>
        <disposition>none</disposition>
        <dkim>fail</dkim>
        <spf>fail</spf>
      </policy_evaluated>`,
  )

  it('counts a stranger sending as us as failing, by message rather than by row', () => {
    // 412 messages from one IP is one row. Counting rows would report "1
    // failure" for a campaign, which is the wrong order of magnitude to show
    // someone deciding whether to act.
    const parsed = parseDmarcReport(FORGED)
    expect(parsed.messages).toBe(412)
    expect(parsed.failingMessages).toBe(412)
    expect(parsed.records[0].sourceIp).toBe('203.0.113.9')
  })

  it('treats one aligned mechanism as a pass, because DMARC does', () => {
    const spfOnly = REPORT.replace('<dkim>pass</dkim>\n        <spf>pass</spf>', '<dkim>fail</dkim>\n        <spf>pass</spf>')
    expect(parseDmarcReport(spfOnly).failingMessages).toBe(0)
  })
})

describe('reports that are not the happy path', () => {
  it('handles several sources in one report', () => {
    const many = REPORT.replace(
      '</record>',
      `</record>
  <record>
    <row><source_ip>198.51.100.4</source_ip><count>7</count>
      <policy_evaluated><disposition>quarantine</disposition><dkim>fail</dkim><spf>fail</spf></policy_evaluated>
    </row>
    <identifiers><header_from>devlabconnect.com</header_from></identifiers>
    <auth_results></auth_results>
  </record>`,
    )
    const parsed = parseDmarcReport(many)

    expect(parsed.records).toHaveLength(2)
    expect(parsed.messages).toBe(8)
    expect(parsed.failingMessages).toBe(7)
    expect(parsed.records[1].disposition).toBe('quarantine')
  })

  it('returns nulls for elements a receiver omitted rather than refusing the report', () => {
    const sparse = '<feedback><record><row><source_ip>1.2.3.4</source_ip><count>2</count></row></record></feedback>'
    const parsed = parseDmarcReport(sparse)

    expect(parsed.org).toBeNull()
    expect(parsed.policy.p).toBeNull()
    expect(parsed.records[0].sourceIp).toBe('1.2.3.4')
    // No policy_evaluated means no aligned pass was recorded, so it counts as
    // failing rather than quietly as passing.
    expect(parsed.failingMessages).toBe(2)
  })

  it('resolves the entities a receiver may escape', () => {
    const escaped = REPORT.replace('<org_name>google.com</org_name>', '<org_name>A &amp; B Mail</org_name>')
    expect(parseDmarcReport(escaped).org).toBe('A & B Mail')
  })

  it('refuses a document that is not a report', () => {
    expect(() => parseDmarcReport('<html><body>hello</body></html>')).toThrow(/not a DMARC/i)
    expect(() => parseDmarcReport('')).toThrow(/not a DMARC/i)
  })
})

describe('decompression', () => {
  it('reads a gzipped report', async () => {
    const gz = await new Response(
      new Blob([new TextEncoder().encode(REPORT)]).stream().pipeThrough(new CompressionStream('gzip')),
    ).arrayBuffer()

    const xml = await decompressReport(new Uint8Array(gz), { filename: 'report.xml.gz' })
    expect(parseDmarcReport(xml).org).toBe('google.com')
  })

  it('reads a zipped report, which is what Google sends', async () => {
    const zip = await makeZip('report.xml', REPORT)
    const xml = await decompressReport(zip, { filename: 'google.com!x!1!2.zip' })
    expect(parseDmarcReport(xml).reportId).toBe('775778697018431196')
  })

  it('reads a bare XML attachment', async () => {
    const xml = await decompressReport(new TextEncoder().encode(REPORT), { filename: 'report.xml' })
    expect(parseDmarcReport(xml).domain).toBe('devlabconnect.com')
  })

  it('sniffs the format from the bytes, not the name', async () => {
    // A gzip named .xml is common enough to be worth not failing on.
    const gz = await new Response(
      new Blob([new TextEncoder().encode(REPORT)]).stream().pipeThrough(new CompressionStream('gzip')),
    ).arrayBuffer()

    const xml = await decompressReport(new Uint8Array(gz), { filename: 'report.xml' })
    expect(parseDmarcReport(xml).org).toBe('google.com')
  })
})

/** A single-entry deflate ZIP, built the way a receiver would write one. */
async function makeZip(name, content) {
  const nameBytes = new TextEncoder().encode(name)
  const raw = new TextEncoder().encode(content)
  const deflated = new Uint8Array(
    await new Response(new Blob([raw]).stream().pipeThrough(new CompressionStream('deflate-raw'))).arrayBuffer(),
  )

  const local = new Uint8Array(30 + nameBytes.length)
  const localView = new DataView(local.buffer)
  localView.setUint32(0, 0x04034b50, true)
  localView.setUint16(8, 8, true) // deflate
  localView.setUint32(18, deflated.length, true)
  localView.setUint32(22, raw.length, true)
  localView.setUint16(26, nameBytes.length, true)
  local.set(nameBytes, 30)

  const central = new Uint8Array(46 + nameBytes.length)
  const centralView = new DataView(central.buffer)
  centralView.setUint32(0, 0x02014b50, true)
  centralView.setUint16(10, 8, true)
  centralView.setUint32(20, deflated.length, true)
  centralView.setUint32(24, raw.length, true)
  centralView.setUint16(28, nameBytes.length, true)
  centralView.setUint32(42, 0, true) // local header offset
  central.set(nameBytes, 46)

  const eocd = new Uint8Array(22)
  const eocdView = new DataView(eocd.buffer)
  eocdView.setUint32(0, 0x06054b50, true)
  eocdView.setUint16(8, 1, true)
  eocdView.setUint16(10, 1, true)
  eocdView.setUint32(12, central.length, true)
  eocdView.setUint32(16, local.length + deflated.length, true)

  const out = new Uint8Array(local.length + deflated.length + central.length + eocd.length)
  let offset = 0
  for (const part of [local, deflated, central, eocd]) {
    out.set(part, offset)
    offset += part.length
  }
  return out
}

describe('decompression bomb (F6)', () => {
  async function gzip(bytes) {
    return new Uint8Array(
      await new Response(new Blob([bytes]).stream().pipeThrough(new CompressionStream('gzip'))).arrayBuffer(),
    )
  }

  it('stops inflating at the ceiling instead of buffering the whole output', async () => {
    const { inflate } = await import('./dmarcReport.js')
    // 4 MB of zeros compresses to a few KB.
    const bomb = await gzip(new Uint8Array(4 * 1024 * 1024))
    expect(bomb.byteLength).toBeLessThan(64 * 1024)

    await expect(inflate(bomb, 'gzip', 256 * 1024)).rejects.toThrow(/expands to more/i)
  })

  it('still inflates a report under the ceiling', async () => {
    const { inflate } = await import('./dmarcReport.js')
    const text = new TextEncoder().encode('<feedback/>')
    const out = await inflate(await gzip(text), 'gzip', 1024)
    expect(new TextDecoder().decode(out)).toBe('<feedback/>')
  })
})
