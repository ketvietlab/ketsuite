// @ts-nocheck Shared by the server render and the browser; its tests exercise it.
import { salesTitles } from './kit.mjs'

// Screen titles live with the island that draws them; the shell names the document with the same words.
export { salesTitles }

// Each screen's guide: [heading, body] pairs, Vietnamese then English, and optionally a Mermaid
// flowchart of the workflow the section explains (the DS theme classes colour its outcomes). They
// describe what the screen does today; a behaviour change updates its guide in the same change.
const guides = {
  overview: [
    [
      ['Đọc chỉ số', 'Read the metrics'],
      [
        'Chọn kỳ (tháng này, quý này, tháng trước), đội và người phụ trách; mọi số liệu so với kỳ liền trước. Tỷ lệ thắng tính trên hồ sơ đóng trong kỳ: thắng ÷ (thắng + thua). Pipeline có trọng số = giá trị × xác suất của giai đoạn, không phải tiền đã thu. Bấm một chỉ số để mở danh sách hồ sơ tạo nên nó.',
        "Choose a period (this month, this quarter, last month), a team and an owner; every figure compares with the period before. Win rate counts records closed in the period: won ÷ (won + lost). Weighted pipeline = value × the stage's probability, not money received. Select a metric to open the records behind it.",
      ],
    ],
    [
      ['Dự báo và rủi ro', 'Forecast and risk'],
      [
        'Dự báo 4 tháng xếp chồng doanh số đã thắng, phần có trọng số và phần còn lại của cơ hội mở theo tháng chốt dự kiến. Cơ hội trễ hoặc chưa có ngày chốt được đếm riêng bên dưới. Bảng rủi ro liệt kê cơ hội mở đang có cảnh báo; bấm một dòng để mở hồ sơ.',
        'The 4-month forecast stacks won revenue, the weighted part and the rest of open deals by expected close month. Late or undated deals are counted separately below it. The risk table lists open deals with warnings; select a row to open the record.',
      ],
    ],
  ],
  pipeline: [
    [
      ['Làm việc với board', 'Work with the board'],
      [
        'Các cột là giai đoạn theo đúng thứ tự quy trình, từ trái sang phải; cuộn ngang để xem hết. Mỗi cột ghi tổng giá trị và phần có trọng số. Thắng và thua là hai cột gấp ở cuối, dẫn sang danh sách hồ sơ đã đóng. Tìm theo tên, mã, khách hoặc điện thoại; lọc theo người phụ trách và đội.',
        'Columns are the stages in process order, left to right; scroll sideways to see them all. Each column shows its total value and weighted value. Won and lost are folded columns at the end that lead to the closed records. Search by title, ID, customer or phone; filter by owner and team.',
      ],
    ],
    [
      ['Xem nhanh và chuyển giai đoạn', 'Peek and move'],
      [
        'Bấm vào thẻ để xem nhanh hồ sơ bên cạnh board mà không rời trang; nút mở rộng dẫn tới hồ sơ đầy đủ. Từ ô xem nhanh có thể chốt kết quả, ghi tương tác, lên lịch hoặc chuyển giai đoạn. Kéo thẻ sang cột khác cũng chuyển giai đoạn: chỉ cột nhận đúng loại hồ sơ và đội mới sáng lên. Chốt thắng/thua luôn là thao tác riêng có lý do.',
        'Select a card to peek at the record beside the board without leaving it; the expand button opens the full record. From the peek you can close the outcome, log an interaction, schedule work or move the stage. Dragging a card to another column also moves it: only columns that accept its kind and team light up. Closing as won or lost is always a separate action with a reason.',
      ],
      [
        `flowchart TD
  A[Thẻ ở một giai đoạn] -->|Kéo thẻ hoặc Chuyển giai đoạn| B[Giai đoạn kế tiếp]
  B -->|Chốt kết quả, ở bất kỳ giai đoạn nào| C{Kết quả}
  C -->|Thắng| D[Thành công]
  C -->|Thua| E[Thất bại, có lý do]
  D & E -.-> R[Quản lý mở lại, có lý do]
  class D kv-positive
  class E kv-danger`,
        `flowchart TD
  A[Card in a stage] -->|Drag the card or Move stage| B[Next stage]
  B -->|Close the outcome, from any stage| C{Outcome}
  C -->|Won| D[Won]
  C -->|Lost| E[Lost, with a reason]
  D & E -.-> R[A manager reopens, with a reason]
  class D kv-positive
  class E kv-danger`,
      ],
    ],
  ],
  cases: [
    [
      ['Tìm và lọc hồ sơ', 'Find and filter records'],
      [
        'Các view (Tất cả, Đang mở, Của tôi, Cần chú ý, Chốt tháng này, Thành công, Thất bại) có số đếm sẵn. Gõ là lọc ngay; bộ lọc loại, người phụ trách, đội, giai đoạn, nguồn, cảnh báo và các kỳ áp dụng khi chọn. Sắp xếp bằng tiêu đề cột. Bấm một dòng để mở hồ sơ; quay lại thì dòng đó được đánh dấu. Địa chỉ trang giữ toàn bộ bộ lọc, có thể lưu để dùng lại.',
        'Views (All, Open, Mine, Needs attention, Closing this month, Won, Lost) show their counts. Typing filters at once; kind, owner, team, stage, source, warning and period filters apply when chosen. Sort with the column headers. Select a row to open the record; coming back marks that row. The page address keeps every filter and can be saved for reuse.',
      ],
    ],
    [
      ['Phân công và dữ liệu', 'Assignment and data'],
      [
        'Quản lý chọn nhiều dòng trên trang rồi Xem trước phân công; hồ sơ đã đóng hoặc người nhận ngoài đội bị bỏ qua với kết quả từng dòng. Quản lý có menu Dữ liệu: nhập CSV/JSON (tối đa 100 dòng) có ghép cột, xem trước lỗi, khách trùng và sự kiện nguồn đã có rồi mới xác nhận; dữ liệu đổi sau khi xem trước thì phải xem trước lại. Tiếp nhận lead từ nguồn đã kết nối, như form website. Xuất JSON toàn bộ kết quả đang lọc trong phạm vi quyền; người khác có nút Xuất JSON.',
        'Managers select rows on the page and choose Review assignment; closed records or recipients outside the team are skipped with a per-row outcome. Managers have a Data menu: import CSV/JSON (up to 100 rows) with column mapping, previewing errors, matching customers and source events already received before confirming; if the data changes after the preview, preview again. Lead intake takes events from connected sources such as the website form. Export JSON holds every filtered result within your access; others have an Export JSON button.',
      ],
    ],
  ],
  'lead-new': [
    [
      ['Tạo hoặc tiếp nhận lead', 'Create or receive a lead'],
      [
        'Cần tiêu đề và điện thoại hoặc email. Khi gõ điện thoại hoặc email, khách trùng hiện ngay phía trên form. Chọn khách có sẵn để dùng lại định danh; nhu cầu mới vẫn là hồ sơ riêng. Mở từ nút Tạo lead trên trang khách hàng thì form điền sẵn khách đó và liên hệ của họ. Nguồn và UTM (nguồn, kênh, chiến dịch) đi theo hồ sơ vào báo cáo nguồn. Hồ sơ tiếp nhận từ nguồn đã kết nối, như form website, chống trùng bằng mã sự kiện nguồn. Ghi nhận đồng ý liên hệ trước khi gửi email.',
        'A title and a phone or email are required. As you type a phone or email, matching customers appear above the form. Select an existing customer to reuse its identity; a new need is still a separate record. Opened from Create lead on a customer’s page, the form starts with that customer and their contact. Source and UTM (source, medium, campaign) travel with the record into the source report. Intake from connected sources, such as the website form, deduplicates by the source event ID. Record contact consent before sending email.',
      ],
    ],
  ],
  'lead-detail': [
    [
      ['Theo dõi hồ sơ đến kết quả', 'Take a record to its outcome'],
      [
        'Dưới tiêu đề là đường giai đoạn: bước có dấu ✓ là đã qua, bước tô đậm là giai đoạn hiện tại, bước xám là chưa tới; bấm một bước để chuyển hồ sơ sang đó. Hồ sơ đã chốt giữ ✓ đến giai đoạn trước lúc chốt, bước cuối hiện Thành công (xanh) hoặc Thất bại (đỏ). Trên điện thoại chỉ bước hiện tại hiện tên, các bước khác thu thành ✓ hoặc số thứ tự. Tab Hoạt động gồm việc cần làm (bấm một dòng để hoàn tất, dời hoặc hủy), ghi chú nội bộ, phần các ứng dụng khác của công ty thêm vào (chẳng hạn các cuộc gọi với khách) và lịch sử; email gửi lỗi có lệnh thử lại. Tab Thông tin lưu chi tiết, mức ưu tiên, nhãn và dự báo (doanh thu, xác suất, ngày chốt). Tab Báo giá & đơn tạo/sửa báo giá nhiều sản phẩm; gửi rồi chấp nhận để tạo đơn chưa thanh toán. Cột phải mở đầu bằng Bước tiếp theo (việc mở sớm nhất, có nút Hoàn tất; chưa có thì nhắc lên lịch), rồi khách hàng, người phụ trách và quy tắc phân công, cách tính điểm và hồ sơ trùng.',
        'Below the title, the stage path marks passed steps with ✓, fills the current stage and greys the steps ahead; select a step to move the record there. A closed record keeps ✓ up to the stage it closed from, and its last step shows Won (green) or Lost (red). On a phone only the current step shows its name; the others fold to ✓ or their number. The Activity tab holds open activities (select a row to complete, reschedule or cancel it), internal notes, what other applications of the company add (the calls with the customer, say) and history; failed email can be retried. The Details tab saves details, priority, tags and the forecast (revenue, probability, close date). The Quotes & orders tab creates and edits multi-product quotes; send one, then accept it to create an unpaid order. The right column starts with the next step (the earliest open activity, with Complete; without one it asks you to schedule), then the customer, the owner and assignment rule, how the score is made and duplicates.',
      ],
    ],
    [
      ['Gửi báo giá cho khách', 'Send a quote to the customer'],
      [
        'Gửi báo giá mở hộp thoại chọn kênh. Email gửi thật từ địa chỉ của công ty và nằm trong lịch sử hồ sơ cùng trạng thái giao (gửi lỗi thì thử lại); Zalo là bạn tự gửi qua Zalo rồi ghi nhận ở đây; Trao tận tay chỉ ghi nhận, không liên hệ khách. Email và Zalo cần hồ sơ lẫn khách hàng đã đồng ý liên hệ, người nhận đúng định dạng (email, hoặc số điện thoại 8–15 chữ số) và báo giá còn hạn; màn Bán hàng dùng cùng luật đó. Lần gửi làm ở màn Bán hàng, đơn được xác nhận, đang giao, đã giao hay bị huỷ cũng hiện trong lịch sử hồ sơ. Khi công ty cho phép, Gắn báo giá có sẵn lấy báo giá của cùng khách lập ở Bán hàng và chưa thuộc cơ hội nào.',
        'Send quote opens a dialog to choose the channel. Email is sent from the company address and stays in the record history with its delivery state (retry a failed one); with Zalo you send it from your Zalo, then record it here; Handed over only records it and contacts nobody. Email and Zalo need both the record and the customer to have agreed to be contacted, a recipient that fits (an email, or a phone number of 8 to 15 digits) and a quote still valid; the Sales screens apply the same rule. A sending made in Sales, and the order being confirmed, shipping, delivered or cancelled, also show in the record history. When the company allows it, Attach an existing quote takes a quote of the same customer written in Sales and not yet on any opportunity.',
      ],
    ],
    [
      ['Gộp, chốt và mở lại', 'Merge, close and reopen'],
      [
        'Gộp cần cùng khách, cùng loại và xác nhận cùng nhu cầu; hồ sơ đã đóng giữ riêng. Chốt thua cần lý do, có lý do yêu cầu ghi chú. Quản lý mở lại hồ sơ đã đóng với lý do lưu trong lịch sử. Vòng đời: lead → chuyển đổi thành cơ hội → báo giá → chấp nhận thành đơn chưa thanh toán; cơ hội chốt thắng hoặc thua.',
        'Merging requires the same customer and kind, with acknowledgement of the same need; closed records stay separate. Closing as lost needs a reason, and some reasons need a note. Managers reopen closed records with a reason kept in history. Lifecycle: a lead converts into a deal → quote → accepted into an unpaid order; a deal closes as won or lost.',
      ],
      [
        `flowchart TD
  A[Lead] -->|Chuyển đổi| B[Cơ hội]
  B --> C[Báo giá]
  C -->|Khách chấp nhận| D[Đơn chưa thanh toán]
  B --> K[Chốt thắng hoặc thua, có lý do]
  class D kv-accent`,
        `flowchart TD
  A[Lead] -->|Convert| B[Deal]
  B --> C[Quote]
  C -->|Customer accepts| D[Unpaid order]
  B --> K[Close as won or lost, with a reason]
  class D kv-accent`,
      ],
    ],
  ],
  'activity-planner': [
    [
      ['Hoàn tất việc và giữ bước tiếp theo', 'Finish work and keep the next step'],
      [
        'Lọc theo người phụ trách và loại việc. Các nhóm Quá hạn & hôm nay, 7 ngày tới, Sau đó và Tất cả việc mở có số đếm. Bấm một dòng để hoàn tất kèm kết quả; trong hộp thoại có Dời lịch, Hủy công việc và Mở hồ sơ.',
        'Filter by owner and activity type. The Overdue & today, Next 7 days, Later and All open groups show their counts. Select a row to complete it with an outcome; the dialog also offers Reschedule, Cancel activity and Open record.',
      ],
    ],
  ],
  'crm-settings': [
    [
      ['Cấu hình quy trình bán hàng', 'Configure the sales process'],
      [
        'Tab đang mở được giữ trong URL; bạn có thể lưu liên kết hoặc dùng Quay lại/Tiến tới của trình duyệt để trở về đúng tab. Ba tab: Đội & phân công, Quy trình bán hàng (giai đoạn, lý do thua, nhãn, báo giá từ Bán hàng) và Chấm điểm lead. Báo giá từ Bán hàng chọn cơ hội chỉ giữ báo giá lập từ nó (mặc định) hay cho người bán gắn thêm báo giá của cùng khách lập ở Bán hàng; doanh thu của báo giá được gắn tính theo cơ hội đó. Mỗi giai đoạn có xác suất cho dự báo và số ngày cảnh báo đứng yên. Chỉ quản lý sửa; bấm một dòng để mở hộp thoại sửa, hoặc mở trang đội. Mô phỏng phân công giải thích quy tắc khớp, điểm và người nhận mà không ghi hồ sơ; quy tắc ưu tiên chạy trước, sau đó tới cách phân công của đội.',
        "The URL keeps the selected tab; bookmark the link or use browser Back/Forward to return to it. Three tabs: Teams & assignment, Sales process (stages, lost reasons, tags, quotes from Sales) and Lead scoring. Quotes from Sales decides whether an opportunity holds only the quotes written from it (the default) or a salesperson may also attach the same customer's quotes written in Sales; an attached quote's revenue counts on that opportunity. Each stage carries a probability for the forecast and an idle-warning threshold in days. Only managers edit; select a row to open its edit dialog, or the team page. Assignment simulation explains the matching rule, score and assignee without writing a record; priority rules run first, then the team's own mode.",
      ],
    ],
  ],
  'crm-team': [
    [
      ['Quản lý thành viên và tải', 'Manage members and workload'],
      [
        'Chỉ số cho biết hồ sơ mở, hồ sơ chưa phân công, pipeline và doanh số thắng tháng này của đội; bấm để mở danh sách tương ứng. Bảng thành viên có thanh tải theo hồ sơ mở hiện tại; quản lý bấm một dòng để sửa trọng số hoặc ngưng hoạt động, người khác mở danh sách hồ sơ của thành viên đó. Một người không được thêm hai lần vào cùng đội. Trọng số là tương đối; thay đổi không tự chuyển hồ sơ đang có.',
        "Metrics show the team's open records, unassigned records, pipeline and revenue won this month; select one to open the matching list. The member table draws each member's load from current open records; managers select a row to edit the weight or deactivate the member, others open that member's records. A person cannot be added twice to the same team. Weights are relative; changes do not reassign existing records.",
      ],
    ],
  ],
}

