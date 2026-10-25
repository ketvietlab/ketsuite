import assert from 'node:assert/strict'
import { test } from 'node:test'
import { html, renderToString, isEach } from '@ketvietlab/ketjs-view'
import type { TemplateResult } from '@ketvietlab/ketjs-view'
import { Field } from '@ketvietlab/design-system'
import { createThemeLogo } from '../packages/website-client/client/theme-logo.tsx'
import { createResourceScreens } from '../packages/website-client/client/screens/resources.tsx'
import { tr } from '../packages/website-client/client/i18n.ts'
import type { StudioContext, Site, ImageUploadOptions } from '../packages/website-client/client/types.ts'

const site: Site = {
  id: 'site-a',
  name: 'Website A',
  host: '',
  locales: ['vi'],
  timezone: 'Asia/Ho_Chi_Minh',
}
const context = (overrides: Partial<StudioContext> = {}): StudioContext => ({
  tr,
  call: async <T>() => undefined as T,
  uploadImage: async () => ({ id: 'logo-a', url: '/website/files/logo-a' }),
  href: (key) => `/website/${key}?site=site-a`,
  can: (key) => key === 'website.site.manage',
  notify: () => {},
  navigate: async () => {},
  refresh: async () => {},
  reload: async () => {},
  route: () => ({ key: 'themes-edit', params: { id: 'site-a' }, query: { site: 'site-a' } }),
  boot: () => ({
    actor: { name: 'Designer', role: '', capabilities: ['website.site.manage'] },
    site,
    sites: [site],
    offer: null,
    home: '/admin',
  }),
  theme: () => 'light',
  site: () => site,
  busy: () => false,
  toasts: () => [],
  slot: () => [],
  ...overrides,
})
const file = (type = 'image/png') => new File([new Uint8Array([137, 80, 78, 71])], 'logo.png', { type })
const form = () => ({ dataset: { uploading: '2' }, isConnected: true }) as unknown as HTMLFormElement
const setup = (overrides: Partial<StudioContext> = {}) => {
  const logo = createThemeLogo(context(overrides))
  logo.load('site-a', 'site-a', 'style-1', '/website/files/old')
  return logo
}

test('public enhanced Field preserves its inline layout and native label association', () => {
  const markup = renderToString(
    Field({
      id: 'asset-upload',
      name: 'asset',
      label: 'Logo',
      layout: 'inline',
      control: html`<input id="asset-upload" type="file" name="file">`,
    }),
  ).replace(/<!--[\s\S]*?-->/gu, '')
  assert.match(markup, /data-ui="field"[^>]*data-layout="inline"/)
  assert.match(markup, /<label[^>]*for="asset-upload"[^>]*>[\s\S]*?Logo[\s\S]*?<\/label>/)
  assert.equal((markup.match(/<input/g) ?? []).length, 1)
  assert.match(markup, /<input id="asset-upload" type="file" name="file"/)
})

test('native appearance uses public ImageDropZone and a single draft URL, with an accessible file picker', () => {
  const screen = createResourceScreens(context())['themes-edit']!
  const markup = renderToString(
    html`${screen.view({ id: 'site-a', title: 'Website A', logo: '/website/files/old' }, context().route())}`,
  )
  assert.match(markup, /data-ui="image-drop-zone"/)
  assert.match(markup, /class="website-theme-logo"/)
  assert.equal((markup.match(/name="logo"/g) ?? []).length, 1)
  assert.match(markup, /type="hidden"[^>]*name="logo"[^>]*value="\/website\/files\/old"/)
  assert.match(markup, /<input(?=[^>]*type="file")(?=[^>]*name="logo-file")/)
  assert.match(markup, /aria-label="Thay logo"/)
  assert.match(
    markup.replace(/<!--[\s\S]*?-->/gu, ''),
    /<label[^>]*for="themes-logo-file"[^>]*>[\s\S]*?Logo website[\s\S]*?<\/label>/,
  )
  assert.doesNotMatch(markup, /Đường dẫn logo|type="text"[^>]*name="logo"/)
  screen.dispose?.()
})

