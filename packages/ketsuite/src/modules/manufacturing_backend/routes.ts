import { optionalRead } from '../backend/optional-read.ts'
import { rowListSearch } from '../backend/row-list.ts'
import {
  bomListSearch,
  ORDER_SOURCES,
  productionListSearch,
  varianceListSearch,
  workCenterListSearch,
  workOrderListSearch,
} from './search.ts'
import { encodeListState, parseListState, text } from '@ketvietlab/ketjs'
import type { Route, RouteEntry, ServeContext } from '@ketvietlab/ketjs'
import type { Translator } from '@ketvietlab/ketjs'
import { modalWorkspace } from '../../ui/index.ts'
import type { FormField, Frame } from '../../ui/index.ts'
import { readForm, seeOther } from '../backend/forms.ts'
import { adminPage, choices, inLocale, resultErrors } from '../backend/screen.ts'
import type { AnyRow } from '../backend/screen.ts'
import {
  bomCreateModal,
  bomsListScreen,
  orderCreateScreen,
  orderScreen,
  ordersListScreen,
  workCenterFormModal,
  workCentersListScreen,
  workCentersLockedScreen,
  consumptionVarianceScreen,
  workOrderScreen,
  workOrdersListScreen,
} from './screens/index.ts'
import type { WorkCenterFormValues, WorkCenterQueueRow } from './screens/index.ts'
import { operatorSkillsScreen } from './screens/operator-skills.tsx'
import { qualityTemplateScreen, qualityTemplatesListScreen } from './screens/quality-templates.tsx'
import type { QualityTemplateCriterion, QualityTemplateRecord } from './screens/quality-templates.tsx'
import type { OperatorSkillRow } from './screens/operator-skills.tsx'
import { bomContext } from './record/bom-context.ts'
import { bomRecordCommand } from './record/bom-command.ts'
import { bomPageRoute } from './record/bom-routes.ts'

const crossSite = (req: Parameters<Route>[1]): boolean => {
  const origin = req.headers.origin as string | undefined
  if (!origin) return false
  try {
    return new URL(origin).host !== String(req.headers.host ?? '')
  } catch {
    return true
  }
}

const options = (rows: AnyRow[], empty = false) => choices(rows, empty)
const optionsKeeping = (rows: AnyRow[], value: string | undefined) => {
  const listed = options(rows)
  return value && !listed.some((option) => option.value === value)
    ? [{ value, label: value }, ...listed]
    : listed
}

const common = async (ctx: ServeContext, url: URL, req: Parameters<Route>[1]) => {
  const [boms, variants, units, locations, workCenters] = await Promise.all([
    ctx.call('manufacturing.listBoms', {}, url, req) as Promise<AnyRow[]>,
    ctx.call('product.listVariants', {}, url, req) as Promise<AnyRow[]>,
    ctx.call('uom.listUnits', {}, url, req) as Promise<AnyRow[]>,
    ctx.call('stock.listLocations', {}, url, req) as Promise<AnyRow[]>,
    ctx.call('manufacturing.listWorkCenters', {}, url, req) as Promise<AnyRow[]>,
  ])
  return { boms, variants, units, locations, workCenters }
}

type CommonData = Awaited<ReturnType<typeof common>>
type ProductionFormValues = Record<string, string>
type BomFormValues = Record<string, string>

const productionFields = (
  _: Translator,
  data: CommonData,
  values: ProductionFormValues = {},
): FormField[] => [
  {
    name: 'name',
    label: _('manufacturing_backend.field.name'),
    value: values.name,
    required: true,
  },
  {
    name: 'bomId',
    label: _('manufacturing_backend.field.bom'),
    type: 'select',
    value: values.bomId,
    // An order is made from the version in use; drafts and versions in review make nothing yet.
    options: optionsKeeping(
      data.boms
        .filter((row) => row.state === 'active')
        .map((row) => ({ ...row, code: row.familyCode ?? row.code })),
      values.bomId,
    ),
    required: true,
  },
  {
    name: 'productQty',
    label: _('manufacturing_backend.field.quantity'),
    type: 'decimal',
    value: values.productQty || 1,
    required: true,
  },
  {
    name: 'productUomId',
    label: _('manufacturing_backend.field.uom'),
    type: 'select',
    value: values.productUomId,
    options: optionsKeeping(data.units, values.productUomId),
    required: true,
  },
  {
    name: 'sourceLocationId',
    label: _('manufacturing_backend.field.source'),
    type: 'select',
    value: values.sourceLocationId,
    options: optionsKeeping(
      data.locations.filter((row) => ['internal', 'transit'].includes(String(row.usage))),
      values.sourceLocationId,
    ),
    required: true,
  },
  {
    name: 'productionLocationId',
    label: _('manufacturing_backend.field.production'),
    type: 'select',
    value: values.productionLocationId,
    options: optionsKeeping(
      data.locations.filter((row) => row.usage === 'production'),
      values.productionLocationId,
    ),
    required: true,
  },
  {
    name: 'destinationLocationId',
    label: _('manufacturing_backend.field.destination'),
    type: 'select',
    value: values.destinationLocationId,
    options: optionsKeeping(
      data.locations.filter((row) => ['internal', 'transit'].includes(String(row.usage))),
      values.destinationLocationId,
    ),
    required: true,
  },
  {
    name: 'scheduledStart',
    label: _('manufacturing_backend.field.scheduledStart'),
    type: 'datetime-local',
    value: values.scheduledStart,
    required: true,
  },
]

const productionValues = (form: ProductionFormValues): ProductionFormValues => ({
  id: form.id ?? '',
  name: form.name ?? '',
  bomId: form.bomId ?? '',
  productQty: form.productQty || '1',
  productUomId: form.productUomId ?? '',
  sourceLocationId: form.sourceLocationId ?? '',
  productionLocationId: form.productionLocationId ?? '',
  destinationLocationId: form.destinationLocationId ?? '',
  scheduledStart: form.scheduledStart || new Date().toISOString(),
})

const bomValues = (form: BomFormValues): BomFormValues => ({
  id: form.id ?? '',
  code: form.code ?? '',
  productId: form.productId ?? '',
  productQty: form.productQty || '1',
  productUomId: form.productUomId ?? '',
  componentId: form.componentId ?? '',
  componentQty: form.componentQty || '1',
  componentUomId: form.componentUomId ?? '',
  operationName: form.operationName ?? '',
  workCenterId: form.workCenterId ?? '',
  durationExpected: form.durationExpected || '0',
})

const bomFields = (_: Translator, data: CommonData, values: BomFormValues = {}): FormField[] => [
  {
    name: 'code',
    label: _('manufacturing_backend.field.code'),
    value: values.code,
  },
  {
    name: 'productId',
    label: _('manufacturing_backend.field.product'),
    type: 'select',
    value: values.productId,
    options: optionsKeeping(data.variants, values.productId),
    required: true,
  },
  {
    name: 'productQty',
    label: _('manufacturing_backend.field.quantity'),
    type: 'decimal',
    value: values.productQty || 1,
    required: true,
  },
  {
    name: 'productUomId',
    label: _('manufacturing_backend.field.uom'),
    type: 'select',
    value: values.productUomId,
    options: optionsKeeping(data.units, values.productUomId),
    required: true,
  },
  {
    name: 'componentId',
    label: _('manufacturing_backend.field.component'),
    type: 'select',
    value: values.componentId,
    options: optionsKeeping(data.variants, values.componentId),
    required: true,
  },
  {
    name: 'componentQty',
    label: _('manufacturing_backend.field.quantity'),
    type: 'decimal',
    value: values.componentQty || 1,
    required: true,
  },
  {
    name: 'componentUomId',
    label: _('manufacturing_backend.field.uom'),
    type: 'select',
    value: values.componentUomId,
    options: optionsKeeping(data.units, values.componentUomId),
    required: true,
  },
  {
    name: 'operationName',
    label: _('manufacturing_backend.field.operation'),
    value: values.operationName,
  },
  {
    name: 'workCenterId',
    label: _('manufacturing_backend.field.workCenter'),
    type: 'select',
    value: values.workCenterId,
    options: [{ value: '', label: '—' }, ...optionsKeeping(data.workCenters, values.workCenterId)],
  },
  {
    name: 'durationExpected',
    label: _('manufacturing_backend.field.duration'),
    type: 'number',
    value: values.durationExpected || 0,
  },
]

