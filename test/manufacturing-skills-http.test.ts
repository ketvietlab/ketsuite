import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { Row } from '@ketvietlab/ketjs'
import { boot } from './fixtures/sale/commerce.ts'

test('manufacturing skills HTTP: the grid saves people and levels whole, only for shop-floor members (#1931)', async (t) => {
  const r = await boot(t)
  const e2e = r.app
  const fixture = async (name: string, input: Record<string, unknown>) => ({
    value: await r.call(name, input),
  })
  await fixture('manufacturing.saveWorkCenter', {
    id: 'cutting',
    code: 'CUT',
    name: 'Cắt bánh',
    capacity: '1',
    skill: 'cut',
  })
  // Lan runs the floor; Bình is a member without any grant; Out works for another company.
  for (const [id, name, superuser] of [
    ['lan', 'Phạm Thị Lan', true],
    ['binh', 'Trần Văn Bình', false],
  ] as const) {
    await r.fixture('user.createUser', {
      id,
      login: id,
      password: 'correct horse',
      name,
      defaultCompanyId: 'acme',
      superuser,
    })
    await r.fixture('user.grantCompany', { id: `${id}:acme`, userId: id, companyId: 'acme' })
  }
  assert.deepEqual(
    ((await fixture('manufacturing.listOperatorCandidates', {})).value as unknown as Row[]).map(
      (row) => row.id,
    ),
    ['owner', 'lan'],
  )

  const page = await (await e2e.client.get('/admin/manufacturing/skills?lang=vi')).text()
  for (const text of ['Kỹ năng công nhân', 'Phạm Thị Lan', 'cut · Cắt bánh', 'Lưu kỹ năng'])
    assert.ok(page.includes(text), `the skills page shows ${text}`)
  assert.ok(page.includes('manufacturing-operator-skills-help'), 'the page includes its own guide')
  assert.equal(
    (page.match(/<h1\b[^>]*>[\s\S]*?<\/h1>/g) ?? []).filter(
      (heading) => heading.replace(/<[^>]*>/g, '').trim() === 'Kỹ năng công nhân',
    ).length,
    1,
    'one visible page heading',
  )
  assert.ok(!page.includes('Trần Văn Bình'), 'a member who may not run the floor is not offered')

  const save = (changes: Row, origin?: string) =>
    e2e.client.post(
      '/admin/manufacturing/skills?lang=vi',
      new URLSearchParams({
        action: 'save',
        skills: JSON.stringify({ added: [], updated: [], removed: [], order: null, ...changes }),
      }),
      {
        headers: {
          'content-type': 'application/x-www-form-urlencoded',
          ...(origin ? { origin } : {}),
        },
        redirect: 'manual',
      },
    )
  const skills = async () =>
    ((await fixture('manufacturing.listOperatorSkills', {})).value as unknown as Row[])
      .map((row) => [row.userId, row.name, row.skill, Number(row.level), row.lead === true])
      .sort((a, b) => String(a[0]).localeCompare(String(b[0])))

  assert.equal((await save({}, 'https://cross-site.example')).status, 403)
  const added = await save({
    added: [
      { id: 'n1', index: 0, values: { userId: 'lan', skill: 'cut', level: 2, lead: false } },
      { id: 'n2', index: 1, values: { userId: 'owner', skill: 'cut', level: 3, lead: true } },
    ],
  })
  assert.equal(added.status, 303)
  assert.equal(added.headers.get('location'), '/admin/manufacturing/skills?lang=vi&saved=1')
  // The name is the user's own, never the form's.
  assert.deepEqual(await skills(), [
    ['lan', 'Phạm Thị Lan', 'cut', 2, false],
    ['owner', 'Owner', 'cut', 3, true],
  ])

  // One refused row saves nothing: Bình may not run the floor, and Lan already has cutting.
  const refused = await save({
    updated: [{ id: 'acme:skill:lan:cut', values: { level: 4 } }],
    added: [
      { id: 'n3', index: 2, values: { userId: 'binh', skill: 'cut', level: 2, lead: false } },
      { id: 'n4', index: 3, values: { userId: 'lan', skill: 'cut', level: 1, lead: false } },
    ],
  })
  assert.equal(refused.status, 200)
  const refusedPage = await refused.text()
  assert.ok(
    refusedPage.includes('Dòng 3: người này không thuộc công ty'),
    'the refused person is named by row',
  )
  assert.ok(refusedPage.includes('Dòng 4: người này đã có dòng cho kỹ năng này'), 'a duplicate row is named')
  assert.deepEqual((await skills())[0], ['lan', 'Phạm Thị Lan', 'cut', 2, false])

  // A level changed and a row removed in one save.
  assert.equal(
    (
      await save({
        updated: [{ id: 'acme:skill:lan:cut', values: { level: 4, lead: true } }],
        removed: ['acme:skill:owner:cut'],
      })
    ).status,
    303,
  )
  assert.deepEqual(await skills(), [['lan', 'Phạm Thị Lan', 'cut', 4, true]])
})
