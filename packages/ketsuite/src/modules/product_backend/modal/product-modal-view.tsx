// The product page, client side (KetSuite record runtime, page presentation).
//
// A template opens on its own page, `/admin/product/templates/{id}`; the catalogue's
// create action opens `/admin/product/templates/new`. The server renders the page in
// its loading state and this definition renders the record from one read,
// `/admin/product/templates/{id}/context` (modal/product-workspace-context.ts), which
// composes the template with the stock, sales and vendor facts of the modules installed.
//
// The page follows the Commerce product workspace (design/commerce/product-record.mjs):
// figures on top, then content cards — the record form spread over General, Media,
// Pricing and Inventory, the variants, cards other modules add through
// `product_backend:template.recordTabs` (the cosmetic usage cycle, channel listings),
// vendors and activity — and a rail of what needs attention, completeness and a
// summary. Operations that are not plain edits are dialogs of the record.
//
// `product.saveTemplate` does not touch stock tracking or cost: those are other
// functions (`stock.configureProduct`, `product.setCost`),
// and a handler cannot call another function. So "Save changes" runs them in
// sequence (`RecordModalCommand.also`), each only when its module is installed, the
// viewer may call it and the form leaves it something to do.
//
// Bundled by tools/build-backend-client.mjs into product_backend/client/.

import { TEMPLATE_RECORD_LABELS } from '../../product/template-record-labels.ts'
import {
  ActionGroup,
  Badge,
  Button,
  DataTable,
  DescriptionList,
  DropZone,
  EmptyState,
  Field,
  FormGrid,
  Grid,
  Inline,
  LinkButton,
  MediaGallery,
  Metric,
  Notice,
  Progress,
  Section,
  Stack,
  Surface,
  Text,
  Thumbnail,
} from '@ketvietlab/design-system'
import type {
  FieldOption,
  FieldProps,
  RelationManager,
  RelationSelectConfig,
  RelationSelectLabels,
} from '@ketvietlab/design-system'
import type { JSXChild } from '@ketvietlab/ketjs-view'
import { createRecordPage, recordIsland } from '../../../ui/client/record-modal.tsx'
import { productImageUrl } from '../../../ui/client/product-image.ts'
import type {
  RecordModalContext,
  RecordModalDefinition,
  RecordModalDialog,
} from '../../../ui/client/record-modal.tsx'
import type { VariantEditorSetup } from '../../../ui/client/variant-editor-view.tsx'
import {
  RecordCloseTrigger,
  RecordDialogTrigger,
  RecordModalForm,
  RecordStateTrigger,
  recordDialogHref,
  recordStateSelectControl,
} from '../../../ui/client/record-modal-form.tsx'

export type TemplateRecord = {
  revisionId?: string
  id: string
  name: string
  type: string
  categoryId: string | null
  brandId: string | null
  uomId: string | null
  origin: string | null
  description: string | null
  listPrice: string
  compareAtPrice?: string | null
  hsCode?: string | null
  saleOk: boolean
  purchaseOk: boolean
  defaultCode: string | null
  barcode: string | null
  weight?: string | null
  volume?: string | null
  costPrice?: string | null
  defaultVariantId?: string | null
  updatedAt?: string | null
  active: boolean
  isStorable: boolean
  tracking: string
}

export type TemplateImage = { mediaId: string; attachmentId: string; alt: string | null; primary: boolean }

export type WorkspaceVariant = {
  id: string
  label: string
  defaultCode: string | null
  barcode: string | null
  weight: string | null
  volume: string | null
  active: boolean
  price: string
  costPrice: string | null
  image: string | null
  available?: number | null
  /** The variant's barcode in each packaging, by unit id, for the active company. */
  packagingBarcodes?: Record<string, string>
}

type Figures = {
  onHand: number
  reserved: number
  available: number
  incoming: number
  outgoing: number
  forecasted: number
}
export type StockRule = {
  id: string
  productId: string
  minQuantity: number
  maxQuantity: number
  available: number
}
export type WarehouseRow = Figures & { id: string; name: string; code: string; orderpoints: StockRule[] }
export type StockFacts = {
  tracked: boolean
  tracking: string
  warehouses: WarehouseRow[]
  totals: Figures
  inUse: boolean
}
export type SalesFacts = {
  days: number
  quantity: number
  revenue: number | null
  orders: number
  lastAt: string | null
}
export type VendorRow = {
  id: string
  vendor: string
  vendorCode: string | null
  price: string | null
  minQty: number
  delay: number
  dateEnd: string | null
}
export type WorkspaceIssue = {
  code: string
  tone: 'critical' | 'warning' | 'info'
  params?: Record<string, unknown>
}

export type TemplateModalData = {
  record: TemplateRecord
  /** Primary first; the gallery's first image is the cover. */
  images: TemplateImage[]
  hasVariants: boolean
  variantSetup: VariantEditorSetup | null
  types: string[]
  categories: FieldOption[]
  uoms: FieldOption[]
  uomName?: string | null
  brands: FieldOption[]
  stockEnabled: boolean
  permissions: Record<string, boolean>
  lang: 'vi' | 'en'
  /** Cards other modules add through `product_backend:template.recordTabs`. */
  extensionTabs?: Array<{ id: string; label: string; island: string }>
  /** Islands filling `product_backend:template.collaboration` (chatter, activities). */
  collaboration?: Array<{ id: string; island: string }>
  /** Units linked to the product besides its own (`product.TemplateUom`), counted in its unit. */
  packagings?: Array<{
    id: string
    name: string
    quantity: number
    active?: boolean
    barcode?: string | null
  }>
  /** Units of the product's tree it may still take as a packaging. */
  packagingChoices?: FieldOption[]
  variants?: WorkspaceVariant[]
  /** Null when stock is not installed or the viewer may not read it. */
  stock?: StockFacts | null
  sales?: SalesFacts | null
  vendors?: VendorRow[] | null
  margin?: { profit: number; percent: number } | null
  uomLocked?: boolean
  issues?: WorkspaceIssue[]
  completeness?: { score: number; items: Array<{ key: string; done: boolean }> } | null
  links?: {
    forecast: string | null
    orders: string | null
    vendorPricelists: string | null
    list: string
    uoms?: string | null
  }
}

type Context = RecordModalContext<TemplateModalData>

const FORM_ID = 'product-record'
const COMMAND_FIELD = '__command'
const TRACKING = ['none', 'lot', 'serial'] as const
const PATH = (id: string): string => `/admin/product/templates/${encodeURIComponent(id)}`

