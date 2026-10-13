import type { APIRoute } from 'astro'
import { canonicalDomain } from '../../../../../../lead-engine/domain/domains.js'
import { ACTIVITY } from '../../../../../../lead-engine/domain/activity.js'
import { STAGES } from '../../../../../../lead-engine/domain/pipeline.js'
import { validateContact } from '../../../../../../lead-engine/contacts/validate.js'
import { classifyEmailType } from '../../../../../../lead-engine/contacts/discover.js'
import { recordActivity } from '../../../../../../lead-engine/repositories/activity.js'
import { getCompany } from '../../../../../../lead-engine/repositories/companies.js'
import {
  deleteContact,
  listContacts,
  setPrimaryContact,
  upsertContact,
} from '../../../../../../lead-engine/repositories/contacts.js'
import { getLead, refreshNextAction, transitionLead } from '../../../../../../lead-engine/repositories/leads.js'
import { manualContactSchema } from '../../../../../../lead-engine/schemas/index'
import {
  actorEmail,
  handleRoute,
  jsonResponse,
  notFound,
  readValidatedBody,
  requireDatabase,
} from '../../../../../../lead-engine/schemas/route'
import { withAdmin } from '../../../../../../lib/adminGuard'

export const prerender = false

const unguardedGET: APIRoute = async ({ params }) =>
  handleRoute(async () => {
    const database = requireDatabase()
    if (!database.ok) return database.response

    return jsonResponse({ contacts: await listContacts(database.env.DB, params.id!) })
  })

/**
 * Adds a contact by hand.
 *
 * The provenance fields are REQUIRED by the schema even here. An operator who
 * found an address on a page can say which page; one who cannot should not be
 * adding it, because the whole outreach gate rests on being able to point at
 * where a business published its own contact details.
 */
const unguardedPOST: APIRoute = async (context) =>
  handleRoute(async () => {
    const database = requireDatabase()
    if (!database.ok) return database.response

    const body = await readValidatedBody(context.request, manualContactSchema)
    if (!body.ok) return body.response

    const db = database.env.DB
    const leadId = context.params.id!
    const lead = await getLead(db, leadId)
    if (!lead) return notFound(context.request, 'Lead not found.')

    const company = await getCompany(db, lead.companyId)
    const domain = company ? canonicalDomain(company.websiteUrl) : null

    const validation = await validateContact(body.data.email, { companyDomain: domain })
    if (!validation.syntaxValid) {
      return jsonResponse({ error: `That address is not valid (${validation.syntaxReason}).`, field: 'email' }, 422)
    }

    const { contact } = await upsertContact(db, {
      leadId,
      companyId: lead.companyId,
      email: body.data.email,
      fullName: body.data.fullName ?? null,
      roleTitle: body.data.roleTitle ?? null,
      emailType: classifyEmailType(validation.email!, domain),
      sourceUrl: body.data.sourceUrl,
      sourceType: body.data.sourceType,
      publishedPublicly: body.data.publishedPublicly,
      isBusinessContact: true,
      syntaxValid: validation.syntaxValid,
      domainMatchesCompany: validation.domainMatchesCompany,
      mxPresent: validation.mxPresent,
      isPrimary: (await listContacts(db, leadId)).length === 0,
    })

    if (!contact) return jsonResponse({ error: 'The contact could not be saved.' }, 500)

    await recordActivity(db, {
      leadId,
      campaignId: lead.campaignId,
      eventType: ACTIVITY.CONTACT_ADDED_MANUALLY,
      actor: 'human',
      actorEmail: actorEmail(context),
      summary: `Added ${contact.email} from ${body.data.sourceUrl}.`,
      metadata: { sourceType: body.data.sourceType },
    })

    // A lead that was stuck at NO_CONTACT is now contactable, which is the
    // whole point of adding one by hand.
    if (lead.stage === STAGES.NO_CONTACT) {
      await transitionLead(db, leadId, STAGES.CONTACT_FOUND, {
        actor: 'human',
        actorEmail: actorEmail(context),
        eventType: ACTIVITY.CONTACT_FOUND,
        summary: 'Contact added manually.',
      })
    }

    await refreshNextAction(db, leadId)
    return jsonResponse({ contact }, 201)
  })

const unguardedPATCH: APIRoute = async (context) =>
  handleRoute(async () => {
    const database = requireDatabase()
    if (!database.ok) return database.response

    const contactId = new URL(context.request.url).searchParams.get('contactId')
    if (!contactId) return jsonResponse({ error: 'A contactId is required.' }, 400)

    await setPrimaryContact(database.env.DB, context.params.id!, contactId)
    return jsonResponse({ ok: true })
  })

const unguardedDELETE: APIRoute = async (context) =>
  handleRoute(async () => {
    const database = requireDatabase()
    if (!database.ok) return database.response

    const contactId = new URL(context.request.url).searchParams.get('contactId')
    if (!contactId) return jsonResponse({ error: 'A contactId is required.' }, 400)

    await deleteContact(database.env.DB, context.params.id!, contactId)
    await refreshNextAction(database.env.DB, context.params.id!)
    return jsonResponse({ ok: true })
  })

// Authenticated per handler as well as by src/middleware.ts; see src/lib/adminGuard.ts.
export const GET = withAdmin(unguardedGET)
export const POST = withAdmin(unguardedPOST)
export const PATCH = withAdmin(unguardedPATCH)
export const DELETE = withAdmin(unguardedDELETE)
