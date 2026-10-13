const INQUIRY_TYPE_LABELS = {
  business_system: 'Business system or automation',
  software_project: 'Website or software project',
  workflow_audit: 'Workflow systems audit',
  employment_opportunity: 'Employment opportunity',
  contract_collaboration: 'Contract or technical collaboration',
  partnership: 'Partnership',
  general: 'General inquiry',
}

export function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

function humanize(value) {
  const raw = String(value || '').trim()
  if (!raw) return ''
  return raw.replace(/_/g, ' ').replace(/^\w/, (character) => character.toUpperCase())
}

/**
 * Field rows for the internal notification, in the order a human reading a
 * new inquiry actually wants them. Empty values are dropped rather than
 * rendered as blanks.
 */
function notificationRows(lead) {
  const shared = [
    ['Inquiry type', INQUIRY_TYPE_LABELS[lead.inquiryType] || humanize(lead.inquiryType)],
    ['Name', lead.name],
    ['Email', lead.email],
    ['Company', lead.company],
    ['Website', lead.website],
    ['Phone', lead.phone],
    ['Preferred contact', humanize(lead.preferredContact)],
  ]

  const business = [
    ['Desired outcome', lead.desiredOutcome],
    ['Current process or tools', lead.currentWorkflow],
    ['Existing tools', lead.currentTools],
    ['Team size', humanize(lead.teamSize)],
    ['Timeline', humanize(lead.timeline)],
    ['Budget range', humanize(lead.budgetRange)],
    ['Volume', lead.volume],
    ['Solution interest', lead.solutionInterest],
    ['Qualification', `${humanize(lead.qualification)} (score ${lead.qualificationScore ?? 0})`],
  ]

  const employment = [
    ['Role title', lead.roleTitle],
    ['Employment type', humanize(lead.employmentType)],
    ['Work arrangement', humanize(lead.workArrangement)],
    ['Location or timezone', lead.locationRequirement],
    ['Job posting', lead.jobPostingUrl],
    ['Hiring timeline', humanize(lead.hiringTimeline)],
  ]

  const isEmployment = lead.inquiryType === 'employment_opportunity' || lead.inquiryType === 'contract_collaboration'
  return [...shared, ...(isEmployment ? employment : business)].filter(([, value]) => String(value || '').trim())
}

/** Internal notification sent to the studio inbox. */
export function buildNotificationEmail(lead, { attribution = null } = {}) {
  const rows = notificationRows(lead)
  const reasons = Array.isArray(lead.qualificationReasons) ? lead.qualificationReasons : []

  const attributionRows = attribution
    ? [
        ['Entry page', attribution.entryPage],
        ['Source page', attribution.sourcePage],
        ['Referrer', attribution.referrer],
        ['Campaign', attribution.utmCampaign],
        ['Source / medium', [attribution.utmSource, attribution.utmMedium].filter(Boolean).join(' / ')],
        ['Form', attribution.formId],
        ['Offer', attribution.offerId],
      ].filter(([, value]) => String(value || '').trim())
    : []

  const textLines = [
    `New ${INQUIRY_TYPE_LABELS[lead.inquiryType] || 'inquiry'} from ${lead.name} <${lead.email}>`,
    '',
    ...rows.map(([label, value]) => `${label}: ${value}`),
    '',
    'Message:',
    lead.message,
  ]

  if (reasons.length) {
    textLines.push('', 'Qualification reasons:', ...reasons.map((reason) => `- ${reason.label} (${reason.points >= 0 ? '+' : ''}${reason.points})`))
  }
  if (attributionRows.length) {
    textLines.push('', 'Attribution:', ...attributionRows.map(([label, value]) => `${label}: ${value}`))
  }

  const htmlRows = rows
    .map(([label, value]) => `<tr><td style="padding:4px 12px 4px 0;color:#535b73;">${escapeHtml(label)}</td><td style="padding:4px 0;"><strong>${escapeHtml(value)}</strong></td></tr>`)
    .join('')

  const htmlReasons = reasons.length
    ? `<h3 style="margin:24px 0 8px;font-size:14px;">Qualification reasons</h3><ul>${reasons
        .map((reason) => `<li>${escapeHtml(reason.label)} (${reason.points >= 0 ? '+' : ''}${escapeHtml(String(reason.points))})</li>`)
        .join('')}</ul>`
    : ''

  const htmlAttribution = attributionRows.length
    ? `<h3 style="margin:24px 0 8px;font-size:14px;">Attribution</h3><table>${attributionRows
        .map(([label, value]) => `<tr><td style="padding:4px 12px 4px 0;color:#535b73;">${escapeHtml(label)}</td><td style="padding:4px 0;">${escapeHtml(value)}</td></tr>`)
        .join('')}</table>`
    : ''

  const html = `
    <div style="font-family:system-ui,-apple-system,sans-serif;color:#111321;">
      <h2 style="margin:0 0 16px;font-size:18px;">New ${escapeHtml(INQUIRY_TYPE_LABELS[lead.inquiryType] || 'inquiry')}</h2>
      <table>${htmlRows}</table>
      <h3 style="margin:24px 0 8px;font-size:14px;">Message</h3>
      <p style="white-space:pre-wrap;">${escapeHtml(lead.message)}</p>
      ${htmlReasons}
      ${htmlAttribution}
    </div>
  `.trim()

  return {
    subject: `[${humanize(lead.qualification) || 'New'}] ${lead.subject}`.slice(0, 180),
    text: textLines.join('\n'),
    html,
  }
}

