// The guides (Help drawer) of the people, roles and access-rules lists, in Markdown. They
// describe the lists in ./users-list.tsx, ./roles-list.tsx and ./access-policies-list.tsx and
// their reads in ../routes.ts, ../managed-role-routes.ts and ../access-policy-routes.ts;
// change them together. The guides are data, kept apart from ./list-help.tsx, which draws them.

/** The words around a guide: the drawer, its trigger and its diagrams. */
export const LIST_HELP_WORDS = {
  vi: {
    label: 'Hướng dẫn',
    trigger: 'Hướng dẫn màn hình',
    close: 'Đóng hướng dẫn',
    diagram: 'Sơ đồ',
    table: 'Bảng',
    source: 'Mã sơ đồ',
    loading: 'Đang tải',
    error: 'Không thể tải sơ đồ',
  },
  en: {
    label: 'Help',
    trigger: 'Screen help',
    close: 'Close help',
    diagram: 'Diagram',
    table: 'Table',
    source: 'Diagram source',
    loading: 'Loading',
    error: 'Unable to load diagram',
  },
} as const

const searching = {
  vi: `## Tìm và lọc

- Ô tìm kiếm lọc danh sách ngay khi bạn ngừng gõ.
- **Lọc** chọn các điều kiện có sẵn; các điều kiện cùng nhóm là "hoặc", khác nhóm là "và". **Thêm điều kiện** lọc theo một trường với điều kiện bạn chọn.
- **Nhóm** gom dòng theo một trường; bấm tên nhóm để mở hoặc thu gọn.
- **Đã lưu** giữ bộ lọc đang dùng để mở lại sau.
- Bấm tiêu đề cột để sắp xếp; bấm lần nữa để đảo chiều. **Chọn cột** ẩn hoặc hiện các cột.

Mọi lựa chọn nằm trên địa chỉ trang: gửi đường dẫn cho người khác là họ thấy đúng danh sách đó, và nút Back của trình duyệt quay lại lựa chọn trước.`,
  en: `## Search and filter

- The search box narrows the list as soon as you stop typing.
- **Filters** offers ready-made conditions; conditions in one group are "or", across groups "and". **Add condition** filters one field by a condition you choose.
- **Group by** gathers rows by a field; select a group's name to open or close it.
- **Saved** keeps the filters in use so you can open them again later.
- Select a column heading to sort; select it again to reverse. **Columns** shows or hides columns.

Every choice is in the page address: send the link and the recipient sees the same list, and the browser's Back returns to your previous choice.`,
}

const states = {
  vi: `## Khi danh sách không hiện

- **Không tải được danh sách** hoặc **Mất kết nối mạng**: danh sách đang hiện vẫn là lần tải trước. Bấm **Thử lại**; khi có mạng trở lại, danh sách tự tải lại.
- **Bạn không có quyền xem danh sách này**: nhờ quản trị viên cấp quyền cho vai trò của bạn.
- Không có dòng nào khớp: bấm **Xoá bộ lọc** để xem lại toàn bộ.`,
  en: `## When the list does not show

- **Could not load the list** or **You are offline**: the list on screen is from the last successful load. Select **Try again**; when you are back online the list reloads by itself.
- **You cannot view this list**: ask an administrator to let your role view it.
- Nothing matches: select **Clear filters** to see everything again.`,
}