const uuid = (): string =>
  typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`

/**
 * The id a create-like command mints for its new record. Kept until the command
 * succeeds, so a retry after a refused side step addresses the record already made
 * instead of making a second one; read again when its page opens afresh.
 */
const minted = () => {
  let id: string | null = null
  return {
    get: (): string => {
      id ??= uuid()
      return id
    },
    take: (): string | null => {
      const value = id
      id = null
      return value
    },
    reset: (): void => {
      id = null
    },
  }
}
const createdTemplate = minted()
const duplicatedTemplate = minted()

const pageLang = (): 'vi' | 'en' =>
  typeof document !== 'undefined' && document.documentElement.lang === 'en' ? 'en' : 'vi'

/** The page's own words, `product_backend.ws.*`. */
const t = (c: Context, key: string, params?: Record<string, unknown>): string =>
  c.t(`product_backend.ws.${key}`, params)

// ── Numbers ──────────────────────────────────────────────────────────────────

const localeTag = (c: Context): string => (c.data.lang === 'en' ? 'en-GB' : 'vi-VN')
const present = (value: unknown): boolean => value !== null && value !== undefined && value !== ''
const num = (c: Context, value: unknown, digits = 0): string =>
  present(value)
    ? new Intl.NumberFormat(localeTag(c), { maximumFractionDigits: digits }).format(Number(value))
    : '—'
const money = (c: Context, value: unknown): string =>
  present(value)
    ? new Intl.NumberFormat(localeTag(c), {
        style: 'currency',
        currency: 'VND',
        maximumFractionDigits: 0,
      }).format(Number(value))
    : '—'
const qty = (c: Context, value: unknown): string =>
  present(value) ? `${num(c, value, 3)}${c.data.uomName ? ` ${c.data.uomName}` : ''}` : '—'
/** A stored number as the reader types it: grouped, in their language. */
const typed = (c: Context, value: unknown, digits = 0): string =>
  present(value) ? num(c, value, digits) : ''

/**
 * A typed number as the server reads it. Vietnamese groups thousands with dots and
 * marks decimals with a comma; English the other way round. A Vietnamese reader who
 * types a dot that does not group thousands (0.25) meant a decimal point.
 */
export const parseNumber = (raw: string, lang: 'vi' | 'en'): string | null => {
  const value = raw.trim().replace(/[\s ₫]/gu, '')
  if (!value) return null
  if (lang === 'en') return value.replace(/,/gu, '')
  if (value.includes(',')) return value.replace(/\./gu, '').replace(',', '.')
  return /^-?\d{1,3}(\.\d{3})+$/u.test(value) ? value.replace(/\./gu, '') : value
}

const text = (form: FormData, name: string): string => String(form.get(name) ?? '').trim()
const checked = (form: FormData, name: string): boolean =>
  ['1', 'on', 'true'].includes(String(form.get(name) ?? ''))
const numberOf = (form: FormData, name: string, c: Context): string | null =>
  parseNumber(text(form, name), c.data.lang)
const changedCost = (form: FormData, c: Context, saved: string | null | undefined): boolean => {
  // A form without the field (not rendered, or disabled) leaves the cost as it is.
  if (!form.has('costPrice')) return false
  const next = numberOf(form, 'costPrice', c)
  return next === null
    ? present(saved)
    : saved === null || saved === undefined || Number(next) !== Number(saved)
}

// ── Permissions ──────────────────────────────────────────────────────────────

const can = (c: Context, name: string): boolean => c.data.permissions[name] === true
const editable = (c: Context): boolean => can(c, 'save')
const seesMoney = (c: Context): boolean => can(c, 'money')
const status = (c: Context): 'active' | 'inactive' | 'archived' =>
  !c.data.record.active ? 'archived' : c.data.record.saleOk === false ? 'inactive' : 'active'

// ── Fields ───────────────────────────────────────────────────────────────────

const fieldId = (name: string): string => `product-record-${name}`

/**
 * `backend.relation-select`'s own labels, read straight off this page's context —
 * the shared `relationLabels` in `backend/relation-select.ts` takes a full
 * `Translator`, which `c.t` (a plain `(key, params?) => string`) does not satisfy.
 */
const relationLabels = (c: Context, dialogTitle: string): RelationSelectLabels => ({
  choose: c.t('backend.relation.choose'),
  search: c.t('backend.relation.search'),
  more: c.t('backend.relation.more'),
  noRecords: c.t('backend.relation.noRecords'),
  loading: c.t('backend.relation.loading'),
  loadError: c.t('backend.relation.loadError'),
  dialogTitle,
  close: c.t('backend.relation.close'),
  select: c.t('backend.relation.select'),
  create: c.t('backend.relation.create'),
  edit: c.t('backend.relation.edit'),
  save: c.t('backend.relation.save'),
  cancel: c.t('backend.relation.cancel'),
  remove: c.t('backend.relation.remove'),
  confirmRemove: c.t('backend.relation.confirmRemove'),
  retry: c.t('backend.relation.retry'),
  clear: c.t('backend.relation.clear'),
  chosen: c.t('backend.relation.chosen'),
})

type Spec = Omit<FieldProps, 'id' | 'name' | 'label' | 'value'> & {
  value: unknown
  /** Shown disabled with its reason; the command leaves the value alone. */
  locked?: string | null
  /** How the value reads in the read-only view. */
  fact?: (value: unknown) => string
}

/** A field of the record form: typed input survives a refusal, the refusal shows on it. */
const field = (c: Context, name: string, spec: Spec): FieldProps => {
  const { value, locked, fact: _fact, ...props } = spec
  const base: FieldProps = {
    ...props,
    id: fieldId(name),
    name,
    label: t(c, `field.${name}`),
    error: c.fieldError(name),
    disabled: c.busy || Boolean(locked) || props.disabled === true,
    help: locked ?? props.help ?? null,
  }
  if (props.type === 'checkbox')
    return { ...base, submitValue: '1', checked: c.draftChecked(name, '1', value === true) }
  return { ...base, value: c.draft(name, String(value ?? '')) }
}

/** A relational field, as the search-and-create picker the catalogue uses. */
const relationField = (
  c: Context,
  name: 'categoryId' | 'brandId',
  options: FieldOption[],
  manager: RelationManager,
  dialogTitle: string,
): FieldProps => {
  const base = field(c, name, { type: 'select', value: c.data.record[name] ?? '' })
  const config: RelationSelectConfig = {
    name,
    ariaLabel: base.label,
    value: (base.value as string) || null,
    disabled: base.disabled === true,
    options: [{ value: '', label: t(c, 'none') }, ...options],
    labels: relationLabels(c, dialogTitle),
    manager,
  }
  return { ...base, control: recordIsland('backend.relation-select', { id: base.id, config }) }
}

const typeOptions = (c: Context): FieldOption[] =>
  c.data.types.map((type) => ({ value: type, label: t(c, type === 'service' ? 'service' : 'goods') }))
const trackingOptions = (c: Context): FieldOption[] =>
  TRACKING.map((value) => ({ value, label: t(c, `tracking${value[0]!.toUpperCase()}${value.slice(1)}`) }))
const optionLabel = (options: FieldOption[], value: unknown): string =>
  options.find((option) => option.value === String(value ?? ''))?.label ?? '—'

const amount = (c: Context, value: unknown): Spec => ({
  value: typed(c, value),
  type: 'text',
  inputMode: 'numeric',
  align: 'end',
  suffix: '₫',
  maxLength: 16,
  fact: (saved) => money(c, saved),
})
const measure = (c: Context, value: unknown, suffix: string): Spec => ({
  value: typed(c, value, 3),
  type: 'text',
  inputMode: 'decimal',
  align: 'end',
  suffix,
  maxLength: 12,
  fact: (saved) => (present(saved) ? `${num(c, saved, 3)} ${suffix}` : '—'),
})

/** Every field of the record form, by name, from what was saved. */
const specs = (c: Context): Record<string, Spec> => {
  const record = c.data.record
  return {
    name: { value: record.name, required: true, maxLength: 200, span: 'full' },
    defaultCode: { value: record.defaultCode, maxLength: 40 },
    barcode: { value: record.barcode, inputMode: 'numeric', maxLength: 14 },
    type: {
      value: record.type,
      type: 'select',
      options: typeOptions(c),
      required: true,
      // The kind of product is fixed once it exists: stock and accounting read it.
      disabled: !c.creating,
      fact: (saved) => optionLabel(typeOptions(c), saved),
    },
    saleOk: { value: record.saleOk, type: 'checkbox', fact: (saved) => (saved ? '✓' : '—') },
    purchaseOk: { value: record.purchaseOk, type: 'checkbox', fact: (saved) => (saved ? '✓' : '—') },
    description: { value: record.description, type: 'textarea', rows: 3, maxLength: 2000, span: 'full' },
    listPrice: { ...amount(c, record.listPrice), required: true },
    compareAtPrice: { ...amount(c, record.compareAtPrice), help: t(c, 'compareAtHelp') },
    costPrice: {
      ...amount(c, record.costPrice),
      help: t(c, 'costHelp'),
      locked: can(c, 'setCost') ? null : t(c, 'denied'),
    },
    isStorable: {
      value: record.isStorable,
      type: 'checkbox',
      locked: can(c, 'configureStock') ? null : t(c, 'stockSetup'),
      fact: (saved) => (saved ? '✓' : '—'),
    },
    tracking: {
      value: record.tracking,
      type: 'select',
      options: trackingOptions(c),
      locked: can(c, 'configureStock') ? null : t(c, 'stockSetup'),
      fact: (saved) => optionLabel(trackingOptions(c), saved),
    },
    uomId: {
      value: record.uomId ?? '',
      type: 'select',
      options: c.data.uoms,
      required: true,
      help: t(c, 'uomHelp'),
      locked: c.data.uomLocked ? t(c, 'uomLocked') : null,
      fact: (saved) => optionLabel(c.data.uoms, saved),
    },
    weight: measure(c, record.weight, 'kg'),
    volume: measure(c, record.volume, 'm³'),
    hsCode: { value: record.hsCode, inputMode: 'numeric', maxLength: 12, help: t(c, 'hsHelp') },
    origin: { value: record.origin, maxLength: 80 },
  }
}

const formField = (c: Context, name: string): FieldProps => {
  if (name === 'categoryId')
    return relationField(
      c,
      'categoryId',
      c.data.categories,
      {
        listFunction: 'product.listCategories',
        descriptionField: 'path',
        saveFunction: 'product.saveCategory',
        fields: [{ name: 'name', label: t(c, 'field.categoryId'), required: true }],
      },
      c.t('product_backend.relation.categories'),
    )
  if (name === 'brandId')
    return relationField(
      c,
      'brandId',
      c.data.brands,
      {
        listFunction: 'product.listBrands',
        saveFunction: 'product.saveBrand',
        fields: [{ name: 'name', label: t(c, 'field.brandId'), required: true }],
      },
      c.t('product_backend.relation.brands'),
    )
  return field(c, name, specs(c)[name]!)
}

const factOf = (c: Context, name: string): string => {
  if (name === 'categoryId') return optionLabel(c.data.categories, c.data.record.categoryId)
  if (name === 'brandId') return optionLabel(c.data.brands, c.data.record.brandId)
  const spec = specs(c)[name]!
  const saved = c.data.record[name as keyof TemplateRecord]
  return spec.fact ? spec.fact(saved) : present(saved) ? String(saved) : '—'
}

/** A titled group of fields; a reader who cannot edit sees the saved facts instead. */
const group = (
  c: Context,
  title: string,
  names: string[],
  options: { columns?: 2 | 3; description?: string | null; actions?: JSXChild } = {},
): JSXChild =>
  Section({
    title,
    description: options.description ?? undefined,
    actions: options.actions,
    body: editable(c)
      ? FormGrid({ columns: options.columns ?? 3, items: names.map((name) => Field(formField(c, name))) })
      : DescriptionList({
          columns: 'auto',
          items: names.map((name) => ({ id: name, label: t(c, `field.${name}`), value: factOf(c, name) })),
        }),
  })

// ── Cards ────────────────────────────────────────────────────────────────────

const metrics = (c: Context): JSXChild => {
  const { stock, sales, margin, links } = c.data
  const items: JSXChild[] = []
  if (stock?.tracked) {
    items.push(
      Metric({
        label: t(c, 'metricAvailable'),
        value: qty(c, stock.totals.available),
        detail: t(c, 'detailStock', {
          onHand: num(c, stock.totals.onHand, 3),
          reserved: num(c, stock.totals.reserved, 3),
        }),
        tone: stock.totals.available > 0 ? 'positive' : 'danger',
      }),
      Metric({
        label: t(c, 'metricIncoming'),
        value: qty(c, stock.totals.incoming),
        detail: t(c, 'detailForecast', { forecast: qty(c, stock.totals.forecasted) }),
        href: links?.forecast ?? null,
      }),
    )
  }
  if (sales)
    items.push(
      Metric({
        label: t(c, 'metricSold', { n: sales.days }),
        value: qty(c, sales.quantity),
        detail:
          sales.revenue === null
            ? t(c, 'detailSoldQty', { orders: sales.orders })
            : t(c, 'detailSold', { orders: sales.orders, revenue: money(c, sales.revenue) }),
        href: links?.orders ?? null,
      }),
    )
  if (margin)
    items.push(
      Metric({
        label: t(c, 'metricMargin'),
        value: `${num(c, margin.percent, 1)}%`,
        detail: t(c, 'detailMargin', { profit: money(c, margin.profit), uom: c.data.uomName ?? '' }),
        tone: margin.percent < 0 ? 'danger' : margin.percent < 20 ? 'warning' : 'positive',
      }),
    )
  // A priced product without a cost keeps the slot: the gap is why the margin is unknown.
  else if (seesMoney(c) && c.data.record.saleOk !== false && Number(c.data.record.listPrice) > 0)
    items.push(
      Metric({
        label: t(c, 'metricMargin'),
        value: '—',
        detail: t(c, 'detailNoCost'),
        href: editable(c) && !c.data.hasVariants && can(c, 'setCost') ? `#${fieldId('costPrice')}` : null,
      }),
    )
  // Four fixed slots keep each figure the same size on every product, whatever applies to it.
  return items.length ? Grid({ columns: 4, mobileColumns: 2, items }) : ''
}

