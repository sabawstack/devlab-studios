import { test, expect } from '@playwright/test'

test.describe.configure({ timeout: 90_000 })

/**
 * The inquiry form is a `client:load` React island: the markup is
 * server-rendered before hydration attaches its handlers, so clicking too
 * early falls through to a native (unhandled) submit. `networkidle` is not a
 * usable signal here because the Turnstile widget does continuous background
 * network activity — so interactions are wrapped in `toPass()` to retry until
 * hydration has attached.
 *
 * Turnstile lives on step 2, beside the submit button, so "verification
 * complete" is only a valid wait signal AFTER continuing — which is why
 * `continueToStepTwo` waits for it rather than `gotoForm`.
 */
async function gotoForm(page, path = '/contact') {
  await page.goto(path)
  await expect(page.getByRole('heading', { name: /Tell us about the system you need|About the role/ })).toBeVisible({
    timeout: 30_000,
  })
}

async function fillStepOne(page, overrides = {}) {
  const values = {
    fullName: 'Test User',
    email: 'test@example.com',
    company: 'Acme Co',
    message: 'Our inquiries land in a shared inbox and follow-up depends on someone remembering to check it.',
    ...overrides,
  }
  await page.getByLabel(/full name/i).fill(values.fullName)
  await page.getByLabel(/work email/i).fill(values.email)
  await page.getByLabel(/company or organization/i).fill(values.company)
  await page.getByLabel(/what needs improvement|^message/i).fill(values.message)
}

async function continueToStepTwo(page, { awaitVerification = true } = {}) {
  await expect(async () => {
    await page.getByRole('button', { name: 'Continue' }).click()
    await expect(page.getByRole('heading', { name: 'A little more context' })).toBeVisible({ timeout: 1_500 })
  }).toPass({ timeout: 20_000 })

  if (awaitVerification) {
    await expect(page.getByText(/secure verification complete/i)).toBeVisible({ timeout: 30_000 })
  }
}

test('the verification widget renders once step two is reached', async ({ page }) => {
  await gotoForm(page)
  // Nothing to verify yet on step one.
  await expect(page.getByText(/secure verification/i)).toHaveCount(0)

  await fillStepOne(page)
  await continueToStepTwo(page)

  await expect(page.getByText(/secure verification complete/i)).toBeVisible()
  await expect(page.getByRole('button', { name: 'Send inquiry' })).toBeEnabled()
})

test('a complete business inquiry submits and reports that it was saved', async ({ page }) => {
  await page.route('**/api/inquiries', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ ok: true, id: 'lead_1', persisted: true, inquiryType: 'business_system' }),
    }),
  )

  await gotoForm(page)
  await fillStepOne(page)
  await continueToStepTwo(page)

  await page.getByLabel(/what result are you aiming for/i).fill('Every inquiry gets an owner and a same-day reply.')
  await page.getByLabel(/^timeline/i).selectOption('within_month')
  await page.getByLabel(/I agree that DevLab Studios/i).check()

  await page.getByRole('button', { name: 'Send inquiry' }).click()
  await expect(page.getByRole('status')).toContainText(/received and saved/i)
})

test('a duplicate resubmission is reported as already received, not as a new inquiry', async ({ page }) => {
  await page.route('**/api/inquiries', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ ok: true, id: 'lead_1', persisted: true, duplicate: true }),
    }),
  )

  await gotoForm(page)
  await fillStepOne(page)
  await continueToStepTwo(page)
  await page.getByLabel(/what result are you aiming for/i).fill('Faster first response.')
  await page.getByLabel(/^timeline/i).selectOption('immediate')
  await page.getByLabel(/I agree that DevLab Studios/i).check()

  await page.getByRole('button', { name: 'Send inquiry' }).click()
  await expect(page.getByRole('status')).toContainText(/already have this inquiry/i)
})

test('a server failure surfaces an error and does not claim success', async ({ page }) => {
  await page.route('**/api/inquiries', (route) =>
    route.fulfill({
      status: 500,
      contentType: 'application/json',
      body: JSON.stringify({ code: 'persistence_failed', error: 'We could not save your inquiry.' }),
    }),
  )

  await gotoForm(page)
  await fillStepOne(page)
  await continueToStepTwo(page)
  await page.getByLabel(/what result are you aiming for/i).fill('Faster first response.')
  await page.getByLabel(/^timeline/i).selectOption('immediate')
  await page.getByLabel(/I agree that DevLab Studios/i).check()

  await page.getByRole('button', { name: 'Send inquiry' }).click()
  await expect(page.getByRole('status')).toContainText(/could not save/i)
  await expect(page.getByRole('status')).not.toContainText(/received and saved/i)
})

