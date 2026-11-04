import type { Translator } from '@ketvietlab/ketjs'
import type { TemplateResult } from '@ketvietlab/ketjs-view'
import {
  code,
  dataTable,
  formatMoney,
  ListScreen,
  icon,
  linkButton,
  RecordForm,
  RecordWorkspace,
  Section,
  stack,
  Surface,
} from '../../../ui/index.ts'
import type { FormField, Frame } from '../../../ui/index.ts'
type Row = Record<string, unknown>

export const accountingBooksScreen = (
  _: Translator,
  options: {
    frame: Frame
    fields: FormField[]
    action: string
    result?: Row
    currency: unknown
    errors?: string[]
    entryHref: (row: Row) => string
    /** The same book as a spreadsheet, in the column order of the form it follows. */
    csvHref?: string
  },
): TemplateResult => {
  const rows = (options.result?.rows as Row[] | undefined) ?? []
  const result = options.result
  // Only the general journal runs across every account at once, and it has no balance to carry.
  const ledger = result?.opening !== null && result?.opening !== undefined
  const byPartner = result?.book === 'partner'
  const money = (value: unknown) => formatMoney(_, value, options.currency)
  return (
    <ListScreen
      translator={_}
      title={_('account_backend.books.title')}
      frame={options.frame}
      body={
        <RecordWorkspace
          kicker={_('account_backend.menu.reporting')}
          title={_('account_backend.books.title')}
          imageFallback={icon('library-big')}
          subtitle={result?.form ? _('account_backend.books.form', { form: String(result.form) }) : null}
          summary={
            result
              ? [
                  ...(ledger
                    ? [
                        {
                          id: 'opening',
                          label: _('account_backend.books.opening'),
                          value: money(result.opening),
                        },
                      ]
                    : []),
                  { id: 'debit', label: _('account_backend.field.debit'), value: money(result.debit) },
                  { id: 'credit', label: _('account_backend.field.credit'), value: money(result.credit) },
                  ...(ledger
                    ? [
                        {
                          id: 'closing',
                          label: _('account_backend.books.closing'),
                          value: money(result.closing),
                        },
                      ]
                    : []),
                ]
              : []
          }
          body={stack(
            [
              <Section
                title={_('account_backend.books.filter')}
                description={_('account_backend.books.filterHint')}
                body={
                  <Surface
                    body={
                      <RecordForm
                        id="book-filter-form"
                        scope="account-book"
                        action={options.action}
                        method="get"
                        submit={_('account_backend.action.calculate')}
                        submitVariant="secondary"
                        fields={options.fields}
                        errors={options.errors}
                      />
                    }
                  />
                }
              />,
              <Section
                title={_('account_backend.books.result')}
                description={_('account_backend.books.resultHint')}
                actions={
                  options.csvHref && rows.length
                    ? linkButton({
                        label: _('account_backend.books.csv'),
                        href: options.csvHref,
                        variant: 'secondary',
                      })
                    : undefined
                }
                body={
                  <Surface
                    padding="compact"
                    body={dataTable(_, {
                      rows,
                      id: (row) => String(row.id),
                      rowHref: options.entryHref,
                      columns: [
                        // The row opens its entry from the first column, so the entry's number leads.
                        {
                          key: 'entry',
                          label: _('account_backend.field.entry'),
                          priority: 'primary',
                          cell: (row) => code(String(row.moveName)),
                        },
                        {
                          key: 'date',
                          label: _('account_backend.field.accountingDate'),
                          cell: (row) => String(row.accountingDate),
                        },
                        {
                          key: 'journal',
                          label: _('account_backend.field.journalId'),
                          cell: (row) => code(String(row.journalCode)),
                        },
                        // A book kept for one account names the other side; the journal, the account itself.
                        ledger
                          ? {
                              key: 'contra',
                              label: _('account_backend.books.contra'),
                              cell: (row: Row) =>
                                row.contraAccountCodes ? code(String(row.contraAccountCodes)) : '',
                            }
                          : {
                              key: 'account',
                              label: _('account_backend.field.accountId'),
                              cell: (row: Row) => code(String(row.accountCode)),
                            },
                        ...(byPartner
                          ? [
                              {
                                key: 'partner',
                                label: _('account_backend.field.partnerId'),
                                cell: (row: Row) => String(row.partnerName ?? ''),
                              },
                            ]
                          : []),
                        {
                          key: 'description',
                          label: _('account_backend.books.description'),
                          cell: (row) => String(row.description ?? ''),
                        },
                        {
                          key: 'debit',
                          label: _('account_backend.field.debit'),
                          cell: (row) => money(row.debit),
                          align: 'end',
                          kind: 'currency',
                        },
                        {
                          key: 'credit',
                          label: _('account_backend.field.credit'),
                          cell: (row) => money(row.credit),
                          align: 'end',
                          kind: 'currency',
                        },
                        ...(ledger
                          ? [
                              {
                                key: 'running',
                                label: _('account_backend.books.running'),
                                cell: (row: Row) => money(row.runningBalance),
                                align: 'end' as const,
                                kind: 'currency' as const,
                              },
                            ]
                          : []),
                      ],
                    })}
                  />
                }
              />,
            ],
            'loose',
          )}
        />
      }
    />
  )
}
