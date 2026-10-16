// @ts-nocheck Shared by the server render and the browser; its tests exercise it.
// The sales record list: one paged read (`crm.sales.search`) drawn by the shared collection book inside the
// `crm.sales-screen` island. Views, filters and sorts are the business questions a sales team asks.
import {
  createDefinitionBook,
  definitionQuery,
  name,
  col,
  money,
  facet,
  filter,
} from '../../../ui/client/collection-book.mjs'
import { createSalesFormat, salesWords } from './format.mjs'
import { salesQuery } from './kit.mjs'

export const salesDefinition = (lang = 'vi') => {
  const t = (vi, en) => (lang === 'en' ? en : vi)
  return {
    lang,
    title: t('Hồ sơ bán hàng', 'Sales records'),
    subject: t('hồ sơ', 'records'),
    source: 'crm.sales.search',
    record: 'lead-detail',
    facets: [
      facet('all', t('Tất cả', 'All')),
      facet('open', t('Đang mở', 'Open')),
      facet('mine', t('Của tôi', 'Mine')),
      facet('attention', t('Cần chú ý', 'Needs attention')),
      facet('closing', t('Chốt tháng này', 'Closing this month')),
      facet('won', t('Thành công', 'Won')),
      facet('lost', t('Thất bại', 'Lost')),
    ],
    filters: [
      filter('kind', t('Loại', 'Kind')),
      filter('owner', t('Phụ trách', 'Owner')),
      filter('team', t('Đội', 'Team')),
      filter('stage', t('Giai đoạn', 'Stage')),
      filter('source', t('Nguồn', 'Source')),
      filter('attention', t('Cảnh báo', 'Warning')),
      filter('closing', t('Ngày chốt', 'Close date')),
      filter('closed', t('Đóng trong kỳ', 'Closed in')),
      filter('created', t('Tạo trong kỳ', 'Created in')),
    ],
    // The first is the list's own order; a header's first click is its most useful direction.
    sorts: {
      updated: t('Mới cập nhật', 'Recently updated'),
      priority: t('Ưu tiên', 'Priority'),
      '-revenue': t('Giá trị giảm dần', 'Value, highest first'),
      revenue: t('Giá trị tăng dần', 'Value, lowest first'),
      closing: t('Ngày chốt gần nhất', 'Close date, soonest first'),
      '-closing': t('Ngày chốt xa nhất', 'Close date, latest first'),
      title: t('Tiêu đề A–Z', 'Title A–Z'),
      '-title': t('Tiêu đề Z–A', 'Title Z–A'),
    },
    create: [t('Tạo lead', 'Create lead'), 'lead-new'],
    columns: [
      name(t('Hồ sơ', 'Record')),
      col('stage', t('Giai đoạn', 'Stage'), 'badge', { priority: 'secondary' }),
      money('revenue', t('Giá trị', 'Value')),
      col('closingLabel', t('Ngày chốt', 'Close date'), 'lines', { sortKey: 'closing' }),
      col('owner', t('Phụ trách', 'Owner'), 'lines', { priority: 'secondary' }),
      col('next', t('Bước tiếp theo', 'Next step'), 'lines', { priority: 'tertiary', wrap: true }),
      col('updated', t('Cập nhật', 'Updated'), 'text', { priority: 'tertiary', sortKey: 'updated' }),
    ],
    empty: [
      t('Chưa có hồ sơ', 'No records'),
      t('Tạo lead đầu tiên hoặc nhập hồ sơ từ tệp.', 'Create the first lead or import records.'),
      t('Xóa bộ lọc', 'Clear filters'),
      'cases',
    ],
    search: t('Tìm tên, mã, khách hoặc điện thoại', 'Find a title, ID, customer or phone'),
  }
}

/** The choices of each filter, from the screen's read (people, teams, stages) and its clock. */
export const salesFilters = (model, lang = 'vi') => {
  const fmt = createSalesFormat(lang, model.clock),
    words = salesWords(lang),
    t = fmt.t
  const month = model.clock.slice(0, 7)
  const shift = (key, n) => {
    const date = new Date(Date.UTC(Number(key.slice(0, 4)), Number(key.slice(5, 7)) - 1 + n, 1))
    return date.toISOString().slice(0, 7)
  }
  const quarter = (key) => `${key.slice(0, 4)}-q${Math.ceil(Number(key.slice(5, 7)) / 3)}`
  const quarterLabel = (key) => {
    const [year, q] = key.split('-q')
    return t(`Quý ${q}/${year}`, `Q${q} ${year}`)
  }
  const quarters = [quarter(month), quarter(shift(month, -3))]
  const periods = [
    ...Array.from({ length: 6 }, (_, i) => shift(month, -i)).map((id) => ({ id, label: fmt.month(id) })),
    ...quarters.map((id) => ({ id, label: quarterLabel(id) })),
  ]
  return {
    kind: Object.entries(words.kind).map(([id, label]) => ({ id, label })),
    owner: [
      { id: 'me', label: t('Của tôi', 'Mine') },
      { id: 'none', label: t('Chưa phân công', 'Unassigned') },
      ...model.people.map((p) => ({ id: p.id, label: p.name })),
    ],
    team: model.teams.map((x) => ({ id: x.id, label: x.name })),
    stage: model.stages.filter((s) => s.active).map((s) => ({ id: s.id, label: s.name })),
    source: (model.sources ?? []).map((id) => ({ id, label: id })),
    attention: [
      { id: 'any', label: t('Mọi cảnh báo', 'Any warning') },
      ...Object.entries(words.attention).map(([id, label]) => ({ id, label })),
    ],
    closing: [
      { id: 'overdue', label: t('Đã trễ', 'Past due') },
      { id: 'missing', label: t('Chưa có ngày chốt', 'No close date') },
      ...[0, 1, 2].map((n) => shift(month, n)).map((id) => ({ id, label: fmt.month(id) })),
    ],
    closed: periods,
    created: periods,
  }
}

