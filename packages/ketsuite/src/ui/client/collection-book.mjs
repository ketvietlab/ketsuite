// @ts-nocheck Shared by the server render and the browser; its tests exercise it.
// A collection list described by data: its title, read, search, filters, facets, sorts, columns and empty
// states. The definition owns business labels and information hierarchy; the design system owns every visible
// component, and `list-book.mjs` owns paging, history and reading. Modules define their collections with
// these helpers; records and filtering stay on the server, which sends one page at a time.
import { createBook, fold, maxPageSize, pageSize, whole } from './list-book.mjs'

export const col = (key, label, type = 'text', options = {}) => ({
  key,
  label,
  type,
  ...options,
})
export const name = (label, options = {}) =>
  col('title', label, 'lines', {
    priority: 'primary',
    wrap: true,
    width: 'wide',
    sortKey: 'title',
    ...options,
  })
export const state = (label = 'Trạng thái', key = 'state') =>
  col(key, label, 'badge', { priority: 'primary' })
export const money = (key, label, priority = 'primary') =>
  col(key, label, 'money', {
    kind: 'currency',
    align: 'end',
    sortKey: key,
    priority,
  })
export const filter = (name, label) => ({ name, label })
export const facet = (id, label) => ({ id, label })
export const all = facet('all', 'Tất cả')
export const alpha = { title: 'Tên A–Z', '-title': 'Tên Z–A' }
export const attention = { attention: 'Cần xử lý trước', ...alpha }

export const definitionQuery = (definition) => {
  const defaultSort = Object.keys(definition.sorts)[0]
  const names = ['q', 'view', 'sort', 'page', ...definition.filters.map((item) => item.name)]
  const codec = {
    names,
    fold,
    normalize: (input, limits) => ({
      ...Object.fromEntries(
        definition.filters.map(({ name }) => [
          name,
          (limits.filters[name] ?? []).some((item) => item.id === input[name]) ? input[name] : null,
        ]),
      ),
      q: typeof input.q === 'string' ? input.q.trim().slice(0, 100) : '',
      view: definition.facets.some((item) => item.id === input.view) ? input.view : 'all',
      sort: Object.hasOwn(definition.sorts, input.sort) ? input.sort : defaultSort,
      page: Math.max(1, whole(input.page) ?? 1),
      pageSize: Math.min(maxPageSize, Math.max(1, whole(input.pageSize) ?? pageSize)),
    }),
    fromUrl: (params, limits) =>
      codec.normalize(Object.fromEntries(names.map((name) => [name, params.get(name)])), limits),
    toParams: (query) =>
      Object.fromEntries(
        Object.entries({
          ...Object.fromEntries(definition.filters.map(({ name }) => [name, query[name] ?? ''])),
          q: query.q,
          view: query.view === 'all' ? '' : query.view,
          sort: query.sort === defaultSort ? '' : query.sort,
          page: query.page > 1 ? String(query.page) : '',
        }).filter(([, value]) => value),
      ),
    toInput: (query) => ({ ...query }),
  }
  return codec
}

