import { Button, DataTable, DescriptionList, Notice, Surface, Stack } from '@ketvietlab/design-system'
import { formatMoney } from '../../../ui/money-format.ts'
import { RecordModalForm, recordStateSelectControl } from '../../../ui/client/record-modal-form.tsx'
import type { RecordModalContext, RecordModalDefinition } from '../../../ui/client/record-modal.tsx'
import type { SaleOrderModalData } from './order-modal-view.tsx'
type Row = Record<string, unknown>
type Context = RecordModalContext<SaleOrderModalData>
const t = (c: Context, key: string) => c.t('sale_backend.benefit.' + key)
const editable = (c: Context) =>
  !c.creating &&
  !c.data.record.locked &&
  ['draft', 'sent'].includes(String(c.data.record.state)) &&
  (!c.data.record.orderAuthority || c.data.record.orderAuthority === 'local')
const money = (c: Context, value: unknown) =>
  formatMoney({ locale: c.data.lang }, value, c.data.record.currency)
// The rewards the saved quotation can take: the promotions it qualifies for, or what the customer's points buy.
export const benefitChoices = (c: Context, points: boolean) =>
  (c.data.benefits?.available ?? [])
    .filter((program) => (program.programType === 'loyalty') === points)
    .flatMap((program) =>
      ((program.rewards as Row[]) ?? [])
        .filter((reward) => reward.rewardId !== program.appliedRewardId)
        .map((reward) => ({
          value: JSON.stringify({ programId: program.programId, rewardId: reward.rewardId }),
          // "Đơn từ 2 triệu giảm 5% — Giảm 5% trên đơn · 100.000 ₫", as the mock reads; points only cost on a card.
          label: [
            `${String(program.programName)} — ${c.data.benefits?.rewardSummaries?.[String(reward.rewardId)] ?? String(reward.description)}`,
            reward.rewardType === 'product'
              ? c.t('sale_backend.benefit.gift', { quantity: reward.productQuantity })
              : money(c, reward.discountAmount),
            ...(points ? [c.t('sale_backend.benefit.cost', { points: reward.requiredPoints })] : []),
          ].join(' · '),
        })),
    )
const saveFirst = (c: Context) => <Notice tone="warning" title={t(c, 'saveFirst')} message="" />

export function benefitSection(c: Context) {
  const data = c.data.benefits
  if (!data) return null
  return (
    <Surface
      title={t(c, 'title')}
      body={
        <Stack
          gap="default"
          items={[
            <DescriptionList
              items={[
                {
                  id: 'earned',
                  label: t(
                    c,
                    ['draft', 'sent'].includes(String(c.data.record.state)) ? 'expected' : 'earned',
                  ),
                  value: String(data.pointsEarned),
                },
                {
                  id: 'spent',
                  label: t(c, ['draft', 'sent'].includes(String(c.data.record.state)) ? 'reserved' : 'spent'),
                  value: String(data.pointsSpent),
                },
              ]}
            />,
            data.applied.length ? (
              <DataTable
                id={(row) => String(row.id)}
                label={t(c, 'applied')}
                rows={data.applied}
                columns={[
                  { key: 'name', label: t(c, 'program'), cell: (row) => String(row.name) },
                  {
                    key: 'description',
                    label: t(c, 'reward'),
                    cell: (row) =>
                      c.data.benefits?.rewardSummaries?.[String(row.rewardId)] ??
                      String(row.description ?? '—'),
                  },
                  {
                    key: 'code',
                    label: t(c, 'code'),
                    cell: (row) => String(row.code ?? row.walletCode ?? '—'),
                  },
                  {
                    key: 'state',
                    label: t(c, 'state'),
                    cell: (row) => t(c, 'application.' + String(row.state)),
                  },
                  {
                    key: 'discountAmount',
                    label: t(c, 'discount'),
                    cell: (row) => money(c, row.discountAmount),
                  },
                ]}
              />
            ) : (
              <Notice tone="info" title={t(c, 'empty')} message={t(c, 'automatic')} />
            ),
            data.cards.length ? (
              <DataTable
                id={(row) => String(row.id)}
                label={t(c, 'cards')}
                rows={data.cards}
                columns={[
                  { key: 'code', label: t(c, 'card'), cell: (row) => String(row.code) },
                  { key: 'name', label: t(c, 'program'), cell: (row) => String(row.name) },
                  { key: 'balance', label: t(c, 'balance'), cell: (row) => String(row.balance) },
                  { key: 'available', label: t(c, 'available'), cell: (row) => String(row.available) },
                  { key: 'expiresOn', label: t(c, 'expires'), cell: (row) => String(row.expiresOn ?? '—') },
                  { key: 'state', label: t(c, 'state'), cell: (row) => t(c, 'state.' + String(row.state)) },
                ]}
              />
            ) : null,
          ]}
        />
      }
    />
  )
}