/** Everything the list's three parts need, for the island to mount them inside its page. */
export const salesBookProps = (model, query, lang = 'vi', routes) => {
  const params = new URLSearchParams(query),
    definition = salesDefinition(lang),
    filters = salesFilters(model, lang)
  const normalized = definitionQuery(definition).fromUrl(params, { filters })
  // An older address names the outcome as `state`.
  if (!params.get('view') && definition.facets.some((f) => f.id === params.get('state')))
    normalized.view = params.get('state')
  const persona = new URLSearchParams({ viewer: model.actor.id, role: model.actor.role, lang }).toString()
  const at = (screen, extra) => routes.href(salesQuery(screen, persona, extra))
  const [action, search = ''] = at('cases').split('?')
  const record = (id) => at('lead-detail', { id })
  return {
    key: 'cases',
    lang,
    source: routes.search(persona),
    listHref: at('cases'),
    action,
    hidden: Object.fromEntries(new URLSearchParams(search)),
    recordHref: record,
    recordHrefs: { 'lead-detail': record },
    recordModals: {},
    createHref: model.can.write ? at('lead-new') : null,
    emptyHref: at('cases'),
    filters,
    query: normalized,
    canBulk: model.can.admin,
  }
}

export const createCrmSalesBook = (environment, key = 'cases') => {
  const { view, routes } = environment
  const t = (vi, en) => (environment.lang === 'en' ? en : vi)
  const definition = salesDefinition(environment.lang)
  if (environment.lang === 'en')
    definition.words = {
      describe: (value, query) =>
        value.total
          ? `${(value.page - 1) * query.pageSize + 1}–${(value.page - 1) * query.pageSize + value.rows.length} of ${value.total} records`
          : 'No matching records',
      lost: 'The record is no longer in these results.',
      pager: 'Record pagination',
      subject: 'Sales records',
      denied: {
        title: 'CRM access denied',
        message: 'Contact an administrator to review your permissions.',
      },
      labels: {
        region: 'Sales records — scroll for more columns',
        selectAll: 'Select all',
        selectRow: 'Select record',
        sortedAscending: 'Ascending',
        sortedDescending: 'Descending',
        previousPage: 'Previous page',
        nextPage: 'Next page',
        loading: 'Loading records',
        loadError: 'Unable to load records',
        empty: 'No matching records',
        emptyHint: 'Remove filters to see more results.',
        retry: 'Retry',
      },
    }
  definition.extend = (store, props) => {
    store.selected = view.signal([])
    store.selectionAnchor = null
    // Selection is intentionally page-local. Every fresh read clears it.
    store.onResult = () => store.selected.set([])
    store.canBulk = props.canBulk
  }
  definition.tableProps = (store) =>
    !store.canBulk
      ? {}
      : {
          selection: { formId: 'crm-sales-selection', fieldName: 'selected' },
          selectionState: {
            ids: store.selected(),
            anchor: store.selectionAnchor,
            onChange(ids, anchor) {
              store.selectionAnchor = anchor
              store.selected.set(ids)
            },
          },
        }
  definition.bulk = (store, props) =>
    !props.canBulk
      ? undefined
      : {
          form: 'crm-sales-selection',
          selectedCount: store.selected().length,
          summary: t(
            `${store.selected().length} hồ sơ được chọn trên trang`,
            `${store.selected().length} records selected on this page`,
          ),
          clearLabel: t('Bỏ chọn', 'Clear selection'),
          actions: [{ id: 'assign', label: t('Xem trước phân công', 'Review assignment') }],
        }
  definition.controlsMount = (store, { lifetime }) => {
    // The export follows the list as filtered.
    const exportPath = routes.exportHref('').split('?')[0]
    const stop = view.effect(() => {
      store.query()
      const address = routes.parse(new URL(store.at({}), location.href))
      if (!address) return
      for (const anchor of document.querySelectorAll('a[href]'))
        if (new URL(anchor.href, location.href).pathname === exportPath)
          anchor.href = routes.exportHref(address.toString())
    })
    lifetime.addEventListener('abort', stop, { once: true })
    const form = document.getElementById('crm-sales-selection')
    if (!form) return
    form.addEventListener('reset', () => store.selected.set([]), { signal: lifetime })
    form.addEventListener(
      'submit',
      (event) => {
        event.preventDefault()
        const ids = store.selected()
        if (!ids.length) return
        const url = new URL(location.href)
        url.searchParams.set('dialog', 'bulk')
        url.searchParams.set('ids', ids.join(','))
        // The screen's island opens the dialog in place; without it the page loads the address.
        const go = new CustomEvent('crm:sales-navigate', { cancelable: true, detail: { href: url.href } })
        if (document.dispatchEvent(go)) location.assign(url)
      },
      { signal: lifetime },
    )
  }
  return createDefinitionBook(environment, key, definition)
}
