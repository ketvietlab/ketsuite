import { html, signal } from '@ketvietlab/ketjs-view'
import type { IslandMountContext, JSXChild } from '@ketvietlab/ketjs-view'
import { requestedPage } from './collection-query.ts'
import {
  ActionGroup,
  attachClientModalInteractions,
  Badge,
  Button,
  ConfirmDialog,
  DatePicker,
  EmptyState,
  Field,
  FormGrid,
  KetTable,
  ListChrome,
  Notice,
  Stack,
} from '@ketvietlab/design-system'

type Row = Record<string, unknown>
type Page = {
  query: Row
  total: number
  page: number
  pages: number
  rows: Row[]
  counts: Row
  isEmpty: boolean
}
export type CommunicationProps = {
  id: string
  kind: 'inbox' | 'outbox' | 'activity'
  path: string
  query: Row
  labels: Record<string, string>
  canRead: boolean
  canWrite: boolean
  canApprove: boolean
  permissions: Record<string, boolean>
  lang: string
}
const functions = {
  inbox: 'mail.searchInbox',
  outbox: 'mail_transport.searchOutbox',
  activity: 'activity.searchMine',
}
const stores = new Map<string, ReturnType<typeof makeStore>>()

function makeStore(props: CommunicationProps) {
  const page = signal<Page | null>(null)
  const status = signal(props.canRead ? 'loading' : 'denied')
  const busy = signal(false)
  const selected = signal<string[]>([])
  const cache = new Map<string, Page>()
  let request: AbortController | null = null
  let generation = 0
  let dimTimer: ReturnType<typeof setTimeout> | null = null
  let refs = 0
  let started = false
  let query = { ...props.query }
  const href = (patch: Row) => {
    const url = new URL(props.path, 'http://local.invalid')
    for (const [key, value] of Object.entries({ ...query, ...patch }))
      url.searchParams.set(key, String(value))
    return `${url.pathname}${url.search}`
  }
  const load = async (force = false) => {
    if (!props.canRead) return
    if (dimTimer) clearTimeout(dimTimer)
    const current = ++generation
    request?.abort()
    request = new AbortController()
    const key = JSON.stringify(query)
    if (!force && cache.has(key)) {
      page.set(cache.get(key)!)
      status.set('ready')
    }
    if (page()) dimTimer = setTimeout(() => busy.set(true), 150)
    else status.set('loading')
    try {
      const response = await fetch(`/_ket/fn/${functions[props.kind]}`, {
        method: 'POST',
        credentials: 'same-origin',
        signal: request.signal,
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(query),
      })
      const result = await response.json()
      if (!response.ok || result.ok === false)
        throw Object.assign(new Error('read failed'), { status: response.status })
      if (current !== generation) return
      const value = result.value as Page
      page.set(value)
      status.set('ready')
      selected.set([])
      queueMicrotask(() => {
        if (current !== generation || refs === 0) return
        const form = document.getElementById(`${props.id}-commands`)
        if (form instanceof HTMLFormElement) form.reset()
      })
      cache.delete(key)
      cache.set(key, value)
      if (cache.size > 20) cache.delete(cache.keys().next().value!)
      if (Object.entries(value.query).some(([name, value]) => query[name] !== value)) {
        query = value.query
        history.replaceState({}, '', href({}))
      }
    } catch (error) {
      if (current !== generation || request.signal.aborted) return
      page.set(null)
      status.set(
        (error as { status?: number }).status === 403
          ? 'denied'
          : navigator.onLine === false
            ? 'offline'
            : 'error',
      )
    } finally {
      if (current === generation) {
        if (dimTimer) clearTimeout(dimTimer)
        busy.set(false)
      }
    }
  }
  const readUrl = () => {
    const url = new URL(location.href)
    query = {
      page: requestedPage(url.searchParams.get('page')),
      pageSize: 25,
      ...(props.kind === 'inbox'
        ? { unreadOnly: url.searchParams.get('unreadOnly') !== 'false' }
        : props.kind === 'outbox'
          ? { state: url.searchParams.get('state') || '' }
          : { includeDone: url.searchParams.get('includeDone') === 'true' }),
    }
  }
  const pop = () => {
    readUrl()
    void load()
  }
  const online = () => {
    void load(true)
  }
  const navigate = (event: Event) => {
    const link = (event.target as Element).closest('a[href]') as HTMLAnchorElement | null
    if (!link?.closest('[data-communication-navigation]') || event.defaultPrevented) return
    if (
      event instanceof MouseEvent &&
      (event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey)
    )
      return
    const next = new URL(link.href)
    if (next.origin !== location.origin || next.pathname !== location.pathname) return
    event.preventDefault()
    history.pushState({}, '', `${next.pathname}${next.search}`)
    pop()
  }
  return {
    page,
    status,
    busy,
    selected,
    href,
    load,
    invalidate: () => {
      cache.clear()
      return load(true)
    },
    mount(root: Element) {
      refs++
      root.addEventListener('click', navigate)
      if (!started) {
        started = true
        window.addEventListener('popstate', pop)
        window.addEventListener('online', online)
        readUrl()
        void load()
      }
      return () => {
        root.removeEventListener('click', navigate)
        if (--refs === 0) {
          generation++
          request?.abort()
          if (dimTimer) clearTimeout(dimTimer)
          window.removeEventListener('popstate', pop)
          window.removeEventListener('online', online)
          stores.delete(props.id)
        }
      }
    },
  }
}

