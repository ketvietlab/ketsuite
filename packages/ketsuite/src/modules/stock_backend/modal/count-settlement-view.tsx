import {
  Button,
  KET_GRID_NO_CHANGES,
  Notice,
  Stack,
  Surface,
  type KetGridIslandConfig,
} from '@ketvietlab/design-system'
import { recordIsland } from '../../../ui/client/record-modal.tsx'
import { RecordModalForm } from '../../../ui/client/record-modal-form.tsx'
import { ketGridLocale } from '../../../ui/ket-grid-locale.ts'
import type { CountContext } from './count-view.tsx'

const formId = 'stock-count-settlement-form'
const tr = (c: CountContext, key: string) => c.t(`stock_backend.count.${key}`)
const remaining = (c: CountContext) =>
  c.data.record.lines.filter((line) => !line.settlementId && Number(line.difference) !== 0)

export function settlementGridConfig(c: CountContext): KetGridIslandConfig {
  return {
    label: tr(c, 'settle'),
    ...ketGridLocale(c.data.lang),
    name: 'settlements',
    form: formId,
    carry: c.draft('settlements', KET_GRID_NO_CHANGES),
    readOnly: c.busy,
    visibleRows: 8,
    columns: [
      {
        key: 'product',
        label: c.t('stock_backend.field.product'),
        type: 'text',
        editable: false,
        grow: 1,
        width: 220,
      },
      { key: 'difference', label: tr(c, 'difference'), type: 'number', editable: false, width: 100 },
      ...(c.data.value
        ? [
            {
              key: 'value',
              label: tr(c, 'settlementValue'),
              type: 'text' as const,
              editable: false,
              width: 120,
            },
          ]
        : []),
      {
        key: 'method',
        label: tr(c, 'settlementMethod'),
        type: 'select',
        editable: true,
        width: 240,
        options: ['632', '1388', '334', '811', '711'].map((value) => ({
          value,
          label: tr(c, `method.${value}`),
        })),
        optionsBy: { field: 'side', values: { shortage: ['632', '1388', '334', '811'], excess: ['711'] } },
      },
    ],
    rows: remaining(c).map((line) => ({
      id: String(line.id),
      product: String(c.data.choices.products.find((p) => p.id === line.productId)?.name ?? line.productId),
      difference: Number(line.difference),
      side: Number(line.difference) < 0 ? 'shortage' : 'excess',
      value: String(line.value ?? ''),
      method: '',
    })),
  }
}

export function settlementForm(c: CountContext) {
  const labels = Object.fromEntries(
    [
      'choose',
      'search',
      'more',
      'noRecords',
      'loading',
      'loadError',
      'close',
      'select',
      'retry',
      'clear',
      'chosen',
    ].map((key) => [key, c.t(`backend.relation.${key}`)]),
  )
  return (
    <Surface
      title={tr(c, 'settle')}
      body={
        <RecordModalForm
          kind={c.kind}
          id={formId}
          command="settle"
          fields={[
            {
              id: 'count-settlement-date',
              name: 'accountingDate',
              label: tr(c, 'settlementDate'),
              type: 'date',
              // The calendar names itself in the page language, not the picker's default.
              locale: c.data.lang === 'en' ? 'en' : 'vi',
              required: true,
              value: c.draft('accountingDate', ''),
              error: c.fieldError('accountingDate'),
              disabled: c.busy,
            },
            {
              id: 'count-settlement-person',
              name: 'partnerId',
              label: tr(c, 'settlementPerson'),
              error: c.fieldError('partnerId'),
              control: recordIsland('backend.relation-select', {
                id: 'count-settlement-person',
                config: {
                  name: 'partnerId',
                  triggerId: 'count-settlement-person',
                  ariaLabel: tr(c, 'settlementPerson'),
                  value: c.draft('partnerId', '') || null,
                  options: (c.data.choices.people ?? []).map((row) => ({
                    value: String(row.id),
                    label: String(row.name),
                  })),
                  labels: { ...labels, dialogTitle: tr(c, 'settlementPerson') },
                  disabled: c.busy,
                },
              }),
            },
          ]}
          body={
            <Stack
              items={[
                <Notice tone="info" title={tr(c, 'settle')} message={tr(c, 'settlementHint')} />,
                c.fieldError('settlements') ? (
                  <Notice
                    tone="danger"
                    title={c.t('recordModal.errorTitle')}
                    message={c.fieldError('settlements')!}
                  />
                ) : null,
                recordIsland('backend.ket-grid', {
                  id: `count-settlements-${c.id}`,
                  config: settlementGridConfig(c),
                }),
              ]}
            />
          }
          actions={[<Button type="submit" variant="primary" label={tr(c, 'settle')} disabled={c.busy} />]}
        />
      }
    />
  )
}

export function settlementInput(form: FormData, c: CountContext) {
  let lines: Record<string, unknown>[] = []
  try {
    const changes = JSON.parse(String(form.get('settlements') ?? '{}'))
    if (Array.isArray(changes.updated))
      lines = changes.updated
        .filter((row: { values?: { method?: string } }) => row.values?.method)
        .map((row: { id: string; values: { method: string } }) => ({
          lineId: row.id,
          method: row.values.method,
          partnerId: ['1388', '334'].includes(row.values.method)
            ? String(form.get('partnerId') ?? '') || null
            : null,
        }))
  } catch {
    /* The domain names an empty or malformed batch at the grid. */
  }
  return {
    id: c.data.draftId,
    sessionId: c.id,
    accountingDate: String(form.get('accountingDate') ?? ''),
    lines,
  }
}
