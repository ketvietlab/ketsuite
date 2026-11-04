import type { Translator } from '@ketvietlab/ketjs'
import { DescriptionList, Link, Notice, Stack } from '@ketvietlab/design-system'
import type { TemplateResult } from '@ketvietlab/ketjs-view'
import {
  badge,
  collectionActions,
  collectionControls,
  collectionTable,
  dataTable,
  Disclosure,
  emptyState,
  icon,
  ListPage,
  prepareCollectionTable,
  RecordForm,
  RecordScreen,
  RecordWorkspace,
  Section,
  shell,
  stack,
  Surface,
} from '../../../ui/index.ts'
import type { DataTable, FormField, Frame } from '../../../ui/index.ts'

type Row = Record<string, unknown>
const closeBadge = (_: Translator, state: unknown) => {
  const value = String(state)
  return badge(
    _(`account_backend.wave1.state.${value}`),
    value === 'hard_closed'
      ? 'positive'
      : value === 'soft_closed'
        ? 'info'
        : value === 'open'
          ? 'warning'
          : 'neutral',
    value,
  )
}

export const periodClosesListScreen = (
  _: Translator,
  options: {
    frame: Frame
    rows: Row[]
    action: string
    fields: FormField[]
    rowHref: (row: Row) => string
    /** What the search-filter bar decided about the table, such as its groups. */
    table?: Partial<DataTable<Row>>
    errors?: string[]
  },
): TemplateResult => {
  const collection = prepareCollectionTable(
    _,
    options.frame,
    {
      rows: options.rows,
      id: (row) => String(row.id),
      rowHref: options.rowHref,
      columns: [
        {
          key: 'period',
          label: _('account_backend.close.period'),
          priority: 'primary',
          cell: (row) => String(row.periodKey),
        },
        {
          key: 'range',
          label: _('account_backend.close.range'),
          cell: (row) => `${String(row.dateFrom)} – ${String(row.dateTo)}`,
        },
        {
          key: 'state',
          label: _('account_backend.field.state'),
          kind: 'status',
          cell: (row) => closeBadge(_, row.state),
        },
        {
          key: 'blockers',
          label: _('account_backend.close.blockers'),
          cell: (row) => String(row.blockerCount),
          align: 'end',
        },
      ],
      ...options.table,
    },
    { paginate: !options.table?.groups },
  )
  return shell(
    _,
    _('account_backend.close.title'),
    <ListPage
      variant="operational"
      frame={collection.frame}
      title={_('account_backend.close.title')}
      controls={collectionControls(_, _('account_backend.close.title'), collection.frame)}
      footer={`${_('account_backend.close.summary')}: ${String(options.rows.length)}`}
      actions={collectionActions(_, collection.frame)}
      body={stack([
        <Disclosure
          summary={_('account_backend.close.create')}
          open={Boolean(options.errors?.length)}
          body={
            <Section
              title={_('account_backend.close.create')}
              description={_('account_backend.close.createHint')}
              body={
                <Surface
                  body={
                    <RecordForm
                      id="close-create-form"
                      scope="close-create"
                      action={options.action}
                      submit={_('account_backend.close.create')}
                      submitVariant="secondary"
                      fields={options.fields}
                      errors={options.errors}
                    />
                  }
                />
              }
            />
          }
        />,
        options.rows.length || options.table?.groups?.length ? (
          collectionTable(_, collection.table)
        ) : (
          <Surface
            padding="compact"
            body={emptyState(_('account_backend.close.empty'), _('account_backend.close.emptyHint'), {
              icon: icon('calendar-check'),
            })}
          />
        ),
      ])}
    />,
    { ...collection.frame, chrome: null, topbar: false },
  )
}

const DRAFT_LISTS = ['customerInvoices', 'vendorBills', 'entries'] as const
type DraftList = (typeof DRAFT_LISTS)[number]

/**
 * What a check found, said where it can be acted on: drafts one line per list
 * that still holds them, each opening that list filtered to the period's drafts,
 * and the balance check opening the trial balance it was read from.
 */
const stepEvidence = (
  _: Translator,
  row: Row,
  links: { drafts?: Partial<Record<DraftList, string>>; trialBalance?: string } | undefined,
) => {
  const evidence = (row.evidence ?? {}) as Row
  if (row.code === 'draft_moves') {
    const lists = (evidence.lists ?? {}) as Partial<Record<DraftList, unknown>>
    const lines = DRAFT_LISTS.filter((list) => Number(lists[list] ?? 0) > 0).map((list) => {
      const label = _(`account_backend.close.drafts.${list}`, { count: Number(lists[list]) })
      const href = links?.drafts?.[list]
      return href ? <Link href={href} label={label} /> : label
    })
    return lines.length ? stack(lines, 'compact') : ''
  }
  if (row.code === 'trial_balance' && links?.trialBalance)
    return <Link href={links.trialBalance} label={_('account_backend.close.openTrialBalance')} />
  return ''
}