const generalCard = (c: Context): JSXChild =>
  Surface({
    title: t(c, 'general'),
    body: Stack({
      divided: true,
      items: [
        group(
          c,
          t(c, 'identity'),
          c.data.hasVariants
            ? ['name', 'type', 'categoryId', 'brandId']
            : ['name', 'defaultCode', 'barcode', 'type', 'categoryId', 'brandId'],
          { description: c.data.hasVariants ? t(c, 'identityVariants') : null },
        ),
        group(c, t(c, 'business'), ['saleOk', 'purchaseOk']),
        group(c, t(c, 'descriptionSection'), ['description']),
      ],
    }),
  })

const mediaCard = (c: Context): JSXChild =>
  // Whoever may neither see nor add images has no use for the card (permissions.viewImages).
  !can(c, 'viewImages') && !can(c, 'uploadImage')
    ? null
    : Surface({
        title: t(c, 'media'),
        actions: can(c, 'uploadImage')
          ? RecordDialogTrigger({
              dialog: 'addImage',
              children: Button({ label: t(c, 'addImage'), variant: 'secondary', disabled: c.busy }),
            })
          : undefined,
        body: c.data.images.length
          ? MediaGallery({
              label: t(c, 'media'),
              items: c.data.images.map((image) => ({
                id: image.mediaId,
                src: productImageUrl(image.attachmentId, 'medium'),
                alt: image.alt || c.data.record.name,
                caption: Inline({
                  align: 'between',
                  blockAlign: 'center',
                  items: [
                    image.primary
                      ? Badge({ label: t(c, 'cover'), tone: 'info', size: 'small' })
                      : Text({ children: image.alt || c.data.record.name, variant: 'bodySm', tone: 'muted' }),
                    can(c, 'removeImage')
                      ? RecordDialogTrigger({
                          dialog: 'removeImage',
                          id: image.mediaId,
                          children: Button({
                            label: t(c, 'removeImage'),
                            variant: 'tertiary',
                            size: 'compact',
                            disabled: c.busy,
                          }),
                        })
                      : '',
                  ],
                }),
              })),
            })
          : EmptyState({ visual: 'start', title: t(c, 'noImages'), message: t(c, 'noImagesHelp') }),
      })

const pricingCard = (c: Context): JSXChild => {
  const prices = [
    'listPrice',
    'compareAtPrice',
    ...(seesMoney(c) && !c.data.hasVariants ? ['costPrice'] : []),
  ]
  const margin = c.data.margin
  return Surface({
    title: t(c, 'pricing'),
    body: Stack({
      divided: true,
      items: [
        group(c, t(c, 'prices'), prices, {
          description: seesMoney(c) && c.data.hasVariants ? t(c, 'costVariants') : null,
        }),
        c.creating
          ? ''
          : seesMoney(c)
            ? Section({
                title: t(c, 'marginLabel'),
                description: t(c, c.data.hasVariants ? 'savedBasisVariants' : 'savedBasis'),
                body: DescriptionList({
                  columns: 'auto',
                  items: [
                    { id: 'profit', label: t(c, 'profit'), value: margin ? money(c, margin.profit) : '—' },
                    {
                      id: 'margin',
                      label: t(c, 'marginLabel'),
                      value: margin ? `${num(c, margin.percent, 1)}%` : '—',
                    },
                  ],
                }),
              })
            : Text({ children: t(c, 'noMoney'), variant: 'bodySm', tone: 'muted' }),
      ],
    }),
  })
}

/** The minimum and maximum of a warehouse's rules: one variant's, or every variant's together. */
const levelsOf = (warehouse: WarehouseRow): { min: number; max: number } | null =>
  warehouse.orderpoints.length
    ? warehouse.orderpoints.reduce(
        (sum, rule) => ({ min: sum.min + rule.minQuantity, max: sum.max + rule.maxQuantity }),
        { min: 0, max: 0 },
      )
    : null

const stockTable = (c: Context): JSXChild => {
  const stock = c.data.stock!
  if (!stock.tracked) return Text({ children: t(c, 'untracked'), variant: 'bodySm', tone: 'muted' })
  if (!stock.warehouses.length) return Text({ children: t(c, 'noStock'), variant: 'bodySm', tone: 'muted' })
  const figure = (key: keyof Figures) => ({
    key,
    label: t(c, key),
    align: 'end' as const,
    kind: 'number' as const,
    priority: key === 'available' || key === 'onHand' ? ('secondary' as const) : ('tertiary' as const),
    cell: (row: WarehouseRow) => num(c, row[key], 3),
  })
  const level = (key: 'min' | 'max') => ({
    key: `${key}Stock`,
    label: t(c, `${key}Stock`),
    align: 'end' as const,
    kind: 'number' as const,
    priority: 'tertiary' as const,
    cell: (row: WarehouseRow) => {
      const levels = levelsOf(row)
      return levels
        ? num(c, levels[key], 3)
        : Text({ children: t(c, 'levelsNone'), variant: 'bodySm', tone: 'muted' })
    },
  })
  return DataTable<WarehouseRow>({
    rows: stock.warehouses,
    id: (row) => row.id,
    responsive: 'stack',
    label: t(c, 'stockByWarehouse'),
    columns: [
      {
        // Nine figures sit beside it: without a width the name is squeezed letter by letter.
        key: 'warehouse',
        label: t(c, 'warehouse'),
        priority: 'primary',
        width: 'medium',
        cell: (row) => row.name,
      },
      ...(['onHand', 'reserved', 'available', 'incoming', 'outgoing', 'forecasted'] as const).map(figure),
      level('min'),
      level('max'),
      ...(can(c, 'orderpoints')
        ? [
            {
              key: 'actions',
              label: t(c, 'actions'),
              align: 'end' as const,
              cell: (row: WarehouseRow) =>
                RecordDialogTrigger({
                  dialog: 'levels',
                  id: row.id,
                  children: Button({
                    label: t(c, 'editLevels'),
                    variant: 'tertiary',
                    disabled: c.busy,
                  }),
                }),
            },
          ]
        : []),
    ],
  })
}

type Packaging = NonNullable<TemplateModalData['packagings']>[number]

const packagingOf = (c: Context): Packaging | undefined =>
  (c.data.packagings ?? []).find((row) => row.id === c.dialog?.params.id)

// The units a product is sold, bought and scanned in besides its own. A product with
// variants keeps a barcode per variant per packaging, set in the variant's dialog.
const packagingSection = (c: Context): JSXChild => {
  const rows = c.data.packagings ?? []
  const unit = c.data.uomName ?? ''
  const barcodes = !c.data.hasVariants
  const actions = [
    c.data.links?.uoms
      ? LinkButton({ label: t(c, 'manageUoms'), href: c.data.links.uoms, variant: 'tertiary' })
      : '',
    can(c, 'addPackaging') && c.data.record.uomId
      ? RecordDialogTrigger({
          dialog: 'addPackaging',
          children: Button({ label: t(c, 'addPackaging'), variant: 'secondary', disabled: c.busy }),
        })
      : '',
  ].filter(Boolean)
  return Section({
    title: t(c, 'packagings'),
    actions: actions.length ? ActionGroup({ actions }) : undefined,
    body: rows.length
      ? Stack({
          items: [
            DataTable<Packaging>({
              rows,
              id: (row) => row.id,
              responsive: 'stack',
              label: t(c, 'packagings'),
              columns: [
                {
                  key: 'unit',
                  label: t(c, 'packagingUnit'),
                  priority: 'primary',
                  cell: (row) =>
                    row.active === false
                      ? Inline({
                          gap: 'compact',
                          blockAlign: 'center',
                          items: [
                            row.name,
                            Badge({ label: t(c, 'packagingArchived'), tone: 'neutral', size: 'small' }),
                          ],
                        })
                      : row.name,
                },
                {
                  key: 'quantity',
                  label: t(c, 'packagingQuantity'),
                  align: 'end',
                  kind: 'number',
                  cell: (row) => `${num(c, row.quantity, 3)} ${unit}`.trim(),
                },
                ...(barcodes
                  ? [
                      {
                        key: 'barcode',
                        label: t(c, 'packagingBarcode'),
                        kind: 'identifier' as const,
                        cell: (row: Packaging) => row.barcode ?? '—',
                      },
                    ]
                  : []),
                ...(can(c, 'removePackaging') || (barcodes && can(c, 'packagingBarcodes'))
                  ? [
                      {
                        key: 'actions',
                        label: t(c, 'actions'),
                        align: 'end' as const,
                        cell: (row: Packaging) =>
                          ActionGroup({
                            actions: [
                              barcodes && can(c, 'packagingBarcodes')
                                ? RecordDialogTrigger({
                                    dialog: 'packagingBarcode',
                                    id: row.id,
                                    children: Button({
                                      label: t(c, 'editPackagingBarcode'),
                                      variant: 'tertiary',
                                      disabled: c.busy,
                                    }),
                                  })
                                : '',
                              can(c, 'removePackaging')
                                ? RecordDialogTrigger({
                                    dialog: 'removePackaging',
                                    id: row.id,
                                    children: Button({
                                      label: t(c, 'removePackagingShort'),
                                      variant: 'tertiary',
                                      disabled: c.busy,
                                    }),
                                  })
                                : '',
                            ].filter(Boolean),
                          }),
                      },
                    ]
                  : []),
              ],
            }),
            c.data.hasVariants
              ? Text({ children: t(c, 'packagingVariantHelp'), variant: 'bodySm', tone: 'muted' })
              : '',
          ],
        })
      : Text({ children: t(c, 'noPackagings', { uom: unit }), variant: 'bodySm', tone: 'muted' }),
  })
}

