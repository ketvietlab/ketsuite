import { DataTable, Notice, Stack, Surface, Text } from '@ketvietlab/design-system'
import type { RecordModalContext } from '../../../ui/client/record-modal.tsx'
import type { SaleOrderModalData } from './order-modal-view.tsx'
export function invoicePreview(c: RecordModalContext<SaleOrderModalData>) {
  const t = (key: string) => c.t('sale_backend.invoicePreview.' + key)
  const rows = c.data.record.lines.filter((line) => Number(line.qtyToInvoice) > 0)
  const extra = rows.some((line) => line.invoicePolicy === 'delivery' && Number(line.qtyOverToInvoice) > 0)
  return (
    <Surface
      title={t('title')}
      body={
        <Stack
          items={[
            extra ? <Notice tone="warning" title={t('extraTitle')} message={t('extraHint')} /> : null,
            <DataTable
              rows={rows}
              id={(row) => String(row.id)}
              responsive="scroll"
              emptyTitle={t('empty')}
              emptyMessage={t('emptyHint')}
              columns={[
                { key: 'name', label: c.t('sale_backend.field.product'), cell: (row) => String(row.name) },
                {
                  key: 'quantity',
                  label: t('quantity'),
                  cell: (row) => (
                    <Stack
                      gap="tight"
                      items={[
                        <Text variant="bodyMd">
                          {String(row.qtyToInvoice)} {String(row.productUomName ?? '')}
                        </Text>,
                        row.invoicePolicy === 'delivery' && Number(row.qtyOverToInvoice) > 0 ? (
                          <Text variant="bodySm">
                            {c.t('sale_backend.invoicePreview.extra', {
                              quantity: row.qtyOverToInvoice,
                              ordered: row.productUomQty,
                            })}
                          </Text>
                        ) : null,
                      ]}
                    />
                  ),
                },
              ]}
            />,
          ]}
        />
      }
    />
  )
}