const recovery = {
  vi: 'Dữ liệu sai được giữ và đánh dấu tại ô. Xung đột mở lại form với bản nháp của bạn và yêu cầu đối chiếu phiên bản mới trước. Rời bản nháp chưa lưu cần xác nhận. Mất kết nối vẫn giữ dữ liệu nhập để thử lại.',
  en: 'Invalid input is retained and marked at fields. A conflict reopens the form with your draft and asks you to review the latest version first. Leaving an unsaved draft asks first. A failed connection keeps your input for a retry.',
}
const access = {
  vi: 'Bạn thấy hồ sơ theo phạm vi quyền: hồ sơ mình phụ trách, hồ sơ chưa phân công của đội mình tham gia và mọi hồ sơ của đội mình dẫn dắt. Quyền xem cả đội mở rộng ra mọi hồ sơ của các đội đó; quyền xem cả công ty thấy tất cả. Hồ sơ chưa phân công của đội thì xem và nhận được; nhận rồi mới sửa. Không có quyền ghi thì không có lệnh sửa.',
  en: 'You see records by your access: those you own, the unassigned records of teams you belong to and every record of a team you lead. Team access widens this to every record of those teams; company access shows them all. A team’s unassigned record can be viewed and taken; take it to edit it. Without write access there are no editing commands.',
}
const demoAccess = {
  vi: 'URL Atlas chọn fixture người xem/vai trò. Nhân viên xem hồ sơ của mình hoặc chưa phân công; người chỉ xem không được ghi.',
  en: 'The Atlas URL selects viewer/role fixtures. Agents see owned or unassigned records; viewers cannot write.',
}
const demoBoundaries = {
  vi: 'Dữ liệu phiên đi xuyên màn và giữ sau refresh đến khi renderer khởi động lại hoặc đặt lại demo. Không gửi email thật, nhận webhook thật, thu tiền, dùng khách thật hay ghi database. Đồng hồ mẫu là tháng 9/2026; đây không phải phân quyền production.',
  en: 'Session data persists across screens and refresh until the renderer restarts or the demo resets. No real email, external intake, payment, customer data or database is used. The fixture clock is September 2026; this is not production authorization.',
}