export const createDefinitionBook = ({ view, ds, browser = false }, key, definition) => {
  const codec = definitionQuery(definition)
  const { html } = view
  const { Badge, EmptyState, LinkButton, ListChrome, Menu, Stack, Text } = ds
  const t = (vi, en) => (definition.lang === 'en' ? en : vi)
  const count = (value) => value.toLocaleString('vi-VN')
  const cell = (column, row, store) => {
    const value = row[column.key]
    if (column.type === 'action' && row.nextRecord)
      return LinkButton({
        label: value,
        href: store.recordLink({ ...row, record: row.nextRecord }),
        variant: 'secondary',
      })
    if (column.type === 'badge')
      return Badge({
        label: value?.[0] ?? 'Chưa có',
        tone: value?.[1] ?? 'neutral',
        size: 'small',
      })
    if (column.type === 'lines') {
      // An optional third entry gives the detail line a status tone (an overdue date, a missing step).
      const [title, detail, detailTone] = Array.isArray(value) ? value : [value, null]
      return Stack({
        gap: 'none',
        items: [
          Text({ children: title ?? '—', variant: 'bodyMd' }),
          ...(detail ? [Text({ children: detail, variant: 'bodySm', tone: detailTone ?? 'muted' })] : []),
        ],
      })
    }
    if (column.type === 'money')
      return Text({
        children: new Intl.NumberFormat('vi-VN', {
          style: 'currency',
          currency: value?.currency ?? 'VND',
        }).format(value?.amount ?? 0),
        variant: 'bodyMd',
        numeric: true,
      })
    return Text({
      children: value == null || value === '' ? '—' : column.type === 'number' ? count(value) : value,
      variant: 'bodyMd',
      numeric: column.type === 'number',
    })
  }
  const columns = (store, query) =>
    definition.columns.map((columnDefinition) => {
      const { type: _type, twoLines: _twoLines, sortKey, ...column } = columnDefinition
      // A header is the only way to order the list: its first order (as `sorts` lists it), the other,
      // then back to the desk's own order.
      const orders = Object.keys(definition.sorts).filter((id) => id.replace(/^-/, '') === sortKey)
      const position = orders.indexOf(query.sort)
      const targetSort =
        position === -1 ? orders[0] : (orders[position + 1] ?? Object.keys(definition.sorts)[0])
      return {
        ...column,
        ...(sortKey
          ? {
              sortHref: store.at({ sort: targetSort }),
              sortLabel: `${column.label}, ${t('sắp xếp', 'sort')} ${definition.sorts[targetSort].toLocaleLowerCase('vi-VN')}`,
            }
          : {}),
        cell: (row) => cell(columnDefinition, row, store),
      }
    })
  const controls = (store, props) => {
    const query = store.query(),
      value = ['failed', 'offline', 'denied'].includes(store.phase()) ? null : store.result()
    const counted = (id) =>
      value ? count(value.counts.view[id] ?? 0) : store.phase() === 'loading' ? '…' : undefined
    return ListChrome({
      filtersLabel: `${t('Lọc', 'Filter')} ${definition.subject}`,
      filtersToggle: {
        label: t('Bộ lọc', 'Filters'),
        count: definition.filters.filter(({ name }) => query[name]).length + Number(query.view !== 'all'),
      },
      search: {
        id: `${key}-search`,
        action: props.action,
        name: 'q',
        value: query.q,
        label: definition.search,
        placeholder: definition.search,
        submitLabel: t('Tìm', 'Search'),
        hidden: store.searchFields(),
      },
      filterMenus: definition.filters.map(({ name, label }) => {
        const chosen = props.filters[name]?.find((item) => item.id === query[name])?.label
        return Menu({
          id: `${key}-${name}`,
          label: chosen ? `${label}: ${chosen}` : label,
          selectionMode: 'single',
          trigger: html`<span>${chosen ?? label}</span>`,
          items: [
            {
              id: `${key}-${name}-all`,
              label: `${t('Mọi', 'All')} ${label.toLocaleLowerCase('vi-VN')}`,
              href: store.at({ [name]: null }),
              checked: !query[name],
            },
            ...(props.filters[name] ?? []).map((item) => ({
              id: `${key}-${name}-${encodeURIComponent(item.id)}`,
              label: item.label,
              count: value?.counts.filters[name]?.[item.id] ?? undefined,
              href: store.at({ [name]: item.id }),
              checked: query[name] === item.id,
            })),
          ],
        })
      }),
      facets: definition.facets.map((item) => ({
        ...item,
        href: store.at({ view: item.id }),
        active: item.id === query.view,
        count: counted(item.id),
      })),
      bulk: definition.bulk?.(store, props),
      // Column headers own sorting; the toolbar keeps search and filters only, applied as they change.
    })
  }
  const empty = (store, query, value, props) => {
    if (value.isEmpty)
      return EmptyState({
        title: definition.empty[0],
        message: definition.empty[1],
        actions: props.createHref
          ? LinkButton({
              label: definition.create[0],
              href: props.createHref,
              variant: 'primary',
            })
          : props.emptyHref
            ? LinkButton({
                label: definition.empty[2],
                href: props.emptyHref,
                variant: 'secondary',
              })
            : undefined,
      })
    return EmptyState({
      title: 'Không có kết quả phù hợp',
      message: query.q
        ? `Không có ${definition.subject} khớp “${query.q}”. Bỏ bớt bộ lọc hoặc tìm từ khác.`
        : 'Bỏ bớt bộ lọc để xem thêm kết quả.',
      actions: LinkButton({
        label: t('Xóa bộ lọc', 'Clear filters'),
        href: store.at({
          ...Object.fromEntries(definition.filters.map(({ name }) => [name, null])),
          view: 'all',
          q: '',
        }),
        variant: 'secondary',
      }),
    })
  }
  return createBook(
    { view, ds, browser },
    {
      screen: key,
      codec,
      limits: (props) => ({ filters: props.filters }),
      ids: {
        search: `${key}-search`,
        retry: `${key}-retry`,
      },
      record: (row, props) => {
        const screen = row.record?.screen ?? definition.record
        return {
          href: props.recordHrefs[screen] ?? props.recordHref,
          id: row.record?.id ?? row.id,
          modal: props.recordModals?.[screen],
        }
      },
      controls,
      initial: definition.initial,
      extend: definition.extend,
      tableProps: definition.tableProps,
      controlsMount: definition.controlsMount,
      resultsMount: definition.resultsMount,
      columns,
      empty,
      twoLines: definition.columns
        .filter((item) => item.type === 'lines' && item.twoLines !== false)
        .map((item) => item.key),
      sort: (query) => {
        const field = query.sort.replace(/^-/, '')
        const column = definition.columns.find((item) => item.sortKey === field)
        return column
          ? {
              field: column.key,
              direction: query.sort.startsWith('-') ? 'desc' : 'asc',
            }
          : null
      },
      words: definition.words ?? {
        describe: (value, query) =>
          value.total
            ? `${count((value.page - 1) * query.pageSize + 1)}–${count((value.page - 1) * query.pageSize + value.rows.length)} trong ${count(value.total)} ${definition.subject}`
            : 'Không có kết quả phù hợp',
        lost: 'Bản ghi vừa mở không còn trong kết quả này.',
        pager: `Phân trang ${definition.subject}`,
        subject: definition.title,
        denied: {
          title: `Bạn không có quyền xem ${definition.subject}`,
          message: 'Liên hệ quản trị để kiểm tra quyền của bạn trong phạm vi này.',
        },
        labels: {
          region: `${definition.title} — cuộn ngang để xem thêm cột`,
          selectAll: 'Chọn tất cả',
          selectRow: 'Chọn dòng',
          sortedAscending: 'Tăng dần',
          sortedDescending: 'Giảm dần',
          previousPage: 'Trang trước',
          nextPage: 'Trang sau',
          loading: `Đang tải ${definition.subject}`,
          loadError: `Chưa tải được ${definition.subject}`,
          empty: 'Không có kết quả phù hợp',
          emptyHint: 'Bỏ bớt bộ lọc để xem thêm kết quả.',
          retry: 'Thử lại',
        },
      },
    },
  )
}
