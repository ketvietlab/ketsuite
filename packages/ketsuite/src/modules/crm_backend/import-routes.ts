import { randomUUID } from 'node:crypto'
import type { IncomingMessage } from 'node:http'
import { json, multipart, text, withHeaders } from '@ketvietlab/ketjs'
import type { Row, RouteEntry, ServeContext } from '@ketvietlab/ketjs'
import { defineFormSchema, validateForm } from '@ketvietlab/ketjs-view'
import { adminPage } from '../backend/screen.ts'
import { seeOther } from '../backend/forms.ts'
import { defaultImportRules, IMPORT_LIMITS, importNameKey } from '../crm/import-contract.ts'
import type { ImportRules } from '../crm/import-contract.ts'
import { ImportFrame } from './screens/import-frame.tsx'
import { readObject, records, say } from './screens/import-ui.tsx'
import type { ImportVm } from './screens/import-ui.tsx'

type CommandForm = Record<string, string[]>
const checked = (value: unknown) => ['1', 'true', 'on'].includes(String(value))
const value = (form: CommandForm, key: string) => form[key]?.at(-1) || ''
const need: Record<ImportVm['screen'], string> = {
  batches: 'crm.import.list',
  wizard: 'crm.import.upload',
  batch: 'crm.import.get',
  tags: 'crm.tag.catalogue',
  records: 'crm.case.tagged',
}
const boundedBody = async (source: AsyncIterable<Uint8Array>, limit: number) => {
  const chunks: Buffer[] = []
  let bytes = 0
  for await (const chunk of source) {
    bytes += chunk.length
    if (bytes > limit) throw new Error('size')
    chunks.push(Buffer.from(chunk))
  }
  return Buffer.concat(chunks)
}
async function commandForm(req: IncomingMessage): Promise<CommandForm> {
  const form: CommandForm = {},
    type = String(req.headers['content-type'] || '')
  const put = (key: string, item: string) => {
    if (key.startsWith('ids.') && checked(item)) {
      form.ids = [...new Set([...(form.ids || []), key.slice(4)])]
      return
    }
    ;(form[key.replace(/\[\]$/u, '')] ??= []).push(item)
  }
  if (type.startsWith('multipart/form-data')) {
    let file = false
    for await (const part of multipart(req, type, {
      maxBytes: IMPORT_LIMITS.bytes + 1024 * 1024,
      maxParts: 16,
    })) {
      const bytes = await boundedBody(part.body, part.filename ? IMPORT_LIMITS.bytes : IMPORT_LIMITS.bytes)
      if (part.filename && bytes.length) {
        if (file || part.name !== 'file') throw new Error('format')
        file = true
        put('filename', part.filename.replace(/^.*[\\/]/u, ''))
        put('content', bytes.toString('base64'))
      } else if (!part.filename) put(part.name, bytes.toString('utf8'))
    }
  } else {
    const raw = (await boundedBody(req, 512 * 1024)).toString('utf8')
    for (const [key, item] of new URLSearchParams(raw)) put(key, item)
  }
  return form
}
const importRuleSchema = defineFormSchema({
  fields: {
    kind: { type: 'text', required: true, oneOf: ['lead', 'opportunity'] },
    assignment: { type: 'text', required: true, oneOf: ['rules', 'team', 'person', 'unassigned'] },
    duplicate: { type: 'text', required: true, oneOf: ['merge', 'skip', 'create'] },
    source: { type: 'text', trim: true, maxLength: 240 },
    medium: { type: 'text', trim: true, maxLength: 240 },
    campaign: { type: 'text', trim: true, maxLength: 240 },
  },
  unknown: 'drop',
})
const batchId = (url: URL) => decodeURIComponent(url.pathname.split('/')[4] || '')
const link = (lang: string, path: string, params: Record<string, unknown> = {}) => {
  const query = new URLSearchParams({ lang })
  for (const [key, value] of Object.entries(params))
    if (value != null && value !== '') query.set(key, String(value))
  return `${path}?${query}`
}

