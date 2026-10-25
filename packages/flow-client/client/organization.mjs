import { routes } from './routes.mjs'
import { tr } from './i18n.mjs'
import { html, each, signal } from '@ketvietlab/ketjs-view'
import { FlowButton, FlowInput, FlowStatus, FlowSelect, FlowEmpty, FlowTag } from '@ketvietlab/flow-ui'
import {
  FlowChoiceField,
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
  FlowLoading,
} from '@ketvietlab/flow-ui/workspace'
import { accessSourceLabel, canManageScope, roleLabel } from './access-model.mjs'
import { workspaceRecordRoutes } from './navigation.mjs'
import { createWorkspaceOverview } from './workspace-overview.mjs'
import { createPagedOptions } from './paged-options.mjs'
import { organizationRoutes } from './organization-routes.mjs'
export { organizationRoutes, organizationForms } from './organization-routes.mjs'
export function createOrganization(ctx) {
  const grantScope = signal(''),
    grantSubject = signal(''),
    accessChoice = signal(''),
    inviteRole = signal('member'),
    grantPeople = signal([]),
    workspaceAccess = signal('')
  let inviteEmail = ''
  const target = signal(''),
    preserve = signal(false),
    preview = signal(null),
    previewError = signal(''),
    previewBusy = signal(false)
  let previewRequest = 0
  // One person's access to one target comes from the server, so it holds past the people window.
  const memberAccess = signal({ key: '', loading: false, error: null, item: null })
  let memberAccessTicket = 0
  const memberAccessTarget = () => {
    const params = ctx.params(),
      scope = params.accessScope === 'project' ? 'project' : 'workspace',
      id = params.target ?? (scope === 'project' ? p()?.id : w()?.id)
    return {
      scope,
      id,
      key:
        id && ctx.record()
          ? JSON.stringify([d().company.id, scope, id, ctx.record(), d().organizationRevision])
          : '',
    }
  }
  const loadMemberAccess = async (retry = false) => {
    const { scope, id, key } = memberAccessTarget(),
      held = memberAccess.peek()
    if (!key || (!retry && held.key === key && (held.loading || held.item || !held.error))) return
    const ticket = ++memberAccessTicket
    memberAccess.set({ key, loading: true, error: null, item: null })
    try {
      const page = await ctx.call('flow.access.list', {
        companyId: d().company.id,
        scope,
        targetId: id,
        memberId: ctx.record(),
        limit: 1,
      })
      if (ticket === memberAccessTicket)
        memberAccess.set({ key, loading: false, error: null, item: page.items[0] ?? null })
    } catch (error) {
      if (ticket !== memberAccessTicket) return
      if (['forbidden', 'unauthenticated'].includes(error.code)) ctx.refused?.(error)
      memberAccess.set({ key, loading: false, error, item: null })
    }
  }
  // A Team's size, scopes and members are read from the server, members a page at a time.
  const emptyTeam = {
    key: '',
    loading: false,
    error: null,
    team: null,
    grants: [],
    members: [],
    total: 0,
    cursor: null,
  }
  const teamDetail = signal(emptyTeam),
    teamCandidate = signal('')
  let teamTicket = 0
  const teamKey = () =>
    ctx.route?.() === 'team' && ctx.record()
      ? JSON.stringify([d().company.id, ctx.record(), d().organizationRevision])
      : ''
  const loadTeam = async ({ more = false, retry = false } = {}) => {
    const key = teamKey(),
      id = ctx.record(),
      held = teamDetail.peek()
    if (!key) return
    if (more ? held.key !== key || !held.cursor || held.loading : !retry && held.key === key) return
    const ticket = ++teamTicket,
      kept = held.team?.id === id ? held : { ...emptyTeam }
    teamDetail.set({ ...kept, key, loading: true, error: null })
    try {
      const people = (cursor) =>
        ctx.call('flow.member.list', {
          companyId: d().company.id,
          teamId: id,
          limit: 50,
          ...(cursor ? { cursor } : {}),
        })
      const [read, page] = more
        ? [held, await people(held.cursor)]
        : await Promise.all([ctx.call('flow.team.read', { companyId: d().company.id, id }), people()])
      if (ticket !== teamTicket) return
      const members = new Map((more ? held.members : []).map((m) => [m.id, m]))
      for (const m of page.items) members.set(m.id, m)
      teamDetail.set({
        key,
        loading: false,
        error: null,
        team: read.team,
        grants: read.grants,
        members: [...members.values()],
        total: page.total,
        cursor: page.cursor,
      })
    } catch (error) {
      if (ticket !== teamTicket) return
      if (['forbidden', 'unauthenticated'].includes(error.code)) ctx.refused?.(error)
      teamDetail.set({ ...teamDetail.peek(), key, loading: false, error })
    }
  }
  const knownCandidates = new Map()
  // People who could join the open Team are searched on the server, not in the loaded window.
  const candidates = ctx.call
    ? createPagedOptions({
        scope: () => JSON.stringify([d()?.company.id, ctx.record(), d()?.organizationRevision]),
        refused: ctx.refused,
        read: (input, signal) =>
          ctx.call(
            'flow.member.list',
            { ...input, companyId: d().company.id, candidateForTeamId: ctx.record() },
            { signal },
          ),
        accept: (items) => {
          for (const m of items) knownCandidates.set(m.id, m)
        },
      })
    : null
  // What a form states about the whole organization (how many people or projects a choice
  // reaches, what revoking someone removes) is read from the server, not counted in a window.
  const facts = signal({ key: '', loading: false, error: null, value: null })
  let factsTicket = 0
  const factsRequest = () => {
    const route = ctx.route?.(),
      company = d()?.company.id,
      params = ctx.params?.() ?? {}
    if (!company) return null
    const key = (...parts) => JSON.stringify([route, company, ...parts, d().organizationRevision])
    if (route === 'workspace-new' || route === 'workspace-edit') {
      const id = route === 'workspace-new' ? null : ctx.recordProvided?.() ? ctx.record() : (w()?.id ?? null)
      return {
        key: key(id),
        read: async () => {
          const [people, projects] = await Promise.all([
            ctx.call('flow.member.list', { companyId: company, internal: true, limit: 1 }),
            id
              ? ctx.call('flow.project.options', {
                  companyId: company,
                  workspaceId: id,
                  access: 'workspace',
                  limit: 1,
                })
              : { total: 0 },
          ])
          return { members: people.total, projects: projects.total }
        },
      }
    }
    if (route === 'member-edit' && ctx.record() && manage())
      return {
        key: key(ctx.record()),
        read: () => ctx.call('flow.member.impact', { companyId: company, memberId: ctx.record() }),
      }
    // A person preselected for a grant is named even when outside the loaded people.
    if (route === 'access-grant' && params.user && !d().members.some((m) => m.id === params.user))
      return {
        key: key(params.user),
        read: () => ctx.call('flow.member.list', { companyId: company, ids: [params.user], limit: 1 }),
      }
    return null
  }
  const loadFacts = async (retry = false) => {
    const wanted = ctx.call ? factsRequest() : null,
      held = facts.peek()
    if (!wanted || (!retry && held.key === wanted.key)) return
    const ticket = ++factsTicket
    facts.set({ key: wanted.key, loading: true, error: null, value: null })
    try {
      const value = await wanted.read()
      if (ticket === factsTicket) facts.set({ key: wanted.key, loading: false, error: null, value })
    } catch (error) {
      if (ticket !== factsTicket) return
      if (['forbidden', 'unauthenticated'].includes(error.code)) ctx.refused?.(error)
      facts.set({ key: wanted.key, loading: false, error, value: null })
    }
  }
  const factsOf = () => {
    const wanted = factsRequest(),
      s = facts()
    return wanted && s.key === wanted.key ? s : null
  }
  // A guest's project grants are read by subject, a page at a time.
  const emptyGuest = { key: '', loading: false, error: null, items: [], total: 0, cursor: null }
  const guestGrants = signal(emptyGuest),
    guestProject = signal('')
  let guestTicket = 0
  const guestKey = () => {
    const person = ctx.route?.() === 'member-edit' ? d()?.members.find((m) => m.id === ctx.record()) : null
    return person?.role === 'guest' && manage()
      ? JSON.stringify([d().company.id, person.id, d().organizationRevision])
      : ''
  }
  const loadGuestGrants = async ({ more = false, retry = false } = {}) => {
    const key = guestKey(),
      held = guestGrants.peek()
    if (!key || !ctx.call) return
    if (more ? held.key !== key || !held.cursor || held.loading : !retry && held.key === key) return
    const ticket = ++guestTicket
    guestGrants.set(more ? { ...held, loading: true, error: null } : { ...emptyGuest, key, loading: true })
    try {
      const page = await ctx.call('flow.grant.list', {
        companyId: d().company.id,
        subjectType: 'user',
        subjectId: ctx.record(),
        scope: 'project',
        limit: 50,
        ...(more ? { cursor: held.cursor } : {}),
      })
      if (ticket !== guestTicket) return
      guestGrants.set({
        key,
        loading: false,
        error: null,
        items: more ? [...held.items, ...page.items] : page.items,
        total: page.total,
        cursor: page.cursor,
      })
    } catch (error) {
      if (ticket !== guestTicket) return
      if (['forbidden', 'unauthenticated'].includes(error.code)) ctx.refused?.(error)
      guestGrants.set({ ...guestGrants.peek(), key, loading: false, error })
    }
  }
  // Pickers over people, Teams and projects search the server.
  const paged = (read, accept = () => {}) =>
    ctx.call
      ? createPagedOptions({
          scope: () =>
            JSON.stringify([
              d()?.company.id,
              ctx.route?.(),
              ctx.record(),
              grantScope(),
              grantSubject(),
              d()?.organizationRevision,
            ]),
          refused: ctx.refused,
          read,
          accept,
        })
      : null
  const remoteOf = (options) => {
    const s = options.state()
    return {
      menu: { open: s.open, onToggle: (open) => (open ? void options.open() : options.close()) },
      remote: {
        query: s.query,
        loading: s.loading,
        error: s.error,
        total: s.total,
        onQuery: options.query,
        onRetry: options.retry,
        ...(s.cursor ? { onMore: options.more } : {}),
      },
    }
  }
  const knownProjects = new Map(),
    knownSubjects = new Map()
  const rememberProjects = (items) => {
    for (const x of items) knownProjects.set(x.id, x)
  }
  const guestProjects = paged(
    (input, signal) => ctx.call('flow.project.options', { ...input, companyId: d().company.id }, { signal }),
    rememberProjects,
  )
  const grantTarget = signal('')
  const grantTargets = paged(
    (input, signal) =>
      ctx.call('flow.project.options', { ...input, companyId: d().company.id, manage: true }, { signal }),
    rememberProjects,
  )
  const grantKind = () => grantSubject() || (ctx.params().team ? 'team' : 'user')
  const grantSubjects = paged(
    (input, signal) => {
      const scope = grantScope() || ctx.params().accessScope || 'workspace'
      return grantKind() === 'team'
        ? ctx.call('flow.team.list', { ...input, companyId: d().company.id }, { signal })
        : ctx.call(
            'flow.member.list',
            {
              ...input,
              companyId: d().company.id,
              ...(scope === 'workspace' ? { internal: true } : { active: true }),
            },
            { signal },
          )
    },
    (items) => {
      for (const x of items) knownSubjects.set(`${grantKind()}:${x.id}`, x)
    },
  )
  // A change's effect on access is computed by the server, with the engine the change uses.
  const impact = signal({ key: '', loading: false, error: null, items: [], total: 0, cursor: null })
  let impactTicket = 0
  const loadImpact = async (key, input, { more = false, force = false } = {}) => {
    const held = impact.peek()
    if (!key) return
    if (more ? held.key !== key || !held.cursor || held.loading : !force && held.key === key && !held.error)
      return
    const ticket = ++impactTicket
    impact.set(
      more
        ? { ...held, loading: true, error: null }
        : { key, loading: true, error: null, items: [], total: 0, cursor: null },
    )
    try {
      const page = await ctx.call('flow.access.preview', {
        companyId: d().company.id,
        ...input,
        ...(more ? { cursor: held.cursor } : {}),
      })
      if (ticket !== impactTicket) return
      impact.set({
        key,
        loading: false,
        error: null,
        items: more ? [...held.items, ...page.items] : page.items,
        total: page.total,
        cursor: page.cursor,
      })
    } catch (error) {
      if (ticket !== impactTicket) return
      if (['forbidden', 'unauthenticated'].includes(error.code)) ctx.refused?.(error)
      impact.set({ ...impact.peek(), key, loading: false, error })
    }
  }
  const projectImpact = () =>
    p() && accessChoice() && accessChoice() !== p().access
      ? {
          key: JSON.stringify(['project-access', p().id, accessChoice(), d().organizationRevision]),
          input: { change: 'project-access', projectId: p().id, access: accessChoice() },
        }
      : null
  const workspaceImpact = () => {
    const ws = ctx.recordProvided?.()
      ? d().workspaces?.find((x) => x.id === ctx.record() && !x.archived)
      : w()
    return ws &&
      workspaceAccess() &&
      workspaceAccess() !== (ws.access === 'internal' ? 'internal' : 'restricted')
      ? {
          key: JSON.stringify(['workspace-access', ws.id, workspaceAccess(), d().organizationRevision]),
          input: { change: 'workspace-access', workspaceId: ws.id, access: workspaceAccess() },
        }
      : null
  }
  const pendingImpact = () =>
    ctx.route?.() === 'project-members'
      ? projectImpact()
      : ctx.route?.() === 'workspace-edit'
        ? workspaceImpact()
        : null
  const impactList = (wanted, title) => {
    const s = impact(),
      retry = () => loadImpact(wanted.key, wanted.input, { force: true })
    if (s.key !== wanted.key || (s.loading && !s.items.length))
      return FlowLoading({ label: tr('flow.ui.preparing.preview') })
    if (s.error && !s.items.length)
      return stack(
        notice(tr('flow.ui.preview.unavailable'), s.error.message, 'red'),
        button(tr('flow.ui.try.again'), retry),
      )
    return stack(
      ...s.items.map((x) =>
        FlowListItem({
          title: title(x),
          description: roleLabel(x.before.role) + ' → ' + roleLabel(x.after.role),
        }),
      ),
      s.total > s.items.length
        ? FlowToolbar({
            inset: 'none',
            children: FlowHint({ children: tr('flow.access.previewShowing', [s.items.length, s.total]) }),
            trailing: s.error
              ? html`${FlowHint({ children: s.error.message })}${FlowButton({ label: tr('flow.ui.try.again'), size: 'sm', onClick: retry })}`
              : FlowButton({
                  label: tr('flow.access.previewMore'),
                  size: 'sm',
                  disabled: s.loading,
                  onClick: () => loadImpact(wanted.key, wanted.input, { more: true }),
                }),
          })
        : null,
    )
  }
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
      page = d().accessPage?.scope === scope && d().accessPage.targetId === id ? d().accessPage : null
    // The server lists who can open the target and why; the bootstrap's people are only a window.
    if (!page) {
      const failed = ctx.accessPageFailure?.()
      return failed
        ? FlowNotice({
            title: mt('unavailable'),
            message: failed.message,
            tone: 'red',
            action: button(tr('flow.ui.try.again'), () => ctx.retryAccessPage?.()),
          })
        : FlowLoading({ label: tr('flow.ui.opening.flow') })
    }
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
      total: mt('total', [page.total, page.without]),
      rows: page.items.map((m) => ({
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
            value: FlowTag({
              label: roleLabel(m.access.role),
              tone: m.access.role === 'admin' ? 'blue' : 'neutral',
            }),
          }),
          via: FlowEvidenceValue({
            value: m.access.sources[0] ? accessSourceLabel(m.access.sources[0]) : null,
            meta: m.access.sources.length > 1 ? mt('more', [m.access.sources.length - 1]) : null,
            hint: m.access.sources.map((x) => accessSourceLabel(x) + ' · ' + roleLabel(x.role)).join('\n'),
          }),
          teams: FlowEvidenceValue({
            value: m.teams.map((t) => t.title).join(', ') || '—',
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
                onChange: (e) => {
                  accessChoice.set(e.target.value)
                  const wanted = projectImpact()
                  if (wanted) void loadImpact(wanted.key, wanted.input)
                },
              }),
            })
          : null,
        !page.items.length
          ? FlowEmpty({
              title: mt('nobody'),
              description: mt('nobodyDetail'),
              action: editable ? grant : null,
            })
          : table,
        page.items.length ? ctx.accessPageView?.() : null,
        scope === 'project' && accessChoice() && accessChoice() !== p().access
          ? FlowDisclosure({
              title: tr('flow.ui.preview.permission.changes'),
              open: true,
              children: stack(
                impactList(projectImpact(), (x) => x.name),
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
              d().invitationPage?.total ?? d().invitations.filter((i) => i.status === 'pending').length,
              '',
            ]),
          ),
          FlowMetrics({
            inset: 'none',
            items: [
              { label: 'Workspace', value: d().workspaces.length },
              { label: tr('flow.ui.accessible.projects'), value: d().projects.length },
              {
                label: 'Team',
                value: d().teamPage?.total ?? d().teams.filter((team) => !team.archived).length,
              },
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
          FlowAccessList({
            rows: d()
              .members.filter((m) => !d().memberPage || d().memberPage.loadedIds.includes(m.id))
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
          ctx.memberPageView?.(),
          FlowSection({
            inset: 'none',
            title: tr('flow.ui.invitations'),
            children: d().invitations.some((i) => i.status === 'pending')
              ? stack(
                  ...d()
                    .invitations.filter((i) => i.status === 'pending')
                    .map((i) =>
                      notice(
                        i.email,
                        `${roleLabel(i.role)} · ${tr('flow.ui.awaiting.acceptance')}${i.projectId ? ' · ' + d().projects.find((p) => p.id === i.projectId)?.title : ''}`,
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
                  ctx.invitationPageView?.(),
                )
              : FlowEmpty({
                  title: tr('flow.ui.no.pending.invitations'),
                  description: tr('flow.ui.new.invitations.will.appear.here'),
                }),
          }),
        ),
      })
    if (key === 'teams') {
      const directory = d().teamPage
        ? d()
            .teamPage.loadedIds.map((id) => d().teams.find((t) => t.id === id))
            .filter((t) => t && !t.archived)
        : d().teams.filter((t) => !t.archived)
      return FlowSection({
        title: tr('flow.ui.teams.groups.of.people'),
        actions: manage() ? nav('team-new', tr('flow.ui.create.team'), {}, true) : null,
        children: stack(
          notice(
            tr('flow.ui.teams.do.not.contain.projects'),
            tr('flow.ui.a.team.can.have.access.to.multiple.workspaces.and.projects.in.the.same.organizat'),
          ),
          ...directory.map((t) =>
            notice(
              t.title,
              tr('flow.ui.members.granted.scopes', [t.memberCount ?? 0, t.grantCount ?? 0, t.description]),
              'neutral',
              nav('team', tr('flow.ui.manage.team'), { id: t.id }),
            ),
          ),
          ctx.teamPageView?.(),
        ),
      })
    }
    if (key === 'team') {
      const state = teamDetail(),
        team = state.team?.id === ctx.record() ? state.team : null
      if (!team && state.error?.code !== 'not_found' && (state.loading || !state.error))
        return FlowLoading({ label: tr('flow.ui.opening.flow') })
      if (!team && state.error?.code !== 'not_found')
        return FlowEmpty({
          title: tr('flow.ui.unable.to.open.flow'),
          description: state.error.message,
          action: FlowButton({ label: tr('flow.ui.try.again'), onClick: () => loadTeam({ retry: true }) }),
        })
      if (!team)
        return FlowEmpty({
          title: tr('flow.ui.team.not.found'),
          description: tr('flow.ui.this.team.does.not.exist.or.you.cannot.view.it'),
          action: nav('teams', organizationRoutes.teams.title),
        })
      const scopes = state.grants,
        picked = teamCandidate(),
        choices = candidates?.state()
      return FlowSection({
        title: team.title,
        actions: manage() ? nav('team-edit', tr('flow.ui.edit.team'), { id: team.id }) : null,
        children: stack(
          notice(tr('flow.ui.people.in.the.organization'), team.description),
          state.members.length
            ? FlowAccessList({
                rows: state.members.map((m) => ({
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
              })
            : FlowHint({ children: tr('flow.teams.noMembers') }),
          state.total > state.members.length || state.error
            ? FlowToolbar({
                inset: 'none',
                children: FlowHint({
                  children: tr('flow.teams.membersShowing', [state.members.length, state.total]),
                }),
                trailing: state.error
                  ? html`${FlowHint({ children: state.error.message })}${FlowButton({ label: tr('flow.ui.try.again'), size: 'sm', onClick: () => loadTeam({ retry: true }) })}`
                  : FlowButton({
                      label: tr('flow.teams.membersMore'),
                      size: 'sm',
                      disabled: state.loading,
                      onClick: () => loadTeam({ more: true }),
                    }),
              })
            : null,
          manage() && candidates
            ? form(
                stack(
                  FlowHint({
                    children:
                      tr('flow.ui.new.members.will.receive.access.to') +
                      (scopes.map((g) => g.targetTitle).join(', ') || tr('flow.ui.no.scopes.granted')),
                  }),
                  // The pick lives in state, not a field: a reset picker after a save is not a draft.
                  FlowChoiceField({
                    id: 'team-member-candidate',
                    label: tr('flow.ui.add.member'),
                    icon: 'user',
                    value: picked,
                    selected: {
                      label: knownCandidates.get(picked)?.name ?? tr('flow.ui.select.member'),
                      content: knownCandidates.get(picked)?.name ?? tr('flow.ui.select.member'),
                    },
                    options: choices.items.map((m) => ({
                      value: m.id,
                      label: m.name,
                      content: m.name,
                      description: m.email,
                    })),
                    menu: {
                      open: choices.open,
                      onToggle: (open) => (open ? void candidates.open() : candidates.close()),
                    },
                    remote: {
                      query: choices.query,
                      loading: choices.loading,
                      error: choices.error,
                      onQuery: candidates.query,
                      onRetry: candidates.retry,
                      ...(choices.cursor ? { onMore: candidates.more } : {}),
                    },
                    onChange: (id) => teamCandidate.set(id),
                  }),
                ),
                () =>
                  run('team.member', { id: team.id, memberId: picked }, () => {
                    teamCandidate.set('')
                    candidates.close()
                  }),
                tr('flow.ui.add.to.team'),
                !picked,
              )
            : null,
          FlowSection({
            inset: 'none',
            title: tr('flow.ui.granted.scopes'),
            actions: manage()
              ? nav('access-grant', tr('flow.ui.grant.team.access'), { team: team.id })
              : null,
            children: scopes.length
              ? stack(
                  ...scopes.map((g) =>
                    notice(
                      g.targetTitle,
                      `${g.scope === 'workspace' ? 'Workspace' : tr('flow.ui.project')} · ${roleLabel(g.role)}`,
                    ),
                  ),
                )
              : FlowHint({ children: tr('flow.teams.noScopes') }),
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
                  ctx.catalogPageView?.('columns'),
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
                  ctx.catalogPageView?.('types'),
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
                  ctx.catalogPageView?.('fields'),
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
  // What revoking a person removes, counted by the server past any loaded window.
  const revokeImpact = () => {
    const s = factsOf()
    if (s?.error)
      return [
        notice(
          tr('flow.ui.impact'),
          tr('flow.organization.impactUnavailable'),
          'yellow',
          button(tr('flow.ui.try.again'), () => loadFacts(true)),
        ),
      ]
    if (!s?.value) return [FlowLoading({ label: tr('flow.ui.preparing.preview') })]
    const { projects, tasks } = s.value
    return [
      notice(
        tr('flow.ui.impact'),
        tr('flow.ui.access.to.projects.will.be.removed.unfinished.tasks.keep.their.assignee.and.need', [
          projects,
          tasks.total,
        ]),
        'yellow',
      ),
      ...tasks.items.map((t) =>
        notice(
          t.id,
          t.title,
          'neutral',
          nav('issue', tr('flow.ui.reassign'), { id: t.id, project: t.projectId }),
        ),
      ),
      tasks.total > tasks.items.length
        ? FlowHint({ children: tr('flow.organization.impactMoreTasks', [tasks.total - tasks.items.length]) })
        : null,
    ]
  }
  // A guest's granted projects come from grant.list; a project to add is searched on the server.
  const guestProjectsSection = (entity) => {
    const state = guestGrants(),
      granted = new Set(state.items.map((g) => g.targetId)),
      picked = guestProject(),
      choices = guestProjects?.state()
    const title = (id) => knownProjects.get(id)?.title ?? d().projects.find((p) => p.id === id)?.title
    return FlowSection({
      inset: 'none',
      title: tr('flow.ui.granted.projects'),
      children: stack(
        state.key !== guestKey() || (state.loading && !state.items.length)
          ? FlowLoading({ label: tr('flow.ui.opening.flow') })
          : null,
        ...state.items.map((g) =>
          FlowListItem({
            title: g.targetTitle ?? g.targetId,
            actions: button(tr('flow.ui.remove'), () =>
              confirmRun(
                g.targetTitle ?? tr('flow.ui.granted.projects'),
                tr('flow.organization.confirmAccessRevoke'),
                tr('flow.ui.remove'),
                'access.revoke',
                { id: g.id },
              ),
            ),
          }),
        ),
        state.key === guestKey() && !state.loading && !state.error && !state.items.length
          ? FlowHint({ children: tr('flow.organization.guestNoProjects') })
          : null,
        state.error || state.cursor
          ? FlowToolbar({
              inset: 'none',
              children: FlowHint({
                children: state.error
                  ? state.error.message
                  : tr('flow.list.showing', [state.items.length, state.total]),
              }),
              trailing: state.error
                ? FlowButton({
                    label: tr('flow.ui.try.again'),
                    size: 'sm',
                    onClick: () => loadGuestGrants({ retry: true }),
                  })
                : FlowButton({
                    label: tr('flow.list.showMore', [
                      Math.min(50, state.total - state.items.length),
                      state.total - state.items.length,
                    ]),
                    size: 'sm',
                    disabled: state.loading,
                    onClick: () => loadGuestGrants({ more: true }),
                  }),
            })
          : null,
        guestProjects
          ? form(
              // The pick lives in state, not a field: a reset picker after a save is not a draft.
              FlowChoiceField({
                id: 'guest-project',
                label: tr('flow.ui.projects'),
                icon: 'folder',
                value: picked,
                selected: {
                  label: title(picked) ?? tr('flow.ui.select.projects.for.guest'),
                  content: title(picked) ?? tr('flow.ui.select.projects.for.guest'),
                },
                options: choices.items
                  .filter((p) => !granted.has(p.id))
                  .map((p) => ({ value: p.id, label: p.title, content: p.title, description: p.code })),
                ...remoteOf(guestProjects),
                onChange: (id) => guestProject.set(id),
              }),
              () =>
                run(
                  'access.grant',
                  {
                    scope: 'project',
                    targetId: picked,
                    subjectType: 'user',
                    subjectIds: [entity.id],
                    role: 'viewer',
                  },
                  () => {
                    guestProject.set('')
                    guestProjects.close()
                  },
                ),
              tr('flow.ui.grant.permissions'),
              !picked,
            )
          : null,
      ),
    })
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
      const more = async () => {
        const held = preview()
        if (!held?.cursor || previewBusy()) return
        const request = ++previewRequest
        previewError.set('')
        previewBusy.set(true)
        try {
          const value = await ctx.call('flow.project.move.preview', {
            projectId: project.id,
            targetWorkspaceId: target(),
            preserve: preserve(),
            cursor: held.cursor,
          })
          if (request === previewRequest) preview.set({ ...value, people: [...held.people, ...value.people] })
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
                    preview().summary?.loss ?? preview().people.filter((x) => x.change === 'loss').length,
                    preview().summary?.gain ?? preview().people.filter((x) => x.change === 'gain').length,
                    preview().summary?.same ?? preview().people.filter((x) => x.change === 'same').length,
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
                        row.after.sources.map(accessSourceLabel).join(' · ') ||
                        tr('flow.ui.all.access.sources.lost'),
                      status:
                        row.change === 'loss'
                          ? tr('flow.ui.reduced.lost.access')
                          : row.change === 'gain'
                            ? tr('flow.ui.access.added')
                            : tr('flow.ui.unchanged'),
                    })),
                }),
                preview().total > preview().people.length
                  ? FlowToolbar({
                      inset: 'none',
                      children: FlowHint({
                        children: tr('flow.access.previewShowing', [
                          preview().people.length,
                          preview().total,
                        ]),
                      }),
                      trailing: preview().cursor
                        ? FlowButton({
                            label: tr('flow.access.previewMore'),
                            size: 'sm',
                            disabled: previewBusy(),
                            onClick: more,
                          })
                        : null,
                    })
                  : null,
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
      const { scope, id, key: wanted } = memberAccessTarget(),
        state = memberAccess(),
        current = state.key === wanted
      if (!current || state.loading) return FlowLoading({ label: tr('flow.ui.opening.flow') })
      if (state.error)
        return FlowEmpty({
          title: tr('flow.ui.unable.to.open.flow'),
          description: state.error.message,
          action: FlowButton({ label: tr('flow.ui.try.again'), onClick: () => loadMemberAccess(true) }),
        })
      const entity = state.item
      if (!entity || entity.status !== 'active')
        return FlowEmpty({ title: mt('notFound'), description: mt('notFoundDetail') })
      const a = entity.access,
        editable = manage(scope, id)
      const source = (x) =>
        FlowListItem({
          title: accessSourceLabel(x),
          description:
            roleLabel(x.role) +
            ' · ' +
            (x.teamId
              ? mt('teamWide', [x.teamMemberCount, x.teamTitle])
              : x.grantId
                ? mt('direct')
                : mt('inherited')),
          actions:
            editable && x.grantId
              ? button(
                  x.teamId ? mt('removeTeam') : mt('removeDirect'),
                  () =>
                    confirmRun(
                      accessSourceLabel(x),
                      tr('flow.organization.confirmAccessRevoke'),
                      x.teamId ? mt('removeTeam') : mt('removeDirect'),
                      'access.revoke',
                      { id: x.grantId },
                    ),
                  false,
                  ctx.busy(),
                )
              : null,
        })
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
            { label: mt('teams'), value: entity.teams.map((t) => t.title).join(', ') || '—' },
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
      // The actor's own admin grants say where they may grant, past any loaded project window.
      if (!manage() && !(d().grants ?? []).some((g) => g.role === 'admin' && manage(g.scope, g.targetId)))
        return denied()
      const scope = grantScope() || params.accessScope || 'workspace',
        subjectType = grantKind()
      const workspaces = d().workspaces.filter((x) => !x.archived && manage('workspace', x.id))
      const chosen = grantPeople().length
        ? grantPeople()
        : params.team
          ? [params.team]
          : params.user && subjectType === 'user'
            ? [params.user]
            : []
      const subjectTitle = (id) => {
        const known = knownSubjects.get(`${subjectType}:${id}`)
        if (subjectType === 'team') return known?.title ?? d().teams.find((t) => t.id === id)?.title
        return (
          known?.name ??
          d().members.find((m) => m.id === id)?.name ??
          factsOf()?.value?.items?.find((m) => m.id === id)?.name
        )
      }
      const found = grantSubjects?.state().items ?? []
      const subjects = grantSubjects
        ? [
            ...chosen.map((id) => ({
              id,
              title: subjectTitle(id) ?? tr('flow.organization.subjectLoading'),
              color: 'blue',
            })),
            ...found
              .filter((x) => !chosen.includes(x.id))
              .map((x) => ({ id: x.id, title: x.name ?? x.title, color: 'blue' })),
          ]
        : (subjectType === 'team'
            ? d().teams.filter((team) => !team.archived)
            : d().members.filter((m) => m.status === 'active' && (scope === 'project' || m.role !== 'guest'))
          ).map((x) => ({ id: x.id, title: x.name ?? x.title, color: 'blue' }))
      const fixedTitle = params.target
        ? scope === 'workspace'
          ? d().workspaces.find((x) => x.id === params.target)?.title
          : (d().projects.find((x) => x.id === params.target)?.title ??
            knownProjects.get(params.target)?.title)
        : null
      const target = scope === 'workspace' ? '' : grantTarget()
      const targetName = knownProjects.get(target)?.title ?? d().projects.find((x) => x.id === target)?.title
      const restart = () => {
        grantPeople.set([])
        grantSubjects?.close()
      }
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
            onChange: (e) => {
              grantScope.set(e.target.value)
              grantTarget.set('')
              grantTargets?.close()
              restart()
            },
          }),
          params.target
            ? html`<input type="hidden" name="targetId" value=${params.target}/><input type="hidden" name="scope" value=${scope}/>${FlowHint({ children: (fixedTitle ?? params.target) + ' · ' + (scope === 'workspace' ? 'Workspace' : tr('flow.ui.project')) })}`
            : scope === 'workspace' || !grantTargets
              ? select(
                  'targetId',
                  scope === 'workspace' ? 'Workspace' : tr('flow.ui.project'),
                  workspaces[0]?.id,
                  workspaces.map((x) => ({ value: x.id, label: x.title })),
                )
              : // Projects the actor may grant on are searched on the server.
                html`<input type="hidden" name="targetId" value=${target}/>${FlowChoiceField({
                  id: 'grant-target',
                  label: tr('flow.ui.project'),
                  icon: 'folder',
                  value: target,
                  selected: {
                    label: targetName ?? tr('flow.ui.select.project'),
                    content: targetName ?? tr('flow.ui.select.project'),
                  },
                  options: (grantTargets.state().items ?? []).map((x) => ({
                    value: x.id,
                    label: x.title,
                    content: x.title,
                    description: x.code,
                  })),
                  ...remoteOf(grantTargets),
                  onChange: (id) => grantTarget.set(id),
                })}${ctx.formError()?.targetId ? html`<small id="grant-target-error" data-flow="field-error">${ctx.formError().targetId}</small>` : null}`,
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
              restart()
            },
          }),
          FlowTagPicker({
            id: 'grant-subjects',
            placeholder: subjectType === 'team' ? tr('flow.ui.select.team') : tr('flow.ui.select.member'),
            label: subjectType === 'team' ? tr('flow.ui.granted.team') : tr('flow.ui.granted.member'),
            value: chosen,
            options: subjects,
            ...(grantSubjects ? remoteOf(grantSubjects) : {}),
            onChange: grantPeople.set,
          }),
          select('role', tr('flow.ui.role'), 'viewer', roles),
          notice(
            tr('flow.ui.guest'),
            tr('flow.ui.guests.can.only.be.granted.specific.projects.teams.and.workspaces.are.for.intern'),
          ),
        ),
        (v) => run('access.grant', { ...v, subjectIds: chosen }, ctx.close),
        tr('flow.ui.grant.permissions'),
        !chosen.length || (scope === 'project' && !params.target && grantTargets && !target),
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
            value:
              workspaceAccess() ||
              (key === 'workspace-edit' && ws?.access === 'internal' ? 'internal' : 'restricted'),
            options: [
              { value: 'restricted', label: tr('flow.ui.only.granted.people.teams') },
              { value: 'internal', label: tr('flow.ui.internal.organization.members') },
            ],
            onChange: (e) => {
              workspaceAccess.set(e.target.value)
              const wanted = key === 'workspace-edit' ? workspaceImpact() : null
              if (wanted) void loadImpact(wanted.key, wanted.input)
            },
          }),
          (() => {
            const counts = factsOf()
            if (counts?.error)
              return inline(
                FlowHint({ children: tr('flow.organization.countsUnavailable') }),
                button(tr('flow.ui.try.again'), () => loadFacts(true)),
              )
            return FlowHint({
              children: counts?.value
                ? tr(
                    'flow.ui.inherited.projects.will.use.workspace.permissions.internal.access.allows.organiz',
                    [counts.value.projects, counts.value.members],
                  )
                : tr('flow.organization.countsLoading'),
            })
          })(),
          key === 'workspace-edit' &&
            workspaceAccess() &&
            workspaceAccess() !== (ws.access === 'internal' ? 'internal' : 'restricted')
            ? FlowDisclosure({
                title: tr('flow.ui.permission.changes.in.inherited.projects'),
                open: true,
                children: impactList(workspaceImpact(), (x) => x.name + ' · ' + x.projectTitle),
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
      const projectCount =
        d().context?.workspaceId === ws.id ? (d().counts?.projects ?? projects.length) : projects.length
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
          ctx.busy() || projectCount > 0,
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
                projectCount
                  ? nav('workspace-overview', tr('flow.organization.archiveProjects', [projectCount]), {
                      workspace: ws.id,
                    })
                  : null,
              ),
              confirmDisabled: projectCount > 0,
              onConfirm: () =>
                run('workspace.archive', { id: ws.id }, () =>
                  ctx.navigate('workspaces', {}, { replace: true }),
                ),
            },
          }
        : stack(body, footer)
    }
    if (key === 'member-invite' && d().invitationDelivery === 'unconfigured')
      return FlowEmpty({
        title: tr('flow.invitation.deliveryTitle'),
        description: tr('flow.invitation.deliveryMissing'),
      })
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
                tr(
                  d().invitationDelivery === 'queued-email'
                    ? 'flow.invitation.deliveryTitle'
                    : 'flow.ui.prototype.invitations',
                ),
                tr(
                  d().invitationDelivery === 'queued-email'
                    ? 'flow.invitation.deliveryQueued'
                    : 'flow.ui.creates.a.pending.invitation.only.no.email.is.sent',
                ),
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
            entity.role === 'guest' ? guestProjectsSection(entity) : null,
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
                    ...revokeImpact(),
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
    prepare() {
      if (ctx.route?.() === 'workspace-overview') overview.prepare()
      if (ctx.route?.() === 'member-access') void loadMemberAccess()
      if (ctx.route?.() === 'team') void loadTeam()
      void loadFacts()
      void loadGuestGrants()
      const wanted = pendingImpact()
      if (wanted) void loadImpact(wanted.key, wanted.input)
    },
    dispose() {
      overview.reset()
      candidates?.dispose()
      for (const options of [guestProjects, grantTargets, grantSubjects]) options?.dispose()
    },
    reset() {
      overview.reset()
      grantPeople.set([])
      teamCandidate.set('')
      candidates?.close()
      guestProject.set('')
      grantTarget.set('')
      for (const options of [guestProjects, grantTargets, grantSubjects]) options?.close()
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
      memberAccessTicket++
      memberAccess.set({ key: '', loading: false, error: null, item: null })
      impactTicket++
      impact.set({ key: '', loading: false, error: null, items: [], total: 0, cursor: null })
    },
  }
}