test('step one blocks continuing and shows an accessible error summary', async ({ page }) => {
  await gotoForm(page)

  await expect(async () => {
    await page.getByRole('button', { name: 'Continue' }).click()
    await expect(page.getByRole('alert')).toBeVisible({ timeout: 1_500 })
  }).toPass({ timeout: 20_000 })

  const summary = page.getByRole('alert')
  await expect(summary).toContainText(/please fix/i)
  // Each entry links to the field it describes (WCAG 3.3.1).
  const firstIssue = summary.getByRole('link').first()
  await expect(firstIssue).toHaveAttribute('href', /^#/)
  await expect(page.getByRole('heading', { name: 'A little more context' })).toHaveCount(0)
})

test('an invalid field is marked invalid and described by its error', async ({ page }) => {
  await gotoForm(page)
  await fillStepOne(page, { email: 'not-an-email' })

  await expect(async () => {
    await page.getByRole('button', { name: 'Continue' }).click()
    await expect(page.getByRole('alert')).toBeVisible({ timeout: 1_500 })
  }).toPass({ timeout: 20_000 })

  const email = page.getByLabel(/work email/i)
  await expect(email).toHaveAttribute('aria-invalid', 'true')
  const describedBy = await email.getAttribute('aria-describedby')
  expect(describedBy).toBeTruthy()
  await expect(page.locator(`#${describedBy.split(' ')[0]}`)).toContainText(/valid email/i)
})

test('submitting without consent is refused', async ({ page }) => {
  await gotoForm(page)
  await fillStepOne(page)
  await continueToStepTwo(page, { awaitVerification: false })
  await page.getByLabel(/what result are you aiming for/i).fill('Faster first response.')
  await page.getByLabel(/^timeline/i).selectOption('immediate')

  await page.getByRole('button', { name: 'Send inquiry' }).click()
  await expect(page.getByRole('alert')).toContainText(/confirm you agree/i)
})

test('step one answers survive going back from step two', async ({ page }) => {
  await gotoForm(page)
  await fillStepOne(page)
  await continueToStepTwo(page, { awaitVerification: false })

  await page.getByRole('button', { name: 'Back' }).click()
  await expect(page.getByLabel(/full name/i)).toHaveValue('Test User')
  await expect(page.getByLabel(/work email/i)).toHaveValue('test@example.com')
  await expect(page.getByLabel(/company or organization/i)).toHaveValue('Acme Co')
})

test('the form is operable by keyboard alone', async ({ page }) => {
  await gotoForm(page)
  // Fields are disabled until the island hydrates; focusing a disabled input
  // is a no-op, which is what made this race under a loaded test run.
  await expect(page.getByLabel(/full name/i)).toBeEnabled({ timeout: 20_000 })
  await page.getByLabel(/full name/i).focus()
  await page.keyboard.type('Keyboard User')
  await page.keyboard.press('Tab')
  await page.keyboard.type('keyboard@example.com')

  await expect(page.getByLabel(/work email/i)).toHaveValue('keyboard@example.com')
  await expect(page.getByLabel(/work email/i)).toBeFocused()
})

test('the employment path asks role questions, not business qualification questions', async ({ page }) => {
  await gotoForm(page, '/contact?type=employment_opportunity')
  await fillStepOne(page, { message: 'We are hiring a backend engineer for a remote team.' })
  await continueToStepTwo(page, { awaitVerification: false })

  await expect(page.getByLabel(/role title/i)).toBeVisible()
  await expect(page.getByLabel(/employment type/i)).toBeVisible()
  await expect(page.getByLabel(/budget range/i)).toHaveCount(0)
  await expect(page.getByLabel(/what result are you aiming for/i)).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Send to Stephen' })).toBeVisible()
})

test('an employment inquiry submits through the same pipeline', async ({ page }) => {
  let posted = null
  await page.route('**/api/inquiries', async (route) => {
    posted = JSON.parse(route.request().postData() || '{}')
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ ok: true, id: 'lead_2', persisted: true, inquiryType: 'employment_opportunity' }),
    })
  })

  await gotoForm(page, '/contact?type=employment_opportunity')
  await fillStepOne(page, { message: 'We are hiring a backend engineer for a remote team.' })
  await continueToStepTwo(page)
  await page.getByLabel(/role title/i).fill('Backend Engineer')
  await page.getByLabel(/employment type/i).selectOption('full_time')
  await page.getByLabel(/I agree that DevLab Studios/i).check()

  await page.getByRole('button', { name: 'Send to Stephen' }).click()
  await expect(page.getByRole('status')).toContainText(/received and saved/i)

  expect(posted.inquiryType).toBe('employment_opportunity')
  expect(posted.roleTitle).toBe('Backend Engineer')
  // Consent and attribution travel with every submission.
  expect(posted.consent.granted).toBe(true)
  expect(posted.consent.privacyPolicyVersion).toBeTruthy()
  expect(posted.attribution.formId).toBe('employment-inquiry-form')
})

