import { HelpDrawer, MarkdownContent } from '@ketvietlab/design-system'
import type { MarkdownToken, MarkdownLabels } from '@ketvietlab/design-system'
import type { StudioContext } from './types.ts'

// Product-authored Markdown recipes, kept with the native route presenters.
const recipes: Record<string, readonly [string, string, string, string]> = {
  overview: [
    'Xem số liệu và tình trạng nội dung của website đang chọn.',
    'Chọn một mục trên thanh điều hướng để xử lý nội dung tương ứng.',
    'Review the selected website’s content and status.',
    'Choose a navigation item to work on that content.',
  ],
  entries: [
    'Quản lý trang và bài viết của website đang chọn.',
    'Tìm theo tiêu đề hoặc đường dẫn, lọc trạng thái rồi mở bản ghi. Dùng nút tạo mới khi có quyền chỉnh sửa.',
    'Manage the selected website’s pages and posts.',
    'Search by title or path, filter status and open a record. Use the create action when allowed.',
  ],
  editor: [
    'Soạn nội dung và thông tin hiển thị của một trang hoặc bài viết.',
    'Sửa các trường và lưu bản nháp. Xem trước để kiểm tra nội dung; xuất bản là thao tác riêng.',
    'Edit one page or post and its display information.',
    'Edit the fields and save the draft. Preview the result; publishing is a separate action.',
  ],
  builder: [
    'Chỉnh bố cục trang và nội dung từng khối.',
    'Chọn khối, chỉnh nội dung hoặc cách hiển thị rồi lưu bản nháp. Trong phần giao diện dùng chung, logo và chân trang áp dụng cho cả website: kiểm tra và xác nhận trước khi lưu.',
    'Edit page layout and individual blocks.',
    'Select a block, edit its content or presentation and save the draft. Shared logo and footer changes affect the website: review and confirm before saving.',
  ],
  preview: [
    'Kiểm tra cách nội dung hiển thị trước khi xuất bản.',
    'Chọn kích thước xem trước nếu màn hình có điều khiển đó; quay về màn chỉnh sửa để thay đổi nội dung.',
    'Review content before publication.',
    'Select a preview size where available; return to the editor to change content.',
  ],
  catalog: [
    'Quản lý nội dung bán hàng gắn với sản phẩm ERP.',
    'Tìm và mở sản phẩm, hoặc chọn sản phẩm ERP để thêm vào website. Giá và dữ liệu ERP đi theo liên kết sản phẩm.',
    'Manage website sales content linked to ERP products.',
    'Find and open an item, or choose an ERP product to add to the website. Prices and ERP data follow the product link.',
  ],
  'catalog-record': [
    'Chỉnh nội dung và cách hiển thị sản phẩm trên website.',
    'Điền các trường được phép sửa, kiểm tra ảnh và lưu. Mở bản xem trước để kiểm tra nội dung; thao tác lưu không tự xuất bản.',
    'Edit website product content and presentation.',
    'Edit allowed fields, review images and save. Open preview to review the content; saving does not publish it automatically.',
  ],
  'catalog-picker': [
    'Chọn sản phẩm ERP đưa lên website.',
    'Tìm sản phẩm, chọn bản ghi rồi xác nhận. Dùng chức năng tạo sản phẩm ERP khi tài khoản có quyền cấu hình sản phẩm.',
    'Choose an ERP product for the website.',
    'Search, select a product and confirm. Create an ERP product only when your account has product configuration permission.',
  ],
  'catalog-taxonomy': [
    'Sắp xếp sản phẩm theo danh mục hoặc bộ sưu tập.',
    'Mở một nhóm để sửa tên, đường dẫn và nội dung. Kiểm tra sản phẩm liên quan trước khi lưu hoặc lưu trữ nhóm.',
    'Organize products in categories or collections.',
    'Open a group to edit its name, path and content. Review related products before saving or archiving it.',
  ],
  forms: [
    'Quản lý biểu mẫu và các thông tin khách gửi.',
    'Mở biểu mẫu để sửa các trường hoặc xem danh sách gửi. Kiểm tra cấu hình đích nhận trên màn chỉnh sửa trước khi lưu.',
    'Manage forms and visitor submissions.',
    'Open a form to edit fields or view submissions. Review its destination configuration before saving.',
  ],
  submissions: [
    'Xem và xử lý thông tin khách gửi qua biểu mẫu.',
    'Lọc trạng thái, mở bản ghi và xử lý bằng các thao tác được cấp quyền. Không thay đổi nội dung khách đã gửi.',
    'Review visitor form submissions.',
    'Filter status, open a record and use permitted processing actions. Do not change the visitor’s submitted content.',
  ],
  'visitor-form': [
    'Kiểm tra thao tác gửi một biểu mẫu.',
    'Điền thông tin bắt buộc, đọc thông tin đồng ý nếu có rồi gửi một lần. Sửa trường báo lỗi và thử lại khi gửi chưa thành công.',
    'Exercise a form submission.',
    'Fill required fields, read any consent notice and submit once. Correct invalid fields and retry if submission has not succeeded.',
  ],
  'visitor-receipt': [
    'Xem xác nhận của lượt gửi biểu mẫu.',
    'Kiểm tra mã và trạng thái xác nhận. Quay lại biểu mẫu khi cần gửi một nội dung khác.',
    'Review a form submission receipt.',
    'Check the receipt identifier and status. Return to the form to submit different information.',
  ],
  customers: [
    'Quản lý tài khoản đăng nhập của khách hàng thuộc website này.',
    'Tìm khách hàng và mở tài khoản để xem trạng thái. Cấp tài khoản, đóng/mở lại hoặc đặt lại mật khẩu bằng thao tác được cấp quyền.',
    'Manage customer sign-in accounts for this website.',
    'Find a customer and open the account. Issue, close, reopen or reset a password only through permitted actions.',
  ],
  'customer-new': [
    'Cấp tài khoản đăng nhập cho khách hàng của công ty.',
    'Tìm đối tác, chọn khách hàng rồi xác nhận cấp tài khoản. Nếu hệ thống tạo mật khẩu, sao chép ngay: mật khẩu chỉ hiển thị một lần.',
    'Issue a sign-in account to a company customer.',
    'Find and select a partner, then confirm account issuance. Copy any generated password immediately: it is shown only once.',
  ],
  customer: [
    'Xem và quản lý một tài khoản khách hàng.',
    'Kiểm tra trạng thái và dùng thao tác đóng/mở hoặc đặt lại mật khẩu khi được phép. Sao chép mật khẩu mới khi nó được hiển thị.',
    'Review and manage one customer account.',
    'Check its status and use permitted close, reopen or password reset actions. Copy a new password when it is displayed.',
  ],
  settings: [
    'Cấu hình website đang chọn và các liên kết quản trị.',
    'Sửa thông tin, kiểm tra các trường báo lỗi và lưu. Mở phần tên miền hoặc giao diện để chỉnh cấu hình tương ứng.',
    'Configure the selected website and its administration links.',
    'Edit information, correct invalid fields and save. Open domains or appearance to edit those settings.',
  ],
  domains: [
    'Quản lý địa chỉ truy cập của website đang chọn.',
    'Mở tên miền để kiểm tra hướng dẫn trỏ tên miền và trạng thái xác minh. Chỉ chọn địa chỉ chính khi các điều kiện trên màn hình được đáp ứng.',
    'Manage addresses serving the selected website.',
    'Open a domain to review routing instructions and verification status. Select the primary address only when its displayed requirements are met.',
  ],
  sites: [
    'Quản lý website của công ty hiện tại.',
    'Chọn website cần làm việc hoặc tạo website mới khi được cấp quyền. Kiểm tra tên và các trường bắt buộc trước khi xác nhận tạo.',
    'Manage websites of the current company.',
    'Select a website or create one when allowed. Review its name and required fields before confirming creation.',
  ],
  themes: [
    'Chỉnh giao diện và logo của website đang chọn.',
    'Chọn giao diện để chỉnh. Chọn hoặc thả một ảnh PNG, JPEG, WebP hoặc AVIF tối đa 5 MB; xem lại logo rồi bấm Lưu. Gỡ logo chỉ thay đổi bản nháp cho tới khi lưu.',
    'Edit appearance and the selected website’s logo.',
    'Open its style configuration. Choose or drop one PNG, JPEG, WebP or AVIF image up to 5 MB; review the logo and save. Removing it changes the draft until saved.',
  ],
  menus: [
    'Quản lý menu và liên kết điều hướng của website.',
    'Mở menu, chỉnh nhãn, đích và thứ tự các mục. Kiểm tra cảnh báo liên kết trước khi lưu.',
    'Manage website menus and navigation links.',
    'Open a menu, edit labels, destinations and ordering. Review link warnings before saving.',
  ],
  seo: [
    'Quản lý thông tin tìm kiếm và chia sẻ của website.',
    'Mở cấu hình để chỉnh thông tin tìm kiếm/chia sẻ. Xem trạng thái sitemap và chỉ mục; nội dung xuất bản và địa chỉ website quyết định thông tin công khai.',
    'Manage website search and sharing information.',
    'Edit search and sharing configuration. Review sitemap and index status; published content and the website address determine public information.',
  ],
  templates: [
    'Xem các mẫu trang cài sẵn của module.',
    'Mẫu cài sẵn chỉ dùng để tham khảo và tạo trang. Chỉnh nội dung trên trang của bạn; màn này không lưu thay đổi vào mẫu gốc.',
    'Inspect the module’s bundled page starters.',
    'Bundled starters are read-only references for creating pages. Edit your own page content; this screen does not change the original starter.',
  ],
  resource: [
    'Quản lý dữ liệu cấu hình của website.',
    'Tìm và mở bản ghi, điền các trường bắt buộc rồi lưu. Kiểm tra liên kết và các bản ghi liên quan trước khi lưu trữ.',
    'Manage website configuration records.',
    'Find and open a record, fill required fields and save. Review links and related records before archiving.',
  ],
  archive: [
    'Xác nhận thao tác gỡ hoặc lưu trữ bản ghi đang chọn.',
    'Đọc tên bản ghi và tác động được hiển thị. Chỉ xác nhận khi đúng đối tượng; dùng Quay lại để giữ nguyên bản ghi.',
    'Confirm removal or archival of the selected record.',
    'Review the record name and displayed impact. Confirm only the intended record; go back to keep it unchanged.',
  ],
}