const inventoryCard = (c: Context): JSXChild =>
  Surface({
    title: t(c, 'inventory'),
    body: Stack({
      divided: true,
      items: [
        group(c, t(c, 'storage'), [...(c.data.stockEnabled ? ['isStorable', 'tracking'] : []), 'uomId']),
        c.creating ? '' : packagingSection(c),
        group(
          c,
          t(c, 'shipping'),
          [...(c.data.hasVariants ? [] : ['weight', 'volume']), 'hsCode', 'origin'],
          {
            description: c.data.hasVariants ? t(c, 'measureVariants') : null,
          },
        ),
        !c.creating && c.data.stock
          ? Section({
              title: t(c, 'stockByWarehouse'),
              actions: c.data.links?.forecast
                ? LinkButton({
                    label: t(c, 'openForecast'),
                    href: c.data.links.forecast,
                    variant: 'tertiary',
                  })
                : undefined,
              body: stockTable(c),
            })
          : '',
      ],
    }),
  })

const configureTrigger = (c: Context, primary: boolean): JSXChild =>
  can(c, 'configureAttributes') && c.data.variantSetup
    ? RecordDialogTrigger({
        dialog: 'configureAttributes',
        children: Button({
          label: t(c, 'configureAttributes'),
          variant: primary ? 'primary' : 'secondary',
          disabled: c.busy,
        }),
      })
    : ''

const extraText = (c: Context, priceExtra: string): string => {
  const extra = Number(priceExtra || 0)
  return extra ? ` (${extra > 0 ? '+' : '−'}${money(c, Math.abs(extra))})` : ''
}

const variantsCard = (c: Context): JSXChild => {
  const variants = c.data.variants ?? []
  const lines = c.data.variantSetup?.lines ?? []
  if (!variants.length)
    return Surface({
      id: fieldId('variants'),
      title: t(c, 'variants'),
      body: EmptyState({
        visual: 'start',
        title: t(c, 'noVariants'),
        message: t(c, 'noVariantsHelp'),
        actions: configureTrigger(c, true) || undefined,
      }),
    })
  const cover = c.data.images[0]?.attachmentId ?? null
  return Surface({
    id: fieldId('variants'),
    title: t(c, 'variants'),
    actions: configureTrigger(c, false) || undefined,
    body: Stack({
      items: [
        DescriptionList({
          columns: 'auto',
          items: lines.map((line) => ({
            id: line.attributeId,
            label: line.name,
            value: line.values.map((value) => `${value.name}${extraText(c, value.priceExtra)}`).join(', '),
          })),
        }),
        DataTable<WorkspaceVariant>({
          rows: variants,
          id: (row) => row.id,
          // The whole row opens the variant's editor; there is no separate edit button.
          ...(can(c, 'saveVariantSetup') && c.data.variantSetup && !c.busy
            ? { rowHref: (row: WorkspaceVariant) => recordDialogHref(c, 'editVariant', row.id) }
            : {}),
          responsive: 'stack',
          label: t(c, 'variants'),
          columns: [
            {
              key: 'label',
              label: t(c, 'variant'),
              priority: 'primary',
              // The name carries its picture, so this is the row's text column, not a
              // picture-only `media` column: those are pinned to the picture's width.
              width: 'medium',
              cell: (row) =>
                Inline({
                  gap: 'compact',
                  blockAlign: 'center',
                  items: [
                    Thumbnail({
                      src: row.image
                        ? productImageUrl(row.image, 'thumb')
                        : cover
                          ? productImageUrl(cover, 'thumb')
                          : null,
                      alt: '',
                      size: 'small',
                    }),
                    Text({ children: row.label, variant: 'bodyMd' }),
                  ],
                }),
            },
            {
              key: 'defaultCode',
              label: t(c, 'field.defaultCode'),
              kind: 'identifier',
              cell: (row) => row.defaultCode ?? '—',
            },
            {
              key: 'barcode',
              label: t(c, 'field.barcode'),
              kind: 'identifier',
              priority: 'tertiary',
              cell: (row) =>
                row.barcode ??
                (row.active ? Badge({ label: t(c, 'missing'), tone: 'warning', size: 'small' }) : '—'),
            },
            {
              key: 'price',
              label: t(c, 'price'),
              align: 'end',
              kind: 'currency',
              cell: (row) => money(c, row.price),
            },
            ...(seesMoney(c)
              ? [
                  {
                    key: 'costPrice',
                    label: t(c, 'field.costPrice'),
                    align: 'end' as const,
                    kind: 'currency' as const,
                    priority: 'tertiary' as const,
                    cell: (row: WorkspaceVariant) => money(c, row.costPrice),
                  },
                ]
              : []),
            ...(c.data.stock?.tracked
              ? [
                  {
                    key: 'available',
                    label: t(c, 'available'),
                    align: 'end' as const,
                    kind: 'number' as const,
                    cell: (row: WorkspaceVariant) => num(c, row.available, 3),
                  },
                ]
              : []),
            {
              key: 'status',
              label: t(c, 'status'),
              kind: 'status',
              cell: (row) =>
                Badge({
                  label: t(c, row.active ? 'status.active' : 'status.inactive'),
                  tone: row.active ? 'positive' : 'neutral',
                  size: 'small',
                }),
            },
          ],
        }),
      ],
    }),
  })
}

const extensionCards = (c: Context): JSXChild[] =>
  (c.data.extensionTabs ?? []).map((block) =>
    Surface({
      title: block.label,
      body: recordIsland(block.island, { templateId: c.id, locale: c.data.lang }),
    }),
  )

const vendorsCard = (c: Context): JSXChild => {
  const vendors = c.data.vendors
  if (!vendors) return ''
  const date = new Intl.DateTimeFormat(localeTag(c), { dateStyle: 'medium' })
  return Surface({
    title: t(c, 'vendors'),
    actions: c.data.links?.vendorPricelists
      ? LinkButton({
          label: t(c, 'openPricelists'),
          href: c.data.links.vendorPricelists,
          variant: 'tertiary',
        })
      : undefined,
    body: vendors.length
      ? DataTable<VendorRow>({
          rows: vendors,
          id: (row) => row.id,
          responsive: 'stack',
          label: t(c, 'vendors'),
          columns: [
            {
              key: 'vendor',
              label: t(c, 'vendor'),
              priority: 'primary',
              width: 'medium',
              cell: (row) => row.vendor,
            },
            {
              key: 'vendorCode',
              label: t(c, 'vendorCode'),
              kind: 'identifier',
              priority: 'tertiary',
              cell: (row) => row.vendorCode ?? '—',
            },
            ...(seesMoney(c)
              ? [
                  {
                    key: 'price',
                    label: t(c, 'purchasePrice'),
                    align: 'end' as const,
                    kind: 'currency' as const,
                    cell: (row: VendorRow) => money(c, row.price),
                  },
                ]
              : []),
            {
              key: 'minQty',
              label: t(c, 'minQty'),
              align: 'end',
              kind: 'number',
              cell: (row) => qty(c, row.minQty),
            },
            {
              key: 'lead',
              label: t(c, 'lead'),
              align: 'end',
              kind: 'number',
              cell: (row) => t(c, 'days', { n: row.delay }),
            },
            {
              key: 'validTo',
              label: t(c, 'validTo'),
              kind: 'date',
              priority: 'tertiary',
              cell: (row) => (row.dateEnd ? date.format(new Date(row.dateEnd)) : t(c, 'open')),
            },
          ],
        })
      : EmptyState({ visual: 'empty', title: t(c, 'noVendors'), message: t(c, 'noVendorsHelp') }),
  })
}

const activityCard = (c: Context): JSXChild =>
  c.data.collaboration?.length
    ? Surface({
        title: t(c, 'activity'),
        body: Stack({
          items: c.data.collaboration.map((entry) =>
            recordIsland(entry.island, { resModel: 'product.Template', resId: c.id, lang: c.data.lang }),
          ),
        }),
      })
    : ''

const body = (c: Context): JSXChild => {
  if (c.creating) {
    const cards = Stack({ items: [generalCard(c), pricingCard(c), inventoryCard(c)] })
    return RecordModalForm({ id: FORM_ID, kind: c.kind, command: 'create', fields: [], body: cards })
  }
  // The form spans the cards it edits and the ones between them; cards other modules
  // add carry forms of their own, so they follow it rather than sit inside it.
  const cards = Stack({
    items: [
      metrics(c),
      generalCard(c),
      mediaCard(c),
      pricingCard(c),
      inventoryCard(c),
      variantsCard(c),
      vendorsCard(c),
    ],
  })
  return Stack({
    items: [
      editable(c)
        ? RecordModalForm({ id: FORM_ID, kind: c.kind, command: 'save', fields: [], body: cards })
        : cards,
      ...extensionCards(c),
      activityCard(c),
    ],
  })
}

// ── Rail ─────────────────────────────────────────────────────────────────────

const ISSUE_TONE = { critical: 'danger', warning: 'warning', info: 'info' } as const

/** A missing fact links to what fills it: the image dialog, or its field on this page. */
const missingLink = (c: Context, key: string): JSXChild => {
  const label = t(c, `field.${key === 'image' ? 'image' : key}`)
  if (key === 'image')
    return can(c, 'uploadImage')
      ? RecordDialogTrigger({
          dialog: 'addImage',
          children: Button({ label, variant: 'tertiary', size: 'compact' }),
        })
      : Text({ children: label, variant: 'bodySm' })
  // A fact each variant holds is filled in the variants card, so it points there.
  const perVariant = c.data.hasVariants && ['defaultCode', 'barcode', 'costPrice', 'weight'].includes(key)
  const fillable =
    editable(c) &&
    (!perVariant || (can(c, 'saveVariantSetup') && Boolean(c.data.variantSetup))) &&
    !(key === 'costPrice' && !can(c, 'setCost'))
  return fillable
    ? LinkButton({
        label,
        href: `#${fieldId(perVariant ? 'variants' : key)}`,
        variant: 'tertiary',
        size: 'compact',
      })
    : Text({ children: label, variant: 'bodySm' })
}