const saveBom = async (ctx: ServeContext, url: URL, req: Parameters<Route>[1], values: BomFormValues) => {
  const id = values.id || crypto.randomUUID()
  const operations = values.operationName
    ? [
        {
          id: `${id}:operation:1`,
          name: values.operationName,
          workCenterId: values.workCenterId,
          durationExpected: Number(values.durationExpected || 0),
        },
      ]
    : []
  return ctx.call(
    'manufacturing.saveBom',
    {
      id,
      draft: true,
      code: values.code || null,
      productId: values.productId,
      productQty: values.productQty || '1',
      productUomId: values.productUomId,
      lines: values.componentId
        ? [
            {
              id: `${id}:line:1`,
              productId: values.componentId,
              productQty: values.componentQty || '1',
              productUomId: values.componentUomId,
              operationId: operations[0]?.id ?? null,
            },
          ]
        : [],
      operations,
    },
    url,
    req,
  )
}

/** Every manufacturing list shares one set of functions; see `search-functions.ts`. */
const manufacturingSearchFunctions = {
  apply: 'manufacturing_backend.applySearchFilter',
  saveFavorite: 'manufacturing_backend.saveSearchFavorite',
  deleteFavorite: 'manufacturing_backend.deleteSearchFavorite',
  setDefaultFavorite: 'manufacturing_backend.setDefaultSearchFavorite',
}

/** A production state, or an archived work center, in the reader's language. */
const manufacturingGroupLabel = (_: Translator, key: string, value: unknown): string => {
  const raw = value == null ? '' : String(value)
  if (key === 'active') return _(`manufacturing_backend.state.${raw === 'false' ? 'archived' : 'active'}`)
  if (!raw) return _('backend.chrome.groupEmpty')
  const message = `manufacturing_backend.state.${raw}`
  if (key === 'state' && _.resolves(message)) return _(message)
  const version = `manufacturing_backend.bomState.${raw}`
  return key === 'state' && _.resolves(version) ? _(version) : raw
}

const bomsPage = async (
  ctx: ServeContext,
  url: URL,
  req: Parameters<Route>[1],
  data: CommonData,
  values?: BomFormValues,
  errors: readonly string[] = [],
) =>
  adminPage(ctx, url, req, {
    title: 'manufacturing_backend.boms.title',
    active: '/admin/manufacturing/boms',
    body: async (_: Translator, frame: Frame) => {
      const collection = inLocale(url, '/admin/manufacturing/boms')
      const productsById = new Map(
        data.variants.map((row) => [String(row.id), String(row.templateName ?? row.name ?? row.id)]),
      )
      const search = await rowListSearch(ctx, url, req, {
        spec: bomListSearch,
        rows: data.boms.map((row) => ({
          id: String(row.id),
          code: String(row.familyCode ?? row.code ?? row.id),
          product: productsById.get(String(row.productId)) ?? String(row.productId),
          quantity: String(row.productQty),
          version: String(row.version ?? 1),
          state: String(row.state ?? 'active'),
          href: inLocale(url, `/admin/manufacturing/boms/${encodeURIComponent(String(row.id))}`),
        })),
        frame,
        name: 'manufacturing-bom-filter',
        bodyId: 'manufacturing-bom-list',
        functions: manufacturingSearchFunctions,
        labels: { searchPlaceholder: _('manufacturing_backend.boms.title') },
        groupLabel: (key, value) => manufacturingGroupLabel(_, key, value),
      })
      const list = bomsListScreen(
        _,
        {
          createHref: inLocale(url, '/admin/manufacturing/boms?create=1'),
          rows: search.rows,
          ...(search.groups ? { table: { groups: search.groups } } : {}),
        },
        search.frame,
      )
      if (url.searchParams.get('create') !== '1' && !errors.length) return list
      return modalWorkspace(
        list,
        bomCreateModal(_, {
          fields: bomFields(_, data, values),
          action: inLocale(url, '/admin/manufacturing/boms/new'),
          cancelHref: collection,
          errors,
        }),
      )
    },
  })

const workCenterValues = (values: Record<string, unknown> = {}): WorkCenterFormValues => ({
  id: values.id == null ? undefined : String(values.id),
  code: String(values.code ?? ''),
  name: String(values.name ?? ''),
  skill: String(values.skill ?? ''),
  capacity: String(values.capacity || '1'),
  timeEfficiency: String(values.timeEfficiency || '100'),
  costPerHour: String(values.costPerHour || '0'),
})

const workCenterListPath = (url: URL): string => inLocale(url, '/admin/manufacturing/work-centers')

const workCenterModalPath = (url: URL, edit?: string): string =>
  inLocale(
    url,
    edit
      ? `/admin/manufacturing/work-centers?edit=${encodeURIComponent(edit)}`
      : '/admin/manufacturing/work-centers?create=1',
  )

const saveWorkCenter = async (
  ctx: ServeContext,
  url: URL,
  req: Parameters<Route>[1],
  values: WorkCenterFormValues,
) =>
  ctx.call(
    'manufacturing.saveWorkCenter',
    {
      id: values.id || crypto.randomUUID(),
      code: values.code ?? '',
      name: values.name ?? '',
      skill: values.skill ?? '',
      capacity: values.capacity || '1',
      timeEfficiency: values.timeEfficiency || '100',
      costPerHour: values.costPerHour || '0',
    },
    url,
    req,
  )

const workCentersPage = async (
  ctx: ServeContext,
  url: URL,
  req: Parameters<Route>[1],
  rows: AnyRow[],
  values?: WorkCenterFormValues,
  errors: readonly string[] = [],
  editing = false,
  forceModal = false,
) => {
  const configure = await ctx.allows('manufacturing.saveWorkCenter', url, req)
  const queue =
    editing && values?.id
      ? (((await ctx.call('manufacturing.getWorkCenter', { id: values.id }, url, req)) as AnyRow | null)
          ?.queue as WorkCenterQueueRow[] | undefined)
      : undefined
  return adminPage(ctx, url, req, {
    title: 'manufacturing_backend.workCenters.title',
    active: '/admin/manufacturing/work-centers',
    body: async (_, frame) => {
      const collection = workCenterListPath(url)
      const search = await rowListSearch(ctx, url, req, {
        spec: workCenterListSearch,
        rows: rows.map((row) => ({
          id: String(row.id),
          code: String(row.code),
          name: String(row.name),
          skill: String(row.skill ?? ''),
          capacity: String(row.capacity),
          timeEfficiency: String(row.timeEfficiency),
          costPerHour: String(row.costPerHour),
          active: row.active !== false,
          editHref: workCenterModalPath(url, String(row.id)),
        })),
        frame,
        name: 'manufacturing-work-center-filter',
        bodyId: 'manufacturing-work-center-list',
        functions: manufacturingSearchFunctions,
        labels: { searchPlaceholder: _('manufacturing_backend.workCenters.title') },
        groupLabel: (key, value) => manufacturingGroupLabel(_, key, value),
      })
      const list = workCentersListScreen(
        _,
        {
          action: configure ? collection : null,
          createHref: configure ? workCenterModalPath(url) : null,
          rows: search.rows,
          ...(search.groups ? { table: { groups: search.groups } } : {}),
        },
        search.frame,
      )
      if (!forceModal && url.searchParams.get('create') !== '1' && !url.searchParams.get('edit')) return list
      return modalWorkspace(
        list,
        workCenterFormModal(_, {
          action: editing && values?.id ? workCenterModalPath(url, values.id) : workCenterModalPath(url),
          cancelHref: collection,
          editing,
          errors,
          values,
          queue,
          readOnly: !configure,
        }),
      )
    },
  })
}

