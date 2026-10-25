import { randomUUID } from 'node:crypto'
import type { Route, ServeContext } from '@ketvietlab/ketjs'
import type { CommunicationProps } from '../../ui/client/communication-collections.tsx'
import { requestedPage } from '../../ui/client/collection-query.ts'

export async function collectionScreenData(
  ctx: ServeContext,
  url: URL,
  req: Parameters<Route>[1],
  kind: CommunicationProps['kind'],
) {
  const lang = ctx.localeOf(url, req)
  const _ = ctx.translate(lang)
  const keys = [
    'cancelConfirm',
    'close',
    'unread',
    'filters',
    'selected',
    'actionError',
    'pagination',
    'actionErrorTitle',
    'all',
    'open',
    'markRead',
    'markAll',
    'retry',
    'cancel',
    'complete',
    'reschedule',
    'feedback',
    'dueDate',
    'previous',
    'next',
    'selectOne',
    'denied',
    'offline',
    'error',
    'empty',
    'filteredEmpty',
    'emptyHint',
    'subject',
    'details',
    'state',
    'createdAt',
    'message',
    'failed',
    'selectAll',
    'selectRow',
    'ascending',
    'descending',
    'loading',
    'kind.comment',
    'kind.note',
    'kind.system',
    'kind.email',
    'state.queued',
    'state.sending',
    'state.retryable',
    'state.sent',
    'state.failed',
    'state.cancelled',
    'state.overdue',
    'state.today',
    'state.planned',
    'state.done',
    'state.canceled',
  ]
  const labels = Object.fromEntries(keys.map((key) => [key, _(`mail_backend.collection.${key}`)]))
  const read = {
    inbox: 'mail.searchInbox',
    outbox: 'mail_transport.searchOutbox',
    activity: 'activity.searchMine',
  }[kind]
  const write = {
    inbox: 'mail.markInboxRead',
    outbox: 'mail_transport.retry',
    activity: 'activity.reschedule',
  }[kind]
  const approve = {
    inbox: 'mail.markAllInboxRead',
    outbox: 'mail_transport.cancel',
    activity: 'activity.cancel',
  }[kind]
  const props: CommunicationProps = {
    id: `communication-${randomUUID()}`,
    kind,
    path: `${url.pathname}${url.search}`,
    lang,
    query: {
      page: requestedPage(url.searchParams.get('page')),
      pageSize: 25,
      ...(kind === 'inbox'
        ? { unreadOnly: url.searchParams.get('unreadOnly') !== 'false' }
        : kind === 'outbox'
          ? { state: url.searchParams.get('state') || '' }
          : { includeDone: url.searchParams.get('includeDone') === 'true' }),
    },
    permissions: {
      readAll: await ctx.allows('mail.markAllInboxRead', url, req),
      complete: await ctx.allows('activity.complete', url, req),
    },
    labels,
    canRead: await ctx.allows(read, url, req),
    canWrite: await ctx.allows(write, url, req),
    canApprove: await ctx.allows(approve, url, req),
  }
  const [controls, results, footer] = await Promise.all(
    ['controls', 'results', 'footer'].map((part) =>
      ctx.joint(url, req, `mail_backend:collection.${part}`, props),
    ),
  )
  return { controls, results, footer }
}