// Promotions and points take a reward the same way; each lists only its own.
const rewardDialog = (
  points: boolean,
): NonNullable<RecordModalDefinition<SaleOrderModalData>['dialogs']>[string] => ({
  title: (c) => t(c, points ? 'pointsAction' : 'rewardAction'),
  size: 'small',
  view: (c) => {
    const choices = benefitChoices(c, points)
    const selectedValue = c.state('reward', c.draft('reward', choices[0]?.value ?? ''))
    const selected = choices.find((choice) => choice.value === selectedValue)
    return (
      <RecordModalForm
        kind={c.kind}
        command="benefitReward"
        columns={1}
        fields={
          c.recordChanged || !choices.length
            ? []
            : [
                {
                  id: 'sale-benefit-reward',
                  name: 'reward',
                  label: t(c, 'reward'),
                  control: recordStateSelectControl({
                    id: 'sale-benefit-reward',
                    name: 'reward',
                    state: 'reward',
                    value: selectedValue,
                    options: choices,
                    required: true,
                    disabled: c.busy,
                    invalid: Boolean(c.fieldError('reward')),
                    describedBy: c.fieldError('reward') ? 'sale-benefit-reward-error' : undefined,
                  }),
                  error: c.fieldError('reward'),
                  required: true,
                  disabled: c.busy,
                },
              ]
        }
        body={
          c.recordChanged ? (
            saveFirst(c)
          ) : !choices.length ? (
            <Notice tone="info" title={t(c, 'noneAvailable')} message={t(c, 'conditions')} />
          ) : (
            <Stack
              gap="default"
              items={[
                <DescriptionList
                  items={[
                    { id: 'selectedReward', label: t(c, 'selectedReward'), value: selected?.label ?? '—' },
                  ]}
                />,
                // Only points are held until confirmation; a promotion has nothing to hold.
                <Notice
                  tone="info"
                  title={t(c, 'recalculate')}
                  message={points ? t(c, 'reserveHelp') : ''}
                />,
              ]}
            />
          )
        }
        actions={[
          <Button
            type="submit"
            label={t(c, 'apply')}
            variant="primary"
            disabled={
              c.busy || c.recordChanged || !choices.length || !editable(c) || !c.data.permissions.benefitApply
            }
          />,
        ]}
      />
    )
  },
})

export const benefitDialogs: NonNullable<RecordModalDefinition<SaleOrderModalData>['dialogs']> = {
  benefitCode: {
    title: (c) => t(c, 'codeAction'),
    size: 'small',
    view: (c) => (
      <RecordModalForm
        kind={c.kind}
        command="benefitCode"
        columns={1}
        fields={
          c.recordChanged
            ? []
            : [
                {
                  id: 'sale-benefit-code',
                  name: 'code',
                  label: t(c, 'code'),
                  value: c.draft('code', ''),
                  error: c.fieldError('code'),
                  required: true,
                  disabled: c.busy,
                  help: t(c, 'codeHelp'),
                },
              ]
        }
        body={c.recordChanged ? saveFirst(c) : null}
        actions={[
          <Button
            type="submit"
            label={t(c, 'apply')}
            variant="primary"
            disabled={c.busy || c.recordChanged || !editable(c) || !c.data.permissions.benefitCode}
          />,
        ]}
      />
    ),
  },
  benefitReward: rewardDialog(false),
  benefitPoints: rewardDialog(true),
}
export const benefitCommands: NonNullable<RecordModalDefinition<SaleOrderModalData>['commands']> = {
  benefitCode: {
    fn: 'loyalty_sale.applyCode',
    refreshOnRefusal: true,
    input: (form, c) => ({
      orderId: c.id,
      expectedRevision: Number(c.data.record.revision),
      code: String(form.get('code') ?? ''),
    }),
    after: 'reload',
  },
  benefitReward: {
    fn: 'loyalty_sale.applyReward',
    refreshOnRefusal: true,
    issueField: () => 'reward',
    input: (form, c) => {
      let choice: Row = {}
      try {
        choice = JSON.parse(String(form.get('reward') ?? '{}'))
      } catch {
        /* Native validation supplies the field error. */
      }
      return {
        orderId: c.id,
        expectedRevision: Number(c.data.record.revision),
        programId: String(choice?.programId ?? ''),
        rewardId: String(choice?.rewardId ?? ''),
      }
    },
    after: 'reload',
  },
}