const saveProduction = async (
  ctx: ServeContext,
  url: URL,
  req: Parameters<Route>[1],
  values: ProductionFormValues,
) =>
  ctx.call(
    'manufacturing.saveProduction',
    {
      ...values,
      id: values.id || crypto.randomUUID(),
    },
    url,
    req,
  )

const productionCreatePage = async (
  ctx: ServeContext,
  url: URL,
  req: Parameters<Route>[1],
  action: string,
  values: ProductionFormValues = {},
  errors: readonly string[] = [],
) => {
  const _ = ctx.translate(ctx.localeOf(url, req))
  const data = await common(ctx, url, req)
  return adminPage(ctx, url, req, {
    title: 'manufacturing_backend.orders.create',
    body: (_, frame) =>
      orderCreateScreen(
        _,
        {
          fields: productionFields(_, data, values),
          action,
          cancelHref: inLocale(url, '/admin/manufacturing'),
          errors,
        },
        frame,
      ),
  })
}

/** Deployment-owned choices for the order page; domain capabilities and permissions are unchanged. */
export type ManufacturingOrderOptions = {
  /**
   * A function that tells, per component, whether it is counted in pieces and how many pieces its
   * recorded use makes: `{lines: [{id, productId, counted}]}` to `[{id, enabled, pieces}]`, the
   * contract of the stock count's. The use grid then shows a Pieces column, editable only where
   * enabled; the deployment's `manufacturing.consumeProduction` turns posted pieces into the total.
   */
  countPieces?: string
}

/** A reading in the reader's own decimals, with its unit. */
const shownReading = (_: Translator, value: unknown, unit: unknown) => {
  const number = Number(value)
  const shown = Number.isFinite(number)
    ? new Intl.NumberFormat(_.locale === 'en' ? 'en-US' : 'vi-VN', { maximumFractionDigits: 6 }).format(
        number,
      )
    : String(value ?? '')
  return unit ? `${shown} ${String(unit)}` : shown
}

/** A template check as the order page reads it: its criteria worded while pending, its results once checked. */
const qualityTemplateView = (_: Translator, check: AnyRow) => ({
  criteria: ((check.criteria as AnyRow[] | undefined) ?? []).map((criterion) => {
    const range = criterion.kind !== 'passFail'
    const unit = criterion.unit ? ` ${String(criterion.unit)}` : ''
    const requirement = !range
      ? _('manufacturing_backend.quality.requirementPass')
      : criterion.min != null && criterion.max != null
        ? `${shownReading(_, criterion.min, null)}–${shownReading(_, criterion.max, null)}${unit}`
        : criterion.min != null
          ? `≥ ${shownReading(_, criterion.min, null)}${unit}`
          : `≤ ${shownReading(_, criterion.max, null)}${unit}`
    return {
      id: String(criterion.id),
      name: String(criterion.name),
      requirement,
      range,
      required: criterion.required !== false,
    }
  }),
  results: ((check.results as AnyRow[] | undefined) ?? [])
    .filter((result) => result.value != null)
    .map((result) => ({
      name: String(result.name),
      value:
        result.kind === 'passFail'
          ? _(`manufacturing_backend.quality.sensory.${String(result.value) === 'pass' ? 'pass' : 'fail'}`)
          : shownReading(_, result.value, result.unit),
      passed: result.passed == null ? null : result.passed === true,
    })),
})

const templatesPath = (url: URL, id?: string) =>
  inLocale(
    url,
    id
      ? `/admin/manufacturing/quality-templates/${encodeURIComponent(id)}`
      : '/admin/manufacturing/quality-templates',
  )

/** The finished products a template can check: those some BOM makes, by their names. */
const templateProducts = async (ctx: ServeContext, url: URL, req: Parameters<Route>[1]) => {
  const boms = (await ctx.call('manufacturing.listBoms', {}, url, req)) as AnyRow[]
  const ids = [...new Set(boms.map((bom) => String(bom.productId)))]
  if (!ids.length) return []
  const variants = (await ctx.call('product.listVariants', { ids }, url, req)) as AnyRow[]
  return ids
    .map((id) => ({ value: id, label: String(variants.find((row) => row.id === id)?.displayName ?? id) }))
    .sort((a, b) => a.label.localeCompare(b.label, 'vi'))
}

const criterionOf = (row: AnyRow): QualityTemplateCriterion => ({
  name: String(row.name ?? ''),
  kind: row.kind === 'passFail' ? 'passFail' : 'range',
  min: row.min == null || row.min === '' ? null : String(row.min),
  max: row.max == null || row.max === '' ? null : String(row.max),
  unit: row.unit == null || row.unit === '' ? null : String(row.unit),
  required: row.required !== false && row.required !== 'false',
})

/** The criteria grid's changes applied to what the page showed: rows are numbered from 1. */
const postedCriteria = (shown: QualityTemplateCriterion[], raw: unknown) => {
  let posted: {
    added?: Array<{ id: string; index: number; values: AnyRow }>
    updated?: Array<{ id: string; values: AnyRow }>
    removed?: string[]
    order?: string[] | null
  } = {}
  try {
    posted = JSON.parse(String(raw || '{}'))
  } catch {}
  const rows = shown
    .map((criterion, index) => ({ key: String(index + 1), row: criterion as unknown as AnyRow }))
    .filter((entry) => !(posted.removed ?? []).map(String).includes(entry.key))
  for (const change of posted.updated ?? []) {
    const entry = rows.find((row) => row.key === String(change.id))
    if (entry) entry.row = { ...entry.row, ...change.values }
  }
  for (const change of [...(posted.added ?? [])].sort((a, b) => a.index - b.index))
    rows.splice(Math.min(Math.max(0, Number(change.index)), rows.length), 0, {
      key: String(change.id),
      row: { kind: 'range', required: true, ...change.values },
    })
  if (Array.isArray(posted.order)) {
    const at = new Map(posted.order.map((key, index) => [String(key), index]))
    rows.sort((a, b) => (at.get(a.key) ?? rows.length) - (at.get(b.key) ?? rows.length))
  }
  return rows.map((entry) => criterionOf(entry.row))
}

const qualityTemplateRoute =
  (ctx: ServeContext): Route =>
  async (url, req, params) => {
    if (crossSite(req)) return text('Forbidden', { status: 403 })
    if (req.method !== 'GET' && req.method !== 'POST') return text('GET or POST', { status: 405 })
    const creating = !params.id || params.id === 'new'
    const configure = await ctx.allows('manufacturing.saveQualityTemplate', url, req)
    const held = creating
      ? null
      : ((await ctx.call('manufacturing.getQualityTemplate', { id: params.id }, url, req)) as AnyRow | null)
    if (!creating && !held) return text('not found', { status: 404 })
    let record: QualityTemplateRecord = held
      ? {
          id: String(held.id),
          name: String(held.name),
          productId: held.productId == null ? null : String(held.productId),
          active: held.active !== false,
          version: Number(held.version),
          criteria: ((held.criteria as AnyRow[]) ?? []).map(criterionOf),
        }
      : { id: '', name: '', productId: null, active: true, version: null, criteria: [] }
    let result: unknown = { ok: true }
    if (req.method === 'POST') {
      if (!configure) return text('Forbidden', { status: 403 })
      const form = await readForm(req)
      const id = record.id || crypto.randomUUID()
      // A checkbox posts its value only when ticked.
      const active = form.active !== undefined && form.active !== '' && form.active !== 'false'
      record = {
        ...record,
        name: String(form.name ?? ''),
        productId: form.productId ? String(form.productId) : null,
        active,
        criteria: postedCriteria(record.criteria, form.criteria),
      }
      result = await ctx.call(
        'manufacturing.saveQualityTemplate',
        {
          id,
          name: record.name,
          productId: record.productId,
          active,
          version: record.version ?? undefined,
          criteria: record.criteria,
        },
        url,
        req,
      )
      if ((result as AnyRow).ok === true) {
        const here = templatesPath(url, id)
        return seeOther(`${here}${here.includes('?') ? '&' : '?'}saved=1`)
      }
      for (const error of ((result as AnyRow).errors as AnyRow[] | undefined) ?? [])
        if (error.field === 'criteria') delete error.field
    }
    const products = configure ? await templateProducts(ctx, url, req) : []
    if (record.productId && !products.some((option) => option.value === record.productId))
      products.push({ value: record.productId, label: record.productId })
    return adminPage(ctx, url, req, {
      title: creating ? 'manufacturing_backend.qualityTemplates.create' : record.name,
      translate: creating,
      active: '/admin/manufacturing/quality-templates',
      body: (_, frame) =>
        qualityTemplateScreen(_, frame, record, {
          action: templatesPath(url, creating ? 'new' : record.id),
          products,
          configure,
          errors: resultErrors(result, _, 'manufacturing_backend.error.invalid'),
          saved: req.method === 'GET' && url.searchParams.get('saved') === '1',
        }),
    })
  }

