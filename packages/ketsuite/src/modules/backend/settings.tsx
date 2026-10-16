import { EmptyState, HelpDrawer, MarkdownContent, SettingsDirectory } from '@ketvietlab/design-system'
import { marked } from 'marked'
import { html } from '@ketvietlab/ketjs-view'
import type { SettingsDirectoryModule } from '@ketvietlab/design-system'
import type { MenuNode, Route, ServeContext } from '@ketvietlab/ketjs'
import { icon } from '../../ui/icons.ts'
import { workspaceScreen } from '../../ui/layout.tsx'
import { adminPage, inLocale } from './screen.ts'

// The page the rail's gear opens. Every module hangs its configuration under the
// `admin` menu root: a heading with the module's icon and label, and one entry per
// configuration screen. The menu is already filtered by permission, so the page
// shows exactly what the viewer may open and nothing is decided here twice.

const guide = {
  vi: `## Tìm đúng cấu hình
Mỗi khối là một phân hệ: biểu tượng và tên của phân hệ, rồi các màn cấu hình của nó. **Kinh doanh** gồm cấu hình của các phân hệ bán hàng và chăm sóc; **Tổ chức & hệ thống** gồm người dùng, phân quyền, công ty và dữ liệu dùng chung.

Gõ vào **Tìm cấu hình** để lọc ngay, không cần dấu: gõ tên một mục để giữ mục đó, gõ tên phân hệ để giữ cả khối. **Esc** xóa ô tìm.

## Vì sao không thấy một phân hệ
Trang chỉ hiện những màn bạn được phép mở. Thiếu một khối hoặc một mục nghĩa là tài khoản chưa có quyền cấu hình phân hệ đó; quản trị viên cấp quyền trong **Người dùng & phân quyền**.

## Quay lại
Biểu tượng bánh răng cuối thanh ứng dụng luôn mở trang này và sáng khi bạn đang ở một màn cấu hình.`,
  en: `## Find the right setting
Each block is one module: its icon and name, then its configuration screens. **Business** holds the sales and care modules' configuration; **Organisation & system** holds users, access, companies and shared data.

Type in **Search settings** to filter at once, accents optional: a screen's name keeps that screen, a module's name keeps its whole block. **Esc** clears the search.

## Why a module is missing
The page shows only the screens you may open. A missing block or entry means your account has no configuration access to that module; an administrator grants it in **Users & access**.

## Getting back
The gear at the bottom of the app rail always opens this page and is lit while a configuration screen is open.`,
}

const help = (lang: string) => {
  const en = lang === 'en'
  return (
    <HelpDrawer
      id="backend-settings-help"
      label={en ? 'Screen help' : 'Hướng dẫn màn hình'}
      title={en ? 'Settings guide' : 'Hướng dẫn trang Cấu hình'}
      closeLabel={en ? 'Close help' : 'Đóng hướng dẫn'}
      body={
        <MarkdownContent
          source={en ? guide.en : guide.vi}
          lexer={marked.lexer}
          headingOffset={1}
          labels={{
            table: en ? 'Reference table' : 'Bảng tham khảo',
            diagram: en ? 'Workflow' : 'Quy trình',
            source: en ? 'View source' : 'Xem mã',
            loading: en ? 'Loading diagram…' : 'Đang tải sơ đồ…',
            error: en ? 'Diagram unavailable' : 'Chưa thể hiển thị sơ đồ',
          }}
        />
      }
    />
  )
}

/** Organisation-wide headings; every other heading is a business module's own configuration. */
const SYSTEM = new Set(['admin.access', 'admin.config'])

const links = (url: URL, nodes: readonly MenuNode[]): SettingsDirectoryModule['links'] =>
  nodes.flatMap((node) => [
    ...(node.path ? [{ id: node.id, label: node.label, href: inLocale(url, node.path) }] : []),
    ...links(url, node.children),
  ])

const moduleOf = (url: URL, node: MenuNode): SettingsDirectoryModule => ({
  id: node.id,
  label: node.label,
  icon: icon(node.icon ?? 'settings'),
  // A leaf hung straight on `admin` is a module of one screen.
  links: node.path ? links(url, [node]) : links(url, node.children),
})

const settings =
  (ctx: ServeContext): Route =>
  async (url, req) => {
    const admin = (await ctx.menu(url, req)).find((node) => node.id === 'admin')
    const modules = (admin?.children ?? []).map((node) => moduleOf(url, node)).filter((m) => m.links.length)
    return adminPage(ctx, url, req, {
      title: 'backend.settings.title',
      body: (_, frame) =>
        workspaceScreen({
          translator: _,
          // This page is where the gear leads, so the gear is lit here too.
          frame: {
            ...frame,
            applications: frame.applications && {
              ...frame.applications,
              helpLabel: frame.locale === 'en' ? 'Screen help' : 'Hướng dẫn màn hình',
              ...(frame.applications.settings?.href
                ? { settings: { ...frame.applications.settings, current: true } }
                : {}),
            },
          },
          title: _('backend.settings.title'),
          body: html`${
            modules.length ? (
              <SettingsDirectory
                id="backend-settings"
                label={_('backend.settings.title')}
                search={{
                  label: _('backend.settings.search'),
                  emptyTitle: _('backend.settings.noMatch'),
                  emptyMessage: _('backend.settings.noMatchHint'),
                }}
                sections={[
                  {
                    id: 'business',
                    title: _('backend.settings.business'),
                    modules: modules.filter((m) => !SYSTEM.has(m.id)),
                  },
                  {
                    id: 'system',
                    title: _('backend.settings.system'),
                    modules: modules.filter((m) => SYSTEM.has(m.id)),
                  },
                ]}
              />
            ) : (
              <EmptyState
                visual="locked"
                title={_('backend.settings.none')}
                message={_('backend.settings.noneHint')}
              />
            )
          }${help(frame.locale ?? 'vi')}`,
        }),
    })
  }

export { settings }
