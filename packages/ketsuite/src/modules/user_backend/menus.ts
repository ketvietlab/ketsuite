import type { MenuDef } from '@ketvietlab/ketjs'

export const menus: Record<string, MenuDef> = {
  // Its own heading on the settings page, under the icon people recognise.
  'admin.access': { parent: 'admin', label: 'menu.access', icon: 'users', sequence: 80 },
  'admin.users': {
    parent: 'admin.access',
    label: 'menu.users',
    path: '/admin/users',
    needs: 'user.listUsers',
    requires: ['user.listRoles', 'company.listCompanies'],
    sequence: 25,
  },
  'admin.access-policies': {
    parent: 'admin.access',
    label: 'menu.policies',
    path: '/admin/access-policies',
    needs: 'user.listAccessPolicies',
    requires: ['user.listRoles', 'company.listCompanies'],
    sequence: 27,
  },
  'admin.roles': {
    parent: 'admin.access',
    label: 'menu.roles',
    path: '/admin/roles',
    needs: 'user.listRoles',
    sequence: 26,
  },
}
