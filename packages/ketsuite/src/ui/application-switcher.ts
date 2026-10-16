import type { AppSwitcherProps } from '@ketvietlab/design-system'
import type { MenuNode } from '@ketvietlab/ketjs'

const destination = (node?: MenuNode): string | undefined =>
  node?.path ?? node?.children.map(destination).find(Boolean)

const hasLink = (nodes: readonly MenuNode[]): boolean =>
  nodes.some((node) => !!node.path || hasLink(node.children))

/** The page the rail's gear opens: every module's configuration the viewer may open. */
export const SETTINGS_PATH = '/admin/settings'

/** Keep existing route permissions; apps live in the rail and configuration on the settings page. */
export const suiteMainMenu = (menu: readonly MenuNode[]): MenuNode[] =>
  menu.filter((node) => !['accounting', 'admin', 'website'].includes(node.id))

/** The deployment's permitted menu supplies destinations; no domain or URL is guessed. */
export const suiteApplications = (
  menu: readonly MenuNode[],
  _: (key: string) => string,
  activeId = 'sales',
): AppSwitcherProps => {
  // Configuration hangs under the `admin` root; the gear appears once any of it is permitted,
  // and lights while a configuration screen (an active admin entry) is open.
  const admin = menu.find((node) => node.id === 'admin')
  const sale = destination(menu.find((node) => node.id === 'sale'))
  const website = destination(menu.find((node) => node.id === 'website'))
  return {
    label: _('backend.apps.label'),
    newTabLabel: _('backend.apps.newTab'),
    activeId,
    brand: {
      label: _('backend.brand'),
      href: activeId === 'website' ? (website ?? '/website') : '/admin',
      // The app rail stays graphite in both themes.
      image: '/_ket/asset/backend/brand/logo-dark.png',
    },
    navigation: {
      controls: activeId === 'website' ? 'website-navigation-drawer' : 'backend-navigation-drawer',
      label: _('backend.apps.expandMenu'),
      tools: {
        searchLabel: _('backend.apps.searchMenu'),
        searchPlaceholder: _('backend.nav.search'),
        emptyLabel: _('backend.nav.noMatch'),
        collapseLabel: _('backend.apps.collapseMenu'),
      },
    },
    settings:
      admin && hasLink(admin.children)
        ? {
            id: 'app-switcher-settings',
            label: _('backend.apps.settings'),
            href: SETTINGS_PATH,
            current: admin.active,
          }
        : undefined,
    items: [
      {
        id: 'sales',
        label: _('backend.apps.sales'),
        icon: 'shopping-bag',
        href: sale,
        unavailableLabel: _('backend.apps.unavailable'),
      },
      {
        id: 'accounting',
        label: _('backend.apps.accounting'),
        icon: 'calculator',
        unavailableLabel: _('backend.apps.comingSoon'),
      },
      {
        id: 'website',
        label: _('backend.apps.website'),
        icon: 'globe',
        href: website,
        unavailableLabel: _('backend.apps.unavailable'),
      },
      {
        id: 'flow',
        label: _('backend.apps.flow'),
        icon: 'git-branch',
        unavailableLabel: _('backend.apps.comingSoon'),
      },
      {
        id: 'phone',
        label: _('backend.apps.phone'),
        icon: 'phone',
        unavailableLabel: _('backend.apps.comingSoon'),
      },
      {
        id: 'chat',
        label: _('backend.apps.chat'),
        icon: 'message-circle',
        unavailableLabel: _('backend.apps.comingSoon'),
      },
    ],
  }
}

/** Placeholder destinations only. Deployment composition supplies the real app registry. */
export const placeholderApplications = (activeId = 'sales', locale = 'vi'): AppSwitcherProps => ({
  label: locale === 'en' ? 'Applications' : 'Ứng dụng',
  newTabLabel: locale === 'en' ? 'Open in a new tab' : 'Mở trong tab mới',
  helpLabel: locale === 'en' ? 'Screen help' : 'Hướng dẫn màn hình',
  settings: {
    id: 'app-switcher-settings',
    label: locale === 'en' ? 'Settings' : 'Cài đặt',
    items: [
      {
        id: 'application',
        label: locale === 'en' ? 'Application settings' : 'Cài đặt ứng dụng',
        href: '#settings-application',
      },
      {
        id: 'workspace',
        label: locale === 'en' ? 'Workspace' : 'Không gian làm việc',
        href: '#settings-workspace',
      },
      {
        id: 'account',
        label: locale === 'en' ? 'Account & access' : 'Tài khoản & quyền',
        href: '#settings-account',
      },
    ],
  },
  activeId,
  items: [
    { id: 'sales', label: 'Sales', href: '#app-sales', icon: 'shopping-bag' },
    { id: 'stay', label: 'Stay', href: '#app-stay', icon: 'hotel' },
    { id: 'website', label: 'Website', href: '#app-website', icon: 'globe' },
    { id: 'flow', label: 'Flow', href: '#app-flow', icon: 'git-branch' },
    {
      id: 'accounting',
      label: locale === 'en' ? 'Accounting' : 'Kế toán',
      href: '#app-accounting',
      icon: 'calculator',
    },
  ],
})
