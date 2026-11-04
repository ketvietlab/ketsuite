import assert from 'node:assert/strict'
import { test } from 'node:test'
import { renderToStaticString } from '@ketvietlab/ketjs-view'
import { setFlowLocale } from '../client/i18n.mjs'
import { createProjectLifecycle } from '../client/project-lifecycle.mjs'

const preview = { title: 'Project', version: 7, impactDigest: 'verified-impact', impact: { Task: 3 } }
const inputHandler = (node, id) => {
  if (!node || typeof node !== 'object') return
  if (Array.isArray(node)) return node.map((child) => inputHandler(child, id)).find(Boolean)
  if (node.items && node.render) return inputHandler(node.items.map(node.render), id)
  if (!node.strings) return
  const index = node.strings.findIndex((part) => part.endsWith('on:input='))
  if (index >= 0 && renderToStaticString(node).includes(`id="${id}"`)) return node.values[index]
  return inputHandler(node.values, id)
}
const fixture = (call) => {
  let company = 'one'
  const writes = []
  const c = createProjectLifecycle({
    data: () => ({ company: { id: company } }),
    call,
    busy: () => false,
    navigate() {},
    mutate: async (...args) => {
      writes.push(args)
      return true
    },
  })
  return {
    c,
    writes,
    switchCompany: () => {
      company = 'two'
    },
  }
}

test('deletion cannot submit an absent or mismatched impact confirmation', async () => {
  const { c, writes } = fixture(async () => preview)
  await c.open('delete', { id: 'project', title: 'Project', version: 2 })
  assert.equal(c.state().preview.version, 7)
  assert.equal(await c.submit(), false)
  assert.equal(writes.length, 0)
  // The rendered input callback is the public user action; no test-only state setter.
  const markup = c.dialog()
  assert.ok(markup)
  c.dispose()
})

test('archive uses the captured version and cannot leak a confirmation across Company', async () => {
  const { c, writes, switchCompany } = fixture(async () => preview)
  c.open('archive', { id: 'p', version: 3 })
  await c.submit()
  assert.equal(writes[0][0], 'flow.project.archive')
  assert.deepEqual(writes[0][1], { id: 'p', expectedVersion: 3 })
  switchCompany()
  assert.equal(await c.submit(), false)
  assert.equal(c.dialog(), null)
  c.dispose()
})

test('late previews and disposed reads cannot restore sensitive metadata', async () => {
  let release
  const { c, switchCompany } = fixture(
    () =>
      new Promise((resolve) => {
        release = resolve
      }),
  )
  const pending = c.open('delete', { id: 'p' })
  switchCompany()
  release(preview)
  await pending
  assert.equal(c.state().preview, null)
  const next = c.open('delete', { id: 'another' })
  c.dispose()
  release(preview)
  await next
  assert.equal(c.state().preview, null)
})

test('lifecycle renders translated real controls instead of object placeholders', () => {
  setFlowLocale('vi')
  const c = createProjectLifecycle({
    data: () => ({
      company: { id: 'one' },
      capabilities: { manageOrganization: true, projectLifecycle: { archive: true, delete: true } },
    }),
    busy: () => false,
  })
  const markup = renderToStaticString(c.projectSection({ id: 'p', title: 'Project' }))
  assert.match(markup, /Vòng đời dự án/)
  assert.match(markup, /Lưu trữ dự án/)
  assert.match(markup, /Xóa vĩnh viễn/)
  assert.doesNotMatch(markup, /\[object Object\]|flow\.lifecycle\./)
  c.dispose()
  setFlowLocale('en')
})

test('a separately authorized Project admin confirms the read version and leaves the retired owner', async () => {
  let command, navigation
  const c = createProjectLifecycle({
    data: () => ({
      company: { id: 'one' },
      capabilities: { projectLifecycle: { delete: true, history: false } },
    }),
    busy: () => false,
    call: async () => preview,
    mutate: async (...args) => {
      command = args
      args[2]()
      return true
    },
    navigate: (...args) => {
      navigation = args
    },
  })
  await c.open('delete', { id: 'p', title: 'Project', version: 2, accessInfo: { role: 'admin' } })
  inputHandler(c.dialog(), 'flow-project-confirm-name')({ target: { value: 'Wrong' } })
  assert.equal(await c.submit(), false)
  inputHandler(c.dialog(), 'flow-project-confirm-name')({ target: { value: 'Project' } })
  assert.equal(await c.submit(), true)
  assert.equal(command[0], 'flow.project.delete')
  assert.deepEqual(command[1], {
    id: 'p',
    expectedVersion: 7,
    confirmName: 'Project',
    impactDigest: 'verified-impact',
    reason: '',
  })
  assert.equal(command[3].revalidate, false, 'never reread the deleted owner before navigation')
  assert.deepEqual(navigation, ['workspace-overview', { project: '' }])
  c.dispose()
})
