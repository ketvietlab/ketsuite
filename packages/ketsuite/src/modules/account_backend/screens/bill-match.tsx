import type { Translator } from '@ketvietlab/ketjs'
import { Badge, Stack, Text } from '@ketvietlab/design-system'
import type { TemplateResult } from '@ketvietlab/ketjs-view'
import {
  dataTable,
  formatMoney,
  inline,
  Notice,
  RecordForm,
  Section,
  stack,
  Surface,
} from '../../../ui/index.ts'

/** One vendor bill line against its purchase line, as `purchase.getBillMatch` answers. */
export type BillMatchLineView = {
  id: string
  orderName: string
  name: string
  ordered: string
  received: string
  allowed: string
  billedBefore: string
  quantity: string
  expectedPrice: string
  price: string
  drift: number | null
  quantityIssue: boolean
  priceIssue: boolean
}

export type BillMatchView = {
  status: 'none' | 'ok' | 'mismatch'
  tolerance: string | null
  lines: BillMatchLineView[]
  hold: { reason: string; heldBy: string | null; heldAt: string } | null
}

export type BillMatchSectionOptions = {
  match: BillMatchView
  currency: unknown
  /** The bill's own POST endpoint; null when the reader may not hold or release it. */
  action: string | null
}

const quantity = (_: Translator, value: string) =>
  new Intl.NumberFormat(_.locale === 'en' ? 'en-US' : 'vi-VN', { maximumFractionDigits: 3 }).format(
    Number(value),
  )

const result = (_: Translator, line: BillMatchLineView) =>
  line.quantityIssue ? (
    <Badge label={_('account_backend.billMatch.overQuantity')} tone="danger" value="quantity" />
  ) : line.priceIssue ? (
    <Badge
      label={_('account_backend.billMatch.offPrice', { drift: String(line.drift ?? '') })}
      tone="danger"
      value="price"
    />
  ) : (
    <Badge label={_('account_backend.billMatch.matched')} tone="positive" value="ok" />
  )

/**
 * How a vendor bill compares with its purchase orders, and its hold, on the bill. A bill that does
 * not match cannot be posted; holding it records why while the vendor corrects it.
 */
export const billMatchSection = (_: Translator, options: BillMatchSectionOptions): TemplateResult => {
  const { match } = options
  const table = dataTable(_, {
    rows: match.lines,
    id: (line) => line.id,
    columns: [
      {
        key: 'name',
        label: _('account_backend.field.name'),
        // The purchase order under the line's name, so the comparison and its result fit beside the rail.
        cell: (line) => (
          <Stack
            gap="none"
            items={[
              <Text variant="bodyMd">{line.name}</Text>,
              <Text variant="bodySm" tone="muted">
                {line.orderName}
              </Text>,
            ]}
          />
        ),
        priority: 'primary',
      },
      {
        key: 'quantity',
        label: _('account_backend.billMatch.quantity'),
        // What the order allows sits beside this bill; what was ordered and billed before, beneath.
        cell: (line) => (
          <Stack
            gap="none"
            items={[
              <Text variant="bodyMd">{`${quantity(_, line.quantity)} / ${quantity(_, line.allowed)}`}</Text>,
              <Text variant="bodySm" tone="muted">
                {_('account_backend.billMatch.quantityDetail', {
                  ordered: quantity(_, line.ordered),
                  billed: quantity(_, line.billedBefore),
                })}
              </Text>,
            ]}
          />
        ),
        align: 'end',
        kind: 'number',
      },
      {
        key: 'expectedPrice',
        label: _('account_backend.billMatch.expectedPrice'),
        cell: (line) => formatMoney(_, line.expectedPrice, options.currency),
        align: 'end',
        kind: 'currency',
      },
      {
        key: 'price',
        label: _('account_backend.billMatch.price'),
        cell: (line) => formatMoney(_, line.price, options.currency),
        align: 'end',
        kind: 'currency',
      },
      {
        key: 'result',
        label: _('account_backend.billMatch.result'),
        cell: (line) => result(_, line),
        kind: 'status',
      },
    ],
  })
  const holdForm = options.action ? (
    match.hold ? (
      <RecordForm
        id="account-bill-release-form"
        scope="account-bill-match"
        action={options.action}
        submit={_('account_backend.billMatch.release')}
        submitVariant="secondary"
        hidden={{ action: 'release-hold' }}
        fields={[]}
      />
    ) : (
      <RecordForm
        id="account-bill-hold-form"
        scope="account-bill-match"
        action={options.action}
        submit={_('account_backend.billMatch.hold')}
        submitVariant="secondary"
        hidden={{ action: 'hold' }}
        fields={[
          {
            name: 'reason',
            label: _('account_backend.billMatch.reason'),
            type: 'textarea',
            required: true,
            help: _('account_backend.billMatch.reasonHelp'),
          },
        ]}
      />
    )
  ) : null
  return (
    <Section
      title={_('account_backend.billMatch.title')}
      body={
        <Surface
          padding="compact"
          body={stack([
            inline([
              match.status === 'mismatch' ? (
                <Badge label={_('account_backend.billMatch.mismatch')} tone="danger" value="mismatch" />
              ) : (
                <Badge label={_('account_backend.billMatch.ok')} tone="positive" value="ok" />
              ),
              match.hold ? (
                <Badge label={_('account_backend.billMatch.held')} tone="warning" value="held" />
              ) : null,
              match.tolerance == null
                ? _('account_backend.billMatch.noTolerance')
                : _('account_backend.billMatch.tolerance', { tolerance: match.tolerance }),
            ]),
            match.hold ? (
              <Notice
                tone="warning"
                title={_('account_backend.billMatch.heldTitle')}
                message={match.hold.reason}
              />
            ) : null,
            table,
            holdForm,
          ])}
        />
      }
    />
  )
}
