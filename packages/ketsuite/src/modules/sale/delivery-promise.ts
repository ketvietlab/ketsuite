import { isDateText } from '@ketvietlab/ketjs'
import { zonedToUtc } from '../calendar/recurrence.ts'
import { companyCivilDate } from '../company/civil-date.ts'
import type { Ctx, Row } from '@ketvietlab/ketjs'
import { defineFormSchema, validateForm } from '@ketvietlab/ketjs-view'

export const deliveryFormSchema = defineFormSchema({
  fields: {
    shippingPolicy: { type: 'text', oneOf: ['direct', 'one'] },
    commitmentDate: {
      type: 'datetime',
      nullable: true,
      empty: 'null',
      validate: (value) =>
        value == null || isDateText(String(value).slice(0, 10))
          ? true
          : {
              field: 'commitmentDate',
              code: 'sale.error.delivery.invalid',
              messageKey: 'sale.error.delivery.invalid',
            },
    },
  },
  unknown: 'drop',
})
export const deliveryRefusal = (field: string, code: string) => ({
  ok: false,
  errors: [{ field, code: `sale.error.delivery.${code}` }],
})
export async function deliveryPatch(ctx: Ctx, args: Row, order: Row): Promise<Row | null> {
  const checked = validateForm(deliveryFormSchema, args)
  if (!checked.valid) return deliveryRefusal(checked.issues[0]?.field ?? 'commitmentDate', 'invalid')
  const commitment = args.commitmentDate
  if (commitment && (await deliveryDay(ctx, commitment)) < (await deliveryDay(ctx, order.dateOrder)))
    return deliveryRefusal('commitmentDate', 'beforeOrder')
  return null
}

/** Date-only input already names a civil day; timestamps belong to the active company. */
export async function deliveryDay(ctx: Ctx, value: unknown): Promise<string> {
  const text = String(value)
  return /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : companyCivilDate(ctx, text)
}

/** Live catalogue lead days inherited by every SKU; services and combo parents do not ship. */
export async function expectedDeliveryDate(ctx: Ctx, order: Row, lines: Row[]): Promise<string | null> {
  const anchor = order.confirmedAt ?? order.dateOrder
  if (!Number.isFinite(Date.parse(String(anchor)))) return null
  const from = Date.parse(await deliveryDay(ctx, anchor))
  if (!Number.isFinite(from)) return null
  const days: number[] = []
  for (const line of lines) {
    if (!line.productId || line.comboBasePrice != null || !(Number(line.productUomQty) > 0)) continue
    const sku = (await ctx.db.select('product.Product', { id: line.productId }))[0]
    const template = sku && (await ctx.db.select('product.Template', { id: sku.templateId }))[0]
    if (template?.type !== 'goods') continue
    days.push(Number(template.saleDelay ?? 0))
  }
  if (!days.length) return null
  const delay = order.shippingPolicy === 'one' ? Math.max(...days) : Math.min(...days)
  return new Date(from + delay * 86_400_000).toISOString().slice(0, 10)
}

/** Stock stores instants; a date-only promise means midnight in the company's civil timezone. */
export async function deliverySchedule(ctx: Ctx, value: unknown): Promise<string> {
  const text = String(value)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return new Date(text).toISOString()
  const company = (await ctx.db.select('company.Company', { id: ctx.scope.company }))[0]
  const [year, month, day] = text.split('-').map(Number)
  return zonedToUtc(
    { year: year!, month: month!, day: day!, hour: 0, minute: 0, second: 0 },
    String(company?.accountingTimezone || 'Asia/Ho_Chi_Minh'),
  ).toISOString()
}