export const userListHelp = {
  vi: {
    title: 'Người dùng',
    source: `Màn hình này liệt kê mọi người đăng nhập được vào hệ thống: nhân viên nội bộ, tài khoản khách hàng / đối tác và tài khoản công khai. Bấm một dòng để mở trang của người đó: hồ sơ, nơi làm việc, vai trò và đăng nhập. **Tạo người dùng** chỉ hiện khi bạn được phép tạo.

\`\`\`mermaid
flowchart TD
  A[Tìm, lọc<br>người dùng] --> B{Làm gì?}
  B -->|Một người| C[Mở trang<br>người dùng]
  B -->|Nhiều người| D[Tick các dòng]
  D --> E[Bật hoặc ngừng<br>hoạt động]
  class C kv-positive
\`\`\`

## Các cột

- **Tên**: người có **Quản trị toàn hệ thống** mang nhãn đó ngay cạnh tên.
- **Đăng nhập gần nhất**: lần cuối người đó đăng nhập, hoặc **Chưa đăng nhập**.
- **Loại truy cập**: **Nội bộ**, **Khách hàng / đối tác** hoặc **Công khai**.
- **Kích hoạt tài khoản**: **Đã kích hoạt** khi người đó đã có mật khẩu, **Chưa kích hoạt** khi còn chờ lời mời.
- **Trạng thái**: **Đang hoạt động** hoặc **Đã lưu trữ**.

Bộ lọc có sẵn chọn theo loại truy cập và **Chờ lời mời**. **Công ty** và **Vai trò công việc** chỉ giữ lại người làm ở công ty đó hoặc giữ vai trò đó; chọn lại mục đang chọn để bỏ. Người đã lưu trữ chỉ hiện khi bật **Bao gồm đã lưu trữ** trong **Lọc**.

## Đổi nhiều người cùng lúc

Khi bạn được phép, mỗi dòng có ô chọn. Tick các dòng rồi bấm **Bật hoạt động** hoặc **Ngừng hoạt động**. Mỗi người được đổi riêng, nên quản trị viên đầy đủ cuối cùng không bị ngừng hoạt động. Sang trang khác hoặc đổi bộ lọc thì các dòng đã tick được bỏ chọn.

${searching.vi}

${states.vi}`,
  },
  en: {
    title: 'Users',
    source: `This screen lists everyone who can sign in: internal staff, customer / partner accounts and public accounts. Select a row to open that person's page: profile, workplaces, roles and sign-in. **Create user** shows only when you may create one.

\`\`\`mermaid
flowchart TD
  A[Search and<br>filter people] --> B{What to do?}
  B -->|One person| C[Open their page]
  B -->|Several people| D[Check their rows]
  D --> E[Make active<br>or inactive]
  class C kv-positive
\`\`\`

## Columns

- **Name**: a person with **Full access** carries that label beside their name.
- **Last sign-in**: when the person last signed in, or **Never signed in**.
- **Account type**: **Internal**, **Customer / partner** or **Public**.
- **Account activation**: **Active** once the person has a password, **Not activated** while an invitation is pending.
- **Status**: **Active** or **Archived**.

Ready-made filters pick by account type and **Invitation pending**. **Company** and **Job role** keep only the people who work at that company or hold that role; choose the chosen item again to drop it. Archived people show only with **Include archived** on under **Filters**.

## Changing several people at once

When you may, each row has a checkbox. Check the rows, then select **Make active** or **Make inactive**. Each person is changed on their own, so the last full administrator is never made inactive. Moving to another page or changing the filters unchecks the rows.

${searching.en}

${states.en}`,
  },
} as const

