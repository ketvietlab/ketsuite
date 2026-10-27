// A person is read on their own page, `/admin/users/{id}`.
//
// What is worth proving over real HTTP: the list links a row there with the way
// back, the page arrives as the record page island with the context the browser
// would otherwise fetch, and links written for the old modal land on the page.
import assert from 'node:assert/strict'
import { test, type TestContext } from 'node:test'
import type { Row } from '@ketvietlab/ketjs'
import { defineDeployment, defineModule } from '@ketvietlab/ketjs'
import { createTestDeployment } from '@ketvietlab/ketjs/testing'
import { ketsuite } from '../apps/ketsuite/deployment.ts'
import { userPageRoute } from '../packages/ketsuite/src/modules/user_backend/index.ts'

const boot = async (t: TestContext, deployment = ketsuite) => {
  const app = await createTestDeployment(deployment, { worker: false })
  t.after(() => app.close())
  const scope = { company: 'acme', branch: 'root:acme', branches: ['root:acme'] }
  const fixture = (name: string, input: Record<string, unknown>) =>
    app.fixture.call<Row>(name, input, { scope })
  await fixture('partner.savePartner', { id: 'acme-party', kind: 'company', name: 'ACME' })
  await fixture('company.saveCompany', { id: 'acme', code: 'ACME', partnerId: 'acme-party', currency: 'VND' })
  await fixture('user.createUser', {
    id: 'admin',
    login: 'admin',
    password: 'correct horse',
    name: 'Administrator',
    superuser: true,
  })
  await fixture('user.grantCompany', { id: 'admin:acme', userId: 'admin', companyId: 'acme' })
  await fixture('user.createUser', { id: 'trang', login: 'trang', name: 'Minh Trang' })
  await app.client.login({ login: 'admin', password: 'correct horse' })
  return app
}

/** The JSON an island was handed, as the page wrote it. */
const islandProps = (html: string, name: string): Record<string, unknown> => {
  const tag = html.match(
    new RegExp(`<(?:ket-island|div)\\b[^>]*data-island="${name.replace('.', '\\.')}"[^>]*>`, 'u'),
  )?.[0]
  assert.ok(tag, `the page places ${name}`)
  const raw = tag.match(/data-props="([^"]*)"/u)?.[1] ?? '{}'
  return JSON.parse(raw.replaceAll('&quot;', '"').replaceAll('&#39;', "'").replaceAll('&amp;', '&'))
}

test('user page HTTP: a row opens the person on their own page, which arrives complete', async (t) => {
  const app = await boot(t)

  const list = await (await app.client.get('/admin/users?lang=vi&q=Trang')).text()
  // A row opens the person's page (the list's islands build its link, with the way back to this
  // list at that row); only creating still opens over the list.
  const open = islandProps(list, 'backend.row-list').open
  assert.deepEqual(open, { kind: 'page', path: '/admin/users/{id}?lang=vi', returnPath: '/admin/users' })
  assert.match(list, /record=user\.user%3Anew/u)

  const page = await app.client.get(
    '/admin/users/trang?lang=vi&returnTo=%2Fadmin%2Fusers%3Flang%3Dvi%26q%3DTrang',
  )
  assert.equal(page.status, 200)
  const html = await page.text()
  assert.match(html, /<title>[^<]*Minh Trang/u)
  // Inside the administration shell, with the record page as its content.
  assert.match(html, /data-ket-slot="backend\.content"[\s\S]*data-record-layer="page"/u)
  // One title: the record page's, not the shell's topbar as well.
  assert.equal(html.match(/<h1\b/gu)?.length, 1)
  assert.doesNotMatch(html, /data-ui="topbar"/u)
  // The server writes the frame the browser adopts: titled, bounded, on its trail.
  assert.match(html, /data-record-layer="page"/u)
  assert.match(html, /data-ui="record-page"[^>]*data-variant="operational"[^>]*data-width="default"/u)
  assert.match(html, /<a\b[^>]*href="\/admin\/users\?lang=vi&amp;q=Trang"[^>]*>/u)
  // The row the reader left rides back on the trail, so the list returns to it.
  const anchored = await (
    await app.client.get(
      '/admin/users/trang?lang=vi&returnTo=%2Fadmin%2Fusers%3Flang%3Dvi%26q%3DTrang%23row%3Dtrang',
    )
  ).text()
  assert.match(anchored, /<a\b[^>]*href="\/admin\/users\?lang=vi&amp;q=Trang#row=trang"[^>]*>/u)
  const props = islandProps(html, 'user.user-page')
  assert.equal(props.id, 'trang')
  assert.equal(props.title, 'Minh Trang')
  // The context the browser would have read, already permission-checked.
  const envelope = props.envelope as { data: { record: { login: string }; areas: unknown[] } }
  assert.equal(envelope.data.record.login, 'trang')
  assert.ok(Array.isArray(envelope.data.areas), 'the four-level areas come with it')

  assert.equal((await app.client.get('/admin/users/nobody?lang=vi')).status, 404)
})

