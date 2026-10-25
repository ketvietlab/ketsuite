type Words = readonly [string, string]
type Step = readonly [id: string, words: Words, tone?: 'decision' | 'positive' | 'warning' | 'danger']
type Edge = readonly [string, string, Words?]
type Workflow = { steps: readonly Step[]; edges: readonly Edge[] }
const yes: Words = ['Có', 'Yes'],
  no: Words = ['Không', 'No']
const flows: Record<string, Workflow> = {
  plan: {
    steps: [
      ['A', ['Bấm thanh lượt ở trên lịch', 'Select a stay bar on the plan']],
      ['B', ['Xem nhanh: ngày, phòng, bảo đảm, còn phải thu', 'Preview: dates, room, guarantee, balance']],
      ['C', ['Cần xử lý ngay?', 'Needs action now?'], 'decision'],
      ['D', ['Mở bước<br>cần làm', 'Open the<br>next step'], 'positive'],
      ['E', ['Đóng<br>xem nhanh', 'Close the<br>preview']],
    ],
    edges: [
      ['A', 'B'],
      ['B', 'C'],
      ['C', 'D', yes],
      ['C', 'E', no],
    ],
  },
  book: {
    steps: [
      ['A', ['Chọn cơ sở và khoảng ngày', 'Choose property and dates']],
      [
        'B',
        [
          'Lọc trạng thái hoặc gõ<br>mã, tên khách, số phòng',
          'Filter a status or type<br>code, guest, room number',
        ],
      ],
      ['C', ['Thấy đặt phòng<br>cần tìm?', 'Found the<br>booking?'], 'decision'],
      ['D', ['Mở đặt phòng;<br>Back về đúng dòng', 'Open it; Back<br>returns to its row'], 'positive'],
      [
        'E',
        ['Gõ đủ tên, tìm mọi ngày<br>hoặc xóa bộ lọc', 'Type more, search all<br>dates or clear filters'],
        'warning',
      ],
    ],
    edges: [
      ['A', 'B'],
      ['B', 'C'],
      ['C', 'D', yes],
      ['C', 'E', no],
      ['E', 'B'],
    ],
  },
  house: {
    steps: [
      [
        'A',
        [
          'Chọn cơ sở; lọc trả hôm nay,<br>ngày mai hoặc khách VIP',
          'Choose a property; filter departing<br>today, tomorrow or VIP guests',
        ],
      ],
      [
        'B',
        ['Gõ tên khách, số phòng<br>hoặc mã, không cần dấu', 'Type guest, room<br>or code; accents optional'],
      ],
      ['C', ['Thấy khách<br>cần tìm?', 'Found the<br>guest?'], 'decision'],
      [
        'D',
        [
          'Mở đặt phòng để<br>trả, đổi phòng,<br>thu tiền; Back<br>về đúng dòng',
          'Open the booking<br>to check out or<br>move; Back goes<br>to its row',
        ],
        'positive',
      ],
      [
        'E',
        [
          'Xóa bộ lọc;<br>chưa đủ thì<br>chọn một cơ sở',
          'Clear filters;<br>if incomplete,<br>pick a property',
        ],
        'warning',
      ],
    ],
    edges: [
      ['A', 'B'],
      ['B', 'C'],
      ['C', 'D', yes],
      ['C', 'E', no],
      ['E', 'B'],
    ],
  },
  booking: {
    steps: [
      ['A', ['Chọn ngày và số khách', 'Choose dates and guests']],
      ['B', ['Chọn phòng và bảng giá', 'Choose room and rate']],
      ['C', ['Nhập khách và bảo đảm', 'Enter guest and guarantee']],
      ['D', ['Giá, tồn và điều kiện còn hợp lệ?', 'Price, inventory and terms valid?'], 'decision'],
      ['E', ['Xác nhận đặt phòng', 'Confirm reservation'], 'positive'],
      ['F', ['Sửa thông tin hoặc lấy báo giá mới', 'Correct details or quote again'], 'warning'],
    ],
    edges: [
      ['A', 'B'],
      ['B', 'C'],
      ['C', 'D'],
      ['D', 'E', yes],
      ['D', 'F', no],
    ],
  },
  arrival: {
    steps: [
      ['A', ['Mở đặt phòng', 'Open reservation']],
      ['B', ['Đủ bảo đảm, giấy tờ và phòng sạch?', 'Guarantee, documents and clean room ready?'], 'decision'],
      ['C', ['Ghi nhận nhận phòng', 'Record check-in'], 'positive'],
      ['D', ['Bổ sung điều kiện còn thiếu', 'Complete missing prerequisites'], 'warning'],
    ],
    edges: [
      ['A', 'B'],
      ['B', 'C', yes],
      ['B', 'D', no],
    ],
  },
  stay: {
    steps: [
      ['A', ['Chọn khách đang ở', 'Choose in-house stay']],
      ['B', ['Chọn thêm khách hoặc chuyển phòng', 'Choose add guest or move room']],
      ['C', ['Đủ chỗ và điều kiện phòng?', 'Capacity and room conditions satisfied?'], 'decision'],
      ['D', ['Xác nhận thay đổi', 'Confirm change'], 'positive'],
      [
        'E',
        ['Chọn phòng phù hợp hoặc bổ sung điều kiện', 'Choose a suitable room or complete prerequisites'],
        'warning',
      ],
    ],
    edges: [
      ['A', 'B'],
      ['B', 'C'],
      ['C', 'D', yes],
      ['C', 'E', no],
    ],
  },
  register: {
    steps: [
      [
        'A',
        [
          'Chọn cơ sở; lọc phiếu<br>đang mở hoặc đã đóng',
          'Choose a property; filter<br>open or closed folios',
        ],
      ],
      ['B', ['Gõ mã phiếu, mã đặt<br>phòng, khách, số phòng', 'Type folio or booking<br>code, guest, room']],
      ['C', ['Thấy phiếu<br>cần tìm?', 'Found the<br>folio?'], 'decision'],
      [
        'D',
        ['Mở phiếu: ghi<br>phí, hóa đơn,<br>thu tiền', 'Open it:<br>charge, bill,<br>collect'],
        'positive',
      ],
      ['E', ['Gõ đủ tên<br>hoặc xóa lọc', 'Type more or<br>clear filters'], 'warning'],
    ],
    edges: [
      ['A', 'B'],
      ['B', 'C'],
      ['C', 'D', yes],
      ['C', 'E', no],
      ['E', 'B'],
    ],
  },
  billing: {
    steps: [
      ['A', ['Chọn cơ sở và kỳ', 'Choose property<br>and period']],
      ['B', ['Chọn facet hoặc tìm<br>mã, hóa đơn, khách', 'Pick a facet or search<br>code, invoice, guest']],
      ['C', ['Còn việc<br>cần làm?', 'Work left<br>to do?'], 'decision'],
      [
        'D',
        ['Bấm Cần làm:<br>quy tắc, hóa đơn,<br>thu tiền', 'Use Next step:<br>rule, invoice,<br>payment'],
        'positive',
      ],
      ['E', ['Đã thu đủ:<br>xem phiếu', 'Paid in full:<br>view folio']],
    ],
    edges: [
      ['A', 'B'],
      ['B', 'C'],
      ['C', 'D', yes],
      ['C', 'E', no],
      ['D', 'B'],
    ],
  },
  folio: {
    steps: [
      ['A', ['Đối chiếu phí và chứng từ', 'Reconcile charges and documents']],
      ['B', ['Đủ quy tắc và thông tin người nhận?', 'Rules and recipient details complete?'], 'decision'],
      ['C', ['Lập chứng từ rồi ghi nhận tiền', 'Issue invoice then record payment']],
      ['D', ['Còn số tiền phải thu?', 'Any balance outstanding?'], 'decision'],
      ['E', ['Tiếp tục thu và đối chiếu', 'Continue collection and reconciliation'], 'warning'],
      ['F', ['Hoàn tất bước tài chính', 'Financial step complete'], 'positive'],
      ['G', ['Bổ sung dữ liệu còn thiếu', 'Complete missing data'], 'warning'],
    ],
    edges: [
      ['A', 'B'],
      ['B', 'C', yes],
      ['B', 'G', no],
      ['C', 'D'],
      ['D', 'E', yes],
      ['D', 'F', no],
    ],
  },
  // Billing rules (HOS-DEC-034): a rule answers the tax question one way.
  rules: {
    steps: [
      ['A', ['Mở loại phí<br>cần thiết lập', 'Open a type<br>that needs setup']],
      ['B', ['Chọn tài khoản<br>doanh thu (tùy chọn)', 'Pick an income<br>account (optional)']],
      ['C', ['Loại phí<br>chịu thuế?', 'Is the charge<br>taxed?'], 'decision'],
      ['D', ['Chọn thuế bán ra<br>đã duyệt', 'Choose an approved<br>sale tax']],
      ['E', ['Ghi lý do<br>không tính thuế', 'Write the reason<br>for no tax']],
      ['F', ['Lưu: Đã thiết lập', 'Save: set up'], 'positive'],
    ],
    edges: [
      ['A', 'B'],
      ['B', 'C'],
      ['C', 'D', yes],
      ['C', 'E', no],
      ['D', 'F'],
      ['E', 'F'],
    ],
  },
  catalogue: {
    steps: [
      ['A', ['Chọn cơ sở và bản ghi', 'Choose property and record']],
      ['B', ['Sửa cấu hình', 'Edit configuration']],
      ['C', ['Dữ liệu và phiên bản hợp lệ?', 'Values and version valid?'], 'decision'],
      ['D', ['Lưu thay đổi', 'Save changes'], 'positive'],
      ['E', ['Xem lỗi cần sửa', 'Review errors'], 'warning'],
    ],
    edges: [
      ['A', 'B'],
      ['B', 'C'],
      ['C', 'D', yes],
      ['C', 'E', no],
    ],
  },
  housekeeping: {
    steps: [
      ['A', ['Mở công việc được giao', 'Open assigned task']],
      ['B', ['Khách cho phép dọn?', 'Guest permits cleaning?'], 'decision'],
      ['C', ['Bắt đầu rồi hoàn tất công việc', 'Start then complete task'], 'positive'],
      ['D', ['Ghi nhận khách từ chối khi đủ điều kiện', 'Record guest refusal when eligible'], 'warning'],
    ],
    edges: [
      ['A', 'B'],
      ['B', 'C', yes],
      ['B', 'D', no],
    ],
  },
  rooms: {
    steps: [
      ['A', ['Lọc và chọn phòng', 'Filter and choose room']],
      ['B', ['Xem khách, lượt ở và công việc', 'Inspect stay and open tasks']],
      ['C', ['Thao tác có được phép?', 'Action permitted?'], 'decision'],
      ['D', ['Ghi nhận thay đổi trạng thái', 'Record state change'], 'positive'],
      ['E', ['Giải quyết lượt ở hoặc công việc đang mở', 'Resolve the stay or open tasks'], 'warning'],
    ],
    edges: [
      ['A', 'B'],
      ['B', 'C'],
      ['C', 'D', yes],
      ['C', 'E', no],
    ],
  },
  audit: {
    steps: [
      ['A', ['Xem ngày kinh doanh', 'Review business date']],
      ['B', ['Đã đến 23:00 và hết mục chặn?', 'After 23:00 and no blockers?'], 'decision'],
      ['C', ['Yêu cầu chốt ngày', 'Request day close']],
      ['D', ['Theo dõi kết quả xử lý', 'Follow processing outcome'], 'positive'],
      ['E', ['Xử lý mục chặn hoặc chờ giờ chốt', 'Resolve blockers or wait for closing time'], 'warning'],
    ],
    edges: [
      ['A', 'B'],
      ['B', 'C', yes],
      ['B', 'E', no],
      ['C', 'D'],
    ],
  },
  inventory: {
    steps: [
      ['A', ['Chọn loại phòng, ngày và thứ', 'Choose room type, dates and weekdays']],
      ['B', ['Nhập phần cần thay đổi', 'Enter only changed values']],
      ['C', ['Tất cả ngày đều hợp lệ?', 'Every selected date valid?'], 'decision'],
      ['D', ['Lưu toàn bộ thay đổi', 'Save all changes'], 'positive'],
      ['E', ['Không lưu; sửa điều kiện báo lỗi', 'Nothing saved; correct the refused condition'], 'warning'],
    ],
    edges: [
      ['A', 'B'],
      ['B', 'C'],
      ['C', 'D', yes],
      ['C', 'E', no],
    ],
  },
  stock: {
    steps: [
      ['A', ['Chuẩn bị và duyệt yêu cầu', 'Prepare and approve request']],
      ['B', ['Gửi sang hệ thống kho', 'Send to stock authority']],
      ['C', ['Đã biết kết quả?', 'Outcome known?'], 'decision'],
      ['D', ['Đối chiếu kết quả và phí', 'Reconcile outcome and charge'], 'positive'],
      ['E', ['Kiểm tra lại kết quả; chưa gửi lại', 'Query outcome before any retry'], 'warning'],
    ],
    edges: [
      ['A', 'B'],
      ['B', 'C'],
      ['C', 'D', yes],
      ['C', 'E', no],
    ],
  },
  ota: {
    steps: [
      ['A', ['Mở lần gửi hoặc đặt phòng OTA', 'Open OTA delivery or booking']],
      ['B', ['Xem trạng thái và bằng chứng', 'Review state and evidence']],
      ['C', ['Đã xác định kết quả?', 'Outcome confirmed?'], 'decision'],
      ['D', ['Xử lý bước được cho phép', 'Perform the permitted next step'], 'positive'],
      ['E', ['Kiểm tra lại trước khi gửi lại', 'Reconcile before retrying'], 'warning'],
    ],
    edges: [
      ['A', 'B'],
      ['B', 'C'],
      ['C', 'D', yes],
      ['C', 'E', no],
    ],
  },
  content: {
    steps: [
      ['A', ['Chọn cơ sở hoặc loại phòng', 'Choose property or room type']],
      ['B', ['Ảnh và nội dung hợp lệ?', 'Images and content valid?'], 'decision'],
      ['C', ['Lưu ảnh hoặc bản dịch', 'Save image or translation']],
      ['D', ['Kiểm tra kết quả gửi kênh riêng', 'Check channel delivery separately'], 'warning'],
      ['E', ['Sửa định dạng hoặc nội dung', 'Correct format or content'], 'warning'],
    ],
    edges: [
      ['A', 'B'],
      ['B', 'C', yes],
      ['B', 'E', no],
      ['C', 'D'],
    ],
  },
  notices: {
    steps: [
      ['A', ['Kiểm tra khách và giấy tờ', 'Check guest and identity documents']],
      ['B', ['Đủ dữ liệu gửi?', 'Ready to submit?'], 'decision'],
      ['C', ['Ghi nhận lần gửi thực tế', 'Record actual submission']],
      ['D', ['Nhập xác nhận khi được tiếp nhận', 'Record receipt after acceptance'], 'positive'],
      ['E', ['Bổ sung hồ sơ khách', 'Complete guest details'], 'warning'],
    ],
    edges: [
      ['A', 'B'],
      ['B', 'C', yes],
      ['B', 'E', no],
      ['C', 'D'],
    ],
  },
}
const families: Record<string, string> = {
  properties: 'catalogue',
  catalogue: 'catalogue',
  policies: 'catalogue',
  'rate-plans': 'catalogue',
  'billing/rules': 'rules',
  'settings/stock': 'catalogue',
  'ota/connections': 'catalogue',
  'reservations/new': 'booking',
  reservations: 'arrival',
  'reservation-book': 'book',
  'in-house': 'house',
  'folio-register': 'register',
  desk: 'arrival',
  'tape-chart': 'plan',
  stays: 'stay',
  folios: 'folio',
  billing: 'billing',
  housekeeping: 'housekeeping',
  'housekeeping/rooms': 'rooms',
  'night-audit': 'audit',
  inventory: 'inventory',
  'product-fulfillments': 'stock',
  services: 'catalogue',
  'ota/operations': 'ota',
  'ota/bookings': 'ota',
  'ota/content': 'ota',
  content: 'content',
  'stay-notices': 'notices',
}

/** The shared renderer owns colour, fitting, expanded view and accessible fallback. */
export function hospitalityHelpWorkflow(key: string, locale: string): string {
  const flow = flows[families[key] ?? '']
  if (!flow) return ''
  const language = locale === 'en' ? 1 : 0
  const nodes = flow.steps.map(([id, words, tone]) => {
    const label = JSON.stringify(words[language])
    return ` ${id}${tone === 'decision' ? `(${label})` : `[${label}]`}${tone ? `:::kv-${tone}` : ''}`
  })
  const edges = flow.edges.map(
    ([from, to, label]) => ` ${from} -->${label ? `|${label[language]}|` : ''} ${to}`,
  )
  return [
    '```mermaid',
    '%% File: hospitality_core/screens/help-workflows.ts',
    'flowchart TD',
    ...nodes,
    ...edges,
    '```',
  ].join('\n')
}
