// @ts-nocheck Shared by the server render and the browser; its tests exercise it.
// What every CRM sales screen shares when the island draws it: addresses, business wording and the native
// command forms (with their retained drafts). Render-pure; the island supplies the browser-only parts
// through `env` (stable request ids, live quote lines, the lead draft).
//
// A screen's address is a query naming the screen (`screen=lead-detail&id=…`). The host turns it into a
// URL and back through `routes`, so the same screens run in the product and in its design mock:
//   href(query)        the URL of an address
//   parse(url)         the address of a URL, or null when the URL is not a sales screen
//   read(query)        the URL of the screen's read (`POST`, body `{ query }`)
//   command            the path every command form posts to
//   exportHref(query)  the CSV export of the records an address lists
import { createSalesFormat, salesWords } from './format.mjs'

export const salesScreenIds = [
  'overview',
  'pipeline',
  'cases',
  'lead-new',
  'lead-detail',
  'activity-planner',
  'crm-settings',
  'crm-team',
]
export const salesTitles = {
  overview: ['Tổng quan CRM', 'CRM overview'],
  pipeline: ['Pipeline CRM', 'CRM pipeline'],
  cases: ['Hồ sơ bán hàng', 'Sales records'],
  'lead-new': ['Tạo hồ sơ bán hàng', 'Create sales record'],
  'lead-detail': ['Hồ sơ bán hàng', 'Sales record'],
  'activity-planner': ['Công việc & lịch', 'Activities & calendar'],
  'crm-settings': ['Cấu hình CRM', 'CRM configuration'],
  'crm-team': ['Đội nhóm', 'Teams'],
}
// The persona travels between screens; a screen's own filters stay on it.
const persona = ['viewer', 'role', 'lang', 'writeScenario']
// One-shot state: a dialog, a reply, a notice. A link never carries it unless it names it.
const transient = [
  'error',
  'notice',
  'modal',
  'panel',
  'dialog',
  'record',
  'resolve',
  'ids',
  'preview',
  'activity',
  'template',
  'stage',
  'target',
  'memberId',
  'configId',
  'group',
  'scenario',
  'quote',
]
// View state of a page already drawn: following it changes the page, not its data.
export const softParams = ['peek', 'tab', 'bucket']

/** Identity of the data read. Soft keys belong only to the current address, never to cached data. */
export const salesDataQuery = (query) => {
  const params = new URLSearchParams(query)
  for (const key of softParams) params.delete(key)
  params.sort()
  return params.toString()
}

/** The address of `screen`, from the current one: `extra` sets keys, and null or "" removes them. */
export const salesQuery = (screen, query, extra = {}) => {
  const from = new URLSearchParams(query),
    next = new URLSearchParams({ screen })
  if (from.get('screen') === screen) {
    for (const [key, value] of from) if (key !== 'screen' && !transient.includes(key)) next.append(key, value)
  } else for (const key of persona) if (from.has(key)) next.set(key, from.get(key))
  for (const [key, value] of Object.entries(extra))
    if (value === null || value === undefined || value === '') next.delete(key)
    else next.set(key, String(value))
  return next.toString()
}

const checked = (value) => value === true || value === '1' || value === 'on'