test('CTA context preselects the inquiry type and is captured as attribution', async ({ page }) => {
  let posted = null
  await page.route('**/api/inquiries', async (route) => {
    posted = JSON.parse(route.request().postData() || '{}')
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ ok: true, id: 'lead_3', persisted: true }),
    })
  })

  await gotoForm(page, '/contact?type=workflow_audit&solution=workflow-systems-audit')
  await fillStepOne(page)
  await continueToStepTwo(page)
  await page.getByLabel(/what result are you aiming for/i).fill('Know which part of the workflow to fix first.')
  await page.getByLabel(/^timeline/i).selectOption('one_to_three_months')
  await page.getByLabel(/I agree that DevLab Studios/i).check()

  await page.getByRole('button', { name: 'Send inquiry' }).click()
  await expect(page.getByRole('status')).toContainText(/received and saved/i)

  expect(posted.inquiryType).toBe('workflow_audit')
  expect(posted.attribution.solutionId).toBe('workflow-systems-audit')
  expect(posted.attribution.entryPage).toBeTruthy()
  expect(posted.attribution.anonymousId).toBeTruthy()
})

test('the lead magnet form captures an email against a known offer', async ({ page }) => {
  let posted = null
  await page.route('**/api/lead-magnet', async (route) => {
    posted = JSON.parse(route.request().postData() || '{}')
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ ok: true, id: 'lead_4', persisted: true }),
    })
  })

  await page.goto('/offers/lead-intake-checklist')
  await expect(page.getByText(/secure verification complete/i)).toBeVisible({ timeout: 30_000 })

  await page.getByLabel(/full name/i).fill('Jo Lim')
  await page.getByLabel(/work email/i).fill('jo@example.com')
  await page.getByLabel(/I agree that DevLab Studios/i).check()

  await expect(async () => {
    await page.getByRole('button', { name: /send me the checklist/i }).click()
    await expect(page.getByRole('status')).toContainText(/check your inbox/i, { timeout: 1_500 })
  }).toPass({ timeout: 20_000 })

  expect(posted.offerId).toBe('lead-intake-checklist')
  expect(posted.consent.granted).toBe(true)
})

test('the legacy contact endpoint still backs the Pickleball club form', async ({ page }) => {
  let posted = null
  await page.route('**/api/contact', async (route) => {
    posted = JSON.parse(route.request().postData() || '{}')
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true }) })
  })

  await page.goto('/pickleball')
  const section = page.locator('#request-access')
  await section.scrollIntoViewIfNeeded()
  await expect(section.getByText(/secure verification complete/i)).toBeVisible({ timeout: 30_000 })

  await expect(async () => {
    await section.getByLabel('Your name').fill('Club Owner')
    await section.getByRole('textbox', { name: 'Email' }).fill('club@example.com')
    await section.getByLabel('Subject').fill('Pickleball early access request')
    await section.getByLabel(/tell us about your club/i).fill('We run open play twice a week for about 30 players.')
    await section.getByRole('button', { name: /send/i }).click()
    await expect(section.getByRole('status')).toContainText(/sent successfully/i, { timeout: 1_500 })
  }).toPass({ timeout: 25_000 })

  expect(posted.subject).toBe('Pickleball early access request')
})