const typed = (value: unknown) => value != null && value !== ''

/** A component's pieces as the use grid takes them: editable only where it is counted in pieces. */
const piecesOf = (fact: AnyRow | undefined) => ({
  enabled: fact?.enabled === true,
  value: fact?.enabled === true && fact.pieces != null ? String(fact.pieces) : null,
})

export const orderRoute =
  (options: ManufacturingOrderOptions = {}) =>
  (ctx: ServeContext): Route =>
  async (url, req, params) => {
    if (crossSite(req)) return text('Forbidden', { status: 403 })
    const _ = ctx.translate(ctx.localeOf(url, req))
    let result: unknown = { ok: true }
    let row = (await ctx.call('manufacturing.getProduction', { id: params.id }, url, req)) as AnyRow | null
    if (!row) return text('not found', { status: 404 })
    if (req.method === 'POST') {
      const form = await readForm(req)
      const workOrderId = url.searchParams.get('workOrderId')
      const workOrderVersion = Number(url.searchParams.get('workOrderVersion'))
      if (form.action === 'confirm')
        result = await ctx.call(
          'manufacturing.confirmProduction',
          { id: row.id, version: Number(row.version) },
          url,
          req,
        )
      else if (form.action === 'start')
        result = await ctx.call(
          'manufacturing.startProduction',
          { id: row.id, version: Number(row.version) },
          url,
          req,
        )
      else if (form.action === 'complete')
        result = await ctx.call(
          'manufacturing.completeProduction',
          { id: row.id, version: Number(row.version) },
          url,
          req,
        )
      else if (form.action === 'cancel')
        result = String(form.reason ?? '').trim()
          ? await ctx.call(
              'manufacturing.cancelProduction',
              { id: row.id, version: Number(row.version), reason: form.reason },
              url,
              req,
            )
          : { ok: false, errors: [{ field: 'reason', code: 'manufacturing.error.reasonRequired' }] }
      else if (form.action === 'output')
        result = await ctx.call(
          'manufacturing.recordOutput',
          {
            id: row.id,
            quantity: form.quantity,
            lotName: form.lotName || null,
            weight: form.weight || null,
          },
          url,
          req,
        )
      else if (form.action === 'return')
        result = await ctx.call(
          'manufacturing.returnComponents',
          { id: row.id, components: [{ productId: form.productId, quantity: form.quantity }] },
          url,
          req,
        )
      else if (form.action === 'scrap')
        result = await ctx.call(
          'manufacturing.scrapProduction',
          {
            id: row.id,
            productId: form.productId,
            quantity: String(form.quantity ?? ''),
            reason: form.reason,
          },
          url,
          req,
        )
      else if (form.action === 'quality') {
        // A template check posts its criteria grid; each row is a criterion's reading or verdict.
        let posted: { updated?: Array<{ id: string; values: AnyRow }> } | null = null
        if (form.results !== undefined)
          try {
            posted = JSON.parse(String(form.results || '{}'))
          } catch {
            posted = {}
          }
        result = await ctx.call(
          'manufacturing.checkQuality',
          posted
            ? {
                id: form.checkId,
                results: (posted.updated ?? []).map((change) => ({
                  criterionId: change.id,
                  value: String(change.values.value ?? change.values.verdict ?? ''),
                })),
                note: form.note || null,
              }
            : {
                id: form.checkId,
                ph: String(form.ph ?? ''),
                sensory: String(form.sensory ?? ''),
                note: form.note || null,
              },
          url,
          req,
        )
        // A refusal names its criterion in its own words.
        for (const error of ((result as AnyRow).errors as AnyRow[] | undefined) ?? [])
          if (error.field === 'results') delete error.field
      } else if (form.action === 'close')
        result = await ctx.call(
          'manufacturing.completeProduction',
          { id: row.id, version: Number(row.version), rest: form.rest },
          url,
          req,
        )
      else if (form.action === 'consume') {
        // The grid posts its changes; each changed row is a component's new total.
        let posted: { updated?: Array<{ id: string; values: AnyRow }> } = {}
        try {
          posted = JSON.parse(String(form.components || '{}'))
        } catch {}
        // Pieces typed on a component counted in pieces travel beside it for the server to convert.
        const components = (posted.updated ?? [])
          .filter((change) => change.values.consumed !== undefined || typed(change.values.pieces))
          .map((change) => ({
            productId: change.id,
            ...(change.values.consumed !== undefined ? { consumed: String(change.values.consumed) } : {}),
            ...(typed(change.values.pieces) ? { pieces: String(change.values.pieces) } : {}),
          }))
        result = await ctx.call(
          'manufacturing.consumeProduction',
          {
            id: row.id,
            components,
            confirmOveruse: Boolean(form.confirmOveruse) && form.confirmOveruse !== 'false',
          },
          url,
          req,
        )
        // A refusal names its component in its own words; the grid field name adds nothing.
        for (const error of ((result as AnyRow).errors as AnyRow[] | undefined) ?? [])
          if (error.field === 'components') delete error.field
      } else if (form.action === 'start-work' && workOrderId)
        result = await ctx.call(
          'manufacturing.startWorkOrder',
          { id: workOrderId, version: workOrderVersion },
          url,
          req,
        )
      else if (form.action === 'pause-work' && workOrderId)
        result = await ctx.call(
          'manufacturing.pauseWorkOrder',
          { id: workOrderId, version: workOrderVersion },
          url,
          req,
        )
      else if (form.action === 'finish-work' && workOrderId)
        result = await ctx.call(
          'manufacturing.finishWorkOrder',
          { id: workOrderId, version: workOrderVersion },
          url,
          req,
        )
      else return text('unknown action', { status: 400 })
      if ((result as AnyRow).ok)
        return seeOther(inLocale(url, `/admin/manufacturing/orders/${encodeURIComponent(String(row.id))}`))
      // These refusals say what is wrong in words; the posted field name adds nothing.
      for (const error of ((result as AnyRow).errors as AnyRow[] | undefined) ?? [])
        if (['components', 'weight', 'reason', 'quantity', 'ph', 'sensory'].includes(String(error.field)))
          delete error.field
      row = (await ctx.call('manufacturing.getProduction', { id: params.id }, url, req)) as AnyRow
    } else if (req.method !== 'GET') return text('GET or POST', { status: 405 })
    // The queue decides what an open order is short of, against every order ahead of it.
    const queued = ['draft', 'confirmed', 'in_progress', 'to_close'].includes(String(row.state))
      ? (((await ctx.call('manufacturing.productionQueue', {}, url, req)) as AnyRow[]).find(
          (entry) => entry.id === row!.id,
        ) ?? null)
      : null
    const shortages = (queued?.shortages as AnyRow[] | undefined) ?? []
    const names = shortages.length
      ? new Map(
          (
            (await ctx.call(
              'product.listVariants',
              { ids: shortages.map((entry) => entry.productId) },
              url,
              req,
            )) as AnyRow[]
          ).map((variant) => [String(variant.id), String(variant.displayName ?? variant.name)]),
        )
      : new Map<string, string>()
    const recording =
      ['confirmed', 'in_progress'].includes(String(row.state)) &&
      (await ctx.allows('manufacturing.consumeProduction', url, req))
    const consumption = recording
      ? (((await ctx.call('manufacturing.getConsumption', { id: row.id }, url, req)) as AnyRow)
          .components as AnyRow[])
      : []
    // Pieces are a way of entering use, never a stored figure of the grid's own.
    const pieceFacts =
      consumption.length && options.countPieces && (await ctx.allows(options.countPieces, url, req))
        ? new Map(
            (
              await optionalRead<AnyRow[]>(
                ctx,
                options.countPieces,
                {
                  lines: consumption.map((entry) => ({
                    id: entry.productId,
                    productId: entry.productId,
                    counted: entry.consumed ?? null,
                  })),
                },
                url,
                req,
                [],
              )
            ).map((entry) => [String(entry.id), entry]),
          )
        : null
    const cost =
      row.state !== 'draft' && (await ctx.allows('manufacturing.getProductionCost', url, req))
        ? ((await ctx.call('manufacturing.getProductionCost', { id: row.id }, url, req)) as AnyRow)
        : null
    const open = ['confirmed', 'in_progress'].includes(String(row.state))
    const bom = open
      ? ((await ctx.call('manufacturing.getBom', { id: row.bomId }, url, req)) as AnyRow | null)
      : null
    const floorManage = open && (await ctx.allows('manufacturing.scrapProduction', url, req))
    const checks = (
      (await ctx.allows('manufacturing.listQualityChecks', url, req))
        ? await ctx.call('manufacturing.listQualityChecks', { productionId: row.id }, url, req)
        : []
    ) as AnyRow[]
    const mayCheck = checks.length > 0 && (await ctx.allows('manufacturing.checkQuality', url, req))
    // P12: the sale or rule an order was drafted from opens for a reader who may read it.
    const kind = ['sale', 'rule'].includes(String(row.orderSource)) ? String(row.orderSource) : 'manual'
    const sourceDocument =
      kind === 'sale' && row.saleOrderId
        ? {
            label: String(row.origin ?? row.saleOrderId),
            href: (await ctx.allows('sale.getOrder', url, req))
              ? inLocale(url, `/admin/sales/orders/${encodeURIComponent(String(row.saleOrderId))}`)
              : null,
          }
        : kind === 'rule' && row.orderpointId
          ? {
              label: ctx.translate(ctx.localeOf(url, req))('manufacturing_backend.source.openRule'),
              href: (await ctx.allows('stock.getOrderpointSupply', url, req))
                ? inLocale(url, `/admin/stock/replenishment/${encodeURIComponent(String(row.orderpointId))}`)
                : null,
            }
          : null
    const productName = floorManage
      ? (((await ctx.call('product.listVariants', { ids: [row.productId] }, url, req)) as AnyRow[])[0]
          ?.displayName ?? null)
      : null
    const output = {
      record: open && (await ctx.allows('manufacturing.recordOutput', url, req)),
      close: open && (await ctx.allows('manufacturing.completeProduction', url, req)),
    }
    const [componentNames, unitNames] =
      consumption.length || output.record || output.close || row.closedShort || cost
        ? await Promise.all([
            consumption.length
              ? (ctx.call(
                  'product.listVariants',
                  { ids: consumption.map((entry) => entry.productId) },
                  url,
                  req,
                ) as Promise<AnyRow[]>)
              : Promise.resolve([] as AnyRow[]),
            ctx.call('uom.listUnits', {}, url, req) as Promise<AnyRow[]>,
          ])
        : [[], []]
    const nameOf = (rows: AnyRow[], id: unknown, field = 'name') =>
      String(rows.find((entry) => entry.id === id)?.[field] ?? id)
    return adminPage(ctx, url, req, {
      title: String(row.name),
      translate: false,
      active: '/admin/manufacturing',
      body: (_, frame) =>
        orderScreen(
          _,
          frame,
          row!,
          resultErrors(result, _, 'manufacturing_backend.error.invalid'),
          inLocale(url, `/admin/manufacturing/orders/${encodeURIComponent(String(row!.id))}`),
          shortages.map((entry) =>
            _('manufacturing_backend.orders.shortItem', {
              product: names.get(String(entry.productId)) ?? String(entry.productId),
              need: String(entry.need),
              available: String(entry.available),
              incoming: String(entry.incoming),
            }),
          ),
          consumption.map((entry) => ({
            productId: String(entry.productId),
            product: nameOf(componentNames, entry.productId, 'displayName'),
            unit: nameOf(unitNames, entry.uomId),
            need: String(entry.need),
            consumed: String(entry.consumed),
            returned: String(entry.returned ?? '0'),
            ...(pieceFacts ? { pieces: piecesOf(pieceFacts.get(String(entry.productId))) } : {}),
          })),
          { ...output, unit: nameOf(unitNames, row!.productUomId) },
          cost
            ? {
                provisional: String(cost.provisional),
                issued: String(cost.issued),
                actual: cost.actual == null ? null : String(cost.actual),
                currency: String(cost.currency),
                labour: cost.labour == null ? null : String(cost.labour),
                varianceHeld: cost.varianceHeld == null ? null : String(cost.varianceHeld),
                varianceSold: cost.varianceSold == null ? null : String(cost.varianceSold),
              }
            : null,
          {
            warning: bom?.consumption === 'warning',
            weigh:
              Number(bom?.unitWeight ?? 0) > 0
                ? { unitWeight: String(bom!.unitWeight), tolerance: String(bom!.weightTolerance ?? 0) }
                : null,
            product: { id: String(row!.productId), name: String(productName ?? row!.productId) },
            manage: floorManage,
          },
          {
            check: mayCheck,
            checks: checks.map((check) => ({
              id: String(check.id),
              lotName: String(check.lotName ?? check.lotId),
              state: String(check.state),
              ph: check.ph == null ? null : String(check.ph),
              sensory: check.sensory == null ? null : String(check.sensory),
              note: check.note == null ? null : String(check.note),
              range: `${String(check.phMin ?? '—')}–${String(check.phMax ?? '—')}`,
              ...(check.templateId ? { template: qualityTemplateView(_, check) } : {}),
            })),
          },
          {
            kind: kind as 'sale' | 'rule' | 'manual',
            document: sourceDocument,
            deadline: row!.deadline ? String(row!.deadline) : null,
            notice: row!.saleNotice === 'cancelled' || row!.saleNotice === 'changed' ? row!.saleNotice : null,
          },
        ),
    })
  }