export const periodCloseDetailScreen = (
  _: Translator,
  options: {
    frame: Frame
    period: Row
    steps: Row[]
    evidence?: Row[]
    countWarnings?: { name: string; href: string }[]
    action: string
    errors?: string[]
    /** The chief accountant's controls form; absent for a reader who may not set them. */
    controls?: { users: readonly { id: string; name: string }[] } | null
    /** Names of the people the period lets post, for a reader without the form. */
    people?: readonly { id: string; name: string }[]
    /**
     * Where each check sends the accountant: every list still holding drafts in
     * the period, filtered to them, and the trial balance of the same dates.
     * Absent for a reader who may not open them.
     */
    links?: { drafts?: Partial<Record<DraftList, string>>; trialBalance?: string }
  },
): TemplateResult => (
  <RecordScreen
    translator={_}
    title={`${_('account_backend.close.period')} ${String(options.period.periodKey)}`}
    frame={options.frame}
    body={
      <RecordWorkspace
        kicker={_('account_backend.close.title')}
        title={`${_('account_backend.close.period')} ${String(options.period.periodKey)}`}
        subtitle={`${String(options.period.dateFrom)} – ${String(options.period.dateTo)}`}
        status={closeBadge(_, options.period.state)}
        imageFallback={icon('calendar-check')}
        summary={[
          {
            id: 'blockers',
            label: _('account_backend.close.blockers'),
            value: String(options.period.blockerCount),
          },
          {
            id: 'version',
            label: _('account_backend.close.version'),
            value: String(options.period.checklistVersion),
          },
          {
            id: 'revision',
            label: _('account_backend.close.revision'),
            value: String(options.period.revision),
          },
        ]}
        body={stack(
          [
            options.countWarnings?.length ? (
              <Stack
                items={[
                  <Notice tone="warning" title={_('account_backend.close.countWarning')} message="" />,
                  ...options.countWarnings.map((row) => <Link href={row.href} label={row.name} />),
                ]}
              />
            ) : null,
            options.errors?.length ? (
              <Section
                title={_('account_backend.close.blocked')}
                body={<Surface padding="compact" body={options.errors.join(' · ')} />}
              />
            ) : null,
            <Section
              title={_('account_backend.close.checklist')}
              description={_('account_backend.close.checklistHint')}
              actions={
                <RecordForm
                  id="close-refresh-form"
                  scope="close-refresh"
                  action={options.action}
                  submit={_('account_backend.close.refresh')}
                  submitVariant="secondary"
                  layout="inline"
                  hidden={{ action: 'refresh' }}
                  fields={[]}
                />
              }
              body={
                <Surface
                  padding="compact"
                  body={dataTable(_, {
                    rows: options.steps,
                    id: (row) => String(row.id ?? row.code),
                    columns: [
                      {
                        key: 'check',
                        label: _('account_backend.close.check'),
                        priority: 'primary',
                        cell: (row) => _(`account_backend.close.check.${String(row.code)}`),
                      },
                      {
                        key: 'required',
                        label: _('account_backend.close.required'),
                        cell: (row) => (row.required ? _('account_backend.yes') : _('account_backend.no')),
                      },
                      {
                        key: 'state',
                        label: _('account_backend.field.state'),
                        kind: 'status',
                        cell: (row) =>
                          badge(
                            _(`account_backend.wave1.state.${String(row.state)}`),
                            row.state === 'complete' ? 'positive' : row.required ? 'danger' : 'neutral',
                          ),
                      },
                      {
                        key: 'detail',
                        label: _('account_backend.close.evidence'),
                        cell: (row) => stepEvidence(_, row, options.links),
                      },
                    ],
                  })}
                />
              }
            />,
            // Each item the installed accounting standard supplied, named by the module that
            // supplied it; one it does not name is shown by its code.
            options.evidence?.length ? (
              <Section
                title={_('account_backend.close.localEvidence')}
                description={_('account_backend.close.localEvidenceHint')}
                body={
                  <Surface
                    padding="compact"
                    body={dataTable(_, {
                      rows: options.evidence,
                      id: (row) => String(row.id),
                      columns: [
                        {
                          key: 'item',
                          label: _('account_backend.close.check'),
                          priority: 'primary',
                          cell: (row) => {
                            const key = `${String(row.provider)}.closeEvidence.${String(row.code)}`
                            return _.resolves(key) ? _(key) : String(row.code)
                          },
                        },
                        {
                          key: 'required',
                          label: _('account_backend.close.required'),
                          cell: (row) => (row.required ? _('account_backend.yes') : _('account_backend.no')),
                        },
                        {
                          key: 'state',
                          label: _('account_backend.field.state'),
                          kind: 'status',
                          cell: (row) =>
                            badge(
                              row.state !== 'passed' && !row.required
                                ? _('account_backend.close.advised')
                                : _(`account_backend.wave1.state.${String(row.state)}`),
                              row.state === 'passed' ? 'positive' : row.required ? 'danger' : 'warning',
                              String(row.state),
                            ),
                        },
                      ],
                    })}
                  />
                }
              />
            ) : null,
            periodControlsSection(_, options),
            options.period.state === 'hard_closed' ? null : (
              <Section
                title={_('account_backend.close.actions')}
                description={_('account_backend.close.actionsHint')}
                body={stack(
                  [
                    <Surface
                      body={
                        <RecordForm
                          id="close-action-form"
                          scope="close-action"
                          action={options.action}
                          submit={
                            options.period.state === 'soft_closed'
                              ? _('account_backend.close.reopen')
                              : _('account_backend.close.soft')
                          }
                          submitVariant="primary"
                          hidden={{
                            action: options.period.state === 'soft_closed' ? 'reopen' : 'close',
                            mode: 'soft',
                            expectedRevision: String(options.period.revision),
                          }}
                          fields={[
                            {
                              name: 'reason',
                              label: _('account_backend.field.reason'),
                              type: 'textarea',
                              required: true,
                            },
                          ]}
                        />
                      }
                    />,
                    options.period.state === 'soft_closed' ? null : (
                      <Surface
                        body={
                          <RecordForm
                            id="close-hard-form"
                            scope="close-hard"
                            action={options.action}
                            submit={_('account_backend.close.hard')}
                            submitVariant="secondary"
                            hidden={{
                              action: 'close',
                              mode: 'hard',
                              expectedRevision: String(options.period.revision),
                            }}
                            fields={[
                              {
                                name: 'reason',
                                label: _('account_backend.field.reason'),
                                type: 'textarea',
                                required: true,
                              },
                            ]}
                          />
                        }
                      />
                    ),
                  ],
                  'loose',
                )}
              />
            ),
          ],
          'loose',
        )}
      />
    }
  />
)