const aside = (c: Context): JSXChild | undefined => {
  if (c.creating) return undefined
  const issues = c.data.issues ?? []
  const completeness = c.data.completeness
  const items: JSXChild[] = []
  if (issues.length)
    items.push(
      Surface({
        title: t(c, 'attention'),
        body: Stack({
          items: issues.map((issue) =>
            Notice({
              title: t(c, `issue.${issue.code}`),
              message: [
                t(c, `issue.${issue.code}Help`, {
                  ...issue.params,
                  available: num(c, issue.params?.available, 3),
                  minimum: num(c, issue.params?.minimum, 3),
                }),
                // An issue that names one item counts the others in `others`, not hides them.
                // `count` is the issue's own number (variants without a barcode) and needs no line.
                ...(Number(issue.params?.others ?? 0) > 0
                  ? [t(c, `issue.${issue.code}More`, { count: Number(issue.params?.others) })]
                  : []),
              ].join(' '),
              tone: ISSUE_TONE[issue.tone],
            }),
          ),
        }),
      }),
    )
  if (completeness) {
    const missing = completeness.items.filter((item) => !item.done)
    items.push(
      Surface({
        title: t(c, 'completeness'),
        body: Stack({
          items: [
            Progress({
              value: completeness.score,
              label: missing.length
                ? t(c, 'filled', {
                    done: completeness.items.length - missing.length,
                    total: completeness.items.length,
                  })
                : t(c, 'complete'),
              tone:
                completeness.score === 100 ? 'positive' : completeness.score >= 70 ? 'primary' : 'warning',
            }),
            missing.length
              ? Section({
                  title: t(c, 'missing'),
                  body: Stack({
                    gap: 'tight',
                    inlineAlign: 'start',
                    items: missing.map((item) => missingLink(c, item.key)),
                  }),
                })
              : '',
          ],
        }),
      }),
    )
  }
  const record = c.data.record
  items.push(
    Surface({
      title: t(c, 'summary'),
      body: DescriptionList({
        columns: 1,
        items: [
          { id: 'code', label: t(c, 'field.defaultCode'), value: record.defaultCode ?? '—' },
          {
            id: 'type',
            label: t(c, 'field.type'),
            value: t(c, record.type === 'service' ? 'service' : 'goods'),
          },
          {
            id: 'category',
            label: t(c, 'field.categoryId'),
            value: optionLabel(c.data.categories, record.categoryId),
          },
          { id: 'uom', label: t(c, 'field.uomId'), value: c.data.uomName ?? '—' },
          {
            id: 'updated',
            label: t(c, 'updated'),
            value: record.updatedAt
              ? new Intl.DateTimeFormat(localeTag(c), { dateStyle: 'medium', timeStyle: 'short' }).format(
                  new Date(record.updatedAt),
                )
              : t(c, 'never'),
          },
        ],
      }),
    }),
  )
  return Stack({ items })
}

// ── Header ───────────────────────────────────────────────────────────────────

const pageActions = (c: Context): JSXChild => {
  const back = RecordCloseTrigger({
    children: Button({ label: t(c, c.creating ? 'cancel' : 'back'), variant: 'secondary' }),
  })
  if (c.creating)
    return ActionGroup({
      actions: [
        back,
        Button({
          label: t(c, 'create'),
          type: 'submit',
          form: FORM_ID,
          name: COMMAND_FIELD,
          value: 'create',
          variant: 'primary',
          loading: c.busy,
        }),
      ],
    })
  const archived = !c.data.record.active
  return ActionGroup({
    actions: [
      back,
      can(c, 'duplicate') && editable(c)
        ? RecordDialogTrigger({
            dialog: 'duplicate',
            children: Button({ label: t(c, 'duplicate'), variant: 'secondary', disabled: c.busy }),
          })
        : '',
      can(c, 'archive')
        ? RecordDialogTrigger({
            dialog: archived ? 'restore' : 'archive',
            children: Button({
              label: t(c, archived ? 'restore' : 'archive'),
              variant: 'secondary',
              disabled: c.busy,
            }),
          })
        : '',
      editable(c)
        ? Button({
            label: t(c, 'save'),
            type: 'submit',
            form: FORM_ID,
            name: COMMAND_FIELD,
            value: 'save',
            variant: 'primary',
            loading: c.busy,
          })
        : '',
    ].filter(Boolean),
  })
}

// ── Dialogs ──────────────────────────────────────────────────────────────────

const closeButton = (c: Context): JSXChild =>
  RecordCloseTrigger({ children: Button({ label: t(c, 'cancel'), variant: 'secondary' }) })
const submitButton = (c: Context, form: string, command: string, label: string, disabled = false): JSXChild =>
  Button({
    label,
    type: 'submit',
    form,
    name: COMMAND_FIELD,
    value: command,
    variant: 'primary',
    loading: c.busy,
    disabled,
  })

const variantOf = (c: Context): WorkspaceVariant | undefined =>
  (c.data.variants ?? []).find((row) => row.id === c.dialog?.params.id)
const warehouseOf = (c: Context): WarehouseRow | undefined =>
  c.data.stock?.warehouses.find((row) => row.id === c.dialog?.params.id)

/** The variants a warehouse's stock levels are set for: the product itself, or each variant. */
const levelProducts = (c: Context): Array<{ id: string; label: string }> => {
  if (!c.data.hasVariants)
    return c.data.record.defaultVariantId
      ? [{ id: c.data.record.defaultVariantId, label: c.data.record.name }]
      : []
  const ruled = new Set(warehouseOf(c)?.orderpoints.map((rule) => rule.productId) ?? [])
  return (c.data.variants ?? []).filter((row) => row.active || ruled.has(row.id))
}

const levelsDialog = (c: Context): JSXChild => {
  const warehouse = warehouseOf(c)
  if (!warehouse) return Notice({ title: t(c, 'noStock'), message: t(c, 'variantGoneHelp'), tone: 'warning' })
  const rules = new Map(warehouse.orderpoints.map((rule) => [rule.productId, rule]))
  const products = levelProducts(c)
  const input = (product: { id: string; label: string }, key: 'min' | 'max'): JSXChild => {
    const name = `${key}.${product.id}`
    const rule = rules.get(product.id)
    return Field({
      id: `product-levels-${key}-${product.id.replace(/[^\w-]/gu, '-')}`,
      name,
      label: c.data.hasVariants ? `${product.label} · ${t(c, `${key}Stock`)}` : t(c, `${key}Stock`),
      type: 'text',
      inputMode: 'decimal',
      align: 'end',
      suffix: c.data.uomName ?? undefined,
      maxLength: 12,
      value: c.draft(name, rule ? typed(c, key === 'min' ? rule.minQuantity : rule.maxQuantity, 3) : ''),
      error: c.fieldError(name),
      disabled: c.busy,
    })
  }
  return RecordModalForm({
    id: 'product-levels',
    kind: c.kind,
    command: 'levels',
    fields: [],
    body: Stack({
      items: [
        Text({ children: t(c, 'levelsHelp'), variant: 'bodyMd' }),
        FormGrid({
          columns: 2,
          items: products.flatMap((product) => [input(product, 'min'), input(product, 'max')]),
        }),
      ],
    }),
  })
}

const editVariantDialog = (c: Context): JSXChild => {
  const variant = variantOf(c)
  if (!variant)
    return Notice({ title: t(c, 'variantGone'), message: t(c, 'variantGoneHelp'), tone: 'warning' })
  const input = (name: string, value: unknown, extra: Partial<FieldProps> = {}): JSXChild =>
    Field({
      id: `product-variant-${name}`,
      name,
      label: t(c, `field.${name}`),
      value: c.draft(name, String(value ?? '')),
      error: c.fieldError(name),
      disabled: c.busy,
      ...extra,
    })
  return RecordModalForm({
    id: 'product-edit-variant',
    kind: c.kind,
    command: 'editVariant',
    fields: [],
    body: FormGrid({
      columns: 2,
      items: [
        input('defaultCode', variant.defaultCode, { maxLength: 40 }),
        input('barcode', variant.barcode, { inputMode: 'numeric', maxLength: 14 }),
        input('weight', typed(c, variant.weight, 3), {
          inputMode: 'decimal',
          align: 'end',
          suffix: 'kg',
          maxLength: 12,
        }),
        input('volume', typed(c, variant.volume, 3), {
          inputMode: 'decimal',
          align: 'end',
          suffix: 'm³',
          maxLength: 12,
        }),
        ...(seesMoney(c) && can(c, 'setCost')
          ? [
              input('costPrice', typed(c, variant.costPrice), {
                inputMode: 'numeric',
                align: 'end',
                suffix: '₫',
                maxLength: 16,
                help: t(c, 'costHelp'),
              }),
            ]
          : []),
        ...(can(c, 'packagingBarcodes')
          ? (c.data.packagings ?? []).map((row) =>
              Field({
                id: `product-variant-packaging-${row.id.replace(/[^\w-]/gu, '-')}`,
                name: `packaging.${row.id}`,
                label: `${t(c, 'packagingBarcode')} · ${row.name}`,
                inputMode: 'numeric',
                maxLength: 14,
                value: c.draft(`packaging.${row.id}`, variant.packagingBarcodes?.[row.id] ?? ''),
                error: c.fieldError(`packaging.${row.id}`),
                disabled: c.busy,
              }),
            )
          : []),
        Field({
          id: 'product-variant-active',
          name: 'active',
          label: t(c, 'variantActive'),
          type: 'checkbox',
          submitValue: '1',
          checked: c.draftChecked('active', '1', variant.active),
          disabled: c.busy,
          span: 'full',
        }),
      ],
    }),
  })
}