async function loadVm(
  ctx: ServeContext,
  url: URL,
  req: IncomingMessage,
  screen: ImportVm['screen'],
): Promise<ImportVm> {
  const lang = ctx.localeOf(url, req) === 'en' ? 'en' : 'vi'
  const query = Object.fromEntries(url.searchParams)
  const options = (await ctx.call('crm.import.options', {}, url, req)) as ImportVm['options']
  options.permissions.tagRecords = await ctx.allows('crm.case.tags', url, req)
  const vm: ImportVm = {
    screen,
    lang,
    query,
    base: url.pathname,
    action: link(lang, '/admin/crm/imports/command'),
    requestId: randomUUID(),
    options,
    data: { clock: Date.now() },
    errors: [],
    notice: query.notice === 'saved' ? say({ lang }, 'Thao tác đã được lưu.', 'The change was saved.') : '',
  }
  if (screen === 'wizard' || screen === 'batch') {
    const id = screen === 'wizard' ? query.id : batchId(url)
    if (id) {
      Object.assign(vm.data, (await ctx.call('crm.import.get', { id }, url, req)) as Row)
      if (vm.data.batch && screen === 'wizard' && query.step === 'review') {
        const response = (await ctx.call(
          'crm.import.preview',
          { id, offset: Number(query.offset) || 0, outcome: query.outcome },
          url,
          req,
        )) as Row
        vm.data.preview = response.preview
        if (response.ok === false) vm.errors = records(response.errors) as ImportVm['errors']
      }
      if (vm.data.batch && screen === 'batch' && query.tab === 'rows')
        Object.assign(
          vm.data,
          (await ctx.call(
            'crm.import.rows',
            {
              id,
              offset: Number(query.offset) || 0,
              outcome: query.outcome,
              assigneeUserId: query.assigneeUserId,
              issue: query.issue,
            },
            url,
            req,
          )) as Row,
        )
      if (vm.data.batch && screen === 'batch' && query.tab === 'performance')
        Object.assign(vm.data, (await ctx.call('crm.import.performance', { id }, url, req)) as Row)
    }
  }
  if (screen === 'tags' && query.tagId) {
    vm.data = (await ctx.call(
      'crm.tag.catalogue',
      { id: query.tagId, offset: Number(query.offset) || 0, search: query.search, filter: query.filter },
      url,
      req,
    )) as Row
  }
  return vm
}

const render = (ctx: ServeContext, url: URL, req: IncomingMessage, vm: ImportVm, status = 200) =>
  adminPage(ctx, url, req, {
    title: say(vm, 'CRM · Nhập lead và nhãn', 'CRM · Lead imports and tags'),
    translate: false,
    status,
    body: (_, frame) => ImportFrame(vm, _, frame),
  })
const importPage =
  (screen: ImportVm['screen']): RouteEntry =>
  (ctx) =>
  async (url, req) => {
    if (req.method !== 'GET') return text('GET', { status: 405 })
    if (!(await ctx.allows(need[screen], url, req))) return text('Forbidden', { status: 403 })
    const vm = await loadVm(ctx, url, req, screen)
    if ((screen === 'batch' || (screen === 'wizard' && vm.query.id)) && !vm.data.batch)
      return text('Not found', { status: 404 })
    if (
      screen === 'wizard' &&
      vm.data.batch &&
      !['draft', 'ready'].includes(String((vm.data.batch as Row).state))
    )
      return seeOther(
        link(vm.lang, `/admin/crm/imports/${encodeURIComponent(String((vm.data.batch as Row).id))}`),
      )
    return render(ctx, url, req, vm)
  }

