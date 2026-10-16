# Shell chung: hướng dẫn tích hợp cho agent

Đọc tài liệu này trước khi sửa shell, sidebar, app rail, navigation hoặc Help.
Dùng API và runtime của design system; các kích thước, màu, typography và lớp hiển thị
thuộc DS. [README DS](../../../packages/design-system/README.md) là hợp đồng API;
[visual contract](visual-contract.md#application-navigation) sở hữu hình học menu.
Không tạo shell/CSS tương đương riêng trong app hoặc bản preview.

## Chọn đúng nơi sửa

| Trách nhiệm | Nguồn |
| --- | --- |
| Cấu trúc SSR, app rail và sidebar | `packages/design-system/src/layouts/shell/`, `layouts/app-navigation/` |
| Search, Collapse, focus, popup và cleanup | `packages/design-system/src/runtime/` |
| URL, tên app, app hiện tại và Cài đặt theo quyền | `packages/ketsuite/src/ui/application-switcher.ts` (`suiteApplications`) |
| Backend frame và các slot navigation | `packages/ketsuite/src/ui/layout.tsx`, `ui/nav.tsx`, `modules/backend/screen.ts` |
| Website Studio SSR và client boot | `modules/website_backend/studio/routes.ts`, `packages/website-client/client/shell.tsx`, `studio.tsx` |
| Favicon của ứng dụng | `packages/ketsuite/src/ui/brand.ts` và asset `modules/backend/design/brand/favicon.png` |
| Help và Markdown/Mermaid | `patterns/help-drawer/`, `content/markdown/`, `runtime/help.js`, `mermaid*.js` |

Các đường dẫn trong bảng tương đối với `ketsuite/`; đường dẫn DS ngắn tương đối với
`packages/design-system/src/`. Deployment và runner riêng của consumer thuộc repo host.

## SSR và chuyển menu

- Render `AppShell` ở document đầu tiên. Cấp `applications` cho mọi shell;
  đặt `AppNavigation` ở sidebar và ngữ cảnh tổ chức/global search/theme/account
  ở `AppShell.location`. Nội dung màn hình thuộc main. Không bọc một shell mới
  bên trong từng routed screen.
- Dùng document runtime của KetJS và link thật để chuyển menu trong cùng document.
  Backend dùng các slot `backend.sidebar-main`, `backend.topbar`,
  `backend.global-topbar`, `backend.content`; giữ tên slot dù vị trí thay đổi.
  Fragment response chỉ chứa nội dung/slot cập nhật, không chứa `AppShell` mới.
  Shell, rail và header điều hướng phải giữ DOM, draft Search và trạng thái thu gọn.
- Cleanup runtime/islands của slot cũ trước khi thay nội dung; attach/hydrate nội dung
  mới sau navigation. Không attach thêm toàn bộ document ở mỗi lần chuyển menu.
  Demo2 dùng cùng nguyên tắc qua `navigablePage`, `demo.content` và `demo.overlay`.
- Giữ fallback GET khi JavaScript không chạy. Nếu app đang hoạt động mà click menu
  tải lại document, kiểm tra document runtime, console và bundle của **mọi placed island**.
  Một island không load được có thể chặn việc attach navigation.
  Trang ghi “Preview shell” hoặc fixture chỉ render SSR không chứng minh app thật đã được nối.

## Rail và sidebar

- Rail graphite 48px ở bên trái; logo mark trên rail, không làm rộng rail.
  App có URL mở tab mới bằng link native; tên hiện khi hover/focus; active dùng
  app ID. Host quyết định URL, quyền và trạng thái sắp ra mắt.
- KetSuite dùng `suiteApplications` từ menu đã lọc quyền cho mọi deployment.
  Kinh doanh/Sales và Website có đích thật; Kế toán, Flow, Phone, Chat chưa có URL.
  Website ở rail; bỏ link Website trùng và Kế toán khỏi menu chính. Cài đặt lấy
  các liên kết quản trị đã có quyền, mở bằng click/chạm/bàn phím.
- Sidebar chính có header cố định 44px, tên app, Search và Collapse; không hairline
  ở header. Hairline phân cấp canh tâm ô icon, giữ nhãn cha/con thẳng cột.
  Search chỉ lọc menu được phép, hỗ trợ không dấu và khôi phục nhánh khi xóa.
  Collapse desktop ẩn cột menu chính, giữ rail và nút mở lại.
- Mobile dưới 768px: rail nằm **trong menu đang mở**, không hiện độc lập.
  Search/Close và các đích chạm dùng target 44px; không có Collapse desktop.
  Runtime DS sở hữu focus boundary, inert và Escape.
- Menu Cài đặt và tooltip phải nổi trên sidebar liền kề. Giữ lớp của rail theo
  token menu; tăng z-index riêng của popup không vượt được stacking context cha.
  Kiểm tra bằng thao tác bấm thật, không chỉ bằng bounds hoặc ảnh.
- Backend, đăng nhập và Website Studio dùng favicon ứng dụng chung.
  Storefront của tenant giữ branding riêng.

## Hướng dẫn màn hình bắt buộc

App độc lập có navigation riêng dùng public `AppSwitcherHelp({ label })` bên cạnh
`HelpDrawer` của màn; hook và runtime giống `AppSwitcher.helpLabel`. Không dựng thêm
rail hoặc listener đóng/mở/focus riêng. Specimen: `help-drawer`.

Mỗi lần agent làm việc với một trang, kiểm tra hướng dẫn hiện hành; thiếu thì viết
và nối hướng dẫn trong cùng task/PR, đã có thì cập nhật cùng hành vi. Không mở rộng
sang các trang không được đụng tới chỉ để thực hiện một cuộc migration.

Dùng `HelpDrawer` trong content slot của màn hình, `MarkdownContent` với Markdown
VI/EN, lexer do host cấp và `headingOffset={1}`. Cấp `AppSwitcher.helpLabel`
khi hướng dẫn của màn hiện tại hoạt động. Hook `ket:screen-help-request` và runtime
`attachDesignSystemInteractions` nối nút rail tới drawer; không viết listener riêng.
Runtime đóng drawer bằng Escape, nút đóng, bấm `?` lần nữa và bấm chuột ra ngoài
drawer trên desktop (đóng kiểu này không kéo focus về `?`).
Mẫu: `apps/design-system/help.tsx`.

Mermaid dùng loader do host bundle và theme chung của DS:
`configureMermaidLoader`, `createMermaidTheme`, `readMermaidPalette`.
Không CDN hoặc theme riêng cho từng app; giữ nguồn đọc được nếu chưa có JavaScript
hoặc diagram lỗi. Xem [Screen help and ecosystem Mermaid](../../../packages/design-system/README.md#screen-help-and-ecosystem-mermaid)
để dùng đúng các nhãn, lớp ngữ nghĩa và cơ chế sáng/tối.
Theme chung dùng box 12px, connector bo góc, Inter 13px và khoảng cách sơ đồ gọn.
Điểm quyết định gọn dùng `Q("Câu hỏi?"):::kv-decision` (vàng, nét đứt);
nhánh phải có nhãn, kết quả dùng `kv-positive`/`kv-warning`/`kv-danger`.
Không đoán màu theo câu chữ ở runtime. Chuỗi ngang dài chuyển sang luồng dọc hoặc
tách giai đoạn có liên hệ rõ; giữ đủ điều kiện và đường phục hồi, không thu nhỏ chữ.
Consumer cài DS cũ chỉ dùng adapter sinh từ nguồn chuẩn, có kiểm tra chống lệch;
không duy trì theme riêng. Chi tiết và đường nâng cấp nằm trong README DS.

Desktop Help là drawer modeless bên phải 512px; mobile là modal toàn màn hình và
đóng menu trước. Escape/Close trả focus đúng chỗ. Chuyển menu thay hướng dẫn của
màn hình mới và cleanup drawer cũ, không thay shell.

## Kiểm chứng trước khi bàn giao

1. Xác định deployment và composition từ host; chỉ chạy producer contract và
   hành vi trực tiếp bị ảnh hưởng trong deployment đó.
2. Mở route app thật có xác thực và runtime, với đủ bundle island. Click hai menu
   và Back: request là fragment/fetch, không có document reload; shell/header ổn định,
   active và nội dung đúng, Search/Collapse giữ trạng thái.
3. Kiểm tra desktop/mobile, sáng/tối, Search rỗng/không dấu/Escape, Collapse/mở lại,
   Cài đặt bấm được phía trên sidebar, link app mới và Help theo màn hình.
   Kiểm tra focus, quyền, mục chưa triển khai và favicon khi những phần này bị ảnh hưởng.
4. Thay runtime DS thì giữ tương thích script classic của KetAtlas:
   `atlas-cli.ts` phải materialize các helper mới mà không còn import/export.
   Chạy contract materialization nếu sửa helper/runtime hoặc adapter này.
5. Cập nhật README/skill/specimen và focused contract khi đổi API chung.
   Báo rõ check đã chạy; producer build không đồng nghĩa image build hoặc deploy.
   Không chạy suite của deployment khác hoặc full verification gate mặc định.
