import type { Row, Translator } from '@ketvietlab/ketjs'
import { formatMoney } from '../../../ui/format.ts'

/** The credit card and the order page's warning say the same thing (D12). */
export const creditSummary = (_: Translator, credit: Row, name?: string) => {
  const money = (value: unknown) => formatMoney(_, value, credit.currency)
  const values = {
    name: String(name ?? ''),
    exposure: money(credit.exposure),
    limit: credit.creditLimit == null ? _('sale_backend.customers.noLimit') : money(credit.creditLimit),
  }
  const fill = (key: string) =>
    Object.entries(values).reduce((message, [k, v]) => message.replaceAll(`{${k}}`, v), _(key))
  return {
    over: credit.over === true,
    overMessage: fill('sale_backend.customers.overMessage'),
    orderMessage: fill('sale_backend.customers.orderOverMessage'),
    limit: values.limit,
    receivable: money(credit.receivable),
    uninvoiced: money(credit.uninvoiced),
    exposure: values.exposure,
  }
}