// --- Configure attributes ----------------------------------------------------
// The rows are the product's attribute lines. "Add attribute" appends an existing
// attribute or a new one named here; each row adds values in place. Ticking a value
// re-renders the dialog (the row's "All" box makes every tick a draft), so extras
// show only for chosen values. Applying is one call, `product.configureAttributes`:
// new attributes and values, the lines and the variants they make are written
// together, or nothing is.

const LINE_LIMIT = 10
const VALUE_ROWS_LIMIT = 20
const catalogue = (c: Context) =>
  (c.data.variantSetup?.catalogue ?? []).filter((attribute) => attribute.createVariant !== 'no_variant')
const currentLines = (c: Context) =>
  (c.data.variantSetup?.lines ?? []).filter((line) => line.createVariant !== 'no_variant')
const lineKeys = (c: Context): string[] =>
  c
    .state(
      'lines',
      currentLines(c)
        .map((line) => line.attributeId)
        .join(','),
    )
    .split(',')
    .filter(Boolean)
/** A new attribute opens with one value row; an existing one adds rows on demand. */
const addedRows = (c: Context, key: string): number =>
  Math.min(VALUE_ROWS_LIMIT, Number(c.state(`added.${key}`, key.startsWith('new-') ? '1' : '0')) || 0)
const controlId = (key: string): string => key.replace(/[^\w-]/gu, '-')
const valuesName = (key: string): string => `values[${key}]`

const extraField = (c: Context, name: string, label: string, saved: string): JSXChild =>
  Field({
    id: `product-${controlId(name)}`,
    name,
    label,
    type: 'text',
    inputMode: 'numeric',
    align: 'end',
    suffix: '₫',
    maxLength: 16,
    value: c.draft(name, saved),
    error: c.fieldError(name),
    disabled: c.busy,
  })

const attributeRow = (c: Context, key: string, keys: string[]): JSXChild => {
  const attribute = catalogue(c).find((row) => row.attributeId === key) ?? null
  const current = currentLines(c).find((line) => line.attributeId === key)
  // A checkbox group submits its values under `name[]`; drafts and the command read that name.
  const checks = `${valuesName(key)}[]`
  const added = addedRows(c, key)
  const chosen = (attribute?.values ?? []).filter((value) =>
    c.draftChecked(
      checks,
      value.valueId,
      Boolean(current?.values.some((item) => item.valueId === value.valueId)),
    ),
  )
  const rowFields = [
    `attributeName.${key}`,
    checks,
    `__all:${valuesName(key)}`,
    ...(attribute?.values ?? []).map((value) => `extra.${value.valueId}`),
    ...Array.from({ length: added }, (_, index) => [
      `newValue.${key}.${index}`,
      `newExtra.${key}.${index}`,
    ]).flat(),
  ]
  return Section({
    title: attribute?.name ?? t(c, 'newAttributeTitle'),
    actions: RecordStateTrigger({
      name: 'lines',
      value: keys.filter((other) => other !== key).join(','),
      resetFields: rowFields,
      children: Button({
        label: t(c, 'removeAttribute'),
        variant: 'tertiary',
        size: 'compact',
        disabled: c.busy,
      }),
    }),
    body: Stack({
      items: [
        attribute
          ? ''
          : Field({
              id: `product-attribute-name-${controlId(key)}`,
              name: `attributeName.${key}`,
              label: t(c, 'attributeName'),
              required: true,
              maxLength: 60,
              value: c.draft(`attributeName.${key}`, ''),
              error: c.fieldError(`attributeName.${key}`),
              disabled: c.busy,
            }),
        // "All" leads the row's options; its own name keeps it out of the submitted values.
        attribute?.values.length
          ? Field({
              id: `product-attribute-${controlId(key)}`,
              name: valuesName(key),
              label: t(c, 'attributeValues'),
              type: 'checkbox-group',
              error: c.fieldError(checks),
              disabled: c.busy,
              options: [
                {
                  value: '1',
                  name: `__all:${valuesName(key)}`,
                  label: t(c, 'allValues'),
                  checked: chosen.length === attribute.values.length,
                },
                ...attribute.values.map((value) => ({
                  value: value.valueId,
                  label: value.name,
                  checked: chosen.includes(value),
                })),
              ],
            })
          : '',
        chosen.length
          ? FormGrid({
              columns: 3,
              items: chosen.map((value) =>
                extraField(
                  c,
                  `extra.${value.valueId}`,
                  t(c, 'extraFor', { value: value.name }),
                  typed(c, current?.values.find((item) => item.valueId === value.valueId)?.priceExtra ?? 0),
                ),
              ),
            })
          : '',
        ...Array.from({ length: added }, (_, index) =>
          FormGrid({
            columns: 2,
            items: [
              Field({
                id: `product-new-value-${controlId(key)}-${index}`,
                name: `newValue.${key}.${index}`,
                label: t(c, 'newValue'),
                maxLength: 60,
                help: t(c, 'newValueHelp'),
                value: c.draft(`newValue.${key}.${index}`, ''),
                error: c.fieldError(`newValue.${key}.${index}`),
                disabled: c.busy,
              }),
              extraField(c, `newExtra.${key}.${index}`, t(c, 'extra'), '0'),
            ],
          }),
        ),
        Inline({
          items: [
            RecordStateTrigger({
              name: `added.${key}`,
              value: String(added + 1),
              children: Button({
                label: t(c, 'addValue'),
                variant: 'secondary',
                size: 'compact',
                disabled: c.busy || added >= VALUE_ROWS_LIMIT,
              }),
            }),
          ],
        }),
      ],
    }),
  })
}

const attributesDialog = (c: Context): JSXChild => {
  const keys = lineKeys(c)
  const unused = catalogue(c).filter((attribute) => !keys.includes(attribute.attributeId))
  const next = `new-${Math.max(0, ...keys.filter((key) => key.startsWith('new-')).map((key) => Number(key.slice(4)) || 0)) + 1}`
  const add = Field({
    id: 'product-add-attribute',
    name: '__addAttribute',
    label: t(c, 'addAttribute'),
    type: 'select',
    value: '',
    control: recordStateSelectControl({
      id: 'product-add-attribute',
      name: '__addAttribute',
      state: 'lines',
      value: '',
      disabled: c.busy || keys.length >= LINE_LIMIT,
      options: [
        { value: '', label: t(c, 'chooseAttribute') },
        ...unused.map((attribute) => ({
          value: [...keys, attribute.attributeId].join(','),
          label: attribute.name,
        })),
        { value: [...keys, next].join(','), label: t(c, 'newAttribute') },
      ],
    }),
  })
  return RecordModalForm({
    id: 'product-configure-attributes',
    kind: c.kind,
    command: 'configureAttributes',
    fields: [],
    hidden: { lines: keys.join(',') },
    // Adding or removing a row is an edit the reader has not applied yet.
    dirty:
      keys.join(',') !==
      currentLines(c)
        .map((line) => line.attributeId)
        .join(','),
    body: Stack({
      items: [
        Notice({ title: t(c, 'configureAttributes'), message: t(c, 'attributesHelp'), tone: 'info' }),
        keys.length
          ? Stack({ divided: true, items: keys.map((key) => attributeRow(c, key, keys)) })
          : EmptyState({ visual: 'start', title: t(c, 'noLines'), message: t(c, 'noLinesHelp') }),
        // A native select keeps the option picked before a re-render, so the picker is
        // rebuilt (its wrapper alternates with the line count) and shows "Choose" again.
        keys.length % 2 ? Stack({ items: [add] }) : add,
      ],
    }),
  })
}

/**
 * The dialog's rows as `product.configureAttributes` reads them, and where each input
 * path the function may refuse lives in the form, so a refusal lands on its control.
 */
export const configureInput = (
  form: FormData,
  c: Context,
): { lines: Array<Record<string, unknown>>; paths: Map<string, string> } => {
  const keys = text(form, 'lines').split(',').filter(Boolean)
  const paths = new Map<string, string>()
  const lines = keys.map((key, index) => {
    const at = `lines.${index}`
    const existing = !key.startsWith('new-')
    paths.set(`${at}.name`, `attributeName.${key}`)
    paths.set(`${at}.attributeId`, `${valuesName(key)}[]`)
    paths.set(`${at}.values`, existing ? `${valuesName(key)}[]` : `newValue.${key}.0`)
    const values: Array<Record<string, unknown>> = []
    for (const valueId of form.getAll(`${valuesName(key)}[]`).map(String)) {
      paths.set(`${at}.values.${values.length}`, `${valuesName(key)}[]`)
      paths.set(`${at}.values.${values.length}.priceExtra`, `extra.${valueId}`)
      values.push({ valueId, priceExtra: parseNumber(text(form, `extra.${valueId}`), c.data.lang) ?? '0' })
    }
    for (let row = 0; row < VALUE_ROWS_LIMIT; row += 1) {
      const name = text(form, `newValue.${key}.${row}`)
      if (!name) continue
      paths.set(`${at}.values.${values.length}.name`, `newValue.${key}.${row}`)
      paths.set(`${at}.values.${values.length}.priceExtra`, `newExtra.${key}.${row}`)
      values.push({ name, priceExtra: parseNumber(text(form, `newExtra.${key}.${row}`), c.data.lang) ?? '0' })
    }
    return existing ? { attributeId: key, values } : { name: text(form, `attributeName.${key}`), values }
  })
  return { lines, paths }
}

/** The whole setup with one variant changed, as `product.saveVariantSetup` takes it. */
const setupWith = (
  c: Context,
  id: string,
  change: Partial<{
    defaultCode: string | null
    barcode: string | null
    weight: string
    volume: string
    active: boolean
  }>,
) => {
  const setup = c.data.variantSetup!
  return {
    templateId: c.id,
    lines: setup.lines.map((line) => ({
      attributeId: line.attributeId,
      values: line.values.map((value) => ({ valueId: value.valueId, priceExtra: value.priceExtra })),
    })),
    variants: setup.variants.map((variant) => ({
      id: variant.id,
      valueIds: variant.valueIds,
      defaultCode: variant.defaultCode,
      barcode: variant.barcode,
      weight: variant.weight,
      volume: variant.volume,
      active: variant.active,
      ...(variant.id === id ? change : {}),
    })),
  }
}