test('Site upload reserves the form, prevents duplicate/removal and submits only a settled draft', async () => {
  let complete!: (value: { id: string; url: string }) => void
  let owner!: ImageUploadOptions
  let uploads = 0
  const logo = setup({
    uploadImage: async (_file, options) => {
      owner = options
      uploads++
      return new Promise((resolve) => {
        complete = resolve
      })
    },
  })
  const target = form()
  const pending = logo.select([file()], target)
  assert.equal(target.dataset.uploading, '3')
  assert.equal(logo.busy(), true)
  assert.equal(owner.resModel, 'website.Site')
  assert.equal(owner.id, 'site-a')
  assert.equal(owner.siteId, 'site-a')
  assert.equal(owner.field, 'logo')
  await logo.select([file()], target)
  logo.remove()
  assert.equal(uploads, 1)
  assert.equal(logo.value(), '/website/files/old')
  complete({ id: 'logo-a', url: '/website/files/logo-a' })
  await pending
  assert.equal(logo.busy(), false)
  assert.equal(target.dataset.uploading, '2')
  assert.equal(logo.value(), '/website/files/logo-a')
  logo.remove()
  assert.equal(logo.value(), '')
})

test('invalid images, missing permission and an active save preserve the previous logo', async () => {
  let uploads = 0
  const logo = setup({
    uploadImage: async () => {
      uploads++
      throw new Error('should not upload')
    },
  })
  for (const files of [
    [],
    [file('image/svg+xml')],
    [file(), file()],
    [new File([], 'empty.png', { type: 'image/png' })],
    [new File([new Uint8Array(5 * 1024 * 1024 + 1)], 'large.png', { type: 'image/png' })],
  ]) {
    await logo.select(files)
    assert.equal(logo.value(), '/website/files/old')
  }
  assert.equal(uploads, 0)
  for (const overrides of [{ can: () => false }, { busy: () => true }]) {
    const locked = setup(overrides)
    await locked.select([file()])
    locked.remove()
    assert.equal(locked.value(), '/website/files/old')
    assert.match(renderToString(locked.view('', false)), /disabled/)
  }
})

test('failed or unsafe uploads keep the old URL, release the form and allow retry', async () => {
  let attempt = 0
  const logo = setup({
    uploadImage: async () => {
      attempt++
      if (attempt === 1) throw new Error('storage failure')
      return { id: 'new', url: attempt === 2 ? 'javascript:bad' : '/website/files/new' }
    },
  })
  const target = form()
  for (let i = 0; i < 2; i++) {
    await logo.select([file()], target)
    assert.equal(logo.value(), '/website/files/old')
    assert.equal(target.dataset.uploading, '2')
    assert.match(renderToString(logo.view('', false)), /Ảnh cũ được giữ lại/)
  }
  await logo.select([file()], target)
  assert.equal(logo.value(), '/website/files/new')
})

test('site switches, disposal and detached forms abort or ignore stale upload responses exactly once', async () => {
  for (const end of ['switch', 'dispose', 'detach']) {
    let complete!: (value: { id: string; url: string }) => void
    let owner!: ImageUploadOptions
    const logo = setup({
      uploadImage: async (_file, options) => {
        owner = options
        return new Promise((resolve) => {
          complete = resolve
        })
      },
    })
    const target = form()
    const pending = logo.select([file()], target)
    if (end === 'switch') logo.load('site-b', 'site-b', 'style-b', '/website/files/b')
    if (end === 'dispose') logo.dispose()
    if (end === 'detach') Object.assign(target, { isConnected: false })
    assert.equal(owner.signal?.aborted, end !== 'detach')
    complete({ id: 'late', url: '/website/files/late' })
    await pending
    assert.equal(target.dataset.uploading, '2')
    assert.notEqual(logo.value(), '/website/files/late')
    assert.equal(logo.busy(), false)
  }
})