const recipeFor = (key: string): string => {
  if (key.endsWith('-archive') || key.endsWith('-remove')) return 'archive'
  if (key.startsWith('customer')) return key === 'customer-new' ? key : key === 'customer' ? key : 'customers'
  if (key === 'builder') return 'builder'
  if (key === 'visitor-form' || key === 'visitor-receipt') return key
  if (key.includes('preview')) return 'preview'
  if (key === 'catalog-new') return 'catalog-picker'
  if (key.includes('catalog-category') || key.includes('catalog-collection')) return 'catalog-taxonomy'
  if (key.startsWith('catalog')) return key === 'catalog' ? key : 'catalog-record'
  if (key === 'pages' || key === 'posts') return 'entries'
  if (key === 'page-new' || key.startsWith('post-') || key === 'entry-details') return 'editor'
  if (key === 'submissions' || key === 'submission-detail') return 'submissions'
  if (key.startsWith('form')) return 'forms'
  const base = key.replace(/-edit$/, '')
  return recipes[base] ? base : 'resource'
}

export function screenHelpSource(key: string, title: string, locale: 'vi' | 'en' = 'vi') {
  const recipe = recipes[recipeFor(key)]!
  return locale === 'vi'
    ? `# ${title}\n\n${recipe[0]}\n\n## Thực hiện\n\n${recipe[1]}\n\n## Kết quả và xử lý lỗi\n\nChỉ thông báo thành công mới xác nhận thao tác đã hoàn tất. Nếu có lỗi, giữ bản nháp, kiểm tra trường báo lỗi hoặc quyền của tài khoản rồi thử lại. Khi dữ liệu đã bị người khác thay đổi, tải lại bản ghi trước khi lưu tiếp.`
    : `# ${title}\n\n${recipe[2]}\n\n## Steps\n\n${recipe[3]}\n\n## Result and recovery\n\nA success message confirms completion. On error, keep your draft, review invalid fields or account permissions and retry. If another person changed the record, reload it before saving again.`
}

/** The product’s help recipes use headings and paragraphs; HTML remains escaped text. */
export const screenHelpLabels: MarkdownLabels = {
  diagram: 'Sơ đồ',
  source: 'Xem nguồn',
  loading: 'Đang tải sơ đồ…',
  error: 'Không thể hiển thị sơ đồ.',
  table: 'Bảng nội dung',
}

export function helpLexer(source: string): MarkdownToken[] {
  return source.split(/\n\s*\n/).map((text) => {
    const match = /^(#{1,6}) (.*)$/.exec(text)
    return match ? { type: 'heading', depth: match[1]!.length, text: match[2]! } : { type: 'paragraph', text }
  })
}

export const screenHelp = (ctx: StudioContext, title: string) => (
  <HelpDrawer
    id="website-screen-help"
    label={ctx.tr('website.help.title')}
    title={title}
    closeLabel={ctx.tr('website.help.close')}
    body={
      <MarkdownContent
        source={screenHelpSource(ctx.route().key, title)}
        lexer={helpLexer}
        labels={screenHelpLabels}
        headingOffset={1}
      />
    }
  />
)
