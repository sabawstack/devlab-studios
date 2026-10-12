// The DUPR export email (spec §9.4, §9.6). Pure: builds the subject, the
// plain-text body and an HTML body with inline styles only (email clients
// strip <style>). The CSV goes as an attachment, added by the sender.
import type { DuprSkip } from './export'

export interface DuprEmailInput {
  hostName: string
  sessionName: string
  /** The session's local date, YYYY-MM-DD. */
  date: string
  clubId: string
  exported: number
  skipped: readonly DuprSkip[]
}

export interface DuprEmail {
  subject: string
  text: string
  html: string
}

export const DUPR_CLICK_PATH = 'Matches → Add Matches → Import Matches via CSV'

function escapeHtml(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;')
}

const games = (n: number) => `${n} game${n === 1 ? '' : 's'}`

export function duprFilename(sessionName: string, date: string): string {
  const slug = sessionName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'session'
  return `dupr-${slug}-${date}.csv`
}

function skipLine(skip: DuprSkip): string {
  return `Game ${skip.game}${skip.court ? `, ${skip.court}` : ''}: ${skip.summary}. ${skip.reason}`
}

export function buildDuprEmail(input: DuprEmailInput): DuprEmail {
  const subject = `DUPR export: ${input.sessionName} (${input.date})`
  const intro = `Your DUPR match file for "${input.sessionName}" is attached: ${games(input.exported)}.`
  const upload = `To upload it, open your club (Club ID ${input.clubId}) in DUPR, go to ${DUPR_CLICK_PATH}, and choose the attached file. Your DUPR account must be a Club Director or Organizer of that club.`
  const skippedHeading = `Left out (${games(input.skipped.length)}):`
  const reply = 'If DUPR refuses the file, reply to this email with the message it shows.'

  const text = [
    `Hi ${input.hostName},`,
    '',
    intro,
    '',
    upload,
    ...(input.skipped.length ? ['', skippedHeading, ...input.skipped.map((s) => `- ${skipLine(s)}`)] : []),
    '',
    reply,
    '',
    'Devlab Pickleball · devlabstudios.com/pickleball',
  ].join('\n')

  const font = "font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;"
  const skippedHtml = input.skipped.length
    ? `<p style="margin:18px 0 6px 0;font-weight:700;color:#111321;">${escapeHtml(skippedHeading)}</p>
<ul style="margin:0;padding-left:20px;">${input.skipped.map((s) => `<li style="margin:0 0 4px 0;">${escapeHtml(skipLine(s))}</li>`).join('')}</ul>`
    : ''
  const html = `<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${escapeHtml(subject)}</title></head>
<body style="margin:0;padding:0;background-color:#f4f5fa;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:#f4f5fa;"><tr><td align="center" style="padding:32px 16px;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:560px;background-color:#ffffff;border:1px solid #e4e7f2;border-radius:14px;">
<tr><td style="padding:28px 32px;${font}font-size:15px;line-height:1.6;color:#3c4356;">
<p style="margin:0 0 6px 0;font-size:12px;font-weight:700;letter-spacing:1.6px;text-transform:uppercase;color:#5b6478;">Devlab Pickleball</p>
<h1 style="margin:0 0 14px 0;font-size:22px;line-height:1.25;color:#111321;">${escapeHtml(subject)}</h1>
<p style="margin:0 0 14px 0;">Hi ${escapeHtml(input.hostName)},</p>
<p style="margin:0 0 14px 0;">${escapeHtml(intro)}</p>
<p style="margin:0;">${escapeHtml(upload)}</p>
${skippedHtml}
<p style="margin:18px 0 0 0;color:#5b6478;font-size:13px;">${escapeHtml(reply)}</p>
</td></tr></table></td></tr></table>
</body>
</html>`

  return { subject, text, html }
}
