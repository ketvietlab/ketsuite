import { Button, Menu, Notice } from '@ketvietlab/design-system'
import { RecordModalForm } from '../../../ui/client/record-modal-form.tsx'
import type { RecordModalContext, RecordModalDefinition } from '../../../ui/client/record-modal.tsx'
import { benefitChoices } from './benefit-dialogs.tsx'
import { quotationWithHistory } from './history.ts'
import type { SaleOrderModalData } from './order-modal-view.tsx'
type Context = RecordModalContext<SaleOrderModalData>
const t = (c: Context, key: string) => c.t('sale_backend.discount.' + key)
// Everything that takes money off the quotation sits in one menu next to the products: a discount typed by
// hand, the promotions and points rewards the saved quotation can take, and a code. A benefit leaves the
// quotation when its discount row is deleted in the products table.
export const discountAction = (c: Context) => {
  if (
    c.creating ||
    c.data.record.locked ||
    !['draft', 'sent'].includes(String(c.data.record.state)) ||
    (c.data.record.orderAuthority && c.data.record.orderAuthority !== 'local')
  )
    return null
  const href = (dialog: string) => {
    // The tab open now, as for the template menu: a link to another tab leaves the page.
    const u = new URL(c.href(c.tab), 'http://ket.local')
    u.searchParams.set('dialog', dialog)
    return u.pathname + u.search
  }
  const benefit = (key: string) => c.t('sale_backend.benefit.' + key)
  const items = [
    // A manual discount rewrites every line, which a quotation with history refuses.
    c.data.permissions.applyDiscount && !quotationWithHistory(c)
      ? { id: 'manual', label: t(c, 'manual'), href: href('discount') }
      : null,
    c.data.permissions.benefitApply && benefitChoices(c, false).length
      ? { id: 'promotions', label: benefit('rewardAction'), href: href('benefitReward') }
      : null,
    c.data.permissions.benefitCode
      ? { id: 'code', label: benefit('codeAction'), href: href('benefitCode') }
      : null,
    c.data.permissions.benefitApply && benefitChoices(c, true).length
      ? { id: 'points', label: benefit('pointsAction'), href: href('benefitPoints') }
      : null,
  ].flatMap((item) => (item ? [{ ...item, disabled: c.busy }] : []))
  return items.length ? <Menu id={'sale-discounts-' + c.id} label={t(c, 'title')} items={items} /> : null
}
export const discountDialog: NonNullable<RecordModalDefinition<SaleOrderModalData>['dialogs']>[string] = {
  title: (c) => t(c, 'manual'),
  view: (c) => (
    <RecordModalForm
      kind={c.kind}
      command="discount"
      fields={
        c.recordChanged
          ? []
          : [
              {
                id: 'sale-discount-mode',
                name: 'mode',
                label: t(c, 'mode'),
                type: 'select',
                value: c.draft('mode', 'order_percent'),
                options: ['order_percent', 'amount', 'line_percent'].map((value) => ({
                  value,
                  label: t(c, value),
                })),
                disabled: c.busy,
              },
              {
                id: 'sale-discount-value',
                name: 'value',
                label: t(c, 'value'),
                value: c.draft('value', ''),
                // A percentage or an amount: a phone shows its number keys.
                inputMode: 'decimal',
                required: true,
                error: c.fieldError('value'),
                disabled: c.busy,
              },
            ]
      }
      body={
        c.recordChanged ? (
          <Notice tone="warning" title={t(c, 'saveFirst')} message="" />
        ) : (
          <Notice tone="info" title={t(c, 'beforeTax')} message={t(c, 'replace')} />
        )
      }
      actions={[
        <Button
          type="submit"
          variant="primary"
          label={t(c, 'apply')}
          disabled={c.busy || c.recordChanged || !c.data.permissions.applyDiscount}
        />,
      ]}
    />
  ),
}
export const discountCommand: NonNullable<RecordModalDefinition<SaleOrderModalData>['commands']>[string] = {
  fn: 'sale.applyDiscount',
  input: (form, c) => ({
    id: c.id,
    expectedRevision: Number(c.data.record.revision),
    mode: String(form.get('mode') ?? ''),
    value: String(form.get('value') ?? ''),
    label: t(c, 'line'),
  }),
  after: 'reload',
}
