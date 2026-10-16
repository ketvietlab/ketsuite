import { routes } from './routes.mjs'
import { tr } from './i18n.mjs'
import { isDone } from './project-catalogs.mjs'
import { html, each, signal } from '@ketvietlab/ketjs-view'
import { FlowButton, FlowInput, FlowStatus, FlowSelect, FlowEmpty, FlowTag } from '@ketvietlab/flow-ui'
import {
  FlowTagPicker,
  FlowDisclosure,
  FlowListItem,
  FlowHint,
  FlowCheckboxField,
  FlowSection,
  FlowStack,
  FlowInline,
  FlowNotice,
  FlowMetrics,
  FlowSelectField,
  FlowTextarea,
  FlowAccessList,
  FlowToolbar,
  FlowEvidenceTable,
  FlowEvidenceValue,
  FlowEvidencePerson,
  FlowProperties,
} from '@ketvietlab/flow-ui/workspace'
import { accessFor, canManageScope, roleLabel } from './access-model.mjs'
import { workspaceRecordRoutes } from './navigation.mjs'
import { createWorkspaceOverview } from './workspace-overview.mjs'
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
export function createOrganization(ctx) {
  const grantScope = signal(''),
    grantSubject = signal(''),
    accessChoice = signal(''),
    inviteRole = signal('member'),
    memberQuery = signal(''),
    grantPeople = signal([]),
    workspaceAccess = signal('')
  let inviteEmail = ''
  const target = signal(''),
    preserve = signal(false),
    preview = signal(null),
    previewError = signal(''),
    previewBusy = signal(false)
  let previewRequest = 0
  const overview = createWorkspaceOverview(ctx)
  const d = ctx.data,
    w = () => d().workspaces?.find((w) => w.id === ctx.workspaceId()),
    p = () => d().projects.find((p) => p.id === ctx.projectId())
  const fieldError = (props) => props.error ?? ctx.formError?.()?.[props.name ?? props.id]
  const input = (props) => FlowInput({ ...props, error: fieldError(props) })
  const textarea = (props) => FlowTextarea({ ...props, error: fieldError(props) })
  const selectField = (props) => FlowSelectField({ ...props, error: fieldError(props) })
  const stack = (...children) =>
    FlowStack({
      children: html`${each(
        children,
        (_, i) => i,
        (x) => html`${x}`,
      )}`,
    })
  const inline = (...children) =>
    FlowInline({
      children: html`${each(
        children,
        (_, i) => i,
        (x) => html`${x}`,
      )}`,
      align: 'end',
    })
  const button = (label, onClick, primary = false, disabled = false) =>
    FlowButton({ label, onClick, variant: primary ? 'primary' : 'secondary', size: 'sm', disabled })
  const nav = (key, label, params = {}, primary = false) =>
    button(label, () => ctx.navigate(key, params), primary)
  const notice = (title, message, tone = 'neutral', action) =>
    tone === 'neutral'
      ? FlowListItem({ title, description: message, actions: action })
      : FlowNotice({ title, message, tone, action })
  const manage = (scope = 'company', id = d().company.id) => ctx.canWrite() && canManageScope(d(), scope, id)
  const denied = () =>
    FlowEmpty({
      title: tr('flow.ui.you.have.view.only.access'),
      description: tr('flow.ui.admin.access.in.this.scope.is.required.to.change.settings'),
    })
  const run = (action, args = {}, success) =>
    ctx.mutate(
      'flow.organization.command',
      { action, expectedRevision: d().organizationRevision, ...args },
      success,
    )
  const confirmRun = (title, message, label, action, args, success, tone = 'danger') =>
    ctx.confirmAction({ title, message, label, tone, action: () => run(action, args, success) })
  const form = (
    body,
    save,
    label = tr('flow.ui.save.changes'),
    disabled = false,
    separateActions = false,
    showCancel = ctx.isModal?.(),
  ) => {
    const footer = inline(
      showCancel
        ? FlowButton({ label: tr('flow.ui.cancel'), onClick: ctx.close, disabled: ctx.busy() })
        : null,
      FlowButton({
        label,
        type: 'submit',
        form: separateActions ? 'flow-organization-modal-form' : undefined,
        variant: 'primary',
        loading: ctx.busy(),
        disabled: !ctx.canWrite() || disabled,
      }),
    )
    const content = html`<form id=${separateActions ? 'flow-organization-modal-form' : null} on:submit=${(
      e,
    ) => {
      e.preventDefault()
      save(Object.fromEntries(new FormData(e.currentTarget)))
    }}>${stack(body, separateActions ? null : footer)}</form>`
    return separateActions ? { body: content, footer } : content
  }
  const select = (name, label, value, options) => selectField({ name, label, value, options })
  const roles = [
    { value: 'viewer', label: tr('flow.ui.view.only') },
    { value: 'editor', label: tr('flow.ui.edit') },
    { value: 'admin', label: tr('flow.ui.admin') },
  ]
  const mt = (key, args) => tr('flow.members.' + key, args)
  const scopeTarget = (scope, id) =>
    scope === 'project'
      ? d().projects.find((x) => x.id === id)
      : d().workspaces.some((x) => x.id === id)
        ? { id: 'workspace-preview', companyId: d().company.id, workspaceId: id, access: 'workspace' }
        : null
  const teamsOf = (m) => d().teams.filter((t) => !t.archived && t.memberIds.includes(m.id))
  /** The page's primary action lives in the shell topbar; people are found through the sidebar Spotlight. */
  const topAction = (key) => {
    const scope = key === 'project-members' ? 'project' : key === 'workspace-members' ? 'workspace' : null,
      id = scope === 'project' ? p()?.id : scope ? w()?.id : null
    return id && manage(scope, id)
      ? FlowButton({
          label: tr('flow.ui.grant.permissions'),
          icon: 'plus',
          variant: 'primary',
          size: 'sm',
          disabled: ctx.busy(),
          onClick: () => ctx.navigate('access-grant', { accessScope: scope, target: id }),
        })
      : null
  }
  const members = (scope, id) => {
    const editable = manage(scope, id),
      target = scopeTarget(scope, id)
    const all = target
        ? d()
            .members.filter((m) => m.status === 'active')
            .map((m) => ({ m, a: accessFor(d(), target, m.id) }))
        : [],
      withAccess = all.filter((x) => x.a.role)
    // People are found through the sidebar Spotlight; the table lists everyone with access here.
    const rows = withAccess
    const open = (m) => ctx.navigate('member-access', { id: m.id, accessScope: scope, target: id })
    const grant = nav(
      'access-grant',
      tr('flow.ui.grant.permissions'),
      { accessScope: scope, target: id },
      true,
    )
    const columns = [
      { id: 'member', label: mt('member'), size: 'wide' },
      { id: 'role', label: mt('role') },
      { id: 'via', label: mt('via') },
      { id: 'teams', label: mt('teams') },
      { id: 'org', label: mt('orgRole') },
    ]
    const table = FlowEvidenceTable({
      label: mt('member'),
      actionsLabel: mt('rowActions'),
      columns,
      total: mt('total', [withAccess.length, all.length - withAccess.length]),
      rows: rows.map(({ m, a }) => ({
        id: m.id,
        onOpen: () => open(m),
        actions: FlowButton({
          label: editable ? tr('flow.ui.manage') : mt('view'),
          size: 'sm',
          variant: 'ghost',
          onClick: () => open(m),
        }),
        cells: {
          member: FlowEvidencePerson({ name: m.name, meta: m.email, onOpen: () => open(m) }),
          role: FlowEvidenceValue({
            value: FlowTag({ label: roleLabel(a.role), tone: a.role === 'admin' ? 'blue' : 'neutral' }),
          }),
          via: FlowEvidenceValue({
            value: a.sources[0]?.label,
            meta: a.sources.length > 1 ? mt('more', [a.sources.length - 1]) : null,
            hint: a.sources.map((x) => x.label + ' · ' + roleLabel(x.role)).join('\n'),
          }),
          teams: FlowEvidenceValue({
            value:
              teamsOf(m)
                .map((t) => t.title)
                .join(', ') || '—',
          }),
          org: FlowEvidenceValue({ value: roleLabel(m.role) }),
        },
      })),
    })
    return FlowSection({
      children: stack(
        scope === 'project'
          ? FlowToolbar({
              inset: 'none',
              trailing: FlowSelect({
                label: tr('flow.ui.project.access'),
                value: accessChoice() || p()?.access || 'private',
                disabled: !editable,
                options: [
                  { value: 'workspace', label: tr('flow.ui.inherit.workspace') },
                  { value: 'private', label: tr('flow.ui.restricted.members') },
                ],
                onChange: (e) => accessChoice.set(e.target.value),
              }),
            })
          : null,
        !withAccess.length
          ? FlowEmpty({
              title: mt('nobody'),
              description: mt('nobodyDetail'),
              action: editable ? grant : null,
            })
          : table,
        scope === 'project' && accessChoice() && accessChoice() !== p().access
          ? FlowDisclosure({
              title: tr('flow.ui.preview.permission.changes'),
              open: true,
              children: stack(
                ...d()
                  .members.filter((m) => m.status === 'active')
                  .map((m) => ({
                    m,
                    before: accessFor(d(), p(), m.id),
                    after: accessFor(d(), { ...p(), access: accessChoice() }, m.id),
                  }))
                  .filter((x) => x.before.role !== x.after.role)
                  .map((x) =>
                    FlowListItem({
                      title: x.m.name,
                      description: roleLabel(x.before.role) + ' → ' + roleLabel(x.after.role),
                    }),
                  ),
                inline(
                  button(tr('flow.ui.cancel'), () => accessChoice.set('')),
                  button(
                    tr('flow.ui.apply.access.permissions'),
                    () => run('project.access', { id, access: accessChoice() }, () => accessChoice.set('')),
                    true,
                  ),
                ),
              ),
            })
          : null,
      ),
    })
  }
  const projectCards = (projects) =>
    projects.length
      ? stack(
          ...projects.map((project) =>
            notice(
              project.title,
              `${project.code} · ${d().members.find((m) => m.id === project.ownerId)?.name ?? tr('flow.ui.no.owner.assigned')} · ${project.end ?? tr('flow.ui.no.milestone.set')} · ${project.access === 'private' ? tr('flow.ui.restricted.members') : tr('flow.ui.inherit.workspace')}`,
              'neutral',
              inline(
                nav('board', tr('flow.ui.open.project'), {
                  project: project.id,
                  workspace: project.workspaceId,
                }),
                nav('project-members', tr('flow.ui.access.1747ab'), {
                  project: project.id,
                  workspace: project.workspaceId,
                }),
              ),
            ),
          ),
        )
      : FlowEmpty({
          title: tr('flow.ui.no.projects.in.this.workspace'),
          description: tr('flow.ui.create.your.first.project.to.start.collaborating'),
          action: manage('workspace', w()?.id)
            ? nav('project-new', tr('flow.ui.create.project'), {}, true)
            : null,
        })
  const view = (key) => {
    if (!d().workspaces)
      return FlowEmpty({
        title: tr('flow.ui.workspace.structure.unavailable'),
        description: tr('flow.ui.the.data.source.needs.organization.and.workspace.information'),
      })
    if (key === 'organization')
      return FlowSection({
        title: d().company.name,
        actions: nav('organization-settings', tr('flow.ui.organization.settings')),
        children: stack(
          notice(
            tr('flow.ui.tasks.needing.action'),
            tr('flow.ui.pending.invitations', [
              d().invitations.filter((i) => i.status === 'pending').length,
              '',
            ]),
          ),
          FlowMetrics({
            inset: 'none',
            items: [
              { label: 'Workspace', value: d().workspaces.length },
              { label: tr('flow.ui.accessible.projects'), value: d().projects.length },
              { label: 'Team', value: d().teams.filter((team) => !team.archived).length },
            ],
          }),
          inline(
            nav('workspaces', 'Xem Workspace'),
            nav('organization-members', tr('flow.ui.member')),
            nav('teams', 'Team'),
            routes['organization-integrations']
              ? nav('organization-integrations', tr('flow.ui.integrations'))
              : null,
          ),
          notice(
            tr('flow.ui.flow.permissions.are.separate.from.erp'),
            tr('flow.ui.joining.flow.does.not.automatically.grant.access.to.erp.data'),
          ),
        ),
      })
    if (key === 'workspaces')
      return FlowSection({
        title: tr('flow.ui.organization.workspaces'),
        actions: manage() ? nav('workspace-new', tr('flow.ui.create.workspace'), {}, true) : null,
        children: d().workspaces.length
          ? stack(
              ...d().workspaces.map((ws) =>
                notice(
                  ws.title,
                  `${ws.description} · ${d().projects.filter((p) => p.workspaceId === ws.id).length} Project`,
                  'neutral',
                  button(tr('flow.ui.open.workspace'), () => ctx.switchWorkspace(ws.id)),
                ),
              ),
            )
          : FlowEmpty({
              title: tr('flow.ui.no.workspaces.yet'),
              description: tr('flow.ui.create.the.organization.s.first.workspace'),
            }),
      })
    if (key === 'workspace-overview') {
      if (!w())
        return FlowEmpty({
          title: tr('flow.ui.select.workspace'),
          description: tr('flow.ui.the.data.source.needs.organization.and.workspace.information'),
        })
      return FlowSection({
        title: w().title,
        description: w().description,
        actions: inline(
          nav('workspace-members', tr('flow.ui.member')),
          manage('workspace', w().id) ? nav('workspace-edit', tr('flow.ui.settings')) : null,
        ),
        children: overview.view({
          workspace: w(),
          empty: projectCards([]),
          canCreate: manage('workspace', w().id),
        }),
      })
    }
    if (key === 'organization-members')
      return FlowSection({
        title: tr('flow.ui.members.and.invitations'),
        actions: manage() ? nav('member-invite', tr('flow.ui.invite.member'), {}, true) : null,
        children: stack(
          input({
            id: 'member-search',
            label: tr('flow.ui.search.members'),
            value: memberQuery(),
            placeholder: tr('flow.ui.name.or.email'),
            onInput: (e) => memberQuery.set(e.target.value),
          }),
          FlowAccessList({
            rows: d()
              .members.filter((m) =>
                (m.name + ' ' + m.email).toLocaleLowerCase().includes(memberQuery().toLocaleLowerCase()),
              )
              .map((m) => ({
                id: m.id,
                name: m.name,
                role: roleLabel(m.role),
                sources: m.email,
                status:
                  m.status === 'revoked'
                    ? tr('flow.ui.access.revoked')
                    : m.role === 'guest'
                      ? tr('flow.ui.granted.projects.only')
                      : tr('flow.ui.active'),
                actions:
                  manage() && m.role !== 'owner'
                    ? nav('member-edit', tr('flow.ui.manage'), { id: m.id })
                    : null,
              })),
          }),
          FlowSection({
            inset: 'none',
            title: tr('flow.ui.invitations'),
            children: d().invitations.length
              ? stack(
                  ...d().invitations.map((i) =>
                    notice(
                      i.email,
                      `${roleLabel(i.role)} · ${i.status === 'pending' ? tr('flow.ui.awaiting.acceptance') : tr('flow.ui.revoked')}${i.projectId ? ' · ' + d().projects.find((p) => p.id === i.projectId)?.title : ''}`,
                      'neutral',
                      manage() && i.status === 'pending'
                        ? inline(
                            button(tr('flow.ui.resend'), () => run('invitation.resend', { id: i.id })),
                            button(tr('flow.ui.revoke.invitation'), () =>
                              confirmRun(
                                tr('flow.ui.revoke.invitation'),
                                tr('flow.organization.confirmInvitationRevoke', [i.email]),
                                tr('flow.ui.revoke.invitation'),
                                'invitation.revoke',
                                { id: i.id },
                              ),
                            ),
                          )
                        : null,
                    ),
                  ),
                )
              : FlowEmpty({
                  title: tr('flow.ui.no.pending.invitations'),
                  description: tr('flow.ui.new.invitations.will.appear.here'),
                }),
          }),
        ),
      })
    if (key === 'teams')
      return FlowSection({
        title: tr('flow.ui.teams.groups.of.people'),
        actions: manage() ? nav('team-new', tr('flow.ui.create.team'), {}, true) : null,
        children: stack(
          notice(
            tr('flow.ui.teams.do.not.contain.projects'),
            tr('flow.ui.a.team.can.have.access.to.multiple.workspaces.and.projects.in.the.same.organizat'),
          ),
          ...d()
            .teams.filter((t) => !t.archived)
            .map((t) =>
              notice(
                t.title,
                tr('flow.ui.members.granted.scopes', [
                  t.memberIds.length,
                  d().grants.filter((g) => g.subjectType === 'team' && g.subjectId === t.id).length,
                  t.description,
                ]),
                'neutral',
                nav('team', tr('flow.ui.manage.team'), { id: t.id }),
              ),
            ),
        ),
      })
    if (key === 'team') {
      const team = d().teams.find((t) => t.id === ctx.record())
      if (!team || team.archived)
        return FlowEmpty({
          title: tr('flow.ui.team.not.found'),
          description: tr('flow.ui.this.team.does.not.exist.or.you.cannot.view.it'),
          action: nav('teams', organizationRoutes.teams.title),
        })
      return FlowSection({
        title: team.title,
        actions: manage() ? nav('team-edit', tr('flow.ui.edit.team'), { id: team.id }) : null,
        children: stack(
          notice(tr('flow.ui.people.in.the.organization'), team.description),
          FlowAccessList({
            rows: d()
              .members.filter((m) => team.memberIds.includes(m.id))
              .map((m) => ({
                id: m.id,
                name: m.name,
                role: roleLabel(m.role),
                sources: tr('flow.ui.team.members'),
                actions: manage()
                  ? button(tr('flow.ui.remove.from.team'), () =>
                      confirmRun(
                        tr('flow.ui.remove.from.team'),
                        tr('flow.organization.confirmTeamRemoval', [m.name]),
                        tr('flow.ui.remove.from.team'),
                        'team.member',
                        { id: team.id, memberId: m.id, remove: true },
                      ),
                    )
                  : null,
              })),
          }),
          manage()
            ? form(
                stack(
                  FlowHint({
                    children:
                      tr('flow.ui.new.members.will.receive.access.to') +
                      (d()
                        .grants.filter((g) => g.subjectType === 'team' && g.subjectId === team.id)
                        .map(
                          (g) =>
                            (g.scope === 'workspace' ? d().workspaces : d().projects).find(
                              (x) => x.id === g.targetId,
                            )?.title,
                        )
                        .join(', ') || tr('flow.ui.no.scopes.granted')),
                  }),
                  select('memberId', tr('flow.ui.add.member'), '', [
                    { value: '', label: tr('flow.ui.select.member') },
                    ...d()
                      .members.filter(
                        (m) => m.role !== 'guest' && m.status === 'active' && !team.memberIds.includes(m.id),
                      )
                      .map((m) => ({ value: m.id, label: m.name })),
                  ]),
                ),
                (v) => run('team.member', { id: team.id, ...v }),
                tr('flow.ui.add.to.team'),
              )
            : null,
          FlowSection({
            inset: 'none',
            title: tr('flow.ui.granted.scopes'),
            actions: manage()
              ? nav('access-grant', tr('flow.ui.grant.team.access'), { team: team.id })
              : null,
            children: stack(
              ...d()
                .grants.filter((g) => g.subjectType === 'team' && g.subjectId === team.id)
                .map((g) =>
                  notice(
                    (g.scope === 'workspace' ? d().workspaces : d().projects).find((x) => x.id === g.targetId)
                      ?.title ?? g.targetId,
                    `${g.scope === 'workspace' ? 'Workspace' : tr('flow.ui.project')} · ${roleLabel(g.role)}`,
                  ),
                ),
            ),
          }),
        ),
      })
    }
    if (key === 'workspace-members') return members('workspace', w()?.id)
    if (key === 'project-members')
      return p()
        ? members('project', p().id)
        : FlowEmpty({
            title: tr('flow.ui.select.project'),
            description: tr('flow.ui.open.an.accessible.project.to.manage.its.members'),
          })
    if (key === 'organization-settings')
      return FlowSection({
        title: tr('flow.ui.organization.information'),
        children: stack(
          manage()
            ? form(
                stack(
                  input({
                    id: 'title',
                    label: tr('flow.ui.organization.name'),
                    value: d().company.name,
                    required: true,
                  }),
                  notice(
                    tr('flow.ui.company.means.organization'),
                    tr(
                      'flow.ui.the.organization.name.is.shared.across.flow.erp.permissions.are.managed.separate',
                    ),
                  ),
                ),
                (v) => run('company.save', v),
              )
            : null,
          ...(ctx.settingsSection?.(key) ?? []),
          FlowSection({
            inset: 'none',
            title: tr('flow.review.library'),
            children: stack(
              FlowSection({
                inset: 'none',
                title: tr('flow.ui.task.statuses.organization'),
                actions: manage() ? nav('column-edit', tr('flow.ui.add.status')) : null,
                children: stack(
                  ...d()
                    .columns.filter((c) => !c.projectId)
                    .map((c) =>
                      FlowListItem({
                        title: FlowStatus({ status: c.kind, label: c.label, color: c.color }),
                        actions: manage() ? nav('column-edit', tr('flow.ui.edit'), { id: c.id }) : null,
                      }),
                    ),
                ),
              }),
              FlowSection({
                inset: 'none',
                title: tr('flow.ui.task.types.organization'),
                actions: manage() ? nav('type-edit', tr('flow.ui.add.type')) : null,
                children: stack(
                  ...d().types.map((t) =>
                    FlowListItem({
                      title: t.title,
                      actions: manage() ? nav('type-edit', tr('flow.ui.edit'), { id: t.id }) : null,
                    }),
                  ),
                ),
              }),
              FlowSection({
                inset: 'none',
                title: tr('flow.ui.custom.fields.organization'),
                actions: manage() ? nav('field-edit', tr('flow.ui.add.field')) : null,
                children: stack(
                  ...d().fields.map((f) =>
                    FlowListItem({
                      title: f.title,
                      actions: manage() ? nav('field-edit', tr('flow.ui.edit'), { id: f.id }) : null,
                    }),
                  ),
                ),
              }),
              nav('tags', tr('flow.ui.shared.labels')),
              nav('timezone', tr('flow.ui.organization.timezone')),
            ),
          }),
        ),
      })
    if (key === 'permissions')
      return FlowSection({
        title: tr('flow.ui.roles.and.access.sources'),
        children: stack(
          ...[
            [
              tr('flow.ui.organization.owner.admin'),
              tr('flow.ui.manage.workspaces.teams.members.and.connections.project.content.access.still.dep'),
            ],
            [
              tr('flow.ui.organization.member'),
              tr('flow.ui.access.internal.workspaces.or.granted.scopes.restricted.projects.are.not.visible'),
            ],
            [
              tr('flow.ui.workspace.admin.member.viewer'),
              tr('flow.ui.manage.edit.or.view.inherited.projects.does.not.grant.access.to.restricted.proje'),
            ],
            [
              tr('flow.ui.project.admin.editor.viewer'),
              tr('flow.ui.manage.members.work.or.read.guests.only.access.granted.projects'),
            ],
            [
              tr('flow.ui.team.access.source'),
              tr('flow.ui.team.permissions.combine.with.direct.and.workspace.access.removing.one.source.pr'),
            ],
          ].map(([title, message]) => notice(title, message)),
        ),
      })
    return null
  }
  const modalContent = (key, form, separateActions) => {
    const ws =
        workspaceRecordRoutes.has(key) && ctx.recordProvided?.()
          ? d().workspaces.find((workspace) => workspace.id === ctx.record() && !workspace.archived)
          : w(),
      project = p(),
      params = ctx.params(),
      entity = d().members.find((m) => m.id === ctx.record())
    if (workspaceRecordRoutes.has(key) && !ws)
      return FlowEmpty({
        title: tr('flow.record.notFound'),
        description: tr('flow.record.notFoundHelp'),
        action: nav('workspaces', tr('flow.ui.workspace')),
      })
    if (key === 'project-move') {
      if (!project || !manage('project', project.id)) return denied()
      const options = d()
        .workspaces.filter((w) => w.id !== project.workspaceId && !w.archived)
        .map((w) => ({ value: w.id, label: w.title }))
      const invalidatePreview = () => {
        previewRequest++
        preview.set(null)
        previewError.set('')
        previewBusy.set(false)
      }
      const read = async () => {
        const request = ++previewRequest
        preview.set(null)
        previewError.set('')
        previewBusy.set(true)
        try {
          const value = await ctx.call('flow.project.move.preview', {
            projectId: project.id,
            targetWorkspaceId: target(),
            preserve: preserve(),
          })
          if (request === previewRequest) preview.set(value)
        } catch (e) {
          if (request === previewRequest) previewError.set(e.message)
        } finally {
          if (request === previewRequest) previewBusy.set(false)
        }
      }
      return form(
        stack(
          notice(
            project.title,
            tr('flow.ui.currently.in.tasks.documents.sprints.epics.and.atlas.sources.move.with.the.proje', [
              d().workspaces.find((w) => w.id === project.workspaceId)?.title,
            ]),
          ),
          selectField({
            name: 'targetWorkspaceId',
            label: tr('flow.ui.destination.workspace'),
            value: target(),
            disabled: ctx.busy(),
            options: [
              { value: '', label: tr('flow.ui.select.a.workspace.in.this.organization') },
              ...options,
            ],
            onChange: (e) => {
              target.set(e.target.value)
              invalidatePreview()
            },
          }),
          FlowCheckboxField({
            name: 'preserveAccess',
            label: tr('flow.ui.preserve.existing.access.with.direct.grants.for.affected.members'),
            checked: preserve(),
            disabled: ctx.busy(),
            onChange: (e) => {
              preserve.set(e.target.checked)
              invalidatePreview()
            },
          }),
          button(
            previewBusy() ? tr('flow.ui.preparing.preview') : tr('flow.ui.preview.impact'),
            read,
            false,
            !target() || previewBusy(),
          ),
          previewError() ? notice(tr('flow.ui.preview.unavailable'), previewError(), 'red') : null,
          preview()
            ? stack(
                FlowHint({
                  children: tr('flow.ui.people.lose.access.gain.access.unchanged', [
                    preview().people.filter((x) => x.change === 'loss').length,
                    preview().people.filter((x) => x.change === 'gain').length,
                    preview().people.filter((x) => x.change === 'same').length,
                  ]),
                }),
                FlowAccessList({
                  rows: [...preview().people]
                    .sort(
                      (a, b) =>
                        ['loss', 'gain', 'same'].indexOf(a.change) -
                        ['loss', 'gain', 'same'].indexOf(b.change),
                    )
                    .map((row) => ({
                      id: row.id,
                      name: row.name,
                      role: `${roleLabel(row.before.role)} → ${roleLabel(row.after.role)}`,
                      sources:
                        row.after.sources.map((x) => x.label).join(' · ') ||
                        tr('flow.ui.all.access.sources.lost'),
                      status:
                        row.change === 'loss'
                          ? tr('flow.ui.reduced.lost.access')
                          : row.change === 'gain'
                            ? tr('flow.ui.access.added')
                            : tr('flow.ui.unchanged'),
                    })),
                }),
              )
            : notice(
                tr('flow.ui.preview.before.confirming'),
                tr(
                  'flow.ui.inherited.access.is.recalculated.for.the.new.workspace.direct.and.team.grants.on',
                ),
              ),
        ),
        () => {
          if (!preview() || previewBusy() || ctx.busy()) return
          return ctx.mutate(
            'flow.organization.command',
            {
              action: 'project.move',
              id: project.id,
              projectId: project.id,
              targetWorkspaceId: target(),
              preserve: preserve(),
              expectedRevision: preview().revision,
            },
            (value) =>
              ctx.navigate('board', { project: project.id, workspace: value.workspaceId }, { replace: true }),
          )
        },
        tr('flow.ui.confirm.move'),
        !preview() || previewBusy(),
      )
    }
    if (key === 'member-access') {
      const scope = params.accessScope === 'project' ? 'project' : 'workspace',
        id = params.target ?? (scope === 'project' ? project?.id : ws?.id),
        target = scopeTarget(scope, id)
      if (!entity || !target || entity.status !== 'active')
        return FlowEmpty({ title: mt('notFound'), description: mt('notFoundDetail') })
      const a = accessFor(d(), target, entity.id),
        editable = manage(scope, id),
        grantOf = (x) => d().grants.find((g) => g.id === x.grantId)
      const source = (x) => {
        const g = grantOf(x),
          team = g?.subjectType === 'team' ? d().teams.find((t) => t.id === g.subjectId) : null
        return FlowListItem({
          title: x.label,
          description:
            roleLabel(x.role) +
            ' · ' +
            (team ? mt('teamWide', [team.memberIds.length, team.title]) : g ? mt('direct') : mt('inherited')),
          actions:
            editable && g
              ? button(
                  team ? mt('removeTeam') : mt('removeDirect'),
                  () =>
                    confirmRun(
                      x.label,
                      tr('flow.organization.confirmAccessRevoke'),
                      team ? mt('removeTeam') : mt('removeDirect'),
                      'access.revoke',
                      { id: g.id },
                    ),
                  false,
                  ctx.busy(),
                )
              : null,
        })
      }
      return stack(
        FlowProperties({
          items: [
            { label: mt('member'), value: html`${entity.name} · ${entity.email}` },
            {
              label: mt('role'),
              value: FlowTag({
                label: a.role ? roleLabel(a.role) : mt('noAccess'),
                tone: a.role === 'admin' ? 'blue' : 'neutral',
              }),
            },
            { label: mt('orgRole'), value: roleLabel(entity.role) },
            {
              label: mt('teams'),
              value:
                teamsOf(entity)
                  .map((t) => t.title)
                  .join(', ') || '—',
            },
          ],
        }),
        FlowSection({
          inset: 'none',
          title: mt('sources'),
          children: stack(
            ...(a.sources.length ? a.sources.map(source) : [FlowHint({ children: mt('noAccess') })]),
            FlowHint({ children: mt('effectiveDetail') }),
          ),
        }),
        inline(
          nav('permissions', tr('flow.ui.view.roles.and.access.sources')),
          manage() && entity.role !== 'owner'
            ? nav('member-edit', mt('orgSettings'), { id: entity.id })
            : null,
          editable
            ? nav('access-grant', mt('grantMore'), { accessScope: scope, target: id, user: entity.id }, true)
            : null,
        ),
      )
    }
    if (key === 'access-grant') {
      if (
        !manage() &&
        !d().workspaces.some((w) => manage('workspace', w.id)) &&
        !d().projects.some((p) => manage('project', p.id))
      )
        return denied()
      const scope = grantScope() || params.accessScope || 'workspace',
        subjectType = grantSubject() || (params.team ? 'team' : 'user')
      const targets = (scope === 'workspace' ? d().workspaces : d().projects).filter(
        (x) => !x.archived && manage(scope, x.id),
      )
      const subjects =
        subjectType === 'team'
          ? d().teams.filter((team) => !team.archived)
          : d().members.filter((m) => m.status === 'active' && (scope === 'project' || m.role !== 'guest'))
      return form(
        stack(
          selectField({
            name: 'scope',
            label: tr('flow.ui.scope'),
            value: scope,
            disabled: !!params.accessScope,
            options: [
              { value: 'workspace', label: 'Workspace' },
              { value: 'project', label: tr('flow.ui.project') },
            ],
            onChange: (e) => grantScope.set(e.target.value),
          }),
          params.target
            ? html`<input type="hidden" name="targetId" value=${params.target}/><input type="hidden" name="scope" value=${scope}/>${FlowHint({ children: (targets.find((x) => x.id === params.target)?.title ?? params.target) + ' · ' + (scope === 'workspace' ? 'Workspace' : tr('flow.ui.project')) })}`
            : select(
                'targetId',
                scope === 'workspace' ? 'Workspace' : tr('flow.ui.project'),
                targets[0]?.id,
                targets.map((x) => ({ value: x.id, label: x.title })),
              ),
          selectField({
            name: 'subjectType',
            label: tr('flow.ui.grant.to'),
            value: subjectType,
            options: [
              { value: 'user', label: tr('flow.ui.member') },
              { value: 'team', label: 'Team' },
            ],
            onChange: (e) => {
              grantSubject.set(e.target.value)
              grantPeople.set([])
            },
          }),
          FlowTagPicker({
            id: 'grant-subjects',
            placeholder: subjectType === 'team' ? tr('flow.ui.select.team') : tr('flow.ui.select.member'),
            label: subjectType === 'team' ? tr('flow.ui.granted.team') : tr('flow.ui.granted.member'),
            value: grantPeople().length
              ? grantPeople()
              : params.team
                ? [params.team]
                : params.user && subjectType === 'user'
                  ? [params.user]
                  : [],
            options: subjects.map((x) => ({ id: x.id, title: x.name ?? x.title, color: 'blue' })),
            onChange: grantPeople.set,
          }),
          select('role', tr('flow.ui.role'), 'viewer', roles),
          notice(
            tr('flow.ui.guest'),
            tr('flow.ui.guests.can.only.be.granted.specific.projects.teams.and.workspaces.are.for.intern'),
          ),
        ),
        (v) =>
          run(
            'access.grant',
            {
              ...v,
              subjectIds: grantPeople().length
                ? grantPeople()
                : params.team
                  ? [params.team]
                  : params.user && subjectType === 'user'
                    ? [params.user]
                    : [],
            },
            ctx.close,
          ),
        tr('flow.ui.grant.permissions'),
      )
    }
    if (key === 'workspace-new' || key === 'workspace-edit') {
      if (!(key === 'workspace-new' ? manage() : manage('workspace', ws?.id))) return denied()
      return form(
        stack(
          input({
            id: 'title',
            label: tr('flow.ui.workspace.name'),
            value: key === 'workspace-edit' ? ws?.title : '',
            required: true,
            placeholder: tr('flow.ui.e.g.product'),
          }),
          textarea({
            id: 'description',
            label: tr('flow.ui.description'),
            value: key === 'workspace-edit' ? ws?.description : '',
          }),
          selectField({
            name: 'access',
            label: tr('flow.ui.who.can.join'),
            value: workspaceAccess() || (key === 'workspace-edit' ? ws?.access : 'private'),
            options: [
              { value: 'private', label: tr('flow.ui.only.granted.people.teams') },
              { value: 'internal', label: tr('flow.ui.internal.organization.members') },
            ],
            onChange: (e) => workspaceAccess.set(e.target.value),
          }),
          FlowHint({
            children: tr(
              'flow.ui.inherited.projects.will.use.workspace.permissions.internal.access.allows.organiz',
              [
                key === 'workspace-new'
                  ? 0
                  : d().projects.filter(
                      (p) => p.workspaceId === ws?.id && !p.archived && p.access === 'workspace',
                    ).length,
                d().members.filter((m) => m.role !== 'guest' && m.status === 'active').length,
              ],
            ),
          }),
          key === 'workspace-edit' && workspaceAccess() && workspaceAccess() !== ws.access
            ? FlowDisclosure({
                title: tr('flow.ui.permission.changes.in.inherited.projects'),
                open: true,
                children: stack(
                  ...d()
                    .projects.filter(
                      (p) => p.workspaceId === ws.id && !p.archived && p.access === 'workspace',
                    )
                    .flatMap((p) =>
                      d()
                        .members.filter((m) => m.status === 'active')
                        .map((m) => ({
                          p,
                          m,
                          before: accessFor(d(), p, m.id),
                          after: accessFor(
                            {
                              ...d(),
                              workspaces: d().workspaces.map((w) =>
                                w.id === ws.id ? { ...w, access: workspaceAccess() } : w,
                              ),
                            },
                            p,
                            m.id,
                          ),
                        }))
                        .filter((x) => x.before.role !== x.after.role)
                        .map((x) =>
                          FlowListItem({
                            title: x.m.name + ' · ' + x.p.title,
                            description: roleLabel(x.before.role) + ' → ' + roleLabel(x.after.role),
                          }),
                        ),
                    ),
                ),
              })
            : null,
          key === 'workspace-edit' ? nav('workspace-archive', tr('flow.ui.archive.workspace')) : null,
        ),
        (v) =>
          run('workspace.save', { ...v, ...(key === 'workspace-edit' ? { id: ws?.id } : {}) }, (value) =>
            ctx.switchWorkspace(value.id),
          ),
        key === 'workspace-new' ? tr('flow.ui.create.workspace') : tr('flow.ui.save.changes'),
      )
    }
    if (key === 'workspace-archive') {
      if (!manage('workspace', ws?.id)) return denied()
      const projects = d().projects.filter((project) => project.workspaceId === ws.id && !project.archived)
      const body = stack(
        notice(
          tr('flow.ui.archive.2c4f61') + ws?.title,
          tr('flow.ui.the.workspace.is.not.deleted.move.or.archive.all.its.projects.first'),
          'yellow',
        ),
        projectCards(projects),
      )
      const footer = inline(
        button(tr('flow.ui.cancel'), ctx.close),
        button(
          tr('flow.ui.archive.workspace'),
          () =>
            run('workspace.archive', { id: ws?.id }, () => ctx.navigate('workspaces', {}, { replace: true })),
          true,
          ctx.busy() || projects.length > 0,
        ),
      )
      return separateActions
        ? {
            body,
            confirmation: {
              message: tr('flow.ui.archive.2c4f61') + ws.title,
              details: stack(
                FlowHint({
                  children: tr('flow.ui.the.workspace.is.not.deleted.move.or.archive.all.its.projects.first'),
                }),
                projects.length
                  ? nav('workspace-overview', tr('flow.organization.archiveProjects', [projects.length]), {
                      workspace: ws.id,
                    })
                  : null,
              ),
              confirmDisabled: projects.length > 0,
              onConfirm: () =>
                run('workspace.archive', { id: ws.id }, () =>
                  ctx.navigate('workspaces', {}, { replace: true }),
                ),
            },
          }
        : stack(body, footer)
    }
    if (key === 'member-invite')
      return manage()
        ? form(
            stack(
              input({
                id: 'email',
                label: 'Email',
                type: 'email',
                required: true,
                placeholder: 'ten@congty.vn',
                value: inviteEmail,
                onInput: (e) => {
                  inviteEmail = e.target.value
                },
              }),
              selectField({
                name: 'role',
                label: tr('flow.ui.invitee.type'),
                value: inviteRole(),
                options: [
                  { value: 'member', label: tr('flow.ui.member') },
                  { value: 'admin', label: tr('flow.ui.organization.admin') },
                  { value: 'guest', label: tr('flow.ui.guest') },
                ],
                onChange: (e) => inviteRole.set(e.target.value),
              }),
              inviteRole() === 'guest'
                ? select('projectId', tr('flow.ui.granted.projects'), '', [
                    { value: '', label: tr('flow.ui.select.projects.for.guest') },
                    ...d().projects.map((p) => ({ value: p.id, label: p.title })),
                  ])
                : FlowHint({
                    children:
                      inviteRole() === 'admin'
                        ? tr('flow.ui.organization.admins.manage.members.and.flow.settings')
                        : tr(
                            'flow.ui.internal.members.can.enter.internal.workspaces.private.projects.still.require.ex',
                          ),
                  }),
              notice(
                tr('flow.ui.prototype.invitations'),
                tr('flow.ui.creates.a.pending.invitation.only.no.email.is.sent'),
              ),
            ),
            (v) => run('member.invite', v, ctx.close),
            tr('flow.ui.create.invitation'),
          )
        : denied()
    if (key === 'member-edit')
      return manage() && entity
        ? stack(
            form(
              stack(
                notice(entity.name, entity.email),
                selectField({
                  name: 'role',
                  label: tr('flow.ui.role'),
                  value: entity.role,
                  disabled: entity.role === 'owner',
                  options: [
                    ...(entity.role === 'owner' ? [{ value: 'owner', label: tr('flow.ui.owner') }] : []),
                    { value: 'member', label: tr('flow.ui.member') },
                    { value: 'admin', label: tr('flow.ui.admin') },
                    { value: 'guest', label: tr('flow.ui.guest') },
                  ],
                }),
                entity.role === 'owner'
                  ? FlowHint({ children: tr('flow.organization.ownerProtected') })
                  : null,
              ),
              (v) => run('member.update', { id: entity.id, role: v.role }, ctx.close),
              tr('flow.ui.save.role'),
              entity.role === 'owner',
            ),
            ...(ctx.settingsSection?.(key, entity) ?? []),
            entity.role === 'guest'
              ? FlowSection({
                  inset: 'none',
                  title: tr('flow.ui.granted.projects'),
                  children: stack(
                    ...d()
                      .grants.filter(
                        (g) => g.scope === 'project' && g.subjectType === 'user' && g.subjectId === entity.id,
                      )
                      .map((g) =>
                        FlowListItem({
                          title: d().projects.find((p) => p.id === g.targetId)?.title ?? g.targetId,
                          actions: button(tr('flow.ui.remove'), () =>
                            confirmRun(
                              d().projects.find((p) => p.id === g.targetId)?.title ??
                                tr('flow.ui.granted.projects'),
                              tr('flow.organization.confirmAccessRevoke'),
                              tr('flow.ui.remove'),
                              'access.revoke',
                              { id: g.id },
                            ),
                          ),
                        }),
                      ),
                    form(
                      select('targetId', tr('flow.ui.projects'), '', [
                        { value: '', label: tr('flow.ui.select.projects.for.guest') },
                        ...d()
                          .projects.filter(
                            (p) =>
                              !p.archived &&
                              !d().grants.some(
                                (g) =>
                                  g.scope === 'project' && g.targetId === p.id && g.subjectId === entity.id,
                              ),
                          )
                          .map((p) => ({ value: p.id, label: p.title })),
                      ]),
                      (v) =>
                        run('access.grant', {
                          scope: 'project',
                          targetId: v.targetId,
                          subjectType: 'user',
                          subjectIds: [entity.id],
                          role: 'viewer',
                        }),
                      tr('flow.ui.grant.permissions'),
                    ),
                  ),
                })
              : null,
            entity.status === 'revoked'
              ? FlowNotice({
                  title: tr('flow.ui.access.revoked'),
                  message: tr('flow.organization.revokedRoleHelp'),
                  action: button(
                    tr('flow.organization.restoreAccess'),
                    () =>
                      confirmRun(
                        tr('flow.organization.restoreAccess'),
                        tr('flow.organization.confirmMemberRestore', [entity.name, roleLabel(entity.role)]),
                        tr('flow.organization.restoreAccess'),
                        'member.update',
                        { id: entity.id, role: entity.role, revoke: false },
                        ctx.close,
                        'primary',
                      ),
                    false,
                    entity.role === 'owner' || ctx.busy(),
                  ),
                })
              : FlowDisclosure({
                  title: tr('flow.ui.revoke.flow.access'),
                  children: stack(
                    notice(
                      tr('flow.ui.impact'),
                      tr(
                        'flow.ui.access.to.projects.will.be.removed.unfinished.tasks.keep.their.assignee.and.need',
                        [
                          d().projects.filter((p) => accessFor(d(), p, entity.id).role).length,
                          d().tasks.filter((t) => t.assignee === entity.name && !isDone(d(), t)).length,
                        ],
                      ),
                      'yellow',
                    ),
                    ...d()
                      .tasks.filter((t) => t.assignee === entity.name && !isDone(d(), t))
                      .map((t) =>
                        notice(
                          t.id,
                          t.title,
                          'neutral',
                          nav('issue', tr('flow.ui.reassign'), { id: t.id, project: t.projectId }),
                        ),
                      ),
                    button(
                      tr('flow.ui.confirm.revocation'),
                      () =>
                        confirmRun(
                          tr('flow.ui.revoke.flow.access'),
                          tr('flow.organization.confirmMemberRevoke', [entity.name]),
                          tr('flow.ui.confirm.revocation'),
                          'member.update',
                          { id: entity.id, role: entity.role, revoke: true },
                          ctx.close,
                        ),
                      false,
                      entity.role === 'owner' || ctx.busy(),
                    ),
                  ),
                }),
          )
        : denied()
    if (key === 'team-new' || key === 'team-edit') {
      const t = d().teams.find((t) => t.id === ctx.record())
      if (key === 'team-edit' && (!t || t.archived))
        return FlowEmpty({
          title: tr('flow.ui.team.not.found'),
          description: tr('flow.ui.this.team.does.not.exist.or.you.cannot.view.it'),
          action: nav('teams', organizationRoutes.teams.title),
        })
      return manage()
        ? form(
            stack(
              input({
                id: 'title',
                label: tr('flow.ui.team.name'),
                value: key === 'team-edit' ? t?.title : '',
                required: true,
              }),
              textarea({
                id: 'description',
                label: tr('flow.ui.description'),
                value: key === 'team-edit' ? t?.description : '',
              }),
              notice(
                tr('flow.ui.teams.group.people'),
                tr('flow.ui.add.members.and.grant.workspace.or.project.access.after.creating.the.team'),
              ),
            ),
            (v) =>
              run('team.save', { ...v, ...(key === 'team-edit' ? { id: t?.id } : {}) }, (value) =>
                ctx.navigate('team', { id: value.id }, { replace: true }),
              ),
            key === 'team-new' ? tr('flow.ui.create.team') : tr('flow.ui.save.changes'),
          )
        : denied()
    }
    return null
  }
  const modal = (key, { separateActions = false } = {}) => {
    let footer = null
    const body = modalContent(
      key,
      (body, save, label, disabled) => {
        const detach = separateActions && footer === null
        const content = form(body, save, label, disabled, detach, separateActions ? detach : ctx.isModal?.())
        if (!detach) return content
        footer = content.footer
        return content.body
      },
      separateActions,
    )
    if (separateActions && body?.body) return body
    return separateActions ? { body, footer } : body
  }
  return {
    view,
    modal,
    topAction,
    reset() {
      grantPeople.set([])
      workspaceAccess.set('')
      accessChoice.set('')
      inviteRole.set('member')
      inviteEmail = ''
      grantScope.set('')
      grantSubject.set('')
      previewRequest++
      preview.set(null)
      previewError.set('')
      previewBusy.set(false)
      target.set('')
      preserve.set(false)
    },
  }
}
