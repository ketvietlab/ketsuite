import { marked } from 'marked'
import type { TemplateResult } from '@ketvietlab/ketjs-view'
import { HelpDrawer, MarkdownContent } from '@ketvietlab/design-system'
import { HELP } from '../../product_backend/screens/help-words.ts'

// The work-center guide (Help drawer), in Markdown. It describes ./work-centers-list.tsx,
// ./work-center-form.tsx and the archive/restore commands the route in ../routes.ts accepts;
// change it with them.
export const workCenterHelp = {
  vi: {
    title: 'Khu sản xuất',
    source: `Mỗi dòng là một **khu sản xuất** của xưởng: mã, tên, **Kỹ năng** cần để làm việc ở đó, **Công suất**, **Hiệu suất** và **Chi phí/giờ**. Màn này mở từ bánh răng cấu hình; người có quyền cấu hình sản xuất thêm và sửa, người chỉ được xem thì xem khu và hàng đợi.

\`\`\`mermaid
flowchart LR
  center[Khu sản xuất] --> skill[Kỹ năng cần]
  center --> queue["Hàng đợi: công đoạn đang mở"]
  center --> cost["Chi phí/giờ: tham khảo giá thành"]
\`\`\`

## Thêm và sửa

- **Mã** gồm chữ in hoa, số và dấu gạch, tối đa 10 ký tự, không trùng trong công ty. Gõ chữ thường thì hệ thống tự đổi sang chữ in hoa.
- **Công suất** là số lệnh làm cùng lúc, phải lớn hơn 0. **Chi phí/giờ** là số đồng nguyên, không âm.
- Mở một khu để xem bảng **Hàng đợi**: công đoạn **Đang làm** và **Tạm dừng** đứng đầu, rồi **Sẵn sàng**, rồi **Chờ công đoạn trước**, mỗi nhóm theo ngày bắt đầu dự kiến của lệnh.

## Lưu trữ

\`\`\`mermaid
flowchart LR
  active[Đang hoạt động] -- Lưu trữ --> archived[Đã lưu trữ]
  archived -- Khôi phục --> active
\`\`\`

Khu đã lưu trữ ẩn khỏi danh sách cho tới khi bạn bật bộ lọc trạng thái, và không được chọn cho công đoạn mới; công đoạn cũ vẫn giữ tên khu.`,
  },
  en: {
    title: 'Work centers',
    source: `Each row is a **work center** of the factory: code, name, the **Skill** its work needs, **Capacity**, **Efficiency** and **Cost per hour**. The screen opens from the settings gear; people who configure manufacturing add and edit, people who only view see the centers and their queues.

\`\`\`mermaid
flowchart LR
  center[Work center] --> skill[Skill needed]
  center --> queue["Queue: open operations"]
  center --> cost["Cost per hour: costing reference"]
\`\`\`

## Adding and editing

- The **Code** is capital letters, digits and dashes, at most 10 characters, unique within the company. Lower-case letters are turned into capitals.
- **Capacity** is how many orders run at once and must be above 0. **Cost per hour** is a whole amount, never negative.
- Open a work center to see its **Queue**: operations **In progress** and **Paused** first, then **Ready**, then **Waiting for the previous step**, each by the order's scheduled start.

## Archiving

\`\`\`mermaid
flowchart LR
  active[Active] -- Archive --> archived[Archived]
  archived -- Restore --> active
\`\`\`

An archived work center is hidden from the list until you turn on the state filter, and cannot be picked for new operations; existing operations keep its name.`,
  },
} as const

/** The guide's drawer, rendered in the content slot beside the page. */
export const WorkCenterHelp = ({ lang }: { lang: 'vi' | 'en' }): TemplateResult => {
  const words = HELP[lang]
  const guide = workCenterHelp[lang]
  return (
    <HelpDrawer
      id="manufacturing-work-center-help"
      label={words.label}
      title={guide.title}
      closeLabel={words.close}
      body={
        <MarkdownContent
          source={guide.source}
          lexer={marked.lexer}
          headingOffset={1}
          labels={{
            diagram: words.diagram,
            table: words.table,
            source: words.source,
            loading: words.loading,
            error: words.error,
          }}
        />
      }
    />
  )
}