const importCommand: RouteEntry = (ctx) => async (url, req) => {
  if (req.method !== 'POST') return text('POST', { status: 405 })
  if (req.headers['sec-fetch-site'] === 'cross-site') return text('Forbidden', { status: 403 })
  if (req.headers.origin) {
    try {
      if (new URL(req.headers.origin).host !== String(req.headers.host || ''))
        return text('Forbidden', { status: 403 })
    } catch {
      return text('Forbidden', { status: 403 })
    }
  }
  if (!(await ctx.allows('crm.import.options', url, req))) return text('Forbidden', { status: 403 })
  let form: CommandForm
  try {
    form = await commandForm(req)
  } catch {
    return text('Invalid or oversized import request', { status: 413 })
  }
  const operation = value(form, 'operation'),
    intent = value(form, 'intent'),
    id = value(form, 'id'),
    version = Number(value(form, 'version')),
    lang = ctx.localeOf(url, req) === 'en' ? 'en' : 'vi'
  const operations: Record<string, string> = {
    upload: 'crm.import.upload',
    mapping: 'crm.import.configure',
    rules: 'crm.import.configure',
    start: 'crm.import.start',
    stop: 'crm.import.stop',
    resume: 'crm.import.resume',
    undo: 'crm.import.undo',
    batchTags: 'crm.import.tag',
    saveTag: 'crm.tag.save',
    archiveTag: 'crm.tag.archive',
    reviewMergeTag: 'crm.tag.merge',
    mergeTag: 'crm.tag.merge',
    recordTags: 'crm.case.tags',
  }
  const fn = operations[operation]
  if (!fn || !(await ctx.allows(fn, url, req))) return text('Forbidden', { status: 403 })
  const call = async (key: string, data: Row) => (await ctx.call(key, data, url, req)) as Row
  let input: Row = { id, version },
    destination = link(lang, `/admin/crm/imports/${encodeURIComponent(id)}`),
    screen: ImportVm['screen'] = 'batch',
    source = new URL(destination, url)
  let attemptedRules: ImportRules | undefined, attemptedMapping: string[] | undefined
  if (operation === 'upload') {
    const paste = value(form, 'paste'),
      content = value(form, 'content') || Buffer.from(paste).toString('base64')
    input = {
      id: id || randomUUID(),
      name: value(form, 'name'),
      filename: value(form, 'filename') || 'clipboard.csv',
      content,
      header: checked(value(form, 'header')),
    }
    screen = 'wizard'
    source = new URL(link(lang, '/admin/crm/imports/new'), url)
  }
  if (operation === 'mapping' || operation === 'rules') {
    const batch = (await call('crm.import.get', { id })).batch as Row | undefined
    if (!batch) return text('Not found', { status: 404 })
    const rules = readObject<ImportRules>(batch.rules, defaultImportRules())
    if (operation === 'mapping') {
      attemptedMapping = readObject<string[]>(batch.headers, []).map((_, index) =>
        value(form, `map.${index}`),
      )
      for (const [kind, field] of [
        ['recordTags', 'tagValues'],
        ['customerLabels', 'customerLabelValues'],
      ] as const) {
        const values = readObject<string[]>(batch[field], [])
        rules[field] = {
          ...rules[field],
          ...Object.fromEntries(values.map((name, index) => [name, value(form, `${kind}.${index}`)])),
        }
      }
      input = {
        id,
        version,
        mapping: attemptedMapping,
        rules,
        ...(intent === 'sheet' ? { sheet: value(form, 'sheet') } : {}),
      }
      destination = link(lang, '/admin/crm/imports/new', {
        id,
        step: ['mapping', 'sheet'].includes(intent) ? 'mapping' : 'rules',
      })
    } else {
      const raw = Object.fromEntries(Object.entries(form).map(([key, values]) => [key, values.at(-1)]))
      const validated = validateForm(importRuleSchema, raw)
      attemptedRules = {
        ...rules,
        kind: value(form, 'kind') as ImportRules['kind'],
        source: value(form, 'source'),
        medium: value(form, 'medium'),
        campaign: value(form, 'campaign'),
        assignment: value(form, 'assignment') as ImportRules['assignment'],
        teamId: value(form, 'teamId') || rules.teamId,
        assigneeUserId: value(form, 'assigneeUserId') || rules.assigneeUserId,
        duplicate: value(form, 'duplicate') as ImportRules['duplicate'],
        tags: form.tags || [],
        firstTask: checked(value(form, 'firstTask')),
        due: (value(form, 'due') || rules.due) as ImportRules['due'],
      }
      if (intent === 'addTag') {
        if (!(await ctx.allows('crm.tag.save', url, req))) return text('Forbidden', { status: 403 })
        const name = value(form, 'newTag').trim().replace(/\s+/gu, ' ')
        const options = await call('crm.import.options', {})
        const existing = records(options.tags).find((tag) => importNameKey(tag.name) === importNameKey(name))
        if (
          name &&
          name.length <= 80 &&
          !attemptedRules.tags.some((tag) => importNameKey(tag) === importNameKey(name))
        )
          attemptedRules.tags.push(String(existing?.name || name))
      }
      input = { id, version, rules: attemptedRules, review: intent === 'next' }
      if (!validated.valid) input.rules = { ...attemptedRules, kind: '' }
      destination = link(lang, '/admin/crm/imports/new', { id, step: intent === 'next' ? 'review' : 'rules' })
    }
    screen = 'wizard'
    source = new URL(
      link(lang, '/admin/crm/imports/new', { id, step: operation === 'mapping' ? 'mapping' : 'rules' }),
      url,
    )
  }
  if (operation === 'batchTags') input = { id, names: form.tags || [] }
  if (['saveTag', 'archiveTag', 'reviewMergeTag', 'mergeTag'].includes(operation)) {
    screen = 'tags'
    destination = link(lang, '/admin/crm/tags', { notice: 'saved' })
    source = new URL(link(lang, '/admin/crm/tags', { tagId: id }), url)
    if (operation === 'saveTag') input = { id, name: value(form, 'name'), color: value(form, 'color') }
    if (operation === 'archiveTag') input = { id }
    if (operation === 'mergeTag') input = { sourceId: id, targetId: value(form, 'targetId') }
    if (operation === 'reviewMergeTag')
      return seeOther(
        link(lang, '/admin/crm/tags', { tagId: id, dialog: 'merge', targetId: value(form, 'targetId') }),
      )
  }
  if (operation === 'recordTags') {
    if (!['add', 'remove', 'removeConfirmed'].includes(intent)) return text('Invalid action', { status: 400 })
    screen = 'records'
    const query = Object.fromEntries(new URLSearchParams(value(form, 'query')))
    destination = link(lang, '/admin/crm/tagged-records', { ...query, notice: 'saved' })
    source = new URL(destination, url)
    if (intent === 'remove' && form.ids?.length) {
      const vm = await loadVm(ctx, source, req, screen)
      vm.data.removeTags = { ids: form.ids.slice(0, 100), tagId: value(form, 'tagId') }
      return render(ctx, source, req, vm)
    }
    input = {
      ids: form.ids || [],
      tagIds: [value(form, 'tagId')],
      operation: intent === 'removeConfirmed' ? 'remove' : 'add',
    }
  }
  const result = await call(fn, input)
  if (result.ok === false || records(result.errors).length) {
    const vm = await loadVm(ctx, source, req, screen)
    vm.errors = records(result.errors) as ImportVm['errors']
    if (result.ok === true)
      vm.notice = say(
        vm,
        `${records(result.changed).length || readObject<string[]>(result.changed, []).length} hồ sơ đã được cập nhật; các dòng còn lại chưa thay đổi.`,
        `${readObject<string[]>(result.changed, []).length} records updated; the remaining records were not changed.`,
      )
    if (attemptedRules && vm.data.batch) (vm.data.batch as Row).rules = attemptedRules
    if (attemptedMapping && vm.data.batch) (vm.data.batch as Row).mapping = attemptedMapping
    if (operation === 'upload') {
      vm.data.paste = value(form, 'paste')
      vm.data.name = value(form, 'name')
    }
    if (operation === 'saveTag') vm.data.selected = { ...((vm.data.selected as Row) || {}), ...input }
    return render(ctx, source, req, vm, 422)
  }
  if (operation === 'upload')
    destination = link(lang, '/admin/crm/imports/new', { id: result.id, step: 'mapping' })
  return seeOther(destination)
}