export const roleListHelp = {
  vi: {
    title: 'Vai trò',
    source: `Màn hình này liệt kê các vai trò có sẵn mà Két Việt duy trì cho doanh nghiệp, mỗi vai trò là một tập quyền theo công việc. Bấm một dòng để mở vai trò: xem nó cho phép những gì, nguồn cấp quyền và ai đang giữ. Gán vai trò cho người dùng làm trên trang của người đó.

\`\`\`mermaid
flowchart TD
  A[Tìm, lọc<br>vai trò] --> B[Mở vai trò]
  B --> C{Tình trạng?}
  C -->|Đang có hiệu lực| D[Gán cho người<br>trên trang người dùng]
  C -->|Tạm thời chưa<br>thể gán| E[Báo quản trị viên]
  class D kv-positive
  class E kv-warning
\`\`\`

## Các cột

- **Lượt gán**: số lần vai trò đang được gán cho người dùng, mỗi phạm vi tính một lượt.
- **Nhóm quyền**: số nhóm quyền vai trò này mở.
- **Tình trạng**: **Đang có hiệu lực**, hoặc **Tạm thời chưa thể gán** khi vai trò cần được cập nhật theo mẫu mới; vai trò ở tình trạng này không gán thêm được.

Bộ lọc có sẵn: **Vai trò có sẵn**, **Tùy chỉnh**, **Tình trạng** (cần chú ý) và **Chưa gán cho ai**.

${searching.vi}

${states.vi}`,
  },
  en: {
    title: 'Roles',
    source: `This screen lists the standard roles Két Việt maintains for the business; each role is a set of permissions for a job. Select a row to open the role: what it allows, where its permissions come from and who holds it. Roles are assigned to a person on that person's page.

\`\`\`mermaid
flowchart TD
  A[Search and<br>filter roles] --> B[Open a role]
  B --> C{Health?}
  C -->|In effect| D[Assign it on<br>a person's page]
  C -->|Temporarily<br>unusable| E[Tell an administrator]
  class D kv-positive
  class E kv-warning
\`\`\`

## Columns

- **Assigned roles**: how many times the role is assigned to people; each scope counts once.
- **Areas**: how many permission areas the role opens.
- **Health**: **In effect**, or **Temporarily unusable** when the role must catch up with a newer template; a role in that state cannot be assigned again.

Ready-made filters: **Standard**, **Custom**, **Health** (needs attention) and **Unassigned**.

${searching.en}

${states.en}`,
  },
} as const

export const accessPolicyListHelp = {
  vi: {
    title: 'Tự động gán vai trò',
    source: `Mỗi quy tắc ở đây nói một lần: ai thuộc nhóm nhân sự, phòng ban hoặc chức danh này thì có những vai trò này, tại nơi này. Người khớp quy tắc nhận đủ các vai trò đó từ lần đăng nhập đầu tiên, không phải gán từng người. Bấm một dòng để mở quy tắc; **Tạo quy tắc** thêm quy tắc mới.

\`\`\`mermaid
flowchart TD
  A[Tạo hoặc mở<br>quy tắc] --> B[Chọn người theo<br>nhóm, phòng ban<br>hoặc chức danh]
  B --> C[Chọn vai trò<br>và nơi áp dụng]
  C --> D{Đang chạy?}
  D -->|Có| E[Người khớp nhận<br>vai trò]
  D -->|Tạm dừng| F[Không gán thêm]
  class E kv-positive
\`\`\`

## Các cột

- **Áp dụng cho**: điều kiện chọn người và giá trị khớp, như được ghi ở nguồn nhân sự.
- **Vai trò được gán** và **Áp dụng tại**: các vai trò quy tắc gán, ở công ty hoặc chi nhánh nào.
- **Số người**: số người đang khớp quy tắc.
- **Trạng thái**: **Đang hoạt động** hoặc **Tạm dừng**.

Bộ lọc có sẵn chọn theo **Nhóm nhân sự**, **Phòng ban**, **Chức danh** và **Tạm dừng**.

${searching.vi}

${states.vi}`,
  },
  en: {
    title: 'Access rules',
    source: `Each rule here says it once: whoever is in this staff group, department or job title holds these roles, at this place. A matching person gets every one of those roles from their first sign-in, without being assigned one at a time. Select a row to open the rule; **Create rule** adds a new one.

\`\`\`mermaid
flowchart TD
  A[Create or<br>open a rule] --> B[Match people by<br>group, department<br>or job title]
  B --> C[Choose roles<br>and where they apply]
  C --> D{Running?}
  D -->|Yes| E[Matching people<br>get the roles]
  D -->|Paused| F[No new assignments]
  class E kv-positive
\`\`\`

## Columns

- **Applies to**: the condition that picks people and the value it matches, as written in the staff source.
- **Roles given** and **Applies at**: the roles the rule gives, at which company or branch.
- **People**: how many people match the rule now.
- **Status**: **Active** or **Paused**.

Ready-made filters pick by **Staff group**, **Department**, **Job title** and **Paused**.

${searching.en}

${states.en}`,
  },
} as const
