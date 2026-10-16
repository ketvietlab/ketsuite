import type { Row } from '@ketvietlab/ketjs'
import * as ds from '@ketvietlab/design-system'
import * as view from '@ketvietlab/ketjs-view'
import { createBook } from '../../ui/client/list-book.mjs'
import type { ImportVm } from './screens/import-ui.tsx'
import { href, records, say, statusLabels, Status, textValue } from './screens/import-ui.tsx'

type Query = { q: string; page: number; pageSize: number } & Record<string, unknown>
type Answer = { total: number; page: number; rows: Row[]; isEmpty: boolean }
type Choice = { id: string; label: string }
type BookProps = { action: string; filters: Record<string, Choice[]> }
type Store = {
  query: () => Query
  at: (value: Record<string, unknown>) => string
  searchFields: () => Record<string, string>
}
// The shared collection runtime owns cancellation, URL/history, debounce, retry,
// loading, selection reset, and one store shared by controls/results/footer.
type CreateBook = typeof createBook
const books = new Map<string, ReturnType<CreateBook>>()
export function collectionPart(props: { model: ImportVm; part: 'controls' | 'results' | 'footer' }) {
  const vm = props.model,
    t = (vi: string, en: string) => say(vm, vi, en)
  const key = `crm-import-${vm.screen}-${vm.lang}`
  const filters: Record<string, { id: string; label: string }[]> =
    vm.screen === 'batches'
      ? {
          state: Object.entries(statusLabels)
            .filter(([id]) =>
              ['draft', 'ready', 'running', 'completed', 'partial', 'stopped', 'undone'].includes(id),
            )
            .map(([id, labels]) => ({ id, label: t(...labels) })),
        }
      : vm.screen === 'tags'
        ? {
            filter: [
              { id: 'similar', label: t('Gần giống nhau', 'Near duplicates') },
              { id: 'unused', label: t('Không dùng 90 ngày', 'Unused for 90 days') },
              { id: 'archived', label: t('Đã lưu trữ', 'Archived') },
            ],
          }
        : {
            tagId: vm.options.tags.map((tag) => ({ id: String(tag.id), label: String(tag.name) })),
            untagged: [{ id: '1', label: t('Chưa có nhãn', 'Untagged') }],
          }
  const filterLabels: Record<string, string> = {
    state: t('Trạng thái', 'Status'),
    filter: t('Hiển thị', 'Show'),
    tagId: t('Nhãn', 'Tag'),
    untagged: t('Phân loại', 'Classification'),
  }
  const names = ['search', 'offset', ...Object.keys(filters)]
  const normalize = (input: Record<string, unknown>) => ({
    q: String(input.search || input.q || '').slice(0, 100),
    page: Math.max(1, Number(input.page) || Math.floor(Number(input.offset || 0) / 50) + 1),
    pageSize: 50,
    ...Object.fromEntries(
      Object.entries(filters).map(([name, choices]) => [
        name,
        choices.some((c) => c.id === input[name]) ? input[name] : null,
      ]),
    ),
  })
  const codec = {
    names,
    normalize,
    fromUrl: (params: URLSearchParams) => normalize(Object.fromEntries(params)),
    toParams: (q: Record<string, unknown>) => ({
      search: q.q || '',
      offset: String((Number(q.page) - 1) * 50),
      ...Object.fromEntries(Object.keys(filters).map((name) => [name, q[name] || ''])),
    }),
    toInput: (q: unknown) => q,
  }
  let book = typeof window === 'undefined' ? undefined : books.get(key)
  if (!book) {
    book = createBook(
      { view, ds, browser: typeof window !== 'undefined' },
      {
        screen: key,
        codec,
        limits: () => ({}),
        ids: { search: `${key}-search`, retry: `${key}-retry` },
        twoLines: [],
        sort: () => null,
        record: (row: Record<string, unknown>, p: { model: ImportVm }) => ({
          href: () =>
            vm.screen === 'batches'
              ? ['draft', 'ready'].includes(String(row.state))
                ? href(p.model, '/admin/crm/imports/new', {
                    id: row.id,
                    step: row.state === 'ready' ? 'review' : 'mapping',
                  })
                : href(p.model, `/admin/crm/imports/${encodeURIComponent(String(row.id))}`)
              : vm.screen === 'tags'
                ? href(
                    p.model,
                    p.model.options.permissions.createTags ? '/admin/crm/tags' : '/admin/crm/tagged-records',
                    { tagId: row.id },
                  )
                : href(p.model, `/admin/crm/cases/${encodeURIComponent(String(row.id))}`),
          id: row.id,
        }),
        controls: (store: Store, p: BookProps) =>
          ds.ListChrome({
            filtersLabel: t('Bộ lọc', 'Filters'),
            filtersToggle: {
              label: t('Bộ lọc', 'Filters'),
              count: Object.keys(filters).filter((name) => store.query()[name]).length,
            },
            search: {
              id: `${key}-search`,
              action: p.action,
              name: 'search',
              value: store.query().q,
              label: t('Tìm kiếm', 'Search'),
              placeholder: t('Tìm kiếm', 'Search'),
              submitLabel: t('Tìm', 'Search'),
              hidden: store.searchFields(),
            },
            filterMenus: Object.entries(p.filters).map(([name, choices]) =>
              ds.Menu({
                id: `${key}-${name}`,
                label: filterLabels[name],
                selectionMode: 'single',
                trigger: ds.Text({
                  children: choices.find((c) => c.id === store.query()[name])?.label || filterLabels[name],
                  variant: 'bodyMd',
                }),
                items: [
                  {
                    id: 'all',
                    label: t('Tất cả', 'All'),
                    href: store.at({ [name]: null }),
                    checked: !store.query()[name],
                  },
                  ...choices.map((c) => ({
                    id: c.id,
                    label: c.label,
                    href: store.at({ [name]: c.id }),
                    checked: store.query()[name] === c.id,
                  })),
                ],
              }),
            ),
          }),
        columns: () =>
          vm.screen === 'batches'
            ? [
                {
                  key: 'name',
                  label: t('Lô nhập', 'Batch'),
                  cell: (r: Row) => String(r.name),
                  priority: 'primary',
                },
                {
                  key: 'state',
                  label: t('Trạng thái', 'Status'),
                  cell: (r: Row) => <Status vm={vm} value={r.state} />,
                },
                {
                  key: 'cursor',
                  label: t('Đã xử lý / số dòng', 'Processed / rows'),
                  cell: (r: Row) => `${r.cursor} / ${r.total}`,
                  kind: 'number',
                },
                {
                  key: 'createdAt',
                  label: t('Tạo lúc', 'Created'),
                  cell: (r: Row) =>
                    new Date(String(r.createdAt)).toLocaleString(vm.lang === 'vi' ? 'vi-VN' : 'en-GB', {
                      timeZone: 'Asia/Ho_Chi_Minh',
                    }),
                },
              ]
            : vm.screen === 'tags'
              ? [
                  {
                    key: 'name',
                    label: t('Nhãn', 'Tag'),
                    cell: (r: Row) => String(r.name),
                    priority: 'primary',
                  },
                  {
                    key: 'open',
                    label: t('Hồ sơ mở', 'Open records'),
                    cell: (r: Row) => String(r.open),
                    kind: 'number',
                  },
                  {
                    key: 'winRate',
                    label: t('Tỉ lệ thắng', 'Win rate'),
                    cell: (r: Row) => `${Math.round(Number(r.winRate) * 100)}%`,
                    kind: 'number',
                  },
                  {
                    key: 'batches',
                    label: t('Lô nhập', 'Batches'),
                    cell: (r: Row) => String(r.batches),
                    kind: 'number',
                  },
                ]
              : [
                  {
                    key: 'name',
                    label: t('Hồ sơ', 'Record'),
                    cell: (r: Row) => String(r.name),
                    priority: 'primary',
                  },
                  {
                    key: 'owner',
                    label: t('Phụ trách', 'Assignee'),
                    cell: (r: Row) => textValue(r.assigneeName || r.assigneeUserId || '—'),
                  },
                  {
                    key: 'stage',
                    label: t('Giai đoạn', 'Stage'),
                    cell: (r: Row) => textValue(r.stageName || '—'),
                  },
                  {
                    key: 'tags',
                    label: t('Nhãn', 'Tags'),
                    cell: (r: Row) =>
                      records(r.tags)
                        .map((tag) => textValue(tag.name))
                        .join(', '),
                  },
                ],
        tableProps: () =>
          vm.screen === 'records' && vm.options.permissions.tagRecords
            ? { selection: { formId: 'record-tags-bulk', fieldName: 'ids' } }
            : {},
        empty: (store: Store, _q: Query, value: Answer) =>
          ds.EmptyState({
            visual: value.isEmpty ? 'start' : 'search',
            title: value.isEmpty
              ? t('Chưa có dữ liệu', 'No data yet')
              : t('Không có kết quả phù hợp', 'No matching results'),
            message: t(
              'Tạo mới hoặc điều chỉnh bộ lọc để tiếp tục.',
              'Create an item or adjust the filters to continue.',
            ),
            actions: !value.isEmpty
              ? ds.LinkButton({
                  label: t('Xóa bộ lọc', 'Clear filters'),
                  href: store.at({
                    q: '',
                    ...Object.fromEntries(Object.keys(filters).map((name) => [name, null])),
                  }),
                })
              : undefined,
          }),
        words: {
          describe: (v: Answer, q: Query) =>
            `${v.total ? (v.page - 1) * q.pageSize + 1 : 0}–${(v.page - 1) * q.pageSize + v.rows.length} / ${v.total}`,
          lost: t('Hồ sơ không còn trong kết quả.', 'The record is no longer in these results.'),
          pager: t('Phân trang', 'Pagination'),
          subject: t('Kết quả', 'Results'),
          denied: {
            title: t('Không có quyền xem', 'Access denied'),
            message: t(
              'Liên hệ quản trị để kiểm tra quyền.',
              'Contact an administrator to review your access.',
            ),
          },
          offline: {
            title: t('Mất kết nối', 'Offline'),
            message: () =>
              t('Kết quả sẽ tải lại khi có mạng.', 'Results reload when the connection returns.'),
          },
          error: () => t('Chưa tải được dữ liệu. Hãy thử lại.', 'Unable to load data. Please retry.'),
          labels: {
            region: t('Kết quả — cuộn ngang để xem thêm cột', 'Results — scroll for more columns'),
            selectAll: t('Chọn trang này', 'Select this page'),
            selectRow: t('Chọn hồ sơ', 'Select record'),
            sortedAscending: t('Tăng dần', 'Ascending'),
            sortedDescending: t('Giảm dần', 'Descending'),
            previousPage: t('Trang trước', 'Previous page'),
            nextPage: t('Trang sau', 'Next page'),
            loading: t('Đang tải dữ liệu', 'Loading data'),
            loadError: t('Chưa tải được dữ liệu', 'Unable to load data'),
            empty: t('Không có kết quả', 'No results'),
            retry: t('Thử lại', 'Retry'),
          },
        },
      },
    )
    if (typeof window !== 'undefined') books.set(key, book)
  }
  const query = normalize(vm.query)
  return book[props.part]({
    key: vm.requestId,
    model: vm,
    query,
    filters,
    action: vm.base,
    listHref: href(vm, vm.base, { batchId: vm.query.batchId }),
    hidden: { lang: vm.lang, batchId: vm.query.batchId || '' },
    source: href(vm, '/admin/crm/imports/collection', { screen: vm.screen, batchId: vm.query.batchId }),
    initialRowCount: 5,
  })
}
export const collectionIsland = view.defineIsland<{
  model: ImportVm
  part: 'controls' | 'results' | 'footer'
}>()({
  props: { model: 'json', part: 'text' },
  client: 'crm-import.mjs',
  export: 'collectionPart',
  view: collectionPart,
})
export function CollectionSlot({ vm, part }: { vm: ImportVm; part: 'controls' | 'results' | 'footer' }) {
  return (
    <>
      {view.trustedMarkup(
        view.renderIsland(
          'crm.import-collection',
          collectionIsland.view,
          { model: vm, part },
          { tag: 'div' },
        ),
      )}
    </>
  )
}
