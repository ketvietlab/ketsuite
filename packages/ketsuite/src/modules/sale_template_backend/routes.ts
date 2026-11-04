import { randomUUID } from 'node:crypto'
import { json, text, type Route, type Row, type ServeContext } from '@ketvietlab/ketjs'
import { adminPage } from '../backend/screen.ts'
import { optionalRead } from '../backend/optional-read.ts'
import { USER_RECORD_MODAL_LABELS } from '../user/modal-labels.ts'
import { templateRecordScreen } from './screens/record.tsx'
import { templatesScreen } from './screens/list.tsx'
import { templateRead, searchConfig, listLabels } from './list/read.ts'
import { LIST_PATH, queryFromUrl, recordBack } from './list/shared.ts'
const inLocale = (url: URL, path: string) => {
  const next = new URL(path, url)
  for (const key of ['lang', 'company', 'branch'])
    if (url.searchParams.has(key)) next.searchParams.set(key, url.searchParams.get(key)!)
  return next.pathname + next.search
}
export const templateContext =
  (ctx: ServeContext): Route =>
  async (url, req, params) => {
    if (req.method !== 'GET') return text('GET', { status: 405 })
    const creating = params.id === 'new',
      save = await ctx.allows('sale_template.saveTemplate', url, req)
    if (!(await ctx.allows('sale_template.getTemplate', url, req)) || (creating && !save))
      return text('Forbidden', { status: 403 })
    const record = creating
      ? { id: '', name: '', kind: 'quotation', active: true, revision: 0, lines: [], teamIds: [] }
      : ((await ctx.call(
          'sale_template.getTemplate',
          { id: params.id, manage: true },
          url,
          req,
        )) as Row | null)
    if (!record) return text('Not found', { status: 404 })
    const setup = await optionalRead<Row>(ctx, 'sale_template.getSetup', {}, url, req, {
      teams: [],
      units: [],
    })
    const products = await optionalRead<Row[]>(
      ctx,
      'product.listVariants',
      {
        ids: (record.lines as Row[]).flatMap((line) => (line.productId ? [String(line.productId)] : [])),
        includeArchived: true,
      },
      url,
      req,
      [],
    )
    const manifest = await ctx.live(req),
      lang = ctx.localeOf(url, req) === 'en' ? 'en' : 'vi'
    return json({
      data: {
        record,
        save,
        lifecycle: await ctx.allows('sale_template.setTemplateActive', url, req),
        draftId: randomUUID(),
        lang,
        teams: setup.teams,
        units: setup.units,
        products,
      },
      messages: {
        ...Object.fromEntries(
          Object.entries(manifest.messages?.[lang] ?? {}).filter(
            ([key]) => key.startsWith('sale_template.') || key.startsWith('backend.relation.'),
          ),
        ),
        ...USER_RECORD_MODAL_LABELS[lang],
      },
    })
  }
export const templateRecord =
  (ctx: ServeContext): Route =>
  async (url, req, params) => {
    if (req.method !== 'GET') return text('GET', { status: 405 })
    if (
      !(await ctx.allows(
        params.id === 'new' ? 'sale_template.saveTemplate' : 'sale_template.getTemplate',
        url,
        req,
      ))
    )
      return text('Forbidden', { status: 403 })
    return adminPage(ctx, url, req, {
      title: 'sale_template.title',
      active: LIST_PATH,
      body: (_, frame) =>
        templateRecordScreen(_, frame, {
          id: params.id!,
          title: _('sale_template.title'),
          loading: _('backend.relation.loading'),
          back: recordBack(url),
        }),
    })
  }
export const templateList =
  (ctx: ServeContext): Route =>
  async (url, req) => {
    if (req.method !== 'GET') return text('GET', { status: 405 })
    if (!(await ctx.allows('sale_template.listTemplates', url, req)))
      return text('Forbidden', { status: 403 })
    const save = await ctx.allows('sale_template.saveTemplate', url, req)
    return adminPage(ctx, url, req, {
      title: 'sale_template.title',
      active: LIST_PATH,
      body: (_, frame) => {
        const query = queryFromUrl(url)
        return templatesScreen(_, frame, {
          createHref: save ? inLocale(url, LIST_PATH + '/new') : null,
          props: {
            key: randomUUID(),
            source: inLocale(url, LIST_PATH + '/read'),
            query,
            search: searchConfig(url, _),
            labels: listLabels(_),
          },
        })
      },
    })
  }
export const routes = {
  '/admin/sales/templates': templateList,
  '/admin/sales/templates/read': templateRead,
  '/admin/sales/templates/{id}': templateRecord,
  '/admin/sales/templates/{id}/context': templateContext,
}
