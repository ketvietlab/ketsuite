import { text } from '@ketvietlab/ketjs'
import type { Route, Row, ServeContext, Translator } from '@ketvietlab/ketjs'
import type { JSXChild } from '@ketvietlab/ketjs-view'
import { HelpDrawer, MarkdownContent, Notice, Surface } from '@ketvietlab/design-system'
import { marked } from 'marked'
import { button, FormCluster, FormPage, RecordForm, shell } from '../../../ui/index.ts'
import type { FormField, Frame } from '../../../ui/index.ts'
import { readForm, seeOther } from '../../backend/forms.ts'
import { relationControl, relationLabels } from '../../backend/relation-select.ts'
import { adminPage, inLocale } from '../../backend/screen.ts'

const PATH = '/admin/stock/accounting'
const FORM = 'stock-accounting-form'
const ACCOUNT_FIELDS = [
  'valuationAccountId',
  'supplierAccountId',
  'productionAccountId',
  'cogsAccountId',
  'gainAccountId',
  'lossAccountId',
] as const
// K7: what shipping posts to; optional, as stock is valued without them.
const DELIVERY_FIELDS = [
  'deliveryFeeAccountId',
  'carrierPayableAccountId',
  'carrierCodAccountId',
  'receivableAccountId',
] as const
const FIELDS = ['journalId', ...ACCOUNT_FIELDS, ...DELIVERY_FIELDS] as const

const guides = {
  vi: `## Kế toán kho làm gì
Khi chọn **Sổ nhật ký**, mỗi phiếu nhập, xuất, trả hàng hoặc kiểm kê lệch tồn hoàn tất sẽ ghi ngay một bút toán đã ghi sổ, ngày hoàn tất. Phiếu chuyển giữa các kho không ghi sổ. Bỏ trống sổ thì Kho vẫn tính giá vốn bình quân và giá trị tồn, nhưng không ghi bút toán.

## Tài khoản
- **Hàng hoá**: tài khoản tồn kho (TT99: 156), Nợ khi nhập, Có khi xuất.
- **Hàng mua đang đi đường**: đối ứng khi nhập từ nhà cung cấp (TT99: 151). Hoá đơn mua hàng lưu kho ghi Nợ tài khoản này, nên nó về 0 dù phiếu hay hoá đơn đến trước.
- **Chi phí sản xuất dở dang**: đối ứng khi nhập từ xưởng hoặc xuất cho sản xuất (1541).
- **Giá vốn hàng bán**: đối ứng khi giao cho khách và khi khách trả hàng (632).
- **Tài sản thừa / Tài sản thiếu**: đối ứng khi kiểm kê thừa (33811) hoặc thiếu (13811).

## Tài khoản giao hàng
Không bắt buộc để định giá kho; cần khi công ty giao hàng qua đơn vị vận chuyển và thu hộ (COD).
- **Chi phí vận chuyển**: phí vận chuyển và phí thu hộ của bảng đối soát (641).
- **Phải trả hãng vận chuyển**: phí hãng tính, theo tên hãng, tới khi tất toán (331).
- **Tiền hãng giữ hộ**: tiền thu hộ khách đã trả cho hãng, chờ hãng chuyển về (1388).
- **Phải thu khách hàng**: khoản khách nợ, giảm khi khách trả tiền thu hộ (131).

## Lưu ý
Bút toán do Kho ghi không đảo hay huỷ được ở Kế toán; hàng chỉ quay lại bằng một phiếu khác. Kỳ đã khoá sổ thì phiếu không hoàn tất được. Công ty đã có phiếu hoàn tất trước khi bật ghi sổ cần ghi số dư đầu kỳ của 156 trước.`,
  en: `## What stock accounting does
With a **Journal** chosen, every completed receipt, delivery, return or count difference posts one entry straight away, dated the completion day. Transfers between warehouses post nothing. With no journal, stock still keeps average costs and stock value but posts no entries.

## Accounts
- **Goods**: the inventory account (TT99: 156), debited on receipt and credited on issue.
- **Goods in transit**: the counterpart of a supplier receipt (TT99: 151). A vendor bill for stored goods debits it, so it clears whichever document comes first.
- **Work in progress**: the counterpart of production receipts and issues to production (1541).
- **Cost of goods sold**: the counterpart of deliveries and customer returns (632).
- **Surplus / Shortage**: the counterpart of count surpluses (33811) and shortages (13811).

## Shipping accounts
Not needed to value stock; needed when the company ships through carriers and collects cash on delivery.
- **Carrying cost**: the carrying and COD fees of carrier statements (641).
- **Carrier payable**: what carriers charge, under each carrier's name, until settled (331).
- **Cash held by carriers**: what customers paid carriers on delivery, until the carrier pays it over (1388).
- **Customer receivable**: what customers owe (131), which their cash on delivery pays.

## Notes
Accounting cannot reverse or cancel an entry stock posted; goods only come back through another transfer. A locked period refuses completion. A company that completed transfers before posting began should record the opening balance of 156 first.`,
}

