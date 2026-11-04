import { productRecordHref as templatePageHref } from '../navigation.ts'
import { encodeListState, parseListState, table, text, withHeaders } from '@ketvietlab/ketjs'
import type {
  FilterOperator,
  FilterRule,
  ListSearchSpec,
  ListState,
  Route,
  ServeContext,
} from '@ketvietlab/ketjs'
import { html, renderIsland, trustedMarkup } from '@ketvietlab/ketjs-view'
import { LinkButton, Inline } from '@ketvietlab/design-system'
import type { SearchFilterConfig } from '@ketvietlab/design-system'
import { favoriteModal, productsScreen } from './index.ts'
import { listSearchFilterConfig, loadListFavorites } from '../../backend/search-filter.ts'
import { adminPage, inLocale, localeQuery, timezoneOf } from '../../backend/screen.ts'
import { seeOther } from '../../backend/forms.ts'
import { RECORD_NEW_ID, readRecordModalTarget, recordModalCreateHref } from '../../../ui/record-modal.tsx'
import { PRODUCT_LIST_PAGE_SIZE, productListShape } from '../list/read.ts'
import { PRODUCT_LIST_KEY, productList, productListControls, productListFooter } from '../list/island.tsx'
import type { ProductListProps } from '../list/island.tsx'
import { LIST_LABEL_KEYS } from '../list/messages.ts'
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
      tagId: 'product_backend.tag.title',
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

export async function productCollectionScreen(ctx: ServeContext, url: URL, req: Parameters<Route>[1]) {
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
  const spec = productListShape(table(ctx.manifest, 'product.Template'), read.startsWith('stock_backend.'))
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
  // The bar's choices name categories and units, not their ids. Units are their own
  // module's read: without it the bar has no unit field rather than refusing the list.
  const readsUnits = await ctx.allows('uom.listUnits', url, req)
  const [categoryRows, unitRows, tagRows] = (await Promise.all([
    ctx.call('product.listCategories', {}, url, req),
    readsUnits ? ctx.call('uom.listUnits', {}, url, req) : [],
    (await may('product.listTags')) ? ctx.call('product.listTags', { includeArchived: true }, url, req) : [],
  ])) as Array<Array<Record<string, unknown>>>
  const categoryMap = new Map<string, string>()
  const collectCategories = (items: Array<Record<string, unknown>>) => {
    for (const item of items) {
      if (!categoryMap.has(String(item.id))) categoryMap.set(String(item.id), String(item.path ?? item.name))
      if (Array.isArray(item.children)) collectCategories(item.children as Array<Record<string, unknown>>)
    }
  }
  // Every category is a row of its own, carrying its full name; children only fill gaps.
  for (const row of categoryRows!) categoryMap.set(String(row.id), String(row.path ?? row.name))
  collectCategories(categoryRows!)
  const unitMap = new Map(unitRows!.map((row) => [String(row.id), String(row.name)]))
  const canImport = await may('product.importProducts')
  const extensionActions = await ctx.joint(url, req, 'product_backend:catalogue.actions', {
    locale: localeQuery(url),
  })
  // What the island reads with: the list's own URL, less the route modal over it.
  const listUrl = new URL(url)
  for (const key of ['modal', 'favoriteError', 'record', 'bulkProduct']) listUrl.searchParams.delete(key)
  const listHref = `${listUrl.pathname}${listUrl.search}`
  return adminPage(ctx, url, req, {
    title: 'product_backend.screen.title',
    body: async (_, frame) => {
      const groupLabels: Record<string, string> = {
        type: _('product_backend.list.group.type'),
        state: _('product_backend.list.group.state'),
        use: _('product_backend.list.group.use'),
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
          type: ['goods', 'service', 'combo'].map((value) => ({
            value,
            label: _(`product_backend.type.${value}`),
          })),
          tagId: tagRows!.map((row) => ({ value: String(row.id), label: String(row.name) })),
          categoryId: [...categoryMap].map(([value, label]) => ({ value, label })),
          uomId: [...unitMap].map(([value, label]) => ({ value, label })),
        },
        bodyId: 'product-template-list',
        spec: readsUnits
          ? spec
          : { ...spec, filterable: spec.filterable?.filter((field) => field.key !== 'uomId') },
        state,
        favorites,
        fieldLabel: (key, fallback) => productFieldLabel(_, key, fallback),
        presetLabel: (key, fallback) =>
          key === 'goods' || key === 'service' || key === 'combo'
            ? _(`product_backend.type.${key}`)
            : key === 'notSold' || key === 'tracked'
              ? _(`product_backend.list.preset.${key}`)
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
          const group = ['stock', 'sale', 'purchase'].includes(String(option.group)) ? 'state' : option.group
          return {
            ...option,
            ...(group ? { group, ...(groupLabels[group] ? { groupLabel: groupLabels[group] } : {}) } : {}),
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
        typeCombo: _('product_backend.type.combo'),
        create: _('product_backend.create.title'),
      }
      // Who may not create or archive is offered no way to start, rather than a refusal at the end.
      const [canCreate, canArchive, canDelete, images, canBulkEdit] = await Promise.all([
        may('product.saveTemplate'),
        may('product.archiveTemplate'),
        may('product.deleteTemplates'),
        may('product_media.getMediaAttachment'),
        may('product.bulkEditProducts'),
      ])
      const createHref = canCreate ? templatePageHref(url, RECORD_NEW_ID) : null
      const bulk =
        canArchive || canDelete || canBulkEdit
          ? {
              action: inLocale(url, '/admin/product/templates/bulk'),
              archive: canArchive,
              delete: canDelete,
              edit: canBulkEdit,
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
        <Inline
          items={[
            canImport ? (
              <LinkButton
                href={recordModalCreateHref(url, { kind: 'product.import' })}
                label={_('product_backend.import.create')}
                variant="secondary"
              />
            ) : null,
            extensionActions,
          ]}
        />,
        favoriteOverlay,
        _.locale === 'en' ? 'en' : 'vi',
      )
    },
  })
}
