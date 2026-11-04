import { rewardSummary } from '../../loyalty_sale/reward-summary.ts'
import { addDecimals } from '../../account/money.ts'
import { orderWorkflowFunction } from '../record/workflow.ts'
import { formatMoney, formatDateTime } from '../../../ui/format.ts'
import { timezoneOf } from '../../backend/screen.ts'
import { randomUUID } from 'node:crypto'
import { json, text } from '@ketvietlab/ketjs'
import type { Route, Row, ServeContext } from '@ketvietlab/ketjs'
import { optionalRead } from '../../backend/optional-read.ts'
import { USER_RECORD_MODAL_LABELS } from '../../user/modal-labels.ts'
import { localeQuery } from '../../backend/screen.ts'
import { mayFor } from '../../../ui/fill-needs.ts'
import { recordIslandsFor } from '../../product/product-record-tabs.ts'
import { creditSummary } from '../customers/credit-summary.ts'
import { defaultWarehouseId } from '../../stock/default-warehouse.ts'

const COLLABORATION = 'sale_backend:order.collaboration'
// A cancelled order is listed with the quotations and returns to draft, so it prints as one.
const REPORTS: Record<string, string[]> = {
  draft: ['sale.quotation'],
  sent: ['sale.quotation', 'sale.proforma'],
  sale: ['sale.salesOrder', 'sale.proforma'],
  cancel: ['sale.quotation'],
}

