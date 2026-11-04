import { marked } from 'marked'
import type { TemplateResult } from '@ketvietlab/ketjs-view'
import { HelpDrawer, MarkdownContent } from '@ketvietlab/design-system'
import { HELP } from '../../product_backend/screens/help-words.ts'

export const operatorSkillsHelp = {
  vi: {
    title: 'Kỹ năng công nhân',
    source: `## Ghi kỹ năng

Màn này mở từ bánh răng cấu hình Sản xuất. Người có quyền cấu hình thêm, sửa và xoá dòng; người chỉ xem không thể lưu.

- Thêm dòng, chọn người và kỹ năng mà khu sản xuất đang dùng. Danh sách chỉ có thành viên đang hoạt động có quyền làm công đoạn.
- Mức kỹ năng từ **0 đến 5**; từ **2** trở lên mới đủ điều kiện tự động giao việc. Khi cùng mức kỹ năng, công nhân được ưu tiên trước người đánh dấu **Quản đốc**.
- Người và kỹ năng của dòng đã lưu không sửa được. Muốn đổi, xoá dòng cũ và thêm dòng mới.
- Bấm **Lưu kỹ năng** để lưu cả lưới. Một dòng không hợp lệ thì không dòng nào được lưu; sửa dòng được báo rồi lưu lại.

## Sau khi lưu

Mức mới ảnh hưởng lần giao việc tự động tiếp theo, không tự đổi người của công đoạn đã giao. Dòng của người đã rời công ty vẫn giữ để đọc lịch sử; không thêm dòng mới cho người đó.

Nếu chưa có kỹ năng để chọn, cấu hình **Kỹ năng** trên Khu sản xuất trước.`,
  },
  en: {
    title: 'Operator skills',
    source: `## Recording skills

Open this screen from Manufacturing settings. Configuration permission allows adding, editing and removing rows; viewers cannot save.

- Add a row and select an active company member authorized to run operations, and a skill used by a work center.
- Skill levels range from **0 to 5**. A level of **2** or above qualifies for automatic assignment. At equal skill levels, workers are preferred before people marked as **Lead**.
- A saved row keeps its person and skill. To change either, remove the old row and add a new one.
- **Save skills** saves the entire grid. If one row is invalid, nothing is saved. Correct the reported row and save again.

## After saving

The new level affects the next automatic assignment; it does not reassign existing work. Rows for former company members remain as history, but new rows cannot name them.

If no skills are offered, configure a **Skill** on a Work center first.`,
  },
} as const

/** The guide's drawer, rendered in the content slot beside the page. */
export const OperatorSkillsHelp = ({ lang }: { lang: 'vi' | 'en' }): TemplateResult => {
  const words = HELP[lang]
  const guide = operatorSkillsHelp[lang]
  return (
    <HelpDrawer
      id="manufacturing-operator-skills-help"
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
