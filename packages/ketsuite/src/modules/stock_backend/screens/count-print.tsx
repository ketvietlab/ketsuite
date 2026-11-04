import {
  DataTable,
  DescriptionList,
  Grid,
  LinkButton,
  RecordCanvas,
  SignatureBlock,
  Stack,
  Surface,
  Text,
} from '@ketvietlab/design-system'
import type { Translator } from '@ketvietlab/ketjs'
import { formatMoney } from '../../../ui/format.ts'
import { standalonePage } from '../../../ui/layout.tsx'
type Row = Record<string, unknown>
/** 05-VT: quantity-only copies never receive the private value snapshot. */
export function CountPrint({ _, data, back }: { _: Translator; data: Row; back: string }) {
  const tr = (key: string) => _(`stock_backend.count.${key}`)
  const company = data.company as Row
  const members = data.committee as Row[]
  const shown = (value: unknown) => (value == null ? '—' : String(value))
  const at = new Intl.DateTimeFormat('en-GB', {
    dateStyle: 'short',
    timeStyle: 'short',
    timeZone: String(data.timezone),
  }).format(new Date(String(data.startedAt)))
  const figures = ['expected', 'counted', 'difference']
  const money = (value: unknown) => (value == null ? '—' : formatMoney(_, value, String(data.currency)))
  return standalonePage(
    <RecordCanvas
      body={
        <Stack
          items={[
            <LinkButton href={back} label={tr('backToCount')} variant="tertiary" />,
            <Text variant="bodySm" tone="muted">
              {_('stock_backend.print.hint')}
            </Text>,
            <Surface
              body={
                <Stack
                  items={[
                    <Text fontWeight="semibold">{String(company.name)}</Text>,
                    company.address ? <Text>{String(company.address)}</Text> : null,
                    company.vat ? (
                      <Text variant="bodySm">{`${_('stock.report.vat')}: ${String(company.vat)}`}</Text>
                    ) : null,
                    <Text variant="bodySm" tone="muted">
                      {tr('form05')}
                    </Text>,
                    <Text variant="bodySm" tone="muted">
                      {_('stock.report.formReference')}
                    </Text>,
                    <Text variant="headingLg">{tr('minutesTitle')}</Text>,
                    <DescriptionList
                      items={[
                        { id: 'number', label: _('stock.report.number'), value: String(data.name) },
                        { id: 'time', label: tr('inventoryTime'), value: at },
                        {
                          id: 'warehouse',
                          label: _('stock_backend.field.warehouse'),
                          value: String(data.warehouse),
                        },
                      ]}
                    />,
                    <Text fontWeight="semibold">{tr('committee')}</Text>,
                    <DataTable
                      rows={members}
                      id={(row) => String(row.id)}
                      responsive="scroll"
                      columns={['name', 'title', 'role'].map((key) => ({
                        key,
                        label: tr(`committee.${key}`),
                        cell: (row: Row) => String(row[key]),
                      }))}
                    />,
                    ...(data.lines as Row[]).map((line) => (
                      <Stack
                        items={[
                          <Text fontWeight="semibold">{`${shown(line.no)}. ${shown(line.code)} · ${shown(line.product)}${line.lot ? ` · ${shown(line.lot)}` : ''} · ${shown(line.uom)}`}</Text>,
                          <DataTable
                            responsive="scroll"
                            rows={[
                              {
                                id: 'quantity',
                                label: tr('quantity'),
                                expected: shown(line.expected),
                                counted: shown(line.counted),
                                difference: shown(line.difference),
                              },
                              ...(data.valued
                                ? [
                                    {
                                      id: 'value',
                                      label: tr('value'),
                                      expected: money(line.bookValue),
                                      counted: money(line.physicalValue),
                                      difference: money(line.differenceValue),
                                    },
                                  ]
                                : []),
                            ]}
                            id={(row) => row.id}
                            columns={[
                              { key: 'label', label: tr('measure'), cell: (row) => row.label },
                              ...figures.map((key) => ({
                                key,
                                label: tr(key),
                                kind: 'number' as const,
                                cell: (row: Row) => shown(row[key]),
                              })),
                            ]}
                          />,
                          <DataTable
                            responsive="scroll"
                            rows={[line]}
                            id={(row) => String(row.id)}
                            columns={['qualityGood', 'qualityPoor', 'qualityLost'].map((key) => ({
                              key,
                              label: tr(key),
                              kind: 'number' as const,
                              cell: (row: Row) => shown(row[key]),
                            }))}
                          />,
                        ]}
                      />
                    )),
                    <Text fontWeight="semibold">{tr('resolution')}</Text>,
                    <Text>{String(data.resolution || tr('noResolution'))}</Text>,
                    <Grid
                      columns={3}
                      items={members.map((member) => (
                        <SignatureBlock
                          label={String(member.role)}
                          name={String(member.name)}
                          hint={`${String(member.title)} · ${_('stock.report.signHint')}`}
                        />
                      ))}
                    />,
                  ]}
                />
              }
            />,
          ]}
        />
      }
    />,
  )
}
