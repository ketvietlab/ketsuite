// @ts-nocheck Shared by the server render and the browser; its tests exercise it.
// The CRM sales dialogs, drawn by the island from the address (`dialog=<name>`) and the screen's read.
// Each is one native command form; a refusal reopens it with the draft, the reason and the fields to fix.
const sum = (rows, pick) => rows.reduce((total, row) => total + pick(row), 0)
export const quoteNet = (line) =>
  Math.round(
    (Number(line.quantity) || 0) * (Number(line.price) || 0) * (1 - (Number(line.discount) || 0) / 100),
  )
export const quoteTax = (line) => Math.round((quoteNet(line) * (Number(line.tax) || 0)) / 100)
export const quoteLineKeys = ['product', 'quantity', 'price', 'discount', 'tax']

export const createSalesDialogs = ({ view, ds }) => {
  const { html } = view
  const {
    Button,
    ConfirmDialog,
    DescriptionList,
    Field,
    FormGrid,
    Inline,
    LinkButton,
    ModalSheet,
    Notice,
    Section,
    Stack,
    Tabs,
    Text,
  } = ds

  const sheet = (k, { title, description = null, body, closeHref, size = 'default' }) =>
    ModalSheet({
      id: 'sales-dialog',
      title,
      description,
      presentation: 'dialog',
      size,
      closeHref,
      closeLabel: k.t('Đóng', 'Close'),
      body,
    })
  const missing = (k, closeHref, title, message) =>
    sheet(k, { title, closeHref, size: 'small', body: Notice({ tone: 'warning', title, message }) })

  /** The quote's product lines, edited in place: totals follow every keystroke. */
  const quoteEditor = (k, key, initial, command) => {
    const { t, fmt } = k,
      lines = k.env.quoteLines(key, initial),
      products = k.model.products,
      mine = k.owns(command)
    const error = (name) => (mine && k.errors[name] ? (fmt.en ? 'Check this field.' : k.errors[name]) : null)
    const subtotal = sum(lines, quoteNet),
      taxes = sum(lines, quoteTax)
    return html`<div data-crm-quote-editor=${key}>
      ${Stack({
        items: [
          Stack({
            divided: true,
            items: lines.map((line, i) =>
              Section({
                title: `${t('Dòng', 'Line')} ${i + 1}`,
                actions:
                  lines.length > 1
                    ? Button({
                        label: t(`Bỏ dòng ${i + 1}`, `Remove line ${i + 1}`),
                        type: 'button',
                        name: 'remove-line',
                        value: String(i),
                        variant: 'tertiary',
                        size: 'small',
                      })
                    : undefined,
                body: Stack({
                  gap: 'compact',
                  items: [
                    FormGrid({
                      columns: 3,
                      items: [
                        Field({
                          id: `quote-product-${i}`,
                          name: `product-${i}`,
                          label: t('Sản phẩm', 'Product'),
                          type: 'select',
                          value: line.product,
                          options: products.map((p) => ({
                            value: p.id,
                            label: `${p.name} · ${fmt.money(p.price)}`,
                          })),
                          error: error(`product-${i}`),
                        }),
                        ...[
                          ['quantity', t('Số lượng', 'Quantity'), 1],
                          ['price', t('Đơn giá (₫)', 'Unit price (₫)'), 1000],
                          ['discount', t('Chiết khấu (%)', 'Discount (%)'), 1],
                          ['tax', t('Thuế (%)', 'Tax (%)'), 1],
                        ].map(([name, label, step]) =>
                          Field({
                            id: `quote-${name}-${i}`,
                            name: `${name}-${i}`,
                            label,
                            type: 'number',
                            min: 0,
                            max: ['discount', 'tax'].includes(name) ? 100 : undefined,
                            step,
                            value: String(line[name] ?? 0),
                            required: true,
                            error: error(`${name}-${i}`),
                          }),
                        ),
                      ],
                    }),
                    Text({
                      children: `${t('Thành tiền trước thuế', 'Net amount')}: ${fmt.money(quoteNet(line))}`,
                      variant: 'bodySm',
                      tone: 'muted',
                      numeric: true,
                    }),
                  ],
                }),
              }),
            ),
          }),
          Inline({
            align: 'between',
            blockAlign: 'start',
            wrap: true,
            items: [
              Button({
                label: t('Thêm sản phẩm', 'Add product'),
                type: 'button',
                name: 'add-line',
                variant: 'secondary',
                icon: 'plus',
                disabled: lines.length >= 20,
              }),
              DescriptionList({
                label: t('Tổng báo giá', 'Quote totals'),
                columns: 1,
                items: [
                  { id: 'subtotal', label: t('Tạm tính', 'Subtotal'), value: fmt.money(subtotal) },
                  { id: 'tax', label: t('Thuế', 'Tax'), value: fmt.money(taxes) },
                  { id: 'total', label: t('Tổng cộng', 'Total'), value: fmt.money(subtotal + taxes) },
                ],
              }),
            ],
          }),
        ],
      })}
    </div>`
  }

  /** A record's dialog, over its page, the board or the planner. */
  const caseDialog = (k, detail, closeHref) => {
    const name = k.query.get('dialog'),
      { t, fmt, words, model } = k
    if (!name) return null
    if (!detail)
      return missing(
        k,
        closeHref,
        t('Không tìm thấy hồ sơ', 'Record unavailable'),
        t(
          'Hồ sơ không tồn tại hoặc ngoài phạm vi xem.',
          'The record is missing or outside your access scope.',
        ),
      )
    const r = detail.record
    if (!detail.writable)
      return missing(
        k,
        closeHref,
        t('Chỉ xem', 'Read only'),
        t('Bạn chỉ có quyền xem hồ sơ này.', 'You can only view this record.'),
      )
    const description = `${r.name} · ${r.id}`
    const stagesFor = (kind) =>
      model.stages.filter(
        (s) =>
          s.active &&
          s.terminalState === 'open' &&
          (!s.teamId || s.teamId === r.teamId) &&
          s.allowedKinds.includes(kind),
      )
    const people = model.people
    const forecasts = [
      k.field(
        'expectedRevenue',
        t('Doanh thu dự kiến (₫)', 'Expected revenue (₫)'),
        String(r.revenue || ''),
        {
          type: 'number',
          min: 0,
          step: 1000,
          required: true,
        },
      ),
      k.field('probability', t('Xác suất (%)', 'Probability (%)'), String(r.probability), {
        type: 'number',
        min: 0,
        max: 100,
        required: true,
      }),
      k.field('expectedClosing', t('Dự kiến chốt', 'Expected close'), r.closing, { type: 'date' }),
    ]
    const open = (label, fields, extra = {}, size = 'default', lead = null) =>
      sheet(k, {
        title: label,
        description,
        size,
        closeHref,
        body: lead
          ? Stack({ items: [lead, k.command(name, label, fields, r, extra, { cancelHref: closeHref })] })
          : k.command(name, label, fields, r, extra, { cancelHref: closeHref }),
      })
    if (name === 'convert') {
      const stages = stagesFor('opportunity')
      return open(
        t('Chuyển thành cơ hội', 'Convert to opportunity'),
        [
          k.choose('stageId', t('Giai đoạn cơ hội', 'Opportunity stage'), stages[0]?.id ?? '', stages),
          ...forecasts,
        ],
        {},
        'default',
        Text({
          children: t(
            'Lead được giữ nguyên lịch sử, công việc và liên hệ; chỉ thêm giá trị dự kiến để vào dự báo.',
            'The lead keeps its history, activities and contact; it gains an expected value for the forecast.',
          ),
          variant: 'bodySm',
          tone: 'muted',
        }),
      )
    }
    if (name === 'close')
      return open(
        t('Chốt kết quả', 'Close outcome'),
        [
          k.field(
            'terminalState',
            t('Kết quả', 'Outcome'),
            k.query.get('outcome') === 'lost' ? 'lost' : 'won',
            {
              type: 'radio',
              options: [
                { value: 'won', label: t('Thành công', 'Won') },
                { value: 'lost', label: t('Thất bại', 'Lost') },
              ],
              span: 'full',
            },
          ),
          k.choose(
            'lostReasonId',
            t('Lý do thất bại', 'Loss reason'),
            '',
            [{ id: '', name: t('Chỉ chọn khi thất bại', 'Only when lost') }, ...model.lostReasons],
            { help: t('Bắt buộc khi chốt thất bại.', 'Required when the outcome is lost.') },
          ),
          k.field('note', t('Ghi chú', 'Note'), '', { type: 'textarea', span: 'full' }),
        ],
        {},
        'default',
        Text({
          children: `${t('Giá trị', 'Value')}: ${fmt.money(r.revenue)} · ${t('Xác suất hiện tại', 'Current probability')}: ${r.probability}%`,
          variant: 'bodySm',
          tone: 'muted',
          numeric: true,
        }),
      )
    if (name === 'move') {
      const stages = stagesFor(r.kind),
        picked = stages.find((s) => s.id === k.query.get('stage'))?.id ?? r.stageId
      return open(
        t('Chuyển giai đoạn', 'Move stage'),
        [
          k.field('stageId', t('Giai đoạn mới', 'New stage'), picked, {
            type: 'radio',
            optionsOrientation: 'vertical',
            span: 'full',
            options: stages.map((s) => ({
              value: s.id,
              label: s.probability === null ? s.name : `${s.name} · ${s.probability}%`,
            })),
          }),
        ],
        {},
        'small',
      )
    }
    if (name === 'assign')
      return open(t('Phân công', 'Assign'), [
        k.choose(
          'teamId',
          t('Đội', 'Team'),
          r.teamId,
          model.teams.filter((x) => x.active),
        ),
        k.choose('assigneeUserId', t('Người phụ trách', 'Owner'), r.assignee, [
          { id: '', name: t('Theo quy tắc của đội', "By the team's rule") },
          ...people,
        ]),
      ])
    if (name === 'reopen')
      return open(
        t('Mở lại hồ sơ', 'Reopen record'),
        [
          k.field('reason', t('Lý do mở lại', 'Reason to reopen'), '', {
            type: 'textarea',
            required: true,
            span: 'full',
          }),
        ],
        {},
        'small',
      )
    if (name === 'interaction')
      return open(t('Ghi tương tác', 'Log interaction'), [
        k.choose('channel', t('Kênh', 'Channel'), 'phone', [
          { id: 'phone', name: words.channel.phone },
          { id: 'email', name: words.channel.email },
          { id: 'chat', name: words.channel.chat },
        ]),
        k.field('nextAt', t('Hẹn liên hệ lại', 'Next contact'), '', {
          type: 'datetime-local',
          help: t('Để trống nếu chưa hẹn.', 'Leave empty when nothing is planned.'),
        }),
        k.field('summary', t('Nội dung trao đổi', 'What was discussed'), '', {
          type: 'textarea',
          required: true,
          span: 'full',
        }),
      ])
    if (name === 'activity')
      return open(t('Lên lịch công việc', 'Schedule activity'), [
        k.field('summary', t('Việc cần làm', 'Activity'), '', { required: true, span: 'full' }),
        k.choose(
          'activityType',
          t('Loại', 'Type'),
          'call',
          Object.entries(words.activityType).map(([id, label]) => ({ id, name: label })),
        ),
        k.field('due', t('Hạn', 'Due'), '', { type: 'datetime-local', required: true }),
        k.choose('assigneeUserId', t('Người phụ trách', 'Owner'), r.assignee || model.actor.id, people),
      ])
    if (name === 'plan')
      return open(t('Áp dụng kế hoạch', 'Apply plan'), [
        k.choose(
          'planId',
          t('Kế hoạch', 'Plan'),
          model.plans[0]?.id ?? '',
          model.plans.map((p) => ({
            id: p.id,
            name: `${p.name} · ${t(`${p.tasks} việc`, `${p.tasks} tasks`)}`,
          })),
        ),
        k.field('start', t('Bắt đầu', 'Start'), model.clock.slice(0, 10), { type: 'date' }),
        k.choose('assigneeUserId', t('Người phụ trách', 'Owner'), r.assignee || model.actor.id, people),
      ])
    if (['activity-complete', 'activity-cancel', 'reschedule'].includes(name)) {
      const active = detail.activities.find((a) => a.id === k.query.get('activity') && a.state === 'open')
      if (!active)
        return missing(
          k,
          closeHref,
          t('Công việc không còn mở', 'The activity is no longer open'),
          t(
            'Công việc đã được hoàn tất, hủy hoặc không tồn tại.',
            'It was completed, cancelled or does not exist.',
          ),
        )
      const due = fmt.due(active.dueAt)
      const lead = Text({
        children: `${words.activityType[active.type] ?? active.type}: ${active.title} · ${due.label} · ${k.owner(active.owner)}`,
        variant: 'bodySm',
        tone: 'muted',
      })
      const extra = { activityId: active.id }
      if (name === 'reschedule')
        return open(
          t('Dời lịch', 'Reschedule'),
          [
            k.field('due', t('Hạn mới', 'New due date'), active.dueAt, {
              type: 'datetime-local',
              required: true,
            }),
          ],
          extra,
          'small',
          lead,
        )
      if (name === 'activity-cancel')
        return open(
          t('Hủy công việc', 'Cancel activity'),
          [
            k.field('reason', t('Lý do hủy', 'Reason'), '', {
              type: 'textarea',
              required: true,
              span: 'full',
            }),
          ],
          extra,
          'small',
          lead,
        )
      // The planner's row opens this dialog: the other outcomes of the same activity are one step away.
      return open(
        t('Hoàn tất công việc', 'Complete activity'),
        [
          k.field('feedback', t('Kết quả', 'Outcome'), '', {
            type: 'textarea',
            span: 'full',
            help: t('Kết quả được ghi vào lịch sử hồ sơ.', "The outcome is added to the record's history."),
          }),
        ],
        extra,
        'small',
        Stack({
          gap: 'compact',
          items: [
            lead,
            Inline({
              gap: 'compact',
              wrap: true,
              items: [
                LinkButton({
                  label: t('Dời lịch', 'Reschedule'),
                  href: k.same({ dialog: 'reschedule' }),
                  variant: 'tertiary',
                }),
                LinkButton({
                  label: t('Hủy công việc', 'Cancel activity'),
                  href: k.same({ dialog: 'activity-cancel' }),
                  variant: 'tertiary',
                }),
                ...(k.screen === 'lead-detail'
                  ? []
                  : [
                      LinkButton({
                        label: t('Mở hồ sơ', 'Open record'),
                        href: k.href('lead-detail', { id: r.id, returnTo: k.here({ id: null }) }),
                        variant: 'tertiary',
                      }),
                    ]),
              ],
            }),
          ],
        }),
      )
    }
    if (name === 'email') {
      const followup = k.query.get('template') === 'followup'
      return sheet(k, {
        title: t('Soạn email', 'Compose email'),
        description,
        closeHref,
        body: Stack({
          items: [
            Tabs({
              id: 'sales-email-template',
              label: t('Mẫu email', 'Email template'),
              items: [
                {
                  id: 'proposal',
                  label: t('Mẫu gửi đề xuất', 'Proposal template'),
                  href: k.same({ template: 'proposal' }),
                  active: !followup,
                },
                {
                  id: 'followup',
                  label: t('Mẫu theo dõi', 'Follow-up template'),
                  href: k.same({ template: 'followup' }),
                  active: followup,
                },
              ],
            }),
            k.command(
              'email',
              t('Gửi email', 'Send email'),
              [
                k.field('to', t('Người nhận', 'To'), `${r.contact} <${r.email || '—'}>`, {
                  readOnly: true,
                  span: 'full',
                }),
                k.field(
                  'subject',
                  t('Tiêu đề', 'Subject'),
                  followup
                    ? t('Theo dõi đề xuất', 'Following up on your proposal')
                    : t('Đề xuất theo nhu cầu của bạn', 'Your requested proposal'),
                  { span: 'full' },
                ),
                k.field(
                  'message',
                  t('Nội dung', 'Message'),
                  followup
                    ? t(
                        'Chào bạn, bạn đã xem đề xuất của chúng tôi chưa? Chúng tôi có thể giải đáp thêm để bạn chọn phương án phù hợp.',
                        'Hello, have you reviewed our proposal? We can answer your questions and help you choose the right option.',
                      )
                    : t(
                        'Chào bạn, chúng tôi gửi đề xuất theo nhu cầu đã trao đổi. Vui lòng phản hồi khi thuận tiện.',
                        'Hello, here is the proposal based on our discussion. Please reply at your convenience.',
                      ),
                  { type: 'textarea', required: true, span: 'full' },
                ),
                // The demo names an attachment, a reply and a delivery outcome; a real email is sent and reports its own.
                ...(k.routes.demo
                  ? [
                      k.field('attachment', t('Tệp đính kèm (tên tệp mẫu)', 'Attachment (sample file name)')),
                      k.choose('direction', t('Chiều', 'Direction'), 'outbound', [
                        { id: 'outbound', name: t('Gửi đi', 'Outgoing') },
                        { id: 'inbound', name: t('Khách gửi đến (mẫu)', 'Incoming sample') },
                      ]),
                      k.choose('delivery', t('Kết quả gửi (mô phỏng)', 'Delivery (simulated)'), 'ok', [
                        { id: 'ok', name: t('Gửi thành công', 'Delivered') },
                        { id: 'fail', name: t('Gửi lỗi', 'Delivery failure') },
                      ]),
                    ]
                  : []),
              ],
              r,
              { template: followup ? 'followup' : 'proposal' },
              { cancelHref: closeHref },
            ),
          ],
        }),
      })
    }
    if (name === 'quote-send') {
      const q = detail.quotes.find((x) => x.id === k.query.get('quote'))
      if (!q || !['draft', 'sent'].includes(q.state))
        return missing(
          k,
          closeHref,
          t('Không gửi được báo giá', 'This quote cannot be sent'),
          t('Báo giá đã thành đơn hoặc không tồn tại.', 'It is already an order or does not exist.'),
        )
      if (q.expires && q.expires < model.clock.slice(0, 10))
        return sheet(k, {
          title: t(`Gửi báo giá ${q.id}`, `Send quote ${q.id}`),
          description,
          size: 'small',
          closeHref,
          body: Stack({
            items: [
              Notice({
                tone: 'warning',
                title: t('Báo giá đã hết hạn', 'The quote has expired'),
                message: t('Sửa hạn rồi gửi lại.', 'Change its validity, then send it.'),
              }),
              Inline({
                gap: 'compact',
                items: [
                  LinkButton({
                    label: t('Sửa báo giá', 'Edit quote'),
                    href: k.same({ dialog: 'quote-edit', quote: q.id }),
                    variant: 'primary',
                  }),
                  LinkButton({ label: t('Hủy', 'Cancel'), href: closeHref, variant: 'tertiary' }),
                ],
              }),
            ],
          }),
        })
      // Email and Zalo contact the customer, so they need both the record's and the customer's agreement; a quote
      // handed over contacts nobody.
      const consented = r.consent && detail.partner?.consent !== false
      const asked = k.query.get('channel')
      const channel = !consented
        ? 'hand'
        : ['email', 'zalo', 'hand'].includes(asked)
          ? asked
          : r.email
            ? 'email'
            : 'zalo'
      const summary = [
        t(
          `Chào ${r.contact || 'bạn'}, chúng tôi gửi báo giá ${q.id}: tổng cộng ${fmt.money(q.total)}, hiệu lực đến ${fmt.fullDate(q.expires)}.`,
          `Hello ${r.contact || 'there'}, here is quote ${q.id}: ${fmt.money(q.total)} in total, valid until ${fmt.fullDate(q.expires)}.`,
        ),
        ...q.lines.map((l) => `- ${l.name} × ${fmt.number(l.quantity)}: ${fmt.money(l.net)}`),
        t('Vui lòng phản hồi nếu cần điều chỉnh.', 'Let us know if anything should change.'),
      ].join('\n')
      // The channel changes the form below it, so it is a tab: the one shown carries `aria-current`.
      const choice = (id, label) => ({ id, label, href: k.same({ channel: id }), active: channel === id })
      const fields =
        channel === 'email'
          ? [
              k.field('recipient', t('Người nhận', 'To'), r.email, {
                type: 'email',
                required: true,
                span: 'full',
              }),
              k.field('subject', t('Tiêu đề', 'Subject'), t(`Báo giá ${q.id}`, `Quote ${q.id}`), {
                span: 'full',
              }),
              k.field('message', t('Nội dung', 'Message'), summary, {
                type: 'textarea',
                required: true,
                span: 'full',
              }),
            ]
          : channel === 'zalo'
            ? [
                k.field('recipient', t('Số Zalo', 'Zalo number'), r.phone, {
                  type: 'tel',
                  required: true,
                  span: 'full',
                }),
                k.field('message', t('Lời nhắn', 'Message'), summary, {
                  type: 'textarea',
                  span: 'full',
                  help: t(
                    'Gửi báo giá qua Zalo của bạn, rồi ghi nhận ở đây để hồ sơ và Bán hàng cùng thấy.',
                    'Send the quote from your Zalo, then record it here so the record and Sales both show it.',
                  ),
                }),
              ]
            : []
      return sheet(k, {
        title: t(`Gửi báo giá ${q.id}`, `Send quote ${q.id}`),
        description,
        closeHref,
        body: Stack({
          items: [
            consented
              ? Tabs({
                  id: 'sales-quote-channel',
                  label: t('Kênh gửi', 'Channel'),
                  items: [
                    choice('email', 'Email'),
                    choice('zalo', 'Zalo'),
                    choice('hand', words.sendChannel.hand),
                  ],
                })
              : Notice({
                  tone: 'warning',
                  title: t('Khách chưa đồng ý liên hệ', 'No consent to contact'),
                  message: t(
                    'Không gửi qua email hay Zalo. Chỉ ghi nhận báo giá đã trao tận tay.',
                    'Nothing goes out by email or Zalo. Only a handover can be recorded.',
                  ),
                }),
            channel === 'hand'
              ? Text({
                  children: t(
                    'Ghi nhận khách đã nhận báo giá trực tiếp; hệ thống không liên hệ khách.',
                    'Records that the customer received the quote in person; nobody is contacted.',
                  ),
                  variant: 'bodySm',
                  tone: 'muted',
                })
              : null,
            k.command(
              'quote-send',
              channel === 'email'
                ? t('Gửi email', 'Send email')
                : channel === 'zalo'
                  ? t('Ghi nhận đã gửi Zalo', 'Record Zalo send')
                  : t('Ghi nhận đã trao', 'Record handover'),
              fields,
              r,
              { quoteId: q.id, quoteVersion: String(q.revision ?? q.version), channel },
              { cancelHref: closeHref },
            ),
          ],
        }),
      })
    }
    if (name === 'quote-attach') {
      const rows = detail.attachable
      // Each quote's button and its form, made now: a table draws its cells after the page's forms are drawn.
      const attach = new Map(
        rows.map((q) => [q.id, k.action('quote-attach', t('Gắn', 'Attach'), r, { orderId: q.orderRef })]),
      )
      return sheet(k, {
        title: t('Gắn báo giá có sẵn', 'Attach an existing quote'),
        description,
        closeHref,
        body: rows.length
          ? Stack({
              items: [
                Text({
                  children: t(
                    'Báo giá của cùng khách, lập ở Bán hàng và chưa thuộc cơ hội nào.',
                    'Quotes of the same customer, written in Sales and not yet on any opportunity.',
                  ),
                  variant: 'bodySm',
                  tone: 'muted',
                }),
                k.table({
                  label: t('Báo giá có thể gắn', 'Quotes to attach'),
                  rows,
                  columns: [
                    {
                      key: 'id',
                      label: t('Báo giá', 'Quote'),
                      priority: 'primary',
                      cell: (q) => k.lines(q.id, q.date ? fmt.date(q.date) : null),
                    },
                    {
                      key: 'state',
                      label: t('Trạng thái', 'Status'),
                      cell: (q) =>
                        k.badge(words.quoteState[q.state] ?? q.state, words.quoteTone[q.state] ?? 'neutral'),
                    },
                    {
                      key: 'total',
                      label: t('Tổng cộng', 'Total'),
                      align: 'end',
                      kind: 'currency',
                      cell: (q) => k.amount(q.total),
                    },
                    {
                      key: 'attach',
                      label: t('Thao tác', 'Action'),
                      align: 'end',
                      cell: (q) => attach.get(q.id),
                    },
                  ],
                }),
              ],
            })
          : Notice({
              tone: 'info',
              title: t('Không có báo giá để gắn', 'No quote to attach'),
              message: t(
                'Khách chưa có báo giá nào lập ở Bán hàng mà chưa thuộc cơ hội.',
                'The customer has no quote from Sales that is not on an opportunity.',
              ),
            }),
      })
    }
    if (['quote-create', 'quote-edit'].includes(name)) {
      const editing = detail.quotes.find((q) => q.id === k.query.get('quote'))
      if (name === 'quote-edit' && (!editing || editing.state === 'accepted'))
        return missing(
          k,
          closeHref,
          t('Không sửa được báo giá', 'This quote cannot be edited'),
          t('Báo giá đã được khách chấp nhận hoặc không tồn tại.', 'It was accepted or does not exist.'),
        )
      const mine = k.owns(name)
      const fromDraft = mine
        ? Object.keys(k.draft)
            .filter((key) => /^product-\d+$/.test(key))
            .map((key) => {
              const i = key.split('-')[1]
              return Object.fromEntries(quoteLineKeys.map((part) => [part, k.draft[`${part}-${i}`]]))
            })
        : null
      const product = model.products[0]
      const initial = fromDraft?.length
        ? fromDraft
        : (editing?.lines.map((l) => Object.fromEntries(quoteLineKeys.map((part) => [part, l[part]]))) ?? [
            { product: product?.id ?? '', quantity: 1, price: product?.price ?? 0, discount: 0, tax: 8 },
          ])
      const key = `${name}:${editing ? `${editing.id}:${editing.version}` : r.id}:${k.query.get('error') ?? ''}`
      // A real quotation is checked against the order's own revision; the demo's counts from one.
      const extra = editing
        ? { quoteId: editing.id, quoteVersion: String(editing.revision ?? editing.version) }
        : {}
      const label = editing
        ? t(`Sửa báo giá ${editing.id}`, `Edit quote ${editing.id}`)
        : t('Tạo báo giá', 'Create quote')
      return sheet(k, {
        title: label,
        description,
        size: 'large',
        closeHref,
        body: k.command(
          name,
          editing ? t('Lưu phiên bản mới', 'Save new version') : t('Tạo báo giá nháp', 'Create draft quote'),
          [
            k.field('lines', t('Sản phẩm', 'Products'), '', {
              span: 'full',
              control: quoteEditor(k, key, initial, name),
            }),
            k.field('expires', t('Hiệu lực đến', 'Valid until'), editing?.expires ?? '', {
              type: 'date',
              required: true,
            }),
          ],
          r,
          extra,
          { cancelHref: closeHref },
        ),
      })
    }
    if (name === 'merge') {
      const candidates = detail.duplicates.filter(
          (d) => d.partnerId === r.partnerId && d.kind === r.kind && d.terminal === 'open',
        ),
        target = candidates.find((d) => d.id === k.query.get('target')) ?? candidates[0]
      if (!target)
        return missing(
          k,
          closeHref,
          t('Không có hồ sơ đích hợp lệ', 'No eligible target'),
          t(
            'Chỉ gộp khi cùng khách, cùng loại và cả hai còn mở. Nhu cầu khác nhau cần giữ riêng.',
            'Merge only the same customer and kind while both are open. Keep different needs separate.',
          ),
        )
      return ConfirmDialog({
        id: 'sales-merge-confirm',
        title: t('Gộp hồ sơ trùng', 'Merge duplicate records'),
        message: `${r.id} → ${target.id}. ${t(
          'Hồ sơ nguồn được lưu trữ; công việc, báo giá và lịch sử chuyển sang hồ sơ đích.',
          'The source is archived; its activities, quotes and history move to the target.',
        )}`,
        closeHref,
        closeLabel: t('Giữ riêng', 'Keep separate'),
        confirmLabel: t('Gộp hồ sơ', 'Merge records'),
        confirmForm: 'sales-merge',
        details: Stack({
          items: [
            k.table({
              label: t('So sánh hai hồ sơ', 'Compare the two records'),
              rows: [
                {
                  id: 'need',
                  field: t('Tiêu đề / nhu cầu', 'Title / need'),
                  source: `${r.name} · ${r.description || '—'}`,
                  target: `${target.name} · ${target.description || '—'}`,
                },
                {
                  id: 'owner',
                  field: t('Đội / phụ trách', 'Team / owner'),
                  source: `${k.teamName(r.teamId)} · ${k.owner(r.assignee)}`,
                  target: `${k.teamName(target.teamId)} · ${k.owner(target.assignee)}`,
                },
                {
                  id: 'contact',
                  field: t('Liên hệ (chọn bên dưới)', 'Contact (choose below)'),
                  source: `${r.contact} · ${r.phone || r.email}`,
                  target: `${target.contact} · ${target.phone || target.email}`,
                },
              ],
              columns: [
                { key: 'field', label: t('Trường', 'Field'), cell: (row) => row.field },
                {
                  key: 'source',
                  label: t('Nguồn · lưu trữ', 'Source · archived'),
                  cell: (row) => row.source,
                },
                { key: 'target', label: t('Đích · giữ lại', 'Target · kept'), cell: (row) => row.target },
              ],
            }),
            Text({
              children: t(
                'Giai đoạn, doanh thu, xác suất và ngày chốt của đích được giữ. Mọi hoạt động, báo giá, đơn, trao đổi và lịch sử của nguồn được chuyển sang đích.',
                'Target stage, revenue, probability and close date remain. All source activities, quotes, orders, messages and history move to the target.',
              ),
              variant: 'bodySm',
            }),
            k.command(
              'merge',
              t('Gộp hồ sơ', 'Merge records'),
              [
                k.field('targetId', t('Hồ sơ đích', 'Target'), target.id, { readOnly: true }),
                k.choose('keepContact', t('Giữ liên hệ của', 'Keep contact from'), 'target', [
                  { id: 'target', name: t('Hồ sơ đích', 'Target') },
                  { id: 'source', name: t('Hồ sơ nguồn', 'Source') },
                ]),
                k.check('sameNeed', t('Đã đối chiếu: cùng một nhu cầu', 'Reviewed: the same need'), false, {
                  span: 'full',
                }),
              ],
              r,
              { targetVersion: String(target.version) },
              { formOnly: true, id: 'sales-merge' },
            ),
          ],
        }),
      })
    }
    return null
  }

  /** Dialogs of a list or a settings page (import, bulk assignment, members, configuration). */
  const standaloneDialog = (k, closeHref) => {
    const name = k.query.get('dialog'),
      { t, model } = k
    if (!name || !model.can.admin) return null
    if (name === 'import') {
      const preview = model.dialog?.preview ?? null,
        original = preview?.input ?? {}
      const mapped = ['name', 'phone', 'email', 'contactName', 'source', 'externalId']
      return sheet(k, {
        title: t('Nhập hồ sơ', 'Import records'),
        description: t(
          'Xem trước trước khi ghi; chưa có gì được nhập.',
          'Preview first; nothing is written yet.',
        ),
        size: 'large',
        closeHref,
        body: Stack({
          items: [
            k.command(
              'import-preview',
              t('Xem trước', 'Preview'),
              [
                k.field(
                  'data',
                  t('CSV hoặc mảng JSON (tối đa 100 dòng)', 'CSV or JSON array (up to 100 rows)'),
                  original.data ?? 'name,phone,email,contactName\nNhu cầu mới,0900000100,,Khách demo',
                  { type: 'textarea', required: true, span: 'full' },
                ),
                k.choose('format', t('Định dạng', 'Format'), original.format ?? 'csv', [
                  { id: 'csv', name: 'CSV' },
                  { id: 'json', name: 'JSON' },
                ]),
                k.check(
                  'importConsent',
                  t('Nguồn có bằng chứng đồng ý liên hệ', 'The source has contact-consent evidence'),
                  k.checked(original.importConsent),
                ),
                {
                  name: 'mapping',
                  label: t('Ghép cột', 'Column mapping'),
                  type: 'text',
                  span: 'full',
                  open: !!preview,
                  fields: mapped.map((key) =>
                    preview
                      ? k.choose(`map-${key}`, key, original[`map-${key}`] ?? key, [
                          { id: key, name: key },
                          ...preview.headers.filter((h) => h !== key).map((id) => ({ id, name: id })),
                        ])
                      : k.field(`map-${key}`, key, original[`map-${key}`] ?? key),
                  ),
                },
              ],
              null,
              {},
              { variant: preview ? 'secondary' : 'primary' },
            ),
            preview
              ? Notice({
                  tone: preview.valid ? 'info' : 'danger',
                  title: preview.valid
                    ? t('Dữ liệu hợp lệ · chưa nhập', 'Valid data · not imported yet')
                    : t('Sửa lỗi trước khi nhập', 'Correct the errors before importing'),
                  message: t(
                    'Liên hệ trùng dùng chung khách hàng nhưng vẫn giữ nhu cầu riêng. Mã sự kiện nguồn đã có sẽ được bỏ qua.',
                    'Matching contacts share a customer while keeping separate needs. Known source event IDs are skipped.',
                  ),
                })
              : null,
            preview
              ? k.table({
                  label: t('Kết quả xem trước', 'Preview result'),
                  rows: preview.diagnostics,
                  columns: [
                    { key: 'id', label: t('Dòng', 'Row'), cell: (row) => row.id },
                    {
                      key: 'name',
                      label: t('Hồ sơ', 'Record'),
                      cell: (row) =>
                        k.lines(row.name || '—', [row.phone, row.email].filter(Boolean).join(' · ')),
                    },
                    { key: 'action', label: t('Tác động', 'Impact'), cell: (row) => row.action },
                    {
                      key: 'issues',
                      label: t('Lỗi', 'Issues'),
                      cell: (row) =>
                        row.issues?.length
                          ? k.lines(row.issues.join('; '), null)
                          : k.badge(t('Hợp lệ', 'Valid'), 'positive'),
                    },
                  ],
                })
              : null,
            preview?.valid
              ? k.command('import', t('Xác nhận nhập', 'Confirm import'), [], null, { previewId: preview.id })
              : null,
          ].filter(Boolean),
        }),
      })
    }
    if (name === 'bulk') {
      const selection = model.dialog?.selection ?? []
      if (!selection.length)
        return missing(
          k,
          closeHref,
          t('Chưa chọn hồ sơ', 'No records selected'),
          t(
            'Đánh dấu hồ sơ trong danh sách rồi chọn Phân công.',
            'Select records in the list, then choose Assign.',
          ),
        )
      return sheet(k, {
        title: t('Phân công hàng loạt', 'Bulk assignment'),
        description: t(`${selection.length} hồ sơ được chọn`, `${selection.length} records selected`),
        closeHref,
        body: Stack({
          items: [
            k.table({
              label: t('Hồ sơ được chọn', 'Selected records'),
              rows: selection,
              columns: [
                { key: 'name', label: t('Hồ sơ', 'Record'), cell: (row) => k.lines(row.name, row.id) },
                {
                  key: 'owner',
                  label: t('Đang phụ trách', 'Current owner'),
                  cell: (row) => k.owner(row.assignee),
                },
                {
                  key: 'impact',
                  label: t('Tác động', 'Impact'),
                  cell: (row) =>
                    row.terminal === 'open'
                      ? k.badge(t('Sẽ phân công', 'Will be assigned'), 'info')
                      : k.badge(t('Bỏ qua · đã đóng', 'Skipped · closed'), 'warning'),
                },
              ],
            }),
            k.command(
              'bulk-assign',
              t('Phân công', 'Assign'),
              [k.choose('assigneeUserId', t('Người nhận', 'Recipient'), model.actor.id, model.people)],
              null,
              { ids: selection.map((r) => r.id).join(','), revision: String(model.revision) },
              { cancelHref: closeHref },
            ),
          ],
        }),
      })
    }
    if (name === 'member') {
      const team = model.team
      if (!team) return null
      const member = team.members.find((m) => m.id === k.query.get('memberId'))
      const label = member ? t('Sửa thành viên', 'Edit member') : t('Thêm thành viên', 'Add member')
      return sheet(k, {
        title: label,
        description: team.name,
        size: 'small',
        closeHref,
        body: k.command(
          'member-save',
          t('Lưu thành viên', 'Save member'),
          [
            k.choose('userId', t('Người dùng', 'User'), member?.userId ?? '', model.people, {
              required: true,
            }),
            k.field('capacity', t('Trọng số nhận việc', 'Assignment weight'), String(member?.capacity ?? 1), {
              type: 'number',
              min: 0,
              required: true,
              help: t(
                'Người có trọng số cao nhận nhiều hồ sơ hơn khi phân theo sức chứa.',
                'Higher weights receive more records under capacity assignment.',
              ),
            }),
            k.field('sequence', t('Thứ tự xoay vòng', 'Rotation order'), String(member?.sequence ?? 10), {
              type: 'number',
            }),
            k.check('active', t('Đang nhận hồ sơ', 'Receiving records'), member?.active ?? true),
          ],
          null,
          { teamId: team.id, memberId: member?.id ?? '', memberVersion: String(member?.version ?? 1) },
          { cancelHref: closeHref },
        ),
      })
    }
    if (name === 'config') {
      const group = k.query.get('group'),
        groups = model.settings?.groups ?? {}
      if (!Object.hasOwn(groups, group)) return null
      const row = groups[group].find((x) => x.id === k.query.get('configId'))
      const titles = {
        teams: t('đội', 'team'),
        assignmentRules: t('quy tắc phân công', 'assignment rule'),
        stages: t('giai đoạn', 'stage'),
        lostReasons: t('lý do thất bại', 'loss reason'),
        tags: t('nhãn', 'tag'),
        scoreRules: t('quy tắc chấm điểm', 'scoring rule'),
      }
      const fields = [
        k.field('name', t('Tên', 'Name'), row?.name ?? '', { required: true }),
        k.check('active', t('Đang dùng', 'In use'), row?.active ?? true),
      ]
      if (['teams', 'stages'].includes(group))
        fields.push(k.field('code', t('Mã', 'Code'), row?.code ?? '', { required: true }))
      if (group === 'teams')
        fields.push(
          k.choose('leaderUserId', t('Trưởng nhóm', 'Leader'), row?.leaderUserId ?? '', model.people),
          k.choose(
            'assignmentMode',
            t('Cách phân công', 'Assignment'),
            row?.assignmentMode ?? 'manual',
            Object.entries(k.words.assignmentMode).map(([id, label]) => ({ id, name: label })),
          ),
        )
      if (group === 'stages')
        fields.push(
          k.field('sequence', t('Thứ tự', 'Sequence'), String(row?.sequence ?? 10), { type: 'number' }),
          k.field(
            'probability',
            t('Xác suất mặc định (%)', 'Default probability (%)'),
            String(row?.probability ?? ''),
            {
              type: 'number',
              min: 0,
              max: 100,
            },
          ),
          k.field(
            'staleDays',
            t('Cảnh báo đứng yên sau (ngày)', 'Idle warning after (days)'),
            String(row?.staleDays || ''),
            {
              type: 'number',
              min: 0,
            },
          ),
          k.choose(
            'terminalState',
            t('Loại giai đoạn', 'Stage type'),
            row?.terminalState ?? 'open',
            ['open', 'won', 'lost'].map((id) => ({ id, name: k.words.terminal[id] })),
          ),
          k.choose(
            'allowedKinds',
            t('Nhận loại hồ sơ', 'Accepts'),
            row?.allowedKinds?.length === 1 ? row.allowedKinds[0] : 'both',
            [
              { id: 'lead', name: t('Chỉ lead', 'Leads only') },
              { id: 'both', name: t('Lead & cơ hội', 'Leads & opportunities') },
              { id: 'opportunity', name: t('Chỉ cơ hội', 'Opportunities only') },
            ],
          ),
          k.choose('teamId', t('Giới hạn đội', 'Team restriction'), row?.teamId ?? '', [
            { id: '', name: t('Mọi đội', 'Any team') },
            ...model.teams,
          ]),
          k.check('fold', t('Thu gọn trên pipeline', 'Folded on the pipeline'), row?.fold ?? false),
        )
      if (group === 'lostReasons')
        fields.push(
          k.field('sequence', t('Thứ tự', 'Sequence'), String(row?.sequence ?? 10), { type: 'number' }),
          k.check('requiresNote', t('Bắt buộc ghi chú', 'Requires a note'), row?.requiresNote ?? false),
        )
      if (group === 'scoreRules')
        fields.push(
          k.choose('field', t('Trường', 'Field'), row?.field ?? 'email', [
            { id: 'email', name: 'Email' },
            { id: 'utmSource', name: t('Nguồn', 'Source') },
            { id: 'expectedRevenue', name: t('Doanh thu dự kiến', 'Expected revenue') },
          ]),
          k.choose('operator', t('Điều kiện', 'Condition'), row?.operator ?? 'present', [
            { id: 'present', name: t('Có giá trị', 'Is present') },
            { id: 'eq', name: t('Bằng', 'Equals') },
            { id: 'contains', name: t('Chứa', 'Contains') },
            { id: 'gte', name: t('Lớn hơn hoặc bằng', 'At least') },
          ]),
          k.field('value', t('Giá trị so sánh', 'Compared value'), row?.value ?? ''),
          k.field('points', t('Điểm', 'Points'), String(row?.points ?? 0), { type: 'number' }),
        )
      if (group === 'assignmentRules')
        fields.push(
          k.field('priority', t('Ưu tiên', 'Priority'), String(row?.priority ?? 10), {
            type: 'number',
            help: t('Số nhỏ được xét trước.', 'Lower numbers are evaluated first.'),
          }),
          k.choose('teamId', t('Giao cho đội', 'Team'), row?.teamId ?? model.teams[0]?.id ?? '', model.teams),
          k.field('utmSource', t('Khi nguồn là', 'When the source is'), row?.utmSource ?? ''),
          k.field('minimumScore', t('Điểm tối thiểu', 'Minimum score'), String(row?.minimumScore ?? ''), {
            type: 'number',
          }),
          k.choose('assigneeUserId', t('Người nhận', 'Recipient'), row?.assigneeUserId ?? '', [
            { id: '', name: t('Theo cách phân công của đội', "By the team's assignment") },
            ...model.people,
          ]),
        )
      return sheet(k, {
        title: row
          ? t(`Sửa ${titles[group]}`, `Edit ${titles[group]}`)
          : t(`Thêm ${titles[group]}`, `Add ${titles[group]}`),
        description: row?.name ?? null,
        closeHref,
        body: k.command(
          'config-save',
          t('Lưu', 'Save'),
          fields,
          null,
          { group, configId: row?.id ?? '', configVersion: String(row?.version ?? 1) },
          { cancelHref: closeHref },
        ),
      })
    }
    if (name === 'quote-policy') {
      const policy = model.settings?.quotationPolicy
      if (!policy) return null
      return sheet(k, {
        title: t('Báo giá từ Bán hàng', 'Quotes from Sales'),
        closeHref,
        body: k.command(
          'quote-policy',
          t('Lưu', 'Save'),
          [
            k.choose(
              'saleQuotations',
              t('Cơ hội giữ', 'An opportunity holds'),
              policy.saleQuotations,
              ['off', 'attach'].map((id) => ({ id, name: k.words.quotePolicy[id] })),
              {
                span: 'full',
                help: t(
                  'Cho gắn: người bán gắn báo giá của cùng khách lập ở Bán hàng vào cơ hội; doanh thu tính theo cơ hội đó.',
                  "Attach: a salesperson attaches the customer's quotes from Sales to the opportunity; their revenue counts there.",
                ),
              },
            ),
          ],
          null,
          { configVersion: String(policy.version) },
          { cancelHref: closeHref },
        ),
      })
    }
    return null
  }

  return { caseDialog, standaloneDialog, quoteEditor }
}
