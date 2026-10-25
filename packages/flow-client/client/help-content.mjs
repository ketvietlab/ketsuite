// Authored Markdown. The build compiles GFM tokens, so no Markdown parser is
// shipped in the list-screen startup bundle. Guides describe implemented flows.
export const flowHelpContent = {
  calendar: {
    routes: ['calendar'],
    vi: `## Theo dõi hạn công việc
Lịch hiển thị công việc theo ngày đến hạn trong dự án đang chọn. Chọn **Tuần** hoặc **Tháng**; dùng Trước, Hôm nay và Tiếp để đổi khoảng ngày. Các ngày đầu/cuối lưới ngoài tháng vẫn thuộc khoảng đang đọc.

## Xem đủ kết quả
- Bộ lọc trạng thái vẫn áp dụng cho lịch.
- Mở công việc từ ô ngày để xem chi tiết và sửa nếu có quyền.
- Công việc chưa có hạn nằm ở phần **Chưa có hạn** phía dưới.
- Khi còn trang dữ liệu, dùng **Hiển thị thêm**. Số đang hiển thị không phải tổng số; một ô ngày trống trong trang chưa tải hết chưa chứng minh ngày đó không có việc.

## Khi tải lỗi
Thử lại để đọc đúng khoảng ngày. Đổi tuần/tháng không thay đổi hạn của công việc; sửa hạn trong chi tiết và kiểm tra kết quả sau khi lưu.`,
    en: `## Track task deadlines
The calendar places tasks on their due dates within the selected project. Choose **Week** or **Month**, then Previous, Today or Next to change the period. Adjacent-month days displayed in the grid are included in the read.

## Read the complete result
- Status filters also apply to the calendar.
- Open a task from a day cell to inspect it and edit it when permitted.
- Tasks without a due date appear in **No due date** below the grid.
- Use **Show more** while another data page is available. Loaded rows are not the total; an empty day in an incomplete page does not prove that day has no tasks.

## Recovery
Retry failed reads for the selected period. Changing the week or month does not reschedule tasks. Edit a deadline in task detail and check the saved result.`,
  },
  forms: {
    routes: ['forms'],
    vi: `## Tiếp nhận yêu cầu trong dự án
Biểu mẫu tạo công việc từ thông tin người gửi nhập. Ở phần Quản lý, người có quyền cấu hình tạo tên, trường dữ liệu và thiết lập công việc được tạo.

## Gửi và theo dõi
- Lưu cấu hình và phát hành biểu mẫu trước khi nhận câu trả lời.
- Chọn biểu mẫu trong phần Gửi yêu cầu, nhập các trường bắt buộc rồi gửi một lần.
- Mở phần Câu trả lời để theo dõi yêu cầu và công việc liên quan.

## Kiểm tra kết quả
Lỗi xác thực hiển thị cạnh trường cần sửa. Nếu chưa nhận xác nhận, kiểm tra trạng thái trước khi gửi lại. Biểu mẫu chưa phát hành không nhận câu trả lời. Biểu mẫu nội bộ tuân theo quyền dự án; đây không phải đường dẫn công khai cho người ngoài.`,
    en: `## Collect requests inside a project
Forms turn submitted answers into tasks. In Manage, authorized project managers define the form name, fields and task defaults.

## Submit and follow up
- Save the definition and publish the form before collecting responses.
- Choose a form in Submit request, fill required fields and submit once.
- Open Responses to review submissions and their linked tasks.

## Check the outcome
Validation errors identify fields to correct. If confirmation is missing, check the result before retrying. Unpublished forms cannot accept answers. Internal forms follow project permissions; they are not public submission links for external visitors.`,
  },
  views: {
    routes: ['saved-views'],
    vi: `## Dùng lại cách xem công việc
View lưu bộ lọc và cách nhóm của danh sách để mở lại nhanh. Chọn view để đi đến danh sách với cấu hình đã lưu.

## Quản lý view
- Tại danh sách, đặt bộ lọc rồi chọn **Lưu view** và nhập tên dễ nhận biết.
- Kiểm tra dự án và phạm vi chia sẻ trước khi lưu.
- Chủ sở hữu hoặc người quản lý có quyền mới được chỉnh sửa hay lưu trữ view tương ứng.

## Khi dữ liệu thay đổi
View không sao chép công việc và không mở thêm quyền. Một view có thể trống khi công việc đã đổi trạng thái, bị lưu trữ hoặc quyền truy cập bị thu hồi. Xoá bộ lọc để kiểm tra; nếu lưu bị xung đột, đọc lại cấu hình trước khi sửa tiếp.`,
    en: `## Reuse a task view
A saved view keeps list filters and grouping so you can return to the same working context. Open a view to navigate to its configured list.

## Manage views
- Set filters in a list, select **Save view** and give it a recognizable name.
- Review the project and sharing scope before saving.
- Only the owner or an authorized manager can change or archive the corresponding view.

## When data changes
A view does not copy tasks or grant access. It may become empty when tasks change status, are archived or become inaccessible. Clear filters to investigate. After a conflicting save, reload the configuration before editing again.`,
  },
  tasks: {
    routes: [
      'my-work',
      'all-issues',
      'issue-filter',
      'board',
      'board-move',
      'project-issues',
      'filter-limit',
      'display',
      'bulk',
      'cmdk',
      'dashboard',
    ],
    vi: `## Xem và tìm công việc
Chọn Workspace hoặc dự án trong thanh bên. **Việc của tôi** chỉ hiển thị công việc được giao cho bạn. Dùng bộ lọc trạng thái, cách nhóm và thứ tự để thu hẹp danh sách.

## Thao tác
- Mở tên công việc để xem nội dung, người phụ trách, hạn và lịch sử.
- Dùng **Hiển thị thêm** ở nhóm hoặc cột để xem tiếp; số công việc đang hiện có thể nhỏ hơn tổng số.
- Bấm tìm kiếm ở thanh bên hoặc dùng **⌘K / Ctrl+K** để tìm trong phạm vi bạn được phép truy cập.
- Chọn các dòng trước khi dùng thao tác hàng loạt. Đọc kết quả từng công việc nếu chỉ một phần thành công.

## Công việc cần chú ý
Từ Tổng quan, mở số Bị chặn hoặc Quá hạn. Danh sách đọc toàn phạm vi được phép và tải 10 công việc mỗi lần; dùng Hiển thị thêm để xem tiếp. Công việc vừa bị chặn vừa quá hạn chỉ tính một lần. Sau xung đột, Thử lại tải lại từ đầu.

## Khi gặp vấn đề
Danh sách trống sau lọc: xoá bộ lọc hoặc đổi Workspace. Nếu tải lỗi, thử lại khi có mạng. Khi quyền thay đổi, mở lại màn; việc nhìn thấy công việc không đồng nghĩa với quyền sửa.`,
    en: `## Find your work
Choose a Workspace or project in the sidebar. **My tasks** shows work assigned to you. Narrow the collection with status filters, grouping and sort order.

## Work with the collection
- Open a task name to see its content, assignees, due date and history.
- Use **Show more** in a group or board column to continue; visible rows may be fewer than the total.
- Open sidebar search or press **⌘K / Ctrl+K** to search content you can access.
- Select rows before applying a bulk action. Review individual outcomes when only some tasks succeed.

## Work needing attention
Open Blocked or Overdue from Overview. The list reads the full authorized scope, ten tasks at a time; use Show more to continue. A task that is both blocked and overdue counts once. After a conflict, Retry restarts the list.

## Recovery
For a filtered empty list, clear filters or choose another Workspace. Retry failed reads when the connection returns. Reopen the screen after access changes; read access does not necessarily allow editing.`,
  },
  task: {
    routes: [
      'issue',
      'issue-new',
      'issue-move',
      'issue-sprint',
      'subtask-new',
      'dependency-new',
      'comment',
      'description',
      'issue-archive',
      'issues-archived',
      'subtask-link',
      'follow',
      'history',
      'issue-peek',
      'issue-child',
      'issue-link',
    ],
    vi: `## Làm việc với một công việc
Nhập tiêu đề khi tạo mới. Trong chi tiết, chỉnh nội dung, trạng thái, người phụ trách, độ ưu tiên và hạn theo quyền của bạn. Tìm người phụ trách theo tên hoặc email; **Thêm người** tải tiếp lựa chọn.

## Nội dung và quan hệ
- Nhãn và trường tùy chỉnh thuộc dự án của công việc. Nhãn đã lưu trữ vẫn có thể xuất hiện trên công việc cũ; bỏ nhãn khi không còn phù hợp.
- Thêm bình luận để trao đổi; dùng theo dõi để nhận cập nhật liên quan.
- Thêm công việc con hoặc phụ thuộc khi cần thể hiện quan hệ. Kiểm tra công việc chặn trước khi hoàn tất.
- Đính kèm tệp từ chi tiết và chờ thao tác hoàn tất trước khi rời màn.
- Xem lịch sử để biết thay đổi. Lưu trữ giữ bản ghi để có thể khôi phục, không phải đánh dấu hoàn thành. Nhập lý do trước khi xác nhận lưu trữ.

## Lưu và phục hồi
Theo dõi thông báo lưu hoặc lỗi cạnh trường. Nếu bản ghi đã được người khác sửa, tải lại bản mới rồi áp dụng thay đổi của bạn. Khi có cảnh báo rời màn, chọn ở lại để giữ nội dung chưa lưu.`,
    en: `## Work on a task
Enter a title when creating a task. In task details, update content, status, assignees, priority and dates according to your access. Search assignees by name or email; **More people** loads further choices.

## Content and relationships
- Labels and custom fields belong to the task’s project. Archived labels can remain on existing tasks; remove them when no longer applicable.
- Add comments for discussion and follow a task for relevant updates.
- Add subtasks or dependencies to express relationships. Review blocking work before completing a task.
- Attach files from task details and wait for the operation to finish before leaving.
- Review history for changes. Archiving retains a record for restoration; it does not complete the work. Enter a reason before confirming archive.

## Save and recover
Check save feedback and field errors. If another person changed the record, reload its latest version before applying your edit again. When a leave warning appears, stay on the screen to preserve unsaved input.`,
  },
  documents: {
    routes: ['pages', 'page-new', 'all-pages', 'page', 'page-child', 'page-move', 'page-archived'],
    vi: `## Viết tài liệu
Mở thư viện của Workspace hoặc dự án và chọn tài liệu trong cây. Tạo mới mở ngay trình soạn thảo với tên **Untitle**; tiêu đề trong nội dung được dùng để đặt tên tài liệu.

## Soạn và sắp xếp
- Chọn văn bản để dùng thanh định dạng nổi. Mục lục giúp chuyển đến các đề mục.
- Theo dõi trạng thái lưu trước khi đóng tài liệu. Giữ bản nháp nếu kết nối bị gián đoạn.
- Tạo tài liệu con hoặc chuyển vị trí khi có quyền sửa thư viện đích.
- Chọn khu vực lưu trữ để tìm tài liệu đã lưu trữ và khôi phục nếu được phép.

## Quyền truy cập
Tài liệu riêng tư và tài liệu dự án tuân theo phạm vi được cấp. Nếu liên kết bị từ chối, nhờ người quản lý kiểm tra quyền thay vì tạo bản sao nội dung không được phép.`,
    en: `## Write a document
Open a Workspace or project library and select a document in the tree. Creating a document opens the editor immediately as **Untitle**; its content title supplies the document name.

## Edit and organize
- Select text to use the floating formatting toolbar. Use the outline to jump between headings.
- Check save status before closing the document. Keep your draft when the connection is interrupted.
- Create child documents or move a document when you can edit its destination library.
- Open the archive to find archived documents and restore them when permitted.

## Access
Private and project documents follow their granted scope. If a link is refused, ask a manager to check access instead of copying content you are not authorized to use.`,
  },
  people: {
    routes: [
      'organization-members',
      'member-invite',
      'member-edit',
      'member-access',
      'access-grant',
      'access-revoke',
      'permissions',
      'workspace-members',
      'project-members',
      'invitation-accept',
      'teams',
      'team',
      'team-new',
      'team-edit',
    ],
    vi: `## Thành viên và quyền
Kiểm tra đúng Công ty, Workspace hoặc dự án trước khi thay đổi quyền. Danh sách tải theo từng phần; **Thêm người** mở tiếp thành viên và giữ số lượng tổng ở cuối danh sách.

## Quản lý
- Mời thành viên bằng địa chỉ email và vai trò phù hợp. Khách cần được cấp dự án cụ thể.
- Mở **Quản lý** để đổi vai trò hoặc thu hồi quyền Flow. Chủ sở hữu được bảo vệ khỏi thay đổi vai trò thông thường.
- Team giúp cấp quyền cho nhóm; kiểm tra cả quyền trực tiếp và quyền được kế thừa trước khi thu hồi một nguồn.
- Người nhận lời mời đăng nhập bằng tài khoản KetSuite chung rồi chấp nhận lời mời của mình.

## Kiểm tra kết quả
Quyền xem không cho phép quản trị. Nếu thông tin đã thay đổi, tải lại trước khi lưu. Thu hồi một grant có thể chưa loại bỏ quyền từ Team hoặc Workspace khác; kiểm tra các nguồn quyền còn lại.`,
    en: `## Members and access
Check the selected Company, Workspace or project before changing access. The directory loads in pages; **More people** continues the list and the footer shows its total.

## Manage access
- Invite a member with their email and an appropriate role. Guests need an explicit project grant.
- Open **Manage** to change a role or revoke Flow access. The owner is protected from ordinary role changes.
- Teams grant access to groups. Check both direct and inherited sources before removing a grant.
- Invitation recipients sign in with their shared KetSuite account and accept their own invitation.

## Check the outcome
Viewing does not allow administration. Reload changed information before saving again. Removing one grant may leave access through a Team or Workspace; review the remaining sources.`,
  },
  projects: {
    routes: [
      'projects',
      'project-new',
      'project-profile',
      'project-move',
      'project-archive',
      'project-delete',
      'organization',
      'workspaces',
      'workspace-new',
      'workspace-edit',
      'workspace-archive',
      'workspace-overview',
    ],
    vi: `## Tổ chức công việc
Công ty chứa các Workspace; mỗi dự án thuộc một Workspace. Dùng danh sách dự án để tìm và mở đúng phạm vi trước khi tạo công việc hoặc tài liệu.

## Quản lý phạm vi
- Tạo Workspace hoặc dự án khi được cấp quyền quản lý; nhập tên và mã dự án theo biểu mẫu.
- Mở hồ sơ dự án để sửa thông tin và cấu hình được phép. Các tab giữ bạn trong cùng dự án.
- Trong phần sở hữu và kế hoạch, chọn bảng hoặc danh sách làm màn mặc định. Lưu hồ sơ để các liên kết dự án dùng lựa chọn đó; ngày bắt đầu và kết thúc có thể để trống.
- Khi chuyển dự án, xem ảnh hưởng quyền và chọn cách xử lý trước khi xác nhận.
- Lưu trữ để ngừng sử dụng; đọc tác động trước các thao tác xoá không thể khôi phục.

## Theo dõi
Tổng quan giúp xem trạng thái và công việc cần chú ý. Mở công việc cụ thể để kiểm tra chi tiết. Nếu danh sách trống, kiểm tra Workspace hiện tại và quyền truy cập.`,
    en: `## Organize work
A Company contains Workspaces; each project belongs to a Workspace. Use the project directory to open the correct scope before creating work or documents.

## Manage a scope
- Create a Workspace or project when you have management access; enter the name and project code requested by the form.
- Open the project profile to edit permitted information and settings. Page tabs stay within the same project.
- Under ownership and planning, choose board or list as the default view. Save the profile so project links use that destination; start and target dates may remain empty.
- When moving a project, review its access impact and preservation choice before confirming.
- Archive unused scopes; read the impact before irreversible deletion actions.

## Follow progress
The overview highlights status and work needing attention. Open individual tasks to inspect details. For an empty list, check the current Workspace and your access.`,
  },
  catalogs: {
    routes: [
      'settings',
      'workspace-settings',
      'organization-settings',
      'column-edit',
      'type-edit',
      'field-edit',
      'tag-edit',
      'tags',
    ],
    vi: `## Cấu hình công việc
Kiểm tra phạm vi trước khi sửa trạng thái, loại công việc, nhãn hoặc trường tuỳ chỉnh. Cấu hình mặc định và cấu hình riêng của dự án có thể khác nhau.

## Thay đổi an toàn
- Đặt tên rõ ràng và chọn màu hoặc biểu tượng từ các lựa chọn sẵn có.
- Trạng thái biểu thị bước xử lý; kiểm tra ý nghĩa trước khi đổi hoặc sắp xếp.
- Trước khi lưu trữ hay thay cấu hình đang dùng, đọc công việc bị ảnh hưởng và lựa chọn chuyển giá trị nếu có.
- Chỉ khôi phục mặc định khi đã xem tác động tới cấu hình riêng của dự án.

## Xử lý lỗi
Sửa trường được đánh dấu nếu giá trị không hợp lệ. Khi cấu hình đã đổi ở nơi khác, tải lại rồi thực hiện lại. Nếu chỉ có quyền xem, nhờ người quản lý phạm vi cập nhật.`,
    en: `## Configure work
Check the scope before editing statuses, task types, labels or custom fields. Shared defaults and project overrides can differ.

## Make a safe change
- Use a clear name and choose colors or icons from the available controls.
- A status describes a workflow stage; review its meaning before changing or reordering it.
- Before archiving or replacing a definition in use, review affected work and any value-remapping choice.
- Restore defaults only after reviewing the impact on project overrides.

## Resolve errors
Correct highlighted invalid fields. Reload settings changed elsewhere before trying again. With view-only access, ask the scope manager to update them.`,
  },
  sprints: {
    routes: ['sprints', 'sprint-new', 'sprint-close', 'sprint-report'],
    vi: `## Lập kế hoạch Sprint
Tạo Sprint với tên, mục tiêu và khoảng ngày. Dùng date picker để chọn ngày; kiểm tra ngày kết thúc không trước ngày bắt đầu.

## Theo dõi và kết thúc
- Gán công việc từ dự án vào Sprint phù hợp và kiểm tra trạng thái thực hiện.
- Tổng công việc và điểm bao gồm toàn bộ Sprint. Danh sách tải từng trang; dùng Xem công việc hoặc Xem thêm để đọc các phần tiếp theo.
- Trước khi đóng Sprint, xem phần việc chưa hoàn tất và chọn đích xử lý theo biểu mẫu.
- Xem báo cáo sau khi đóng để đối chiếu kết quả với mục tiêu. Báo cáo giữ nguyên kết quả lúc đóng; Xem thêm tải các công việc lịch sử tiếp theo, không lấy giá trị hiện tại thay thế.

## Khi có xung đột
Nếu Sprint hoặc công việc đã thay đổi, tải lại trước khi xác nhận. Đóng Sprint không tự cấp quyền sửa công việc mà bạn không được quản lý.`,
    en: `## Plan a Sprint
Create a Sprint with a name, goal and date range. Use the date picker and check that the end is not before the start.

## Track and close
- Assign project tasks to the appropriate Sprint and review their status.
- Task and point totals cover the entire Sprint. Previews are paged; use Show tasks or Show more to read further work.
- Before closing, review unfinished work and choose its destination in the form.
- Open the closed Sprint report to compare results with its goal. It preserves the closing snapshot; Show more reads further historical tasks without replacing them with today's values.

## Conflicts
Reload if the Sprint or its tasks changed before confirmation. Closing a Sprint does not grant permission to edit work outside your access.`,
  },
  epics: {
    routes: ['epics', 'epic-new', 'all-epics', 'epic'],
    vi: `## Gom công việc thành Epic
Epic tập hợp công việc cùng mục tiêu trong dự án. Tạo Epic với tên, mô tả và người phụ trách phù hợp, rồi liên kết các công việc liên quan.

## Theo dõi
- Mở Epic để xem thông tin và công việc thuộc Epic.
- Cập nhật trạng thái từng công việc tại chi tiết; kiểm tra thay đổi trước khi kết luận Epic đã hoàn tất.
- Dùng danh sách Epic để chuyển giữa các mục tiêu bạn được phép xem.

## Phục hồi
Nếu liên kết không còn hợp lệ hoặc quyền đã đổi, tải lại. Thông tin rỗng có thể do chưa liên kết công việc, không có nghĩa là công việc đã bị xoá.`,
    en: `## Group work into an Epic
An Epic groups project work around a goal. Create it with a name, description and appropriate owner, then link related tasks.

## Follow the work
- Open an Epic to inspect its information and linked tasks.
- Update task status in task details and review changes before treating the Epic as complete.
- Use the Epic directory to move between goals you can access.

## Recovery
Reload when a link becomes invalid or access changes. An empty Epic may have no linked tasks; this does not mean tasks were deleted.`,
  },
  inbox: {
    routes: ['inbox'],
    vi: `## Xử lý thông báo
Inbox tập hợp cập nhật dành cho bạn. Chọn bộ lọc để xem thông báo cần xử lý và mở mục liên quan để đọc ngữ cảnh.

## Dọn Inbox
- Đánh dấu đã đọc sau khi xem; lưu trữ thông báo đã xử lý.
- Mở phần cài đặt cá nhân để chọn cách nhận thông báo được hỗ trợ.
- Nếu công việc đích không còn quyền truy cập, thông báo không cấp thêm quyền.

## Khi tải lỗi
Thử lại khi kết nối ổn định. Thao tác lỗi không được xem là đã hoàn tất; kiểm tra trạng thái sau khi tải lại.`,
    en: `## Handle notifications
Inbox collects updates addressed to you. Choose a filter for work needing attention and open the linked item for context.

## Clear the queue
- Mark an update read after reviewing it; archive notifications you have handled.
- Open personal settings to choose supported notification preferences.
- A notification does not grant access to a task whose permission was removed.

## Read failures
Retry when connected. A failed action is not complete; verify its state after reloading.`,
  },
  personal: {
    routes: ['personal-settings', 'timezone'],
    vi: `## Tuỳ chỉnh trải nghiệm
Chọn ngôn ngữ, giao diện và các lựa chọn cá nhân có trên màn hình. Múi giờ ảnh hưởng cách hiển thị thời gian; kiểm tra ngày hạn khi làm việc với nhóm ở múi giờ khác.

## Lưu lựa chọn
Áp dụng bằng nút lưu nếu biểu mẫu yêu cầu. Kiểm tra thông báo xác nhận hoặc lỗi trước khi rời màn. Cài đặt nhận thông báo chỉ điều khiển kênh đã được hệ thống hỗ trợ.

## Công ty và tài khoản
Dùng menu người dùng để chuyển Công ty hoặc mở phần quản lý được cấp quyền. Quyền và dữ liệu thay đổi theo Công ty đang chọn.`,
    en: `## Personalize your experience
Choose the language, appearance and personal options available on this screen. Timezone affects displayed times; check due dates when collaborating across timezones.

## Save preferences
Use Save when the form requires it. Check success or error feedback before leaving. Notification preferences apply only to channels supported by the system.

## Company and account
Use the user menu to switch Company or open administration you can access. Permissions and data follow the selected Company.`,
  },
  exchange: {
    routes: ['task-exchange', 'issue-copy', 'issue-transfer'],
    vi: `## Sao chép, chuyển và trao đổi công việc
Chọn đúng dự án nguồn và đích. Sao chép tạo bản ghi mới; chuyển thay đổi nơi quản lý công việc. Xem trước ánh xạ trạng thái, loại, nhãn và trường trước khi xác nhận.

## Kiểm tra dữ liệu
- Chỉ chọn dự án đích bạn được phép ghi.
- Khi nhập dữ liệu, kiểm tra lỗi từng dòng và sửa nội dung trước khi thử lại.
- Khi xuất, chỉ dữ liệu trong quyền truy cập của bạn được cung cấp.
- Giữ kết quả thao tác để đối chiếu những công việc đã thành công hoặc cần xử lý tiếp.

## Xung đột
Nếu bản ghi hay cấu hình đích đã đổi, tải lại phần xem trước. Không xác nhận dựa trên một bản xem trước đã lỗi thời.`,
    en: `## Copy, transfer and exchange tasks
Choose the source and destination projects. Copy creates a new record; transfer changes where the work is managed. Review status, type, label and field mappings before confirming.

## Check the data
- Choose a destination you can write to.
- For imports, review row errors and correct the data before retrying.
- Exports include only data within your access.
- Review the result to distinguish completed tasks from items requiring follow-up.

## Conflicts
Refresh the preview if the record or destination settings changed. Do not confirm against an outdated preview.`,
  },
}