/** Every packaging's barcode as the form has it, in the order the server reports refusals by. */
const packagingEntries = (form: FormData, c: Context): Array<{ uomId: string; barcode: string | null }> =>
  (c.data.packagings ?? []).map((row) => ({
    uomId: row.id,
    barcode: text(form, `packaging.${row.id}`) || null,
  }))

const packagingBarcodesChanged = (form: FormData, c: Context, saved: Record<string, string> | undefined) =>
  packagingEntries(form, c).some((entry) => (entry.barcode ?? '') !== (saved?.[entry.uomId] ?? ''))

const addPackagingDialog = (c: Context): JSXChild => {
  const choices = c.data.packagingChoices ?? []
  const unit = c.data.uomName ?? ''
  if (!choices.length) return Text({ children: t(c, 'noPackagingChoice', { uom: unit }), variant: 'bodyMd' })
  return RecordModalForm({
    id: 'product-add-packaging',
    kind: c.kind,
    command: 'addPackaging',
    fields: [],
    body: Stack({
      items: [
        Field({
          id: 'product-packaging-unit',
          name: 'uomId',
          label: t(c, 'packagingUnit'),
          type: 'select',
          required: true,
          options: [{ value: '', label: '—' }, ...choices],
          value: c.draft('uomId', ''),
          help: t(c, 'addPackagingHelp', { uom: unit }),
          error: c.fieldError('uomId'),
          disabled: c.busy,
        }),
        !c.data.hasVariants && can(c, 'packagingBarcodes')
          ? Field({
              id: 'product-packaging-barcode',
              name: 'barcode',
              label: t(c, 'packagingBarcode'),
              inputMode: 'numeric',
              maxLength: 14,
              value: c.draft('barcode', ''),
              help: t(c, 'packagingBarcodeHelp'),
              error: c.fieldError('barcode'),
              disabled: c.busy,
            })
          : '',
      ].filter(Boolean),
    }),
  })
}

const packagingBarcodeDialog = (c: Context): JSXChild => {
  const packaging = packagingOf(c)
  if (!packaging)
    return Notice({ title: t(c, 'variantGone'), message: t(c, 'variantGoneHelp'), tone: 'warning' })
  return RecordModalForm({
    id: 'product-packaging-barcode',
    kind: c.kind,
    command: 'packagingBarcode',
    fields: [],
    body: Field({
      id: 'product-packaging-barcode',
      name: 'barcode',
      label: t(c, 'packagingBarcode'),
      inputMode: 'numeric',
      maxLength: 14,
      value: c.draft('barcode', packaging.barcode ?? ''),
      help: t(c, 'packagingBarcodeHelp'),
      error: c.fieldError('barcode'),
      disabled: c.busy,
    }),
  })
}

const confirmDialog = (
  name: string,
  options: { permission: string; variant: 'primary' | 'destructive'; message: string },
): RecordModalDialog<TemplateModalData> => ({
  title: (c) => t(c, name),
  view: (c) => RecordModalForm({ id: `product-${name}`, kind: c.kind, command: name, fields: [] }),
  confirmation: {
    message: (c) => (can(c, options.permission) ? t(c, options.message) : t(c, 'denied')),
    label: (c) => t(c, name),
    cancelLabel: (c) => t(c, 'cancel'),
    form: () => `product-${name}`,
    command: name,
    variant: options.variant,
    disabled: (c) => c.busy || !can(c, options.permission),
  },
})

/** A dialog opened from its address by a role that cannot use it explains why and offers no command. */
const guarded = (
  permission: (c: Context) => boolean,
  dialog: RecordModalDialog<TemplateModalData>,
): RecordModalDialog<TemplateModalData> => ({
  ...dialog,
  view: (c) =>
    permission(c)
      ? dialog.view(c)
      : Notice({ title: dialog.title(c), message: t(c, 'denied'), tone: 'warning' }),
  actions: (c) => (permission(c) ? (dialog.actions?.(c) ?? '') : ActionGroup({ actions: [closeButton(c)] })),
})

// ── Definition ───────────────────────────────────────────────────────────────

