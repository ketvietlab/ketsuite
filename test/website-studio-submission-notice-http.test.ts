import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { Row } from '@ketvietlab/ketjs'
import { SAFE_KEYS } from '../packages/ketsuite/src/modules/website_form_mail/index.ts'
import { bootWebsiteStudio } from './fixtures/website-studio.ts'

const field = (name: string, label: string, classification: string) => ({
  id: `row-${name}`,
  name,
  label,
  type: 'text',
  required: true,
  maxLength: 4000,
  classification,
})

/**
 * Whether the form's owner was told, per submission, read from the mail outbox the notice was queued
 * in rather than from a second ledger: sent, failed with the outbox's reason, or never queued. A
 * form with nobody to tell says so, and the lookup is not something a browser can call by itself.
 */
test('Studio submissions: each row and detail show where its email notice stands', async () => {
  const { app, fixture } = await bootWebsiteStudio()
  try {
    await fixture('website.saveDomain', {
      id: 'notice-domain',
      siteId: 'site-a',
      host: '127.0.0.1',
      primary: true,
    })
    const login = async (name: string) => {
      const client = app.client.anonymous()
      await client.login({ login: `studio-${name}`, password: 'studio-local' })
      return client
    }
    const editor = await login('editor')
    const publisher = await login('publisher')
    const reader = await login('reader')
    const send = async (client: typeof editor, fn: string, input: Row) => {
      const response = await client.post('/website/api/' + fn, JSON.stringify(input), {
        headers: { 'content-type': 'application/json' },
      })
      return { status: response.status, ...((await response.json()) as { value: Row }) }
    }
    const call = async (fn: string, input: Row, client = publisher) => {
      const r = await send(client, fn, input)
      assert.equal(r.status, 200, JSON.stringify(r))
      return r.value
    }
    const saveForm = (id: string, recipient: string) =>
      call(
        'website_studio.saveResource',
        {
          siteId: 'site-a',
          kind: 'form-editor',
          id,
          expectedRevisionId: null,
          values: {
            title: id,
            schema: { fields: [field('name', 'Họ tên', 'public'), field('phone', 'Điện thoại', 'personal')] },
            recipient,
            successMessage: 'Đã nhận.',
            consentLabel: '',
            spamProtection: 'honeypot',
            active: 'yes',
          },
        },
        editor,
      )
    await saveForm('form-told', 'dat-ban@example.test')
    await saveForm('form-quiet', '')
    let agent = 0
    const submit = async (formId: string, name: string) => {
      agent += 1
      const response = await app.client
        .anonymous()
        .post(
          `/website/forms/${formId}/submit`,
          JSON.stringify({ payload: { name, phone: '0901' }, _schemaVersion: 1 }),
          {
            headers: { 'content-type': 'application/json', 'user-agent': `visitor-${agent}` },
          },
        )
      assert.equal(response.status, 200, await response.text())
    }
    for (const name of ['An', 'Bình', 'Chi']) await submit('form-told', name)
    await submit('form-quiet', 'Dung')

    const queue = async (formId: string, client = publisher) =>
      (await call('website_form.listSubmissions', { formId, status: null, limit: 50, offset: 0 }, client))
        .rows as Row[]
    const ids = Object.fromEntries((await queue('form-told')).map((r) => [r.summary, String(r.id)]))

    // Two notices go into the outbox; the delivery job then sends one and gives up on the other.
    // Outbox administration is a signed-in user's, so the template is saved as one.
    await app.fixture.call(
      'mail_transport.saveTemplate',
      {
        id: 'tpl-form',
        name: 'website_form.submission_received',
        fromAddress: 'no-reply@example.test',
        subjectTemplate: '{{formName}} có 1 yêu cầu mới',
        textTemplate: 'Mở: {{adminUrl}}',
        allowedKeys: [...SAFE_KEYS],
        active: true,
      },
      { scope: { company: 'studio-a', branches: null }, actor: 'staff-1' },
    )
    for (const name of ['An', 'Bình'])
      await fixture('website_form_mail.notifySubmission', {
        submissionId: ids[name],
        templateId: 'tpl-form',
        baseUrl: 'http://127.0.0.1',
      })
    const SENT_AT = '2026-10-27T03:04:05.000Z'
    await app.fixture.withTenant('', async ({ adapter }) => {
      await adapter.run(
        `UPDATE mail_transport_delivery SET state = 'sent', attempts = 1, "sentAt" = ? WHERE id = ?`,
        [SENT_AT, `website-form:${ids.An}`],
      )
      await adapter.run(
        `UPDATE mail_transport_delivery SET state = 'failed', attempts = 5, "lastError" = ? WHERE id = ?`,
        ['550 mailbox unavailable', `website-form:${ids['Bình']}`],
      )
    })

    // Whoever may see the queue sees each row's own state, and the form nobody is told about says so.
    for (const client of [publisher, reader])
      assert.deepEqual(
        Object.fromEntries((await queue('form-told', client)).map((r) => [r.summary, r.deliveryState])),
        { An: 'sent', Bình: 'failed', Chi: 'notQueued' },
      )
    assert.deepEqual(
      (await queue('form-quiet')).map((r) => r.deliveryState),
      ['notConfigured'],
    )

    const detail = async (name: string) =>
      ((await call('website_studio.submissionDetail', { siteId: 'site-a', id: ids[name] })).submission as Row)
        .delivery as Row | null
    const sent = (await detail('An'))!
    assert.equal(typeof sent.queuedAt, 'string')
    assert.deepEqual(
      { ...sent, queuedAt: null },
      { state: 'sent', attempts: 1, error: null, queuedAt: null, sentAt: SENT_AT },
    )
    assert.deepEqual(
      { ...(await detail('Bình')), queuedAt: null },
      { state: 'failed', attempts: 5, error: '550 mailbox unavailable', queuedAt: null, sentAt: null },
    )
    assert.deepEqual(await detail('Chi'), {
      state: 'notQueued',
      attempts: 0,
      error: null,
      queuedAt: null,
      sentAt: null,
    })
    // The delivery's facts, never its envelope: nothing about who was mailed reaches the Studio.
    assert.doesNotMatch(JSON.stringify(sent), /dat-ban@|no-reply@/)
    const quiet = (await queue('form-quiet'))[0]!
    assert.equal(
      ((await call('website_studio.submissionDetail', { siteId: 'site-a', id: quiet.id })).submission as Row)
        .delivery,
      null,
    )

    // The lookup rides on the Studio having read those submissions first; nobody calls it directly.
    const direct = await publisher.post(
      '/_ket/fn/website_form_mail.noticeStates',
      JSON.stringify({ submissionIds: [ids.An] }),
      { headers: { 'content-type': 'application/json' } },
    )
    assert.notEqual(direct.status, 200)
    assert.doesNotMatch(await direct.text(), /website-form:|550 mailbox/)
  } finally {
    await app.close()
  }
})