// Resolve actual native JSX event bindings, not a second implementation of the control.
const eventsFor = (value: unknown): Record<string, (event: Event) => void> | undefined => {
  if (isEach(value)) return eventsFor(value.items.map(value.render))
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = eventsFor(item)
      if (found) return found
    }
    return
  }
  if (!value || typeof value !== 'object' || !('values' in value)) return
  const view = value as TemplateResult
  if (view.values.includes('website-theme-logo')) {
    return Object.fromEntries(
      view.strings.flatMap((part, index) => {
        const event = /on:(\w+)=$/.exec(part)
        const handler = view.values[index]
        return event && typeof handler === 'function' ? [[event[1], handler as (event: Event) => void]] : []
      }),
    )
  }
  return eventsFor(view.values)
}

test('native picker/drop bindings stage the URL, block a pending form save and preserve title/CAS on submit', async () => {
  const record = {
    id: 'site-a',
    kind: 'themes',
    revisionId: 'style-1',
    title: 'Website A',
    logo: '/website/files/old',
    archivable: false,
  }
  let complete!: (value: { id: string; url: string }) => void
  let writes = 0
  let saved!: Record<string, unknown>
  const ctx = context({
    call: async <T>(name: string, input?: object) => {
      if (name === 'website_studio.getResource') return record as T
      writes++
      saved = input as Record<string, unknown>
      return { ...record, ...(saved.values as object) } as T
    },
    uploadImage: async () =>
      new Promise((resolve) => {
        complete = resolve
      }),
  })
  const screen = createResourceScreens(ctx)['themes-edit']!
  await screen.read!(ctx.route(), new AbortController().signal)
  const target = form()
  target.dataset.uploading = '0'
  let prevented = 0
  const root = { closest: () => target }
  const events = eventsFor(screen.view!(record, ctx.route()))!
  events.dragover!({
    dataTransfer: { types: ['Files'] },
    preventDefault: () => prevented++,
  } as unknown as Event)
  events.drop!({
    currentTarget: root,
    dataTransfer: { files: [file()] },
    preventDefault: () => prevented++,
  } as unknown as Event)
  assert.equal(prevented, 2)
  assert.equal(target.dataset.uploading, '1')
  const values = new FormData()
  values.set('title', 'Tên đang nhập')
  values.set('logo', '/website/files/old')
  await screen.commands!['resource.themes.save']!({}, values)
  assert.equal(writes, 0, 'pending upload never writes a stale URL')
  complete({ id: 'new', url: '/website/files/new' })
  await new Promise(setImmediate)
  assert.equal(target.dataset.uploading, '0')
  const markup = renderToString(html`${screen.view!(record, ctx.route())}`)
  assert.match(markup, /name="logo"[^>]*value="\/website\/files\/new"/)
  assert.doesNotMatch(
    markup,
    /resource\.themes\.archive/,
    'native Site style is not an archivable theme record',
  )
  values.set('logo', '/website/files/new')
  values.set('logo-file', file())
  await screen.commands!['resource.themes.save']!({}, values)
  assert.equal(writes, 1)
  assert.equal(saved.expectedRevisionId, 'style-1')
  assert.equal((saved.values as Record<string, unknown>).title, 'Tên đang nhập')
  assert.equal((saved.values as Record<string, unknown>).logo, '/website/files/new')
  assert.equal('logo-file' in (saved.values as object), false)
  const input = { type: 'file', files: [file()], value: 'logo.png', closest: () => target }
  eventsFor(screen.view!(record, ctx.route()))!.change!({ target: input } as unknown as Event)
  assert.equal(input.value, '', 'choosing the same file again can emit change')
  screen.dispose?.()
  complete({ id: 'late', url: '/website/files/late' })
  await new Promise(setImmediate)
  assert.equal(target.dataset.uploading, '0')
})

test('bundled native starters expose their content without enabled save/archive controls', () => {
  const screen = createResourceScreens(context())['templates-edit']!
  const markup = renderToString(
    html`${screen.view({ id: 'website-introduction', title: 'Giới thiệu', readOnly: true }, context().route())}`,
  )
  assert.match(markup, /Mẫu cài sẵn thuộc module/)
  assert.doesNotMatch(markup, /resource\.templates\.(save|archive)/)
  assert.match(markup, /disabled/)
})
