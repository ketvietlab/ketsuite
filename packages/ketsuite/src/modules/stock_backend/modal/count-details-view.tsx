import {
  Button,
  DataTable,
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
type Row = Record<string, unknown>
const fields = ['name', 'title', 'role'] as const
const tr = (c: CountContext, key: string) => c.t(`stock_backend.count.${key}`)
const members = (c: CountContext) => (c.data.record.committee as Row[] | null) ?? []
const form = 'stock-count-details-form'
export function committeeGridConfig(c: CountContext): KetGridIslandConfig {
  return {
    ...ketGridLocale(c.data.lang),
    label: tr(c, 'committee'),
    name: 'committee',
    form,
    columns: fields.map((key) => ({
      key,
      label: tr(c, `committee.${key}`),
      type: 'text',
      editable: true,
      required: true,
      width: 180,
      grow: 1,
    })),
    rows: members(c).map((row, index) => ({ ...row, id: String(row.id ?? index) })),
    newRow: { name: '', title: '', role: '' },
    removable: true,
    readOnly: c.busy,
    visibleRows: 4,
    carry: c.draft('committee', KET_GRID_NO_CHANGES),
  }
}
export function countDetails(c: CountContext) {
  const editable = c.data.record.state === 'counting' && c.data.permissions.saveCountDetails
  return (
    <Surface
      title={tr(c, 'minutes')}
      body={
        editable ? (
          <RecordModalForm
            kind={c.kind}
            id={form}
            command="details"
            fields={[
              {
                id: 'count-resolution',
                name: 'resolution',
                label: tr(c, 'resolution'),
                type: 'textarea',
                value: c.draft('resolution', String(c.data.record.resolution ?? '')),
                readOnly: false,
                disabled: c.busy,
                error: c.fieldError('resolution'),
              },
            ]}
            body={
              <Stack
                items={[
                  c.fieldError('committee') ? (
                    <Notice
                      tone="danger"
                      title={tr(c, 'committee')}
                      message={c.fieldError('committee') ?? ''}
                    />
                  ) : null,
                  recordIsland('backend.ket-grid', {
                    id: `count-committee-${c.id}`,
                    config: committeeGridConfig(c),
                  }),
                ]}
              />
            }
            actions={[<Button type="submit" label={tr(c, 'saveDetails')} disabled={c.busy} />]}
          />
        ) : (
          <Stack
            items={[
              <DataTable
                rows={members(c)}
                emptyTitle={tr(c, 'committee')}
                emptyMessage={tr(c, 'noCommittee')}
                id={(row) => String(row.id)}
                responsive="scroll"
                columns={fields.map((key) => ({
                  key,
                  label: tr(c, `committee.${key}`),
                  cell: (row: Row) => String(row[key] ?? ''),
                }))}
              />,
              <Notice
                tone="info"
                title={tr(c, 'resolution')}
                message={String(c.data.record.resolution || tr(c, 'noResolution'))}
              />,
            ]}
          />
        )
      }
    />
  )
}
export function countDetailsInput(form: FormData, c: CountContext) {
  try {
    const changes = JSON.parse(String(form.get('committee') || KET_GRID_NO_CHANGES))
    const rows = new Map(members(c).map((row, index) => [String(row.id ?? index), { ...row }]))
    for (const id of changes.removed ?? []) rows.delete(String(id))
    for (const row of changes.updated ?? []) {
      if (!rows.has(String(row.id))) throw new Error('Unknown member')
      rows.set(String(row.id), { ...rows.get(String(row.id)), ...row.values })
    }
    for (const row of changes.added ?? []) rows.set(String(row.id), { ...row.values, id: String(row.id) })
    return { id: c.id, committee: [...rows.values()], resolution: String(form.get('resolution') ?? '') }
  } catch {
    return { id: c.id, committee: null, resolution: '' }
  }
}
