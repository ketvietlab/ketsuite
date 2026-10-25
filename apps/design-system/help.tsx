import { marked } from 'marked'
import { HelpDrawer, MarkdownContent } from '@ketvietlab/design-system'

/** Screen-owned sample copy; the reusable rendering and diagram policy live in the DS. */
export const demoHelp = (title: string, locale: string) => {
  const en = locale === 'en'
  const content = en
    ? `
## Get started
Use **${title}** to follow your work and choose the next action. Help stays beside the screen while you work.

1. Choose a view from the navigation.
2. Review the status and important fields.
3. Open a record to continue the workflow.

> Check customer information and delivery dates before confirming an order.

## Order workflow
\`\`\`mermaid
flowchart TD
  A[Draft order] --> B{Ready to confirm?}
  B -->|Yes| C[Prepare delivery]
  B -->|Check details| A
  C --> D[Complete]
  class C kv-accent
  class D kv-positive
\`\`\`

## Useful controls
| Control | Purpose |
| --- | --- |
| Search | Find a record quickly |
| Filters | Narrow the current list |
| \`Esc\` | Close help and return to the screen |

## Related actions
Use the [sales list](/demo2?view=orders&lang=en) to review orders. App switcher destinations are preview placeholders.
`
    : `
## Bắt đầu
Dùng **${title}** để theo dõi công việc và chọn thao tác tiếp theo. Bạn có thể vừa đọc hướng dẫn vừa làm việc trên màn hình.

1. Chọn một chế độ xem trong menu.
2. Kiểm tra trạng thái và các thông tin quan trọng.
3. Mở bản ghi để tiếp tục quy trình.

> Kiểm tra thông tin khách hàng và ngày giao trước khi xác nhận đơn hàng.

## Quy trình đơn hàng
\`\`\`mermaid
flowchart TD
  A[Đơn nháp] --> B{Đủ thông tin?}
  B -->|Có| C[Chuẩn bị giao]
  B -->|Kiểm tra lại| A
  C --> D[Hoàn tất]
  class C kv-accent
  class D kv-positive
\`\`\`

## Thao tác thường dùng
| Thao tác | Mục đích |
| --- | --- |
| Tìm kiếm | Tìm nhanh một bản ghi |
| Bộ lọc | Thu hẹp danh sách hiện tại |
| \`Esc\` | Đóng hướng dẫn và quay lại màn hình |

## Liên quan
Mở [danh sách bán hàng](/demo2?view=orders&lang=vi) để kiểm tra đơn. Các địa chỉ chuyển app trong preview là placeholder.
`
  return (
    <HelpDrawer
      id="demo-screen-help"
      label={en ? 'Screen help' : 'Hướng dẫn màn hình'}
      title={title}
      closeLabel={en ? 'Close help' : 'Đóng hướng dẫn'}
      body={
        <MarkdownContent
          source={content}
          lexer={marked.lexer}
          headingOffset={1}
          labels={{
            table: en ? 'Reference table' : 'Bảng tham khảo',
            diagram: en ? 'Workflow diagram' : 'Sơ đồ quy trình',
            source: en ? 'View Mermaid source' : 'Xem mã Mermaid',
            loading: en ? 'Rendering diagram…' : 'Đang vẽ sơ đồ…',
            error: en
              ? 'This diagram could not be displayed. Its source is available below.'
              : 'Chưa thể hiển thị sơ đồ này. Bạn có thể xem mã bên dưới.',
          }}
        />
      }
    />
  )
}