export const createSalesKit = ({ view, ds, routes }) => {
  const { html, each } = view
  const {
    ActionGroup,
    Badge,
    Button,
    EmptyState,
    Field,
    FormGrid,
    KetTable,
    LinkButton,
    Notice,
    RecordForm,
    Section,
    Stack,
    Surface,
    Text,
  } = ds
  const hiddenInputs = (values) =>
    each(
      Object.entries(values),
      ([name]) => name,
      ([name, value]) => html`<input autocomplete="off" type="hidden" name=${name} value=${String(value)} />`,
    )

  /**
   * Helpers for one render. `model` is the screen's read (null while it loads); `env` names the screen,
   * its address (`query`), the language and the browser's stable request ids.
   */
  return (model, env) => {
    const lang = env.lang === 'en' ? 'en' : 'vi'
    const fmt = createSalesFormat(lang, model?.clock),
      words = salesWords(lang),
      t = fmt.t
    const query = new URLSearchParams(env.query),
      screen = env.screen
    const href = (target, extra) => routes.href(salesQuery(target, query, extra))
    const here = (extra) => href(screen, extra)
    /** A GET form for `target`: where it submits, and the address keys it carries as hidden fields. */
    const formTarget = (target, extra) => {
      const [action, search = ''] = href(target, extra).split('?')
      return { action, hidden: Object.fromEntries(new URLSearchParams(search)) }
    }
    /** This exact address with some keys changed: a retry or a recovery keeps the dialog and its reply. */
    const same = (extra) => {
      const next = new URLSearchParams(query)
      for (const [key, value] of Object.entries(extra))
        if (value === null || value === undefined || value === '') next.delete(key)
        else next.set(key, String(value))
      return routes.href(next.toString())
    }
    const person = (id) => model?.people.find((p) => p.id === id)?.name ?? ''
    const owner = (id) => person(id) || t('Chưa phân công', 'Unassigned')
    const teamName = (id) => model?.teams.find((x) => x.id === id)?.name ?? ''
    const stageName = (id) => model?.stages.find((s) => s.id === id)?.name ?? id
    const back = (label, target) =>
      LinkButton({ label, href: target, variant: 'secondary', icon: 'chevron-left' })

    const response = model?.response ?? null,
      draft = response?.input ?? {},
      errors = response?.fields ?? {}
    // A reply belongs to the form that sent it: same command, same record, same message or activity.
    const owns = (name, row, extra = {}) =>
      response?.input?.command === name &&
      (!row || response.input.id === row.id) &&
      (!extra.messageId || response.input.messageId === extra.messageId) &&
      (!extra.activityId || response.input.activityId === extra.activityId)
    const hiddenOf = (name, row, extra) => {
      const key = [
        name,
        row?.id ?? '',
        row?.version ?? '',
        extra.messageId ?? extra.activityId ?? extra.quoteId ?? extra.configId ?? extra.memberId ?? '',
        model?.revision ?? '',
      ].join(':')
      return {
        command: name,
        // A retried draft keeps its request id, so a write that did land is not repeated.
        requestId: owns(name, row, extra) && draft.requestId ? draft.requestId : env.requestId(key),
        context: query.toString(),
        viewer: model.actor.id,
        role: model.actor.role,
        lang,
        ...(row ? { id: row.id, version: String(row.version) } : {}),
        // A quick action from the board, the planner or a list returns to it.
        ...(['lead-detail', 'lead-new'].includes(screen) ? {} : { stay: '1' }),
        ...extra,
      }
    }
    const restore = (name, f, mine) => {
      const base = {
        ...f,
        id: f.id ?? `sales-${name}-${f.name}`,
        error: mine && errors[f.name] ? (fmt.en ? 'Check this field.' : errors[f.name]) : (f.error ?? null),
      }
      if (f.fields) return { ...base, fields: f.fields.map((nested) => restore(name, nested, mine)) }
      if (!mine || f.control) return base
      if (f.type === 'checkbox') return { ...base, value: checked(draft[f.name]) }
      if (f.type === 'checkbox-group') {
        const chosen = String(draft[f.name] ?? '')
          .split(',')
          .filter(Boolean)
        return { ...base, options: f.options.map((o) => ({ ...o, checked: chosen.includes(o.value) })) }
      }
      return { ...base, value: draft[f.name] ?? f.value }
    }
    const rejected = () =>
      fmt.en ? 'The action was rejected. Review the highlighted fields.' : response.message

    /**
     * A native command form. Its draft comes back after a refusal; a stale version asks the reader to
     * review the record first, and a simulated outage keeps the draft for a retry.
     */
    const command = (name, label, fields = [], row = null, extra = {}, options = {}) => {
      const mine = owns(name, row, extra)
      const id = options.id ?? `sales-${name}${extra.messageId ? `-${extra.messageId}` : ''}`
      const hidden = hiddenOf(name, row, extra)
      const restored = fields.map((f) => restore(name, f, mine))
      if (mine && response.code === 'E_CONFLICT' && query.get('resolve') !== 'latest')
        return Stack({
          items: [
            Notice({
              tone: 'warning',
              title: t('Cần đối chiếu phiên bản mới', 'Review the latest version'),
              message: t(
                'Hồ sơ đã được người khác cập nhật. Bản nháp của bạn được giữ dưới đây; đọc hồ sơ hiện tại rồi xác nhận dùng bản nháp trên phiên bản mới.',
                'Someone else updated this record. Your draft is retained below; review the current record, then apply the draft to the latest version.',
              ),
              actions: LinkButton({
                label: t('Đã đối chiếu · dùng phiên bản mới', 'Reviewed · use latest version'),
                href: same({ resolve: 'latest' }),
                variant: 'secondary',
              }),
            }),
            FormGrid({
              columns: options.columns ?? 2,
              items: restored.filter((f) => !f.control).map((f) => Field({ ...f, readOnly: true })),
            }),
          ],
        })
      if (options.formOnly)
        return html`<form id=${id} data-crm-command action=${routes.command} method="post">
          ${hiddenInputs(hidden)}${
            mine
              ? Notice({
                  tone: 'danger',
                  title: t('Chưa thể xác nhận', 'Unable to confirm'),
                  message: rejected(),
                })
              : null
          }${
            restored.length
              ? FormGrid({ columns: options.columns ?? 2, items: restored.map((f) => Field(f)) })
              : null
          }
        </form>`
      // A long form reads in sections: the form is ours, one card on the page, its groups DS Sections over
      // the record form's grid, divided by the card's hairlines, and the record form's own action row.
      const form = options.sections
        ? html`<form id=${id} data-crm-command action=${routes.command} method="post">
            ${hiddenInputs(hidden)}${Surface({
              body: Stack({
                items: [
                  mine
                    ? Notice({
                        tone: 'danger',
                        announcement: 'assertive',
                        title: t('Chưa thể lưu', 'Unable to save'),
                        message: rejected(),
                      })
                    : null,
                  Stack({
                    divided: true,
                    items: options.sections.map((section) =>
                      Section({
                        // Fields take `${id}-${name}`; a section's own prefix keeps a name like "source" from colliding.
                        id: `${id}-section-${section.id}`,
                        title: section.title,
                        description: section.description,
                        body: FormGrid({
                          columns: options.columns ?? 2,
                          items: section.fields.map((f) => Field(restored[fields.indexOf(f)])),
                        }),
                      }),
                    ),
                  }),
                  html`<div data-ui="form-actions">
                    ${ActionGroup({
                      actions: [
                        Button({ label, type: 'submit', variant: options.variant ?? 'primary' }),
                        options.cancelHref
                          ? LinkButton({
                              label: t('Hủy', 'Cancel'),
                              href: options.cancelHref,
                              variant: 'tertiary',
                            })
                          : null,
                      ].filter(Boolean),
                    })}
                  </div>`,
                ],
              }),
            })}
          </form>`
        : RecordForm({
            id,
            action: routes.command,
            method: 'post',
            columns: options.columns ?? 2,
            submitLabel: label,
            submitVariant: options.variant ?? 'primary',
            cancelHref: options.cancelHref ?? null,
            cancelLabel: options.cancelHref ? t('Hủy', 'Cancel') : null,
            hidden,
            errors: mine ? [rejected()] : [],
            fields: restored,
          })
      if (!(mine && response.code === 'E_RETRY')) return form
      return Stack({
        items: [
          Notice({
            tone: 'warning',
            title: t('Bản nháp được giữ · chưa ghi dữ liệu', 'Draft retained · nothing written'),
            message: routes.demo
              ? t(
                  'Kết nối mô phỏng đang gián đoạn. Phục hồi kết nối rồi gửi lại bản nháp này.',
                  'The simulated connection is down. Restore it, then submit this draft again.',
                )
              : t(
                  'Máy chủ tạm thời chưa ghi được. Gửi lại bản nháp này.',
                  'The server could not save it for now. Submit this draft again.',
                ),
            actions: routes.demo
              ? LinkButton({
                  label: t('Phục hồi để thử lại', 'Recover to retry'),
                  href: same({ writeScenario: null }),
                  variant: 'secondary',
                })
              : undefined,
          }),
          form,
        ],
      })
    }

    // One-click commands (send a quote, retry an email, add samples) post a hidden form drawn beside the
    // page, so the button can sit anywhere, even inside another form's area.
    const forms = []
    /** The id of the hidden form posting `name`, for a button or a menu item placed anywhere. */
    const formFor = (name, row = null, extra = {}) => {
      const id = [
        'sales',
        name,
        row?.id ?? 'page',
        extra.quoteId ?? extra.messageId ?? extra.activityId ?? extra.orderId ?? '',
      ]
        .filter(Boolean)
        .join('-')
      if (!forms.some((f) => f.id === id))
        forms.push({
          id,
          markup: html`<form id=${id} data-crm-command action=${routes.command} method="post" hidden>
            ${hiddenInputs(hiddenOf(name, row, extra))}
          </form>`,
        })
      return id
    }
    const action = (name, label, row = null, extra = {}, variant = 'secondary') =>
      Button({ label, type: 'submit', form: formFor(name, row, extra), variant, size: 'small' })
    const actionForms = () =>
      each(
        forms,
        (f) => f.id,
        (f) => f.markup,
      )

    const field = (name, label, value = '', extra = {}) => ({ name, label, value, ...extra })
    const choose = (name, label, value, rows, extra = {}) =>
      field(name, label, value, {
        type: 'select',
        options: [
          ...(value === '' && !rows.some((r) => r.id === '')
            ? [{ value: '', label: t('Chưa chọn', 'Not selected') }]
            : []),
          ...rows.map((r) => ({ value: r.id, label: r.name })),
        ],
        ...extra,
      })
    const check = (name, label, value = true, extra = {}) =>
      field(name, label, value, { type: 'checkbox', ...extra })

    const badge = (label, tone = 'neutral') => Badge({ label, tone, size: 'small' })
    const muted = (children) => Text({ children, variant: 'bodySm', tone: 'muted' })
    const lines = (title, detail, tone = 'muted') =>
      Stack({
        gap: 'none',
        items: [
          typeof title === 'string' ? Text({ children: title, variant: 'bodyMd' }) : title,
          ...(detail ? [Text({ children: detail, variant: 'bodySm', tone })] : []),
        ],
      })
    const amount = (value, short = false) =>
      Text({ children: short ? fmt.short(value) : fmt.money(value), variant: 'bodyMd', numeric: true })
    // Every table is the suite's KetTable. A titled one sits in a Surface that runs its rows edge to
    // edge and keeps its inset while empty; a row links to its subject instead of carrying buttons.
    const tableLabels = {
      selectAll: t('Chọn tất cả', 'Select all'),
      selectRow: t('Chọn dòng', 'Select row'),
      sortedAscending: t('Tăng dần', 'Ascending'),
      sortedDescending: t('Giảm dần', 'Descending'),
      previousPage: t('Trang trước', 'Previous page'),
      nextPage: t('Trang sau', 'Next page'),
      loading: t('Đang tải', 'Loading'),
      loadError: t('Chưa tải được', 'Unable to load'),
      retry: t('Thử lại', 'Retry'),
      empty: t('Chưa có dữ liệu', 'Nothing here yet'),
      emptyHint: t('Các mục sẽ xuất hiện khi có dữ liệu.', 'Items appear here once there is data.'),
    }
    const table = ({
      title = null,
      description = null,
      actions,
      label,
      rows,
      columns,
      emptyTitle,
      emptyMessage,
      emptyActions,
      ...rest
    }) => {
      const content = rows.length
        ? KetTable({
            id: (row) => String(row.id),
            caption: null,
            responsive: 'stack',
            ...rest,
            columns,
            rows,
            labels: { ...tableLabels, region: label ?? title ?? undefined },
          })
        : EmptyState({
            title: emptyTitle ?? tableLabels.empty,
            message: emptyMessage ?? tableLabels.emptyHint,
            actions: emptyActions,
          })
      return title
        ? Surface({ title, description, actions, padding: rows.length ? 'none' : 'default', body: content })
        : content
    }

    // The outcome of the last command, said once, on the page it returned to.
    const notice = () => {
      if (!model?.notice) return null
      const skipped = model.notice.bulk?.some((r) => r.state === 'skipped')
      return Notice({
        tone: skipped ? 'warning' : 'positive',
        announcement: 'polite',
        title: skipped
          ? t('Đã xử lý · có hồ sơ bị bỏ qua', 'Processed · some records were skipped')
          : t('Đã lưu', 'Saved'),
        message: model.notice.message || t('Thay đổi đã được ghi.', 'The change was recorded.'),
      })
    }
    // A refusal whose form is not on screen (a drag on the board, a one-click action) is said on the page.
    const refusal = (inline = []) => {
      if (!response || model?.dialog || inline.includes(draft.command)) return null
      return Notice({
        tone: response.code === 'E_CONFLICT' ? 'warning' : 'danger',
        announcement: 'assertive',
        title:
          response.code === 'E_CONFLICT'
            ? t('Hồ sơ vừa được người khác cập nhật', 'The record was just updated by someone else')
            : t('Chưa thực hiện được thao tác', 'The action was not completed'),
        message: fmt.en
          ? 'Nothing was changed. Review the record and try again.'
          : `${response.message} Chưa có thay đổi nào được ghi.`,
      })
    }

    return {
      model,
      env,
      lang,
      fmt,
      words,
      t,
      query,
      screen,
      href,
      here,
      formTarget,
      same,
      routes,
      person,
      owner,
      teamName,
      stageName,
      back,
      response,
      draft,
      errors,
      owns,
      command,
      action,
      formFor,
      actionForms,
      field,
      choose,
      check,
      badge,
      muted,
      lines,
      amount,
      table,
      notice,
      refusal,
      checked,
    }
  }
}
