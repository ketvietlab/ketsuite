import type { Translator } from '@ketvietlab/ketjs'
import type { TemplateResult } from '@ketvietlab/ketjs-view'
import {
  dataTable,
  emptyState,
  formatMoney,
  RecordForm,
  RecordScreen,
  Section,
  stack,
  Surface,
} from '../../../ui/index.ts'
import type { FormField, Frame } from '../../../ui/index.ts'

type Row = Record<string, unknown>

export type NettingPlan = {
  receivables: Row[]
  payables: Row[]
  receivable: string
  payable: string
  available: string
  amount: string
}

export type NettingScreenOptions = {
  frame: Frame
  action: string
  currency: string
  /** Partners still open on both sides; nothing to net without one. */
  partnerCount: number
  fields: FormField[]
  plan?: NettingPlan | null
  /** What the posting form sends back: the partner, day and amount the plan was read for. */
  post?: Record<string, string> | null
  errors?: string[]
}

const documents = (_: Translator, rows: Row[], currency: string) =>
  dataTable(_, {
    rows,
    id: (row) => String(row.lineId),
    columns: [
      {
        key: 'document',
        label: _('account_backend.netting.document'),
        priority: 'primary',
        cell: (row) => String(row.name),
      },
      {
        key: 'due',
        label: _('account_backend.netting.due'),
        kind: 'date',
        cell: (row) => String(row.dueDate),
      },
      {
        key: 'open',
        label: _('account_backend.netting.open'),
        kind: 'currency',
        align: 'end',
        cell: (row) => formatMoney(_, row.open, currency),
      },
      {
        key: 'applied',
        label: _('account_backend.netting.applied'),
        kind: 'currency',
        align: 'end',
        cell: (row) => formatMoney(_, row.applied, currency),
      },
    ],
  })

/**
 * Netting reads like the decision it is: pick the partner, see what each side still holds and how
 * the amount would spread over it due first, then post. The plan is read again when posting, so
 * what is shown is a preview, never a promise.
 */
export const nettingScreen = (_: Translator, options: NettingScreenOptions): TemplateResult => {
  const title = _('account_backend.netting.title')
  const plan = options.plan
  const money = (value: unknown) => formatMoney(_, value, options.currency)
  return (
    <RecordScreen
      translator={_}
      title={title}
      frame={options.frame}
      body={
        options.partnerCount === 0
          ? emptyState(_('account_backend.netting.empty'), _('account_backend.netting.emptyHint'))
          : stack(
              [
                <Section
                  title={_('account_backend.netting.choose')}
                  body={
                    <Surface
                      body={
                        <RecordForm
                          id="netting-preview-form"
                          scope="account-netting-preview"
                          action={options.action}
                          method="get"
                          submit={_('account_backend.netting.preview')}
                          submitVariant="secondary"
                          fields={options.fields}
                          errors={options.errors}
                        />
                      }
                    />
                  }
                />,
                plan ? (
                  <Section
                    title={_('account_backend.netting.receivables')}
                    description={`${_('account_backend.netting.open')}: ${money(plan.receivable)}`}
                    body={<Surface padding="none" body={documents(_, plan.receivables, options.currency)} />}
                  />
                ) : null,
                plan ? (
                  <Section
                    title={_('account_backend.netting.payables')}
                    description={`${_('account_backend.netting.open')}: ${money(plan.payable)}`}
                    body={<Surface padding="none" body={documents(_, plan.payables, options.currency)} />}
                  />
                ) : null,
                plan && options.post ? (
                  <Section
                    title={_('account_backend.netting.post')}
                    description={_('account_backend.netting.postHint', {
                      amount: money(plan.amount),
                      available: money(plan.available),
                    })}
                    body={
                      <Surface
                        body={
                          <RecordForm
                            id="netting-post-form"
                            scope="account-netting-post"
                            action={options.action}
                            submit={_('account_backend.netting.post')}
                            submitVariant="primary"
                            hidden={{ action: 'post', ...options.post }}
                            fields={[]}
                          />
                        }
                      />
                    }
                  />
                ) : plan && plan.amount !== '0' ? (
                  // The plan is there but no journal is chosen yet: say what is missing.
                  <Section
                    title={_('account_backend.netting.post')}
                    body={<Surface padding="compact" body={_('account_backend.netting.chooseJournal')} />}
                  />
                ) : null,
              ],
              'loose',
            )
      }
    />
  )
}