export const routes: Record<string, RouteEntry> = {
  '/admin/manufacturing':
    (ctx: ServeContext): Route =>
    async (url, req) => {
      if (req.method === 'POST') {
        if (crossSite(req)) return text('Forbidden', { status: 403 })
        const form = await readForm(req)
        const values = productionValues(form)
        const result = await saveProduction(ctx, url, req, values)
        if ((result as AnyRow).ok) return seeOther(inLocale(url, '/admin/manufacturing'))
        const _ = ctx.translate(ctx.localeOf(url, req))
        return productionCreatePage(
          ctx,
          url,
          req,
          inLocale(url, '/admin/manufacturing'),
          values,
          resultErrors(result, _, 'manufacturing_backend.error.invalid'),
        )
      }
      if (req.method !== 'GET') return text('GET or POST', { status: 405 })
      // `?orderSource=sale` is a link a sale or a rule can hand out: it becomes the list's own filter.
      const wantedSource = url.searchParams.get('orderSource')
      if (wantedSource !== null) {
        const base = new URL(url)
        base.searchParams.delete('orderSource')
        if (!(ORDER_SOURCES as readonly string[]).includes(wantedSource))
          return seeOther(`${base.pathname}${base.search}`)
        const { state } = parseListState(productionListSearch, base)
        const filters = [
          ...state.filters.filter((filter) => !('field' in filter) || filter.field !== 'orderSource'),
          { kind: 'rule' as const, field: 'orderSource', operator: 'equals' as const, value: wantedSource },
        ]
        return seeOther(encodeListState({ ...state, filters }, base))
      }
      const [data, rows] = await Promise.all([
        common(ctx, url, req),
        ctx.call('manufacturing.productionQueue', {}, url, req) as Promise<AnyRow[]>,
      ])
      const productsById = new Map(
        data.variants.map((row) => [String(row.id), String(row.templateName ?? row.name ?? row.id)]),
      )
      return adminPage(ctx, url, req, {
        title: 'manufacturing_backend.orders.title',
        body: async (_, frame) => {
          const search = await rowListSearch(ctx, url, req, {
            spec: productionListSearch,
            rows: rows.map((row, index) => ({
              id: String(row.id),
              name: String(row.name),
              product: productsById.get(String(row.productId)) ?? String(row.productId),
              quantity: String(row.productQty),
              state: String(row.state),
              material: row.material ? String(row.material) : '',
              orderSource: String(row.orderSource ?? 'manual'),
              queue: index,
              href: inLocale(url, `/admin/manufacturing/orders/${encodeURIComponent(String(row.id))}`),
            })),
            frame,
            name: 'manufacturing-order-filter',
            bodyId: 'manufacturing-order-list',
            functions: manufacturingSearchFunctions,
            labels: { searchPlaceholder: _('manufacturing_backend.orders.title') },
            fieldChoices: {
              orderSource: ORDER_SOURCES.map((value) => ({
                value,
                label: _(`manufacturing_backend.orderSource.${value}`),
              })),
            },
            groupLabel: (key, value) =>
              key === 'orderSource'
                ? _(`manufacturing_backend.orderSource.${String(value || 'manual')}`)
                : manufacturingGroupLabel(_, key, value),
          })
          return ordersListScreen(
            _,
            {
              rows: search.rows,
              ...(search.groups ? { table: { groups: search.groups } } : {}),
              createHref: inLocale(url, '/admin/manufacturing/new'),
            },
            search.frame,
          )
        },
      })
    },

  '/admin/manufacturing/new':
    (ctx: ServeContext): Route =>
    async (url, req) => {
      const here = inLocale(url, '/admin/manufacturing/new')
      if (req.method === 'POST') {
        if (crossSite(req)) return text('Forbidden', { status: 403 })
        const form = await readForm(req)
        const values = productionValues(form)
        const result = await saveProduction(ctx, url, req, values)
        if ((result as AnyRow).ok) return seeOther(inLocale(url, '/admin/manufacturing'))
        const _ = ctx.translate(ctx.localeOf(url, req))
        return productionCreatePage(
          ctx,
          url,
          req,
          here,
          values,
          resultErrors(result, _, 'manufacturing_backend.error.invalid'),
        )
      }
      if (req.method !== 'GET') return text('GET or POST', { status: 405 })
      return productionCreatePage(ctx, url, req, here)
    },

  '/admin/manufacturing/orders/{id}': orderRoute(),

  '/admin/manufacturing/skills':
    (ctx: ServeContext): Route =>
    async (url, req) => {
      if (crossSite(req)) return text('Forbidden', { status: 403 })
      if (req.method !== 'GET' && req.method !== 'POST') return text('GET or POST', { status: 405 })
      const here = inLocale(url, '/admin/manufacturing/skills')
      const configure = await ctx.allows('manufacturing.saveOperatorSkills', url, req)
      const read = async () =>
        ((await ctx.call('manufacturing.listOperatorSkills', {}, url, req)) as AnyRow[])
          .map(
            (row): OperatorSkillRow => ({
              id: String(row.id),
              userId: String(row.userId),
              skill: String(row.skill),
              level: Number(row.level),
              lead: row.lead === true,
            }),
          )
          .sort((a, b) => a.skill.localeCompare(b.skill) || a.userId.localeCompare(b.userId))
      let result: unknown = { ok: true }
      if (req.method === 'POST') {
        if (!configure) return text('Forbidden', { status: 403 })
        const form = await readForm(req)
        // The grid posts its changes; the whole grid is saved at once, saved rows with their edits.
        let posted: {
          added?: Array<{ values: AnyRow }>
          updated?: Array<{ id: string; values: AnyRow }>
          removed?: string[]
        } = {}
        try {
          posted = JSON.parse(String(form.skills || '{}'))
        } catch {}
        const removed = (posted.removed ?? []).map(String)
        const edits = new Map((posted.updated ?? []).map((change) => [String(change.id), change.values]))
        const rows = [
          ...(await read())
            .filter((row) => !removed.includes(row.id))
            .map((row) => ({ ...row, ...(edits.get(row.id) ?? {}), userId: row.userId, skill: row.skill })),
          ...(posted.added ?? []).map((change) => change.values),
        ].map((row) => ({ userId: row.userId, skill: row.skill, level: row.level, lead: row.lead === true }))
        result = await ctx.call('manufacturing.saveOperatorSkills', { rows, removed }, url, req)
        if ((result as AnyRow).ok === true) return seeOther(`${here}${here.includes('?') ? '&' : '?'}saved=1`)
        // A refusal names its row in its own words; the field name adds nothing.
        for (const error of ((result as AnyRow).errors as AnyRow[] | undefined) ?? [])
          if (error.field === 'rows' || error.field === 'removed') delete error.field
      }
      const [rows, centers, people] = await Promise.all([
        read(),
        ctx.call('manufacturing.listWorkCenters', {}, url, req) as Promise<AnyRow[]>,
        configure
          ? (ctx.call('manufacturing.listOperatorCandidates', {}, url, req) as Promise<AnyRow[]>)
          : Promise.resolve([] as AnyRow[]),
      ])
      const skills = new Map<string, string[]>()
      for (const center of centers)
        if (center.active !== false && String(center.skill ?? '').trim())
          skills.set(String(center.skill).trim(), [
            ...(skills.get(String(center.skill).trim()) ?? []),
            String(center.name),
          ])
      // Without the configure grant the names come from the saved rows.
      const names = configure
        ? people.map((person) => ({ id: String(person.id), name: String(person.name) }))
        : [
            ...new Map(
              ((await ctx.call('manufacturing.listOperatorSkills', {}, url, req)) as AnyRow[]).map((row) => [
                String(row.userId),
                { id: String(row.userId), name: String(row.name) },
              ]),
            ).values(),
          ]
      return adminPage(ctx, url, req, {
        title: 'manufacturing_backend.skills.title',
        active: '/admin/manufacturing/skills',
        body: (_, frame) =>
          operatorSkillsScreen(
            _,
            frame,
            {
              rows,
              people: names,
              skills: [...skills].map(([skill, list]) => ({ skill, centers: list })),
              configure,
            },
            here,
            resultErrors(result, _, 'manufacturing_backend.error.invalid'),
            req.method === 'GET' && url.searchParams.get('saved') === '1',
          ),
      })
    },

  '/admin/manufacturing/quality-templates':
    (ctx: ServeContext): Route =>
    async (url, req) => {
      if (req.method !== 'GET') return text('GET', { status: 405 })
      const rows = (await ctx.call(
        'manufacturing.listQualityTemplates',
        { includeArchived: true },
        url,
        req,
      )) as AnyRow[]
      const ids = [
        ...new Set(
          rows
            .map((row) => row.productId)
            .filter((id) => id != null)
            .map(String),
        ),
      ]
      const variants = ids.length
        ? ((await ctx.call('product.listVariants', { ids }, url, req)) as AnyRow[])
        : []
      const configure = await ctx.allows('manufacturing.saveQualityTemplate', url, req)
      return adminPage(ctx, url, req, {
        title: 'manufacturing_backend.qualityTemplates.title',
        active: '/admin/manufacturing/quality-templates',
        body: (_, frame) =>
          qualityTemplatesListScreen(
            _,
            {
              rows: rows.map((row) => ({
                id: String(row.id),
                name: String(row.name),
                product: row.productId
                  ? String(
                      variants.find((variant) => variant.id === row.productId)?.displayName ?? row.productId,
                    )
                  : '—',
                criteria: ((row.criteria as AnyRow[]) ?? []).length,
                active: row.active !== false,
                href: templatesPath(url, String(row.id)),
              })),
              createHref: configure ? templatesPath(url, 'new') : null,
            },
            frame,
          ),
      })
    },

  '/admin/manufacturing/quality-templates/new': qualityTemplateRoute,

  '/admin/manufacturing/quality-templates/{id}': qualityTemplateRoute,

  '/admin/manufacturing/consumption':
    (ctx: ServeContext): Route =>
    async (url, req) => {
      if (req.method !== 'GET') return text('GET', { status: 405 })
      const rows = (await ctx.call('manufacturing.consumptionVariance', {}, url, req)) as AnyRow[]
      const [variants, units] = rows.length
        ? await Promise.all([
            ctx.call(
              'product.listVariants',
              { ids: [...new Set(rows.map((row) => row.productId))] },
              url,
              req,
            ) as Promise<AnyRow[]>,
            ctx.call('uom.listUnits', {}, url, req) as Promise<AnyRow[]>,
          ])
        : [[], []]
      const nameOf = (list: AnyRow[], id: unknown, field = 'name') =>
        String(list.find((entry) => entry.id === id)?.[field] ?? id)
      return adminPage(ctx, url, req, {
        title: 'manufacturing_backend.variance.title',
        active: '/admin/manufacturing/consumption',
        body: async (_, frame) => {
          const search = await rowListSearch(ctx, url, req, {
            spec: varianceListSearch,
            rows: rows.map((row, index) => {
              const difference = Number(row.difference)
              return {
                id: `${String(row.productionId)}:${String(row.productId)}`,
                order: String(row.productionName),
                component: nameOf(variants, row.productId, 'displayName'),
                unit: nameOf(units, row.uomId),
                expected: Number(row.expected),
                used: Number(row.used),
                difference,
                percent: row.percent == null ? null : Number(row.percent),
                standing: difference > 1e-9 ? 'over' : difference < -1e-9 ? 'under' : 'within',
                rank: index,
                href: inLocale(
                  url,
                  `/admin/manufacturing/orders/${encodeURIComponent(String(row.productionId))}`,
                ),
              }
            }),
            frame,
            name: 'manufacturing-variance-filter',
            bodyId: 'manufacturing-variance-list',
            functions: manufacturingSearchFunctions,
            labels: { searchPlaceholder: _('manufacturing_backend.variance.title') },
            groupLabel: (key, value) =>
              key === 'standing' && _.resolves(`manufacturing_backend.variance.${String(value)}`)
                ? _(`manufacturing_backend.variance.${String(value)}`)
                : manufacturingGroupLabel(_, key, value),
          })
          return consumptionVarianceScreen(
            _,
            { rows: search.rows, ...(search.groups ? { table: { groups: search.groups } } : {}) },
            search.frame,
          )
        },
      })
    },

  '/admin/manufacturing/work':
    (ctx: ServeContext): Route =>
    async (url, req) => {
      if (req.method !== 'GET') return text('GET', { status: 405 })
      const rows = (await ctx.call('manufacturing.listWorkOrders', {}, url, req)) as AnyRow[]
      // `?workcenter=<id>` is a link a work center can hand out: it becomes the list's own filter
      // on that work center, which the bar counts and clears like any other.
      const centerId = url.searchParams.get('workcenter')
      if (centerId) {
        const name =
          rows.find((row) => String(row.workCenterId) === centerId)?.workCenterName ??
          ((await ctx.call('manufacturing.listWorkCenters', {}, url, req)) as AnyRow[]).find(
            (center) => String(center.id) === centerId,
          )?.name
        const base = new URL(url)
        base.searchParams.delete('workcenter')
        if (!name) return seeOther(`${base.pathname}${base.search}`)
        const { state } = parseListState(workOrderListSearch, base)
        const filters = [
          ...state.filters,
          { kind: 'rule' as const, field: 'workCenter', operator: 'equals' as const, value: String(name) },
        ]
        return seeOther(encodeListState({ ...state, filters }, base))
      }
      return adminPage(ctx, url, req, {
        title: 'manufacturing_backend.work.title',
        active: '/admin/manufacturing/work',
        body: async (_, frame) => {
          const search = await rowListSearch(ctx, url, req, {
            spec: workOrderListSearch,
            rows: rows.map((row, index) => ({
              id: String(row.id),
              order: String(row.productionName),
              name: String(row.name),
              workCenter: String(row.workCenterName ?? ''),
              operator: String(row.operatorName ?? ''),
              minutes: Number(row.durationExpected),
              state: String(row.state),
              queue: index,
              href: inLocale(url, `/admin/manufacturing/work/${encodeURIComponent(String(row.id))}`),
            })),
            frame,
            name: 'manufacturing-work-filter',
            bodyId: 'manufacturing-work-list',
            functions: manufacturingSearchFunctions,
            labels: { searchPlaceholder: _('manufacturing_backend.work.title') },
            groupLabel: (key, value) =>
              key === 'state' && _.resolves(`manufacturing_backend.workState.${String(value)}`)
                ? _(`manufacturing_backend.workState.${String(value)}`)
                : manufacturingGroupLabel(_, key, value),
          })
          return workOrdersListScreen(
            _,
            { rows: search.rows, ...(search.groups ? { table: { groups: search.groups } } : {}) },
            search.frame,
          )
        },
      })
    },

  '/admin/manufacturing/work/{id}':
    (ctx: ServeContext): Route =>
    async (url, req, params) => {
      if (crossSite(req)) return text('Forbidden', { status: 403 })
      if (req.method !== 'GET' && req.method !== 'POST') return text('GET or POST', { status: 405 })
      const read = async () =>
        (await ctx.call('manufacturing.getWorkOrder', { id: params.id }, url, req)) as AnyRow | null
      const row = await read()
      if (!row) return text('not found', { status: 404 })
      const path = inLocale(url, `/admin/manufacturing/work/${encodeURIComponent(String(row.id))}`)
      let result: unknown = { ok: true }
      let values: Record<string, string> | undefined
      if (req.method === 'POST') {
        const form = await readForm(req)
        const version = Number(row.version)
        // A run ends with the minutes it took: the page always asks, so empty is refused here.
        const minutesOf = (value: unknown) => (String(value ?? '').trim() ? String(value) : 'missing')
        if (form.action === 'start')
          result = await ctx.call('manufacturing.startWorkOrder', { id: row.id, version }, url, req)
        else if (form.action === 'pause') {
          values = { pauseMinutes: String(form.pauseMinutes ?? '') }
          result = await ctx.call(
            'manufacturing.pauseWorkOrder',
            { id: row.id, version, minutes: minutesOf(form.pauseMinutes) },
            url,
            req,
          )
        } else if (form.action === 'take') {
          values = { minutes: String(form.minutes ?? '') }
          result = await ctx.call(
            'manufacturing.takeWorkOrder',
            { id: row.id, version, minutes: row.state === 'in_progress' ? minutesOf(form.minutes) : null },
            url,
            req,
          )
        } else if (form.action === 'output')
          result = await ctx.call(
            'manufacturing.recordOutput',
            {
              id: row.productionId,
              quantity: form.quantity,
              lotName: form.lotName || null,
              weight: form.weight || null,
            },
            url,
            req,
          )
        else if (form.action === 'finish') {
          // The page asks for the minutes; an empty field must not fall back to the clock.
          values = {
            actualMinutes: String(form.actualMinutes ?? ''),
            note: String(form.note ?? ''),
            loss: String(form.loss ?? ''),
          }
          result = values.actualMinutes.trim()
            ? await ctx.call(
                'manufacturing.finishWorkOrder',
                {
                  id: row.id,
                  version,
                  actualMinutes: values.actualMinutes,
                  note: values.note,
                  loss: values.loss,
                },
                url,
                req,
              )
            : { ok: false, errors: [{ field: 'actualMinutes', code: 'manufacturing.error.minutesInvalid' }] }
        } else if (form.action === 'assign') {
          values = {
            operatorId: String(form.operatorId ?? ''),
            assignMinutes: String(form.assignMinutes ?? ''),
          }
          result = await ctx.call(
            'manufacturing.assignWorkOrder',
            {
              id: row.id,
              version,
              operatorId: values.operatorId || null,
              minutes: row.state === 'in_progress' ? minutesOf(form.assignMinutes) : null,
            },
            url,
            req,
          )
        } else return text('unknown action', { status: 400 })
        if ((result as AnyRow).ok) return seeOther(path)
        // Each refusal names its own field in words; the posted field name adds nothing.
        for (const error of ((result as AnyRow).errors as AnyRow[] | undefined) ?? [])
          if (
            ['actualMinutes', 'operatorId', 'minutes', 'loss', 'weight', 'quantity'].includes(
              String(error.field),
            )
          )
            delete error.field
      }
      const me = (await ctx.requestIdentityOf(url, req))?.userId
      const may = {
        work: await ctx.allows('manufacturing.startWorkOrder', url, req),
        assign: await ctx.allows('manufacturing.assignWorkOrder', url, req),
        take:
          Boolean(me) && row.operatorId !== me && (await ctx.allows('manufacturing.takeWorkOrder', url, req)),
        output: Boolean(row.last) && (await ctx.allows('manufacturing.recordOutput', url, req)),
      }
      const order = (await ctx.allows('manufacturing.getProduction', url, req))
        ? ((await ctx.call(
            'manufacturing.getProduction',
            { id: row.productionId },
            url,
            req,
          )) as AnyRow | null)
        : null
      const bom =
        order && may.output
          ? ((await ctx.call('manufacturing.getBom', { id: order.bomId }, url, req)) as AnyRow | null)
          : null
      const unit =
        order && (await ctx.allows('uom.listUnits', url, req))
          ? String(
              ((await ctx.call('uom.listUnits', {}, url, req)) as AnyRow[]).find(
                (entry) => entry.id === order.productUomId,
              )?.name ?? order.productUomId,
            )
          : ''
      return adminPage(ctx, url, req, {
        title: `${String(row.productionName)} · ${String(row.name)}`,
        translate: false,
        active: '/admin/manufacturing/work',
        body: (_, frame) =>
          workOrderScreen(_, frame, {
            row,
            action: path,
            orderHref: inLocale(
              url,
              `/admin/manufacturing/orders/${encodeURIComponent(String(row.productionId))}`,
            ),
            errors: resultErrors(result, _, 'manufacturing_backend.error.invalid'),
            may,
            unit,
            weigh:
              Number(bom?.unitWeight ?? 0) > 0
                ? { unitWeight: String(bom!.unitWeight), tolerance: String(bom!.weightTolerance ?? 0) }
                : null,
            ...(values ? { values } : {}),
          }),
      })
    },

  '/admin/manufacturing/boms':
    (ctx: ServeContext): Route =>
    async (url, req) => {
      if (crossSite(req)) return text('Forbidden', { status: 403 })
      const data = await common(ctx, url, req)
      if (req.method === 'POST') {
        const values = bomValues(await readForm(req))
        const result = await saveBom(ctx, url, req, values)
        if ((result as AnyRow).ok)
          return seeOther(
            inLocale(url, `/admin/manufacturing/boms/${encodeURIComponent(String((result as AnyRow).id))}`),
          )
        const _ = ctx.translate(ctx.localeOf(url, req))
        return bomsPage(
          ctx,
          url,
          req,
          data,
          values,
          resultErrors(result, _, 'manufacturing_backend.error.invalid'),
        )
      } else if (req.method !== 'GET') return text('GET or POST', { status: 405 })
      return bomsPage(ctx, url, req, data)
    },

  '/admin/manufacturing/boms/record-command': bomRecordCommand,
  '/admin/manufacturing/boms/{id}/context': bomContext,
  '/admin/manufacturing/boms/{id}': bomPageRoute,

  '/admin/manufacturing/boms/new':
    (ctx: ServeContext): Route =>
    async (url, req) => {
      if (crossSite(req)) return text('Forbidden', { status: 403 })
      if (req.method === 'GET') return seeOther(inLocale(url, '/admin/manufacturing/boms?create=1'))
      if (req.method !== 'POST') return text('GET or POST', { status: 405 })
      const data = await common(ctx, url, req)
      const values = bomValues(await readForm(req))
      const result = await saveBom(ctx, url, req, values)
      if ((result as AnyRow).ok)
        return seeOther(
          inLocale(url, `/admin/manufacturing/boms/${encodeURIComponent(String((result as AnyRow).id))}`),
        )
      const _ = ctx.translate(ctx.localeOf(url, req))
      return bomsPage(
        ctx,
        url,
        req,
        data,
        values,
        resultErrors(result, _, 'manufacturing_backend.error.invalid'),
      )
    },

  '/admin/manufacturing/work-centers':
    (ctx: ServeContext): Route =>
    async (url, req) => {
      if (crossSite(req)) return text('Forbidden', { status: 403 })
      if (req.method !== 'GET' && req.method !== 'POST') return text('GET or POST', { status: 405 })
      if (!(await ctx.allows('manufacturing.listWorkCenters', url, req)))
        return adminPage(ctx, url, req, {
          title: 'manufacturing_backend.workCenters.title',
          status: 403,
          body: (_, frame) => workCentersLockedScreen(_, frame),
        })
      const rows = (await ctx.call(
        'manufacturing.listWorkCenters',
        { includeArchived: true },
        url,
        req,
      )) as AnyRow[]
      const editId = url.searchParams.get('edit') ?? ''
      const editingRow = editId ? (rows.find((row) => String(row.id) === editId) ?? null) : null
      if (editId && !editingRow) return text('not found', { status: 404 })
      if (req.method === 'POST') {
        const form = await readForm(req)
        const command = form.action ?? ''
        if (command === 'archive' || command === 'restore') {
          const target = rows.find((row) => String(row.id) === String(form.id ?? ''))
          if (!target) return text('not found', { status: 404 })
          const values = workCenterValues(target)
          const result = await ctx.call(
            command === 'archive' ? 'manufacturing.archiveWorkCenter' : 'manufacturing.restoreWorkCenter',
            { id: values.id },
            url,
            req,
          )
          if ((result as AnyRow).ok) return seeOther(workCenterListPath(url))
          const _ = ctx.translate(ctx.localeOf(url, req))
          return workCentersPage(
            ctx,
            url,
            req,
            rows,
            values,
            resultErrors(result, _, 'manufacturing_backend.error.invalid'),
            true,
            true,
          )
        }

        const legacyId = form.id ?? ''
        const legacyRow = legacyId ? (rows.find((row) => String(row.id) === String(legacyId)) ?? null) : null
        const current = editingRow ?? legacyRow
        const values = workCenterValues({ ...form, id: editId || legacyId || undefined })
        const result = await saveWorkCenter(ctx, url, req, values)
        if ((result as AnyRow).ok) return seeOther(workCenterListPath(url))
        const _ = ctx.translate(ctx.localeOf(url, req))
        return workCentersPage(
          ctx,
          url,
          req,
          rows,
          values,
          resultErrors(result, _, 'manufacturing_backend.error.invalid'),
          Boolean(current),
          true,
        )
      }
      return workCentersPage(
        ctx,
        url,
        req,
        rows,
        editingRow ? workCenterValues(editingRow) : undefined,
        [],
        Boolean(editingRow),
      )
    },
}