const formatInstant = (value: unknown, lang: string) => {
  const date = new Date(String(value))
  return Number.isNaN(date.getTime())
    ? ''
    : new Intl.DateTimeFormat(lang === 'en' ? 'en-US' : 'vi-VN', {
        dateStyle: 'short',
        timeStyle: 'short',
      }).format(date)
}

const targetPath = (row: Row) => {
  if (row.targetHref) return String(row.targetHref)
  const paths: Record<string, string> = {
    'partner.Partner': '/admin/partner/partners',
    'product.Template': '/admin/product/templates',
    'stock.Picking': '/admin/stock/transfers',
    'sale.Order': '/admin/sales/quotations',
    'crm.Case': '/admin/crm/cases',
  }
  const path = paths[String(row.resModel)]
  return path && row.resId ? `${path}/${encodeURIComponent(String(row.resId))}` : null
}

export function communicationCollection(props: CommunicationProps, part: 'controls' | 'results' | 'footer') {
  const store =
    typeof document === 'undefined' ? makeStore(props) : (stores.get(props.id) ?? makeStore(props))
  if (typeof document !== 'undefined') stores.set(props.id, store)
  const l = props.labels
  const feedback = signal('')
  const dueDate = signal('')
  const commandError = signal(false)
  let commandRequest: AbortController | null = null
  let draftId = ''
  let cleanup: (() => void) | undefined
  let modalCleanup: (() => void) | undefined
  let mountedRoot: Element | undefined
  const confirm = signal(false)
  const closeConfirm = () => {
    modalCleanup?.()
    modalCleanup = undefined
    confirm.set(false)
  }
  const openConfirm = () => {
    confirm.set(true)
    queueMicrotask(() => {
      modalCleanup = attachClientModalInteractions(document)
    })
  }
  const click = (event: Event) => {
    const element = event.target as Element
    if (element.closest('[data-client-modal-close], [data-ui="modal-close"]')) closeConfirm()
    const button = element.closest('button')
    if (button?.disabled) return
    if (button?.id === `${props.id}-cancel-open`) openConfirm()
    if (button?.id === `${props.id}-read-retry`) void store.load(true)
  }
  const submit = async (event: Event) => {
    if (!(event.target instanceof HTMLFormElement)) return
    event.preventDefault()
    if (store.busy()) return
    const form = event.target
    const button = (event as SubmitEvent).submitter as HTMLButtonElement | null
    const action = button?.value
    if (!action) return
    event.preventDefault()
    const values = new FormData(form)
    draftId = String(values.get('id') ?? '')
    feedback.set(String(values.get('feedback') ?? ''))
    dueDate.set(String(values.get('dueDate') ?? ''))
    const key =
      props.kind === 'inbox'
        ? action === 'readAll'
          ? 'mail.markAllInboxRead'
          : 'mail.markInboxRead'
        : props.kind === 'outbox'
          ? `mail_transport.${action}`
          : `activity.${action}`
    const input =
      props.kind === 'inbox'
        ? { ...(action === 'readAll' ? {} : { id: values.get('id') }), readAt: new Date().toISOString() }
        : {
            id: values.get('id'),
            ...(action === 'complete'
              ? { feedback: feedback() }
              : action === 'reschedule'
                ? { dueDate: dueDate() }
                : {}),
          }
    commandRequest = new AbortController()
    commandError.set(false)
    store.busy.set(true)
    confirm.set(false)
    modalCleanup?.()
    try {
      const response = await fetch(`/_ket/fn/${key}`, {
        method: 'POST',
        credentials: 'same-origin',
        signal: commandRequest.signal,
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(input),
      })
      const result = await response.json()
      if (!response.ok || result.ok === false || result.value?.ok === false)
        throw new Error('command refused')
      feedback.set('')
      dueDate.set('')
      await store.invalidate()
      window.dispatchEvent(new Event('ket:mail-changed'))
    } catch {
      if (!commandRequest.signal.aborted) commandError.set(true)
    } finally {
      store.busy.set(false)
    }
  }
  const selectedRow = () =>
    store.selected().length === 1
      ? store.page()?.rows.find((row) => String(row.id) === store.selected()[0])
      : null
  const commands = (): JSXChild => {
    const row = selectedRow()
    const enabled = Boolean(row) && !store.busy()
    const buttons: JSXChild[] = []
    if (props.kind === 'inbox') {
      if (props.canWrite)
        buttons.push(
          <Button
            label={l.markRead}
            type="submit"
            name="action"
            value="read"
            disabled={!enabled || row?.readAt != null}
          />,
        )
      if (props.permissions.readAll)
        buttons.push(
          <Button
            label={l.markAll}
            type="submit"
            name="action"
            value="readAll"
            disabled={!store.page() || Number(store.page()?.counts.unread ?? 0) === 0}
          />,
        )
    } else if (props.kind === 'outbox') {
      if (props.canWrite)
        buttons.push(
          <Button
            label={l.retry}
            type="submit"
            name="action"
            value="retry"
            disabled={!enabled || !['failed', 'retryable'].includes(String(row?.state))}
          />,
        )
      if (props.canApprove)
        buttons.push(
          <Button
            id={`${props.id}-cancel-open`}
            label={l.cancel}
            type="button"
            disabled={!enabled || row?.state !== 'queued'}
            variant="destructive"
          />,
        )
    } else {
      if (props.permissions.complete)
        buttons.push(
          <Button
            label={l.complete}
            type="submit"
            name="action"
            value="complete"
            disabled={!enabled || row?.active !== true}
          />,
        )
      if (props.canWrite)
        buttons.push(
          <Button
            label={l.reschedule}
            type="submit"
            name="action"
            value="reschedule"
            disabled={!enabled || row?.active !== true}
          />,
        )
      if (props.canApprove)
        buttons.push(
          <Button
            id={`${props.id}-cancel-open`}
            label={l.cancel}
            type="button"
            disabled={!enabled || row?.active !== true}
            variant="destructive"
          />,
        )
    }
    const fields =
      props.kind === 'activity' && row?.active === true ? (
        <FormGrid
          items={[
            <Field
              id={`${props.id}-feedback`}
              name="feedback"
              label={l.feedback}
              type="text"
              layout="inline"
              value={draftId === String(row.id) ? feedback() : ''}
            />,
            <DatePicker
              id={`${props.id}-date`}
              name="dueDate"
              label={l.dueDate}
              layout="inline"
              value={(draftId === String(row.id) ? dueDate() : '') || String(row.dueDate)}
              locale={props.lang === 'en' ? 'en' : 'vi'}
              today={String(store.page()?.counts.today ?? '')}
            />,
          ]}
        />
      ) : null
    return (
      <form id={`${props.id}-commands`} method="post" action={props.path}>
        <input type="hidden" name="id" value={String(row?.id ?? '')} autocomplete="off" />
        <Stack
          items={[
            fields,
            <ActionGroup actions={buttons} />,
            commandError() && draftId === String(row?.id ?? '') ? (
              <Notice tone="danger" title={l.actionErrorTitle} message={l.actionError} />
            ) : null,
            confirm() ? (
              <ConfirmDialog
                id={`${props.id}-cancel`}
                title={l.cancel}
                message={l.cancelConfirm}
                mode="client"
                closeHref={props.path}
                closeLabel={l.close}
                confirmLabel={l.cancel}
                confirmName="action"
                confirmValue="cancel"
                confirmForm={`${props.id}-commands`}
              />
            ) : null,
          ]}
        />
      </form>
    )
  }
  const view = () => {
    const data = store.page()
    if (part === 'controls') {
      const facets =
        props.kind === 'outbox'
          ? ['', 'queued', 'sending', 'retryable', 'sent', 'failed', 'cancelled'].map((state) => ({
              id: state || 'all',
              label: state ? l[`state.${state}`] : l.all,
              href: store.href({ state, page: 1 }),
              active: String(data?.query.state ?? props.query.state ?? '') === state,
            }))
          : [false, true].map((all) => ({
              id: all ? 'all' : 'open',
              label: all ? l.all : props.kind === 'inbox' ? l.unread : l.open,
              href: store.href({
                ...(props.kind === 'inbox' ? { unreadOnly: !all } : { includeDone: all }),
                page: 1,
              }),
              active:
                props.kind === 'inbox'
                  ? Boolean(data?.query.unreadOnly ?? props.query.unreadOnly) === !all
                  : Boolean(data?.query.includeDone ?? props.query.includeDone) === all,
            }))
      return (
        <div data-communication-navigation>
          <ListChrome
            filtersLabel={l.filters}
            facets={facets}
            actions={props.kind === 'activity' ? undefined : commands()}
            commands={props.kind === 'activity' ? commands() : undefined}
            status={store.selected().length ? `${l.selected}: ${store.selected().length}` : undefined}
          />
        </div>
      )
    }
    if (part === 'footer') {
      if (!data) return html`<span role="status" aria-live="polite"></span>`
      const size = Number(data.query.pageSize)
      const range = data.total
        ? `${(data.page - 1) * size + 1}–${Math.min(data.page * size, data.total)} / ${data.total}`
        : '0'
      return (
        <div data-communication-navigation>
          <ListChrome
            pager={{
              summary: (
                <span role="status" aria-live="polite">
                  {range}
                </span>
              ),
              label: l.pagination,
              previousLabel: l.previous,
              nextLabel: l.next,
              previousHref: data.page > 1 ? store.href({ page: data.page - 1 }) : null,
              nextHref: data.page < data.pages ? store.href({ page: data.page + 1 }) : null,
            }}
          />
        </div>
      )
    }
    const state = store.status()
    if (state === 'denied') return <EmptyState title={l.denied} message="" visual="locked" />
    if (state === 'error' || state === 'offline')
      return (
        <Notice
          tone="danger"
          title={l.error}
          message={state === 'offline' ? l.offline : ''}
          actions={<Button id={`${props.id}-read-retry`} label={l.retry} />}
        />
      )
    if (state === 'ready' && data?.rows.length === 0)
      return (
        <EmptyState
          title={data.isEmpty ? l.empty : l.filteredEmpty}
          message={l.emptyHint}
          visual={data.isEmpty ? 'done' : 'search'}
        />
      )
    const columns = [
      {
        key: 'subject',
        label: l.subject,
        cell: (row: Row) => {
          const href = targetPath(row)
          const title = String(
            props.kind === 'inbox'
              ? row.subject || row.targetName || l.message
              : props.kind === 'outbox'
                ? row.templateName || l.message
                : row.summary,
          )
          return href ? <a href={`${href}${props.lang === 'en' ? '?lang=en' : ''}`}>{title}</a> : title
        },
      },
      {
        key: 'body',
        label: l.details,
        cell: (row: Row) =>
          String(
            props.kind === 'inbox'
              ? row.body
              : props.kind === 'outbox'
                ? row.failureCode
                  ? l.failed
                  : row.targetName || ''
                : row.note || '',
          ),
      },
      {
        key: 'state',
        label: l.state,
        cell: (row: Row) => (
          <Badge
            tone={['failed', 'overdue'].includes(String(row.state)) ? 'danger' : 'neutral'}
            label={
              props.kind === 'inbox'
                ? l[`kind.${String(row.kind)}`]
                : l[`state.${String(row.state)}`] || l.message
            }
          />
        ),
      },
      {
        key: 'date',
        label: props.kind === 'activity' ? l.dueDate : l.createdAt,
        cell: (row: Row) =>
          props.kind === 'activity'
            ? String(row.dueDate)
            : formatInstant(row.createdAt || row.queuedAt, props.lang),
      },
    ]
    return (
      <KetTable
        columns={columns}
        rows={data?.rows ?? []}
        id={(row) => String(row.id)}
        rowLink={false}
        responsive="stack"
        busy={store.busy()}
        loading={state === 'loading' ? { rows: 5 } : undefined}
        selection={{ formId: `${props.id}-commands` }}
        selectionState={{ ids: store.selected(), onChange: (ids) => store.selected.set(ids) }}
        labels={{
          selectAll: l.selectAll,
          selectRow: l.selectRow,
          sortedAscending: l.ascending,
          sortedDescending: l.descending,
          previousPage: l.previous,
          nextPage: l.next,
          loading: l.loading,
          loadError: l.error,
          retry: l.retry,
          empty: l.empty,
          emptyHint: l.emptyHint,
        }}
      />
    )
  }
  return {
    view,
    mount: ({ root }: IslandMountContext) => {
      if (!(root instanceof Element)) return
      mountedRoot = root
      cleanup = store.mount(root)
      root.addEventListener('click', click)
      if (part === 'controls') root.addEventListener('submit', submit)
    },
    dispose: () => {
      modalCleanup?.()
      commandRequest?.abort()
      mountedRoot?.removeEventListener('submit', submit)
      mountedRoot?.removeEventListener('click', click)
      cleanup?.()
    },
  }
}

export const collectionControls = (props: CommunicationProps) => communicationCollection(props, 'controls')
export const collectionResults = (props: CommunicationProps) => communicationCollection(props, 'results')
export const collectionFooter = (props: CommunicationProps) => communicationCollection(props, 'footer')
