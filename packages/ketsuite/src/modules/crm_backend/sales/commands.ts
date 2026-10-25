// The writes of the CRM sales screens. Every form of the `crm.sales-screen` island posts here; a command calls the
// CRM functions as the signed-in user, so their grants and record access decide what lands. The hidden `viewer` and
// `role` a form carries are the demo's and are never read. The reply names the address the screen returns to and,
// when a write is refused, the user's draft with the fields to fix.
import { createHash } from 'node:crypto'
import type { IncomingMessage } from 'node:http'
import type { Row, ServeContext } from '@ketvietlab/ketjs'
import { IMPORT_FIELDS, type ImportRow, ImportRefused, importIssues, parseSalesImport } from './import.ts'
import { adminSalesRoutes } from './routes.mjs'
import { DEFAULT_ZONE, SALES_INTAKE_SOURCES } from './state.ts'

type Input = Record<string, string>
type Words = readonly [vi: string, en: string]
/** What a command did: the record to open next (none stays on the screen), what to say and, for many, each row's fate. */
type Done = { id?: string | null; message: Words; bulk?: Row[]; params?: Record<string, string> }

/** A write the user can correct: the reply keeps their draft and marks the fields. */
class Refused extends Error {
  readonly code: string
  readonly fields: Record<string, string>
  constructor(code: string, message: string, fields: Record<string, string> = {}) {
    super(message)
    this.code = code
    this.fields = fields
  }
}

const words = {
  saved: ['Đã cập nhật', 'Updated'],
  created: ['Đã tạo hồ sơ', 'Record created'],
  processed: ['Sự kiện đã xử lý; không tạo trùng', 'Event already processed; no duplicate created'],
  moved: ['Đã chuyển giai đoạn', 'Stage changed'],
  assigned: ['Đã phân công', 'Assigned'],
  won: ['Đã chốt thành công', 'Marked won'],
  lost: ['Đã đánh dấu thất bại', 'Marked lost'],
  reopened: ['Đã mở lại hồ sơ', 'Record reopened'],
  converted: ['Đã chuyển thành cơ hội', 'Converted to an opportunity'],
  noted: ['Đã ghi chú nội bộ', 'Internal note added'],
  scheduled: ['Đã lên lịch công việc', 'Activity scheduled'],
  logged: ['Đã ghi tương tác', 'Interaction logged'],
  planned: ['Đã áp dụng kế hoạch', 'Plan applied'],
  completed: ['Đã hoàn tất công việc', 'Activity completed'],
  cancelled: ['Đã hủy công việc', 'Activity cancelled'],
  rescheduled: ['Đã dời lịch công việc', 'Activity rescheduled'],
  followUp: ['Liên hệ lại', 'Follow up'],
  activityClosed: ['Công việc không còn mở.', 'The activity is no longer open.'],
  activityOwner: [
    'Chỉ người phụ trách công việc hoặc quản lý mới đổi được công việc này.',
    "Only the activity's owner or a manager may change it.",
  ],
  forbidden: ['Bạn không có quyền thực hiện thao tác này.', 'You may not do this.'],
  check: ['Kiểm tra các trường được đánh dấu.', 'Check the marked fields.'],
  conflict: [
    'Hồ sơ vừa được thay đổi ở nơi khác. Đối chiếu phiên bản mới rồi lưu lại.',
    'The record changed elsewhere. Review the latest version, then save again.',
  ],
  retry: ['Máy chủ tạm thời chưa ghi được.', 'The server could not save it for now.'],
  unknown: ['Thao tác không hợp lệ.', 'Unknown action.'],
  demoOnly: ['Thao tác này chỉ có trong bản demo.', 'This action exists only in the demo.'],
  required: ['Trường này là bắt buộc.', 'This field is required.'],
  number: ['Nhập một số.', 'Enter a number.'],
  date: ['Nhập ngày hợp lệ.', 'Enter a valid date.'],
  invalid: ['Giá trị không hợp lệ.', 'This value is not valid.'],
  closed: [
    'Hồ sơ đã đóng; mở lại trước khi cập nhật.',
    'The record is closed; reopen it before changing it.',
  ],
  open: ['Hồ sơ đang mở; không cần mở lại.', 'The record is open; there is nothing to reopen.'],
  noOpenStage: [
    'Chưa có giai đoạn mở phù hợp. Cấu hình giai đoạn trước.',
    'No open stage fits this record. Configure the stages first.',
  ],
  intakeSource: ['Chọn nguồn đã tích hợp.', 'Choose an integrated source.'],
  outcome: ['Chọn kết quả.', 'Choose an outcome.'],
  range: ['Giá trị nằm ngoài khoảng cho phép.', 'The value is out of range.'],
  configSaved: ['Đã lưu cấu hình', 'Configuration saved'],
  configConflict: [
    'Cấu hình đã đổi; đọc lại trước khi lưu.',
    'The configuration changed; reload it before saving.',
  ],
  memberSaved: ['Đã lưu thành viên', 'Member saved'],
  refreshed: ['Đã cập nhật số liệu từ dữ liệu hiện tại', 'Figures updated from the current data'],
  bulkSize: ['Chọn từ 1 đến 100 hồ sơ.', 'Choose 1 to 100 records.'],
  listChanged: [
    'Danh sách đã đổi. Xem lại các dòng trước khi phân công.',
    'The list changed. Review the rows before assigning.',
  ],
  notOpen: ['Không còn mở trong phạm vi quyền', 'No longer open within your access'],
  quoteCreated: ['Đã tạo báo giá nháp', 'Draft quote created'],
  quoteSaved: ['Đã lưu phiên bản báo giá mới', 'New quote version saved'],
  quoteSent: ['Đã gửi báo giá', 'Quote sent'],
  quoteAccepted: ['Khách đã chấp nhận báo giá; đã tạo đơn', 'Quote accepted; order created'],
  quoteMissing: ['Không tìm thấy báo giá.', 'Quote not found.'],
  quoteChanged: ['Báo giá đã đổi. Đọc lại trước khi lưu.', 'The quote changed. Reload it first.'],
  quoteOpportunity: ['Chỉ tạo báo giá cho cơ hội.', 'Only an opportunity can be quoted.'],
  quoteExpired: [
    'Báo giá đã hết hạn. Sửa hạn và gửi lại.',
    'The quote has expired. Change its date and send it again.',
  ],
  quoteOrdered: [
    'Báo giá đã thành đơn; tạo phương án mới.',
    'The quote is already an order; write a new one.',
  ],
  quoteUnsent: ['Gửi báo giá trước khi khách nhận.', 'Send the quote before the customer accepts it.'],
  quoteLines: ['Cần 1–20 dòng sản phẩm.', 'Enter 1 to 20 product lines.'],
  quoteProduct: ['Sản phẩm không còn bán.', 'This product is not for sale.'],
  quoteTax: ['Chưa có thuế bán với mức này.', 'No sales tax has this rate.'],
  noWarehouse: ['Chưa có kho để lập báo giá.', 'There is no warehouse to quote from.'],
  merged: ['Đã gộp hồ sơ', 'Records merged'],
  mergeState: [
    'Chỉ gộp hai hồ sơ mở cùng loại, khách và nhu cầu. Hồ sơ cũ đã đóng cần giữ riêng.',
    'Merge only two open records of the same kind, customer and need. Keep a closed one separate.',
  ],
  sameNeed: ['Xác nhận cùng nhu cầu bán hàng.', 'Confirm it is the same sales need.'],
  sameNeedField: ['Không gộp chỉ vì chung điện thoại.', 'Do not merge only because the phone matches.'],
  emailQueued: ['Đã xếp email vào hàng gửi', 'Email queued to send'],
  quoteEmailed: ['Đã gửi báo giá qua email', 'Quote emailed'],
  quoteHanded: ['Đã ghi nhận trao báo giá tận tay', 'Recorded the quote as handed over'],
  quoteAttached: ['Đã gắn báo giá vào cơ hội', 'Quote attached to the opportunity'],
  quoteNoConsent: [
    'Khách chưa đồng ý liên hệ; chỉ ghi nhận trao tận tay được.',
    'The customer has not agreed to be contacted; only a handover can be recorded.',
  ],
  emailRetried: ['Đã gửi lại email', 'Email queued again'],
  noConsent: [
    'Khách chưa đồng ý liên hệ; không gửi email.',
    'The customer has not agreed to be contacted; no email sent.',
  ],
  recordConsent: ['Ghi nhận đồng ý trước.', 'Record consent first.'],
  noEmail: ['Khách chưa có email.', 'The customer has no email.'],
  addEmail: ['Bổ sung email liên hệ.', 'Add a contact email.'],
  previewed: ['Đã xem trước; chưa nhập dữ liệu', 'Previewed; nothing imported yet'],
  previewFirst: ['Xem trước dữ liệu hợp lệ trước khi nhập.', 'Preview valid data before importing.'],
  importChanged: [
    'Dữ liệu đã đổi. Xem trước lại để đối chiếu khách trùng.',
    'The data changed. Preview again to check for matching customers.',
  ],
  skipEvent: ['Bỏ qua: sự kiện đã có', 'Skipped: the event is already in'],
  useCustomer: ['Dùng khách có sẵn · giữ nhu cầu riêng', 'Uses the existing customer · keeps its own need'],
  newCustomer: ['Tạo khách và lead', 'Creates a customer and a lead'],
} as const satisfies Record<string, Words>

