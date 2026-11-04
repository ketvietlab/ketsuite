import {
  KET_GRID_NO_CHANGES,
  type KetGridIslandConfig,
  type KetGridIslandColumn,
} from '@ketvietlab/design-system'
import type { RecordModalContext } from '../../../ui/client/record-modal.tsx'
import { ketGridLocale } from '../../sale_backend/modal/line-grid-labels.ts'
import type { PricelistData } from './view.tsx'
type Row = Record<string, unknown>
const scopeFlags = (scope: string) => ({
  productLocked: scope !== '0_product_variant',
  templateLocked: scope !== '1_product',
  categoryLocked: scope !== '2_product_category',
  unitLocked: !['0_product_variant', '1_product'].includes(scope),
})
const methodFlags = (method: string) => ({
  fixedLocked: method !== 'fixed',
  discountLocked: method === 'fixed',
  formulaLocked: method !== 'formula',
  baseLocked: method === 'fixed',
  nestedLocked: true,
  minimumDiscount: method === 'formula' ? -1000 : 0,
  base: 'list_price',
  basePricelistId: null,
})
export function postedRules(form: FormData, saved: Row[]): Row[] {
  const draft = JSON.parse(String(form.get('items') || KET_GRID_NO_CHANGES)) as {
    updated?: { id: string; values: Row }[]
    added?: { id: string; values: Row }[]
    removed?: string[]
  }
  const rows = new Map(saved.map((row) => [String(row.id), row]))
  for (const row of draft.updated ?? [])
    if (rows.has(row.id)) rows.set(row.id, { ...rows.get(row.id), ...row.values })
  for (const row of draft.added ?? []) rows.set(row.id, { ...row.values, id: row.id })
  for (const id of draft.removed ?? []) rows.delete(id)
  return [...rows.values()].map((row) => ({
    ...row,
    percentPrice: String(row.computePrice === 'percentage' ? (row.discount ?? row.percentPrice ?? 0) : 0),
    priceDiscount: String(row.computePrice === 'formula' ? (row.discount ?? row.priceDiscount ?? 0) : 0),
    ...Object.fromEntries(
      ['minQuantity', 'fixedPrice', 'priceRound', 'priceSurcharge', 'priceMinMargin', 'priceMaxMargin'].map(
        (key) => [key, String(row[key] ?? 0)],
      ),
    ),
  }))
}
export function rulesGrid(c: RecordModalContext<PricelistData>): KetGridIslandConfig {
  const t = (key: string) => c.t('pricing_backend.' + key)
  const options = (group: string) =>
    c.data.choices[group]?.map((row) => ({
      value: String(row.id),
      label: String(row.displayName ?? row.name),
    })) ?? []
  const translated = (group: string, values: string[]) =>
    values.map((value) => ({ value, label: t(group + '.' + value) }))
  const scopes = ['3_global', '2_product_category', '1_product', '0_product_variant']
  const methods = ['fixed', 'percentage', 'formula']
  const columns: KetGridIslandColumn[] = [
    {
      key: 'appliedOn',
      label: t('field.appliedOn'),
      type: 'select',
      editable: true,
      options: translated('appliedOn', scopes),
      sets: Object.fromEntries(scopes.map((value) => [value, scopeFlags(value)])),
      resets: ['productId', 'templateId', 'categoryId', 'targetId', 'uomId'],
    },
    ...(['products', 'templates', 'categories'] as const).map(
      (group, index): KetGridIslandColumn => ({
        key: ['productId', 'templateId', 'categoryId'][index]!,
        label: t('field.' + ['productId', 'templateId', 'categoryId'][index]),
        type: 'combobox',
        editable:
          !!c.data.can[['product.listVariants', 'product.listTemplates', 'product.listCategories'][index]!],
        lockedBy: ['productLocked', 'templateLocked', 'categoryLocked'][index],
        options: options(group),
        resets: ['uomId'],
        ...(index < 2
          ? {
              search: {
                listFunction: index === 0 ? 'product.listVariants' : 'product.listTemplates',
                labelField: index === 0 ? 'displayName' : 'name',
                setsFrom: { targetId: 'id' },
              },
            }
          : {}),
      }),
    ),
    {
      key: 'uomId',
      label: t('field.uomId'),
      type: 'combobox',
      editable: c.data.ruleUnits,
      lockedBy: 'unitLocked',
      options: options('units'),
      search: {
        listFunction: 'pricing.listRuleUnits',
        listInputFields: { appliedOn: 'appliedOn', targetId: 'targetId' },
        labelField: 'name',
      },
    },
    { key: 'minQuantity', label: t('field.minQuantity'), type: 'number', editable: true, min: 0 },
    {
      key: 'computePrice',
      label: t('field.computePrice'),
      type: 'select',
      editable: true,
      options: translated('compute', methods),
      sets: Object.fromEntries(methods.map((value) => [value, methodFlags(value)])),
    },
    {
      key: 'base',
      label: t('field.base'),
      type: 'select',
      editable: true,
      lockedBy: 'baseLocked',
      options: translated('base', ['list_price', 'standard_price', 'pricelist']),
      optionsBy: {
        field: 'computePrice',
        values: {
          fixed: ['list_price'],
          percentage: ['list_price', 'pricelist'],
          formula: ['list_price', 'standard_price', 'pricelist'],
        },
      },
      sets: {
        list_price: { nestedLocked: true, basePricelistId: null },
        standard_price: { nestedLocked: true, basePricelistId: null },
        pricelist: { nestedLocked: false },
      },
    },
    {
      key: 'basePricelistId',
      label: t('field.basePricelistId'),
      type: 'select',
      editable: true,
      lockedBy: 'nestedLocked',
      options: options('lists'),
    },
    {
      key: 'fixedPrice',
      label: t('field.fixedPrice'),
      type: 'money',
      editable: true,
      lockedBy: 'fixedLocked',
      min: 0,
    },
    {
      key: 'discount',
      label: t('field.percentPrice'),
      type: 'number',
      editable: true,
      lockedBy: 'discountLocked',
      minField: 'minimumDiscount',
      max: 100,
    },
    {
      key: 'priceRound',
      label: t('field.priceRound'),
      type: 'select',
      editable: true,
      lockedBy: 'formulaLocked',
      // A step reads as the amount it rounds to, grouped as prices are.
      options: [
        { value: '0', label: t('round.none') },
        ...['100', '1000', '10000'].map((value) => ({
          value,
          label: Number(value).toLocaleString(c.data.lang === 'en' ? 'en-US' : 'vi-VN'),
        })),
      ],
    },
    {
      key: 'priceSurcharge',
      label: t('field.priceSurcharge'),
      type: 'number',
      editable: true,
      lockedBy: 'formulaLocked',
      fractionDigits: 0,
    },
    { key: 'dateStart', label: t('field.dateStart'), type: 'date', editable: true },
    { key: 'dateEnd', label: t('field.dateEnd'), type: 'date', editable: true },
  ]
  const row = (item: Row) => ({
    ...item,
    ...scopeFlags(String(item.appliedOn)),
    ...methodFlags(String(item.computePrice)),
    base: item.base ?? 'list_price',
    basePricelistId: item.basePricelistId ?? null,
    nestedLocked: item.base !== 'pricelist' || item.computePrice === 'fixed',
    targetId: item.productId ?? item.templateId,
    minimumDiscount: item.computePrice === 'formula' ? -1000 : 0,
    discount: Number(item.computePrice === 'percentage' ? item.percentPrice : item.priceDiscount),
    minQuantity: Number(item.minQuantity ?? 0),
    fixedPrice: Number(item.fixedPrice ?? 0),
    priceSurcharge: Number(item.priceSurcharge ?? 0),
    priceRound: String(item.priceRound ?? 0),
    dateStart: String(item.dateStart ?? '').slice(0, 10),
    dateEnd: String(item.dateEnd ?? '').slice(0, 10),
  })
  return {
    label: t('items.title'),
    ...ketGridLocale(c.data.lang),
    columns,
    rows: c.data.items.map(row),
    name: 'items',
    form: 'pricing-settings-form',
    carry: c.draft('items', KET_GRID_NO_CHANGES),
    readOnly: c.busy || !c.data.save || !c.data.saveItem,
    removable: true,
    visibleRows: 6,
    newRows: [
      {
        label: t('items.add'),
        row: row({ appliedOn: '3_global', computePrice: 'fixed', base: 'list_price', fixedPrice: '0' }),
      },
    ],
  }
}
