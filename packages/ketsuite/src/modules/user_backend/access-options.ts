// Compatibility helpers for deployment-owned account creation workflows.
// Reads retain the caller's authorization and tenant/company scope.
import type { Route, ServeContext } from '@ketvietlab/ketjs'
type Req = Parameters<Route>[1]
type Row = Record<string, any>
const messages: Record<'vi' | 'en', Record<string, string>> = {
  vi: {
    E_ROLE_NOT_ASSIGNABLE: 'Có vai trò không còn khả dụng. Vui lòng chọn lại.',
    E_ROLE_ALREADY_ASSIGNED: 'Vai trò đã được gán tại phạm vi này.',
    E_ROLE_SELECTION_INVALID: 'Chọn một hoặc nhiều vai trò khác nhau.',
    E_ASSIGNMENT_MEMBERSHIP_REQUIRED: 'Chưa có nơi làm việc. Chọn thêm nơi làm việc còn thiếu.',
    E_ASSIGNMENT_SCOPE_INVALID: 'Chọn công ty và chi nhánh phù hợp.',
    E_MEMBERSHIP_FORBIDDEN: 'Bạn không có quyền bổ sung nơi làm việc.',
    E_AUTHORIZATION_REVISION_CONFLICT: 'Quyền vừa thay đổi. Kiểm tra lại nội dung trước khi xác nhận.',
    E_EMAIL_UNAVAILABLE: 'Email đã được sử dụng.',
    email_check_unavailable: 'Chưa kiểm tra được email. Vui lòng thử lại.',
    'user.error.loginUnique': 'Tên đăng nhập đã được sử dụng.',
    unique: 'Tên đăng nhập đã được sử dụng.',
    'user.error.required': 'Vui lòng điền đầy đủ thông tin.',
    fallback: 'Không thể lưu thay đổi. Kiểm tra lại thông tin.',
    none: 'Không thể lưu thay đổi.',
  },
  en: {
    E_ROLE_NOT_ASSIGNABLE: 'A role is no longer available. Choose again.',
    E_ROLE_ALREADY_ASSIGNED: 'The role is already given at this scope.',
    E_ROLE_SELECTION_INVALID: 'Choose one or more different roles.',
    E_ASSIGNMENT_MEMBERSHIP_REQUIRED: 'There is no workplace yet. Add the missing workplace.',
    E_ASSIGNMENT_SCOPE_INVALID: 'Choose a company and one of its branches.',
    E_MEMBERSHIP_FORBIDDEN: 'You may not add a workplace.',
    E_AUTHORIZATION_REVISION_CONFLICT: 'Permissions just changed. Check the details before you confirm.',
    E_EMAIL_UNAVAILABLE: 'This email is already in use.',
    email_check_unavailable: 'The email could not be checked. Try again.',
    'user.error.loginUnique': 'This sign-in name is already in use.',
    unique: 'This sign-in name is already in use.',
    'user.error.required': 'Fill in every required field.',
    fallback: 'The change could not be saved. Check the details.',
    none: 'The change could not be saved.',
  },
}
export const accessError = (
  result: { errors?: Array<{ field?: string; code: string }> },
  locale: 'vi' | 'en' = 'vi',
) => {
  const words = messages[locale]
  return (
    result.errors
      ?.map((e) => (e.code !== 'fallback' && e.code !== 'none' && words[e.code]) || words.fallback)
      .join(' ') ?? words.none
  )
}
export async function accessOptions(ctx: ServeContext, url: URL, req: Req) {
  const [companies, roles] = (await Promise.all([
    ctx.call('company.listCompanies', { includeArchived: false }, url, req),
    ctx.call('user.listRoles', {}, url, req),
  ])) as [Row[], Row[]]
  const branches = (
    await Promise.all(
      companies.map((c) =>
        ctx.call('company.listBranches', { companyId: c.id, includeArchived: false }, url, req),
      ),
    )
  ).flat() as Row[]
  return {
    translate: ctx.translate(ctx.localeOf(url, req)),
    companies: companies.map((c) => ({ id: String(c.id), name: String(c.name) })),
    branches: branches.map((b) => ({
      id: String(b.id),
      name: String(b.name),
      companyId: String(b.companyId),
      isRoot: b.isRoot === true,
    })),
    roles,
  }
}
