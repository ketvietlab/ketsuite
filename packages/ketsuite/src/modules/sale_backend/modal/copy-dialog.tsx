import { Button, Notice } from '@ketvietlab/design-system'
import { RecordDialogTrigger, RecordModalForm } from '../../../ui/client/record-modal-form.tsx'
import type { RecordModalContext, RecordModalDefinition } from '../../../ui/client/record-modal.tsx'
import type { SaleOrderModalData } from './order-modal-view.tsx'
type Context = RecordModalContext<SaleOrderModalData>
const t = (c: Context, key: string) => c.t('sale_backend.copy.' + key)
export const copyAction = (c: Context) =>
  c.data.permissions.copyOrder ? (
    <RecordDialogTrigger dialog="copy">
      <Button label={t(c, 'action')} disabled={c.busy} />
    </RecordDialogTrigger>
  ) : null
export const copyDialog: NonNullable<RecordModalDefinition<SaleOrderModalData>['dialogs']>[string] = {
  title: (c) => t(c, 'action'),
  size: 'small',
  view: (c) => (
    <RecordModalForm
      kind={c.kind}
      command="copy"
      fields={[]}
      body={
        <Notice
          tone={c.recordChanged ? 'warning' : 'info'}
          title={t(c, c.recordChanged ? 'saveFirst' : 'details')}
          message={c.recordChanged ? '' : t(c, 'history')}
        />
      }
      actions={[
        <Button
          type="submit"
          label={t(c, 'action')}
          variant="primary"
          disabled={c.busy || c.recordChanged || !c.data.permissions.copyOrder}
        />,
      ]}
    />
  ),
}
export const copyCommand: NonNullable<RecordModalDefinition<SaleOrderModalData>['commands']>[string] = {
  fn: 'sale.copyOrder',
  refreshOnRefusal: true,
  input: (_form, c) => ({
    id: c.data.draftId,
    sourceId: c.id,
    expectedRevision: Number(c.data.record.revision ?? 0),
  }),
  navigate: (value, c) => {
    const url = new URL(location.href)
    url.pathname = '/admin/sales/quotations/' + encodeURIComponent(String((value as { id: string }).id))
    for (const key of [...url.searchParams.keys()])
      if (!['lang', 'company', 'branch'].includes(key)) url.searchParams.delete(key)
    url.searchParams.set('lang', c.data.lang)
    return url.pathname + url.search
  },
  after: 'stay',
}