export const templateModalDefinition: RecordModalDefinition<TemplateModalData> = {
  kind: 'product.template',
  labels: () => TEMPLATE_RECORD_LABELS[pageLang()],
  size: 'large',
  context: {
    route: (id, creating) => {
      // A page opening afresh starts a fresh create; a retry keeps the id it minted.
      if (creating) createdTemplate.reset()
      duplicatedTemplate.reset()
      return `${PATH(creating ? 'new' : id)}/context?lang=${pageLang()}`
    },
    query: ['company', 'branch'],
  },
  title: (c) => (c.creating ? t(c, 'create') : c.data.record.name),
  status: (c) =>
    c.creating
      ? ''
      : Badge({ label: t(c, `status.${status(c)}`), tone: status(c) === 'active' ? 'positive' : 'neutral' }),
  body,
  pageAside: aside,
  pageAsideLabel: (c) => t(c, 'summary'),
  pageActions,
  actions: pageActions,
  dialogs: {
    duplicate: guarded((c) => can(c, 'duplicate') && editable(c), {
      title: (c) => t(c, 'duplicate'),
      size: 'small',
      view: (c) =>
        RecordModalForm({
          id: 'product-duplicate',
          kind: c.kind,
          command: 'duplicate',
          fields: [],
          body: Stack({
            items: [
              Text({ children: t(c, 'duplicateBody'), variant: 'bodyMd' }),
              Field({
                id: 'product-duplicate-name',
                name: 'name',
                label: t(c, 'duplicateName'),
                required: true,
                maxLength: 200,
                value: c.draft('name', t(c, 'copyName', { name: c.data.record.name })),
                error: c.fieldError('name'),
                disabled: c.busy,
              }),
            ],
          }),
        }),
      actions: (c) =>
        ActionGroup({
          actions: [closeButton(c), submitButton(c, 'product-duplicate', 'duplicate', t(c, 'duplicate'))],
        }),
    }),
    archive: confirmDialog('archive', {
      permission: 'archive',
      variant: 'destructive',
      message: 'archiveBody',
    }),
    restore: confirmDialog('restore', { permission: 'archive', variant: 'primary', message: 'restoreBody' }),
    addImage: guarded((c) => can(c, 'uploadImage'), {
      title: (c) => t(c, 'addImage'),
      size: 'small',
      view: (c) =>
        RecordModalForm({
          id: 'product-add-image',
          kind: c.kind,
          command: 'addImage',
          fields: [],
          body: DropZone({
            id: 'product-image-file',
            name: 'image',
            label: t(c, 'imageFile'),
            accept: 'image/png,image/jpeg,image/webp,image/gif',
            required: true,
            // The chosen file shows, with its name, before it is sent; the runtime
            // holds its object URL.
            ...(c.state('file:image')
              ? {
                  preview: { src: c.state('file:image'), alt: c.state('file:image:name') },
                  status: c.state('file:image:name'),
                }
              : {}),
            help: t(c, 'imageHelp'),
            error: c.fieldError('image'),
          }),
        }),
      actions: (c) =>
        ActionGroup({
          actions: [closeButton(c), submitButton(c, 'product-add-image', 'addImage', t(c, 'upload'))],
        }),
    }),
    removeImage: confirmDialog('removeImage', {
      permission: 'removeImage',
      variant: 'destructive',
      message: 'removeImageBody',
    }),
    editVariant: guarded((c) => can(c, 'saveVariantSetup') && Boolean(c.data.variantSetup), {
      title: (c) => `${t(c, 'editVariant')} · ${variantOf(c)?.label ?? ''}`,
      view: editVariantDialog,
      actions: (c) =>
        ActionGroup({
          actions: [
            closeButton(c),
            submitButton(c, 'product-edit-variant', 'editVariant', t(c, 'save'), !variantOf(c)),
          ],
        }),
    }),
    configureAttributes: guarded((c) => can(c, 'configureAttributes') && Boolean(c.data.variantSetup), {
      title: (c) => t(c, 'configureAttributes'),
      size: 'large',
      view: attributesDialog,
      actions: (c) =>
        ActionGroup({
          actions: [
            closeButton(c),
            submitButton(c, 'product-configure-attributes', 'configureAttributes', t(c, 'apply')),
          ],
        }),
    }),
    addPackaging: guarded((c) => can(c, 'addPackaging'), {
      title: (c) => t(c, 'addPackaging'),
      size: 'small',
      view: addPackagingDialog,
      actions: (c) =>
        ActionGroup({
          actions: [
            closeButton(c),
            (c.data.packagingChoices ?? []).length
              ? submitButton(c, 'product-add-packaging', 'addPackaging', t(c, 'addPackaging'))
              : '',
          ].filter(Boolean),
        }),
    }),
    packagingBarcode: guarded((c) => can(c, 'packagingBarcodes') && !c.data.hasVariants, {
      title: (c) => t(c, 'editPackagingBarcodeTitle', { name: packagingOf(c)?.name ?? '' }),
      size: 'small',
      view: packagingBarcodeDialog,
      actions: (c) =>
        ActionGroup({
          actions: [
            closeButton(c),
            submitButton(c, 'product-packaging-barcode', 'packagingBarcode', t(c, 'save'), !packagingOf(c)),
          ],
        }),
    }),
    removePackaging: confirmDialog('removePackaging', {
      permission: 'removePackaging',
      variant: 'destructive',
      message: 'removePackagingBody',
    }),
    levels: guarded((c) => can(c, 'orderpoints'), {
      title: (c) => t(c, 'levelsTitle', { warehouse: warehouseOf(c)?.name ?? '' }),
      view: levelsDialog,
      actions: (c) =>
        ActionGroup({
          actions: [
            closeButton(c),
            submitButton(c, 'product-levels', 'levels', t(c, 'save'), !warehouseOf(c)),
          ],
        }),
    }),
  },
  commands: {
    create: {
      fn: 'product.saveTemplate',
      input: (form, c) => ({
        id: createdTemplate.get(),
        name: text(form, 'name'),
        type: text(form, 'type') || 'goods',
        uomId: text(form, 'uomId') || null,
        categoryId: text(form, 'categoryId') || null,
        brandId: text(form, 'brandId') || null,
        description: text(form, 'description') || null,
        defaultCode: text(form, 'defaultCode') || null,
        barcode: text(form, 'barcode') || null,
        saleOk: checked(form, 'saleOk'),
        purchaseOk: checked(form, 'purchaseOk'),
        listPrice: numberOf(form, 'listPrice', c) ?? '0',
        compareAtPrice: numberOf(form, 'compareAtPrice', c),
        weight: numberOf(form, 'weight', c),
        volume: numberOf(form, 'volume', c),
        hsCode: text(form, 'hsCode') || null,
        origin: text(form, 'origin') || null,
      }),
      also: [
        {
          fn: 'product.setCost',
          when: (c, form) => seesMoney(c) && can(c, 'setCost') && numberOf(form, 'costPrice', c) !== null,
          input: (form, c) => ({
            productId: `${createdTemplate.get()}:default`,
            standardPrice: numberOf(form, 'costPrice', c),
          }),
        },
        {
          fn: 'stock.configureProduct',
          when: (c) => c.data.stockEnabled && can(c, 'configureStock'),
          input: (form) => ({
            templateId: createdTemplate.get(),
            isStorable: checked(form, 'isStorable'),
            tracking: text(form, 'tracking') || 'none',
          }),
        },
      ],
      issueField: (field) => (field === 'standardPrice' ? 'costPrice' : field),
      after: 'open',
      created: () => createdTemplate.take(),
    },
    save: {
      fn: 'product.saveTemplate',
      input: (form, c) => ({
        id: c.id,
        expectedRevisionId: c.data.record.revisionId,
        name: text(form, 'name'),
        type: text(form, 'type') || c.data.record.type,
        // A locked unit is not submitted: leaving it out keeps the one saved.
        ...(c.data.uomLocked ? {} : { uomId: text(form, 'uomId') || null }),
        categoryId: text(form, 'categoryId') || null,
        brandId: text(form, 'brandId') || null,
        description: text(form, 'description') || null,
        saleOk: checked(form, 'saleOk'),
        purchaseOk: checked(form, 'purchaseOk'),
        listPrice: numberOf(form, 'listPrice', c) ?? '0',
        compareAtPrice: numberOf(form, 'compareAtPrice', c),
        hsCode: text(form, 'hsCode') || null,
        origin: text(form, 'origin') || null,
        // With variants, each carries its own reference, barcode and measures.
        ...(c.data.hasVariants
          ? {}
          : {
              defaultCode: text(form, 'defaultCode') || null,
              barcode: text(form, 'barcode') || null,
              weight: numberOf(form, 'weight', c),
              volume: numberOf(form, 'volume', c),
            }),
      }),
      also: [
        {
          fn: 'product.setCost',
          when: (c, form) =>
            seesMoney(c) &&
            can(c, 'setCost') &&
            !c.data.hasVariants &&
            Boolean(c.data.record.defaultVariantId) &&
            changedCost(form, c, c.data.record.costPrice),
          input: (form, c) => ({
            productId: c.data.record.defaultVariantId,
            standardPrice: numberOf(form, 'costPrice', c),
          }),
        },
        {
          fn: 'stock.configureProduct',
          when: (c) => c.data.stockEnabled && can(c, 'configureStock'),
          input: (form, c) => ({
            templateId: c.id,
            isStorable: checked(form, 'isStorable'),
            tracking: text(form, 'tracking') || 'none',
          }),
        },
      ],
      issueField: (field) => (field === 'standardPrice' ? 'costPrice' : field),
      // A refusal may mean someone saved first: read the revision again, keep the typing.
      refreshOnRefusal: true,
      after: 'refresh',
    },
    duplicate: {
      fn: 'product.duplicateTemplate',
      input: (form, c) => ({
        id: duplicatedTemplate.get(),
        sourceId: c.id,
        name: text(form, 'name') || null,
      }),
      also: [
        {
          fn: 'stock.configureProduct',
          when: (c) => c.data.stockEnabled && can(c, 'configureStock'),
          input: (_form, c) => ({
            templateId: duplicatedTemplate.get(),
            isStorable: c.data.record.isStorable,
            tracking: c.data.record.tracking || 'none',
          }),
        },
      ],
      navigate: () => PATH(duplicatedTemplate.take() ?? ''),
    },
    archive: {
      fn: 'product.archiveTemplate',
      input: (_form, c) => ({
        id: c.id,
        active: false,
        expectedRevisionId: c.data.record.revisionId,
        confirmed: true,
      }),
      after: 'reload',
    },
    restore: {
      fn: 'product.archiveTemplate',
      input: (_form, c) => ({
        id: c.id,
        active: true,
        expectedRevisionId: c.data.record.revisionId,
        confirmed: true,
      }),
      after: 'reload',
    },
    // A new image becomes the cover; the others stay in the gallery behind it.
    addImage: {
      fn: 'product_media.attachMedia',
      upload: {
        image: (_form, c) => ({
          resModel: 'product.Template',
          resId: c.id,
          resField: 'media',
          public: 'false',
        }),
      },
      input: (_form, c, uploads) => ({
        id: uploads.image?.id ?? '',
        attachmentId: uploads.image?.id ?? '',
        templateId: c.id,
        alt: uploads.image?.name ?? null,
        primary: true,
      }),
      after: 'reload',
    },
    removeImage: {
      fn: 'product_media.removeMedia',
      input: (_form, c) => ({ id: c.dialog?.params.id ?? '' }),
      after: 'reload',
    },
    editVariant: {
      fn: 'product.saveVariantSetup',
      input: (form, c) =>
        setupWith(c, c.dialog?.params.id ?? '', {
          defaultCode: text(form, 'defaultCode') || null,
          barcode: text(form, 'barcode') || null,
          weight: numberOf(form, 'weight', c) ?? '0',
          volume: numberOf(form, 'volume', c) ?? '0',
          active: checked(form, 'active'),
        }),
      also: [
        {
          fn: 'product.setCost',
          when: (c, form) =>
            seesMoney(c) && can(c, 'setCost') && changedCost(form, c, variantOf(c)?.costPrice),
          input: (form, c) => ({
            productId: c.dialog?.params.id ?? '',
            standardPrice: numberOf(form, 'costPrice', c),
          }),
        },
        {
          fn: 'product.setPackagingBarcodes',
          when: (c, form) =>
            can(c, 'packagingBarcodes') &&
            (c.data.packagings ?? []).length > 0 &&
            packagingBarcodesChanged(form, c, variantOf(c)?.packagingBarcodes),
          input: (form, c) => ({ productId: c.dialog?.params.id ?? '', barcodes: packagingEntries(form, c) }),
        },
      ],
      // The setup names every variant by position; only the edited one is on this form.
      issueField: (field, form, c) => {
        if (field === 'standardPrice') return 'costPrice'
        const packaging = /^barcodes\.(\d+)\./u.exec(field)
        if (packaging) {
          const entry = packagingEntries(form, c)[Number(packaging[1])]
          return entry ? `packaging.${entry.uomId}` : field
        }
        const index = (c.data.variantSetup?.variants ?? []).findIndex((row) => row.id === c.dialog?.params.id)
        const match = /^variants\.(\d+)\.(\w+)/u.exec(field)
        return match && Number(match[1]) === index ? match[2]! : field
      },
      after: 'reload',
    },
    configureAttributes: {
      fn: 'product.configureAttributes',
      input: (form, c) => ({ templateId: c.id, lines: configureInput(form, c).lines }),
      issueField: (field, form, c) => configureInput(form, c).paths.get(field) ?? field,
      after: 'reload',
    },
    addPackaging: {
      fn: 'product.addTemplateUom',
      input: (form, c) => ({ templateId: c.id, uomId: text(form, 'uomId') }),
      also: [
        {
          fn: 'product.setPackagingBarcodes',
          when: (c, form) =>
            !c.data.hasVariants &&
            Boolean(c.data.record.defaultVariantId) &&
            can(c, 'packagingBarcodes') &&
            text(form, 'barcode') !== '',
          input: (form, c) => ({
            productId: c.data.record.defaultVariantId,
            barcodes: [{ uomId: text(form, 'uomId'), barcode: text(form, 'barcode') }],
          }),
        },
      ],
      issueField: (field) => (/^barcodes\.\d+\.barcode$/u.test(field) ? 'barcode' : field),
      after: 'reload',
    },
    packagingBarcode: {
      fn: 'product.setPackagingBarcodes',
      input: (form, c) => ({
        productId: c.data.record.defaultVariantId ?? '',
        barcodes: [{ uomId: c.dialog?.params.id ?? '', barcode: text(form, 'barcode') || null }],
      }),
      issueField: (field) => (/^barcodes\.\d+\.barcode$/u.test(field) ? 'barcode' : field),
      after: 'reload',
    },
    removePackaging: {
      fn: 'product.removeTemplateUom',
      input: (_form, c) => ({ templateId: c.id, uomId: c.dialog?.params.id ?? '' }),
      after: 'reload',
    },
    levels: {
      fn: 'stock.saveProductOrderpoints',
      input: (form, c) => ({
        templateId: c.id,
        warehouseId: c.dialog?.params.id ?? '',
        rules: levelProducts(c).map((product) => ({
          productId: product.id,
          minQuantity: numberOf(form, `min.${product.id}`, c),
          maxQuantity: numberOf(form, `max.${product.id}`, c),
        })),
      }),
      issueField: (field, _form, c) => {
        const match = /^rules\.(\d+)\.(minQuantity|maxQuantity)$/u.exec(field)
        const product = match ? levelProducts(c)[Number(match[1])] : undefined
        return product ? `${match![2] === 'minQuantity' ? 'min' : 'max'}.${product.id}` : field
      },
      after: 'reload',
    },
  },
}

export const templatePage = createRecordPage(templateModalDefinition, {
  path: (id) => PATH(id),
})
