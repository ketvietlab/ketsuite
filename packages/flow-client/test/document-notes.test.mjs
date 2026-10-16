import test from 'node:test'
import assert from 'node:assert/strict'
import { documentTitle, noteInput } from '../dist/document-notes.mjs'
import { createDocuments } from '@ketvietlab/flow-client/documents.mjs'
import { createFixtureSession } from '../atlas/store.mjs'

test('notes derive the title from the first nonempty text line without changing rich content', () => {
  const blocks = [
    {
      type: 'h1',
      delta: [{ insert: '  Nhật ký ' }, { insert: '日本語\nNội dung khác', attributes: { bold: true } }],
    },
  ]
  const before = structuredClone(blocks)
  assert.equal(documentTitle(blocks), 'Nhật ký 日本語')
  assert.deepEqual(blocks, before)
  assert.equal(documentTitle([{ text: '\r\n  \nTiêu đề\rNội dung' }]), 'Tiêu đề')
  assert.equal(documentTitle([{ type: 'image' }, { text: '' }]), 'Untitle')
  assert.equal(documentTitle([{ text: 'Tên rất dài '.repeat(100) }]), 'Tên rất dài '.repeat(100).trim())
})

test('new notes preserve workspace/project ownership and private parent visibility', () => {
  assert.equal(noteInput().projectId, null)
  const child = noteInput({
    projectId: 'wrong',
    visibility: 'shared',
    parent: { id: 'parent', projectId: 'core', visibility: 'private' },
  })
  assert.equal(child.title, 'Untitle')
  assert.equal(child.titleSource, 'content')
  assert.equal(child.parentId, 'parent')
  assert.equal(child.projectId, 'core')
  assert.equal(child.visibility, 'private')
  assert.deepEqual(child.blocks, [{ id: 'title', type: 'h1', text: 'Untitle' }])
  const fixture = createFixtureSession()
  const created = fixture.call('flow.entity.save', {
    ...noteInput({ projectId: 'core' }),
    idempotencyKey: 'note-create',
  }).value
  const page = fixture.data.pages.find((p) => p.id === created.id)
  assert.equal(page.titleSource, 'content')
  fixture.call('flow.entity.save', {
    collection: 'pages',
    entityId: page.id,
    title: 'Đổi từ nội dung',
    projectId: 'core',
    parentId: null,
    blocks: [{ id: 'title', type: 'h1', text: 'Đổi từ nội dung' }],
    idempotencyKey: 'note-save',
  })
  assert.equal(page.titleSource, 'content')
  assert.equal(page.title, 'Đổi từ nội dung')
  assert.equal(
    fixture.call('flow.entity.save', { ...noteInput({ projectId: 'core' }), idempotencyKey: 'note-create' })
      .value.id,
    created.id,
  )
})

function controller({
  screen = 'page-new',
  writable = true,
  parent,
  fail = false,
  visibility = 'shared',
} = {}) {
  let route = screen,
    currentVisibility = visibility,
    release
  const calls = [],
    navigations = []
  const hold = new Promise((resolve) => {
    release = resolve
  })
  const docs = createDocuments({
    screen: () => route,
    record: () => parent?.id ?? '',
    project: () => 'core',
    workspaceId: () => 'product',
    data: () => ({ company: { id: 'demo' }, pages: parent ? [parent] : [] }),
    canWrite: () => writable,
    busy: () => false,
    documentReturn: () => '/flow/all-pages?docq=release',
    libraryVisibility: () => currentVisibility,
    root: () => null,
    mutate: async (name, input, success) => {
      calls.push({ name, input })
      await hold
      if (fail) return false
      success({ id: 'new-note' })
      return true
    },
    navigate: (...args) => {
      navigations.push(args)
      route = args[0]
    },
  })
  return {
    docs,
    calls,
    navigations,
    release,
    setVisibility: (value) => {
      currentVisibility = value
    },
  }
}

test('root creation honors explicit visibility instead of a previous private document scope', async () => {
  for (const visibility of ['shared', 'private']) {
    const x = controller({ visibility: 'private' })
    x.setVisibility(visibility)
    const created = x.docs.create()
    assert.equal(x.calls[0].input.visibility, visibility)
    x.release()
    assert.equal(await created, true)
    x.docs.dispose()
  }
})

test('direct creation has one write for a double click and opens the created document without a modal', async () => {
  const x = controller()
  const first = x.docs.create()
  assert.equal(await x.docs.create(), false)
  assert.equal(x.calls.length, 1)
  x.release()
  assert.equal(await first, true)
  assert.deepEqual(x.navigations[0], [
    'page',
    { id: 'new-note', project: 'core', scope: 'project', returnTo: '/flow/all-pages?docq=release' },
    { replace: true },
  ])
  x.docs.dispose()
})

