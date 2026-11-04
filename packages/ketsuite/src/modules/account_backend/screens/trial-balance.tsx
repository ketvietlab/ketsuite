import type { Translator } from '@ketvietlab/ketjs'
import type { TemplateResult } from '@ketvietlab/ketjs-view'
import {
  code,
  dataTable,
  DatePicker,
  emptyState,
  formatMoney,
  ListScreen,
  icon,
  linkButton,
  Notice,
  RecordWorkspace,
  Section,
  stack,
  Surface,
} from '../../../ui/index.ts'
import type { DatePickerField, Frame } from '../../../ui/index.ts'
import { addDecimals } from '../../account/money.ts'

export type TrialBalanceRow = Record<string, unknown>

export type TrialBalanceScreenOptions = {
  frame: Frame
  /** From and to. This report is a date range and nothing else. */
  fields: readonly [DatePickerField, DatePickerField]
  rows: TrialBalanceRow[]
  action: string
  locale?: string
  currency: unknown
  /** The ledger behind a balance. A total nobody can open is a number to trust blindly. */
  ledgerHref?: (row: TrialBalanceRow) => string
  /** How many accounts with no balance and no movement the table leaves out. */
  hidden?: number
  /** Shows the hidden accounts, or hides them again when every account is shown. */
  toggleHref?: string
  showingAll?: boolean
  errors?: readonly string[]
}

const AMOUNTS = ['openingDebit', 'openingCredit', 'debit', 'credit', 'closingDebit', 'closingCredit'] as const
type Amount = (typeof AMOUNTS)[number]

/** A specialized financial report: filter, control totals, and drillable account rows. */
export const trialBalanceScreen = (_: Translator, options: TrialBalanceScreenOptions): TemplateResult => {
  const total = (field: Amount) => options.rows.reduce((sum, row) => addDecimals(sum, row[field] ?? '0'), '0')
  // A ledger where every entry balances keeps each pair of columns equal.
  const balanced =
    total('openingDebit') === total('openingCredit') &&
    total('debit') === total('credit') &&
    total('closingDebit') === total('closingCredit')
  const amountColumn = (key: Amount) => ({
    key,
    label: _(`account_backend.trial.column.${key}`),
    cell: (row: TrialBalanceRow) => formatMoney(_, row[key] ?? '0', options.currency),
    align: 'end' as const,
    kind: 'currency' as const,
  })
  const table = options.rows.length ? (
    dataTable(_, {
      rows: options.rows,
      id: (row) => String(row.id ?? row.accountId),
      columns: [
        {
          key: 'code',
          label: _('account_backend.field.code'),
          priority: 'primary',
          cell: (row) =>
            options.ledgerHref
              ? linkButton({
                  label: String(row.code),
                  href: options.ledgerHref(row),
                  variant: 'tertiary',
                })
              : code(String(row.code)),
        },
        {
          key: 'name',
          label: _('account_backend.field.name'),
          cell: (row) => String((_.locale.startsWith('en') && row.nameEn) || row.name),
        },
        ...AMOUNTS.map(amountColumn),
      ],
    })
  ) : (
    <Surface
      padding="compact"
      body={emptyState(_('account_backend.trial.empty'), _('account_backend.trial.emptyHint'), {
        icon: icon('notebook-tabs'),
      })}
    />
  )

  return (
    <ListScreen
      translator={_}
      title={_('account_backend.trialBalance.title')}
      frame={options.frame}
      body={
        <RecordWorkspace
          kicker={_('account_backend.trial.kicker')}
          title={_('account_backend.trialBalance.title')}
          imageFallback={icon('notebook-tabs')}
          summary={[
            {
              id: 'debit',
              label: _('account_backend.trial.column.debit'),
              value: formatMoney(_, total('debit'), options.currency),
            },
            {
              id: 'credit',
              label: _('account_backend.trial.column.credit'),
              value: formatMoney(_, total('credit'), options.currency),
            },
            {
              id: 'balanced',
              label: _('account_backend.trial.summary.check'),
              value: balanced
                ? _('account_backend.trial.summary.balanced')
                : _('account_backend.trial.summary.unbalanced'),
            },
          ]}
          body={stack(
            [
              options.errors?.length ? (
                <Notice
                  tone="danger"
                  title={_('account_backend.trial.filter.title')}
                  message={options.errors.join(' · ')}
                />
              ) : null,
              <Section
                title={_('account_backend.trial.filter.title')}
                description={_('account_backend.trial.filter.hint')}
                body={
                  <Surface
                    padding="compact"
                    body={
                      <DatePicker
                        action={options.action}
                        label={_('account_backend.trial.filter.title')}
                        fields={options.fields}
                        hidden={options.locale ? { lang: options.locale } : undefined}
                        submit={_('account_backend.action.calculate')}
                      />
                    }
                  />
                }
              />,
              <Section
                title={_('account_backend.trial.result.title')}
                description={
                  options.showingAll
                    ? _('account_backend.trial.result.all')
                    : options.hidden
                      ? _('account_backend.trial.result.hidden', { count: String(options.hidden) })
                      : _('account_backend.trial.result.hint')
                }
                actions={
                  options.toggleHref && (options.showingAll || options.hidden)
                    ? linkButton({
                        label: options.showingAll
                          ? _('account_backend.trial.hideEmpty')
                          : _('account_backend.trial.showAll', { count: String(options.hidden) }),
                        href: options.toggleHref,
                        variant: 'secondary',
                      })
                    : undefined
                }
                body={table}
              />,
            ],
            'loose',
          )}
        />
      }
    />
  )
}