/** What a screen's first section says about its clock and calendar: the demo's fixtures, or the workspace's own. */
const clockNotes = {
  'activity-planner': {
    demo: [
      'Quá hạn so cả ngày lẫn giờ theo UTC+7 và đồng hồ demo cố định. Lịch tuần là lịch mô phỏng, chưa kết nối Google/Outlook.',
      'Overdue compares date and time in UTC+7 against a fixed demo clock. The week calendar is simulated and not connected to Google/Outlook.',
    ],
    live: [
      'Quá hạn so cả ngày lẫn giờ theo múi giờ của công ty; việc chỉ có ngày đến hạn thì quá hạn khi ngày đó đã qua. Lịch tuần đếm việc còn mở theo ngày đến hạn của từng người.',
      'Overdue compares date and time in the company’s time zone; an activity with only a due date is overdue once that day is over. The week calendar counts open activities by due day for each owner.',
    ],
  },
}

/** The screen's guide in Markdown. A demo (the design atlas) adds how its fixtures stand in for real access. */
export const salesHelp = (screen, lang = 'vi', { demo = false } = {}) => {
  const en = lang === 'en',
    i = en ? 1 : 0,
    l = en ? 'en' : 'vi'
  const note = clockNotes[screen]?.[demo ? 'demo' : 'live'][i]
  const sections = (guides[screen] ?? guides.cases).map(
    ([heading, body, diagram], at) =>
      `## ${heading[i]}\n${body[i]}${at === 0 && note ? ` ${note}` : ''}` +
      (diagram ? `\n\n\`\`\`mermaid\n${diagram[i]}\n\`\`\`` : ''),
  )
  sections.push(
    `## ${en ? 'Permissions and recovery' : 'Quyền và phục hồi'}\n${(demo ? demoAccess : access)[l]} ${recovery[l]}`,
  )
  if (demo) sections.push(`## ${en ? 'Demo boundaries' : 'Phạm vi mô phỏng'}\n${demoBoundaries[l]}`)
  return `${sections.join('\n\n')}\n`
}

/** The screen's help drawer, which the `?` of the application switcher opens. */
export const salesHelpDrawer = ({ ds, lexer, screen, lang = 'vi', demo = false }) => {
  const t = (vi, en) => (lang === 'en' ? en : vi)
  return ds.HelpDrawer({
    id: 'crm-sales-help',
    label: t('Hướng dẫn CRM', 'CRM help'),
    title: (salesTitles[screen] ?? salesTitles.overview)[lang === 'en' ? 1 : 0],
    closeLabel: t('Đóng hướng dẫn', 'Close help'),
    body: ds.MarkdownContent({
      source: salesHelp(screen, lang, { demo }),
      lexer,
      headingOffset: 1,
      labels: {
        diagram: t('Sơ đồ', 'Diagram'),
        source: t('Mã nguồn sơ đồ', 'Diagram source'),
        loading: t('Đang vẽ sơ đồ', 'Drawing the diagram'),
        error: t(
          'Không vẽ được sơ đồ; xem mã nguồn bên dưới.',
          'The diagram could not be drawn; see its source below.',
        ),
        table: t('Bảng', 'Table'),
      },
    }),
  })
}