/** A function's input, as the form names it. */
const FIELDS: Record<string, string> = {
  utmSource: 'source',
  closeReason: 'note',
  lostReasonCode: 'lostReasonId',
  lostReason: 'lostReasonId',
  body: 'message',
}
/** The kind of activity a form names, as the activity module files it. */
const CATEGORIES: Record<string, string> = { call: 'call', email: 'email', meeting: 'meeting', task: 'todo' }
/** The function that saves each list of the settings screen. */
const CONFIGURATION: Record<string, string> = {
  stages: 'crm.stage.save',
  tags: 'crm.tag.save',
  lostReasons: 'crm.lostReason.save',
  scoreRules: 'crm.scoreRule.save',
  assignmentRules: 'crm.assignmentRule.save',
  teams: 'crm.team.save',
}
/** The record kinds a stage or rule takes, as the form's single choice names them. */
const KINDS: Record<string, string[]> = {
  lead: ['lead'],
  opportunity: ['opportunity'],
  both: ['lead', 'opportunity'],
}
/** Refusals about the state of what the form changes rather than its fields. */
const STATE_ERRORS = new Set([
  'crm.error.activityClosed',
  'crm.error.stageInUse',
  'crm_backend.error.noSender',
  'crm_backend.error.emailNotFailed',
  'sale.error.quotationEmpty',
  'sale.error.quotationExpired',
  'crm_sale.error.attachOff',
  'crm_sale.error.attachTaken',
])
/** Refusals because the customer has not agreed to be contacted. */
const CONSENT_ERRORS = new Set(['sale.error.consentRequired', 'crm_backend.error.consentRequired'])
/** Commands a closed record still takes. */
const ON_CLOSED = new Set(['reopen', 'note', 'activity-complete', 'activity-cancel', 'reschedule'])
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
/** A stable id for a value: a retried request names the same row. */
const idOf = (value: string) => {
  const hex = createHash('sha256').update(value).digest('hex')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`
}
const text = (input: Input, key: string) => String(input[key] ?? '').trim()
const checked = (value: unknown) => ['on', 'true', '1', 'yes'].includes(String(value ?? ''))
const version = (input: Input) => Number(input.version) || 0
const optional = (key: string, value: string) => (value ? { [key]: value } : {})
const digits = (value: unknown) => String(value ?? '').replace(/\D/g, '')
/** The day of a form's date or date-time value; an activity is due on a day. */
const dayOf = (value: string) => (/^\d{4}-\d{2}-\d{2}/.test(value) ? value.slice(0, 10) : '')
const listed = (value: unknown) =>
  String(value ?? '')
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean)

/**
 * A command form's fields. A native form posts a checkbox group as repeated `name[]` fields; a command reads
 * one comma list, as the island's drafts do.
 */
export const salesCommandInput = (body: string): Input => {
  const input: Input = {}
  for (const [key, value] of new URLSearchParams(body)) {
    if (!key.endsWith('[]')) input[key] = value
    else {
      const name = key.slice(0, -2)
      input[name] = input[name] ? `${input[name]},${value}` : value
    }
  }
  return input
}

export type SalesCommandReply = {
  location: string
  response?: { input: Input; message: string; fields: Record<string, string>; code: string }
  notice?: { message: string; bulk: Row[] }
}

/** Runs one command as the user and says where the screen goes next. */
export async function runSalesCommand(
  ctx: ServeContext,
  url: URL,
  req: IncomingMessage,
  input: Input,
): Promise<SalesCommandReply> {
  const lang = input.lang === 'en' ? 'en' : 'vi'
  const say = (pair: Words) => pair[lang === 'en' ? 1 : 0]
  const _ = ctx.translate(lang)
  const context = new URLSearchParams(input.context ?? '')
  for (const name of ['viewer', 'role', 'writeScenario']) context.delete(name)
  if (lang === 'en') context.set('lang', 'en')
  const key = text(input, 'requestId')
  const command = text(input, 'command')

  /**
   * Calls a function as the user; a refusal it returns becomes the form's field errors. An internal function is
   * called unchecked, once the command has checked the permission that stands for it.
   */
  const call = async (
    fn: string,
    args: Record<string, unknown>,
    { unchecked = false } = {},
  ): Promise<Row> => {
    let result: Row
    try {
      result = (await (unchecked
        ? ctx.callUnchecked(fn, args, url, req)
        : ctx.call(fn, args, url, req))) as Row
    } catch (error) {
      const failure = error as { code?: string; issues?: Row[] }
      if (failure.code === 'E_FN_NOT_PERMITTED') throw new Refused('E_FORBIDDEN', say(words.forbidden))
      if (failure.code === 'E_ACTIVITY_CLOSED' || failure.code === 'E_ACTIVITY_NOT_FOUND')
        throw new Refused('E_STATE', say(words.activityClosed))
      if (failure.code === 'E_ACTIVITY_AUTHORITY') throw new Refused('E_FORBIDDEN', say(words.activityOwner))
      if (failure.code === 'E_ACTIVITY_ASSIGNEE')
        throw new Refused('E_VALIDATION', say(words.check), { assigneeUserId: say(words.invalid) })
      if (failure.code === 'E_ACTIVITY_SUMMARY')
        throw new Refused('E_VALIDATION', say(words.check), { summary: say(words.invalid) })
      if (failure.code === 'E_INVALID_INPUT' && Array.isArray(failure.issues))
        throw new Refused(
          'E_VALIDATION',
          say(words.check),
          Object.fromEntries(
            failure.issues.map((issue) => [
              FIELDS[String(issue.field)] ?? String(issue.field),
              say(
                issue.code === 'decimal' || issue.code === 'integer'
                  ? words.number
                  : issue.code === 'date'
                    ? words.date
                    : issue.code === 'required'
                      ? words.required
                      : words.invalid,
              ),
            ]),
          ),
        )
      throw error
    }
    if (result && result.ok === false) {
      const errors = (Array.isArray(result.errors) ? result.errors : []) as Row[]
      // The sale module refuses in words of its own, without a code: its stale order is a conflict like ours.
      const conflict = errors.some(
        (error) =>
          error.code === 'crm.error.stageConflict' ||
          error.code === 'crm_sale.error.policyChanged' ||
          error.field === 'expectedRevision',
      )
      // The customer not agreeing to be contacted is its own refusal, whichever module found it.
      const consent = errors.some((error) => CONSENT_ERRORS.has(String(error.code)))
      const said = (error: Row) => (error.code ? _(String(error.code)) : say(words.invalid))
      const fields = Object.fromEntries(
        errors.map((error) => [FIELDS[String(error.field)] ?? String(error.field), said(error)]),
      )
      // What the record or the stage holds now, not what the form says, is what stands in the way.
      const closed = errors.some((error) => STATE_ERRORS.has(String(error.code)))
      throw new Refused(
        conflict ? 'E_CONFLICT' : consent ? 'E_CONSENT' : closed ? 'E_STATE' : 'E_VALIDATION',
        conflict
          ? say(words.conflict)
          : errors.length === 1 && errors[0]
            ? said(errors[0])
            : say(words.check),
        fields,
      )
    }
    return result ?? {}
  }
  const need = (field: string) => {
    const value = text(input, field)
    if (!value) throw new Refused('E_VALIDATION', say(words.required), { [field]: say(words.required) })
    return value
  }
  const needDay = (field: string) => {
    const day = dayOf(need(field))
    if (!day) throw new Refused('E_VALIDATION', say(words.date), { [field]: say(words.date) })
    return day
  }
  /** A whole number the form may leave empty; out of its range it is refused on the field. */
  const whole = (field: string, min: number, max: number): number | null => {
    const value = text(input, field)
    if (!value) return null
    const number = Number(value)
    if (!Number.isInteger(number))
      throw new Refused('E_VALIDATION', say(words.check), { [field]: say(words.number) })
    if (number < min || number > max)
      throw new Refused('E_VALIDATION', say(words.check), { [field]: say(words.range) })
    return number
  }
  const today = () => new Date().toLocaleDateString('en-CA', { timeZone: DEFAULT_ZONE })
  /** The record the command acts on, as the user reads it; a closed one only takes what reopens or notes it. */
  const record = async (): Promise<Row> => {
    const row = (await call('crm.case.get', { id: need('id') })) as Row | null
    if (!row?.id) throw new Refused('E_NOT_FOUND', _('crm.error.notFound'))
    if (row.terminalState !== 'open' && !ON_CLOSED.has(command))
      throw new Refused('E_STATE', say(words.closed))
    return row
  }

  /**
   * The customer a new record belongs to: the one picked; else the one whose phone or email matches, among the
   * customers the user may read; else a new customer, when the user may add one. "A new customer" skips the match.
   */
  const partnerFor = async (name: string): Promise<{ partnerId?: string }> => {
    const picked = text(input, 'partnerId')
    if (picked && picked !== 'new') return { partnerId: picked }
    const match = picked ? '' : await matchPartner(input.phone, input.email)
    if (match) return { partnerId: match }
    return newPartner(idOf(`partner\n${key}`), {
      name: text(input, 'contactName') || name,
      phone: text(input, 'phone'),
      email: text(input, 'email'),
      consent: checked(input.consent),
    })
  }
  /** The customer, among those the user may read, whose phone (its last nine digits) or email matches. */
  const matchPartner = async (phoneValue: unknown, emailValue: unknown): Promise<string> => {
    const phone = digits(phoneValue)
    const email = String(emailValue ?? '')
      .trim()
      .toLowerCase()
    if (phone.length < 6 && !email.includes('@')) return ''
    const found = (await ctx
      .call('partner.listPartners', { search: phone.length >= 6 ? phone : email, limit: 20 }, url, req)
      .catch(() => [])) as Row[]
    const match = (Array.isArray(found) ? found : []).find(
      (partner) =>
        (phone.length >= 6 && digits(partner.phone).endsWith(phone.slice(-9))) ||
        (email.includes('@') && String(partner.email ?? '').toLowerCase() === email),
    )
    return match?.id ? String(match.id) : ''
  }
  /** A new customer, when the user may add one. */
  const newPartner = async (
    id: string,
    person: { name: string; phone: string; email: string; consent: boolean },
  ): Promise<{ partnerId?: string }> => {
    const created = (await ctx
      .call(
        'partner.savePartner',
        {
          id,
          kind: 'person',
          name: person.name,
          phone: person.phone || null,
          email: person.email || null,
          contactConsent: person.consent,
        },
        url,
        req,
      )
      .catch(() => null)) as Row | null
    return created?.ok && created.id ? { partnerId: String(created.id) } : {}
  }
  /** Who manages the pipeline: they shape its stages or its teams. */
  const manages = async () =>
    (await ctx.allows('crm.stage.save', url, req)) || (await ctx.allows('crm.team.save', url, req))
  /**
   * What each imported row would do: its own faults, whether its source event is already in (or repeats in the
   * file), and the customer it would join.
   */
  const diagnose = async (rows: ImportRow[]): Promise<Row[]> => {
    const events = new Set<string>()
    const diagnostics: Row[] = []
    for (const [index, row] of rows.entries()) {
      const issues = importIssues(row, (vi, en) => (lang === 'en' ? en : vi))
      const event = row.externalId ? `${row.source}\n${row.externalId}` : ''
      const repeated =
        Boolean(event) &&
        (events.has(event) ||
          Boolean(
            (
              (await call('crm.case.get', { id: idOf(`intake\n${event}`) }).catch((error) => {
                if (error instanceof Refused) return null
                throw error
              })) as Row | null
            )?.id,
          ))
      if (event) events.add(event)
      const partnerId = repeated ? '' : await matchPartner(row.phone, row.email)
      diagnostics.push({
        id: String(index + 1),
        name: row.name,
        phone: row.phone,
        email: row.email,
        valid: !issues.length,
        issues,
        action: say(repeated ? words.skipEvent : partnerId ? words.useCustomer : words.newCustomer),
        partnerId,
        duplicate: repeated,
      })
    }
    return diagnostics
  }

  /** A new record, typed in or taken in from an integrated source under that source's event id. */
  const create = async (intake: boolean): Promise<Done> => {
    const kind = input.kind === 'opportunity' ? 'opportunity' : 'lead'
    const source = text(input, 'source') || text(input, 'utmSource')
    const external = text(input, 'externalId')
    if (intake && !(SALES_INTAKE_SOURCES as readonly string[]).includes(source))
      throw new Refused('E_VALIDATION', say(words.intakeSource), { source: say(words.intakeSource) })
    if (intake && !external)
      throw new Refused('E_VALIDATION', say(words.required), { externalId: say(words.required) })
    // An event id names one record: taking it in twice finds the first.
    const id = intake ? idOf(`intake\n${source}\n${external}`) : UUID.test(key) ? key : idOf(`case\n${key}`)
    if (intake) {
      const known = (await call('crm.case.get', { id }).catch(() => null)) as Row | null
      if (known?.id) return { id, message: words.processed }
    }
    const name = need('name')
    const assignee = text(input, 'assigneeUserId')
    const opportunity = kind === 'opportunity'
    let result: Row
    try {
      result = await call('crm.case.save', {
        id,
        kind,
        name,
        ...(await partnerFor(name)),
        contactName: text(input, 'contactName') || null,
        phone: text(input, 'phone') || null,
        email: text(input, 'email') || null,
        description: text(input, 'description') || null,
        ...optional('teamId', text(input, 'teamId')),
        ...optional('assigneeUserId', assignee),
        ...optional('stageId', text(input, 'stageId')),
        priority: priority(input.priority, '0'),
        utmSource: source || null,
        utmMedium: text(input, 'utmMedium') || null,
        utmCampaign: text(input, 'utmCampaign') || null,
        expectedRevenue: opportunity ? text(input, 'expectedRevenue') || '0' : '0',
        probability: opportunity ? text(input, 'probability') || '0' : '0',
        ...(opportunity ? optional('expectedClosing', text(input, 'expectedClosing')) : {}),
        tagIds: listed(input.tagIds),
        contactConsent: checked(input.consent),
        idempotencyKey: key,
      })
    } catch (error) {
      // The event's record exists but this user may not see it: it was still taken in once.
      if (intake && error instanceof Refused && error.fields.id) return { id: null, message: words.processed }
      throw error
    }
    // Nobody named: the team's rules pick the owner, as they do for any new record.
    if (!assignee)
      await call('crm.case.assign', {
        id,
        ...optional('teamId', text(input, 'teamId')),
        idempotencyKey: `${key}:assign`,
      }).catch((error) => {
        if (!(error instanceof Refused)) throw error
      })
    return { id: String(result.id ?? id), message: words.created }
  }

  /** The quotation a form names, by the number the screen shows, among the record's own. */
  const quotation = async (caseId: unknown): Promise<Row> => {
    const asked = need('quoteId')
    const rows = (await call('crm_sale.sale.listQuotations', { caseId })) as unknown as Row[]
    const found = (Array.isArray(rows) ? rows : []).find(
      (row) => String(row.name ?? '') === asked || String(row.id) === asked,
    )
    if (!found) throw new Refused('E_NOT_FOUND', say(words.quoteMissing))
    // The quotation belongs to a record the user reads; its order is read for its revision, state and validity.
    const order = (await call('sale.getOrder', { id: found.id }, { unchecked: true })) as Row | null
    if (!order?.id) throw new Refused('E_NOT_FOUND', say(words.quoteMissing))
    return order
  }
  /** The order's revision the form read; a quotation written since is a conflict. */
  const fresh = (order: Row) => {
    if (Number(order.revision ?? 0) !== Number(input.quoteVersion))
      throw new Refused('E_CONFLICT', say(words.quoteChanged))
  }
  /**
   * The form's product lines as the sale module takes them: each product's unit, and the sales tax at the rate the
   * line names (none at 0%). Only someone who may write a quotation gets this far, so the units, taxes and warehouse
   * it looks up are read for them.
   */
  const quoteProducts = async (): Promise<Row[]> => {
    if (!(await ctx.allows('crm_sale.sale.createQuotation', url, req)))
      throw new Refused('E_FORBIDDEN', say(words.forbidden))
    const indexes = Object.keys(input)
      .filter((name) => /^product-\d+$/.test(name))
      .map((name) => Number(name.split('-')[1]))
      .sort((a, b) => a - b)
    if (!indexes.length || indexes.length > 20)
      throw new Refused('E_VALIDATION', say(words.quoteLines), { lines: say(words.quoteLines) })
    const amount = (field: string, min: number, max: number, fallback?: number) => {
      const value = text(input, field)
      const number = value === '' && fallback != null ? fallback : Number(value)
      if (value === '' && fallback == null)
        throw new Refused('E_VALIDATION', say(words.check), { [field]: say(words.required) })
      if (!Number.isFinite(number) || number < min || number > max)
        throw new Refused('E_VALIDATION', say(words.check), {
          [field]: say(words.range),
          lines: say(words.check),
        })
      return number
    }
    const lines = indexes.map((i) => ({
      i,
      product: need(`product-${i}`),
      quantity: amount(`quantity-${i}`, 1, 10000),
      price: amount(`price-${i}`, 0, 1e12),
      discount: amount(`discount-${i}`, 0, 100, 0),
      tax: amount(`tax-${i}`, 0, 100, 0),
    }))
    const products = (await call(
      'crm_sale.sale.listQuotableProducts',
      { limit: 200 },
      { unchecked: true },
    )) as unknown as Row[]
    const unitOf = new Map(
      (Array.isArray(products) ? products : []).map((row) => [String(row.id), row.uomId]),
    )
    const rates = lines.some((line) => line.tax > 0)
      ? ((await call('account.listTaxes', { typeTaxUse: 'sale' }, { unchecked: true })) as unknown as Row[])
      : []
    return lines.map((line) => {
      const unit = unitOf.get(line.product)
      if (!unit)
        throw new Refused('E_VALIDATION', say(words.check), {
          [`product-${line.i}`]: say(words.quoteProduct),
        })
      const tax = line.tax
        ? (Array.isArray(rates) ? rates : []).find(
            (rate) =>
              rate.active !== false &&
              String(rate.amountType ?? 'percent') === 'percent' &&
              rate.priceInclude !== true &&
              Number(rate.amount) === line.tax,
          )
        : null
      if (line.tax && !tax)
        throw new Refused('E_VALIDATION', say(words.check), { [`tax-${line.i}`]: say(words.quoteTax) })
      return {
        productId: line.product,
        productUomId: String(unit),
        quantity: String(line.quantity),
        priceUnit: String(line.price),
        discount: String(line.discount),
        ...(tax ? { taxId: String(tax.id) } : {}),
      }
    })
  }

  const commands: Record<string, () => Promise<Done>> = {
    create: () => create(false),
    intake: () => create(true),
    save: async () => {
      const row = await record()
      await call('crm.case.save', {
        ...caseFields(row),
        name: need('name'),
        contactName: text(input, 'contactName') || null,
        phone: text(input, 'phone') || null,
        email: text(input, 'email') || null,
        description: text(input, 'description') || null,
        priority: priority(input.priority, '0'),
        tagIds: listed(input.tagIds),
        contactConsent: checked(input.consent),
        expectedVersion: version(input),
        idempotencyKey: key,
      })
      return { id: String(row.id), message: words.saved }
    },
    'forecast-save': async () => {
      const row = await record()
      await call('crm.case.save', {
        ...caseFields(row),
        expectedRevenue: text(input, 'expectedRevenue') || '0',
        probability: text(input, 'probability') || '0',
        expectedClosing: text(input, 'expectedClosing') || null,
        expectedVersion: version(input),
        idempotencyKey: key,
      })
      return { id: String(row.id), message: words.saved }
    },
    move: async () => {
      const row = await record()
      await call('crm.case.move', {
        id: row.id,
        stageId: need('stageId'),
        expectedVersion: version(input),
        idempotencyKey: key,
      })
      return { id: String(row.id), message: words.moved }
    },
    assign: async () => {
      const row = await record()
      const teamId = need('teamId')
      const assignee = text(input, 'assigneeUserId')
      const args = {
        id: row.id,
        teamId,
        ...optional('assigneeUserId', assignee),
        expectedVersion: version(input),
        idempotencyKey: key,
      }
      // Someone already holds the record: handing it on is a reassignment, which keeps why on the record.
      if (row.assigneeUserId && (assignee !== String(row.assigneeUserId) || teamId !== String(row.teamId)))
        await call('crm.case.reassign', { ...args, reasonCode: 'workload_balance' })
      else await call('crm.case.assign', args)
      return { id: String(row.id), message: words.assigned }
    },
    close: async () => {
      const row = await record()
      const outcome = text(input, 'terminalState')
      const note = optional('closeReason', text(input, 'note'))
      if (outcome === 'won') {
        await call('crm.case.markWon', {
          id: row.id,
          expectedVersion: version(input),
          ...note,
          idempotencyKey: key,
        })
        return { id: String(row.id), message: words.won }
      }
      if (outcome !== 'lost')
        throw new Refused('E_VALIDATION', say(words.outcome), { terminalState: say(words.outcome) })
      await call('crm.case.markLost', {
        id: row.id,
        expectedVersion: version(input),
        lostReasonId: need('lostReasonId'),
        ...note,
        idempotencyKey: key,
      })
      return { id: String(row.id), message: words.lost }
    },
    reopen: async () => {
      const row = await record()
      if (row.terminalState === 'open') throw new Refused('E_STATE', say(words.open))
      const reason = need('reason')
      // The record's own stage choices are its kind's, first stage first.
      const stage = ((row.stageOptions ?? []) as Row[]).find((option) => option.terminalState === 'open')
      if (!stage) throw new Refused('E_VALIDATION', say(words.noOpenStage))
      await call('crm.case.move', {
        id: row.id,
        stageId: stage.id,
        expectedVersion: version(input),
        idempotencyKey: key,
      })
      // Why it reopened stays on the record, beside the stage change.
      await call('crm.case.addMessage', {
        id: idOf(`reopen\n${key}`),
        caseId: row.id,
        body: `${say(['Mở lại', 'Reopened'])}: ${reason}`,
        visibility: 'internal',
        idempotencyKey: `${key}:note`,
      })
      return { id: String(row.id), message: words.reopened }
    },
    convert: async () => {
      const row = await record()
      await call('crm.case.convertLead', {
        id: row.id,
        expectedVersion: version(input),
        ...optional('stageId', text(input, 'stageId')),
        expectedRevenue: text(input, 'expectedRevenue') || '0',
        ...optional('probability', text(input, 'probability')),
        ...optional('expectedClosing', text(input, 'expectedClosing')),
        idempotencyKey: key,
      })
      return { id: String(row.id), message: words.converted }
    },
    activity: async () => {
      const row = await record()
      await call('crm.activity.schedule', {
        id: idOf(`activity\n${key}`),
        caseId: row.id,
        category: CATEGORIES[text(input, 'activityType')] ?? 'call',
        ...optional('assigneeUserId', text(input, 'assigneeUserId')),
        summary: need('summary'),
        dueDate: needDay('due'),
        idempotencyKey: key,
      })
      return { id: String(row.id), message: words.scheduled }
    },
    interaction: async () => {
      const row = await record()
      const summary = need('summary')
      const next = text(input, 'nextAt')
      const nextDay = next ? dayOf(next) : ''
      if (next && !nextDay) throw new Refused('E_VALIDATION', say(words.date), { nextAt: say(words.date) })
      await call('crm.case.logInteraction', {
        id: row.id,
        expectedVersion: version(input),
        channel: ['phone', 'email', 'chat'].includes(text(input, 'channel'))
          ? text(input, 'channel')
          : 'phone',
        outcome: 'reached',
        note: summary,
        idempotencyKey: key,
      })
      // A promised call back is the record's next activity, for whoever holds it.
      if (nextDay)
        await call('crm.activity.schedule', {
          id: idOf(`follow-up\n${key}`),
          caseId: row.id,
          category: 'call',
          summary: say(words.followUp),
          dueDate: nextDay,
          idempotencyKey: `${key}:next`,
        })
      return { id: String(row.id), message: words.logged }
    },
    plan: async () => {
      const row = await record()
      await call('crm.plan.apply', {
        caseId: row.id,
        planId: need('planId'),
        anchorDate: dayOf(text(input, 'start')) || today(),
        ...optional('assigneeUserId', text(input, 'assigneeUserId')),
        idempotencyKey: key,
      })
      return { id: String(row.id), message: words.planned }
    },
    'activity-complete': async () => {
      const row = await record()
      await call('crm.activity.complete', {
        id: need('activityId'),
        ...optional('feedback', text(input, 'feedback')),
        completedDate: today(),
        idempotencyKey: key,
      })
      return { id: String(row.id), message: words.completed }
    },
    'activity-cancel': async () => {
      const row = await record()
      await call('crm.activity.cancel', {
        id: need('activityId'),
        feedback: need('reason'),
        idempotencyKey: key,
      })
      return { id: String(row.id), message: words.cancelled }
    },
    reschedule: async () => {
      const row = await record()
      // Moving an activity's day is the same right as completing or cancelling it.
      if (!(await ctx.allows('crm.activity.cancel', url, req)))
        throw new Refused('E_FORBIDDEN', say(words.forbidden))
      await call(
        'crm_backend.sales.rescheduleActivity',
        { id: need('activityId'), dueDate: needDay('due'), idempotencyKey: key },
        { unchecked: true },
      )
      return { id: String(row.id), message: words.rescheduled }
    },
    'config-save': async () => {
      const group = text(input, 'group')
      const fn = Object.hasOwn(CONFIGURATION, group) ? CONFIGURATION[group] : undefined
      if (!fn) throw new Refused('E_BAD_INPUT', say(words.unknown))
      const asked = text(input, 'configId')
      const id = asked || idOf(`config\n${group}\n${key}`)
      const values: Row = {
        id,
        name: need('name'),
        active: checked(input.active),
        // The version the form read: a row saved since is a conflict, not an overwrite.
        ...(asked ? { expectedVersion: Number(input.configVersion) || 0 } : {}),
      }
      if (group === 'stages')
        Object.assign(values, {
          code: need('code'),
          sequence: whole('sequence', 0, 10000) ?? 10,
          probability: text(input, 'probability'),
          staleDays: text(input, 'staleDays'),
          terminalState: ['won', 'lost'].includes(text(input, 'terminalState'))
            ? text(input, 'terminalState')
            : 'open',
          allowedKinds: KINDS[text(input, 'allowedKinds')] ?? KINDS.both,
          teamId: text(input, 'teamId'),
          fold: checked(input.fold),
        })
      if (group === 'lostReasons')
        Object.assign(values, {
          sequence: whole('sequence', 0, 10000) ?? 10,
          requiresNote: checked(input.requiresNote),
        })
      if (group === 'scoreRules')
        Object.assign(values, {
          field: text(input, 'field'),
          operator: text(input, 'operator'),
          value: text(input, 'value'),
          points: String(whole('points', -100, 100) ?? 0),
        })
      if (group === 'assignmentRules')
        Object.assign(values, {
          priority: whole('priority', 0, 10000) ?? 10,
          ...(KINDS[text(input, 'allowedKinds')] || !asked
            ? { allowedKinds: KINDS[text(input, 'allowedKinds')] ?? KINDS.both }
            : {}),
          teamId: need('teamId'),
          utmSource: text(input, 'utmSource'),
          minimumScore: whole('minimumScore', -10000, 10000),
          assigneeUserId: text(input, 'assigneeUserId'),
        })
      if (group === 'teams')
        Object.assign(values, {
          code: need('code'),
          leaderUserId: text(input, 'leaderUserId'),
          assignmentMode: text(input, 'assignmentMode'),
        })
      try {
        if (group === 'tags') await call(fn, { id, name: values.name, active: values.active })
        else if (group === 'lostReasons') {
          // Loss reasons are part of the pipeline's configuration, under the right that shapes its stages.
          if (!(await ctx.allows('crm.stage.save', url, req)))
            throw new Refused('E_FORBIDDEN', say(words.forbidden))
          await call(fn, { values, lang, idempotencyKey: key }, { unchecked: true })
        } else await call(fn, { values, idempotencyKey: key })
      } catch (error) {
        if (error instanceof Refused && error.code === 'E_CONFLICT')
          throw new Refused('E_CONFLICT', say(words.configConflict), error.fields)
        throw error
      }
      return { message: words.configSaved }
    },
    // How quotations written in Sales meet opportunities: part of the pipeline's setup, as loss reasons are.
    'quote-policy': async () => {
      if (!(await ctx.allows('crm.stage.save', url, req)))
        throw new Refused('E_FORBIDDEN', say(words.forbidden))
      try {
        await call(
          'crm_sale.sale.saveQuotationPolicy',
          {
            saleQuotations: need('saleQuotations'),
            expectedVersion: Number(input.configVersion) || 0,
            idempotencyKey: key,
          },
          { unchecked: true },
        )
      } catch (error) {
        if (error instanceof Refused && error.code === 'E_CONFLICT')
          throw new Refused('E_CONFLICT', say(words.configConflict), error.fields)
        throw error
      }
      return { message: words.configSaved }
    },
    'member-save': async () => {
      await call('crm.team.member.save', {
        id: text(input, 'memberId') || idOf(`member\n${key}`),
        teamId: need('teamId'),
        userId: need('userId'),
        capacity: whole('capacity', 1, 100) ?? 1,
        sequence: whole('sequence', 0, 10000) ?? 10,
        active: checked(input.active),
        idempotencyKey: key,
      })
      return { message: words.memberSaved }
    },
    'bulk-assign': async () => {
      const ids = [...new Set(listed(input.ids))]
      if (!ids.length || ids.length > 100) throw new Refused('E_VALIDATION', say(words.bulkSize))
      const assignee = need('assigneeUserId')
      const rows = await Promise.all(
        ids.map((id) =>
          call('crm.case.get', { id }).catch((error) => {
            if (error instanceof Refused) return null
            throw error
          }),
        ),
      )
      // The list read stands until one of its rows changes; this command retried has already given them to the recipient.
      const revision = Number(input.revision) || 0
      if (
        rows.some(
          (row) =>
            row?.id &&
            String(row.assigneeUserId ?? '') !== assignee &&
            (Date.parse(String(row.updatedAt)) || 0) > revision,
        )
      )
        throw new Refused('E_CONFLICT', say(words.listChanged))
      const bulk: Row[] = []
      for (const [index, id] of ids.entries()) {
        const row = rows[index]
        if (!row?.id || row.terminalState !== 'open') {
          bulk.push({ id, state: 'skipped', message: say(words.notOpen) })
          continue
        }
        const args = {
          id: row.id,
          ...optional('teamId', String(row.teamId ?? '')),
          assigneeUserId: assignee,
          expectedVersion: Number(row.version) || 0,
          idempotencyKey: `${key}:${id}`,
        }
        try {
          if (row.assigneeUserId && String(row.assigneeUserId) !== assignee)
            await call('crm.case.reassign', { ...args, reasonCode: 'workload_balance' })
          else if (!row.assigneeUserId) await call('crm.case.assign', args)
          bulk.push({ id, state: 'assigned', message: say(words.assigned) })
        } catch (error) {
          // One record the recipient may not take is skipped; the rest still go.
          if (!(error instanceof Refused)) throw error
          bulk.push({ id, state: 'skipped', message: error.message })
        }
      }
      const assigned = bulk.filter((row) => row.state === 'assigned').length
      const skipped = bulk.length - assigned
      return {
        message: [
          `Đã phân công ${assigned}/${bulk.length} hồ sơ; ${skipped} bỏ qua`,
          `Assigned ${assigned}/${bulk.length} records; ${skipped} skipped`,
        ],
        bulk,
      }
    },
    'quote-create': async () => {
      const row = await record()
      if (row.kind !== 'opportunity') throw new Refused('E_STATE', say(words.quoteOpportunity))
      const expires = needDay('expires')
      const products = await quoteProducts()
      // A quotation ships from the company's first warehouse; the form does not ask.
      const warehouses = (await call('stock.listWarehouses', {}, { unchecked: true })) as unknown as Row[]
      const warehouse = (Array.isArray(warehouses) ? warehouses : [])[0]
      if (!warehouse?.id) throw new Refused('E_STATE', say(words.noWarehouse))
      await call('crm_sale.sale.createQuotation', {
        id: idOf(`quote\n${key}`),
        caseId: row.id,
        warehouseId: String(warehouse.id),
        validityDate: expires,
        products,
        idempotencyKey: key,
      })
      return { id: String(row.id), message: words.quoteCreated }
    },
    'quote-edit': async () => {
      const row = await record()
      const order = await quotation(row.id)
      if (!['draft', 'sent'].includes(String(order.state)))
        throw new Refused('E_STATE', say(words.quoteOrdered))
      fresh(order)
      const expires = needDay('expires')
      // Writing a quotation again is writing it: `quoteProducts` checks the right to.
      const products = await quoteProducts()
      await call(
        'crm_sale.sale.reviseQuotation',
        {
          caseId: row.id,
          orderId: order.id,
          expectedRevision: Number(order.revision ?? 0),
          validityDate: expires,
          products,
          idempotencyKey: key,
        },
        { unchecked: true },
      )
      return { id: String(row.id), message: words.quoteSaved }
    },
    'quote-send': async () => {
      const row = await record()
      const order = await quotation(row.id)
      if (!['draft', 'sent'].includes(String(order.state)))
        throw new Refused('E_STATE', say(words.quoteOrdered))
      // The revision the form read is checked by the sending itself, after it knows a retried request for what it
      // is: the quotation it sent has moved on, and the retry still returns that sending.
      if (dayOf(String(order.validityDate ?? '')) && dayOf(String(order.validityDate)) < today())
        throw new Refused('E_STATE', say(words.quoteExpired))
      // `hand` is a quotation handed over: marked sent, nobody contacted. Any other channel the sale's rule checks.
      const asked = text(input, 'channel')
      const channel = asked === 'hand' ? null : asked || null
      // Sending is the sales right; an email is also a message on the record, under the right that adds one.
      if (
        !(await ctx.allows('sale.sendQuotation', url, req)) ||
        (channel === 'email' && !(await ctx.allows('crm.case.addMessage', url, req)))
      )
        throw new Refused('E_FORBIDDEN', say(words.forbidden))
      if (channel && row.contactConsent !== true)
        throw new Refused('E_CONSENT', say(words.quoteNoConsent), { consent: say(words.recordConsent) })
      try {
        await call(
          'crm_backend.sales.sendQuotation',
          {
            caseId: row.id,
            orderId: order.id,
            channel,
            recipient: channel ? need('recipient') : null,
            subject: text(input, 'subject'),
            message: channel === 'email' ? need('message') : text(input, 'message'),
            messageId: idOf(`quote-email\n${key}`),
            expectedRevision: Number(text(input, 'quoteVersion')),
            idempotencyKey: key,
          },
          { unchecked: true },
        )
      } catch (error) {
        if (error instanceof Refused && error.code === 'E_CONFLICT')
          throw new Refused('E_CONFLICT', say(words.quoteChanged))
        throw error
      }
      return {
        id: String(row.id),
        message: channel === 'email' ? words.quoteEmailed : channel ? words.quoteSent : words.quoteHanded,
      }
    },
    'quote-attach': async () => {
      const row = await record()
      // Attaching a quotation written in Sales is quoting the opportunity, under the right that writes one.
      if (!(await ctx.allows('crm_sale.sale.createQuotation', url, req)))
        throw new Refused('E_FORBIDDEN', say(words.forbidden))
      await call(
        'crm_sale.sale.attachQuotation',
        { caseId: row.id, orderId: need('orderId'), idempotencyKey: key },
        { unchecked: true },
      )
      return { id: String(row.id), message: words.quoteAttached }
    },
    'quote-accept': async () => {
      const row = await record()
      const order = await quotation(row.id)
      if (String(order.state) !== 'sent') throw new Refused('E_STATE', say(words.quoteUnsent))
      fresh(order)
      await call('sale.confirmOrder', { id: order.id, expectedRevision: Number(order.revision ?? 0) })
      await call(
        'crm_sale.sale.recordQuotationStep',
        { caseId: row.id, orderId: order.id, step: 'accepted', idempotencyKey: key },
        { unchecked: true },
      )
      return { id: String(row.id), message: words.quoteAccepted }
    },
    merge: async () => {
      const row = await record()
      const target = (await call('crm.case.get', { id: need('targetId') })) as Row | null
      if (!target?.id) throw new Refused('E_NOT_FOUND', _('crm.error.notFound'))
      if (
        target.id === row.id ||
        target.terminalState !== 'open' ||
        target.kind !== row.kind ||
        String(target.partnerId ?? '') !== String(row.partnerId ?? '')
      )
        throw new Refused('E_STATE', say(words.mergeState))
      // A shared phone number is not a shared need: the user says they compared the two.
      if (!checked(input.sameNeed))
        throw new Refused('E_VALIDATION', say(words.sameNeed), { sameNeed: say(words.sameNeedField) })
      await call('crm.case.merge', {
        targetId: target.id,
        sourceId: row.id,
        expectedTargetVersion: Number(input.targetVersion) || 0,
        idempotencyKey: key,
      })
      await call('crm_sale.sale.followMerge', { sourceId: row.id, targetId: target.id }, { unchecked: true })
      if (input.keepContact === 'source') {
        const kept = (await call('crm.case.get', { id: target.id })) as Row
        await call('crm.case.save', {
          ...caseFields(kept),
          contactName: row.contactName ?? null,
          phone: row.phone ?? null,
          email: row.email ?? null,
          expectedVersion: Number(kept.version),
          idempotencyKey: `${key}:contact`,
        })
      }
      return { id: String(target.id), message: words.merged }
    },
    email: async () => {
      const row = await record()
      // An email is a message on the record, under the right that adds one.
      if (!(await ctx.allows('crm.case.addMessage', url, req)))
        throw new Refused('E_FORBIDDEN', say(words.forbidden))
      if (row.contactConsent !== true)
        throw new Refused('E_CONSENT', say(words.noConsent), { consent: say(words.recordConsent) })
      if (!String(row.email ?? '').includes('@'))
        throw new Refused('E_VALIDATION', say(words.noEmail), { email: say(words.addEmail) })
      await call(
        'crm_backend.sales.sendEmail',
        {
          id: idOf(`email\n${key}`),
          caseId: row.id,
          subject: text(input, 'subject'),
          body: need('message'),
          idempotencyKey: key,
        },
        { unchecked: true },
      )
      return { id: String(row.id), message: words.emailQueued }
    },
    'email-retry': async () => {
      const row = await record()
      if (!(await ctx.allows('crm.case.addMessage', url, req)))
        throw new Refused('E_FORBIDDEN', say(words.forbidden))
      await call(
        'crm_backend.sales.retryEmail',
        { caseId: row.id, messageId: need('messageId'), idempotencyKey: key },
        { unchecked: true },
      )
      return { id: String(row.id), message: words.emailRetried }
    },
    'import-preview': async () => {
      if (!(await manages())) throw new Refused('E_FORBIDDEN', say(words.forbidden))
      let parsed: ReturnType<typeof parseSalesImport>
      try {
        parsed = parseSalesImport(input, (vi, en) => (lang === 'en' ? en : vi))
      } catch (error) {
        if (error instanceof ImportRefused)
          throw new Refused('E_VALIDATION', error.message, { data: error.message })
        throw error
      }
      const diagnostics = await diagnose(parsed.rows)
      const id = idOf(`import\n${key}`)
      // What the user pasted and mapped comes back into the form beside its preview.
      const kept = Object.fromEntries(
        ['data', 'format', 'importConsent', ...IMPORT_FIELDS.map((field) => `map-${field}`)].flatMap(
          (name) => (input[name] == null ? [] : [[name, input[name]]]),
        ),
      )
      await call(
        'crm_backend.sales.saveImportPreview',
        {
          id,
          input: kept,
          headers: parsed.headers,
          rows: parsed.rows,
          diagnostics,
          valid: diagnostics.every((row) => row.valid),
        },
        { unchecked: true },
      )
      return { message: words.previewed, params: { dialog: 'import', preview: id } }
    },
    import: async () => {
      if (!(await manages())) throw new Refused('E_FORBIDDEN', say(words.forbidden))
      const previewId = need('previewId')
      const { preview } = (await call(
        'crm_backend.sales.importPreview',
        { id: previewId },
        { unchecked: true },
      )) as { preview?: Row | null }
      if (!preview?.id || preview.valid !== true) throw new Refused('E_VALIDATION', say(words.previewFirst))
      const parse = (value: unknown) => (typeof value === 'string' ? JSON.parse(value) : value)
      const imported = (rows: number) => [`Đã nhập ${rows} dòng`, `Imported ${rows} rows`] as const
      // Confirmed already: the same import again, not a second one.
      const result = parse(preview.result) as { rows: number; last: string | null } | null
      if (result) return { id: result.last, message: imported(result.rows) }
      const rows = parse(preview.rows) as ImportRow[]
      const reviewed = parse(preview.diagnostics) as Row[]
      // The customers and events the user reviewed must still be the ones each row meets.
      const now = await diagnose(rows)
      if (
        now.some(
          (row, index) =>
            row.duplicate !== reviewed[index]?.duplicate || row.partnerId !== reviewed[index]?.partnerId,
        )
      )
        throw new Refused('E_CONFLICT', say(words.importChanged))
      let last: string | null = null
      for (const [index, row] of rows.entries()) {
        const id = row.externalId
          ? idOf(`intake\n${row.source}\n${row.externalId}`)
          : idOf(`import\n${previewId}\n${index}`)
        // An event already in leads to the record it made, as a repeated intake does.
        if (now[index]?.duplicate) {
          last = id
          continue
        }
        const partner = now[index]?.partnerId
          ? { partnerId: String(now[index]?.partnerId) }
          : await newPartner(idOf(`partner\n${previewId}\n${index}`), {
              name: row.contactName || row.name,
              phone: row.phone,
              email: row.email,
              consent: row.consent,
            })
        try {
          await call('crm.case.save', {
            id,
            kind: 'lead',
            name: row.name,
            ...partner,
            contactName: row.contactName || null,
            phone: row.phone || null,
            email: row.email || null,
            priority: '0',
            utmSource: row.source || null,
            expectedRevenue: '0',
            probability: '0',
            tagIds: [],
            contactConsent: row.consent,
            idempotencyKey: `${key}:${index}`,
          })
        } catch (error) {
          // The event's record exists out of the user's sight: it was taken in once already.
          if (error instanceof Refused && error.fields.id) continue
          throw error
        }
        await call('crm.case.assign', { id, idempotencyKey: `${key}:${index}:assign` }).catch((error) => {
          if (!(error instanceof Refused)) throw error
        })
        last = id
      }
      await call(
        'crm_backend.sales.importPreview',
        { id: previewId, result: { rows: rows.length, last } },
        { unchecked: true },
      )
      return { id: last, message: imported(rows.length) }
    },
    // The screens read the records as they are; there is no snapshot to rebuild.
    refresh: async () => ({ message: words.refreshed }),
    note: async () => {
      const row = await record()
      await call('crm.case.addMessage', {
        id: idOf(`note\n${key}`),
        caseId: row.id,
        body: need('message'),
        visibility: 'internal',
        idempotencyKey: key,
      })
      return { id: String(row.id), message: words.noted }
    },
  }

  try {
    if (!key) throw new Refused('E_VALIDATION', say(words.required), { requestId: say(words.required) })
    if (['reset', 'load-sample'].includes(command)) throw new Refused('E_FORBIDDEN', say(words.demoOnly))
    const run = Object.hasOwn(commands, command) ? commands[command] : undefined
    if (!run) throw new Refused('E_BAD_INPUT', say(words.unknown))
    const done = await run()
    for (const name of ['error', 'dialog', 'modal', 'panel', 'resolve', 'ids', 'preview'])
      context.delete(name)
    context.set('notice', 'saved')
    // A quick action from the board or the planner returns to it; the record stays in its peek.
    if (input.stay === '1')
      for (const name of ['id', 'activity', 'quote', 'template', 'stage']) context.delete(name)
    else if (done.id) {
      context.set('screen', 'lead-detail')
      context.set('id', done.id)
    }
    for (const [name, value] of Object.entries(done.params ?? {})) context.set(name, value)
    return {
      location: adminSalesRoutes.href(context.toString()),
      notice: { message: say(done.message), bulk: done.bulk ?? [] },
    }
  } catch (error) {
    // A refusal keeps the dialog open over the draft; anything else keeps the draft for a retry.
    if (!(error instanceof Refused)) console.error('crm sales command', command, error)
    const refused = error instanceof Refused ? error : new Refused('E_RETRY', say(words.retry))
    context.set('error', key || 'refused')
    for (const name of ['resolve', 'notice']) context.delete(name)
    const { context: _context, ...draft } = input
    return {
      location: adminSalesRoutes.href(context.toString()),
      response: { input: draft, message: refused.message, fields: refused.fields, code: refused.code },
    }
  }
}

/** A record's own fields, as `crm.case.save` takes them, so an edit of some keeps the rest. */
const caseFields = (row: Row): Row => ({
  id: row.id,
  kind: row.kind,
  name: row.name,
  partnerId: row.partnerId ?? null,
  contactName: row.contactName ?? null,
  phone: row.phone ?? null,
  email: row.email ?? null,
  teamId: row.teamId ?? null,
  stageId: row.stageId ?? null,
  priority: String(row.priority ?? '0'),
  description: row.description ?? null,
  utmSource: row.utmSource ?? null,
  utmMedium: row.utmMedium ?? null,
  utmCampaign: row.utmCampaign ?? null,
  expectedRevenue: String(row.expectedRevenue ?? '0'),
  probability: String(row.probability ?? '0'),
  expectedClosing: row.expectedClosing ?? null,
  tagIds: ((row.tags ?? []) as Row[]).map((tag) => String(tag.id)),
})

/** The form's priority (0–3 stars) as the record keeps it. */
const priority = (value: unknown, fallback: string) => {
  const asked = String(value ?? '').trim()
  return ['0', '1', '2', '3'].includes(asked) ? asked : fallback
}
