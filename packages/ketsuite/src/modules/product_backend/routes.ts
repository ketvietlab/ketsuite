import { randomUUID } from 'node:crypto'
import {
  NAVIGATION_TYPE,
  encodeListState,
  fragment,
  json,
  parseListState,
  table,
  text,
  withHeaders,
} from '@ketvietlab/ketjs'
import type {
  FilterOperator,
  FilterRule,
  ListSearchSpec,
  ListState,
  RouteEntry,
  Route,
  ServeContext,
} from '@ketvietlab/ketjs'
import {
  attributesScreen,
  favoriteModal,
  productDetailScreen,
  productsScreen,
  templatePageScreen,
  VARIANT_DETAIL_TABS,
  variantScreen,
} from './screens/index.ts'
import { html, renderIsland, trustedMarkup } from '@ketvietlab/ketjs-view'
import type { SearchFilterConfig } from '@ketvietlab/design-system'
import { uomControl } from './relation-control.ts'
import { productWorkspaceContext } from './modal/product-workspace-context.ts'
import type { VariantDetailTab } from './screens/index.ts'
import { unitRoutes } from './units/routes.ts'
import type { AttributeListRow } from './screens/attributes.tsx'
import { attributeSearchFilterConfig } from './attributes-search.ts'
import { listSearchFilterConfig, loadListFavorites, searchFilterBar } from '../backend/search-filter.ts'
import { backendPage } from '../../ui/index.ts'
import {
  RECORD_NEW_ID,
  RECORD_TAB_PARAM,
  readRecordModalTarget,
  recordModalCreateHref,
} from '../../ui/record-modal.tsx'
import { receiveAttachment, serveAttachment } from '../storage/routes.ts'
import type { Attachment } from '../storage/routes.ts'
import { productImageUrl } from '../../ui/client/product-image.ts'
import { errorsOf, readForm, seeOther } from '../backend/forms.ts'
import { PRODUCT_LIST_PAGE_SIZE, productListShape } from './list/read.ts'
import { PRODUCT_LIST_KEY, productList, productListControls, productListFooter } from './list/island.tsx'
import type { ProductListProps } from './list/island.tsx'
import { LIST_LABEL_KEYS } from './list/messages.ts'
import { adminPage, frameOf, inLocale, jointFor, localeQuery, timezoneOf } from '../backend/screen.ts'

type MediaRow = {
  id: string
  attachmentId: string
  templateId?: string | null
  productId?: string | null
  alt?: string | null
  primary: boolean
  attachment?: { name?: string; mimetype?: string }
}
type AnyVariant = Record<string, unknown> | null

const crossSite = (req: Parameters<Route>[1]): boolean => {
  const origin = req.headers.origin as string | undefined
  if (!origin) return false
  try {
    return new URL(origin).host !== String(req.headers.host ?? '')
  } catch {
    return true
  }
}

/**
 * The two things every mutating route here has to establish before it reads a form.
 *
 * The admin authenticates with a session cookie, so a POST that arrives from
 * another origin carries the signed-in user's credentials without their intent —
 * which is why every write in this module refuses one, the same way user_backend,
 * company_backend and oauth_backend do.
 */
const refusePost = (req: Parameters<Route>[1], accepts = 'POST') =>
  req.method !== 'POST'
    ? text(accepts, { status: 405 })
    : crossSite(req)
      ? text('Forbidden', { status: 403 })
      : null

const productTabOf = (url: URL): string => url.searchParams.get('tab') || 'general'
const MEDIA_VARIANT_PAGE_SIZE = 25
const positivePage = (value: string | null): number => {
  const page = Number.parseInt(value ?? '1', 10)
  return Number.isFinite(page) && page > 0 ? page : 1
}
const requestedVariantMediaPage = (url: URL): number => {
  return positivePage(url.searchParams.get('variantPage'))
}
const variantTabOf = (url: URL): VariantDetailTab => {
  const asked = url.searchParams.get('tab')
  return (VARIANT_DETAIL_TABS as readonly string[]).includes(asked ?? '')
    ? (asked as VariantDetailTab)
    : 'general'
}
const isProductPartial = (req: Parameters<Route>[1], scope = 'product-detail'): boolean =>
  req.headers['x-ket-partial'] === scope
// A template's own page; `new` is its create form.
const templatePageHref = (url: URL, id: string, tab?: string | null): string =>
  inLocale(
    url,
    `/admin/product/templates/${encodeURIComponent(id)}${tab ? `?${RECORD_TAB_PARAM}=${encodeURIComponent(tab)}` : ''}`,
  )
/**
 * The way back from a product's page: the list the reader opened it from, with its
 * filters and the row it named (`#row=<id>`), when that is this catalogue.
 */
const listReturnOf = (url: URL): string => {
  const raw = url.searchParams.get('returnTo')
  if (raw) {
    const target = new URL(raw, 'http://ket.local')
    if (target.origin === 'http://ket.local' && target.pathname === '/admin/product/templates')
      return `${target.pathname}${target.search}${target.hash}`
  }
  return inLocale(url, '/admin/product/templates')
}
const seeProduct = (id: string, url: URL, tab: string = productTabOf(url)) =>
  withHeaders(text('', { status: 303 }), {
    location: inLocale(url, `/admin/product/templates/${id}?tab=${tab}`),
  })
const seeVariant = (
  templateId: string,
  productId: string,
  url: URL,
  tab: VariantDetailTab = variantTabOf(url),
) => seeOther(inLocale(url, `/admin/product/templates/${templateId}/variants/${productId}?tab=${tab}`))