/** Read through public functions so live company, branch and grant checks remain authoritative. */
export const saleOrderContext =
  (ctx: ServeContext): Route =>
  async (url, req, params) => {
    if (req.method !== 'GET') return text('GET', { status: 405 })
    const creating = params.id === 'new'
    if (!(await ctx.allows(creating ? 'sale.createOrder' : 'sale.getOrder', url, req)))
      return text('Forbidden', { status: 403 })
    const record = creating
      ? { id: '', name: '', state: 'draft', lines: [], pickings: [], invoices: [] }
      : ((await ctx.call('sale.getOrder', { id: params.id }, url, req)) as Row | null)
    if (!record) return text('Not found', { status: 404 })
    const manifest = await ctx.live(req)
    const names = [
      'previewWarnings',
      'getCatalogue',
      'listVariantMatrices',
      'getVariantMatrix',
      'setVariantMatrix',
      'saveCatalogueDraft',
      'getLineCosts',
      'listLinePricing',
      'listLinePrices',
      'createOrder',
      'copyOrder',
      'saveDeliveryPromise',
      'addLine',
      'applyLineGrid',
      'applyDiscount',
      'updatePrices',
      'getOrderTags',
      'setOrderTags',
      'getOrderSales',
      'setOrderSalesperson',
      'getTeamChoices',
      'listTeams',
      'setOptionalSections',
      'updateLine',
      'removeLine',
      'sendQuotation',
      'confirmOrder',
      'resetOrder',
      'syncDeliveries',
      'lockOrder',
      'cancelOrder',
      'createInvoice',
      'collectDeposit',
      'applyDeposit',
      'listOrderEvents',
    ]
    const permissions = Object.fromEntries(
      await Promise.all(
        names.map(async (name) => [
          name,
          await ctx.allows(
            name === 'confirmOrder' || name === 'cancelOrder'
              ? await orderWorkflowFunction(ctx, req, name)
              : `sale.${name}`,
            url,
            req,
          ),
        ]),
      ),
    )
    for (const [key, fn] of Object.entries({
      templateSave: 'saveSection',
      templateAdd: 'addSection',
      templateApply: 'applyQuotation',
      templateCreate: 'createQuotation',
      templateChoices: 'listChoices',
    }))
      permissions[key] =
        Boolean(manifest.modules.sale_template) && (await ctx.allows('sale_template.' + fn, url, req))
    for (const [key, fn] of Object.entries({
      benefitRead: 'getQuotationBenefits',
      benefitCode: 'applyCode',
      benefitApply: 'applyReward',
    }))
      permissions[key] =
        Boolean(manifest.modules.loyalty_sale) && (await ctx.allows('loyalty_sale.' + fn, url, req))
    const benefits =
      !creating && permissions.benefitRead
        ? await optionalRead<Row | null>(
            ctx,
            'loyalty_sale.getQuotationBenefits',
            { orderId: params.id },
            url,
            req,
            null,
          )
        : null
    permissions.viewPicking = await ctx.allows('stock.getPicking', url, req)
    permissions.viewInvoice = await ctx.allows('account.getMove', url, req)
    const lookup = (fn: string, input: Record<string, unknown> = {}) =>
      optionalRead<Row[]>(ctx, fn, input, url, req, [])
    const [listed, companies, variants, warehouses, pricelists, terms, journals, accounts, taxes, lineCosts] =
      await Promise.all([
        lookup('partner.listPartners', { limit: 200, customers: true }),
        creating ? lookup('company.listCompanies') : [],
        permissions.addLine ? lookup('product.listVariants', { saleOk: true, limit: 200 }) : [],
        // Saved orders name their warehouse, pricelist and terms in the summary.
        lookup('stock.listWarehouses'),
        lookup('pricing.listPricelists'),
        lookup('account.listPaymentTerms'),
        // Sale journals invoice; bank and cash journals receive deposits (D9).
        permissions.createInvoice || permissions.collectDeposit ? lookup('account.listJournals') : [],
        permissions.createInvoice || permissions.collectDeposit ? lookup('account.listAccounts') : [],
        permissions.addLine ? lookup('account.listTaxes', { typeTaxUse: 'sale' }) : [],
        !creating && permissions.getLineCosts ? lookup('sale.getLineCosts', { id: params.id }) : [],
      ])
    // The company's own partners are not its customers.
    const own = new Set(companies.map((row) => String(row.partnerId)))
    const partners = listed.filter((row) => !own.has(String(row.id)))
    const ownPartners = [...own].map((id) => ({ id }))
    const priceSteps = new Map<string, unknown>()
    if (!creating && permissions.listLinePrices) {
      const ids = [
        ...new Set(
          ((record.lines as Row[]) ?? [])
            .filter(
              (line) =>
                line.productId &&
                !line.comboParentId &&
                line.comboBasePrice == null &&
                line.priceAutomatic === true,
            )
            .map((line) => String(line.productId)),
        ),
      ]
      for (const productId of ids)
        for (const unit of await lookup('sale.listLinePrices', {
          orderId: params.id,
          productId,
          quantity: '0',
        }))
          priceSteps.set(productId + '|' + String(unit.id), unit.priceSteps)
    }
    const lang = ctx.localeOf(url, req) === 'en' ? 'en' : 'vi'
    const timezone = await timezoneOf(ctx, url, req)
    const translator = ctx.translate(lang)
    const date = (value: unknown) =>
      value && !Number.isNaN(Date.parse(String(value)))
        ? formatDateTime(lang, new Date(String(value)), { dateStyle: 'medium', timeZone: timezone })
        : '—'
    const deliveryDate = (value: unknown) =>
      /^\d{4}-\d{2}-\d{2}$/.test(String(value))
        ? formatDateTime(lang, new Date(String(value)), { dateStyle: 'medium', timeZone: 'UTC' })
        : date(value)
    const display = {
      dateOrder: date(record.dateOrder),
      datePlanned: date(record.datePlanned),
      validityDate: date(record.validityDate),
      commitmentDate: deliveryDate(record.commitmentDay ?? record.commitmentDate),
      expectedDate: deliveryDate(record.expectedDate),
      shippingPolicy: translator(`sale_backend.shippingPolicy.${record.shippingPolicy ?? 'direct'}`),
      amountTotal: formatMoney(translator, record.amountTotal, record.currency),
      amountUntaxed: formatMoney(translator, record.amountUntaxed, record.currency),
      amountTax: formatMoney(translator, record.amountTax, record.currency),
      invoiceStatus: record.invoiceStatus
        ? translator(`sale_backend.invoiceStatus.${record.invoiceStatus}`)
        : '—',
    }
    // The page's aside, header links and loyalty steps: what the server page placed through
    // joints, which a client-rendered record cannot render, so the context names them.
    const may = creating ? {} : await mayFor(manifest.fills, COLLABORATION, (fn) => ctx.allows(fn, url, req))
    const collaboration = creating
      ? []
      : recordIslandsFor({ manifest }, COLLABORATION, (fn) => {
          const [module = '', name = ''] = fn.split('.')
          return may[module]?.[name] === true
        })
    const id = encodeURIComponent(String(record.id))
    // Reports and linked records keep the page's company and branch.
    const reportQuery = new URLSearchParams({ lang })
    for (const key of ['company', 'branch'])
      if (url.searchParams.has(key)) reportQuery.set(key, url.searchParams.get(key)!)
    const reports = creating
      ? []
      : (await ctx.reportsOf(url, req, 'sale.Order'))
          .filter((report) => (REPORTS[String(record.state)] ?? []).includes(report.id))
          .map((report) => ({
            label: translator(report.title),
            href: `/reports/${encodeURIComponent(report.id)}/${id}?${reportQuery}`,
          }))
    const loyalty =
      !creating &&
      manifest.routes['/admin/loyalty/orders/{channel}/{id}'] &&
      (await ctx.allows('loyalty_sale.evaluateOrder', url, req))
        ? {
            label: translator('loyalty_backend.action.openOrderLoyalty'),
            href: `/admin/loyalty/orders/sale/${id}${localeQuery(url)}`,
          }
        : null
    const messages = Object.fromEntries(
      Object.entries(manifest.messages?.[lang] ?? {}).filter(
        ([key]) =>
          key.startsWith('sale_template.') ||
          key.startsWith('loyalty_sale.') ||
          key.startsWith('loyalty.') ||
          key.startsWith('stock_backend.state.') ||
          key.startsWith('sale_backend.') ||
          key.startsWith('sale.') ||
          key.startsWith('backend.relation.') ||
          // The customer picker creates a partner on the spot.
          key.startsWith('partner_backend.field.') ||
          key.startsWith('partner.kind.'),
      ),
    )
    const commercialLines = ((record.lines as Row[]) ?? []).filter(
      (line) => !line.displayType && line.comboBasePrice == null,
    )
    const comparableCosts =
      permissions.getLineCosts &&
      commercialLines.every((line) => lineCosts.some((cost) => cost.lineId === line.id)) &&
      lineCosts.every((cost) => cost.currency === record.currency && cost.margin != null)
    const marginTotal = comparableCosts
      ? lineCosts.reduce((sum, cost) => addDecimals(sum, cost.margin), '0')
      : null
    // Over the customer's credit limit, counting this quotation: a warning, never a block (D12).
    const credit =
      creating || record.state === 'cancel'
        ? null
        : await optionalRead<Row | null>(
            ctx,
            'sale.getCustomerCredit',
            { partnerId: record.partnerId, orderId: params.id },
            url,
            req,
            null,
          )
    // Tags name the order for the company's own use; they change on a confirmed order too (D15).
    const orderTags =
      creating || !permissions.getOrderTags
        ? null
        : await optionalRead<Row | null>(ctx, 'sale.getOrderTags', { id: params.id }, url, req, null)
    const held = ((orderTags?.tags as Row[] | undefined) ?? []).map((row) => ({ id: row.id, name: row.name }))
    const tagChoices = !creating && permissions.setOrderTags ? await lookup('sale.listTags') : []
    // Who sold it and with which team (D16): kept on a confirmed order too, outside its revision.
    const sales =
      creating || !permissions.getOrderSales
        ? null
        : await optionalRead<Row | null>(ctx, 'sale.getOrderSales', { id: params.id }, url, req, null)
    const picksSales = creating ? permissions.createOrder : permissions.setOrderSalesperson
    const people =
      picksSales && permissions.getTeamChoices
        ? (((await optionalRead<Row>(ctx, 'sale.getTeamChoices', {}, url, req, {})).salespeople as
            | Row[]
            | undefined) ?? [])
        : []
    const teamChoices = picksSales && permissions.listTeams ? await lookup('sale.listTeams') : []
    // Who changed the order and how (D7), newest first; documents link where the viewer may open them.
    const events =
      creating || !permissions.listOrderEvents ? [] : await lookup('sale.listOrderEvents', { id: params.id })
    const documents = new Map<string, { name: string; href: string | null }>()
    for (const row of (record.invoices as Row[]) ?? [])
      documents.set(String(row.id), {
        name: String(row.name ?? row.id),
        href: permissions.viewInvoice
          ? `/admin/accounting/customer-invoices/${encodeURIComponent(String(row.id))}?${reportQuery}`
          : null,
      })
    for (const row of (record.deposits as Row[]) ?? [])
      documents.set(String(row.id), {
        name: String(row.name ?? row.id),
        href: permissions.viewInvoice
          ? `/admin/accounting/entries/${encodeURIComponent(String(row.moveId))}?${reportQuery}`
          : null,
      })
    const history = events.map((event) => {
      const action = translator(`sale_backend.history.action.${String(event.action)}`)
      const related = event.relatedId ? documents.get(String(event.relatedId)) : undefined
      const named = String((event.details as Row | undefined)?.name ?? '')
      return {
        id: event.id,
        when: Number.isNaN(Date.parse(String(event.occurredAt)))
          ? '—'
          : formatDateTime(lang, new Date(String(event.occurredAt)), {
              dateStyle: 'medium',
              timeStyle: 'short',
              timeZone: timezone,
            }),
        actor: String(event.actorName ?? '') || translator('sale_backend.history.system'),
        action:
          action === `sale_backend.history.action.${String(event.action)}` ? String(event.action) : action,
        detail: [related?.name ?? named, event.reason].filter(Boolean).join(' · ') || '—',
        // A copy names the quotation it came from, which the viewer reads as they read this one.
        detailHref:
          related?.href ??
          (event.action === 'copy' && event.relatedId
            ? `/admin/sales/orders/${encodeURIComponent(String(event.relatedId))}?${reportQuery}`
            : null),
      }
    })
    return json({
      data: {
        creditWarning: credit?.over
          ? creditSummary(
              translator,
              credit,
              String(partners.find((row) => row.id === record.partnerId)?.name ?? ''),
            ).orderMessage
          : null,
        saleWarningsOn:
          (await optionalRead<Row | null>(ctx, 'sale.getWarningSettings', {}, url, req, null))?.enabled ===
          true,
        draftId: randomUUID(),
        benefits: benefits && {
          ...benefits,
          // One line per reward in the words of the program list, for the dialogs and the applied table.
          rewardSummaries: Object.fromEntries(
            Object.entries((benefits.rewardTerms as Record<string, Row> | undefined) ?? {}).map(
              ([id, terms]) => [id, rewardSummary(translator, terms)],
            ),
          ),
        },
        costSummary: permissions.getLineCosts
          ? {
              margin: marginTotal,
              label:
                marginTotal == null
                  ? translator('sale_backend.cost.unknown')
                  : formatMoney(translator, marginTotal, record.currency),
              currency: record.currency,
            }
          : undefined,
        lineCosts: permissions.getLineCosts
          ? lineCosts.map((cost) => {
              const line = ((record.lines as Row[]) ?? []).find((row) => row.id === cost.lineId)
              return {
                ...cost,
                name: line?.name ?? cost.productId,
                unitName: line?.productUomName || cost.productUomId || '—',
                marginLabel: cost.margin == null ? null : formatMoney(translator, cost.margin, cost.currency),
                unitCostLabel:
                  cost.unitCost == null ? null : formatMoney(translator, cost.unitCost, cost.currency),
              }
            })
          : undefined,
        record: {
          ...record,
          display,
          moves: ((record.moves as Row[]) ?? []).map((row) => ({
            ...row,
            // Each move ships one line's goods: a combo delivers its items, one row each (P47).
            productName:
              ((record.lines as Row[]) ?? []).find((line) => line.id === row.saleLineId)?.name ??
              row.productId,
            pickingHref:
              permissions.viewPicking && row.pickingId
                ? `/admin/stock/transfers/${encodeURIComponent(String(row.pickingId))}?${reportQuery}`
                : null,
          })),
          deposits: ((record.deposits as Row[]) ?? []).map((row) => ({
            ...row,
            href: permissions.viewInvoice
              ? `/admin/accounting/entries/${encodeURIComponent(String(row.moveId))}?${reportQuery}`
              : null,
            amountLabel: formatMoney(translator, row.amount, row.currency ?? record.currency),
            unappliedLabel: formatMoney(translator, row.unapplied, row.currency ?? record.currency),
            dateLabel: date(row.date),
          })),
          invoices: ((record.invoices as Row[]) ?? []).map((row) => ({
            ...row,
            href: permissions.viewInvoice
              ? `/admin/accounting/customer-invoices/${encodeURIComponent(String(row.id))}?${reportQuery}`
              : null,
            amountTotalLabel: formatMoney(translator, row.amountTotal, row.currency ?? record.currency),
          })),
          lines: ((record.lines as Row[]) ?? []).map((row) => ({
            ...row,
            priceSteps: priceSteps.get(String(row.productId) + '|' + String(row.productUomId)),
            priceUnitLabel: formatMoney(translator, row.priceUnit, record.currency),
            priceSubtotalLabel: formatMoney(translator, row.priceSubtotal, record.currency),
          })),
          warehouseName: warehouses.find((row) => row.id === record.warehouseId)?.name ?? record.warehouseId,
          // K15 (#1428): a new quotation starts in the seller's one warehouse, or the company's only one;
          // whoever may work in several picks one.
          ...(creating && defaultWarehouseId(warehouses)
            ? { warehouseId: defaultWarehouseId(warehouses) }
            : {}),
          pricelistName: pricelists.find((row) => row.id === record.pricelistId)?.name ?? '—',
          paymentTermName: terms.find((row) => row.id === record.paymentTermId)?.name ?? '—',
          partnerName: partners.find((row) => row.id === record.partnerId)?.name ?? record.partnerId,
          tagIds: held.map((row) => String(row.id)),
          tagNames: held.map((row) => String(row.name)).join(', ') || '—',
          userId: sales?.userId ?? null,
          userName: String(sales?.userName ?? '') || '—',
          teamId: sales?.teamId ?? null,
          teamName: String(sales?.teamName ?? '') || '—',
        },
        templateSections:
          !creating && manifest.modules.sale_template
            ? await lookup('sale_template.sectionChoices', { id: params.id })
            : [],
        matrices:
          !creating && permissions.listVariantMatrices
            ? await lookup('sale.listVariantMatrices', { id: params.id })
            : [],
        permissions,
        collaboration,
        reports,
        loyalty,
        history: permissions.listOrderEvents ? history : undefined,
        choices: {
          partners,
          ownPartners,
          variants,
          warehouses,
          pricelists,
          terms,
          journals,
          accounts,
          taxes,
          tags: [
            ...tagChoices.map((row) => ({ id: row.id, name: row.name })),
            ...held.filter((row) => !tagChoices.some((choice) => choice.id === row.id)),
          ],
          // The order keeps a salesperson who left and a team archived since; nobody else takes them on.
          salespeople: [
            ...people.map((row) => ({ id: row.id, name: row.name })),
            ...(sales?.userId && !people.some((row) => row.id === sales.userId)
              ? [{ id: sales.userId, name: sales.userName || sales.userId }]
              : []),
          ],
          teams: [
            ...teamChoices.map((row) => ({ id: row.id, name: row.name })),
            ...(sales?.teamId && !teamChoices.some((row) => row.id === sales.teamId)
              ? [{ id: sales.teamId, name: sales.teamName || sales.teamId }]
              : []),
          ],
        },
        lang,
      },
      messages: { ...messages, ...USER_RECORD_MODAL_LABELS[lang] },
    })
  }