test('user page HTTP: a link written for the old modal lands on the page', async (t) => {
  const app = await boot(t)
  const legacy = await app.client.get('/admin/users?lang=vi&record=user.user%3Atrang&tab=access', {
    redirect: 'manual',
  })
  assert.equal(legacy.status, 303)
  assert.equal(
    legacy.headers.get('location'),
    '/admin/users/trang?lang=vi&returnTo=%2Fadmin%2Fusers%3Flang%3Dvi',
  )
  // Creating someone still opens over the list.
  const create = await app.client.get('/admin/users?lang=vi&record=user.user%3Anew', { redirect: 'manual' })
  assert.equal(create.status, 200)
})

test('user page HTTP: a deployment that serves its own person page receives every link to the person', async (t) => {
  // A deployment whose people sign in through a service of its own reads the person with that service's
  // state and serves the page with `userPageRoute`, placing the island through a joint it fills.
  const own = defineModule({
    name: 'user_page_probe',
    depends: ['user', 'user_backend'],
    joints: {
      'user.page': {
        props: {
          id: 'id',
          title: 'text',
          loadingLabel: 'text',
          trail: 'json?',
          trailLabel: 'text?',
          envelope: 'json?',
        },
      },
    },
    fills: { 'user_page_probe:user.page': '{% island "user.user-page" %}' },
    routes: {
      '/admin/users/{id}/profile': userPageRoute({
        joint: 'user_page_probe:user.page',
        context: async (ctx, url, req, id, locale) => {
          const base = (await ctx.call('user.userModalContext', { id, locale }, url, req)) as {
            data: Record<string, unknown>
          } | null
          return base && { ...base, data: { ...base.data, signInService: 'probe' } }
        },
        beside: (_, title) => `Guide for ${title}`,
      }),
    },
  })
  const app = await boot(t, defineDeployment({ ...ketsuite, modules: [...ketsuite.modules, own] }))
  const returnTo = '%2Fadmin%2Fusers%3Flang%3Dvi%26q%3DTrang'
  const moved = await app.client.get(`/admin/users/trang?lang=vi&returnTo=${returnTo}`, {
    redirect: 'manual',
  })
  assert.equal(moved.status, 303)
  assert.equal(moved.headers.get('location'), `/admin/users/trang/profile?lang=vi&returnTo=${returnTo}`)

  const page = await app.client.get(`/admin/users/trang/profile?lang=vi&returnTo=${returnTo}`)
  assert.equal(page.status, 200)
  const html = await page.text()
  const props = islandProps(html, 'user.user-page')
  assert.equal((props.envelope as { data: { signInService?: string } }).data.signInService, 'probe')
  // The way back is the list as it was left, and what the deployment puts beside the page is there.
  assert.match(html, /<a\b[^>]*href="\/admin\/users\?lang=vi&amp;q=Trang"[^>]*>/u)
  // The row the reader left rides back on the trail, so the list returns to it.
  const anchored = await (
    await app.client.get(
      '/admin/users/trang?lang=vi&returnTo=%2Fadmin%2Fusers%3Flang%3Dvi%26q%3DTrang%23row%3Dtrang',
    )
  ).text()
  assert.match(anchored, /<a\b[^>]*href="\/admin\/users\?lang=vi&amp;q=Trang#row=trang"[^>]*>/u)
  assert.match(html, /Guide for Minh Trang/u)
  assert.equal((await app.client.get('/admin/users/nobody/profile?lang=vi')).status, 404)
})
