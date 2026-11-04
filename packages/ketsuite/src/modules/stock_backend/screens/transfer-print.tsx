import {
  DataTable,
  DescriptionList,
  Grid,
  Inline,
  LinkButton,
  RecordCanvas,
  SignatureBlock,
  Stack,
  Surface,
  Text,
} from '@ketvietlab/design-system'
import type { Translator } from '@ketvietlab/ketjs'
import type { TemplateResult } from '@ketvietlab/ketjs-view'
import { amountWords } from '../../../ui/amount-words.ts'
import { formatMoney } from '../../../ui/format.ts'
import { standalonePage } from '../../../ui/layout.tsx'

type Row = Record<string, unknown>
type PrintRow = Row & { id: string; no: string }

/**
 * A stock operation's printed copy (K65), a document of its own printed with the browser: the
 * company and the voucher, who and what for, the goods a row a lot, and the people who sign.
 * It reads what `stock.get…Report` returns, the same data the PDF reports print, and composes the
 * public design system only: no print CSS of its own.
 */
export function TransferPrint(props: { _: Translator; data: Row; back: string }): TemplateResult {
  const { _, data } = props
  const voucher = data.voucher as Row
  const company = data.company as Row
  const partner = data.partner as Row
  const currency = String(data.currency ?? 'VND')
  const valued = data.valued === true
  const money = (value: unknown) => (value === '' || value == null ? '' : formatMoney(_, value, currency))
  const rows: PrintRow[] = (data.lines as Row[]).flatMap((line) =>
    (line.rows as Row[]).map((row, index) => ({
      ...row,
      id: `${String(line.no)}-${index + 1}`,
      // A product reads once, on its first lot; the lots under it leave the number and name blank.
      no: index === 0 ? String(line.no) : '',
      code: index === 0 ? line.code : '',
      product: index === 0 ? line.product : '',
      uom: line.uom,
    })),
  )
  // A voucher writes its dates day first: 01/03/2031, and its own date spelled out as the form has it.
  const day = (value: unknown) => {
    const text = String(value ?? '')
    return /^\d{4}-\d{2}-\d{2}/.test(text)
      ? `${text.slice(8, 10)}/${text.slice(5, 7)}/${text.slice(0, 4)}`
      : text
  }
  const [year = '', month = '', date = ''] = String(data.date ?? '').split('-')
  const dated = _('stock_backend.print.dayLine')
    .replace('{day}', date)
    .replace('{month}', month)
    .replace('{year}', year)
  const quantity = (value: unknown, row: Row) => (value === '' || value == null ? '' : `${value} ${row.uom}`)
  const columns = [
    {
      key: 'no',
      label: _('stock.report.no'),
      kind: 'number' as const,
      align: 'end' as const,
      width: 'narrow' as const,
      cell: (row: PrintRow) => row.no,
    },
    {
      key: 'code',
      label: _('stock.report.code'),
      kind: 'identifier' as const,
      cell: (row: PrintRow) => String(row.code ?? ''),
    },
    {
      key: 'product',
      label: _('stock.report.product'),
      priority: 'primary' as const,
      width: 'wide' as const,
      cell: (row: PrintRow) => String(row.product ?? ''),
    },
    { key: 'lot', label: _('stock.report.lot'), cell: (row: PrintRow) => String(row.lot ?? '') },
    {
      key: 'expiry',
      label: _('stock.report.expiry'),
      kind: 'date' as const,
      cell: (row: PrintRow) => day(row.expiry),
    },
    {
      key: 'demand',
      label: _(String(voucher.demand)),
      kind: 'number' as const,
      align: 'end' as const,
      cell: (row: PrintRow) => quantity(row.demand, row),
    },
    ...(data.showHeld === true
      ? [
          {
            key: 'held',
            label: _('stock.report.held'),
            kind: 'number' as const,
            align: 'end' as const,
            cell: (row: PrintRow) => quantity(row.held, row),
          },
        ]
      : []),
    {
      key: 'quantity',
      label: _(String(voucher.done)),
      kind: 'number' as const,
      align: 'end' as const,
      cell: (row: PrintRow) => quantity(row.quantity, row),
    },
    ...(valued
      ? [
          {
            key: 'unitCost',
            label: _('stock.report.unitCost'),
            kind: 'currency' as const,
            align: 'end' as const,
            cell: (row: PrintRow) => money(row.unitCost),
          },
          {
            key: 'amount',
            label: _('stock.report.amount'),
            kind: 'currency' as const,
            align: 'end' as const,
            cell: (row: PrintRow) => money(row.amount),
          },
        ]
      : []),
  ]
  const facts = [
    voucher.partner && partner.name
      ? { id: 'partner', label: _(String(voucher.partner)), value: String(partner.name) }
      : null,
    partner.address
      ? { id: 'address', label: _('stock.report.address'), value: String(partner.address) }
      : null,
    data.origin ? { id: 'origin', label: _('stock.report.origin'), value: String(data.origin) } : null,
    { id: 'place', label: _(String(voucher.place)), value: String(data.warehouse ?? '') },
    { id: 'from', label: _('stock.report.from'), value: String((data.source as Row).name ?? '') },
    { id: 'to', label: _('stock.report.to'), value: String((data.destination as Row).name ?? '') },
  ].filter((item): item is { id: string; label: string; value: string } => !!item?.value)
  return standalonePage(
    <RecordCanvas
      body={
        <Stack
          items={[
            <Inline
              align="between"
              items={[
                <LinkButton label={_('stock_backend.print.back')} href={props.back} variant="tertiary" />,
                <Text variant="bodySm" tone="muted">
                  {_('stock_backend.print.hint')}
                </Text>,
              ]}
            />,
            <Surface
              body={
                <Stack
                  items={[
                    <Grid
                      columns={2}
                      items={[
                        <Stack
                          gap="tight"
                          items={[
                            <Text fontWeight="semibold">{String(company.name ?? '')}</Text>,
                            ...(company.address
                              ? [<Text variant="bodySm">{String(company.address)}</Text>]
                              : []),
                            ...(company.vat
                              ? [
                                  <Text variant="bodySm">{`${_('stock.report.vat')}: ${String(company.vat)}`}</Text>,
                                ]
                              : []),
                          ]}
                        />,
                        ...(voucher.form
                          ? [
                              <Stack
                                gap="tight"
                                items={[
                                  <Text fontWeight="semibold" alignment="end">
                                    {_(String(voucher.form))}
                                  </Text>,
                                  <Text variant="bodySm" tone="muted" alignment="end">
                                    {_('stock.report.formReference')}
                                  </Text>,
                                ]}
                              />,
                            ]
                          : []),
                      ]}
                    />,
                    <Stack
                      gap="tight"
                      items={[
                        <Text as="h1" variant="headingLg" alignment="center">
                          {_(String(voucher.title))}
                        </Text>,
                        <Text alignment="center">{dated}</Text>,
                        <Text alignment="center">{`${_('stock.report.number')}: ${String(data.name ?? '')}`}</Text>,
                      ]}
                    />,
                    <DescriptionList columns={2} items={facts} />,
                    <DataTable
                      label={_(String(voucher.title))}
                      rows={rows}
                      id={(row) => row.id}
                      responsive="stack"
                      gutter="compact"
                      columns={columns}
                    />,
                    ...(valued
                      ? [
                          <DescriptionList
                            columns={1}
                            items={[
                              { id: 'total', label: _('stock.report.total'), value: money(data.total) },
                              {
                                id: 'words',
                                label: _('stock.report.inWords'),
                                value: amountWords(data.total, _.locale === 'en' ? 'en' : 'vi', currency),
                              },
                            ]}
                          />,
                        ]
                      : []),
                    // Each signer has room to sign above a line for their name.
                    <Grid
                      columns={4}
                      mobileColumns={2}
                      items={(voucher.signers as string[]).map((key) => (
                        <SignatureBlock label={_(key)} hint={_('stock.report.signHint')} />
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
