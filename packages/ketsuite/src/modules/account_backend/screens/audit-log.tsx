import type { Translator } from '@ketvietlab/ketjs'
import { DescriptionList, Link } from '@ketvietlab/design-system'
import type { JSXChild, TemplateResult } from '@ketvietlab/ketjs-view'
import {
  badge,
  collectionActions,
  collectionControls,
  collectionTable,
  dataTable,
  emptyState,
  icon,
  ListPage,
  ModalSheet,
  prepareCollectionTable,
  Section,
  shell,
  stack,
  Surface,
} from '../../../ui/index.ts'
import type { DataTable, Frame } from '../../../ui/index.ts'
import { labelOf } from './shared.tsx'

/**
 * One audit event as the screen shows it. The route puts on what the domain row
 * does not carry: who `actorName` is, what the subject and related record are
 * called, where they open, and the instant in the reader's time zone.
 */
export type AuditEventRow = Record<string, unknown> & {
  actorName: string
  subjectName: string
  subjectHref: string | null
  relatedName: string | null
  relatedHref: string | null
  when: string
}

export type AuditDetail = { id: string; label: string; value: string; href?: string | null }

/** One field an edit changed, already read the way the screen shows it. */
export type AuditChange = { id: string; label: string; before: string; after: string }

export type AuditLogScreenOptions = {
  frame: Frame
  rows: AuditEventRow[]
  rowHref: (row: AuditEventRow) => string
  summary: { total: number; posted: number; reversed: number }
  table?: Partial<DataTable<AuditEventRow>>
}

const actionTone = (action: unknown) =>
  action === 'posted' ? 'positive' : action === 'reversed' ? 'warning' : 'neutral'

const actionBadge = (_: Translator, row: AuditEventRow) =>
  badge(labelOf(_, 'auditAction', row.action), actionTone(row.action), String(row.action))

const subjectLabel = (_: Translator, row: AuditEventRow) =>
  `${labelOf(_, 'auditSubject', row.subjectType)} · ${row.subjectName}`

const linked = (label: string, href: string | null | undefined): JSXChild =>
  href ? <Link href={href} label={label} /> : label

export const auditLogScreen = (_: Translator, options: AuditLogScreenOptions): TemplateResult => {
  const title = _('account_backend.audit.title')
  const status = [
    `${_('account_backend.audit.summary.total')}: ${String(options.summary.total)}`,
    `${_('account_backend.audit.summary.posted')}: ${String(options.summary.posted)}`,
    `${_('account_backend.audit.summary.reversed')}: ${String(options.summary.reversed)}`,
  ].join(' · ')
  const collection = prepareCollectionTable(_, options.frame, {
    rows: options.rows,
    id: (row) => String(row.id),
    rowHref: options.rowHref,
    columns: [
      {
        key: 'createdAt',
        label: _('account_backend.audit.when'),
        priority: 'primary',
        cell: (row) => row.when,
      },
      {
        key: 'actorName',
        label: _('account_backend.audit.actor'),
        cell: (row) => row.actorName,
      },
      {
        key: 'action',
        label: _('account_backend.audit.action'),
        kind: 'status',
        cell: (row) => actionBadge(_, row),
      },
      {
        key: 'subject',
        label: _('account_backend.audit.subject'),
        width: 'wide',
        cell: (row) => subjectLabel(_, row),
      },
      {
        key: 'accountingDate',
        label: _('account_backend.field.accountingDate'),
        cell: (row) => String(row.accountingDate ?? '—').slice(0, 10),
      },
      {
        key: 'reason',
        label: _('account_backend.audit.reason'),
        width: 'wide',
        cell: (row) => String(row.reason ?? '—'),
      },
    ],
    ...options.table,
  })
  const table =
    options.rows.length || options.table?.groups?.length ? (
      collectionTable(_, collection.table)
    ) : (
      <Surface
        padding="compact"
        body={emptyState(_('account_backend.audit.empty'), _('account_backend.audit.emptyHint'), {
          icon: icon('history'),
        })}
      />
    )

  return shell(
    _,
    title,
    <ListPage
      variant="operational"
      frame={collection.frame}
      title={title}
      actions={collectionActions(_, collection.frame)}
      controls={collectionControls(_, title, collection.frame)}
      footer={status}
      body={table}
    />,
    { ...collection.frame, chrome: null, topbar: false },
  )
}

/** One event, read only: nothing here can be changed, so the modal never asks before closing. */
export const auditEventModal = (
  _: Translator,
  options: { event: AuditEventRow; details: AuditDetail[]; changes?: AuditChange[]; closeHref: string },
): TemplateResult => {
  const changes = options.changes ?? []
  const { event } = options
  const facts = [
    { id: 'when', label: _('account_backend.audit.when'), value: event.when },
    { id: 'actor', label: _('account_backend.audit.actor'), value: event.actorName },
    { id: 'action', label: _('account_backend.audit.action'), value: actionBadge(_, event) },
    {
      id: 'subject',
      label: _('account_backend.audit.subject'),
      value: linked(subjectLabel(_, event), event.subjectHref),
    },
    {
      id: 'accountingDate',
      label: _('account_backend.field.accountingDate'),
      value: String(event.accountingDate ?? '—').slice(0, 10),
    },
    { id: 'reason', label: _('account_backend.audit.reason'), value: String(event.reason ?? '—') },
    ...(event.relatedName
      ? [
          {
            id: 'related',
            label: _('account_backend.audit.related'),
            value: linked(event.relatedName, event.relatedHref),
          },
        ]
      : []),
  ]
  return (
    <ModalSheet
      id="account-audit-event"
      title={`${labelOf(_, 'auditAction', event.action)} · ${event.subjectName}`}
      closeHref={options.closeHref}
      closeLabel={_('account_backend.audit.close')}
      presentation="dialog"
      body={stack(
        [
          <Surface padding="compact" body={<DescriptionList items={facts} columns={2} />} />,
          changes.length ? (
            <Section
              title={_('account_backend.audit.changes')}
              body={
                <Surface
                  padding="compact"
                  body={dataTable(_, {
                    rows: changes,
                    id: (row) => row.id,
                    columns: [
                      {
                        key: 'field',
                        label: _('account_backend.audit.field'),
                        priority: 'primary',
                        cell: (row) => row.label,
                      },
                      { key: 'before', label: _('account_backend.audit.before'), cell: (row) => row.before },
                      { key: 'after', label: _('account_backend.audit.after'), cell: (row) => row.after },
                    ],
                  })}
                />
              }
            />
          ) : null,
          // An edit's changes are its details; the empty "no further details" would only repeat that.
          changes.length && !options.details.length ? null : (
            <Section
              title={_('account_backend.audit.details')}
              body={
                <Surface
                  padding="compact"
                  body={
                    options.details.length ? (
                      <DescriptionList
                        items={options.details.map((detail) => ({
                          id: detail.id,
                          label: detail.label,
                          value: linked(detail.value, detail.href),
                        }))}
                        columns={1}
                      />
                    ) : (
                      _('account_backend.audit.noDetails')
                    )
                  }
                />
              }
            />
          ),
        ],
        'default',
      )}
    />
  )
}