const help = (lang: 'vi' | 'en') => {
  const vi = lang === 'vi'
  return (
    <HelpDrawer
      id="stock-accounting-help"
      label={vi ? 'Hướng dẫn màn hình' : 'Screen help'}
      title={vi ? 'Kế toán kho' : 'Stock accounting'}
      closeLabel={vi ? 'Đóng' : 'Close'}
      body={
        <MarkdownContent
          source={guides[lang]}
          lexer={marked.lexer}
          headingOffset={1}
          labels={{
            diagram: vi ? 'Sơ đồ' : 'Diagram',
            table: vi ? 'Bảng' : 'Table',
            source: vi ? 'Nguồn' : 'Source',
            loading: vi ? 'Đang tải' : 'Loading',
            error: vi ? 'Không tải được' : 'Failed to load',
          }}
        />
      }
    />
  )
}

type Req = Parameters<Route>[1]

async function render(
  ctx: ServeContext,
  url: URL,
  req: Req,
  state: { values: Row; errors?: Record<string, string> },
  action: string,
) {
  const lang: 'vi' | 'en' = ctx.localeOf(url, req) === 'en' ? 'en' : 'vi'
  const _ = ctx.translate(lang)
  const setting = (await ctx.call('stock.getAccountingSetting', {}, url, req)) as Row
  const editable = await ctx.allows('stock.saveAccountingSetting', url, req)
  const read = async (fn: string, input: Row) =>
    setting.accounting && (await ctx.allows(fn, url, req))
      ? ((await ctx.call(fn, input, url, req)) as Row[])
      : []
  const accounts = (await read('account.listAccounts', {})).filter((row) => row.active !== false)
  const journals = (await read('account.listJournals', { type: 'general' })).filter(
    (row) => row.active !== false && row.type === 'general',
  )
  // RecordForm names each field after the form action; the picker's trigger and error link must match it.
  const fieldId = (name: string) => `field-${action}-${name}`.replace(/[^a-zA-Z0-9_-]/g, '-')
  const picker = (
    name: (typeof FIELDS)[number],
    rows: Row[],
    label: (row: Row) => string,
  ): Promise<JSXChild> =>
    relationControl(ctx, url, req, `stock-accounting-${name}`, {
      name,
      ariaLabel: _(`stock_backend.accounting.${name}`),
      triggerId: fieldId(name),
      invalid: Boolean(state.errors?.[name]),
      describedBy: state.errors?.[name] ? `${fieldId(name)}-error` : null,
      value: state.values[name] == null ? '' : String(state.values[name]),
      disabled: !editable,
      options: [
        { value: '', label: '—' },
        ...rows.map((row) => ({ value: String(row.id), label: label(row) })),
      ],
      labels: relationLabels(_, _(`stock_backend.accounting.${name}`)),
    })
  const fields: FormField[] = []
  for (const name of FIELDS)
    fields.push({
      name,
      label: _(`stock_backend.accounting.${name}`),
      help: name === 'journalId' ? _('stock_backend.accounting.journalHelp') : null,
      error: state.errors?.[name] ?? null,
      control:
        name === 'journalId'
          ? await picker(name, journals, (row) => `${row.code} · ${row.name}`)
          : await picker(name, accounts, (row) => `${row.code} · ${row.name}`),
    })
  return { lang, editable, setting, fields }
}

