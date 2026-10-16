import type { AppSwitcherProps } from '../layouts/shell/index.tsx'

export const exampleApplications: AppSwitcherProps = {
  label: 'Applications',
  newTabLabel: 'Open in a new tab',
  helpLabel: 'Screen help',
  settings: {
    id: 'example-app-settings',
    label: 'Settings',
    items: [
      { id: 'application', label: 'Application settings', href: '#settings-application' },
      { id: 'workspace', label: 'Workspace', href: '#settings-workspace' },
      { id: 'account', label: 'Account & access', href: '#settings-account' },
    ],
  },
  activeId: 'sales',
  items: [
    { id: 'sales', label: 'Sales', href: '#app-sales', icon: 'shopping-bag' },
    { id: 'stay', label: 'Stay', href: '#app-stay', icon: 'hotel' },
    { id: 'website', label: 'Website', href: '#app-website', icon: 'globe' },
    { id: 'flow', label: 'Flow', href: '#app-flow', icon: 'git-branch' },
    { id: 'accounting', label: 'Accounting', href: '#app-accounting', icon: 'calculator' },
  ],
}