/**
 * Confirmation sent to the visitor.
 *
 * A FIXED ACKNOWLEDGEMENT, NOTHING THE VISITOR TYPED. This mail goes to
 * whatever address the form was given, from our own domain and DKIM-signed, so
 * anything echoed from the submission — the name, the message — is text a
 * stranger gets to send under the studio's name to an arbitrary inbox (a
 * phishing link in the name field was enough). It therefore carries no
 * greeting by name and no copy of the message; only the inquiry type picks
 * between two fixed texts. Security audit F4 / M5.
 *
 * Deliberately states only what actually happens — that the inquiry was
 * received and a human will reply — with no response-time promise.
 */
export function buildConfirmationEmail(lead) {
  const isEmployment = lead.inquiryType === 'employment_opportunity' || lead.inquiryType === 'contract_collaboration'
  const intro = isEmployment
    ? 'Thanks for reaching out about a role. Your message has been received and Stephen reviews these personally.'
    : 'Thanks for reaching out. Your inquiry has been received and will be reviewed by a person, not an autoresponder.'

  const next = isEmployment
    ? 'If there is a fit, you will get a direct reply with availability and next steps.'
    : 'You will get a reply with the clearest next step for your system — usually a short discovery conversation or a scoped recommendation.'

  const notYou = 'If you did not contact DevLab Studios, you can ignore this email.'

  const text = ['Hello,', '', intro, '', next, '', notYou, '', '— DevLab Studios', 'https://www.devlabstudios.com'].join('\n')

  const html = `
    <div style="font-family:system-ui,-apple-system,sans-serif;color:#111321;line-height:1.6;">
      <p>Hello,</p>
      <p>${escapeHtml(intro)}</p>
      <p>${escapeHtml(next)}</p>
      <p style="color:#535b73;">${escapeHtml(notYou)}</p>
      <p>— DevLab Studios<br><a href="https://www.devlabstudios.com">devlabstudios.com</a></p>
    </div>
  `.trim()

  return {
    subject: 'We received your inquiry — DevLab Studios',
    text,
    html,
  }
}

/**
 * Lead-magnet delivery: the requested resource plus one clear next step.
 *
 * Same rule as the confirmation: nothing the visitor typed is echoed (no
 * greeting by name). The offer title and URL come from the server-owned
 * registry, never from the submission.
 */
export function buildLeadMagnetEmail(_lead, offer) {
  const url = offer?.url || 'https://www.devlabstudios.com/insights'
  const title = offer?.title || 'Your requested resource'

  const text = [
    'Hello,',
    '',
    `Here is ${title}:`,
    url,
    '',
    'If you want the version applied to your own intake and follow-up process, reply to this email or start an inquiry at https://www.devlabstudios.com/contact',
    '',
    '— DevLab Studios',
  ].join('\n')

  const html = `
    <div style="font-family:system-ui,-apple-system,sans-serif;color:#111321;line-height:1.6;">
      <p>Hello,</p>
      <p>Here is <strong>${escapeHtml(title)}</strong>:</p>
      <p><a href="${escapeHtml(url)}">${escapeHtml(url)}</a></p>
      <p>If you want this applied to your own intake and follow-up process, reply to this email or <a href="https://www.devlabstudios.com/contact">start an inquiry</a>.</p>
      <p>— DevLab Studios</p>
    </div>
  `.trim()

  return { subject: `${title} — DevLab Studios`, text, html }
}