const screen = (
  _: Translator,
  frame: Frame,
  lang: 'vi' | 'en',
  view: { editable: boolean; accounting: boolean; fields: FormField[]; saved?: boolean; errors?: string[] },
  action: string,
) =>
  shell(
    _,
    _('stock_backend.accounting.title'),
    <>
      <FormPage
        variant="operational"
        frame={frame}
        scope="stock-accounting"
        title={_('stock_backend.accounting.title')}
        actions={
          view.editable && view.accounting ? (
            <FormCluster
              label={_('stock_backend.accounting.title')}
              forms={[
                button({
                  label: _('stock_backend.action.save'),
                  type: 'submit',
                  form: FORM,
                  variant: 'primary',
                }),
              ]}
            />
          ) : undefined
        }
        body={
          view.accounting ? (
            <Surface
              title={_('stock_backend.accounting.posting')}
              body={
                <>
                  {view.saved ? (
                    <Notice tone="positive" title={_('stock_backend.accounting.saved')} message="" />
                  ) : null}
                  <RecordForm
                    id={FORM}
                    scope="stock-accounting"
                    action={action}
                    submit={_('stock_backend.action.save')}
                    submitVariant="primary"
                    submitPlacement="external"
                    errors={view.errors}
                    fields={view.fields}
                  />
                </>
              }
            />
          ) : (
            <Surface
              body={
                <Notice
                  tone="info"
                  title={_('stock_backend.accounting.unavailable')}
                  message={_('stock_backend.accounting.unavailableHint')}
                />
              }
            />
          )
        }
      />
      {help(lang)}
    </>,
    {
      ...frame,
      topbar: false,
      titled: false,
      ...(frame.applications
        ? { applications: { ...frame.applications, helpLabel: _('stock_backend.accounting.help') } }
        : {}),
    },
  )

export const accountingRoute =
  (ctx: ServeContext): Route =>
  async (url, req) => {
    if (!['GET', 'POST'].includes(req.method ?? 'GET')) return text('GET or POST', { status: 405 })
    if (!(await ctx.allows('stock.getAccountingSetting', url, req))) return text('Forbidden', { status: 403 })
    let values: Row = (await ctx.call('stock.getAccountingSetting', {}, url, req)) as Row
    let errors: Record<string, string> | undefined
    let refusal: string[] | undefined
    if (req.method === 'POST') {
      if (
        req.headers['sec-fetch-site'] === 'cross-site' ||
        !(await ctx.allows('stock.saveAccountingSetting', url, req))
      )
        return text('Forbidden', { status: 403 })
      const form = await readForm(req)
      const input = Object.fromEntries(FIELDS.map((field) => [field, form[field] || null]))
      const result = (await ctx.call('stock.saveAccountingSetting', input, url, req)) as Row
      if (result.ok) return seeOther(inLocale(url, `${PATH}?saved=1`))
      const _ = ctx.translate(ctx.localeOf(url, req))
      values = { ...values, ...input }
      errors = {}
      refusal = []
      for (const issue of (result.errors ?? []) as Row[]) {
        const message = issue.messageKey ? _(String(issue.messageKey)) : String(issue.message ?? '')
        if (issue.field) errors[String(issue.field)] = message
        else refusal.push(message)
      }
    }
    const saved = req.method === 'GET' && url.searchParams.get('saved') === '1'
    return adminPage(ctx, url, req, {
      title: 'stock_backend.accounting.title',
      ...(errors ? { status: 422 } : {}),
      body: async (_, frame) => {
        const action = inLocale(url, PATH)
        const view = await render(ctx, url, req, { values, errors }, action)
        return screen(
          _,
          frame,
          view.lang,
          {
            editable: view.editable,
            accounting: Boolean(view.setting.accounting),
            fields: view.fields,
            saved,
            errors: refusal,
          },
          action,
        )
      },
    })
  }