const LOCK_KINDS = ['invoices', 'bills', 'payments', 'entries'] as const

/**
 * What the period locks ahead of the rest while it is open, and who may still post once it is soft
 * closed (D16). The chief accountant sets both; anyone else reads them. A hard close ends both.
 */
const periodControlsSection = (
  _: Translator,
  options: Parameters<typeof periodCloseDetailScreen>[1],
): TemplateResult | null => {
  if (options.period.state === 'hard_closed') return null
  const kinds = (options.period.lockedKinds as string[] | null) ?? []
  const posters = (options.period.softPosters as string[] | null) ?? []
  const users = options.controls?.users ?? []
  const nameOf = (id: string) =>
    [...users, ...(options.people ?? [])].find((user) => user.id === id)?.name ?? id
  return (
    <Section
      title={_('account_backend.close.controls')}
      description={_('account_backend.close.controlsHint')}
      body={
        <Surface
          body={
            options.controls ? (
              <RecordForm
                id="close-controls-form"
                scope="close-controls"
                action={options.action}
                submit={_('account_backend.close.saveControls')}
                submitVariant="secondary"
                hidden={{ action: 'controls', expectedRevision: String(options.period.revision) }}
                fields={[
                  {
                    name: 'lockedKinds',
                    label: _('account_backend.close.lockedKinds'),
                    type: 'checkbox-group',
                    span: 'full',
                    options: LOCK_KINDS.map((kind) => ({
                      name: `kind.${kind}`,
                      value: '1',
                      label: _(`account_backend.close.kind.${kind}`),
                      checked: kinds.includes(kind),
                    })),
                  },
                  {
                    name: 'softPosters',
                    label: _('account_backend.close.softPosters'),
                    type: 'checkbox-group',
                    span: 'full',
                    help: _('account_backend.close.softPostersHint'),
                    options: [
                      ...users,
                      // Someone named before who is no longer listed stays visible, so saving keeps them.
                      ...posters
                        .filter((id) => !users.some((user) => user.id === id))
                        .map((id) => ({ id, name: id })),
                    ].map((user) => ({
                      name: `poster.${user.id}`,
                      value: '1',
                      label: user.name,
                      checked: posters.includes(user.id),
                    })),
                  },
                ]}
              />
            ) : (
              <DescriptionList
                columns={2}
                items={[
                  {
                    id: 'lockedKinds',
                    label: _('account_backend.close.lockedKinds'),
                    value: kinds.length
                      ? kinds.map((kind) => _(`account_backend.close.kind.${kind}`)).join(', ')
                      : _('account_backend.close.noControls'),
                  },
                  {
                    id: 'softPosters',
                    label: _('account_backend.close.softPosters'),
                    value: posters.length
                      ? posters.map(nameOf).join(', ')
                      : _('account_backend.close.noControls'),
                  },
                ]}
              />
            )
          }
        />
      }
    />
  )
}