const optionsFor = async (ctx: ServeContext, url: URL, req: Parameters<Route>[1]) => {
  const [units, categories, attributes, brands] = (await Promise.all([
    ctx.call('uom.listUnits', {}, url, req),
    ctx.call('product.listCategories', {}, url, req),
    ctx.call('product.listAttributes', {}, url, req),
    ctx.call('product.listBrands', {}, url, req),
  ])) as [
    Array<Record<string, unknown>>,
    Array<Record<string, unknown>>,
    Array<Record<string, unknown>>,
    Array<Record<string, unknown>>,
  ]
  const variantAttributes = attributes.filter((row) => row.createVariant !== 'no_variant')
  return {
    // Kept raw alongside the options so a caller can reach `parentPath` and work
    // out which unit tree a template sits in.
    unitRows: units,
    uoms: units.map((row) => ({ value: String(row.id), label: String(row.name) })),
    categories: categories.map((row) => ({
      value: String(row.id),
      label: String(row.name),
      // The ancestry, so two "Shirts" under different parents stay distinguishable.
      description: row.path == null ? null : String(row.path),
    })),
    brands: brands.map((row) => ({ value: String(row.id), label: String(row.name) })),
    variantAttributes: variantAttributes.map((row) => ({
      value: String(row.id),
      label: String(row.name),
    })),
    // Values come nested inside their attribute here, and carry the attribute's
    // name as their description — the value picker spans every attribute, so
    // "Đỏ" on its own would not say which attribute it belongs to.
    attributeValues: variantAttributes.flatMap((attribute) =>
      (Array.isArray(attribute.values) ? (attribute.values as Array<Record<string, unknown>>) : []).map(
        (value) => ({
          value: String(value.id),
          label: String(value.name),
          description: String(attribute.name),
        }),
      ),
    ),
  }
}

/**
 * The root of the unit tree a template's default unit belongs to.
 *
 * A variant's unit is refused unless it shares this root, so the picker is given
 * the root and offers nothing that would be rejected.
 */
const unitRootOf = (units: Array<Record<string, unknown>>, uomId: unknown): string | null => {
  if (uomId == null) return null
  const unit = units.find((row) => String(row.id) === String(uomId))
  return unit ? (String(unit.parentPath).split('/').filter(Boolean)[0] ?? null) : null
}

const invalidErrors = (url: URL, _: ReturnType<ServeContext['translate']>) =>
  url.searchParams.has('invalid') ? [_('product_backend.error.invalid')] : undefined

const cloneState = (state: ListState): ListState => ({
  ...state,
  presets: [...state.presets],
  filters: [...state.filters],
  groupBy: [...state.groupBy],
  sort: [...state.sort],
  openGroups: state.openGroups.map((path) => [...path]),
  groupPages: { ...state.groupPages },
})

const customRuleOf = (url: URL, spec: ListSearchSpec): FilterRule | null => {
  if (url.searchParams.get('applyFilter') !== '1') return null
  const field = spec.filterable?.find((candidate) => candidate.key === url.searchParams.get('filterField'))
  const operator = url.searchParams.get('filterOp') as FilterOperator | null
  if (!field || !operator) return null
  const raw = url.searchParams.get('filterValue') ?? ''
  const noValue = ['isTrue', 'isFalse', 'isSet', 'isNotSet'].includes(operator)
  const value = noValue
    ? undefined
    : operator === 'anyOf'
      ? raw
          .split(',')
          .map((item) => item.trim())
          .filter(Boolean)
      : operator === 'between'
        ? raw.split(',').map((item) => (field.type === 'number' ? Number(item.trim()) : item.trim()))
        : field.type === 'number'
          ? Number(raw)
          : raw
  return { kind: 'rule', field: field.key, operator, ...(noValue ? {} : { value }) }
}

const productFieldLabel = (
  _: ReturnType<ServeContext['translate']>,
  key: string,
  fallback: string,
): string => {
  const message = (
    {
      type: 'product_backend.field.type',
      categoryId: 'product_backend.field.category',
      uomId: 'product_backend.field.uom',
      active: 'product_backend.field.active',
      saleOk: 'product_backend.field.saleOk',
      purchaseOk: 'product_backend.field.purchaseOk',
      createdAt: 'product_backend.field.createdAt',
      updatedAt: 'product_backend.field.updatedAt',
      name: 'product_backend.field.name',
      description: 'product_backend.field.description',
      listPrice: 'product_backend.field.listPrice',
    } as Record<string, string>
  )[key]
  return message && _.resolves(message) ? _(message) : fallback
}

const mediaFor = (ctx: ServeContext, url: URL, req: Parameters<Route>[1], templateId: string) =>
  ctx.call('product_media.listMedia', { templateId }, url, req) as Promise<MediaRow[]>

const variantMediaFor = (ctx: ServeContext, url: URL, req: Parameters<Route>[1], productId: string) =>
  ctx.call('product_media.listMedia', { productId }, url, req) as Promise<MediaRow[]>

const ownsMedia = async (
  ctx: ServeContext,
  url: URL,
  req: Parameters<Route>[1],
  templateId: string,
  mediaId: string,
) => (await mediaFor(ctx, url, req, templateId)).some((row) => row.id === mediaId)

const ownsVariantMedia = async (
  ctx: ServeContext,
  url: URL,
  req: Parameters<Route>[1],
  productId: string,
  mediaId: string,
) => (await variantMediaFor(ctx, url, req, productId)).some((row) => row.id === mediaId)

/**
 * The catalogue screen.
 *
 * A route of this module, not of backend — the bridge owns the page it links to,
 * so installing the admin without the catalogue leaves neither the entry nor the
 * page behind. Closed by default, like every module route: a stranger gets the
 * sign-in page.
 *
 * Everything the list is doing — which page, which search, which view — is in the
 * URL. Nothing here holds state between requests.
 */