const importStatus: RouteEntry = (ctx) => async (url, req) => {
  if (req.method !== 'GET') return text('GET', { status: 405 })
  if (!(await ctx.allows('crm.import.get', url, req))) return text('Forbidden', { status: 403 })
  const data = (await ctx.call('crm.import.get', { id: batchId(url) }, url, req)) as Row
  return withHeaders(json({ ...data, clock: Date.now() }, { status: data.batch ? 200 : 404 }), {
    'cache-control': 'no-store',
  })
}
const importExport: RouteEntry = (ctx) => async (url, req) => {
  if (req.method !== 'GET') return text('GET', { status: 405 })
  if (!(await ctx.allows('crm.import.export', url, req))) return text('Forbidden', { status: 403 })
  const result = (await ctx.call(
    'crm.import.export',
    { id: batchId(url), errorsOnly: url.searchParams.get('errorsOnly') === '1' },
    url,
    req,
  )) as Row
  if (!result.ok) return text('Not found', { status: 404 })
  return withHeaders(text(String(result.content)), {
    'content-type': 'text/csv; charset=utf-8',
    'content-disposition': 'attachment; filename="crm-import-results.csv"',
    'cache-control': 'no-store',
  })
}
const importCollection: RouteEntry = (ctx) => async (url, req) => {
  if (req.method !== 'POST') return text('POST', { status: 405 })
  const screen = url.searchParams.get('screen') as ImportVm['screen']
  if (!['batches', 'tags', 'records'].includes(screen) || !(await ctx.allows(need[screen], url, req)))
    return json({ ok: false }, { status: 403 })
  let input: Row
  try {
    input = JSON.parse((await boundedBody(req, 8192)).toString('utf8')) as Row
  } catch {
    return json({ ok: false }, { status: 400 })
  }
  if (!input || typeof input !== 'object' || Array.isArray(input)) return json({ ok: false }, { status: 400 })
  const page = Math.min(1000000, Math.max(1, Math.floor(Number(input.page) || 1))),
    offset = (page - 1) * 50
  const q = String(input.q || '').slice(0, 100)
  const args =
    screen === 'batches'
      ? { offset, limit: 50, search: q, state: String(input.state || '') }
      : screen === 'tags'
        ? { offset, search: q, filter: String(input.filter || '') }
        : {
            cursor: String(offset),
            limit: 50,
            search: q,
            tagId: String(input.tagId || ''),
            untagged: input.untagged === '1',
            batchId: url.searchParams.get('batchId') || undefined,
          }
  const result = (await ctx.call(need[screen], args, url, req)) as Row
  const rows = records(result.rows),
    total = Number(result.total || 0),
    actualOffset = Number(result.offset ?? offset)
  return withHeaders(
    json({
      ok: true,
      value: {
        query: { ...input, q, page: Math.floor(actualOffset / 50) + 1, pageSize: 50 },
        rows,
        total,
        page: Math.floor(actualOffset / 50) + 1,
        pages: Math.max(1, Math.ceil(total / 50)),
        counts: { view: { all: total }, filters: {} },
        isEmpty: total === 0 && !q && !input.state && !input.filter && !input.tagId && !input.untagged,
      },
    }),
    { 'cache-control': 'no-store' },
  )
}

export const importRoutes: Record<string, RouteEntry> = {
  '/admin/crm/imports': importPage('batches'),
  '/admin/crm/imports/new': importPage('wizard'),
  '/admin/crm/imports/command': importCommand,
  '/admin/crm/imports/collection': importCollection,
  '/admin/crm/imports/{id}/status': importStatus,
  '/admin/crm/imports/{id}/export': importExport,
  '/admin/crm/imports/{id}': importPage('batch'),
  '/admin/crm/tags': importPage('tags'),
  '/admin/crm/tagged-records': importPage('records'),
}