test('failed creation remains recoverable and read-only/missing/private parents cannot be bypassed', async () => {
  const x = controller({ fail: true })
  x.release()
  assert.equal(await x.docs.create(), false)
  assert.equal(await x.docs.create(), false)
  assert.equal(x.calls.length, 2)
  assert.equal(x.navigations.length, 0)
  for (const options of [
    { writable: false },
    { screen: 'page-child' },
    { screen: 'page-child', parent: { id: 'parent', access: { write: false } } },
  ]) {
    const denied = controller(options)
    assert.equal(await denied.docs.create(), false)
    assert.equal(denied.calls.length, 0)
    denied.docs.dispose()
  }
  const child = controller({
    screen: 'page-child',
    parent: { id: 'parent', projectId: null, visibility: 'private' },
  })
  child.release()
  await child.docs.create()
  assert.equal(child.calls[0].input.parentId, 'parent')
  assert.equal(child.calls[0].input.projectId, null)
  assert.equal(child.calls[0].input.visibility, 'private')
  child.docs.dispose()
  x.docs.dispose()
})

test('repeated reads of a creation entry do not create extra notes', async () => {
  const x = controller()
  x.docs.enter()
  x.docs.enter()
  assert.equal(x.calls.length, 1)
  x.release()
  await new Promise(setImmediate)
  x.docs.enter()
  assert.equal(x.calls.length, 1)
  x.docs.dispose()
})

test('the note save-error fixture fails one write without modifying the document and accepts its retry', () => {
  const fixture = createFixtureSession('note-save-error', 'page')
  const page = fixture.data.pages.find((p) => p.id === 'note-first')
  const input = {
    collection: 'pages',
    entityId: page.id,
    title: 'Tiêu đề giữ qua lỗi',
    projectId: 'core',
    blocks: [{ id: 'title', type: 'h1', text: 'Tiêu đề giữ qua lỗi' }],
    idempotencyKey: 'note-retry',
  }
  assert.equal(fixture.call('flow.entity.save', input).value.errors[0].code, 'unavailable')
  assert.equal(page.title, 'Ghi chú phát hành')
  assert.equal(fixture.call('flow.entity.save', input).value.id, page.id)
  assert.equal(page.title, input.title)
  assert.equal(page.titleSource, 'content')
})

test('autosave keeps edits made during a write, retries a failed draft, and does not write it into another tenant', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  let data = {
    company: { id: 'a' },
    pages: [{ id: 'note', title: 'Untitle', titleSource: 'content', version: 1, projectId: null }],
  }
  const writes = [],
    pending = []
  const docs = createDocuments({
    data: () => data,
    canWrite: () => true,
    screen: () => 'page',
    record: () => 'note',
    mutate: (_, input) => {
      writes.push(structuredClone(input))
      return new Promise((resolve) => pending.push(resolve))
    },
  })
  const value = (text) => ({
    snapshot: text,
    blocks: [{ id: 'title', type: 'h1', delta: [{ insert: text }] }],
  })
  docs.edit('note', value('Đầu tiên'))
  t.mock.timers.tick(600)
  assert.equal(writes[0].title, 'Đầu tiên')
  docs.edit('note', value('Bản sau\nGiữ nội dung'))
  const firstSave = docs.save('note')
  pending.shift()(true)
  await firstSave
  assert.equal(docs.hasChanges(), true)
  data.pages[0].version++
  t.mock.timers.tick(600)
  assert.equal(writes[1].title, 'Bản sau')
  assert.equal(writes[1].expectedVersion, 2)
  assert.equal(writes[1].liveDoc, 'Bản sau\nGiữ nội dung')
  const secondSave = docs.flush()
  pending.shift()(false)
  await secondSave
  assert.equal(docs.hasChanges(), true)
  const retry = docs.flush()
  pending.shift()(true)
  await retry
  assert.equal(docs.hasChanges(), false)
  docs.edit('note', value('Không gửi sang B'))
  data = {
    company: { id: 'b' },
    pages: [{ id: 'note', title: 'Tenant B', titleSource: 'content', version: 1 }],
  }
  t.mock.timers.tick(600)
  await new Promise(queueMicrotask)
  assert.equal(writes.length, 3)
  docs.edit('note', value('Bản nháp B'))
  assert.equal(docs.hasPendingNotes(), true)
  docs.discardPendingNotes()
  assert.equal(docs.hasPendingNotes(), false)
  t.mock.timers.tick(600)
  assert.equal(writes.length, 3)
  docs.edit('note', value('Sự kiện cũ'), 'a')
  t.mock.timers.tick(600)
  assert.equal(writes.length, 3)
  docs.dispose()
})