export const routes: Record<string, RouteEntry> = {
  ...unitRoutes,
  // A product's image, for whoever may see product images (ui/client/product-image.ts).
  // Anything else, and any file no product image links, is not found: the same answer
  // for a refusal as for a miss, so the route says nothing about other files.
  '/admin/product/images/{id}':
    (ctx: ServeContext): Route =>
    async (url, req, params) => {
      if (req.method !== 'GET' && req.method !== 'HEAD') return text('GET or HEAD', { status: 405 })
      if (!(await ctx.allows('product_media.getMediaAttachment', url, req)))
        return text('not found', { status: 404 })
      const { attachment } = (await ctx.call(
        'product_media.getMediaAttachment',
        { attachmentId: params.id },
        url,
        req,
      )) as { attachment: Attachment | null }
      if (!attachment) return text('not found', { status: 404 })
      return serveAttachment(ctx, url, req, attachment)
    },
  '/admin/product/templates':
    (ctx: ServeContext): Route =>
    async (url, req) => {
      // Templates used to open in a record modal over this list; their links now open the page.
      const legacy = readRecordModalTarget(url)
      if (legacy?.kind === 'product.template') return seeOther(templatePageHref(url, legacy.id, legacy.tab))
      const lang = ctx.localeOf(url, req)
      const _ = ctx.translate(lang)
      const live = (await ctx.live(req)).functions
      // `live` is the same for every viewer; what this one may do is their allow-list.
      const may = async (name: string) => Boolean(live[name]) && (await ctx.allows(name, url, req))
      // Stock answers the list for a viewer who may read it, and adds its column; a
      // viewer or an installation without stock gets the catalogue's own read.
      const read = (await may('stock_backend.searchProductTemplates'))
        ? 'stock_backend.searchProductTemplates'
        : 'product_backend.searchTemplates'
      const spec = productListShape(
        table(ctx.manifest, 'product.Template'),
        read.startsWith('stock_backend.'),
      )
      const parsed = parseListState(spec, url)
      const favorites = await loadListFavorites(ctx, url, req, spec, cloneState(parsed.state))
      const hasExpandedState = ['q', 'preset', 'filter', 'group', 'sort', 'archived'].some((key) =>
        url.searchParams.has(key),
      )
      const selectedFavorite = favorites.find((favorite) => favorite.id === parsed.state.favoriteId)
      const defaultFavorite = favorites.find((favorite) => favorite.defaultKey)
      const favoriteToExpand = !hasExpandedState
        ? (selectedFavorite ?? (!url.searchParams.has('favorite') ? defaultFavorite : undefined))
        : undefined
      if (favoriteToExpand) {
        const next: ListState = {
          ...cloneState(parsed.state),
          ...favoriteToExpand.state,
          presets: [...(favoriteToExpand.state.presets ?? [])],
          filters: [...(favoriteToExpand.state.filters ?? [])],
          groupBy: [...(favoriteToExpand.state.groupBy ?? [])],
          sort: [...(favoriteToExpand.state.sort ?? spec.defaultSort ?? [])],
          page: 1,
          openGroups: [],
          groupPages: {},
          favoriteId: favoriteToExpand.id,
        }
        return withHeaders(text('', { status: 303 }), { location: encodeListState(next, url) })
      }
      const customRule = customRuleOf(url, spec)
      if (customRule) {
        const next = cloneState(parsed.state)
        next.filters.push(customRule)
        next.page = 1
        const clean = new URL(url)
        for (const key of ['filterField', 'filterOp', 'filterValue', 'applyFilter'])
          clean.searchParams.delete(key)
        return withHeaders(text('', { status: 303 }), { location: encodeListState(next, clean) })
      }
      const state = parsed.state
      const timezone = await timezoneOf(ctx, url, req)
      // The bar's choices name categories and units, not their ids.
      const [categoryRows, unitRows] = (await Promise.all([
        ctx.call('product.listCategories', {}, url, req),
        ctx.call('uom.listUnits', {}, url, req),
      ])) as [Array<Record<string, unknown>>, Array<Record<string, unknown>>]
      const categoryMap = new Map<string, string>()
      const collectCategories = (items: Array<Record<string, unknown>>) => {
        for (const item of items) {
          categoryMap.set(String(item.id), String(item.name))
          if (Array.isArray(item.children)) collectCategories(item.children as Array<Record<string, unknown>>)
        }
      }
      collectCategories(categoryRows)
      const unitMap = new Map(unitRows.map((row) => [String(row.id), String(row.name)]))
      const extensionActions = await ctx.joint(url, req, 'product_backend:catalogue.actions', {
        locale: localeQuery(url),
      })
      // What the island reads with: the list's own URL, less the route modal over it.
      const listUrl = new URL(url)
      for (const key of ['modal', 'favoriteError']) listUrl.searchParams.delete(key)
      const listHref = `${listUrl.pathname}${listUrl.search}`
      return adminPage(ctx, url, req, {
        title: 'product_backend.screen.title',
        body: async (_, frame) => {
          const groupLabels: Record<string, string> = {
            type: _('product_backend.list.group.type'),
            state: _('product_backend.list.group.state'),
            stock: _('product_backend.list.group.state'),
          }
          const config = listSearchFilterConfig(_, {
            name: 'product-template-filter',
            favoriteHref: (() => {
              const next = new URL(url)
              next.searchParams.set('modal', 'favorite')
              return `${next.pathname}${next.search}`
            })(),
            fieldChoices: {
              type: ['goods', 'service'].map((value) => ({
                value,
                label: _(`product_backend.type.${value}`),
              })),
              categoryId: [...categoryMap].map(([value, label]) => ({ value, label })),
              uomId: [...unitMap].map(([value, label]) => ({ value, label })),
            },
            bodyId: 'product-template-list',
            spec,
            state,
            favorites,
            fieldLabel: (key, fallback) => productFieldLabel(_, key, fallback),
            presetLabel: (key, fallback) =>
              key === 'goods' || key === 'service'
                ? _(`product_backend.type.${key}`)
                : key === 'outOfStock'
                  ? _('product_backend.list.preset.outOfStock')
                  : productFieldLabel(_, key === 'sale' ? 'saleOk' : 'purchaseOk', fallback),
            labels: {
              searchLabel: _('product_backend.search.label'),
              searchPlaceholder: _('product_backend.chrome.search'),
            },
            applyInput: { listKey: spec.key, returnTo: listHref },
            functions: {
              apply: 'product_backend.applySearchFilter',
              saveFavorite: 'product_backend.saveSearchFavorite',
              deleteFavorite: 'product_backend.deleteSearchFavorite',
              setDefaultFavorite: 'product_backend.setDefaultSearchFavorite',
            },
          })
          // Expanded and applied as it changes, like every list; typed text stays in the field.
          const search: SearchFilterConfig = {
            ...config,
            presentation: 'expanded',
            applyOnInput: true,
            size: 'default',
            query: state.q ?? '',
            facets: config.facets.filter((facet) => facet.type !== 'field'),
            filters: config.filters.map((option) => {
              // Out of stock, sold and purchased read as states of the product, beside
              // "Include archived", so the bar keeps the mock's Type and Status choices.
              const group = ['stock', 'sale', 'purchase'].includes(String(option.group))
                ? 'state'
                : option.group
              return {
                ...option,
                ...(group
                  ? { group, ...(groupLabels[group] ? { groupLabel: groupLabels[group] } : {}) }
                  : {}),
              }
            }),
          }
          const labels = {
            ...Object.fromEntries(LIST_LABEL_KEYS.map((key) => [key, _(`product_backend.list.${key}`)])),
            region: _('backend.table.results'),
            selectAll: _('backend.table.selectAll'),
            selectRow: _('backend.table.selectRow'),
            sortedAscending: _('product_backend.table.sortAscending'),
            sortedDescending: _('product_backend.table.sortDescending'),
            previousPage: _('backend.chrome.previous'),
            nextPage: _('backend.chrome.next'),
            loading: _('backend.relation.loading'),
            loadError: _('backend.error.failed.title'),
            retry: _('backend.relation.retry'),
            empty: _('product_backend.screen.empty.message'),
            emptyHint: _('product_backend.screen.empty.hint'),
            typeGoods: _('product_backend.type.goods'),
            typeService: _('product_backend.type.service'),
            create: _('product_backend.create.title'),
          }
          // Who may not create or archive is offered no way to start, rather than a refusal at the end.
          const [canCreate, canArchive, canDelete, images] = await Promise.all([
            may('product.saveTemplate'),
            may('product.archiveTemplate'),
            may('product.deleteTemplates'),
            may('product_media.getMediaAttachment'),
          ])
          const createHref = canCreate ? templatePageHref(url, RECORD_NEW_ID) : null
          const bulk =
            canArchive || canDelete
              ? {
                  action: inLocale(url, '/admin/product/templates/bulk'),
                  archive: canArchive,
                  delete: canDelete,
                }
              : null
          const listProps: ProductListProps = {
            read,
            href: listHref,
            timezone,
            lang: _.locale === 'en' ? 'en' : 'vi',
            pageSize: PRODUCT_LIST_PAGE_SIZE,
            labels: labels as ProductListProps['labels'],
            search,
            createHref,
            bulk,
            images,
          }
          // Three islands over one store, each in its slot of the page (list/island.tsx).
          const part = (name: string, controller: typeof productList) =>
            html`${trustedMarkup(renderIsland(name, controller, listProps, { tag: 'div', key: PRODUCT_LIST_KEY }))}`
          const islands = {
            controls: part('product.template-list-controls', productListControls),
            body: part('product.template-list', productList),
            footer: part('product.template-list-footer', productListFooter),
          }
          const returnUrl = new URL(url)
          returnUrl.searchParams.delete('modal')
          returnUrl.searchParams.delete('favoriteError')
          const favoriteOverlay =
            url.searchParams.get('modal') === 'favorite'
              ? favoriteModal(
                  _,
                  `${returnUrl.pathname}${returnUrl.search}`,
                  localeQuery(url),
                  url.searchParams.has('favoriteError') ? [_('product_backend.favorite.invalid')] : undefined,
                )
              : undefined
          // The route modal belongs inside backend.content so fragment open/close replaces it too.
          return productsScreen(
            _,
            {
              ...frame,
              chrome: createHref
                ? { create: { label: _('product_backend.create.title'), path: createHref } }
                : {},
            },
            islands,
            extensionActions,
            favoriteOverlay,
            _.locale === 'en' ? 'en' : 'vi',
          )
        },
      })
    },
  '/admin/product/templates/bulk':
    (ctx: ServeContext): Route =>
    async (url, req) => {
      const denied = refusePost(req)
      if (denied) return denied
      const form = await readForm(req)
      const ids = Object.keys(form)
        .filter((key) => key.startsWith('selected.'))
        .map((key) => key.slice('selected.'.length))
        .filter(Boolean)
      const fallback = inLocale(url, '/admin/product/templates')
      const returnTo = form.returnTo?.startsWith('/admin/product/templates') ? form.returnTo : fallback
      if (!ids.length) return seeOther(returnTo)
      if (form.action === 'archive') {
        for (const id of ids) {
          const current = (await ctx.call('product.getTemplate', { id }, url, req)) as { revisionId?: string }
          await ctx.call(
            'product.archiveTemplate',
            { id, active: false, expectedRevisionId: current.revisionId ?? 'initial', confirmed: true },
            url,
            req,
          )
        }
        return seeOther(returnTo)
      }
      if (form.action === 'delete') {
        try {
          await ctx.call('product.deleteTemplates', { ids }, url, req)
          return seeOther(returnTo)
        } catch {
          const failed = new URL(returnTo, 'http://ket.local')
          failed.searchParams.set('bulkError', 'delete')
          return seeOther(`${failed.pathname}${failed.search}`)
        }
      }
      return text('Unknown bulk action', { status: 400 })
    },
  '/admin/product/templates/favorites/new':
    (ctx: ServeContext): Route =>
    async (url, req) => {
      const lang = ctx.localeOf(url, req)
      const _ = ctx.translate(lang)
      if (req.method !== 'GET' && req.method !== 'POST') return text('GET or POST', { status: 405 })
      // Refused before the body is read, not after.
      if (req.method === 'POST' && crossSite(req)) return text('Forbidden', { status: 403 })
      const form = req.method === 'POST' ? await readForm(req) : null
      const rawReturn = form?.returnTo ?? url.searchParams.get('returnTo') ?? '/admin/product/templates'
      const source = new URL(rawReturn, 'http://ket.local')
      const target =
        source.pathname === '/admin/product/templates'
          ? source
          : new URL('/admin/product/templates', 'http://ket.local')
      if (!target.searchParams.has('lang')) target.searchParams.set('lang', lang)
      const returnTo = `${target.pathname}${target.search}`
      const modalHref = (invalid = false) => {
        const target = new URL(returnTo, 'http://ket.local')
        target.searchParams.set('modal', 'favorite')
        if (invalid) target.searchParams.set('favoriteError', '1')
        return `${target.pathname}${target.search}`
      }
      if (req.method === 'POST') {
        const spec = productListShape(
          table(ctx.manifest, 'product.Template'),
          Boolean(ctx.manifest.functions['stock_backend.searchProductTemplates']),
        )
        const state = parseListState(spec, new URL(returnTo, 'http://ket.local')).state
        const id = randomUUID()
        const result = (await ctx.callUnchecked(
          'backend.saveSavedSearch',
          {
            id,
            listKey: spec.key,
            name: form?.name ?? '',
            state,
            default: form?.default === '1',
          },
          url,
          req,
        )) as { ok?: boolean }
        if (result.ok) {
          state.favoriteId = id
          return seeOther(encodeListState(state, new URL(returnTo, 'http://ket.local')))
        }
        return seeOther(modalHref(true))
      }
      return seeOther(modalHref())
    },
  '/admin/product/attributes':
    (ctx: ServeContext): Route =>
    async (url, req) => {
      const lang = ctx.localeOf(url, req)
      const _ = ctx.translate(lang)
      if (req.method === 'POST') {
        if (crossSite(req)) return text('Forbidden', { status: 403 })
        const form = await readForm(req)
        const name = form.name?.trim()
        if (!name) return seeOther(inLocale(url, '/admin/product/attributes?invalid=1'))
        const result = await ctx.call(
          'product.saveAttribute',
          {
            id: randomUUID(),
            name,
            sequence: Number(form.sequence || 10),
            displayType: form.displayType || 'radio',
            createVariant: form.createVariant || 'always',
            active: true,
          },
          url,
          req,
        )
        return (result as { ok?: boolean }).ok
          ? seeOther(inLocale(url, '/admin/product/attributes'))
          : seeOther(inLocale(url, '/admin/product/attributes?invalid=1'))
      }
      if (req.method !== 'GET') return text('GET or POST', { status: 405 })
      const rows = (await ctx.call('product.listAttributes', {}, url, req)) as AttributeListRow[]
      const live = await ctx.live(req)
      // `live` is the same for every viewer: whether this one may create is their allow-list.
      const canCreate =
        Boolean(live.functions['product.saveAttributeDraft']) &&
        (await ctx.allows('product.saveAttributeDraft', url, req))
      const filterBar = await searchFilterBar(
        ctx,
        url,
        req,
        'product-attribute-filter',
        attributeSearchFilterConfig(_, url),
      )
      return adminPage(ctx, url, req, {
        title: 'product_backend.attributes.title',
        body: (_, frame) =>
          attributesScreen(
            _,
            rows,
            {
              ...frame,
              collectionUrl: url.pathname + url.search,
              chrome: {
                ...frame.chrome,
                searchContent: filterBar,
                create: canCreate
                  ? {
                      label: _('product_backend.attributes.createTitle'),
                      path: recordModalCreateHref(url, { kind: 'product.attribute' }),
                    }
                  : null,
              },
            },
            invalidErrors(url, _),
            localeQuery(url),
          ),
      })
    },
  '/admin/product/attributes/{id}/values':
    (ctx: ServeContext): Route =>
    async (url, req, params) => {
      const denied = refusePost(req)
      if (denied) return denied
      const form = await readForm(req)
      const name = form.name?.trim()
      if (!name) return seeOther(inLocale(url, '/admin/product/attributes?invalid=1'))
      const result = await ctx.call(
        'product.saveAttributeValue',
        {
          id: randomUUID(),
          attributeId: params.id,
          name,
          sequence: Number(form.sequence || 10),
        },
        url,
        req,
      )
      return (result as { ok?: boolean }).ok
        ? seeOther(inLocale(url, '/admin/product/attributes'))
        : seeOther(inLocale(url, '/admin/product/attributes?invalid=1'))
    },
  '/admin/product/templates/{id}/context': productWorkspaceContext,
  '/admin/product/templates/{id}':
    (ctx: ServeContext): Route =>
    async (url, req, params) => {
      // General and Variants are the template's record page, rendered client side
      // (`product.template-page`); Media is still a server-rendered page, which the
      // record does not cover yet (see product_backend/modal/product-modal-view.tsx).
      if (req.method !== 'GET') return text('GET', { status: 405 })
      const askedTab = productTabOf(url)
      const lang = ctx.localeOf(url, req)
      const _ = ctx.translate(lang)
      if (askedTab !== 'media') {
        const creating = params.id === RECORD_NEW_ID
        const found = creating
          ? null
          : ((await ctx.call('product.getTemplate', { id: params.id }, url, req)) as { name: string } | null)
        if (!creating && !found) return text('Product not found', { status: 404 })
        const title = found ? found.name : _('product_backend.create.title')
        const island = await ctx.joint(url, req, 'product_backend:template.page', {
          id: params.id,
          tab: askedTab === 'variants' && !creating ? 'variants' : 'general',
          title,
          loading: _('backend.relation.loading'),
          back: listReturnOf(url),
          // The page is wide new or saved (`size: 'large'`), so loading does not shift it.
          width: 'wide',
        })
        return backendPage(ctx, req, {
          lang,
          title,
          body: templatePageScreen(
            _,
            title,
            island,
            await frameOf(ctx, url, req),
            lang === 'en' ? 'en' : 'vi',
          ),
        })
      }
      const locale = localeQuery(url)
      const row = (await ctx.call('product.getTemplate', { id: params.id }, url, req)) as {
        id: string
        name: string
        type: string
        description?: string | null
        listPrice: number
        uomId: string | null
        active?: boolean
      } | null
      if (!row) return text('Product not found', { status: 404 })
      const listedVariants = (await ctx.call(
        'product.listVariants',
        { templateId: row.id },
        url,
        req,
      )) as Array<{
        id: string
        name?: string | null
        defaultCode?: string | null
        barcode?: string | null
        combinationKey?: string | null
        active?: boolean
        values?: Array<{ value?: string | null; attribute?: string | null }>
      }>
      const variants = listedVariants.filter((variant) => String(variant.combinationKey ?? '') !== '')
      const [mediaRows] = await Promise.all([mediaFor(ctx, url, req, row.id)])
      const variantMediaPageCount = Math.max(1, Math.ceil(variants.length / MEDIA_VARIANT_PAGE_SIZE))
      const variantMediaPage = Math.min(requestedVariantMediaPage(url), variantMediaPageCount)
      const variantMediaStart = (variantMediaPage - 1) * MEDIA_VARIANT_PAGE_SIZE
      const visibleMediaVariants = variants.slice(
        variantMediaStart,
        variantMediaStart + MEDIA_VARIANT_PAGE_SIZE,
      )
      const variantMediaRows = (await ctx.call(
        'product_media.listMediaByProducts',
        { productIds: visibleMediaVariants.map((variant) => variant.id) },
        url,
        req,
      )) as MediaRow[]
      const variantMedia = visibleMediaVariants.map((variant) => ({
        variantId: variant.id,
        images: variantMediaRows
          .filter((image) => image.productId === variant.id)
          .map((image) => ({
            id: image.id,
            src: productImageUrl(String(image.attachmentId)),
            alt: image.alt || image.attachment?.name || variant.defaultCode || variant.name || variant.id,
            primary: image.primary,
            actions: {
              remove: inLocale(
                url,
                `/admin/product/templates/${row.id}/variants/${variant.id}/media/${image.id}/remove?tab=media`,
              ),
            },
          })),
      }))
      const body = productDetailScreen(
        _,
        { ...row, defaultCode: null, barcode: null },
        {
          status: 'ready',
          uploadAction: inLocale(url, `/admin/product/templates/${row.id}/media?tab=media`),
          uploadControl: await ctx.joint(url, req, 'product_backend:media.upload', {
            identity: `template:${row.id}`,
            action: inLocale(url, `/admin/product/templates/${row.id}/media?tab=media`),
            label: _('product_backend.media.add'),
          }),
          images: mediaRows.map((image, index) => ({
            id: image.id,
            src: productImageUrl(String(image.attachmentId)),
            alt: image.alt || image.attachment?.name || row.name,
            primary: image.primary,
            actions: {
              primary: inLocale(
                url,
                `/admin/product/templates/${row.id}/media/${image.id}/primary?tab=media`,
              ),
              remove: inLocale(url, `/admin/product/templates/${row.id}/media/${image.id}/remove?tab=media`),
              ...(index > 0
                ? {
                    moveUp: inLocale(
                      url,
                      `/admin/product/templates/${row.id}/media/${image.id}/move-up?tab=media`,
                    ),
                  }
                : {}),
              ...(index + 1 < mediaRows.length
                ? {
                    moveDown: inLocale(
                      url,
                      `/admin/product/templates/${row.id}/media/${image.id}/move-down?tab=media`,
                    ),
                  }
                : {}),
            },
          })),
          extension: await ctx.joint(url, req, 'product_backend:template.media', { templateId: row.id }),
        },
        {
          uoms: [],
          categories: [],
          brands: [],
          variantAttributes: [],
          // The media panel renders exactly the `variants` it is given — the
          // caller does the paging, unlike the variants tab's own table.
          variants: visibleMediaVariants,
          attributeLines: [],
          variantMedia,
          variantMediaPage: {
            page: variantMediaPage,
            pageSize: MEDIA_VARIANT_PAGE_SIZE,
            total: variants.length,
          },
        },
        await jointFor(ctx, url, req, 'product_backend:template.collaboration', {
          resModel: 'product.Template',
          resId: row.id,
          lang,
        }),
        await frameOf(ctx, url, req),
        locale,
        'media',
        false,
      )
      return backendPage(ctx, req, { lang, title: row.name, body })
    },
  '/admin/product/templates/{id}/variants/{variantId}':
    (ctx: ServeContext): Route =>
    async (url, req, params) => {
      const lang = ctx.localeOf(url, req)
      const _ = ctx.translate(lang)
      const activeTab = variantTabOf(url)
      const existing = (await ctx.call('product.getVariant', { id: params.variantId }, url, req)) as Record<
        string,
        unknown
      > | null
      if (!existing || existing.templateId !== params.id) return text('Variant not found', { status: 404 })
      let savedPartial = false
      if (req.method === 'POST') {
        if (crossSite(req)) return text('Forbidden', { status: 403 })
        const partial = isProductPartial(req, 'product-variant')
        const form = await readForm(req)
        const saved = await ctx.call(
          'product.saveVariant',
          {
            id: params.variantId,
            templateId: params.id,
            defaultCode: form.defaultCode || null,
            barcode: form.barcode || null,
            weight: form.weight || '0',
            volume: form.volume || '0',
          },
          url,
          req,
        )
        if (!(saved as { ok?: boolean }).ok) {
          if (partial)
            return json(
              { ok: false, message: _('product_backend.error.invalid'), errors: errorsOf(saved) },
              { status: 422 },
            )
          return seeOther(
            inLocale(url, `/admin/product/templates/${params.id}/variants/${params.variantId}?invalid=1`),
          )
        }
        // The cost field renders only for `product.cost`. A form without it
        // leaves the cost alone instead of writing zero over it.
        const cost =
          'standardPrice' in form
            ? await ctx.call(
                'product.setCost',
                { productId: params.variantId, standardPrice: form.standardPrice || '0' },
                url,
                req,
              )
            : { ok: true }
        if (!(cost as { ok?: boolean }).ok) {
          if (partial)
            return json(
              { ok: false, message: _('product_backend.error.invalid'), errors: errorsOf(cost) },
              { status: 422 },
            )
          return seeOther(
            inLocale(url, `/admin/product/templates/${params.id}/variants/${params.variantId}?invalid=1`),
          )
        }
        {
          // The form's unit is a single select, so the submission replaces what
          // the variant has rather than adding to it — and an empty selection
          // clears it. Adding would leave the previous unit in place, and the
          // form would go on showing it.
          const productUom = await ctx.call(
            'product.setProductUom',
            {
              productId: params.variantId,
              uomId: form.uomId || null,
              barcode: form.uomBarcode || null,
            },
            url,
            req,
          )
          if (!(productUom as { ok?: boolean }).ok) {
            if (partial)
              return json(
                {
                  ok: false,
                  message: _('product_backend.error.invalid'),
                  errors: errorsOf(productUom),
                },
                { status: 422 },
              )
            return seeOther(
              inLocale(url, `/admin/product/templates/${params.id}/variants/${params.variantId}?invalid=1`),
            )
          }
        }
        if (!partial) return seeVariant(params.id, params.variantId, url, activeTab)
        savedPartial = true
      }
      if (req.method !== 'GET' && !savedPartial) return text('GET or POST', { status: 405 })
      const [current, template, options, mediaRows] = await Promise.all([
        ctx.call('product.getVariant', { id: params.variantId }, url, req) as Promise<Record<
          string,
          unknown
        > | null>,
        ctx.call('product.getTemplate', { id: params.id }, url, req) as Promise<{
          id: string
          name: string
          uomId?: string | null
        } | null>,
        optionsFor(ctx, url, req),
        variantMediaFor(ctx, url, req, params.variantId),
      ])
      if (!current || current.templateId !== params.id || !template)
        return text('Variant not found', { status: 404 })
      // Both the picker and the plain select behind it are held to the template's
      // unit tree, so a unit that `setProductUom` would refuse is never offered.
      const unitRoot = unitRootOf(options.unitRows, template.uomId)
      const treeUnits = unitRoot
        ? options.uoms.filter((unit) => unitRootOf(options.unitRows, unit.value) === unitRoot)
        : options.uoms
      const variantUom = await uomControl(ctx, url, req, _, {
        id: `variant-uom:${params.variantId}`,
        value: Array.isArray(current.uoms)
          ? ((current.uoms[0] as Record<string, unknown> | undefined)?.uomId as string | undefined)
          : undefined,
        units: treeUnits,
        rootId: unitRoot,
      })
      const body = variantScreen(
        _,
        params.id,
        current,
        {
          status: 'ready',
          uploadAction: inLocale(
            url,
            `/admin/product/templates/${params.id}/variants/${params.variantId}/media?tab=media`,
          ),
          uploadControl: savedPartial
            ? ''
            : await ctx.joint(url, req, 'product_backend:media.upload', {
                identity: `variant:${params.variantId}`,
                action: inLocale(
                  url,
                  `/admin/product/templates/${params.id}/variants/${params.variantId}/media?tab=media`,
                ),
                label: _('product_backend.media.add'),
              }),
          images: mediaRows.map((image, index) => ({
            id: image.id,
            src: productImageUrl(String(image.attachmentId)),
            alt:
              image.alt ||
              image.attachment?.name ||
              String(current.name || current.defaultCode || current.id),
            primary: image.primary,
            actions: {
              primary: inLocale(
                url,
                `/admin/product/templates/${params.id}/variants/${params.variantId}/media/${image.id}/primary?tab=media`,
              ),
              remove: inLocale(
                url,
                `/admin/product/templates/${params.id}/variants/${params.variantId}/media/${image.id}/remove?tab=media`,
              ),
              ...(index > 0
                ? {
                    moveUp: inLocale(
                      url,
                      `/admin/product/templates/${params.id}/variants/${params.variantId}/media/${image.id}/move-up?tab=media`,
                    ),
                  }
                : {}),
              ...(index + 1 < mediaRows.length
                ? {
                    moveDown: inLocale(
                      url,
                      `/admin/product/templates/${params.id}/variants/${params.variantId}/media/${image.id}/move-down?tab=media`,
                    ),
                  }
                : {}),
            },
          })),
          extension: savedPartial
            ? ''
            : await ctx.joint(url, req, 'product_backend:variant.media', {
                productId: params.variantId,
              }),
        },
        treeUnits,
        template,
        savedPartial
          ? ''
          : await jointFor(ctx, url, req, 'product_backend:variant.collaboration', {
              resModel: 'product.Product',
              resId: params.variantId,
              lang,
            }),
        savedPartial ? {} : await frameOf(ctx, url, req),
        invalidErrors(url, _),
        localeQuery(url),
        savedPartial
          ? ''
          : await ctx.joint(url, req, 'product_backend:variant.editor', {
              identity: `variant:${params.variantId}`,
              productId: params.variantId,
              lang,
            }),
        activeTab,
        savedPartial,
        variantUom,
      )
      if (savedPartial)
        return withHeaders(fragment(body, { type: NAVIGATION_TYPE }), { vary: 'X-Ket-Partial' })
      return backendPage(ctx, req, {
        lang,
        title: String(current.name || current.defaultCode || current.id),
        body,
      })
    },
  '/admin/product/templates/{id}/variants/{variantId}/media':
    (ctx: ServeContext): Route =>
    async (url, req, params) => {
      const denied = refusePost(req, 'POST multipart/form-data')
      if (denied) return denied
      const variant = (await ctx.call('product.getVariant', { id: params.variantId }, url, req)) as AnyVariant
      if (!variant || variant.templateId !== params.id) return text('Variant not found', { status: 404 })
      const attachment = await receiveAttachment(ctx, url, req, {
        resModel: 'product.Product',
        resId: params.variantId,
        resField: 'media',
        public: false,
      })
      try {
        await ctx.call(
          'product_media.attachMedia',
          {
            id: attachment.id,
            attachmentId: attachment.id,
            productId: params.variantId,
            alt: attachment.name,
          },
          url,
          req,
        )
      } catch (error) {
        await ctx.call('storage.removeAttachment', { id: attachment.id }, url, req).catch(() => undefined)
        throw error
      }
      return seeVariant(params.id, params.variantId, url)
    },
  '/admin/product/templates/{id}/variants/{variantId}/media/{mediaId}/primary':
    (ctx: ServeContext): Route =>
    async (url, req, params) => {
      const denied = refusePost(req)
      if (denied) return denied
      if (!(await ownsVariantMedia(ctx, url, req, params.variantId, params.mediaId)))
        return text('Media not found', { status: 404 })
      await ctx.call('product_media.setPrimary', { id: params.mediaId }, url, req)
      return seeVariant(params.id, params.variantId, url)
    },
  '/admin/product/templates/{id}/variants/{variantId}/media/{mediaId}/remove':
    (ctx: ServeContext): Route =>
    async (url, req, params) => {
      const denied = refusePost(req)
      if (denied) return denied
      if (!(await ownsVariantMedia(ctx, url, req, params.variantId, params.mediaId)))
        return text('Media not found', { status: 404 })
      await ctx.call('product_media.removeMedia', { id: params.mediaId }, url, req)
      return seeVariant(params.id, params.variantId, url)
    },
  '/admin/product/templates/{id}/variants/{variantId}/media/{mediaId}/move-up':
    (ctx: ServeContext): Route =>
    async (url, req, params) =>
      moveVariant(ctx, url, req, params.id, params.variantId, params.mediaId, -1),
  '/admin/product/templates/{id}/variants/{variantId}/media/{mediaId}/move-down':
    (ctx: ServeContext): Route =>
    async (url, req, params) =>
      moveVariant(ctx, url, req, params.id, params.variantId, params.mediaId, 1),
  '/admin/product/templates/{id}/media':
    (ctx: ServeContext): Route =>
    async (url, req, params) => {
      const denied = refusePost(req, 'POST multipart/form-data')
      if (denied) return denied
      const template = await ctx.call('product.getTemplate', { id: params.id }, url, req)
      if (!template) return text('Product not found', { status: 404 })
      const attachment = await receiveAttachment(ctx, url, req, {
        resModel: 'product.Template',
        resId: params.id,
        resField: 'media',
        public: false,
      })
      try {
        await ctx.call(
          'product_media.attachMedia',
          {
            id: attachment.id,
            attachmentId: attachment.id,
            templateId: params.id,
            alt: attachment.name,
          },
          url,
          req,
        )
      } catch (error) {
        await ctx.call('storage.removeAttachment', { id: attachment.id }, url, req).catch(() => undefined)
        throw error
      }
      return seeProduct(params.id, url)
    },
  '/admin/product/templates/{id}/media/{mediaId}/primary':
    (ctx: ServeContext): Route =>
    async (url, req, params) => {
      const denied = refusePost(req)
      if (denied) return denied
      if (!(await ownsMedia(ctx, url, req, params.id, params.mediaId)))
        return text('Media not found', { status: 404 })
      await ctx.call('product_media.setPrimary', { id: params.mediaId }, url, req)
      return seeProduct(params.id, url)
    },
  '/admin/product/templates/{id}/media/{mediaId}/remove':
    (ctx: ServeContext): Route =>
    async (url, req, params) => {
      const denied = refusePost(req)
      if (denied) return denied
      if (!(await ownsMedia(ctx, url, req, params.id, params.mediaId)))
        return text('Media not found', { status: 404 })
      await ctx.call('product_media.removeMedia', { id: params.mediaId }, url, req)
      return seeProduct(params.id, url)
    },
  '/admin/product/templates/{id}/media/{mediaId}/move-up':
    (ctx: ServeContext): Route =>
    async (url, req, params) =>
      move(ctx, url, req, params.id, params.mediaId, -1),
  '/admin/product/templates/{id}/media/{mediaId}/move-down':
    (ctx: ServeContext): Route =>
    async (url, req, params) =>
      move(ctx, url, req, params.id, params.mediaId, 1),
}

