import { tr } from './i18n.mjs'
export const organizationRoutes = {
  organization: {
    get title() {
      return tr('flow.ui.organization')
    },
    get group() {
      return tr('flow.ui.organization')
    },
    pattern: 'workspace',
  },
  'organization-settings': {
    get title() {
      return tr('flow.ui.organization.settings')
    },
    get group() {
      return tr('flow.ui.organization')
    },
    pattern: 'workspace',
  },
  'organization-members': {
    get title() {
      return tr('flow.ui.organization.members')
    },
    get group() {
      return tr('flow.ui.organization')
    },
    pattern: 'list',
  },
  teams: {
    title: 'Team',
    get group() {
      return tr('flow.ui.organization')
    },
    pattern: 'list',
  },
  team: {
    get title() {
      return tr('flow.ui.team.members')
    },
    get group() {
      return tr('flow.ui.organization')
    },
    pattern: 'workspace',
  },
  workspaces: { title: 'Workspace', group: 'Workspace', pattern: 'list' },
  'workspace-overview': {
    get title() {
      return tr('flow.ui.workspace.overview')
    },
    group: 'Workspace',
    pattern: 'workspace',
  },
  'workspace-members': {
    get title() {
      return tr('flow.ui.workspace.members')
    },
    group: 'Workspace',
    pattern: 'workspace',
  },
  'project-members': {
    get title() {
      return tr('flow.ui.project.members')
    },
    get group() {
      return tr('flow.ui.projects')
    },
    pattern: 'workspace',
  },
  permissions: {
    get title() {
      return tr('flow.ui.roles.and.access.sources')
    },
    get group() {
      return tr('flow.ui.organization')
    },
    pattern: 'workspace',
  },
}
export const organizationForms = {
  'workspace-new': {
    get title() {
      return tr('flow.ui.create.workspace')
    },
    back: 'workspaces',
  },
  'workspace-edit': {
    get title() {
      return tr('flow.ui.workspace.settings')
    },
    back: 'workspace-overview',
  },
  'workspace-archive': {
    get title() {
      return tr('flow.ui.archive.workspace')
    },
    back: 'workspace-overview',
  },
  'member-invite': {
    get title() {
      return tr('flow.ui.invite.member')
    },
    back: 'organization-members',
  },
  'member-edit': {
    get title() {
      return tr('flow.ui.member.permissions')
    },
    back: 'organization-members',
  },
  'team-new': {
    get title() {
      return tr('flow.ui.create.team')
    },
    back: 'teams',
  },
  'team-edit': {
    get title() {
      return tr('flow.ui.edit.team')
    },
    back: 'teams',
  },
  'member-access': {
    get title() {
      return tr('flow.members.title')
    },
    back: 'workspace-members',
  },
  'access-grant': {
    get title() {
      return tr('flow.ui.grant.access')
    },
    back: 'workspace-members',
  },
  'project-move': {
    get title() {
      return tr('flow.ui.move.workspace')
    },
    back: 'settings',
  },
}
for (const [key, value] of Object.entries(organizationForms))
  organizationRoutes[key] = {
    get title() {
      return value.title
    },
    get group() {
      return tr('flow.ui.manage')
    },
    pattern: 'record',
  }