const move = async (
  ctx: ServeContext,
  url: URL,
  req: Parameters<Route>[1],
  templateId: string,
  mediaId: string,
  delta: number,
) => {
  const denied = refusePost(req)
  if (denied) return denied
  const rows = await mediaFor(ctx, url, req, templateId)
  const index = rows.findIndex((row) => row.id === mediaId)
  if (index < 0) return text('Media not found', { status: 404 })
  const destination = index + delta
  if (destination >= 0 && destination < rows.length) {
    const ids = rows.map((row) => row.id)
    ;[ids[index], ids[destination]] = [ids[destination]!, ids[index]!]
    await ctx.call('product_media.reorderMedia', { templateId, ids }, url, req)
  }
  return seeProduct(templateId, url)
}

const moveVariant = async (
  ctx: ServeContext,
  url: URL,
  req: Parameters<Route>[1],
  templateId: string,
  productId: string,
  mediaId: string,
  delta: number,
) => {
  const denied = refusePost(req)
  if (denied) return denied
  const rows = await variantMediaFor(ctx, url, req, productId)
  const index = rows.findIndex((row) => row.id === mediaId)
  if (index < 0) return text('Media not found', { status: 404 })
  const destination = index + delta
  if (destination >= 0 && destination < rows.length) {
    const ids = rows.map((row) => row.id)
    ;[ids[index], ids[destination]] = [ids[destination]!, ids[index]!]
    await ctx.call('product_media.reorderMedia', { productId, ids }, url, req)
  }
  return seeVariant(templateId, productId, url)
}
