import { auditChange } from './audit-display.mjs'
import { createMemberOptions } from './member-options.mjs'
import { createStatusOptions } from './status-options.mjs'
import { createPlanningWindows } from './planning-window.mjs'
import { createScreenHelp, screenHelpTrigger } from './screen-help.mjs'
import { projectRecord, taskEpic } from './project-record.mjs'
import { mutationFeedback } from './mutation-feedback.mjs'
import { prepareFlowCommand } from './command-contract.mjs'
import { FlowLiveDoc, FlowLiveDocText, setFlowLiveDocEditor } from '@ketvietlab/flow-ui'
import { tr, flowLocaleTag, flowLocale, setFlowLocale, normalizeFlowLocale, FLOW_LANGUAGES } from './i18n.mjs'
import { taskAssigneeIds, taskUsers, taskAssigneeNames, isAssignedTo } from './task-assignees.mjs'
import {
  taskColumns,
  taskTags,
  taskFields,
  taskTypeDefinition,
  projectStatuses,
  statusKind,
  taskStatusDefinition,
  isDone,
  taskTypeIcons,
} from './project-catalogs.mjs'
import { html, each, signal, batch, effect, hydrateRoot, domHost } from '@ketvietlab/ketjs-view'
import { readFlowAppearance, writeFlowAppearance } from './preferences.mjs'
import { normalizeBulkOutcome, selectionAfterBulk, bulkReasonKey } from './bulk.mjs'
import { createFormLeaveGuard } from './form-leave.mjs'
import { createFlowHistory, createHistoryLeaveGuard } from './navigation-history.mjs'
import {
  FlowShell,
  FlowShellHeader,
  FlowDialog,
  FlowConfirmDialog,
  FlowButton,
  FlowSelect,
  FlowInput,
  FlowCheckbox,
  FlowStatus,
  FlowPriority,
  FlowAvatar,
  FlowTag,
  FlowTaskRow,
  FlowTaskCard,
  FlowEmpty,
} from '@ketvietlab/flow-ui'
import {
  FlowUserPicker,
  FlowDateField,
  FlowChoiceField,
  FlowFileDrop,
  FlowAttachment,
  FlowMediaPreview,
  FlowDisclosure,
  FlowList,
  FlowListItem,
  FlowHint,
  FlowContextPicker,
  FlowProjectDirectory,
  FlowScopeMenu,
  FlowScopeTabs,
  FlowUserMenu,
  FlowTagPicker,
  FlowColorPicker,
  FlowNavigation,
  FlowNavItem,
  FlowNavGroup,
  FlowToolbar,
  FlowProjectViews,
  FlowInline,
  FlowStack,
  FlowSection,
  FlowNotice,
  FlowToast,
  FlowMetrics,
  FlowTable,
  FlowGroup,
  FlowBoard,
  FlowRecordLayout,
  FlowRecordAsideTrigger,
  FlowProperties,
  FlowSetupForm,
  FlowPropertyFields,
  FlowTextarea,
  FlowSelectField,
  FlowResourceCard,
  FlowCardGrid,
  FlowActivity,
  FlowSheet,
  FlowLoading,
} from '@ketvietlab/flow-ui/workspace'
import { attachFlowUI, syncFlowThemeButton, syncFlowShellNavigation } from '@ketvietlab/flow-ui/runtime'
import {
  routeScope,
  pageRoutes,
  libraryReturn,
  managementNavigation,
  workspaceRecordTarget,
} from './navigation.mjs'
import { routes } from './routes.mjs'
import { createGlobalSearch } from './global-search.mjs'
import { contentWidthFor } from './content-layout.mjs'
import { appliesTo, validateCustomFields } from './custom-fields.mjs'
import { createOperationsState, operationRoutes } from './operations-state.mjs'
import { flowExtensions, extensionRoutes, extensionForms, extensionErrors } from './extensions.mjs'
import { organizationRoutes, organizationForms } from './organization-routes.mjs'
import { createDeferredController } from './deferred-controller.mjs'
import { canManageScope } from './access-model.mjs'
import { createDocuments, documentRoutes } from './documents.mjs'
import { retainedDocumentSnapshot } from './document-navigation.mjs'
import { documentMoveCandidates } from './document-tree.mjs'
import { todayDate, addDays } from './timeline.mjs'
import { sortedListTasks, taskPage, orderedTasks, taskGroupValue, taskGroups } from './task-order.mjs'
import { createTaskAutosave } from './task-autosave.mjs'
import { createProjectSetup } from './project-setup.mjs'
import { usesSprints, nextSprint } from './sprint-cadence.mjs'
import { createFirstRun } from './first-run.mjs'
import { taskFieldControl } from './task-field-control.mjs'
import { createTaskComposer } from './task-composer.mjs'
import { createTaskExchange } from './task-exchange.mjs'
import { createTaskRelocation, relocationRoutes } from './task-relocation.mjs'
import { createTransientNotice } from './notice.mjs'
import { createFnClient, createFileUploader, FlowApiError, selectFlowCompany } from './api.mjs'

const moreRoutes = {
  dashboard: ['flow.ui.overview', 'flow.ui.manage'],
  forms: ['flow.ui.intake.forms', 'flow.ui.setup'],
  calendar: ['flow.ui.task.calendar', 'flow.ui.planning'],
  'saved-views': ['flow.ui.saved.views', 'flow.ui.work'],
}
for (const [key, [title, group]] of Object.entries(moreRoutes))
  routes[key] = {
    get title() {
      return tr(title)
    },
    get group() {
      return tr(group)
    },
    pattern: 'workspace',
  }
Object.assign(routes, organizationRoutes)
export { routes }
const listKeys = new Set([
  'my-work',
  'all-issues',
  'issue-filter',
  'project-issues',
  'issues-archived',
  'filter-limit',
  'bulk',
])
const detailKeys = new Set(['issue', 'issue-peek', 'description', 'history', 'follow'])
export const taskModalRoutes = new Set([
  ...detailKeys,
  'issue-new',
  'subtask-new',
  'issue-move',
  'board-move',
  'issue-sprint',
  'subtask-link',
  'dependency-new',
  'issue-archive',
  ...relocationRoutes,
  'comment',
])
const documentKeys = new Set(['pages', 'all-pages', 'page-archived'])
const taskWriteDestinations = new Set([
  'issue-new',
  'subtask-new',
  'subtask-link',
  'dependency-new',
  'issue-archive',
  'issue-transfer',
])
const formDefinitions = {
  'project-new': {
    collection: 'projects',
    get title() {
      return tr('flow.ui.create.project')
    },
    back: 'projects',
  },
  'project-profile': {
    collection: 'projects',
    get title() {
      return tr('flow.ui.project.profile')
    },
    back: 'settings',
    edit: true,
  },
  'column-edit': {
    collection: 'columns',
    get title() {
      return tr('flow.ui.task.statuses.d92c22')
    },
    back: 'workspace-settings',
  },
  'type-edit': {
    collection: 'types',
    get title() {
      return tr('flow.ui.task.type')
    },
    back: 'workspace-settings',
  },
  'field-edit': {
    collection: 'fields',
    get title() {
      return tr('flow.ui.custom.fields')
    },
    back: 'workspace-settings',
  },
  'tag-edit': {
    collection: 'tags',
    get title() {
      return tr('flow.ui.shared.labels')
    },
    back: 'tags',
  },
  'sprint-new': {
    collection: 'sprints',
    get title() {
      return tr('flow.ui.create.sprint')
    },
    back: 'sprints',
  },
  'epic-new': {
    collection: 'epics',
    get title() {
      return tr('flow.ui.create.epic')
    },
    back: 'epics',
  },
}
const documentModalRoutes = new Set(['page-move'])
const coreFormModals = new Set([
  ...Object.keys(formDefinitions).filter((key) => key !== 'project-profile'),
  ...Object.keys(organizationForms),
  'page-move',
  'sprint-close',
  'display',
  'timezone',
])
// Extensions register their forms after this module loads, so membership is checked on use.
const formModalRoutes = { has: (key) => coreFormModals.has(key) || Object.hasOwn(extensionForms, key) }
const modalRoutes = { has: (key) => taskModalRoutes.has(key) || formModalRoutes.has(key) }
const modalFallback = (key) =>
  extensionForms[key]?.back ??
  organizationForms[key]?.back ??
  formDefinitions[key]?.back ??
  {
    'page-move': 'page',
    'sprint-close': 'sprints',
    display: 'all-issues',
    timezone: 'workspace-settings',
    cmdk: 'my-work',
    'board-move': 'board',
  }[key] ??
  'my-work'
const parseBackground = (value, companyId, base) => {
  if (typeof value !== 'string' || !value.startsWith(base)) return null
  try {
    const url = new URL(value, 'http://flow.local')
    const screen = url.pathname.slice(base.length)
    if (
      url.origin !== 'http://flow.local' ||
      !routes[screen] ||
      modalRoutes.has(screen) ||
      (url.searchParams.get('company') ?? 'demo') !== companyId
    )
      return null
    url.searchParams.delete('background')
    return { screen, url: url.pathname + url.search, record: url.searchParams.get('id') ?? 'KV-142' }
  } catch {
    return null
  }
}
const tidy = (s) =>
  String(s)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/g, 'd')
    .toLowerCase()
const collect = (e) => Object.fromEntries(new FormData(e.currentTarget))
const options = (values) => values.map((value) => ({ value, label: value }))
const inline = (...children) =>
  FlowInline({
    children: html`${each(
      children,
      (_, i) => i,
      (x) => html`${x}`,
    )}`,
  })
const actions = (...children) =>
  FlowInline({
    align: 'end',
    children: html`${each(
      children,
      (_, i) => i,
      (x) => html`${x}`,
    )}`,
  })
const stack = (...children) =>
  FlowStack({
    children: html`${each(
      children,
      (_, i) => i,
      (x) => html`${x}`,
    )}`,
  })
// How long navigation may show a screen read again without asking, how many such reads are
// kept, and how long writes must pause before the screen is read again after a patched write.
const READ_REUSE_MS = 30_000,
  READS_KEPT = 8,
  REVALIDATE_MS = 300

/** Product island factory. Environment changes the transport, never the presenters. */
export function createFlowWorkspace(props = {}, dependencies = {}) {
  // The host names the module of its live document editor; Flow does not import one.
  if (props.liveDocEditor) setFlowLiveDocEditor(props.liveDocEditor)
  const fallbackBackground = () => {
    const screen = modalFallback(props.screen)
    const url = new URL((props.basePath ?? '/flow/') + screen, 'http://flow.local')
    for (const [key, value] of Object.entries({
      company: props.companyId,
      workspace: props.workspaceId,
      project: routeScope(screen) === 'project' ? props.project : undefined,
      q: props.query || undefined,
      status: props.status === 'all' ? undefined : props.status,
    }))
      if (value) url.searchParams.set(key, value)
    return { screen, url: url.pathname + url.search }
  }
  const initialBackground = modalRoutes.has(props.screen)
    ? (parseBackground(props.background, props.companyId ?? 'demo', props.basePath ?? '/flow/') ??
      fallbackBackground())
    : null
  const backgroundParams = initialBackground
    ? new URL(initialBackground.url, 'http://flow.local').searchParams
    : null
  const history = globalThis.history ? createFlowHistory(globalThis.history) : null
  const transport = dependencies.call ?? createFnClient()
  const upload = dependencies.upload ?? createFileUploader()
  const stagedDraftFiles = new WeakMap()
  const companyId = signal(props.companyId ?? 'demo'),
    workspaceId = signal(props.workspaceId ?? '')
  const personalWorkspace = signal('all')
  let mounted = false
  const recentByCompany = new Map(),
    recentCommands = new Map()
  const call = (name, input = {}, options = {}) =>
    transport(name, { companyId: companyId(), workspaceId: workspaceId(), ...input }, options)
  const initialShellData = dependencies.initialShellData ?? props.chrome ?? null
  const data = signal(initialShellData),
    primaryReady = signal(!props.serverShell || !!initialShellData?.problem),
    loading = signal(!initialShellData),
    failure = signal(initialShellData?.problem ?? null),
    readFailure = signal(false),
    busy = signal(false),
    notice = signal('')
  const modalRead = signal(null)
  let modalReadTicket = 0
  const feedback = createTransientNotice((value) => notice.set(value))
  const dismissedDataNotice = signal('')
  // Files dropped on a task save immediately; a failed save keeps them here for retry.
  const pendingFiles = signal(null),
    previewFile = signal('')
  const selectedView = signal(backgroundParams?.get('view') ?? props.view ?? '')
  const savedViewOpen = signal(false)
  let savedViewDraft = { title: '', description: '' }
  const modalRoute = signal(modalRoutes.has(props.screen) ? props.screen : null)
  const activeRoute = () => modalRoute() ?? screen()
  const screen = signal(
      modalRoutes.has(props.screen)
        ? (initialBackground?.screen ?? modalFallback(props.screen))
        : props.screen === 'cmdk'
          ? 'my-work'
          : (props.screen ?? 'my-work'),
    ),
    record = signal(props.record ?? 'KV-142'),
    recordProvided = signal(props.recordProvided ?? props.record != null),
    project = signal(backgroundParams ? (backgroundParams.get('project') ?? '') : (props.project ?? 'core')),
    modalProject = signal(props.project ?? 'core'),
    modalScope = signal(props.scope ?? '')
  const query = signal(backgroundParams?.get('q') ?? props.query ?? ''),
    status = signal(backgroundParams?.get('status') ?? props.status ?? 'all'),
    selected = signal([]),
    theme = signal('light'),
    density = signal('compact')
  const formError = signal({}),
    groupBy = signal('status')
  let lifetime, readController, runtime, host, observer
  const pendingLeave = signal(null)
  const pendingAction = signal(null)
  const returningHistory = signal(false)
  let submittedForm = null
  const formGuard = createFormLeaveGuard({
    context: () => {
      const key = modalRoute()
      if (
        ['issue-new', 'subtask-new', 'cmdk', 'display', 'timezone', 'personal-settings'].includes(
          key ?? screen(),
        )
      )
        return ''
      const guarded =
        (formModalRoutes.has(key) && !['cmdk', 'display', 'timezone'].includes(key)) ||
        (taskModalRoutes.has(key) && !detailKeys.has(key) && !['issue-new', 'subtask-new'].includes(key))
      const form =
        host?.querySelector('dialog[data-flow-route-modal] form') ??
        host?.querySelector('[data-flow="shell-main"] form')
      return guarded || form
        ? [
            companyId(),
            workspaceId(),
            key ?? screen(),
            record(),
            modalRoute() ? modalProject() || project() : project(),
            form?.closest('dialog')?.id ?? 'page',
          ].join('|')
        : ''
    },
    forms: () => {
      const modal = host?.querySelectorAll('dialog[data-flow-route-modal] form') ?? []
      return modal.length ? modal : (host?.querySelectorAll('[data-flow="shell-main"] form') ?? [])
    },
  })
  const requestLeave = (action) => {
    const leave = () => {
      formGuard.discard()
      action()
    }
    if (formGuard.hasChanges()) pendingLeave.set({ action: leave })
    else leave()
  }
  const discardConfirmation = () =>
    pendingLeave()
      ? FlowConfirmDialog({
          id: 'flow-discard-confirm',
          title: tr('flow.draft.title'),
          message: pendingLeave().message ?? tr('flow.draft.message'),
          cancelLabel: tr('flow.draft.keep'),
          confirmLabel: tr('flow.draft.discard'),
          loading: returningHistory(),
          onCancel: () => pendingLeave.set(null),
          onConfirm: () => {
            const leave = pendingLeave()
            formGuard.discard()
            if (activeRoute() === 'task-exchange') taskExchange.discard()
            pendingLeave.set(null)
            leave?.action()
          },
        })
      : null
  const destructiveConfirmation = () =>
    pendingAction()
      ? FlowConfirmDialog({
          id: 'flow-action-confirm',
          title: pendingAction().title,
          message: pendingAction().message,
          cancelLabel: tr('flow.ui.cancel'),
          confirmLabel: pendingAction().label,
          tone: pendingAction().tone,
          loading: busy(),
          feedback: feedbackToast('inline'),
          onCancel: () => pendingAction.set(null),
          onConfirm: async () => {
            if (busy()) return
            const request = pendingAction()
            if (await request.action()) pendingAction.set(null)
          },
        })
      : null
  const confirmAction = (request) => {
    if (busy() || !canWrite() || pendingAction()) return false
    const submission = submittedForm
    submittedForm = null
    pendingAction.set({
      ...request,
      action: () => {
        submittedForm = submission
        return request.action()
      },
    })
    return true
  }
  let appearanceStorage
  const changeAppearance = (key, value) => {
    if (!writeFlowAppearance(appearanceStorage, key, value)) return
    if (key === 'theme') theme.set(value)
    else if (key === 'density') density.set(value)
  }
  const pendingOperations = new Map()
  let mutationTail = Promise.resolve()
  const saveRevision = signal(0)
  const documentScope = signal(
      backgroundParams
        ? (backgroundParams.get('scope') ?? (backgroundParams.has('project') ? 'project' : 'workspace'))
        : (props.scope ?? ''),
    ),
    libraryFilter = signal(props.projectFilter ?? 'all'),
    librarySearch = signal(props.docq ?? ''),
    libraryVisibility = signal(props.visibility === 'private' ? 'private' : 'shared'),
    documentReturn = signal(libraryReturn(props.returnTo, props.basePath ?? '/flow/'))
  let modalBackground = initialBackground ?? {
    screen: modalFallback(props.screen),
    url: '',
    record: props.record ?? 'KV-142',
  }
  const scrollPositions = new Map()
  const base = props.basePath ?? '/flow/'
  const canWrite = () => {
    if (data()?.capabilities?.write !== true) return false
    const access = data()?.projects.find(
      (p) => p.id === (modalRoute() ? modalProject() : project()),
    )?.accessInfo
    return scopeOf(activeRoute()) !== 'project' || !access || access.role !== 'viewer'
  }
  const scopeOf = (key) =>
    routeScope(key, modalRoute() && key === activeRoute() ? modalScope() : documentScope())
  const activeProject = () => (modalRoute() ? modalProject() : project())
  const backgroundRecord = () => (modalRoute() ? modalBackground.record : record())
  const selectedProject = () => data()?.projects.find((p) => p.id === project())
  const href = (key, params = {}) => {
    const scoped =
      routeScope(key, params.scope ?? (modalRoute() ? modalScope() : documentScope())) === 'project'
    const q = new URLSearchParams({
      company: companyId(),
      workspace: workspaceId(),
      lang: flowLocale(),
      ...(scoped ? { project: activeProject() } : {}),
      ...(listKeys.has(key) || key === 'board' ? { group: groupBy() } : {}),
      ...(pageRoutes.has(key) && !scoped ? { scope: 'workspace' } : {}),
      ...(pageRoutes.has(key) && documentReturn() ? { returnTo: documentReturn() } : {}),
      ...(extensionFor(key)?.urlParams?.() ?? {}),
      ...params,
    })
    if (!scoped) q.delete('project')
    if (props.serverShell && modalRoutes.has(key)) {
      const background = modalRoute()
        ? modalBackground.url
        : typeof location !== 'undefined'
          ? location.pathname + location.search
          : ''
      if (background && !params.background) q.set('background', background)
    }
    for (const [name, value] of q) if (!value || value === 'undefined' || value === 'null') q.delete(name)
    return `${base}${key}${q.size ? `?${q}` : ''}`
  }
  const documentContext = () => {
    if (!pageRoutes.has(activeRoute()) || !data()) return
    const page = data().pages.find((p) => p.id === record())
    if (page && !['pages', 'page-new', 'page-archived'].includes(activeRoute())) {
      ;(modalRoute() ? modalProject : project).set(page.projectId ?? '')
      ;(modalRoute() ? modalScope : documentScope).set(page.projectId ? 'project' : 'workspace')
      if (typeof location !== 'undefined') {
        const url = new URL(location.href)
        if (page.projectId) {
          url.searchParams.set('project', page.projectId)
          url.searchParams.delete('scope')
        } else {
          url.searchParams.delete('project')
          url.searchParams.set('scope', 'workspace')
        }
        history.replaceState(history.state, '', url)
      }
    }
  }
  const currentTask = () => {
    saveRevision()
    const task = data()?.tasks.find((t) => t.id === record())
    return task ? { ...task, ...autosave.draft(task.id) } : null
  }
  const mapped = (t) => ({
    ...t,
    assignees: taskUsers(data(), t),
    project: data()?.projects.find((p) => p.id === t.projectId)?.title ?? '',
    status: taskStatusDefinition(data(), t)?.kind ?? 'todo',
    statusColor: taskStatusDefinition(data(), t)?.color,
    statusLabel: taskStatusDefinition(data(), t)?.label ?? t.status,
  })
  const readUrl = () =>
    batch(() => {
      pendingAction.set(null)
      const previousRoute = activeRoute()
      const url = new URL(location.href)
      savedViewOpen.set(url.searchParams.get('modal') === 'save-view')
      selectedView.set(url.searchParams.get('view') ?? '')
      const nextCompany = url.searchParams.get('company') ?? props.companyId ?? 'demo'
      const changedCompany = nextCompany !== companyId()
      if (
        changedCompany ||
        (url.searchParams.get('workspace') ?? (props.serverShell ? props.workspaceId : '') ?? '') !==
          workspaceId()
      ) {
        selected.set([])
        bulkOutcome.set(null)
        for (const x of extensions) x.reset?.()
      }
      if (changedCompany) {
        readController?.abort()
        data.set(null)
        loading.set(true)
        failure.set(null)
        feedback.clear()
        dismissedDataNotice.set('')
        bulkOutcome.set(null)
        companyId.set(nextCompany)
      }
      workspaceId.set(url.searchParams.get('workspace') ?? (props.serverShell ? props.workspaceId : '') ?? '')
      personalWorkspace.set(url.searchParams.get('workspaceFilter') ?? 'all')
      const requestedKey = url.pathname.slice(base.length).replace(/\/$/, '') || 'my-work'
      const key = requestedKey === 'cmdk' ? 'my-work' : requestedKey
      const workspaceTarget = workspaceRecordTarget(
        key,
        url.searchParams.get('id'),
        url.searchParams.has('id'),
        url.searchParams.get('workspace'),
      )
      if (workspaceTarget !== null && !url.searchParams.has('id')) {
        url.searchParams.set('id', workspaceTarget)
        history.replaceState(history.state, '', url)
      }
      tagPreview.set(null)
      fieldKind.set(null)
      columnKind.set(null)
      pageParent.set(null)
      sprintCarryTo.set('Backlog')
      recordProvided.set(url.searchParams.has('id'))
      if (requestedKey === 'cmdk') searchEntryPending = true
      documentScope.set(
        url.searchParams.get('scope') ?? (url.searchParams.has('project') ? 'project' : 'workspace'),
      )
      libraryFilter.set(
        url.searchParams.get('projectFilter') ??
          (key === 'all-pages' ? url.searchParams.get('project') : null) ??
          'all',
      )
      librarySearch.set(url.searchParams.get('docq') ?? '')
      libraryVisibility.set(url.searchParams.get('visibility') === 'private' ? 'private' : 'shared')
      if (routeScope(key, documentScope()) !== 'project') {
        url.searchParams.delete('project')
        if (key === 'all-pages') {
          if (libraryFilter() !== 'all') url.searchParams.set('projectFilter', libraryFilter())
          for (const name of ['group', 'q', 'status']) url.searchParams.delete(name)
        }
        history.replaceState(history.state, '', url)
      }
      documentReturn.set(libraryReturn(url.searchParams.get('returnTo'), base))
      if (modalRoutes.has(key)) {
        const stored =
          parseBackground(url.searchParams.get('background'), companyId(), base) ??
          history.state?.flowBackground
        if (
          stored &&
          routes[stored.screen] &&
          !modalRoutes.has(stored.screen) &&
          (new URL(stored.url, url).searchParams.get('company') ?? 'demo') === companyId()
        )
          modalBackground = stored
        if (!modalBackground.url)
          modalBackground = {
            screen: modalFallback(key),
            url: `${base}${modalFallback(key)}${formModalRoutes.has(key) ? url.search : ''}`,
            record: url.searchParams.get('id') ?? 'KV-142',
          }
        screen.set(modalBackground.screen)
        modalRoute.set(key)
      } else {
        screen.set(routes[key] ? key : 'my-work')
        modalRoute.set(null)
      }
      record.set(url.searchParams.get('id') ?? 'KV-142')
      const viewUrl = modalRoute() ? new URL(modalBackground.url, url) : url
      modalProject.set(url.searchParams.get('project') ?? '')
      modalScope.set(
        url.searchParams.get('scope') ?? (url.searchParams.has('project') ? 'project' : 'workspace'),
      )
      project.set(viewUrl.searchParams.get('project') ?? '')
      documentScope.set(
        viewUrl.searchParams.get('scope') ?? (viewUrl.searchParams.has('project') ? 'project' : 'workspace'),
      )
      documentReturn.set(libraryReturn(viewUrl.searchParams.get('returnTo'), base))
      libraryFilter.set(viewUrl.searchParams.get('projectFilter') ?? 'all')
      librarySearch.set(viewUrl.searchParams.get('docq') ?? '')
      libraryVisibility.set(viewUrl.searchParams.get('visibility') === 'private' ? 'private' : 'shared')
      selectedView.set(viewUrl.searchParams.get('view') ?? '')
      for (const x of extensions) x.readUrl?.(Object.fromEntries(viewUrl.searchParams))
      documentContext()
      query.set(viewUrl.searchParams.get('q') ?? '')
      status.set(viewUrl.searchParams.get('status') ?? 'all')
      const grouping = viewUrl.searchParams.get('group') ?? 'status'
      groupBy.set(
        ['status', 'priority', 'assignee', 'sprint', 'none'].includes(grouping) ? grouping : 'status',
      )
      const sort = viewUrl.searchParams.get('sort') ?? 'due'
      listSort.set(['due', 'priority', 'manual'].includes(sort) ? sort : 'due')
      // Mount reads the URL before claiming SSR chrome. Keep the server's
      // authorized error state until a new read succeeds; clearing it here
      // would change the header/content shape during hydration.
      failure.set(props.serverShell ? (data()?.problem ?? null) : null)
      formError.set({})
      for (const x of extensions) void x.sync?.()
      globalSearch.contextChanged()
      if (mounted && data() && primaryReady()) documents.enter()
      if (mounted && data() && primaryReady()) preparePlanning()
      const readsForm = (route) =>
        route !== 'cmdk' && (formModalRoutes.has(route) || ['issue-new', 'subtask-new'].includes(route))
      const standaloneBackground = ['inbox', 'notifications', 'personal-settings'].includes(screen())
      if (
        mounted &&
        (changedCompany ||
          (standaloneBackground &&
            previousRoute !== activeRoute() &&
            (readsForm(previousRoute) || readsForm(activeRoute()))))
      )
        void readModalRoute()
      else if (mounted) void ensureRecord()
    })
  let documentNavigation = 0,
    nativeNavigation = 0
  const navigate = (key, params = {}, navigation = {}) => {
    if (key === 'cmdk') {
      globalSearch.focus()
      return
    }
    globalSearch.close()
    if (!navigation.documentSaved && mounted && documents.hasPendingNotes()) {
      const request = ++documentNavigation
      void documents.flush().then((ok) => {
        if (request !== documentNavigation) return
        if (ok) navigate(key, params, { ...navigation, documentSaved: true })
        else
          pendingLeave.set({
            message: tr('flow.draft.documentMessage'),
            action: () => {
              documents.discardPendingNotes()
              navigate(key, params, { ...navigation, documentSaved: true })
            },
          })
      })
      return
    }
    if (!navigation.confirmed && formGuard.hasChanges()) {
      if (!busy())
        pendingLeave.set({ action: () => navigate(key, params, { ...navigation, confirmed: true }) })
      return
    }
    if (params.project) {
      const target = data()?.projects.find((p) => p.id === params.project)
      if (target) {
        const recent = recentByCompany.get(companyId()) ?? data()?.recentProjects ?? []
        recentByCompany.set(companyId(), [target.id, ...recent.filter((id) => id !== target.id)])
      }
      if (target?.workspaceId) params = { workspace: target.workspaceId, ...params }
    }
    if (props.serverShell && mounted && !modalRoutes.has(key)) {
      if (!navigation.tasksSaved) {
        const request = ++nativeNavigation
        void Promise.all([autosave.flushAll(), flushLiveTasks()]).then(([, liveSaved]) => {
          if (
            !liveSaved ||
            request !== nativeNavigation ||
            lifetime?.aborted ||
            data()?.tasks.some((t) => autosave.state(t.id) === 'error')
          )
            return
          navigate(key, params, { ...navigation, tasksSaved: true })
        })
        return
      }
      const target = href(key, params)
      for (const x of extensions) x.beforeNavigate?.(key)
      // A revalidation may remove the current Workspace (for example after
      // archiving it). Its keyed island cannot claim the retained sidebar of
      // another context. Establish fresh SSR chrome at that boundary only.
      if (
        !navigation.freshShell &&
        dependencies.navigatePage &&
        (props.companyId ?? 'demo') === companyId() &&
        (props.workspaceId ?? '') === workspaceId()
      )
        void dependencies
          .navigatePage(target, { replace: !!navigation.replace, fallback: 'error' })
          .catch((error) => {
            if (error.name !== 'AbortError') feedback.show(tr('flow.ui.unable.to.open.flow'))
          })
      else if (navigation.replace) location.replace(target)
      else location.assign(target)
      return
    }
    if (activeRoute() === 'task-exchange' && key !== 'task-exchange') taskExchange.dispose()
    if (organizationForms[key]) organization.reset()
    for (const x of extensions) x.beforeNavigate?.(key)
    if (['project-new', 'project-profile'].includes(key)) projectSetup.reset()
    if (!modalRoutes.has(key) && (key !== screen() || (params.project && params.project !== project())))
      operations.reset()
    if (key === 'tag-edit') tagPreview.set(null)
    if (key === 'field-edit') fieldKind.set(null)
    if (key === 'column-edit') columnKind.set(null)
    const area = host?.querySelector('[data-flow="shell-content"]')
    if (area) scrollPositions.set(screen(), area.scrollTop)
    const docArea = host?.querySelector('[data-flow="docs-scroll"]')
    if (docArea)
      scrollPositions.set(`document:${modalRoute() ? modalBackground.record : record()}`, docArea.scrollTop)
    let state = {}
    if (modalRoutes.has(key)) {
      if (!modalRoute())
        modalBackground = {
          screen: screen(),
          url: location.pathname + location.search,
          record: record(),
        }
      state = {
        flowBackground: modalBackground,
        flowModalDepth: modalRoute()
          ? (history.state?.flowModalDepth ?? 0) + (navigation.replace ? 0 : 1)
          : 1,
      }
    }
    history[navigation.replace ? 'replaceState' : 'pushState'](
      state,
      '',
      href(key, {
        ...(listKeys.has(key) || ['board', 'calendar'].includes(key) || routes[key]?.taskSearch
          ? { q: query(), status: status() }
          : {}),
        ...params,
      }),
    )
    readUrl()
    feedback.clear()
    requestAnimationFrame(() => {
      const a = host?.querySelector('[data-flow="shell-content"]')
      if (a) a.scrollTop = scrollPositions.get(screen()) ?? 0
      const d = host?.querySelector('[data-flow="docs-scroll"]')
      if (d)
        d.scrollTop = scrollPositions.get(`document:${modalRoute() ? modalBackground.record : record()}`) ?? 0
    })
  }
  const link = (key, label, icon = 'folder', params = {}, active = undefined) =>
    FlowNavItem({
      label,
      icon,
      count:
        key === 'inbox'
          ? (data()?.inboxUnreadCount ?? data()?.inbox.filter((n) => !n.read).length) || undefined
          : undefined,
      href: href(key, params),
      active:
        active ??
        (screen() === key ||
          (key === 'all-pages' && pageRoutes.has(screen()) && scopeOf(screen()) === 'workspace')),
      onClick: (e) => {
        if (e.button > 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return
        e.preventDefault()
        navigate(key, params)
      },
    })
  const navButton = (key, label, icon, variant = 'secondary', params = {}) =>
    FlowButton({
      label,
      icon,
      variant,
      size: 'sm',
      disabled: taskWriteDestinations.has(key) && (!canWrite() || busy()),
      onClick: () => navigate(key, params),
    })
  const showRead = (next) => {
    if (modalRoute() && screen() === 'inbox' && data()?.company?.id === next.company?.id)
      next = { ...next, inbox: data().inbox, inboxPage: data().inboxPage }
    planningWindows.reset()
    reportWindows.reset()
    riskWindows.reset()
    catalogPageState.set({})
    activityPageState.set({})
    memberPageTicket++
    memberPageLoading.set(false)
    memberPageError.set(null)
    invitationPageTicket++
    invitationPageLoading.set(false)
    invitationPageError.set(null)
    accessPageTicket++
    accessPageLoading.set(false)
    accessPageError.set(null)
    teamPageTicket++
    teamPageLoading.set(false)
    teamPageError.set(null)
    projectPageTicket++
    projectPageLoading.set(false)
    projectPageError.set(null)
    data.set({
      ...next,
      columns: next.columns.map((c) =>
        c.labelKey
          ? {
              ...c,
              get label() {
                return tr(c.labelKey)
              },
            }
          : c,
      ),
    })
    if (next.context) {
      workspaceId.set(next.context.workspaceId)
      if (next.context.projectId && scopeOf(activeRoute()) === 'project')
        (modalRoute() ? modalProject : project).set(next.context.projectId)
      if (typeof location !== 'undefined') {
        const url = new URL(location.href)
        url.searchParams.set('company', next.context.companyId)
        if (next.context.workspaceId) url.searchParams.set('workspace', next.context.workspaceId)
        else url.searchParams.delete('workspace')
        if (next.context.projectId && scopeOf(activeRoute()) === 'project')
          url.searchParams.set('project', next.context.projectId)
        history.replaceState(history.state, '', url)
      }
    }
    documentContext()
    failure.set(next.problem ?? null)
    readFailure.set(false)
    primaryReady.set(true)
    // Reconcile authorized navigation metadata in place (rename/default view/
    // access), without replacing the persistent SSR sidebar or its state.
    chromeRoots.get('sidebar')?.render(chromeRegions().sidebar)
    for (const x of extensions) void x.sync?.()
    globalSearch.contextChanged()
    if (!next.problem) documents.enter()
    if (!next.problem) preparePlanning()
    void ensureRecord()
    void ensureAccessPage()
  }
  // Navigation shows a screen read again for a short while instead of asking for it. Any
  // write, and any read that is not navigation, drops them all: only browsing reuses a read.
  const reads = new Map()
  let writes = 0,
    readAfterWrite = -1
  const reload = async ({ navigation = false } = {}) => {
    readController?.abort()
    const controller = new AbortController()
    const requestedCompany = companyId()
    readController = controller
    if (lifetime?.aborted) return false
    const input = {
      projectId: scopeOf(activeRoute()) === 'project' ? activeProject() : undefined,
      workspaceId: ['my-work', 'inbox'].includes(activeRoute())
        ? personalWorkspace() === 'all'
          ? undefined
          : personalWorkspace()
        : workspaceId(),
      route: activeRoute(),
      query: query(),
      status: status(),
      sort: listKeys.has(activeRoute()) ? listSort() : activeRoute() === 'calendar' ? 'due' : 'manual',
      ...(activeRoute() === 'calendar' ? operations.calendarWindow() : {}),
      inboxFilter: activeRoute() === 'inbox' ? operations.inboxFilter() : undefined,
      recordId:
        recordProvided() &&
        (taskModalRoutes.has(activeRoute()) ||
          extensionForms[activeRoute()] ||
          [
            'page',
            'page-child',
            'page-move',
            'invitation-accept',
            'member-edit',
            'member-access',
            'team',
            'team-edit',
            'column-edit',
            'type-edit',
            'tag-edit',
            'field-edit',
            'sprint-close',
            'sprint-report',
            'epic',
            'epic-new',
            'epic-map',
          ].includes(activeRoute()))
          ? record()
          : undefined,
    }
    const key = JSON.stringify([
        requestedCompany,
        workspaceId(),
        input.projectId,
        input.route,
        input.recordId,
        input.query,
        input.status,
        input.sort,
        input.dueFrom,
        input.dueTo,
        input.includeUndated,
        input.inboxFilter,
      ]),
      kept = navigation ? reads.get(key) : null
    if (kept && Date.now() - kept.at < READ_REUSE_MS) {
      reads.delete(key)
      reads.set(key, kept)
      showRead(kept.value)
      loading.set(false)
      return true
    }
    if (!navigation) reads.clear()
    const written = writes
    readAfterWrite = writes
    const abort = () => controller.abort()
    lifetime?.addEventListener('abort', abort, { once: true })
    if (!data()) loading.set(true)
    try {
      const next = await call('flow.workspace.bootstrap', input, { signal: controller.signal })
      if (!controller.signal.aborted && requestedCompany === companyId()) {
        // A write finished while this read was out: the read may predate it, and the write's
        // own read (or patch and revalidation) follows. Keep what the write left.
        if (written !== writes) return false
        if (!next.problem) {
          reads.delete(key)
          reads.set(key, { value: next, at: Date.now() })
          if (reads.size > READS_KEPT) reads.delete(reads.keys().next().value)
        }
        showRead(next)
        return true
      }
      return false
    } catch (e) {
      if (e.name !== 'AbortError') {
        if ((props.serverShell && !primaryReady()) || ['forbidden', 'unauthenticated'].includes(e.code))
          data.set(
            e.code === 'forbidden' && props.chrome?.problem?.code === 'forbidden' ? props.chrome : null,
          )
        failure.set({ code: e.code, message: e.message })
        readFailure.set(true)
        primaryReady.set(true)
      }
      return false
    } finally {
      lifetime?.removeEventListener('abort', abort)
      if (!controller.signal.aborted) loading.set(false)
    }
  }
  const readModalRoute = async () => {
    const ticket = ++modalReadTicket,
      route = activeRoute()
    modalRead.set({ route, pending: true })
    const ok = await reload({ navigation: true })
    if (ticket === modalReadTicket && route === activeRoute() && !lifetime?.aborted)
      modalRead.set(ok ? null : { route, pending: false })
  }
  const modalReadFallback = (id, key) => {
    const state = modalRead()
    if (!state || state.route !== key) return null
    return FlowDialog({
      id,
      title: routes[key].title,
      onRequestClose: closeModal,
      body: state.pending
        ? FlowLoading({ label: tr('flow.ui.opening.flow') })
        : FlowEmpty({
            title: tr('flow.ui.unable.to.open.flow'),
            action: FlowButton({ label: tr('flow.exchange.retry'), onClick: readModalRoute }),
          }),
    })
  }
  const collectionLoading = signal(false)
  const activityPageState = signal({})
  let commentDraft = { key: '', text: '' }
  const draftFor = (id) => {
    const key = companyId() + ':' + id
    if (commentDraft.key !== key) commentDraft = { key, text: '' }
    return commentDraft
  }
  const loadActivityPage = async (id, kind, restart = false) => {
    const task = data()?.tasks.find((item) => item.id === id),
      page = task?.activityPages?.[kind]
    const key = id + ':' + kind,
      route = activeRoute(),
      company = companyId(),
      written = writes
    if (!page || (!restart && !page.cursor) || activityPageState()[key]?.busy) return
    const token = {},
      current = () =>
        activityPageState()[key]?.token === token &&
        !lifetime?.aborted &&
        company === companyId() &&
        route === activeRoute() &&
        record() === id &&
        written === writes &&
        task === data()?.tasks.find((item) => item.id === id)
    const state = (value) => activityPageState.set({ ...activityPageState(), [key]: { token, ...value } })
    state({ busy: true })
    try {
      const next = await call(
        'flow.issue.activity',
        { id, kind, ...(restart ? {} : { cursor: page.cursor }), limit: 50 },
        { signal: lifetime },
      )
      if (!current()) return
      const previous = restart ? [] : data()[kind].filter((item) => item.taskId === id)
      const added = kind === 'comments' ? [...next.items].reverse() : next.items
      const ordered = kind === 'comments' ? [...added, ...previous] : [...previous, ...added]
      const unique = [...new Map(ordered.map((item) => [item.id, item])).values()]
      data.set({
        ...data(),
        [kind]: [...data()[kind].filter((item) => item.taskId !== id), ...unique],
        tasks: data().tasks.map((item) =>
          item.id !== id
            ? item
            : {
                ...item,
                activityPages: {
                  ...item.activityPages,
                  [kind]: { total: next.total, cursor: next.cursor },
                },
              },
        ),
      })
      state({})
    } catch (error) {
      if (!current()) return
      if (['forbidden', 'unauthenticated', 'not_found'].includes(error.code)) {
        data.set(null)
        reads.clear()
        failure.set(error)
      } else if (error.name !== 'AbortError') state({ error })
    } finally {
      if (activityPageState()[key]?.token === token && activityPageState()[key]?.busy) state({})
    }
  }
  const activityPageView = (task) => {
    const kind = activeRoute() === 'history' ? 'history' : 'comments'
    const page = task.activityPages?.[kind],
      state = activityPageState()[task.id + ':' + kind]
    if (!page) return null
    const loaded = data()[kind].filter((item) => item.taskId === task.id).length
    return FlowToolbar({
      inset: 'none',
      children: FlowHint({ children: tr('flow.list.showing', [loaded, page.total]) }),
      trailing: state?.error
        ? html`${FlowHint({ children: state.error.message })}${FlowButton({
            label: tr('flow.ui.try.again'),
            size: 'sm',
            onClick: () => loadActivityPage(task.id, kind, state.error.code === 'conflict'),
          })}`
        : page.cursor
          ? FlowButton({
              label: tr('flow.list.showMore', [Math.min(50, page.total - loaded), page.total - loaded]),
              size: 'sm',
              disabled: state?.busy,
              onClick: () => loadActivityPage(task.id, kind),
            })
          : null,
    })
  }
  const catalogPageState = signal({})
  const loadCatalogPage = async (collection) => {
    const page = data()?.catalogPages?.[collection],
      route = activeRoute(),
      company = companyId(),
      written = writes
    if (!page?.cursor || catalogPageState()[collection]?.busy) return
    const token = {},
      current = () =>
        catalogPageState()[collection]?.token === token &&
        !lifetime?.aborted &&
        company === companyId() &&
        route === activeRoute() &&
        written === writes &&
        page.cursor === data()?.catalogPages?.[collection]?.cursor
    const state = (value) =>
      catalogPageState.set({ ...catalogPageState(), [collection]: { token, ...value } })
    state({ busy: true })
    try {
      const next = await call(
        'flow.catalog.list',
        {
          companyId: company,
          kind: { columns: 'column', types: 'type', tags: 'tag', fields: 'field' }[collection],
          cursor: page.cursor,
          limit: 50,
        },
        { signal: lifetime },
      )
      if (!current()) return
      const records = new Map(data()[collection].map((item) => [item.id, item]))
      for (const item of next.items) records.set(item.id, item)
      data.set({
        ...data(),
        [collection]: [...records.values()],
        ...(collection === 'types' ? { taskTypes: [...records.values()] } : {}),
        ...(next.labelUsage ? { labelUsage: { ...data().labelUsage, ...next.labelUsage } } : {}),
        catalogPages: {
          ...data().catalogPages,
          [collection]: {
            total: next.total,
            cursor: next.cursor,
            loadedIds: [...new Set([...page.loadedIds, ...next.items.map((item) => item.id)])],
          },
        },
      })
      state({})
    } catch (error) {
      if (!current()) return
      if (['forbidden', 'unauthenticated'].includes(error.code)) {
        data.set(null)
        reads.clear()
        failure.set(error)
      } else if (error.name !== 'AbortError') state({ error })
    } finally {
      if (catalogPageState()[collection]?.token === token && catalogPageState()[collection]?.busy) state({})
    }
  }
  const catalogPageView = (collection) => {
    const page = data()?.catalogPages?.[collection],
      state = catalogPageState()[collection]
    return !page
      ? null
      : FlowToolbar({
          inset: 'none',
          children: FlowHint({ children: tr('flow.list.showing', [page.loadedIds.length, page.total]) }),
          trailing: state?.error
            ? html`${FlowHint({ children: state.error.message })}${FlowButton({ label: tr('flow.ui.try.again'), size: 'sm', onClick: () => (state.error.code === 'conflict' ? reload() : loadCatalogPage(collection)) })}`
            : page.cursor
              ? FlowButton({
                  label: tr('flow.list.showMore', [
                    Math.min(50, page.total - page.loadedIds.length),
                    page.total - page.loadedIds.length,
                  ]),
                  size: 'sm',
                  disabled: state?.busy,
                  onClick: () => loadCatalogPage(collection),
                })
              : null,
        })
  }
  const memberPageLoading = signal(false),
    memberPageError = signal(null)
  let memberPageTicket = 0
  const loadMemberPage = async () => {
    const page = data()?.memberPage,
      company = companyId(),
      written = writes
    if (!page?.cursor || memberPageLoading()) return
    const ticket = ++memberPageTicket
    memberPageLoading.set(true)
    memberPageError.set(null)
    try {
      const next = await call(
        'flow.member.list',
        { companyId: company, cursor: page.cursor, limit: 100 },
        { signal: lifetime },
      )
      if (
        ticket !== memberPageTicket ||
        lifetime?.aborted ||
        company !== companyId() ||
        written !== writes ||
        page.cursor !== data()?.memberPage?.cursor
      )
        return
      const people = new Map(data().members.map((m) => [m.id, m]))
      for (const m of next.items) people.set(m.id, m)
      data.set({
        ...data(),
        members: [...people.values()],
        memberPage: {
          total: next.total,
          cursor: next.cursor,
          loadedIds: [...new Set([...page.loadedIds, ...next.items.map((m) => m.id)])],
        },
      })
    } catch (error) {
      if (ticket !== memberPageTicket || company !== companyId()) return
      if (['forbidden', 'unauthenticated'].includes(error.code)) {
        data.set(null)
        reads.clear()
        failure.set(error)
      } else if (error.name !== 'AbortError') memberPageError.set(error)
    } finally {
      if (ticket === memberPageTicket) memberPageLoading.set(false)
    }
  }
  const memberPageView = () =>
    !data()?.memberPage
      ? null
      : FlowToolbar({
          inset: 'none',
          children: FlowHint({
            children: tr('flow.people.showing', [
              data().memberPage.loadedIds.length,
              data().memberPage.total,
            ]),
          }),
          trailing: memberPageError()
            ? html`${FlowHint({ children: memberPageError().message })}${FlowButton({ label: tr('flow.ui.try.again'), size: 'sm', onClick: loadMemberPage })}`
            : data().memberPage.cursor
              ? FlowButton({
                  label: tr('flow.people.more'),
                  size: 'sm',
                  disabled: memberPageLoading(),
                  onClick: loadMemberPage,
                })
              : null,
        })
  const invitationPageLoading = signal(false),
    invitationPageError = signal(null)
  let invitationPageTicket = 0
  const loadInvitationPage = async () => {
    const page = data()?.invitationPage,
      company = companyId(),
      written = writes
    if (!page?.cursor || invitationPageLoading()) return
    const ticket = ++invitationPageTicket
    invitationPageLoading.set(true)
    invitationPageError.set(null)
    try {
      const next = await call(
        'flow.invitation.list',
        { companyId: company, cursor: page.cursor, limit: 50 },
        { signal: lifetime },
      )
      if (
        ticket !== invitationPageTicket ||
        lifetime?.aborted ||
        company !== companyId() ||
        written !== writes ||
        page.cursor !== data()?.invitationPage?.cursor
      )
        return
      const held = new Map(data().invitations.map((i) => [i.id, i]))
      for (const i of next.items) held.set(i.id, i)
      data.set({
        ...data(),
        invitations: [...held.values()],
        invitationPage: {
          total: next.total,
          cursor: next.cursor,
          loadedIds: [...new Set([...page.loadedIds, ...next.items.map((i) => i.id)])],
        },
      })
    } catch (error) {
      if (ticket !== invitationPageTicket || company !== companyId()) return
      if (['forbidden', 'unauthenticated'].includes(error.code)) {
        data.set(null)
        reads.clear()
        failure.set(error)
      } else if (error.name !== 'AbortError') invitationPageError.set(error)
    } finally {
      if (ticket === invitationPageTicket) invitationPageLoading.set(false)
    }
  }
  // A cursor refused after another write starts over from the current first page.
  const invitationPageView = () =>
    !data()?.invitationPage
      ? null
      : FlowToolbar({
          inset: 'none',
          children: FlowHint({
            children: tr('flow.invitations.showing', [
              data().invitationPage.loadedIds.length,
              data().invitationPage.total,
            ]),
          }),
          trailing: invitationPageError()
            ? html`${FlowHint({ children: invitationPageError().message })}${FlowButton({ label: tr('flow.ui.try.again'), size: 'sm', onClick: () => (invitationPageError().code === 'conflict' ? reload() : loadInvitationPage()) })}`
            : data().invitationPage.cursor
              ? FlowButton({
                  label: tr('flow.invitations.more'),
                  size: 'sm',
                  disabled: invitationPageLoading(),
                  onClick: loadInvitationPage,
                })
              : null,
        })
  const accessPageLoading = signal(false),
    accessPageError = signal(null)
  let accessPageTicket = 0
  const loadAccessPage = async () => {
    const page = data()?.accessPage,
      company = companyId(),
      written = writes
    if (!page?.cursor || accessPageLoading()) return
    const ticket = ++accessPageTicket
    accessPageLoading.set(true)
    accessPageError.set(null)
    try {
      const next = await call(
        'flow.access.list',
        { companyId: company, scope: page.scope, targetId: page.targetId, cursor: page.cursor, limit: 50 },
        { signal: lifetime },
      )
      if (
        ticket !== accessPageTicket ||
        lifetime?.aborted ||
        company !== companyId() ||
        written !== writes ||
        page.cursor !== data()?.accessPage?.cursor
      )
        return
      const held = new Map(page.items.map((m) => [m.id, m]))
      for (const m of next.items) held.set(m.id, m)
      data.set({
        ...data(),
        accessPage: {
          ...page,
          items: [...held.values()],
          total: next.total,
          without: next.without,
          cursor: next.cursor,
          loadedIds: [...new Set([...page.loadedIds, ...next.items.map((m) => m.id)])],
        },
      })
    } catch (error) {
      if (ticket !== accessPageTicket || company !== companyId()) return
      if (['forbidden', 'unauthenticated'].includes(error.code)) {
        data.set(null)
        reads.clear()
        failure.set(error)
      } else if (error.name !== 'AbortError') accessPageError.set(error)
    } finally {
      if (ticket === accessPageTicket) accessPageLoading.set(false)
    }
  }
  // A members list behind a modal is not the route the bootstrap read, so a reload of the
  // modal's URL reads the list's first page here instead of loading forever.
  const ensureAccessPage = async () => {
    const key = screen(),
      scope = key === 'project-members' ? 'project' : key === 'workspace-members' ? 'workspace' : null,
      targetId = scope === 'project' ? project() : workspaceId(),
      held = data()?.accessPage,
      company = companyId(),
      written = writes
    if (!modalRoute() || !scope || !targetId || !data() || accessPageLoading()) return
    if (held?.scope === scope && held.targetId === targetId) return
    if (data().members.find((m) => m.id === data().user.id)?.role === 'guest') return
    const ticket = ++accessPageTicket
    accessPageLoading.set(true)
    accessPageError.set(null)
    try {
      const first = await call(
        'flow.access.list',
        { companyId: company, scope, targetId, limit: 50 },
        { signal: lifetime },
      )
      if (ticket !== accessPageTicket || lifetime?.aborted || company !== companyId() || written !== writes)
        return
      data.set({
        ...data(),
        accessPage: { scope, targetId, ...first, loadedIds: first.items.map((m) => m.id) },
      })
    } catch (error) {
      if (ticket !== accessPageTicket || company !== companyId()) return
      if (error.code === 'unauthenticated') {
        data.set(null)
        reads.clear()
        failure.set(error)
      } else if (error.name !== 'AbortError') accessPageError.set(error)
    } finally {
      if (ticket === accessPageTicket) accessPageLoading.set(false)
    }
  }
  const accessPageView = () =>
    !data()?.accessPage
      ? null
      : FlowToolbar({
          inset: 'none',
          children: FlowHint({
            children: tr('flow.access.showing', [
              data().accessPage.loadedIds.length,
              data().accessPage.total,
            ]),
          }),
          trailing: accessPageError()
            ? html`${FlowHint({ children: accessPageError().message })}${FlowButton({ label: tr('flow.ui.try.again'), size: 'sm', onClick: () => (accessPageError().code === 'conflict' ? reload() : loadAccessPage()) })}`
            : data().accessPage.cursor
              ? FlowButton({
                  label: tr('flow.access.more'),
                  size: 'sm',
                  disabled: accessPageLoading(),
                  onClick: loadAccessPage,
                })
              : null,
        })
  const teamPageLoading = signal(false),
    teamPageError = signal(null)
  let teamPageTicket = 0
  const loadTeamPage = async () => {
    const page = data()?.teamPage,
      company = companyId(),
      written = writes
    if (!page?.cursor || teamPageLoading()) return
    const ticket = ++teamPageTicket
    teamPageLoading.set(true)
    teamPageError.set(null)
    try {
      const next = await call(
        'flow.team.list',
        { companyId: company, cursor: page.cursor, limit: 100 },
        { signal: lifetime },
      )
      if (
        ticket !== teamPageTicket ||
        lifetime?.aborted ||
        company !== companyId() ||
        written !== writes ||
        page.cursor !== data()?.teamPage?.cursor
      )
        return
      const held = new Map(data().teams.map((t) => [t.id, t]))
      for (const t of next.items) held.set(t.id, t)
      data.set({
        ...data(),
        teams: [...held.values()],
        teamPage: {
          total: next.total,
          cursor: next.cursor,
          loadedIds: [...new Set([...page.loadedIds, ...next.items.map((t) => t.id)])],
        },
      })
    } catch (error) {
      if (ticket !== teamPageTicket || company !== companyId()) return
      if (['forbidden', 'unauthenticated'].includes(error.code)) {
        data.set(null)
        reads.clear()
        failure.set(error)
      } else if (error.name !== 'AbortError') teamPageError.set(error)
    } finally {
      if (ticket === teamPageTicket) teamPageLoading.set(false)
    }
  }
  const teamPageView = () =>
    !data()?.teamPage
      ? null
      : FlowToolbar({
          inset: 'none',
          children: FlowHint({
            children: tr('flow.teams.showing', [data().teamPage.loadedIds.length, data().teamPage.total]),
          }),
          trailing: teamPageError()
            ? html`${FlowHint({ children: teamPageError().message })}${FlowButton({ label: tr('flow.ui.try.again'), size: 'sm', onClick: () => (teamPageError().code === 'conflict' ? reload() : loadTeamPage()) })}`
            : data().teamPage.cursor
              ? FlowButton({
                  label: tr('flow.teams.more'),
                  size: 'sm',
                  disabled: teamPageLoading(),
                  onClick: loadTeamPage,
                })
              : null,
        })
  const projectPageLoading = signal(false),
    projectPageError = signal(null)
  let projectPageTicket = 0
  const loadProjectPage = async () => {
    const cursor = data()?.projectPage?.cursor
    if (!cursor || projectPageLoading()) return
    const ticket = ++projectPageTicket,
      company = companyId(),
      workspace = workspaceId(),
      written = writes
    projectPageLoading.set(true)
    projectPageError.set(null)
    try {
      const page = await call(
        'flow.project.list',
        { companyId: company, workspaceId: workspace, cursor, limit: 50 },
        { signal: lifetime },
      )
      if (
        lifetime?.aborted ||
        ticket !== projectPageTicket ||
        activeRoute() !== 'projects' ||
        company !== companyId() ||
        workspace !== workspaceId() ||
        written !== writes ||
        cursor !== data()?.projectPage?.cursor
      )
        return
      const held = new Set(data().projects.map((p) => p.id))
      data.set({
        ...data(),
        projects: [...data().projects, ...page.items.filter((p) => !held.has(p.id))],
        projectPage: { total: page.total, cursor: page.cursor },
      })
    } catch (error) {
      if (
        ticket !== projectPageTicket ||
        company !== companyId() ||
        workspace !== workspaceId() ||
        activeRoute() !== 'projects'
      )
        return
      if (error.name !== 'AbortError') {
        if (['forbidden', 'unauthenticated'].includes(error.code)) {
          data.set(null)
          reads.clear()
          failure.set(error)
        } else projectPageError.set(error)
      }
    } finally {
      if (ticket === projectPageTicket) projectPageLoading.set(false)
    }
  }
  const loadCollectionPage = async () => {
    const cursor = data()?.collectionPage?.cursor
    if (!cursor || collectionLoading()) return
    const route = activeRoute(),
      company = companyId(),
      written = writes,
      sort = listKeys.has(route) ? listSort() : route === 'calendar' ? 'due' : 'manual',
      dateWindow = route === 'calendar' ? operations.calendarWindow() : {}
    collectionLoading.set(true)
    try {
      const page = await call(
        'flow.issue.list',
        {
          route,
          projectId: scopeOf(route) === 'project' ? activeProject() : undefined,
          workspaceId:
            route === 'my-work'
              ? personalWorkspace() === 'all'
                ? undefined
                : personalWorkspace()
              : workspaceId(),
          cursor,
          limit: 50,
          query: query(),
          status: status(),
          sort,
          ...dateWindow,
        },
        { signal: lifetime },
      )
      if (
        lifetime?.aborted ||
        route !== activeRoute() ||
        company !== companyId() ||
        sort !==
          (listKeys.has(activeRoute()) ? listSort() : activeRoute() === 'calendar' ? 'due' : 'manual') ||
        (route === 'calendar' &&
          JSON.stringify(dateWindow) !== JSON.stringify(operations.calendarWindow())) ||
        written !== writes ||
        cursor !== data()?.collectionPage?.cursor
      )
        return
      const held = new Set(data().tasks.map((t) => t.id))
      let next = {
        ...data(),
        tasks: [...data().tasks, ...page.tasks.filter((t) => !held.has(t.id))],
        collectionPage: { ...data().collectionPage, cursor: page.cursor, total: page.total },
        counts: { ...data().counts, tasks: page.total, statuses: page.statusCounts, metrics: page.metrics },
      }
      for (const extension of extensions) next = extension.recordDetail?.(next, page) ?? next
      data.set(next)
    } catch (error) {
      if (error.name !== 'AbortError') failure.set({ code: error.code, message: error.message })
    } finally {
      collectionLoading.set(false)
    }
  }
  const collectionMore = () =>
    data()?.collectionPage?.cursor
      ? FlowToolbar({
          children: FlowHint({
            children: tr('flow.list.showing', [data().tasks.length, data().collectionPage.total]),
          }),
          trailing: FlowButton({
            label: tr('flow.list.showMore', [
              Math.min(50, data().collectionPage.total - data().tasks.length),
              Math.max(0, data().collectionPage.total - data().tasks.length),
            ]),
            size: 'sm',
            loading: collectionLoading(),
            disabled: busy(),
            onClick: loadCollectionPage,
          }),
        })
      : null
  // A read for a screen carries task summaries (`summary: true`). Opening one, in the task
  // detail or an extension form, reads its body, discussion, history and extension records;
  // until they arrive the dialog shows them loading, so no editor starts from a text not read.
  let recordController = null,
    pendingRecord = ''
  const recordFailed = signal('')
  // An extension form opens a task only when the URL names one (`id`); `record()` has a default.
  const opensTask = (key) =>
    detailKeys.has(key) ||
    relocationRoutes.has(key) ||
    (!!extensionForms[key] &&
      recordProvided() &&
      (extensionForms[key].taskRecord === true || data()?.tasks.some((t) => t.id === record())))
  const ensureRecord = async () => {
    const id = record(),
      task = opensTask(activeRoute()) ? data()?.tasks.find((t) => t.id === id) : null
    if (!opensTask(activeRoute()) || (task && !task.summary) || pendingRecord === id) return
    recordController?.abort()
    const controller = new AbortController(),
      requestedCompany = companyId()
    recordController = controller
    pendingRecord = id
    recordFailed.set('')
    let stale = false
    try {
      const value = await call('flow.issue.detail', { id }, { signal: controller.signal })
      const current = data()?.tasks.find((t) => t.id === id)
      if (
        controller.signal.aborted ||
        requestedCompany !== companyId() ||
        record() !== id ||
        !opensTask(activeRoute()) ||
        (current && !current.summary)
      )
        return
      // A newer read replaced the list meanwhile; read the record again rather than step back.
      stale = (value.task.version ?? 0) < (current?.version ?? 0)
      if (stale) return
      data.set(foldRecord(data(), value))
    } catch (e) {
      if (e.name !== 'AbortError' && recordController === controller) recordFailed.set(id)
    } finally {
      if (recordController === controller) pendingRecord = ''
      if (stale) void ensureRecord()
    }
  }
  const recordPending = (t) =>
    !t?.summary
      ? null
      : recordFailed() === t.id
        ? FlowNotice({
            title: tr('flow.record.loadFailed'),
            tone: 'red',
            action: FlowButton({ label: tr('flow.ui.try.again'), onClick: () => void ensureRecord() }),
          })
        : FlowLoading({ label: tr('flow.record.loading') })
  const openTaskPending = () =>
    recordPending(data()?.tasks.find((t) => t.id === record()) ?? { id: record(), summary: true })
  const foldRecord = (current, detail) => {
    const id = detail.task.id,
      others = (x) => x.taskId !== id
    let next = {
      ...current,
      tasks: current.tasks.some((t) => t.id === id)
        ? current.tasks.map((t) => (t.id === id ? detail.task : t))
        : [...current.tasks, detail.task],
      comments: [...current.comments.filter(others), ...detail.comments],
      history: [...current.history.filter(others), ...detail.history],
      files: [...(current.files ?? []).filter(others), ...(detail.files ?? [])],
    }
    for (const x of extensions) next = x.recordDetail?.(next, detail) ?? next
    return next
  }
  // A write that changed one task alone returns its detail (`record`). The task is patched
  // in place, a summary staying a summary, and the screen is read again once writes pause.
  const patchRecord = (detail) => {
    const id = detail?.task?.id,
      local = id == null ? null : data()?.tasks.find((t) => t.id === id)
    if (!local) return false
    if (local.summary) {
      const { description, descriptionDoc, ...summary } = detail.task
      data.set({
        ...data(),
        tasks: data().tasks.map((t) => (t.id === id ? { ...summary, summary: true } : t)),
      })
    } else data.set(foldRecord(data(), detail))
    return true
  }
  let revalidation = 0
  const revalidate = () => {
    const ticket = ++revalidation
    setTimeout(() => {
      if (ticket !== revalidation || lifetime?.aborted) return
      void mutationTail.then(() => {
        // A read that began after the last write already brings what it changed.
        if (readAfterWrite !== writes) void reload()
      })
    }, REVALIDATE_MS)
  }
  const mutate = (name, input = {}, success, opts = {}) => {
    if (
      !canWrite() &&
      !(
        ['flow.inbox.read', 'flow.preferences.save'].includes(name) ||
        (['flow.issue.copyTo', 'flow.invitation.accept'].includes(name) && opts.allowReadOnly)
      )
    )
      return Promise.resolve(false)
    // KetJS can delegate submit before our root capture listener. The focused
    // native form is the same submission boundary for keyboard and pointer use.
    const submission =
      submittedForm ??
      formGuard.submission(
        host?.ownerDocument.activeElement?.form ?? host?.ownerDocument.activeElement?.closest('form'),
      )
    submittedForm = null
    const mutationCompany = companyId()
    const mutationRoute = activeRoute()
    const execute = async () => {
      if (mutationCompany !== companyId()) return false
      busy.set(true)
      failure.set(null)
      readFailure.set(false)
      formError.set({})
      let signature, intent
      try {
        // Input may be async (e.g. uploading file bytes before saving their metadata).
        if (typeof input === 'function') input = await input()
        const semanticInput = { ...input }
        for (const field of [
          'expectedVersion',
          'expectedRevision',
          'expectedVersions',
          'expectedChildVersion',
          'expectedOrderRevision',
          'expectedSiblingIds',
        ])
          delete semanticInput[field]
        signature = JSON.stringify([mutationCompany, data()?.user?.id, name, semanticInput])
        intent = pendingOperations.get(signature) ?? { key: crypto.randomUUID(), input: null }
        intent.input ??= prepareFlowCommand(name, input, data())
        pendingOperations.set(signature, intent)
        const key = intent.key
        const value = await call(name, { ...intent.input, idempotencyKey: key }, { signal: lifetime, key })
        if (name === 'flow.issue.bulk' && !normalizeBulkOutcome(value, input.ids ?? [])) {
          bulkOutcome.set({ invalid: true, applied: 0, refused: [] })
          throw new FlowApiError(tr('flow.bulk.unknown'), 'bulkResult')
        }
        pendingOperations.delete(signature)
        reads.clear()
        if (mutationCompany !== companyId()) return false
        writes++
        if (patchRecord(value?.record)) revalidate()
        else await reload()
        formGuard.accept(submission)
        if (!opts.quiet)
          feedback.show(opts.message ? opts.message(value) : mutationFeedback(name, input, value, data()))
        // The command and its revalidation have finished. Completion callbacks
        // may now close a guarded dialog or navigate to the accepted record.
        busy.set(false)
        if (success) success(value)
        return true
      } catch (e) {
        // A definitive refusal committed nothing. Retry may capture the fresh
        // version after reloading; an uncertain network failure keeps its intent.
        if (intent && ['conflict', 'validation'].includes(e.code)) intent.input = null
        if (e.name !== 'AbortError') {
          opts.onError?.(e)
          const claimed = e.code === 'bulkResult' ? {} : extensionValue('mutationError', e, input)
          if (!claimed) failure.set({ code: e.code, message: e.message })
          else if (claimed.message) failure.set({ code: e.code, message: claimed.message })
          formError.set(e.fields ?? {})
          if (Object.keys(e.fields ?? {}).length && typeof requestAnimationFrame === 'function')
            requestAnimationFrame(() => {
              if (lifetime?.aborted || mutationCompany !== companyId() || mutationRoute !== activeRoute())
                return
              const form =
                submission?.form ??
                host?.querySelector('dialog[data-flow-route-modal] form') ??
                host?.querySelector('[data-flow="shell-main"] form')
              if (form) {
                if (runtime?.focusInvalid) runtime.focusInvalid(form)
                else form.querySelector('[aria-invalid="true"]')?.focus()
              }
            })
        }
        return false
      } finally {
        busy.set(false)
      }
    }
    const operation = mutationTail.then(execute, execute)
    mutationTail = operation.catch(() => {})
    return operation
  }
  const MAX_FILE_MB = 25
  const addFiles = (taskId, files) => {
    if (!files.length || !canWrite()) return
    const large = files.find((file) => file.size > MAX_FILE_MB * 1024 * 1024)
    if (large) {
      feedback.show(tr('flow.ui.file.too.large', [large.name, MAX_FILE_MB]))
      return
    }
    pendingFiles.set({ taskId, files })
    void mutate(
      'flow.entity.save',
      async () => ({
        collection: 'files',
        taskId,
        files: await Promise.all(
          files.map(async (file) => ({
            title: file.name,
            size: file.size,
            type: file.type,
            uploadId: (await upload(file, { taskId, signal: lifetime })).uploadId,
          })),
        ),
      }),
      () => pendingFiles.set(null),
    )
  }
  const filePreview = () => {
    const file = previewFile() && data().files.find((f) => f.id === previewFile() && f.url)
    return file
      ? FlowDialog({
          id: 'flow-file-preview',
          size: 'media',
          title: file.title,
          onRequestClose: () => previewFile.set(''),
          body: FlowMediaPreview({ title: file.title, type: file.contentType, url: file.url }),
          footer: FlowInline({
            align: 'end',
            children: html`<a data-flow="button" data-variant="secondary" data-size="md" href=${file.url + '?download=1'} download=${file.title}>${tr('flow.ui.download')}</a>`,
          }),
        })
      : null
  }
  const liveTaskControllers = new Map(),
    liveTaskState = signal({})
  const flushLiveTasks = async () => {
    for (const editor of liveTaskControllers.values())
      if (editor.isPending() && !(await editor.flush())) return false
    return true
  }
  const liveTaskSync = (id, company, state) => {
    if (company !== companyId() || !data()) return
    liveTaskState.set({ ...liveTaskState(), [id]: state.status })
    if (state.record?.task)
      data.set({
        ...data(),
        tasks: data().tasks.map((t) =>
          t.id === id && Number(state.record.task.version) >= Number(t.version)
            ? { ...t, ...state.record.task }
            : t,
        ),
      })
  }
  const autosave = createTaskAutosave({
    onChange: () => saveRevision.set(saveRevision() + 1),
    save: async (id, patch) => {
      const ok = await mutate(
        'flow.issue.save',
        () => ({ id, ...patch, expectedVersion: data().tasks.find((t) => t.id === id)?.version }),
        null,
        { quiet: true },
      )
      if (!ok) throw new Error(failure()?.message ?? tr('flow.ui.unable.to.save.changes'))
    },
  })
  const statusOptions = (task, items = taskColumns(data(), task.projectId)) =>
    items.map((c) => {
      const gate = transitionFor(task, c.id)
      return {
        value: c.id,
        label: c.label,
        disabled: !!gate?.blocked,
        content: FlowStatus({ status: c.kind, label: c.label, color: c.color }),
        description: gate?.message ?? '',
      }
    })
  const editTaskStatus = (task, value) => {
    const gate = transitionFor(task, value)
    if (gate?.blocked) {
      feedback.show(gate.message ?? '')
      return
    }
    if (gate?.action) {
      navigate('issue-move', { id: task.id, project: task.projectId })
      return
    }
    autosave.edit(task.id, { status: value })
  }
  const finishCloseModal = () => {
    previewFile.set('')
    if (taskModalRoutes.has(modalRoute()) && !['issue-new', 'subtask-new'].includes(modalRoute()))
      void autosave.flush(record())
    const depth = history.state?.flowModalDepth ?? 0
    if (depth > 0) history.back()
    else {
      history.replaceState({}, '', modalBackground.url || href('my-work'))
      readUrl()
    }
  }
  const closeModal = () => {
    if (busy()) return
    requestLeave(() => {
      void flushLiveTasks().then((ok) => {
        if (ok) finishCloseModal()
      })
    })
  }
  const switchContext = async (nextCompany, nextWorkspace = '', afterSave = false, confirmed = false) => {
    if (!confirmed && formGuard.hasChanges()) {
      if (!busy())
        pendingLeave.set({ action: () => switchContext(nextCompany, nextWorkspace, afterSave, true) })
      return
    }
    if (busy() && !afterSave) return
    if (nextCompany !== companyId() || props.serverShell) {
      await autosave.flushAll()
      if (!(await flushLiveTasks())) return
      if (data()?.tasks.some((t) => autosave.state(t.id) === 'error')) return
    }
    if (props.serverShell && mounted) {
      if (!(await documents.flush())) return
      if (nextCompany !== companyId()) {
        busy.set(true)
        try {
          await (dependencies.selectCompany ?? selectFlowCompany)(nextCompany, companyId())
        } catch (error) {
          failure.set(error)
          return
        } finally {
          busy.set(false)
        }
      }
      location.assign(
        href(nextWorkspace ? 'workspace-overview' : 'organization', {
          company: nextCompany,
          workspace: nextWorkspace,
          project: '',
        }),
      )
      return
    }
    pendingFiles.set(null)
    previewFile.set('')
    readController?.abort()
    feedback.clear()
    failure.set(null)
    selected.set([])
    bulkOutcome.set(null)
    formError.set({})
    data.set(null)
    loading.set(true)
    dismissedDataNotice.set('')
    companyId.set(nextCompany)
    workspaceId.set(nextWorkspace)
    project.set('')
    modalProject.set('')
    modalRoute.set(null)
    savedViewOpen.set(false)
    documentReturn.set('')
    documentScope.set('workspace')
    modalScope.set('workspace')
    query.set('')
    status.set('all')
    personalWorkspace.set('all')
    organization.reset()
    for (const x of extensions) x.reset?.()
    projectSetup.reset()
    operations.reset()
    const key = nextWorkspace ? 'workspace-overview' : 'organization'
    screen.set(key)
    modalBackground = { screen: key, url: '', record: '' }
    history.pushState({}, '', href(key))
    await reload()
  }
  const retryTaskSave = async () => {
    const ids = data()
      .tasks.filter((t) => autosave.state(t.id) === 'error')
      .map((t) => t.id)
    // Refresh CAS while retaining the user's pending patch in the autosave queue.
    await reload()
    for (const id of ids) await autosave.flush(id)
  }
  const composer = createTaskComposer({
    call,
    companyId,
    refused: (error) => {
      reads.clear()
      data.set(null)
      failure.set({ code: error.code, message: error.message })
    },
    userPickerProps: (id, task) => userPickerProps(id, task),
    data,
    canWrite,
    busy,
    project: activeProject,
    record,
    route: activeRoute,
    errors: formError,
    create: (args, done, files = []) =>
      mutate(
        'flow.issue.save',
        async () => {
          if (files.length > 20 || files.some((file) => file.size > MAX_FILE_MB * 1024 * 1024))
            throw new FlowApiError(
              tr('flow.ui.file.too.large', [
                files.find((file) => file.size > MAX_FILE_MB * 1024 * 1024)?.name ?? '',
                MAX_FILE_MB,
              ]),
              'validation',
              { attachments: tr('flow.ui.unable.to.process.the.request') },
            )
          const attachments = []
          for (const file of files) {
            let held = stagedDraftFiles.get(file)
            if (!held || held.projectId !== args.projectId || held.expiresAt <= Date.now()) {
              held = {
                projectId: args.projectId,
                ...(await upload(file, { projectId: args.projectId, signal: lifetime })),
                expiresAt: Date.now() + 55 * 60000,
              }
              stagedDraftFiles.set(file, held)
            }
            attachments.push({ uploadId: held.uploadId, title: file.name, size: file.size, type: file.type })
          }
          return { ...args, attachments }
        },
        (value) => {
          done()
          navigate('issue', { id: value.id, project: args.projectId }, { replace: true })
        },
      ),
  })
  const move = (id, columnId) => {
    const task = data().tasks.find((t) => t.id === id)
    return mutate('flow.issue.move', { id, columnId, expectedVersion: task.version })
  }
  const action = (label, onClick, variant = 'secondary', icon) =>
    FlowButton({
      label,
      onClick,
      variant,
      icon,
      size: 'sm',
      disabled: !canWrite(),
      loading: busy(),
    })
  const submit = (label = tr('flow.ui.save.changes')) =>
    FlowButton({
      label,
      type: 'submit',
      variant: 'primary',
      disabled: !canWrite(),
      loading: busy(),
    })
  const taskOpen = (t) => navigate('issue', { id: t.id, project: t.projectId })
  // Last-value caches for the task model. Inputs are signal values (data is replaced,
  // never edited in place), so re-renders that change none of them skip the scan.
  const cached = (inputs, compute) => {
    let last, value
    return () => {
      const now = inputs()
      if (!last || now.some((x, i) => x !== last[i])) {
        last = now
        value = compute()
      }
      return value
    }
  }
  const taskGroupCache = cached(
    () => [data()],
    () => new Map(),
  )
  const groupsFor = (field, projectId) => {
    const cache = taskGroupCache(),
      key = JSON.stringify([field, projectId])
    if (!cache.has(key)) {
      if (cache.size >= 8) cache.delete(cache.keys().next().value)
      cache.set(key, taskGroups(data(), field, projectId))
    }
    return cache.get(key)
  }
  const taskById = cached(
    () => [data()],
    () => new Map(data().tasks.map((t) => [t.id, t])),
  )
  const projectById = cached(
    () => [data()],
    () => new Map(data().projects.map((p) => [p.id, p])),
  )
  const filtered = cached(
    () => [data(), screen(), project(), workspaceId(), personalWorkspace(), status(), query()],
    () => {
      const needle = tidy(query()),
        projects = projectById()
      return orderedTasks(data().tasks).filter((t) => {
        if (screen() === 'issues-archived' ? !t.archived : t.archived) return false
        if (
          (['project-issues', 'board', 'calendar', 'bulk', 'filter-limit'].includes(screen()) ||
            routes[screen()]?.taskSearch) &&
          t.projectId !== project()
        )
          return false
        const owner = projects.get(t.projectId)
        if (
          data().workspaces &&
          (screen() === 'my-work'
            ? personalWorkspace() !== 'all' && owner?.workspaceId !== personalWorkspace()
            : scopeOf(screen()) !== 'project' && owner?.workspaceId !== workspaceId())
        )
          return false
        if (screen() === 'my-work' && !isAssignedTo(data(), t, data().user.id)) return false
        return (
          (status() === 'all' || t.status === status()) &&
          (!needle || tidy(`${t.id} ${t.title} ${taskAssigneeNames(data(), t)}`).includes(needle))
        )
      })
    },
  )
  // One pass per task list and grouping field instead of one filter per group or column.
  const groupCache = new WeakMap()
  const tasksIn = (tasks, field, value) => {
    let byField = groupCache.get(tasks)
    if (!byField) groupCache.set(tasks, (byField = new Map()))
    let groups = byField.get(field)
    if (!groups) {
      groups = new Map()
      for (const t of tasks) {
        const key = taskGroupValue(t, field)
        if (groups.has(key)) groups.get(key).push(t)
        else groups.set(key, [t])
      }
      byField.set(field, groups)
    }
    return groups.get(value) ?? []
  }
  const setFilter = (setter, value) => {
    setter.set(value)
    selectedView.set('')
    selected.set([])
    const url = new URL(location.href)
    url.searchParams.delete('view')
    url.searchParams.set('q', query())
    url.searchParams.set('status', status())
    history.replaceState({}, '', url)
    if (data()?.collectionPage) void reload()
  }
  const clearListFilters = () => {
    batch(() => {
      query.set('')
      status.set('all')
      selectedView.set('')
      selected.set([])
      if (screen() === 'my-work') personalWorkspace.set('all')
    })
    const url = new URL(location.href)
    for (const key of ['q', 'status', 'view']) url.searchParams.delete(key)
    if (screen() === 'my-work') url.searchParams.delete('workspaceFilter')
    history.replaceState(history.state, '', url)
  }
  const taskGrouping = () => (screen() === 'board' && groupBy() === 'none' ? 'status' : groupBy())
  const selectedInView = cached(
    () => [filtered(), selected()],
    () => orderedTasks(filtered().filter((t) => selected().includes(t.id))),
  )
  // Every row asks for its drag count, so a single task is an index lookup, not a scan.
  const draggedTasks = (id) =>
    listKeys.has(screen()) && selected().includes(id)
      ? selectedInView()
      : taskById().has(id)
        ? [taskById().get(id)]
        : []
  const dragRejection = (id, field, value) => {
    const moving = draggedTasks(id)
    if (!moving.length) return ''
    const changed = moving.filter((t) => taskGroupValue(t, field) !== value)
    if (!changed.length && listKeys.has(screen()) && listSort() !== 'manual') return tr('flow.drag.manual')
    if (field !== 'status') return ''
    for (const t of changed) {
      const gate = transitionFor(t, value)
      if (gate?.dragMessage) return gate.dragMessage
      if (gate?.blocked) return gate.message ?? ''
      if (gate?.action && moving.length > 1) return tr('flow.drag.single')
    }
    return ''
  }
  const reorderTask = (id, targetId, position, field, value) => {
    if (!canWrite() || busy() || id === targetId) return
    const task = data().tasks.find((t) => t.id === id)
    if (!task || task.archived) return
    const moving = draggedTasks(id)
    const rejection = dragRejection(id, field, value)
    if (rejection) {
      feedback.show(rejection)
      return
    }
    const gate =
      field === 'status' && moving.length === 1 && task.status !== value ? transitionFor(task, value) : null
    if (gate?.action) {
      navigate(gate.action.key, { id: task.id, project: task.projectId })
      return
    }
    if (moving.some((t) => t.id === targetId) || !moving.length) return
    return mutate('flow.issue.reorder', {
      ...(moving.length > 1
        ? {
            ids: moving.map((t) => t.id),
            expectedVersions: Object.fromEntries(moving.map((t) => [t.id, t.version])),
          }
        : {}),
      id,
      targetId,
      position,
      groupBy: field,
      groupValue: value,
      expectedVersion: task.version,
      expectedOrderRevision: data().taskOrderRevision ?? 0,
    })
  }
  // `within` limits "end" to the cards shown, so a drop on a bounded column stays in view.
  const dropAtEnd = (id, field, value, within = filtered()) => {
    const moving = new Set(draggedTasks(id).map((t) => t.id))
    const peers = within.filter((t) => !moving.has(t.id) && taskGroupValue(t, field) === value)
    return reorderTask(id, peers.at(-1)?.id ?? null, 'after', field, value)
  }
  const taskDragProps = (t, field) =>
    !canWrite() || busy() || t.archived
      ? {}
      : {
          dragCount: draggedTasks(t.id).length,
          onDragCheck: (id) => dragRejection(id, field, taskGroupValue(t, field)),
          onDropTask: (id, position) => reorderTask(id, t.id, position, field, taskGroupValue(t, field)),
          onMoveKey: (direction) => {
            const value = taskGroupValue(t, field)
            const peers = filtered().filter((x) => taskGroupValue(x, field) === value)
            if (direction === 'up' || direction === 'down') {
              const moving = new Set(draggedTasks(t.id).map((x) => x.id))
              const edge =
                direction === 'up'
                  ? peers.findIndex((x) => moving.has(x.id))
                  : peers.findLastIndex((x) => moving.has(x.id))
              const target = peers[edge + (direction === 'up' ? -1 : 1)]
              if (target) reorderTask(t.id, target.id, direction === 'up' ? 'before' : 'after', field, value)
            } else if (field !== 'none') {
              const groups = groupsFor(field, t.projectId)
              const target = groups[groups.findIndex((g) => g.id === value) + (direction === 'left' ? -1 : 1)]
              if (target) dropAtEnd(t.id, field, target.id)
            }
          },
        }
  // One row menu is open at a time; only its options are built. Closing another
  // menu (auto popovers close each other in either order) never clears this one.
  const openRowMenu = signal('')
  const statusChoices = createStatusOptions({
    call,
    companyId,
    onRefusal: () => void reload(),
    onItems: (items) => {
      if (!data()) return
      const known = new Map(data().columns.map((item) => [item.id, item]))
      for (const item of items) known.set(item.id, { ...known.get(item.id), ...item })
      data.set({ ...data(), columns: [...known.values()] })
    },
  })
  const statusPickerProps = (id, task) => {
    const s = statusChoices.state(),
      active = s.id === id
    const definition = taskStatusDefinition(data(), task)
    const selected = definition
      ? statusOptions(task, [definition])[0]
      : statusOptions(task).find((item) => item.value === task.status)
    const choices = active && !s.loading && !s.error ? statusOptions(task, s.items) : []
    if (selected && !choices.some((item) => item.value === selected.value))
      choices.unshift({ ...selected, disabled: true })
    return {
      options: active ? choices : selected ? [selected] : [],
      menu: {
        open: openRowMenu() === id,
        onToggle: (open) => {
          if (open) {
            openRowMenu.set(id)
            statusChoices.open(id, task.projectId)
          } else {
            if (openRowMenu.peek() === id) openRowMenu.set('')
            statusChoices.close(id)
          }
        },
      },
      remote: { loading: active && s.loading, error: active ? s.error : null, onRetry: statusChoices.retry },
    }
  }
  const memberOptions = createMemberOptions({
    call,
    companyId,
    onItems: (items) => {
      if (!data()) return
      const known = new Map(data().members.map((m) => [m.id, m]))
      for (const user of items) known.set(user.id, { ...known.get(user.id), ...user })
      data.set({ ...data(), members: [...known.values()] })
    },
    onRefusal: () => void reload(),
  })
  const userPickerProps = (id, task) => {
    const s = memberOptions.state(),
      active = s.id === id
    // Closed, the picker only names its selection; eligibility comes from the open read.
    const options = active ? [...s.items] : taskUsers(data(), task)
    for (const user of taskUsers(data(), task))
      if (!options.some((u) => u.id === user.id)) options.push({ ...user, disabled: true })
    return {
      options,
      menu: {
        open: openRowMenu() === id,
        onToggle: (open) => {
          if (open) {
            openRowMenu.set(id)
            memberOptions.open(id, task.projectId)
          } else {
            if (openRowMenu.peek() === id) openRowMenu.set('')
            memberOptions.close(id)
          }
        },
      },
      remote: {
        query: active ? s.query : '',
        loading: active && s.loading,
        error: active ? s.error : null,
        total: active ? s.total : 0,
        onQuery: memberOptions.query,
        onRetry: memberOptions.retry,
        onMore: active && s.cursor ? memberOptions.more : undefined,
      },
    }
  }
  const rowMenu = (id) => ({
    open: openRowMenu() === id,
    onToggle: (open) => {
      if (open) openRowMenu.set(id)
      else if (openRowMenu.peek() === id) openRowMenu.set('')
    },
  })
  const table = (
    tasks,
    dragField = null,
    contextProject = scopeOf(screen()) === 'project' ? project() : null,
    tableId = 'list',
    preserveOrder = false,
  ) =>
    FlowTable({
      layout: 'tasks',
      label: tr('flow.ui.tasks'),
      columns: [
        FlowCheckbox({
          target: 'standalone',
          label: tr('flow.ui.select.all.tasks.in.group'),
          checked: tasks.length > 0 && tasks.every((t) => selected().includes(t.id)),
          indeterminate:
            tasks.some((t) => selected().includes(t.id)) && !tasks.every((t) => selected().includes(t.id)),
          disabled: !tasks.length,
          onChange: (e) => {
            const ids = new Set(tasks.map((t) => t.id))
            selected.set(
              e.target.checked
                ? [...new Set([...selected(), ...ids])]
                : selected().filter((id) => !ids.has(id)),
            )
          },
        }),
        tr('flow.ui.tasks'),
        tr('flow.ui.status'),
        tr('flow.ui.priority'),
        tr('flow.ui.assignee.558c25'),
        tr('flow.ui.due'),
      ],
      children: html`${each(
        preserveOrder ? tasks : orderedTasks(tasks),
        (t) => t.id,
        (original) => {
          saveRevision()
          const t = { ...original, ...autosave.draft(original.id) }
          const disabled =
            !canWrite() ||
            t.archived ||
            data().projects.find((p) => p.id === t.projectId)?.accessInfo?.role === 'viewer'
          return FlowTaskRow({
            ...(dragField ? taskDragProps(t, dragField) : {}),
            task: { ...mapped(t), project: t.projectId === contextProject ? '' : mapped(t).project },
            assigneeControl: FlowUserPicker({
              id: tableId + '-assignees-' + t.id,
              label: tr('flow.ui.assignee.312f99') + t.id,
              size: 'sm',
              value: taskAssigneeIds(data(), t),
              ...userPickerProps(tableId + '-assignees-' + t.id, t),
              disabled,
              onChange: (ids) => autosave.edit(t.id, { assigneeIds: ids }),
            }),
            statusControl: FlowChoiceField({
              id: tableId + '-status-' + t.id,
              label: tr('flow.ui.status.6bb83a') + t.id,
              size: 'sm',
              value: t.status,
              disabled,
              ...statusPickerProps(tableId + '-status-' + t.id, t),
              onChange: (value) => editTaskStatus(t, value),
            }),
            priorityControl: FlowChoiceField({
              id: tableId + '-priority-' + t.id,
              menu: rowMenu(tableId + '-priority-' + t.id),
              label: tr('flow.ui.priority.e2ea65') + t.id,
              size: 'sm',
              value: t.priority,
              disabled,
              options: [
                { value: 'normal', label: tr('flow.ui.normal') },
                { value: 'high', label: tr('flow.ui.high') },
                { value: 'urgent', label: tr('flow.ui.urgent') },
              ].map((o) => ({ ...o, content: FlowPriority({ priority: o.value }) })),
              onChange: (value) => autosave.edit(t.id, { priority: value }),
            }),
            dueControl: FlowDateField({
              overdue: !isDone(data(), t) && !!t.dueDate && t.dueDate < todayDate(data().timezone),
              id: tableId + '-due-' + t.id,
              menu: rowMenu(tableId + '-due-' + t.id),
              label: tr('flow.ui.due.date.fe6fe5') + t.id,
              value: t.dueDate ?? '',
              min: t.startDate || undefined,
              disabled,
              onChange: (value) => autosave.edit(t.id, { dueDate: value }),
            }),
            statusHint: extensionValue('taskStatusHint', t),
            selected: selected().includes(t.id),
            onSelect: () =>
              selected.set(
                selected().includes(t.id) ? selected().filter((x) => x !== t.id) : [...selected(), t.id],
              ),
            onOpen: () => taskOpen(t),
          })
        },
      )}`,
    })
  // One pass per task list; today is read once, not once per task.
  const metricCache = new WeakMap()
  const metricCounts = (tasks) => {
    const today = todayDate(data().timezone),
      hit = metricCache.get(tasks)
    if (hit?.today === today) return hit
    const counts = { today, progress: 0, review: 0, done: 0, overdue: 0 }
    for (const t of tasks) {
      const done = isDone(data(), t)
      if (t.status === 'progress') counts.progress++
      if (statusKind(data(), t) === 'review') counts.review++
      if (done) counts.done++
      else if (t.dueDate && t.dueDate < today) counts.overdue++
    }
    metricCache.set(tasks, counts)
    return counts
  }
  const metrics = (tasks, collection = false, authoritative = null) => {
    const counts =
      authoritative ?? (collection && data()?.counts?.metrics ? data().counts.metrics : metricCounts(tasks))
    return FlowMetrics({
      items: [
        { label: tr('flow.ui.total.tasks'), value: counts.total ?? tasks.length },
        { label: tr('flow.ui.in.progress'), value: counts.progress },
        { label: tr('flow.ui.awaiting.acceptance.9782f0'), value: counts.review },
        { label: tr('flow.ui.done'), value: counts.done, tone: 'green' },
        { label: tr('flow.ui.overdue'), value: counts.overdue, tone: 'red' },
      ],
    })
  }
  const groupOptions = () => [
    { value: 'status', label: tr('flow.ui.group.status') },
    { value: 'priority', label: tr('flow.ui.group.priority') },
    { value: 'assignee', label: tr('flow.ui.group.assignee') },
    { value: 'sprint', label: tr('flow.ui.group.sprint') },
    { value: 'none', label: tr('flow.ui.no.grouping') },
  ]
  const setListPresentationURL = (name, value) => {
    const url = new URL(modalRoute() ? modalBackground.url : location.href, location.href)
    url.searchParams.set(name, value)
    if (modalRoute()) {
      modalBackground = { ...modalBackground, url: url.pathname + url.search }
      history.replaceState({ ...history.state, flowBackground: modalBackground }, '', location.href)
    } else history.replaceState(history.state, '', url)
  }
  const changeGroup = (value) => {
    groupBy.set(value)
    setListPresentationURL('group', value)
  }
  const changeSort = (value) => {
    listSort.set(value)
    setListPresentationURL('sort', value)
    if (data()?.collectionPage) void reload()
  }
  const workspaceFilter = () =>
    FlowSelect({
      size: 'sm',
      label: tr('flow.ui.filter.by.workspace'),
      value: personalWorkspace(),
      options: [
        { value: 'all', label: tr('flow.ui.all.workspaces') },
        ...(data().workspaces ?? []).map((w) => ({ value: w.id, label: w.title })),
      ],
      onChange: (e) => {
        personalWorkspace.set(e.target.value)
        const u = new URL(location.href)
        u.searchParams.set('workspaceFilter', e.target.value)
        history.replaceState(history.state, '', u)
        if (data()?.collectionPage) void reload()
      },
    })
  const filterStatuses = () => groupsFor('status', scopeOf(screen()) === 'project' ? project() : undefined)
  const filterbar = () =>
    FlowToolbar({
      children: html`${data().views.find((v) => v.id === (typeof location !== 'undefined' ? new URL(location.href).searchParams.get('view') : props.view)) ? FlowHint({ children: tr('flow.review.viewConditions', [data().views.find((v) => v.id === (typeof location !== 'undefined' ? new URL(location.href).searchParams.get('view') : props.view))?.title, query() || '—', filterStatuses().find((c) => c.id === status())?.label ?? tr('flow.ui.all.statuses')]) }) : null}${screen() === 'my-work' && data().workspaces ? workspaceFilter() : null}${FlowSelect({ size: 'sm', label: tr('flow.ui.filter.status'), value: status(), options: [{ value: 'all', label: tr('flow.ui.all.statuses') }, ...filterStatuses().map((c) => ({ value: c.id, label: c.label }))], onChange: (e) => setFilter(status, e.target.value) })}`,
      trailing: inline(
        listKeys.has(screen()) || screen() === 'board'
          ? FlowSelect({
              size: 'sm',
              label: tr('flow.ui.group.tasks'),
              value: taskGrouping(),
              options: groupOptions().filter((o) => screen() !== 'board' || o.value !== 'none'),
              onChange: (e) => changeGroup(e.target.value),
            })
          : null,
        listKeys.has(screen())
          ? FlowSelect({
              size: 'sm',
              label: tr('flow.list.sort'),
              value: listSort(),
              options: [
                { value: 'due', label: tr('flow.list.sortDue') },
                { value: 'priority', label: tr('flow.list.sortPriority') },
                { value: 'manual', label: tr('flow.list.sortManual') },
              ],
              onChange: (e) => changeSort(e.target.value),
            })
          : null,
        navButton('display', tr('flow.ui.display'), 'settings'),
        FlowButton({
          label: tr('flow.ui.save.view'),
          icon: 'filter',
          size: 'sm',
          disabled: !canWrite(),
          onClick: openSavedView,
        }),
      ),
    })
  const listSort = signal('due'),
    listLimits = signal({})
  const bulkPreview = signal(false),
    bulkStatus = signal('done'),
    bulkOutcome = signal(null),
    bulkRecovering = signal(false),
    showCompleted = signal(false)
  const bulkWriteInput = () => ({ ids: [...selected()], action: 'move', value: bulkStatus() })
  const hasPendingBulk = () =>
    pendingOperations.has(
      JSON.stringify([companyId(), data()?.user?.id, 'flow.issue.bulk', bulkWriteInput()]),
    )
  const bulkExclusion = (t) => {
    if (t.status === bulkStatus() && !hasPendingBulk()) return tr('flow.bulk.noChange')
    const reason = !taskColumns(data(), t.projectId).some((c) => c.id === bulkStatus())
      ? tr('flow.ui.different.project.status.set')
      : data().projects.find((p) => p.id === t.projectId)?.accessInfo?.role === 'viewer'
        ? tr('flow.ui.view.only')
        : data().columns.find((c) => c.id === bulkStatus())?.kind === 'done'
          ? t.blockedBy.some(
              (id) =>
                !isDone(
                  data(),
                  data().tasks.find((x) => x.id === id),
                ),
            )
            ? tr('flow.ui.blocked')
            : validateCustomFields(taskFields(data(), t), t.customFields, t.projectId, true)
          : null
    const gate = transitionFor(t, bulkStatus())
    return reason || (gate?.blocked || gate?.action ? (gate.message ?? tr('flow.bulk.reason.other')) : null)
  }
  const eligibleBulkTasks = () =>
    data().tasks.filter((task) => selected().includes(task.id) && !bulkExclusion(task))
  const listTasks = cached(
    () => [filtered(), listSort()],
    () => sortedListTasks(filtered(), listSort()),
  )
  const issueList = () => {
    const tasks = listTasks()
    const scopeKey = JSON.stringify([
      companyId(),
      workspaceId(),
      screen(),
      project(),
      personalWorkspace(),
      query(),
      status(),
      groupBy(),
      listSort(),
    ])
    const listGroups =
      groupBy() === 'none'
        ? [{ id: 'none', items: tasks }]
        : groupsFor(groupBy(), scopeOf(screen()) === 'project' ? project() : undefined).map((c) => ({
            ...c,
            items: tasksIn(tasks, groupBy(), c.id),
          }))
    const visibleTasks = listGroups.flatMap(
      (c) => taskPage(c.items, listLimits()[scopeKey + ':' + c.id] ?? 10).visible,
    )
    const pagedTable = (items, id) => {
      const key = scopeKey + ':' + id,
        limit = listLimits()[key] ?? 10
      const page = taskPage(items, limit)
      const parts = [
        table(
          page.visible,
          groupBy(),
          scopeOf(screen()) === 'project' ? project() : null,
          'list-' + id,
          true,
        ),
        items.length > 10
          ? FlowToolbar({
              inset: 'none',
              children: FlowHint({ children: tr('flow.list.showing', [page.visible.length, items.length]) }),
              trailing: inline(
                page.remaining
                  ? FlowButton({
                      label: tr('flow.list.showMore', [Math.min(10, page.remaining), page.remaining]),
                      size: 'sm',
                      onClick: () => listLimits.set({ ...listLimits(), [key]: limit + 10 }),
                    })
                  : null,
                limit > 10
                  ? FlowButton({
                      label: tr('flow.ui.collapse'),
                      size: 'sm',
                      onClick: () => listLimits.set({ ...listLimits(), [key]: 10 }),
                    })
                  : null,
              ),
            })
          : null,
      ]
      return FlowStack({
        inset: id === 'none' ? 'page' : 'none',
        children: each(
          parts,
          (_, i) => i,
          (part) => html`${part}`,
        ),
      })
    }
    return stack(
      filterbar(),
      collectionMore(),
      bulkOutcome()
        ? FlowSection({
            children: FlowNotice({
              title: tr('flow.bulk.resultTitle'),
              tone: bulkOutcome().invalid ? 'red' : bulkOutcome().refused.length ? 'yellow' : 'green',
              message: bulkOutcome().invalid
                ? tr('flow.bulk.unknown')
                : bulkOutcome().refused.length
                  ? tr('flow.bulk.result', [bulkOutcome().applied, bulkOutcome().refused.length])
                  : tr('flow.bulk.complete', [bulkOutcome().applied]),
              action: bulkOutcome().invalid
                ? FlowButton({
                    label: tr('flow.bulk.reload'),
                    loading: bulkRecovering(),
                    disabled: busy(),
                    onClick: async () => {
                      bulkRecovering.set(true)
                      try {
                        if (await reload()) bulkOutcome.set(null)
                      } finally {
                        bulkRecovering.set(false)
                      }
                    },
                  })
                : undefined,
              children: bulkOutcome().invalid
                ? undefined
                : stack(
                    FlowHint({
                      children: bulkOutcome().refused.length
                        ? tr('flow.bulk.result', [bulkOutcome().applied, bulkOutcome().refused.length])
                        : tr('flow.bulk.complete', [bulkOutcome().applied]),
                    }),
                    bulkOutcome().refused.length
                      ? FlowList({
                          children: each(
                            bulkOutcome().refused,
                            (r) => r.id,
                            (r) =>
                              FlowListItem({
                                title: r.id,
                                description: tr(bulkReasonKey(r.code, extensionErrors)),
                                actions: data().tasks.some((t) => t.id === r.id)
                                  ? FlowButton({
                                      label: tr('flow.ui.open.task'),
                                      size: 'sm',
                                      onClick: () => navigate('issue', { id: r.id }),
                                    })
                                  : null,
                              }),
                          ),
                        })
                      : null,
                  ),
            }),
          })
        : null,
      query() || status() !== 'all'
        ? FlowToolbar({
            children: inline(
              query() ? FlowTag({ label: tr('flow.ui.search') + query() }) : null,
              status() !== 'all'
                ? FlowTag({ label: filterStatuses().find((c) => c.id === status())?.label ?? status() })
                : null,
            ),
            trailing: FlowButton({
              label: tr('flow.ui.clear.all.filters'),
              size: 'sm',
              onClick: clearListFilters,
            }),
          })
        : null,
      screen() !== 'my-work' ? metrics(tasks, true) : null,
      tasks.length
        ? html`${
            groupBy() === 'none'
              ? pagedTable(tasks, 'none')
              : each(
                  groupsFor(groupBy(), scopeOf(screen()) === 'project' ? project() : undefined),
                  (c) => c.id,
                  (c) => {
                    const group = tasksIn(tasks, groupBy(), c.id)
                    return FlowGroup({
                      title: c.kind
                        ? FlowStatus({ status: c.kind, label: c.label, color: c.color })
                        : c.label,
                      count:
                        groupBy() === 'status' && data().counts?.statuses
                          ? (data().counts.statuses[c.id] ?? 0)
                          : group.length,
                      children: pagedTable(group, c.id),
                      onDragCheck: (id) => dragRejection(id, groupBy(), c.id),
                      onDropTask:
                        canWrite() && !busy() && screen() !== 'issues-archived'
                          ? (id) => dropAtEnd(id, groupBy(), c.id)
                          : undefined,
                    })
                  },
                )
          }`
        : FlowEmpty({
            title: tr('flow.ui.no.matching.tasks'),
            description: tr('flow.ui.change.filters.or.create.your.first.task'),
            action: FlowButton({
              label: tr('flow.ui.clear.filters'),
              onClick: clearListFilters,
            }),
          }),
      screen() === 'issues-archived'
        ? FlowSection({
            title: tr('flow.ui.restore.task'),
            children: html`${each(
              tasks,
              (t) => t.id,
              (t) =>
                FlowNotice({
                  title: t.id,
                  message: `${t.title} · ${mapped(t).project} · ${t.archivedBy ?? 'Flow'} · ${t.archivedAt ? new Date(t.archivedAt).toLocaleDateString(flowLocaleTag()) : tr('flow.ui.sample.archive.data')}`,
                  action: action(tr('flow.ui.restore'), () => mutate('flow.issue.restore', { id: t.id })),
                }),
            )}`,
          })
        : null,
      bulkPreview() && selected().length
        ? FlowSection({
            title: tr('flow.ui.preview.bulk.changes'),
            children: stack(
              FlowSelectField({
                name: 'bulk-status',
                label: tr('flow.ui.new.status'),
                value: bulkStatus(),
                options: data().columns.map((c) => ({ value: c.id, label: c.label })),
                onChange: (e) => bulkStatus.set(e.target.value),
              }),
              FlowHint({
                children: tr('flow.bulk.previewHelp', [selected().length]),
              }),
              FlowHint({
                children: tr('flow.bulk.previewCount', [
                  eligibleBulkTasks().length,
                  selected().length - eligibleBulkTasks().length,
                ]),
              }),
              FlowList({
                children: html`${each(
                  data().tasks.filter((t) => selected().includes(t.id)),
                  (t) => t.id,
                  (t) =>
                    FlowListItem({
                      title: t.id + ' · ' + t.title,
                      description: html`${data().columns.find((column) => column.id === t.status)?.label ?? t.status} → ${data().columns.find((column) => column.id === bulkStatus())?.label ?? bulkStatus()}. ${bulkExclusion(t) ?? tr('flow.bulk.previewReady')}`,
                      meta: FlowTag({
                        label: bulkExclusion(t) ? tr('flow.bulk.previewReview') : tr('flow.ui.will.update'),
                        tone: bulkExclusion(t) ? 'yellow' : 'neutral',
                      }),
                    }),
                )}`,
              }),
              actions(
                FlowButton({ label: tr('flow.ui.cancel'), onClick: () => bulkPreview.set(false) }),
                FlowButton({
                  label: tr('flow.ui.apply'),
                  variant: 'primary',
                  disabled:
                    !canWrite() ||
                    !eligibleBulkTasks().length ||
                    !!bulkOutcome()?.invalid ||
                    bulkRecovering(),
                  disabledReason: bulkOutcome()?.invalid ? tr('flow.bulk.unknown') : undefined,
                  loading: busy(),
                  onClick: () => {
                    if (
                      !canWrite() ||
                      busy() ||
                      !eligibleBulkTasks().length ||
                      bulkOutcome()?.invalid ||
                      bulkRecovering()
                    )
                      return
                    // Preview is advisory. The server validates every selected
                    // ID and reports refusals, including stale/missing tasks.
                    const ids = [...selected()]
                    if (ids.length)
                      mutate(
                        'flow.issue.bulk',
                        bulkWriteInput(),
                        (value) => {
                          const outcome = normalizeBulkOutcome(value, ids)
                          selected.set(selectionAfterBulk(selected(), ids, outcome))
                          bulkOutcome.set(outcome ?? { invalid: true, applied: 0, refused: [] })
                          bulkPreview.set(selected().length > 0)
                        },
                        { quiet: true },
                      )
                  },
                }),
              ),
            ),
          })
        : null,
      tasks.length
        ? FlowToolbar({
            children: inline(
              FlowCheckbox({
                target: 'standalone',
                label: tr('flow.ui.select.all.visible.tasks'),
                checked: visibleTasks.length > 0 && visibleTasks.every((t) => selected().includes(t.id)),
                onChange: () =>
                  selected.set(
                    visibleTasks.every((t) => selected().includes(t.id))
                      ? selected().filter((id) => !visibleTasks.some((t) => t.id === id))
                      : [...new Set([...selected(), ...visibleTasks.map((t) => t.id)])],
                  ),
              }),
              html`<span>${tr('flow.ui.selected', [selected().length])}</span>`,
            ),
            trailing: selected().length
              ? FlowButton({
                  label: tr('flow.ui.change') + selected().length + tr('flow.ui.tasks.05e55a'),
                  size: 'sm',
                  onClick: () => bulkPreview.set(!bulkPreview()),
                })
              : html`<span data-flow="muted">${tr('flow.ui.tasks.in.this.view', [tasks.length])}</span>`,
          })
        : null,
    )
  }
  // Columns show a bounded page of cards; the header keeps the column total.
  const BOARD_PAGE = 20
  const boardLimits = signal({})
  const board = () => {
    const field = taskGrouping()
    const scope = JSON.stringify([companyId(), workspaceId(), project(), query(), status(), field])
    return stack(
      filterbar(),
      collectionMore(),
      FlowBoard({
        columns: groupsFor(field, project()).map((c) => {
          const tasks = tasksIn(filtered(), field, c.id)
          const done = field === 'status' && c.kind === 'done',
            key = scope + ':' + c.id,
            folded = done && !showCompleted(),
            limit = folded ? 3 : (boardLimits()[key] ?? BOARD_PAGE),
            page = taskPage(tasks, limit)
          return {
            id: c.id,
            title: c.kind ? FlowStatus({ status: c.kind, label: c.label, color: c.color }) : c.label,
            count:
              field === 'status' && data().counts?.statuses
                ? (data().counts.statuses[c.id] ?? 0)
                : tasks.length,
            onDragCheck: (id) => dragRejection(id, field, c.id),
            onDropTask:
              canWrite() && !busy()
                ? (id) => {
                    const moved = draggedTasks(id).length
                    const pending = dropAtEnd(id, field, c.id, folded ? undefined : page.visible)
                    // Grow the page by the moved cards so they and the cards above stay shown.
                    if (pending && !folded && page.remaining)
                      boardLimits.set({ ...boardLimits(), [key]: limit + moved })
                    return pending
                  }
                : undefined,
            children: stack(
              html`${each(
                page.visible,
                (t) => t.id,
                (t) =>
                  FlowTaskCard({
                    task: { ...mapped(t), project: undefined },
                    statusHint: extensionValue('taskStatusHint', t),
                    onOpen: () => taskOpen(t),
                    ...taskDragProps(t, field),
                  }),
              )}`,
              !folded && page.remaining
                ? FlowButton({
                    label: tr('flow.list.showMore', [Math.min(BOARD_PAGE, page.remaining), page.remaining]),
                    size: 'sm',
                    onClick: () => boardLimits.set({ ...boardLimits(), [key]: limit + BOARD_PAGE }),
                  })
                : null,
              !done && limit > BOARD_PAGE
                ? FlowButton({
                    label: tr('flow.ui.collapse'),
                    size: 'sm',
                    onClick: () => boardLimits.set({ ...boardLimits(), [key]: BOARD_PAGE }),
                  })
                : null,
              done && tasks.length > 3
                ? FlowButton({
                    label: showCompleted()
                      ? tr('flow.ui.collapse')
                      : tr('flow.ui.show') + (tasks.length - 3) + tr('flow.ui.completed.tasks'),
                    size: 'sm',
                    onClick: () => {
                      if (showCompleted()) boardLimits.set({ ...boardLimits(), [key]: BOARD_PAGE })
                      showCompleted.set(!showCompleted())
                    },
                  })
                : null,
            ),
          }
        }),
      }),
    )
  }
  const taskDetail = () => {
    const t = currentTask()
    if (!t)
      return FlowEmpty({
        title: tr('flow.ui.task.not.found'),
        description: tr('flow.ui.this.task.may.have.been.moved.or.archived'),
      })
    const children = data().tasks.filter((x) => x.parentId === t.id)
    const epic = taskEpic(data().epics, t)
    // A summary has no body or discussion yet; never offer an editor over a text not read.
    const pending = recordPending(t)
    return FlowRecordLayout({
      main: stack(
        FlowToolbar({
          children: inline(
            FlowTag({ label: t.id }),
            FlowTag({
              label: taskTypeDefinition(data(), t)?.title ?? tr('flow.ui.tasks'),
            }),
            FlowTag({ label: epic?.title ?? tr(t.epic ? 'flow.record.notFound' : 'flow.ui.no.epic') }),
          ),
          trailing: inline(
            !t.archived
              ? navButton('issue-copy', tr('flow.relocation.copy'), null, 'ghost', {
                  id: t.id,
                  project: t.projectId,
                })
              : null,
            !t.archived && canWrite()
              ? navButton('issue-transfer', tr('flow.relocation.transfer'), null, 'ghost', {
                  id: t.id,
                  project: t.projectId,
                })
              : null,
            canWrite()
              ? navButton('board-move', tr('flow.ui.change.status'), 'status', 'ghost', {
                  id: t.id,
                  project: t.projectId,
                })
              : null,
            action(
              t.followed ? tr('flow.ui.following') : tr('flow.ui.follow'),
              () => mutate('flow.issue.follow', { id: t.id }),
              t.followed ? 'primary' : 'secondary',
              'inbox',
            ),
            navButton('issue-archive', tr('flow.ui.archive'), null, 'ghost', { id: t.id }),
          ),
        }),
        FlowSection({
          children: stack(
            FlowInput({
              id: 'title',
              label: tr('flow.ui.title'),
              value: t.title,
              required: true,
              error: formError().title,
              disabled: !canWrite(),
              onInput: (e) => autosave.edit(t.id, { title: e.target.value }, { delay: 600 }),
              onBlur: () => autosave.flush(t.id),
            }),
            pending ??
              ((taskDocumentCompany) =>
                FlowLiveDoc({
                  id: `${companyId()}-task-${t.id}`,
                  label: tr('flow.ui.description'),
                  text: t.description,
                  snapshot: t.descriptionDoc,
                  transport: t.documentTransport,
                  onReady: (editor) => liveTaskControllers.set(`${taskDocumentCompany}-${t.id}`, editor),
                  onDispose: () => liveTaskControllers.delete(`${taskDocumentCompany}-${t.id}`),
                  onSync: (state) => liveTaskSync(t.id, taskDocumentCompany, state),
                  readOnly: !canWrite(),
                  onChange: (value) => {
                    if (t.documentTransport) {
                      if (taskDocumentCompany === companyId())
                        data.set({
                          ...data(),
                          tasks: data().tasks.map((task) =>
                            task.id === t.id
                              ? {
                                  ...task,
                                  description: FlowLiveDocText(value),
                                  descriptionDoc: value.snapshot,
                                }
                              : task,
                          ),
                        })
                    } else
                      autosave.edit(
                        t.id,
                        { description: FlowLiveDocText(value), descriptionDoc: value.snapshot },
                        { delay: 600 },
                      )
                  },
                  onBlur: () =>
                    t.documentTransport
                      ? liveTaskControllers.get(`${taskDocumentCompany}-${t.id}`)?.flush()
                      : autosave.flush(t.id),
                }))(companyId()),
            navButton('history', tr('flow.ui.change.history'), 'clock', 'ghost', { id: t.id }),
            t.followed
              ? FlowHint({
                  children: tr(
                    'flow.ui.you.re.following.this.task.and.will.receive.status.and.discussion.updates',
                  ),
                })
              : null,
          ),
        }),
        ...(t.summary ? [] : extensions.map((x) => x.taskSection?.(t) ?? null)),
        t.checklist?.length
          ? FlowSection({
              title: 'Checklist',
              children: stack(
                ...t.checklist.map((item) =>
                  inline(
                    FlowCheckbox({
                      target: 'standalone',
                      label: item.text,
                      checked: item.checked,
                      disabled: !canWrite(),
                      onChange: (e) =>
                        autosave.edit(t.id, {
                          checklist: t.checklist.map((x) =>
                            x.id === item.id ? { ...x, checked: e.target.checked } : x,
                          ),
                        }),
                    }),
                    item.text,
                  ),
                ),
              ),
            })
          : null,
        FlowSection({
          children: stack(
            FlowDisclosure({
              title: tr('flow.ui.subtasks.398078', [children.length]),
              open: !!children.length,
              children: stack(
                inline(
                  navButton('subtask-new', tr('flow.ui.add.subtask'), 'plus', 'secondary', { id: t.id }),
                  navButton('subtask-link', tr('flow.ui.link.existing.task'), 'link', 'ghost', { id: t.id }),
                ),
                FlowHint({
                  children: tr(
                    'flow.ui.work.volume.rolls.up.from.subtasks.parent.tasks.are.not.counted.twice',
                  ),
                }),
                children.length
                  ? table(children, null, t.projectId, 'subtasks')
                  : FlowHint({
                      children: tr('flow.ui.split.large.deliverables.into.independently.deliverable.parts'),
                    }),
              ),
            }),
            FlowDisclosure({
              title: tr('flow.ui.dependencies', [t.blockedBy.length]),
              open: !!t.blockedBy.length,
              children: stack(
                navButton('dependency-new', tr('flow.ui.add.dependency'), 'link', 'secondary', { id: t.id }),
                ...t.blockedBy.map((id) => {
                  const target = data().tasks.find((x) => x.id === id)
                  return target
                    ? FlowListItem({
                        title: `${id} · ${target.title}`,
                        description:
                          taskAssigneeNames(data(), target) +
                          ' · ' +
                          taskColumns(data(), target.projectId).find((c) => c.id === target.status)?.label,
                        actions: inline(
                          FlowButton({
                            label: tr('flow.ui.open'),
                            size: 'sm',
                            onClick: () => taskOpen(target),
                          }),
                          action(tr('flow.ui.remove.dependency'), () =>
                            autosave.edit(t.id, { blockedBy: t.blockedBy.filter((x) => x !== id) }),
                          ),
                        ),
                      })
                    : null
                }),
              ),
            }),
            ...extensions.map((x) => x.taskLinks?.(t) ?? null),
          ),
        }),
        FlowSection({
          title: tr('flow.ui.attachments'),
          children: FlowFileDrop({
            id: `flow-task-files-${t.id}`,
            disabled: !canWrite(),
            busy: busy(),
            hint: tr('flow.ui.max.file.size', [MAX_FILE_MB]),
            pending: pendingFiles()?.taskId === t.id ? pendingFiles().files : [],
            onFiles: (files) => addFiles(t.id, files),
            onRetry: () => addFiles(t.id, pendingFiles().files),
            onDiscard: () => pendingFiles.set(null),
            children: html`${each(
              data().files.filter((f) => f.taskId === t.id),
              (f) => f.id,
              (f) =>
                FlowAttachment({
                  title: f.title,
                  meta: f.description,
                  type: f.contentType,
                  url: f.url,
                  onPreview: () => previewFile.set(f.id),
                }),
            )}`,
          }),
        }),
        FlowSection({
          title: activeRoute() === 'history' ? tr('flow.ui.change.history') : tr('flow.ui.discussion'),
          children: stack(
            activityPageView(t),
            t.summary
              ? null
              : FlowActivity({
                  items:
                    activeRoute() === 'history'
                      ? data()
                          .history.filter((h) => h.taskId === t.id)
                          .map((h) => ({
                            ...h,
                            messageKey: h.changes?.length ? null : h.messageKey,
                            text: h.changes?.length
                              ? tr('flow.review.taskUpdated', [h.version]) +
                                ' · ' +
                                h.changes.map((c) => auditChange(c, data(), t.catalogs)).join('; ')
                              : h.text,
                            time: h.time?.includes('T')
                              ? new Date(h.time).toLocaleString(flowLocaleTag())
                              : h.time,
                          }))
                      : data()
                          .comments.filter((c) => c.taskId === t.id)
                          .map((c) => ({
                            ...c,
                            time: c.time?.includes('T')
                              ? new Date(c.time).toLocaleString(flowLocaleTag())
                              : c.time,
                          })),
                }),
            html`<form
              on:submit=${async (e) => {
                e.preventDefault()
                const form = e.currentTarget
                const v = collect(e)
                if (await mutate('flow.issue.comment', { id: t.id, text: v.comment })) {
                  draftFor(t.id).text = ''
                  form.reset()
                }
              }}
            >
              ${stack(
                FlowTextarea({
                  id: 'comment',
                  value: draftFor(t.id).text,
                  onInput: (e) => {
                    draftFor(t.id).text = e.target.value
                  },
                  label: tr('flow.ui.comment'),
                  placeholder: tr('flow.ui.write.a.reply.or.mention.someone'),
                  required: true,
                  error: formError().text,
                  disabled: !canWrite() || busy(),
                }),
                submit(tr('flow.ui.post.comment')),
              )}
            </form>`,
          ),
        }),
      ),
      aside: FlowPropertyFields({
        children: html`${stack(
          FlowChoiceField({
            id: 'task-status',
            icon: 'status',
            label: tr('flow.ui.status'),
            value: t.status,
            disabled: !canWrite(),
            ...statusPickerProps('task-status', t),
            onChange: (value) => editTaskStatus(t, value),
          }),
          FlowUserPicker({
            id: 'task-assignee',
            label: tr('flow.ui.assignee.02be53'),
            size: 'md',
            value: taskAssigneeIds(data(), t),
            ...userPickerProps('task-assignee', t),
            disabled: !canWrite(),
            onChange: (ids) => autosave.edit(t.id, { assigneeIds: ids }),
          }),
          FlowChoiceField({
            id: 'task-priority',
            icon: 'flag',
            label: tr('flow.ui.priority'),
            value: t.priority,
            disabled: !canWrite(),
            options: [
              { value: 'normal', label: tr('flow.ui.normal') },
              { value: 'high', label: tr('flow.ui.high') },
              { value: 'urgent', label: tr('flow.ui.urgent') },
            ].map((o) => ({ ...o, content: FlowPriority({ priority: o.value }) })),
            onChange: (value) => autosave.edit(t.id, { priority: value }),
          }),
          usesSprints(data().projects.find((p) => p.id === t.projectId))
            ? FlowSelectField({
                name: 'task-sprint',
                icon: 'layers',
                label: 'Sprint',
                value: t.sprint ?? 'Backlog',
                disabled: !canWrite(),
                options: options([
                  'Backlog',
                  ...data()
                    .sprints.filter(
                      (s) =>
                        s.projectId === t.projectId &&
                        (s.title === t.sprint || (!s.archived && ['planned', 'active'].includes(s.state))),
                    )
                    .map((s) => s.title),
                ]),
                onChange: (e) => autosave.edit(t.id, { sprint: e.target.value }),
              })
            : null,
          FlowInput({
            id: 'task-start',
            icon: 'calendar',
            label: tr('flow.ui.start.date'),
            type: 'date',
            value: t.startDate ?? '',
            disabled: !canWrite(),
            onInput: (e) => autosave.edit(t.id, { startDate: e.target.value }, { delay: 400 }),
            onBlur: () => autosave.flush(t.id),
          }),
          FlowInput({
            id: 'task-due',
            icon: 'calendar',
            label: tr('flow.ui.due.date'),
            type: 'date',
            value: t.dueDate ?? '',
            disabled: !canWrite(),
            onInput: (e) => autosave.edit(t.id, { dueDate: e.target.value }, { delay: 400 }),
            onBlur: () => autosave.flush(t.id),
          }),
          extensionValue('taskEstimate', t) ??
            FlowInput({
              id: 'task-points',
              icon: 'clock',
              label: tr('flow.ui.estimate.points'),
              type: 'number',
              min: '0',
              value: String(t.points ?? 0),
              disabled: !canWrite(),
              onInput: (e) => autosave.edit(t.id, { points: Number(e.target.value) }, { delay: 400 }),
              onBlur: () => autosave.flush(t.id),
            }),
          FlowTagPicker({
            id: 'task-tags',
            value: t.tags ?? [],
            options: taskTags(data(), t.projectId, t),
            disabled: !canWrite(),
            onChange: (tags) => autosave.edit(t.id, { tags }),
            onManage: () => navigate('tags'),
          }),
          FlowSelectField({
            name: 'task-epic',
            label: tr('flow.review.epic'),
            icon: 'layers',
            value: epic?.id ?? t.epic ?? '',
            disabled: !canWrite(),
            options: [
              { value: '', label: tr('flow.ui.not.linked') },
              ...(t.epic && !epic ? [{ value: t.epic, label: tr('flow.record.notFound') }] : []),
              ...data()
                .epics.filter((e) => e.projectId === t.projectId && (!e.archived || e.id === epic?.id))
                .map((e) => ({ value: e.id, label: e.title })),
            ],
            onChange: (e) => autosave.edit(t.id, { epic: e.target.value || null }),
          }),
          ...taskFields(data(), t)
            .filter((f) => appliesTo(f, t.projectId))
            .map((f) =>
              taskFieldControl(f, t.customFields?.[f.id], {
                disabled: !canWrite(),
                change: (value) =>
                  autosave.edit(t.id, { customFields: { ...t.customFields, [f.id]: value } }),
              }),
            ),
          FlowProperties({
            items: [
              { icon: 'folder', label: tr('flow.ui.projects'), value: mapped(t).project },
              { icon: 'clock', label: tr('flow.ui.version.e055ec'), value: t.version },
            ],
          }),
        )}`,
      }),
    })
  }
  const sheet = (title, body, back = 'issue') =>
    modalRoute()
      ? body
      : FlowSheet({
          title,
          children: body,
          onClose: () => navigate(back, { id: record() }),
          footer: html`<span data-flow="muted">${canWrite() ? tr('flow.ui.changes.are.saved.when.you.confirm') : tr('flow.ui.you.have.view.only.access.b9a3d0')}</span>`,
        })
  const projectSetup = createProjectSetup({
    data,
    call,
    route: activeRoute,
    project: activeProject,
    workspace: workspaceId,
    canWrite,
    busy,
    errors: formError,
    feedback: () => feedbackToast('inline'),
    close: () =>
      activeRoute() === 'project-profile' ? navigate('settings', { project: activeProject() }) : closeModal(),
    save: (args, editing) =>
      mutate('flow.entity.save', args, (value) => {
        projectSetup.reset()
        if (editing) navigate('settings', { project: args.projectId }, { replace: true, confirmed: true })
        else
          navigate(
            args.defaultView,
            { project: value.id, workspace: args.workspaceId },
            { replace: true, confirmed: true },
          )
      }),
  })
  const tagPreview = signal(null),
    fieldKind = signal(null),
    columnKind = signal(null)
  const kanbanProject = () =>
    FlowEmpty({
      title: tr('flow.cadence.off.title'),
      description: tr('flow.cadence.off.description'),
      action: canManageScope(data(), 'project', activeProject())
        ? navButton('project-profile', tr('flow.cadence.off.action'), 'settings', 'secondary')
        : null,
    })
  const recordForm = ({ separateActions = false } = {}) => {
    if (['project-new', 'project-profile'].includes(activeRoute()))
      return projectSetup.view({
        separateActions,
        layout: activeRoute() === 'project-profile' ? 'page' : 'embedded',
      })
    // The guard reads the project the form writes to, not the background screen's project.
    if (
      activeRoute() === 'sprint-new' &&
      !usesSprints(data()?.projects.find((x) => x.id === activeProject()))
    ) {
      const body = kanbanProject()
      return separateActions
        ? { body, footer: null }
        : sheet(formDefinitions['sprint-new'].title, body, 'sprints')
    }
    const recordFieldId = (props) => `flow-record-${activeRoute()}-${props.id ?? props.name}`
    const recordInput = (props) =>
      FlowInput({ ...props, id: recordFieldId(props), name: props.name ?? props.id })
    const recordTextarea = (props) =>
      FlowTextarea({ ...props, id: recordFieldId(props), name: props.name ?? props.id })
    const recordSelect = (props) => FlowSelectField({ ...props, id: recordFieldId(props) })
    const def = formDefinitions[activeRoute()]
    const p = data().projects.find((x) => x.id === activeProject())
    const catalog = ['columns', 'types', 'fields', 'tags'].includes(def.collection)
    const held = catalog ? data()[def.collection]?.find((x) => x.id === record()) : null
    const tag = activeRoute() === 'tag-edit' ? held : null
    if (catalog && recordProvided() && !held) {
      const body = FlowEmpty({
        title: tr('flow.catalog.notFound'),
        description: tr('flow.catalog.notFoundHelp'),
        action: FlowButton({ label: tr('flow.ui.cancel'), onClick: closeModal }),
      })
      return separateActions ? { body, footer: null } : sheet(def.title, body, def.back)
    }
    const editable = canWrite() && (!catalog || canManageScope(data(), 'company', companyId()))
    const selectedFieldKind = fieldKind() ?? held?.kind ?? 'text'
    const selectedColumnKind = columnKind() ?? held?.kind ?? 'todo'
    const upcoming =
      activeRoute() === 'sprint-new'
        ? nextSprint(data(), selectedProject(), todayDate(data().timezone))
        : null
    const footer = actions(
      formModalRoutes.has(modalRoute())
        ? FlowButton({ label: tr('flow.ui.cancel'), onClick: closeModal, disabled: busy() })
        : navButton(def.back, tr('flow.ui.cancel')),
      FlowButton({
        label: held ? tr('flow.ui.save.changes') : def.title,
        type: 'submit',
        form: 'flow-record-form',
        variant: 'primary',
        disabled: !editable,
        loading: busy(),
      }),
    )
    const body = html`<form
        id="flow-record-form"
        data-flow-record-form
        on:submit=${(e) => {
          e.preventDefault()
          if (!editable || busy()) return
          const values = collect(e)
          const args = {
            ...values,
            ...(def.collection === 'projects'
              ? { workspaceId: values.workspaceId ?? workspaceId(), access: values.access ?? 'workspace' }
              : {}),
            projectId: catalog
              ? (held?.projectId ?? null)
              : scopeOf(activeRoute()) === 'project'
                ? activeProject()
                : null,
          }
          mutate(
            'flow.entity.save',
            {
              ...args,
              collection: def.collection,
              entityId: held?.id ?? (def.edit ? p?.id : undefined),
              parentId: null,
            },
            // The mutation has accepted this form; close without the user-action busy guard.
            () => finishCloseModal(),
          )
        }}
      >
        ${stack(
          !editable && catalog
            ? FlowNotice({
                title: tr('flow.ui.view.only'),
                message: tr('flow.catalog.managerRequired'),
                tone: 'yellow',
              })
            : null,
          recordInput({
            id: 'title',
            label: tr('flow.ui.name'),
            value: held?.title ?? held?.label ?? upcoming?.title ?? (def.edit ? (p?.title ?? '') : ''),
            placeholder: def.title,
            required: true,
            error: formError().title,
            disabled: !editable,
          }),
          activeRoute() === 'project-new' && data().workspaces
            ? recordSelect({
                name: 'workspaceId',
                label: 'Workspace',
                value: workspaceId(),
                options: data()
                  .workspaces.filter((w) => !w.archived && canManageScope(data(), 'workspace', w.id))
                  .map((w) => ({ value: w.id, label: w.title })),
              })
            : null,
          activeRoute() === 'project-new' && data().workspaces
            ? recordSelect({
                name: 'access',
                label: tr('flow.ui.access.930ae6'),
                value: 'workspace',
                options: [
                  { value: 'workspace', label: tr('flow.ui.inherit.workspace') },
                  { value: 'private', label: tr('flow.ui.restricted.members') },
                ],
              })
            : null,
          activeRoute() === 'tag-edit'
            ? FlowColorPicker({
                id: 'tag-color',
                name: 'color',
                label: tr('flow.ui.label.color'),
                value: tagPreview() ?? tag?.color ?? 'blue',
                disabled: !editable,
                onChange: tagPreview.set,
              })
            : null,
          activeRoute() === 'project-new'
            ? recordInput({
                id: 'code',
                label: tr('flow.ui.project.code'),
                placeholder: tr('flow.ui.e.g.web'),
                required: true,
              })
            : null,
          recordTextarea({
            id: 'description',
            label: activeRoute() === 'sprint-new' ? tr('flow.ui.cycle.goal') : tr('flow.ui.description'),
            value: held?.description ?? (def.edit ? (p?.description ?? '') : ''),
            placeholder: tr('flow.ui.context.goals.and.completion.criteria'),
            disabled: !editable,
          }),
          activeRoute() === 'tag-edit'
            ? stack(
                FlowTag({
                  label: tag?.title ?? tr('flow.ui.sample.label'),
                  tone: tagPreview() ?? tag?.color ?? 'blue',
                }),
                FlowHint({
                  children: tr(
                    'flow.ui.changing.a.label.updates.every.task.and.project.using.it.keep.names.short.and.av',
                  ),
                }),
              )
            : null,
          ['sprint-new', 'epic-new'].includes(activeRoute())
            ? inline(
                recordInput({
                  id: 'start',
                  label: tr('flow.ui.start.date'),
                  type: 'date',
                  value: upcoming?.start ?? todayDate(data().timezone),
                  required: true,
                  error: formError().start,
                }),
                recordInput({
                  id: 'end',
                  label: tr('flow.ui.end.date'),
                  type: 'date',
                  value: upcoming?.end ?? addDays(todayDate(data().timezone), 13),
                  required: true,
                  error: formError().end,
                }),
              )
            : null,
          activeRoute() === 'epic-new'
            ? stack(
                recordSelect({
                  name: 'owner',
                  label: tr('flow.ui.epic.owner'),
                  value: data().user.name,
                  options: data().people.map((p) => ({ value: p, label: p })),
                  error: formError().ownerId ?? formError().owner,
                }),
                recordTextarea({
                  id: 'outcome',
                  label: tr('flow.ui.target.outcome'),
                  required: true,
                  error: formError().outcome,
                }),
                routes.goals
                  ? recordSelect({
                      name: 'goalId',
                      label: tr('flow.ui.contributes.to.goal'),
                      value: '',
                      options: [
                        { value: '', label: tr('flow.ui.not.linked') },
                        ...(data().goals ?? [])
                          .filter((g) => g.workspaceId === workspaceId())
                          .map((g) => ({ value: g.id, label: g.title })),
                      ],
                    })
                  : null,
              )
            : null,
          activeRoute() === 'field-edit'
            ? recordSelect({
                name: 'kind',
                label: tr('flow.ui.data.type'),
                value: selectedFieldKind,
                error: formError().kind,
                onChange: (e) => fieldKind.set(e.target.value),
                disabled: !editable,
                options: [
                  { value: 'text', label: tr('flow.ui.text') },
                  { value: 'number', label: tr('flow.ui.number') },
                  { value: 'date', label: tr('flow.ui.date') },
                  { value: 'select', label: tr('flow.ui.select') },
                  { value: 'multi-select', label: tr('flow.ui.multiple.select') },
                  { value: 'boolean', label: tr('flow.ui.true.false') },
                ],
              })
            : null,
          activeRoute() === 'column-edit'
            ? recordSelect({
                name: 'kind',
                label: tr('flow.ui.status.group'),
                value: selectedColumnKind,
                error: formError().kind,
                onChange: (e) => columnKind.set(e.target.value),
                disabled: !editable,
                options: [
                  { value: 'todo', label: tr('flow.ui.not.started') },
                  { value: 'progress', label: tr('flow.ui.in.progress.ae8756') },
                  { value: 'review', label: tr('flow.ui.in.review') },
                  { value: 'done', label: tr('flow.ui.done') },
                ],
              })
            : null,
          activeRoute() === 'type-edit'
            ? stack(
                recordSelect({
                  name: 'icon',
                  label: tr('flow.ui.icon'),
                  value: held?.icon ?? 'list',
                  error: formError().icon,
                  disabled: !editable,
                  options: taskTypeIcons.map((icon) => ({
                    value: icon,
                    label: tr(
                      { list: 'flow.ui.tasks', flag: 'flow.ui.flag', layers: 'flow.ui.deliverable.category' }[
                        icon
                      ],
                    ),
                  })),
                }),
                FlowHint({
                  children: tr(
                    'flow.ui.describe.when.to.use.this.type.use.color.labels.for.topic.based.categorization',
                  ),
                }),
              )
            : null,
          activeRoute() === 'field-edit'
            ? stack(
                recordSelect({
                  name: 'required',
                  label: tr('flow.ui.required.before.completion'),
                  value: String(held?.required ?? false),
                  disabled: !editable,
                  options: [
                    { value: 'false', label: tr('flow.ui.no') },
                    { value: 'true', label: tr('flow.ui.yes') },
                  ],
                }),
                recordSelect({
                  name: 'appliesTo',
                  label: tr('flow.ui.applies.to'),
                  value: held?.projectId ?? held?.appliesTo ?? 'all',
                  error: formError().appliesTo,
                  disabled: !editable,
                  options: held?.projectId
                    ? [
                        {
                          value: held.projectId,
                          label:
                            data().projects.find((project) => project.id === held.projectId)?.title ??
                            held.projectId,
                        },
                      ]
                    : [
                        { value: 'all', label: tr('flow.ui.all.projects.in.organization') },
                        ...data().projects.map((p) => ({ value: p.id, label: p.title })),
                      ],
                }),
                ['select', 'multi-select'].includes(selectedFieldKind)
                  ? recordTextarea({
                      id: 'options',
                      label: tr('flow.ui.options.one.value.per.line'),
                      value: (held?.options ?? []).join('\n'),
                      required: true,
                      error: formError().options,
                      disabled: !editable,
                    })
                  : null,
                FlowDisclosure({
                  title: tr('flow.ui.preview.in.task.properties'),
                  open: true,
                  children:
                    selectedFieldKind === 'boolean'
                      ? FlowCheckbox({ label: tr('flow.ui.sample.field'), checked: false, disabled: true })
                      : ['select', 'multi-select'].includes(selectedFieldKind)
                        ? FlowTag({ label: tr('flow.ui.selected.value') })
                        : recordInput({
                            id: 'field-preview',
                            label: tr('flow.ui.sample.field'),
                            type: selectedFieldKind,
                            disabled: true,
                          }),
                }),
              )
            : null,
          activeRoute() === 'column-edit'
            ? stack(
                FlowStatus({
                  status: selectedColumnKind,
                  label: {
                    todo: tr('flow.ui.not.started'),
                    progress: tr('flow.ui.in.progress.ae8756'),
                    review: tr('flow.ui.awaiting.acceptance.9782f0'),
                    done: tr('flow.ui.done'),
                  }[selectedColumnKind],
                }),
                FlowHint({
                  children: tr(
                    'flow.ui.new.statuses.are.added.to.the.organization.library.existing.tasks.keep.their.sta',
                  ),
                }),
              )
            : null,
          activeRoute() === 'column-edit'
            ? FlowNotice({
                title: tr('flow.ui.status.meaning'),
                message: tr(
                  'flow.ui.column.names.are.customizable.the.final.column.determines.whether.work.is.comple',
                ),
              })
            : null,
          separateActions ? null : footer,
        )}
      </form>`
    return separateActions ? { body, footer } : sheet(def.title, body, def.back)
  }
  const taskLookup = signal('')
  const taskOperation = () => {
    const t = currentTask()
    if (!t || (t.archived && ['dependency-new', 'subtask-link'].includes(activeRoute())))
      return FlowEmpty({
        title: tr('flow.ui.task.not.found'),
        description: tr('flow.ui.this.task.may.have.been.moved.or.archived'),
      })
    const key = activeRoute()
    if (relocationRoutes.has(key)) return recordPending(t) ?? relocation.view()
    let body
    if (['issue-move', 'board-move'].includes(key)) {
      const blockers = t.blockedBy
        .map((id) => data().tasks.find((x) => x.id === id))
        .filter((x) => x && !isDone(data(), x))
      body = stack(
        FlowNotice({ title: t.id, message: t.title }),
        blockers.length
          ? FlowSection({
              inset: 'none',
              title: tr('flow.today.blockers'),
              description: tr('flow.today.blockedHelp'),
              children: FlowList({
                children: html`${each(
                  blockers,
                  (x) => x.id,
                  (x) =>
                    FlowListItem({
                      title: x.id + ' · ' + x.title,
                      description: taskAssigneeNames(data(), x),
                      meta: FlowStatus({
                        status: statusKind(data(), x),
                        label: taskColumns(data(), x.projectId).find((c) => c.id === x.status)?.label,
                      }),
                      actions: FlowButton({
                        label: tr('flow.today.openBlocker'),
                        size: 'sm',
                        onClick: () => taskOpen(x),
                      }),
                    }),
                )}`,
              }),
            })
          : null,
        ...taskColumns(data(), t.projectId).map((c) => {
          const gate = transitionFor(t, c.id),
            handover = gate?.action
          const disabled = t.status === c.id || !!gate?.blocked || (!!handover && blockers.length > 0)
          return FlowListItem({
            title: FlowStatus({ status: c.kind, label: c.label, color: c.color }),
            description: gate?.message ?? null,
            actions: FlowButton({
              label:
                t.status === c.id
                  ? tr('flow.ui.current.status')
                  : handover
                    ? handover.label
                    : tr('flow.ui.move.to', [c.label]),
              size: 'sm',
              disabled: disabled || !canWrite() || busy(),
              onClick: () =>
                handover ? navigate(handover.key, { id: t.id, project: t.projectId }) : move(t.id, c.id),
            }),
          })
        }),
      )
    } else if (key === 'issue-sprint')
      body = stack(
        ...data()
          .sprints.filter(
            (s) => !s.archived && ['planned', 'active'].includes(s.state) && s.projectId === t.projectId,
          )
          .map((s) =>
            FlowNotice({
              title: s.title,
              message: tr('flow.ui.points.abac26', [
                s.start,
                s.end,
                data()
                  .tasks.filter((x) => x.projectId === s.projectId && x.sprint === s.title)
                  .reduce((n, x) => n + (x.points || 0), 0),
                t.sprint === s.title ? tr('flow.ui.selected.ad61dc') : s.description,
              ]),
              action: action(tr('flow.ui.assign.to.sprint'), () =>
                mutate('flow.issue.assignSprint', { id: t.id, sprint: s.title }, () =>
                  navigate('issue', { id: t.id }),
                ),
              ),
            }),
          ),
      )
    else if (['dependency-new', 'subtask-link'].includes(key)) {
      const related = data().tasks.filter(
        (x) =>
          x.id !== t.id &&
          !x.archived &&
          x.projectId === t.projectId &&
          (key === 'dependency-new' ? !t.blockedBy.includes(x.id) : x.parentId !== t.id) &&
          tidy(x.id + ' ' + x.title).includes(tidy(taskLookup())),
      )
      body = stack(
        FlowInput({
          label: tr('flow.ui.search.related.tasks'),
          name: 'taskLookup',
          id: 'flow-related-task-lookup',
          placeholder: tr('flow.ui.task.id.or.name'),
          value: taskLookup(),
          onInput: (e) => taskLookup.set(e.target.value),
        }),
        FlowNotice({
          title: key === 'dependency-new' ? tr('flow.ui.select.blocking.task') : tr('flow.ui.select.subtask'),
          message:
            key === 'dependency-new'
              ? tr('flow.ui.this.task.cannot.be.completed.until.the.selected.task.is.done')
              : tr('flow.ui.the.selected.task.keeps.its.status.and.assignee'),
        }),
        !related.length
          ? FlowEmpty({
              title: tr('flow.ui.no.matching.tasks'),
              description: tr('flow.related.emptyHint'),
              action: taskLookup()
                ? FlowButton({ label: tr('flow.ui.clear.filters'), onClick: () => taskLookup.set('') })
                : null,
            })
          : null,
        ...related.map((x) =>
          FlowNotice({
            title: x.id,
            message: `${x.title} · ${key === 'dependency-new' ? t.id + tr('flow.ui.blocked.by.20f5f4') + x.id : tr('flow.ui.current.parent') + (x.parentId ?? tr('flow.ui.none')) + ' → ' + t.id + tr('flow.ui.parent.and.subtask.work.volume.is.not.counted.twice')}`,
            action: action(tr('flow.ui.select.1171ca'), () =>
              mutate(
                key === 'dependency-new' ? 'flow.issue.dependency' : 'flow.issue.linkChild',
                {
                  id: t.id,
                  target: x.id,
                  expectedVersion: t.version,
                  ...(key === 'subtask-link' ? { expectedChildVersion: x.version } : {}),
                },
                () => navigate('issue', { id: t.id }),
              ),
            ),
          }),
        ),
      )
    } else if (key === 'issue-archive')
      body = html`<form
        id="flow-task-archive-form"
        on:submit=${(e) => {
          e.preventDefault()
          mutate('flow.issue.archive', { id: t.id, expectedVersion: t.version, ...collect(e) }, () =>
            navigate('issues-archived'),
          )
        }}
      >
        ${stack(FlowTextarea({ id: 'reason', label: tr('flow.ui.reason.for.archiving'), required: true, error: formError().reason, disabled: !canWrite() || busy() }), !modalRoute() ? submit(tr('flow.ui.confirm.archive')) : null)}
      </form>`
    else if (key === 'comment')
      body = html`<form
        on:submit=${(e) => {
          e.preventDefault()
          mutate('flow.issue.comment', { id: t.id, text: collect(e).text }, () =>
            navigate('issue', { id: t.id }),
          )
        }}
      >
        ${stack(FlowTextarea({ id: 'text', label: tr('flow.ui.comment'), required: true, error: formError().text, placeholder: tr('flow.ui.reply'), disabled: !canWrite() || busy() }), submit(tr('flow.ui.post.comment')))}
      </form>`
    else body = taskDetail()
    /** In the modal the dialog body already pads a single picker or form; only the standalone sheet needs a section. */
    return modalRoute() ? body : sheet(routes[key].title, FlowSection({ children: body }))
  }
  const resourceList = (collection, target, create) => {
    const items = data()[collection].filter(
      (x) =>
        !x.archived &&
        (collection === 'projects'
          ? !data().workspaces || x.workspaceId === workspaceId()
          : screen() === 'all-epics'
            ? data().projects.some((p) => p.id === x.projectId && p.workspaceId === workspaceId())
            : x.projectId === project()),
    )
    const canCreate =
      canWrite() && (collection !== 'projects' || canManageScope(data(), 'workspace', workspaceId()))
    return stack(
      FlowSection({
        title: routes[screen()].title,
        actions: create && canCreate ? navButton(create, tr('flow.ui.create.new'), 'plus', 'primary') : null,
        children: !items.length
          ? FlowEmpty({
              title: tr('flow.ui.no.data.yet'),
              description: tr('flow.ui.create.the.first.item.to.start.working.with.your.team'),
            })
          : FlowCardGrid({
              children: html`${each(
                items,
                (x) => x.id,
                (x) =>
                  FlowResourceCard({
                    title: x.title,
                    description:
                      collection === 'projects'
                        ? `${data().members?.find((m) => m.id === x.ownerId)?.name ?? tr('flow.ui.unassigned.1f3799')} · ${x.end || tr('flow.ui.no.target.date')}`
                        : (x.description ?? ''),
                    progress: undefined,
                    meta: FlowTag({ label: collection === 'projects' ? x.code : tr('flow.ui.active') }),
                    onOpen: () => {
                      if (collection === 'projects') {
                        project.set(x.id)
                        navigate(x.defaultView === 'project-issues' ? 'project-issues' : 'board')
                      } else navigate(target, { id: x.id, project: x.projectId })
                    },
                  }),
              )}`,
            }),
      }),
      collection === 'projects' && data().projectPage?.cursor
        ? FlowToolbar({
            children: FlowHint({
              children:
                projectPageError()?.message ??
                tr('flow.list.showing', [items.length, data().projectPage.total]),
            }),
            trailing: FlowButton({
              label: tr(
                projectPageError() ? 'flow.exchange.retry' : 'flow.list.showMore',
                projectPageError()
                  ? []
                  : [
                      Math.min(50, data().projectPage.total - items.length),
                      data().projectPage.total - items.length,
                    ],
              ),
              size: 'sm',
              loading: projectPageLoading(),
              disabled: busy(),
              onClick: loadProjectPage,
            }),
          })
        : null,
    )
  }
  const help = createScreenHelp({
    key: () => JSON.stringify([companyId(), workspaceId(), activeProject(), activeRoute(), flowLocale()]),
    route: activeRoute,
    title: () => routes[activeRoute()]?.title ?? routes[screen()]?.title ?? 'Flow',
    allowed: () => !!data() && !failure() && primaryReady(),
    error: (message) => feedback.show(message),
  })
  const planningWindows = createPlanningWindows({
    scope: () => JSON.stringify([companyId(), activeProject(), activeRoute()]),
    projectId: activeProject,
    read: (input, signal) => call('flow.issue.list', input, { signal }),
    accept: (tasks) =>
      data.set({
        ...data(),
        tasks: [...new Map([...data().tasks, ...tasks].map((t) => [t.id, t])).values()],
      }),
    refused: (error) => {
      reads.clear()
      data.set(null)
      failure.set({ code: error.code, message: error.message })
    },
  })
  const planningTasks = (input) =>
    (planningWindows.state(input)?.items ?? []).map(
      (task) => data().tasks.find((current) => current.id === task.id) ?? task,
    )
  const riskMode = () => {
    const mode =
      typeof location !== 'undefined' ? new URL(location.href).searchParams.get('risk') : props.risk
    return ['overdue', 'blocked'].includes(mode) ? mode : 'all'
  }
  const riskWindows = createPlanningWindows({
    scope: () => JSON.stringify([companyId(), workspaceId(), activeRoute(), riskMode()]),
    projectId: () => undefined,
    read: (input, signal) => call('flow.risk.list', { ...input, workspaceId: workspaceId() }, { signal }),
    accept: (tasks) =>
      data.set({
        ...data(),
        tasks: [...new Map([...data().tasks, ...tasks].map((t) => [t.id, t])).values()],
      }),
    refused: (error) => {
      reads.clear()
      data.set(null)
      failure.set({ code: error.code, message: error.message })
    },
  })
  const reportWindows = createPlanningWindows({
    scope: () => JSON.stringify([companyId(), activeProject(), activeRoute()]),
    projectId: activeProject,
    read: ({ sprintId, ...input }, signal) =>
      call('flow.sprint.report', { ...input, id: sprintId }, { signal }),
    accept: () => {},
    refused: (error) => {
      reads.clear()
      data.set(null)
      failure.set({ code: error.code, message: error.message })
    },
  })
  const preparePlanning = () => {
    void composer.prepare()
    if (operationRoutes.has(activeRoute())) void operations.prepare()
    if (activeRoute() === 'dashboard')
      for (const input of [{ risk: riskMode() }, { risk: 'review' }]) {
        if (!riskWindows.state(input)) void riskWindows.load(input)
      }
    if (organizationRoutes[activeRoute()] || organizationRoutes[screen()]) void organization.prepare()
    if (activeRoute() === 'epic') {
      const epic = projectRecord(data().epics, activeProject(), record(), recordProvided())
      if (epic)
        for (const input of [{ epicId: epic.id }, { epicId: epic.id, milestonesOnly: true }]) {
          if (!planningWindows.state(input)) void planningWindows.load(input)
        }
      return
    }
    const close = activeRoute() === 'sprint-close'
    const report = activeRoute() === 'sprint-report'
    if (!close && !report && activeRoute() !== 'sprints') return
    const sprint =
      close || report
        ? projectRecord(
            data().sprints,
            activeProject(),
            record(),
            recordProvided(),
            (s) => s.state === 'active',
          )
        : data().sprints.find((s) => s.projectId === activeProject() && s.state === 'active' && !s.archived)
    if (sprint) {
      const input = { sprintId: sprint.id, ...(close ? { unfinishedOnly: true } : {}) }
      const windows =
        report && ['closed', 'completed'].includes(sprint.state) ? reportWindows : planningWindows
      if (!windows.state(input)) void windows.load(input)
    }
  }
  const planningMore = (input, windows = planningWindows) => {
    const page = windows.state(input)
    return FlowToolbar({
      children: page?.error
        ? FlowHint({ children: page.error.message })
        : page?.loaded
          ? FlowHint({ children: tr('flow.list.showing', [page.items.length, page.total]) })
          : null,
      trailing:
        !page?.loaded || page.cursor || page.error
          ? FlowButton({
              label: page?.error
                ? tr('flow.exchange.retry')
                : page?.loaded
                  ? tr('flow.list.showMore', [
                      Math.min(10, page.total - page.items.length),
                      page.total - page.items.length,
                    ])
                  : tr('flow.planning.load'),
              size: 'sm',
              loading: !!page?.loading,
              disabled: busy(),
              onClick: () => windows.load(input, { restart: page?.error?.code === 'conflict' }),
            })
          : null,
    })
  }
  const planningTable = (input) =>
    stack(table(planningTasks(input), null, activeProject(), JSON.stringify(input)), planningMore(input))
  const sprints = () =>
    !usesSprints(selectedProject())
      ? kanbanProject()
      : FlowSection({
          title: tr('flow.ui.development.cycles'),
          actions: navButton('sprint-new', tr('flow.ui.create.sprint'), 'plus', 'primary'),
          children: stack(
            FlowDisclosure({
              title: tr('flow.ui.backlog.not.in.a.sprint'),
              children: stack(
                FlowHint({ children: tr('flow.ui.open.a.task.to.assign.it.to.a.sprint') }),
                planningTable({ backlog: true }),
              ),
            }),
            ...data()
              .sprints.filter((s) => s.projectId === project() && !s.archived)
              .map((s) => {
                const tasks = data().tasks.filter(
                  (t) => t.projectId === s.projectId && t.sprint === s.title && !t.archived,
                )
                return FlowDisclosure({
                  title: html`<strong>${s.title}</strong> ${FlowTag({ label: { active: tr('flow.ui.active.cd07e6'), planned: tr('flow.ui.planned.89112b'), closed: tr('flow.ui.closed') }[s.state], tone: s.state === 'active' ? 'green' : 'neutral' })}`,
                  description: tr('flow.ui.points.tasks.complete', [
                    s.start,
                    s.end,
                    s.taskTotals?.points ??
                      tasks.reduce((n, t) => n + (extensionValue('taskPoints', t) ?? (t.points || 0)), 0),
                    s.taskTotals?.done ?? tasks.filter((t) => isDone(data(), t)).length,
                    s.taskTotals?.total ?? tasks.length,
                  ]),
                  open: s.state === 'active',
                  children: stack(
                    FlowHint({ children: s.description }),
                    planningTable({ sprintId: s.id }),
                    actions(
                      s.state === 'planned'
                        ? action(
                            tr('flow.ui.start'),
                            () =>
                              mutate('flow.entity.action', {
                                collection: 'sprints',
                                entityId: s.id,
                                action: 'start',
                              }),
                            'primary',
                          )
                        : s.state === 'active'
                          ? navButton('sprint-close', tr('flow.ui.close.sprint'), 'check', 'secondary', {
                              id: s.id,
                            })
                          : navButton('sprint-report', tr('flow.ui.view.summary'), 'grid', 'secondary', {
                              id: s.id,
                            }),
                    ),
                  ),
                })
              }),
          ),
        })
  const sprintCarryTo = signal('Backlog')
  const sprintClose = ({ separateActions = false } = {}) => {
    const recovery = (body) => (separateActions ? { body, footer: null } : body)
    const s = projectRecord(
      data().sprints,
      activeProject(),
      record(),
      recordProvided(),
      (sprint) => sprint.state === 'active',
    )
    if (!s)
      return recovery(
        FlowEmpty({
          title: tr('flow.record.notFound'),
          description: tr('flow.record.notFoundHelp'),
          action: navButton('sprints', routes.sprints.title, 'arrow'),
        }),
      )
    if (['closed', 'completed'].includes(s.state))
      return recovery(
        FlowEmpty({
          title: tr('flow.sprint.alreadyClosed'),
          description: tr('flow.sprint.closedHelp'),
          action: navButton('sprint-report', tr('flow.ui.view.summary'), 'arrow', 'primary', { id: s.id }),
        }),
      )
    if (s.state !== 'active')
      return recovery(
        FlowEmpty({
          title: tr('flow.sprint.invalidState'),
          description: tr('flow.sprint.closeActiveOnly'),
          action: navButton('sprints', routes.sprints.title, 'arrow'),
        }),
      )
    const pendingInput = { sprintId: s.id, unfinishedOnly: true }
    const pending = planningTasks(pendingInput)
    const body = sheet(
      tr('flow.ui.close') + s.title,
      stack(
        FlowHint({
          children: tr(
            'flow.ui.unfinished.tasks.points.will.carry.over.completed.work.stays.in.this.sprint',
            [
              s.taskTotals?.pending ?? pending.length,
              s.taskTotals?.pendingPoints ?? pending.reduce((n, t) => n + (t.points || 0), 0),
            ],
          ),
        }),
        stack(
          ...pending.map((t) =>
            FlowListItem({
              title: t.id + ' · ' + t.title,
              description: taskAssigneeNames(data(), t),
              meta: FlowTag({ label: (t.points ?? 0) + tr('flow.ui.points.250150') }),
            }),
          ),
        ),
        planningMore(pendingInput),
        html`<form id="flow-sprint-close-form" on:submit=${(e) => {
          e.preventDefault()
          mutate(
            'flow.entity.action',
            {
              collection: 'sprints',
              entityId: s.id,
              projectId: s.projectId,
              action: 'close',
              carryTo: collect(e).carryTo,
            },
            () => navigate('sprint-report', { id: s.id, project: s.projectId }),
          )
        }}>${stack(
          FlowSelectField({
            name: 'carryTo',
            label: tr('flow.ui.move.remaining.work.to'),
            value: sprintCarryTo(),
            error: formError().carryTo,
            disabled: !canWrite(),
            onChange: (event) => sprintCarryTo.set(event.target.value),
            options: [
              { value: 'Backlog', label: 'Backlog' },
              ...data()
                .sprints.filter(
                  (x) =>
                    x.projectId === s.projectId &&
                    !x.archived &&
                    x.id !== s.id &&
                    ['planned', 'active'].includes(x.state),
                )
                .map((x) => ({ value: x.title, label: x.title + ' · ' + x.start + ' → ' + x.end })),
            ],
          }),
          separateActions ? null : submit(tr('flow.ui.confirm.sprint.closure')),
        )}</form>`,
      ),
      'sprints',
    )
    return separateActions
      ? {
          body,
          footer: FlowInline({
            align: 'end',
            children: html`${FlowButton({ label: tr('flow.ui.cancel'), onClick: closeModal, disabled: busy() })}${FlowButton({ label: tr('flow.ui.confirm.sprint.closure'), type: 'submit', form: 'flow-sprint-close-form', variant: 'primary', disabled: !canWrite(), loading: busy() })}`,
          }),
        }
      : body
  }
  const pageParent = signal(null)
  const pageMove = ({ separateActions = false } = {}) => {
    const page = data().pages.find((p) => p.id === record())
    if (!page || page.archived) {
      const body = FlowEmpty({
        title: tr('flow.ui.document.not.found'),
        description: tr('flow.ui.select.a.document.in.the.tree.or.create.one.here'),
        action: FlowButton({ label: tr('flow.ui.cancel'), onClick: closeModal }),
      })
      return separateActions ? { body, footer: null } : body
    }
    const key = `${companyId()}:${page.id}`
    const selectedParent = pageParent()?.key === key ? pageParent().value : (page.parentId ?? '')
    const editable = canWrite() && page.access?.write !== false
    const candidates = documentMoveCandidates(data().pages, page)
    const footer = actions(
      FlowButton({ label: tr('flow.ui.cancel'), onClick: closeModal, disabled: busy() }),
      FlowButton({
        label: tr('flow.ui.confirm.move.69b8f6'),
        type: 'submit',
        form: 'flow-document-move-form',
        variant: 'primary',
        loading: busy(),
        disabled: !editable || selectedParent === (page.parentId ?? ''),
      }),
    )
    const body = FlowSetupForm({
      id: 'flow-document-move-form',
      actions: separateActions ? null : footer,
      onSubmit: (e) => {
        e.preventDefault()
        if (!editable || busy()) return
        void mutate(
          'flow.entity.action',
          { collection: 'pages', entityId: page.id, action: 'move', parentId: selectedParent || null },
          () => navigate('page', { id: page.id }, { replace: true, confirmed: true }),
        )
      },
      children: stack(
        FlowProperties({
          items: [
            {
              label: tr('flow.ui.current'),
              value:
                (data().pages.find((p) => p.id === page.parentId)?.title ?? tr('flow.ui.root')) +
                ' / ' +
                page.title,
            },
            {
              label: tr('flow.ui.ownership'),
              value:
                data().projects.find((p) => p.id === page.projectId)?.title ??
                data().workspaces.find((w) => w.id === page.workspaceId)?.title ??
                'Workspace',
            },
          ],
        }),
        FlowSelectField({
          name: 'new-parent',
          label: tr('flow.ui.new.parent.document'),
          value: selectedParent,
          disabled: !editable || busy(),
          options: [
            { value: '', label: tr('flow.ui.root') },
            ...candidates.map((p) => ({ value: p.id, label: p.title })),
          ],
          onChange: (e) => pageParent.set({ key, value: e.target.value }),
        }),
        FlowHint({
          children: tr(
            'flow.ui.new.path.ownership.and.access.stay.unchanged.only.the.tree.location.changes',
            [candidates.find((p) => p.id === selectedParent)?.title ?? tr('flow.ui.root'), page.title],
          ),
        }),
      ),
    })
    return separateActions ? { body, footer } : body
  }
  const taskExchange = createTaskExchange({
    data,
    project: activeProject,
    canWrite,
    call,
    apply: (input, success, onError) => mutate('flow.issue.importApply', input, success, { onError }),
    acceptDraft: () => {
      if (activeRoute() === 'task-exchange' && !modalRoute()) formGuard.discard()
    },
  })
  const settings = () =>
    FlowSection({
      title: tr('flow.ui.project.setup.863c6d', [selectedProject()?.title ?? '']),
      children: stack(
        ...extensions.map((x) => x.settingsSection?.('project-settings') ?? null),
        FlowListItem({
          title: tr('flow.exchange.title'),
          description: tr('flow.exchange.scope'),
          actions: navButton('task-exchange', tr('flow.exchange.open'), 'settings'),
        }),
        FlowListItem({
          title: selectedProject()?.title ?? '',
          description: tr('flow.ui.code', [
            selectedProject()?.code ?? '',
            selectedProject()?.description ?? '',
          ]),
          actions: navButton('project-profile', tr('flow.ui.edit.profile'), 'settings'),
        }),
        FlowProperties({
          items: [
            {
              label: tr('flow.ui.status'),
              value: (() => {
                const state = projectStatuses(selectedProject()).find(
                  (s) => s.id === (selectedProject()?.state ?? 'planned'),
                )
                return FlowTag({
                  label: state?.title ?? tr('flow.ui.not.set.ba42e8'),
                  tone: state?.color ?? 'neutral',
                })
              })(),
            },
            {
              label: tr('flow.ui.labels'),
              value: inline(
                ...(data().tags ?? [])
                  .filter((t) => selectedProject()?.tags?.includes(t.id))
                  .map((t) => FlowTag({ label: t.title, tone: t.color ?? 'neutral' })),
              ),
            },
            {
              label: tr('flow.ui.assignee.02be53'),
              value:
                data().members?.find((m) => m.id === selectedProject()?.ownerId)?.name ??
                tr('flow.ui.not.selected'),
            },
            {
              label: tr('flow.ui.timeline'),
              value: `${selectedProject()?.start || tr('flow.ui.not.set.ba42e8')} → ${selectedProject()?.end || tr('flow.ui.not.set.ba42e8')}`,
            },
            {
              label: tr('flow.ui.expected.outcome'),
              value: selectedProject()?.outcome || tr('flow.ui.not.recorded'),
            },
          ],
        }),
        data().workspaces
          ? inline(
              navButton('project-members', tr('flow.ui.members.permissions'), 'settings'),
              navButton('project-move', tr('flow.ui.move.workspace'), 'folder'),
            )
          : null,

        FlowSection({
          inset: 'none',
          title: tr('flow.ui.task.configuration'),
          children: stack(
            FlowHint({
              children:
                tr('flow.ui.statuses') +
                (selectedProject()?.taskStatusIds
                  ? tr('flow.ui.project.specific.set')
                  : tr('flow.ui.organization.library')) +
                tr('flow.ui.labels.6950b6') +
                (selectedProject()?.taskLabelIds
                  ? tr('flow.ui.project.specific.set')
                  : tr('flow.ui.organization.library')),
            }),
            inline(
              ...taskColumns(data(), project()).map((c) =>
                FlowStatus({ status: c.kind, label: c.label, color: c.color }),
              ),
            ),
            inline(
              ...taskTags(data(), project())
                .filter((t) => !t.archived)
                .map((t) => FlowTag({ label: t.title, tone: t.color })),
            ),
            navButton('project-profile', tr('flow.ui.customize.statuses.and.labels'), 'settings'),
          ),
        }),
        FlowSection({
          inset: 'none',
          title: tr('flow.ui.project.tools'),
          children: inline(
            routes.automations ? navButton('automations', tr('flow.ui.automations'), 'reset') : null,
            navButton('forms', tr('flow.ui.intake.forms'), 'list'),
          ),
        }),
      ),
    })
  // Settings read as a column of titled sections, each owning its action. Integrations
  // already has its own tab, so it is not repeated here.
  const workspaceSettings = () => {
    const workspace = data().workspaces.find((w) => w.id === workspaceId())
    return FlowSection({
      title: tr('flow.ui.workspace.settings'),
      children: FlowStack({
        divided: true,
        children: html`${each(
          [
            FlowSection({
              inset: 'none',
              title: workspace?.title ?? 'Workspace',
              description: tr('flow.ui.manage.workspace.information.members.and.teams'),
              actions: inline(
                navButton('workspace-edit', tr('flow.ui.workspace.information'), 'settings'),
                navButton('workspace-members', tr('flow.ui.member'), 'user'),
              ),
            }),
            FlowSection({
              inset: 'none',
              title: tr('flow.review.library'),
              description: tr(
                'flow.ui.the.shared.task.library.belongs.to.projects.with.custom.statuses.and.labels.keep',
                [data().company.name],
              ),
              actions: navButton('organization-settings', tr('flow.ui.open'), 'arrow'),
            }),
            ...extensions.map((x) => x.settingsSection?.('workspace-settings', workspace) ?? null),
          ],
          (_, i) => i,
          (x) => html`${x}`,
        )}`,
      }),
    })
  }
  const dashboard = () => {
    const input = { risk: riskMode() },
      review = { risk: 'review' }
    const page = riskWindows.state(input),
      reviewPage = riskWindows.state(review)
    const items = (key) =>
      (riskWindows.state(key)?.items ?? []).map((task) => data().tasks.find((t) => t.id === task.id) ?? task)
    const riskTable = (key, id) =>
      stack(
        riskWindows.state(key)?.loaded && !riskWindows.state(key)?.error && !items(key).length
          ? FlowHint({ children: tr('flow.ui.no.overdue.or.blocked.tasks.in.this.scope') })
          : table(items(key), null, null, id),
        planningMore(key, riskWindows),
      )
    return FlowSection({
      title: tr('flow.ui.workspace.decisions.needed'),
      actions: routes.workload ? navButton('workload', tr('flow.ui.balance.workload'), 'grid') : null,
      children: stack(
        page?.loaded && reviewPage?.loaded
          ? FlowHint({
              children: tr('flow.ui.as.of.projects.blocked.overdue.awaiting.acceptance', [
                page.today,
                page.projectTotal,
                page.total,
                reviewPage.total,
              ]),
            })
          : null,
        FlowSection({
          inset: 'none',
          title: tr('flow.ui.needs.intervention'),
          children: riskTable(input, 'workspace-risk'),
        }),
        FlowSection({
          inset: 'none',
          title: tr('flow.ui.awaiting.handover.decision'),
          actions: routes['quality-inbox']
            ? navButton('quality-inbox', tr('flow.ui.open.queue'), 'check')
            : null,
          children: stack(
            table(items(review), null, null, 'workspace-review'),
            planningMore(review, riskWindows),
          ),
        }),
        FlowList({
          children: html`${each(
            page?.projects ?? [],
            (p) => p.id,
            (p) =>
              FlowListItem({
                title: p.title,
                description: tr('flow.ui.tasks.need.attention.target', [
                  p.count,
                  p.end ?? tr('flow.ui.not.set'),
                ]),
                actions: navButton('board', tr('flow.ui.open.project'), 'folder', 'secondary', {
                  project: p.id,
                }),
              }),
          )}`,
        }),
        FlowDisclosure({
          title: tr('flow.ui.summary.metrics'),
          children: metrics(items(input), false, page?.metrics),
        }),
      ),
    })
  }
  const openSavedView = () => {
    const url = new URL(location.href)
    url.searchParams.set('modal', 'save-view')
    history.pushState({ ...history.state, flowViewModal: true }, '', url)
    savedViewOpen.set(true)
  }
  const closeSavedView = () => {
    if (history.state?.flowViewModal) history.back()
    else {
      const url = new URL(location.href)
      url.searchParams.delete('modal')
      history.replaceState(history.state, '', url)
      savedViewOpen.set(false)
    }
  }
  const savedViewDialog = () =>
    savedViewOpen()
      ? FlowDialog({
          id: 'flow-view-modal',
          title: tr('flow.ui.save.view'),
          onRequestClose: closeSavedView,
          feedback: feedbackToast('inline'),
          body: html`<form id="flow-view-create" on:submit=${async (e) => {
            e.preventDefault()
            const ok = await mutate('flow.entity.save', {
              collection: 'views',
              ...collect(e),
              projectId: project(),
              query: query(),
              status: status(),
            })
            if (ok) {
              savedViewDraft = { title: '', description: '' }
              closeSavedView()
            }
          }}>${stack(
            FlowInput({
              id: 'title',
              label: tr('flow.ui.view.name'),
              required: true,
              disabled: !canWrite(),
              value: savedViewDraft.title,
              error: formError().title,
              onInput: (e) => {
                savedViewDraft.title = e.target.value
              },
            }),
            FlowTextarea({
              id: 'description',
              label: tr('flow.ui.notes'),
              placeholder: tr('flow.ui.describe.the.purpose.or.usage.of.this.view'),
              disabled: !canWrite(),
              value: savedViewDraft.description,
              onInput: (e) => {
                savedViewDraft.description = e.target.value
              },
            }),
            FlowNotice({
              title: tr('flow.ui.saved.conditions'),
              message: tr('flow.ui.search.status', [
                query() || tr('flow.ui.all'),
                filterStatuses().find((c) => c.id === status())?.label ?? tr('flow.ui.all'),
              ]),
            }),
          )}</form>`,
          footer: actions(
            FlowButton({ label: tr('flow.ui.cancel'), onClick: closeSavedView }),
            FlowButton({
              label: tr('flow.ui.save.view'),
              variant: 'primary',
              disabled: !canWrite(),
              loading: busy(),
              onClick: () => host?.querySelector('#flow-view-create')?.requestSubmit(),
            }),
          ),
        })
      : null
  const cmdk = () => null
  const display = () =>
    sheet(
      tr('flow.ui.display.options'),
      stack(
        FlowSelect({
          label: tr('flow.ui.group.tasks'),
          value: groupBy(),
          options: [
            { value: 'status', label: tr('flow.ui.group.by.status') },
            { value: 'priority', label: tr('flow.ui.group.by.priority') },
            { value: 'assignee', label: tr('flow.ui.group.by.assignee') },
            { value: 'sprint', label: tr('flow.ui.group.by.sprint') },
            { value: 'none', label: tr('flow.ui.no.grouping') },
          ],
          onChange: (e) => changeGroup(e.target.value),
        }),
        FlowSelect({
          label: tr('flow.ui.density'),
          value: density(),
          options: [
            { value: 'compact', label: tr('flow.ui.compact.36px.rows') },
            { value: 'comfortable', label: tr('flow.ui.comfortable.44px.rows') },
          ],
          onChange: (e) => changeAppearance('density', e.target.value),
        }),
        FlowHint({
          children: tr(
            'flow.ui.display.changes.apply.immediately.to.the.list.these.are.personal.preferences.use',
          ),
        }),
        actions(
          FlowButton({
            label: tr('flow.ui.restore.defaults'),
            onClick: () => {
              changeGroup('status')
              changeAppearance('density', 'compact')
            },
          }),
          FlowButton({
            label: tr('flow.ui.apply'),
            variant: 'primary',
            onClick: () => {
              history.replaceState({}, '', modalBackground.url)
              readUrl()
            },
          }),
        ),
      ),
      'all-issues',
    )
  const timezone = () =>
    sheet(
      tr('flow.ui.business.timezone'),
      stack(
        FlowNotice({
          title: tr('flow.ui.team.day.boundaries'),
          message: tr(
            'flow.ui.organization.timezone.current.time.changes.affect.shared.day.grouping.personal.d',
            [
              data().timezone,
              new Intl.DateTimeFormat(flowLocaleTag(), {
                timeStyle: 'short',
                timeZone: data().timezone,
              }).format(new Date()),
            ],
          ),
        }),
        FlowSelect({
          label: tr('flow.ui.timezone.2dd01b'),
          value: data().timezone,
          options: options(['Asia/Ho_Chi_Minh', 'Asia/Singapore', 'UTC']),
          onChange: (e) => mutate('flow.preferences.save', { timezone: e.target.value }),
        }),
      ),
      'settings',
    )
  const content = () => {
    const key = screen()
    if (
      isGuest() &&
      (adminRoutes.has(key) ||
        organizationRoutes[key] ||
        extensionRoutes[key]?.admin ||
        ['workspace-settings', 'tags'].includes(key))
    )
      return denied()
    if (operationRoutes.has(key)) return operations.view(key)
    if (extensionRoutes[key]) return extensionFor(key)?.view?.(key) ?? null
    if (organizationRoutes[key]) return organization.view(key)
    if (data().workspaces && key === 'workspace-settings') return workspaceSettings()
    if (scopeOf(key) === 'project' && !selectedProject())
      return FlowEmpty({
        title: tr('flow.ui.select.a.project.to.continue'),
        description: tr('flow.ui.this.link.requires.a.specific.project'),
        action: navButton('projects', tr('flow.ui.view.projects'), 'folder'),
      })
    if (formDefinitions[key]) return recordForm()
    if (listKeys.has(key)) return issueList()
    if (detailKeys.has(key)) return taskDetail()
    if (
      [
        'issue-move',
        'board-move',
        'issue-sprint',
        'subtask-link',
        'dependency-new',
        'issue-archive',
        ...relocationRoutes,
        'comment',
      ].includes(key)
    )
      return taskOperation()
    if (documentKeys.has(key)) return null
    switch (key) {
      case 'board':
        return board()
      case 'projects':
        return resourceList('projects', 'board', 'project-new')
      case 'epics':
      case 'all-epics':
        return resourceList('epics', 'epic', 'epic-new')
      case 'epic': {
        const epic = projectRecord(data().epics, project(), backgroundRecord(), recordProvided())
        if (!epic)
          return FlowEmpty({
            title: tr('flow.record.notFound'),
            description: tr('flow.record.notFoundHelp'),
            action: navButton('epics', routes.epics.title, 'arrow'),
          })
        const input = { epicId: epic.id },
          milestones = { ...input, milestonesOnly: true }
        const goalProjection = routes.goals && data().goalsAccess !== false && Array.isArray(data().goals)
        return FlowSection({
          title: epic.title,
          actions: routes['epic-map']
            ? navButton('epic-map', tr('flow.ui.dependencies.6bc581'), 'link')
            : null,
          children: stack(
            FlowHint({ children: epic.description }),
            goalProjection
              ? FlowSelectField({
                  name: 'epic-goal',
                  label: tr('flow.ui.related.goals'),
                  value: epic.goalId ?? '',
                  disabled: !canWrite(),
                  options: [
                    { value: '', label: tr('flow.ui.not.linked') },
                    ...data()
                      .goals.filter((g) => g.workspaceId === workspaceId())
                      .map((g) => ({ value: g.id, label: g.title })),
                  ],
                  onChange: (e) =>
                    mutate('flow.entity.save', {
                      collection: 'epics',
                      entityId: epic.id,
                      projectId: project(),
                      title: epic.title,
                      description: epic.description,
                      goalId: e.target.value,
                      owner: epic.owner,
                      outcome: epic.outcome,
                    }),
                })
              : null,
            FlowProperties({
              items: [
                {
                  label: tr('flow.ui.assignee.558c25'),
                  value: epic.owner ?? tr('flow.ui.unassigned.1f3799'),
                },
                { label: tr('flow.ui.target.outcome'), value: epic.outcome ?? epic.description },
                { label: tr('flow.ui.target.date'), value: epic.end ?? tr('flow.ui.not.set.ba42e8') },
                ...(goalProjection
                  ? [
                      {
                        label: tr('flow.ui.related.goals'),
                        value:
                          data().goals.find((g) => g.id === epic.goalId)?.title ?? tr('flow.ui.not.linked'),
                      },
                    ]
                  : []),
              ],
            }),
            FlowDisclosure({
              title: tr('flow.ui.milestone'),
              open: true,
              children:
                planningWindows.state(milestones)?.loaded &&
                !planningWindows.state(milestones)?.error &&
                !planningTasks(milestones).length
                  ? FlowHint({ children: tr('flow.ui.add.a.milestone.task.and.link.it.to.this.epic') })
                  : planningTable(milestones),
            }),
            planningTable(input),
            navButton('issue-new', tr('flow.ui.add.task'), 'plus'),
          ),
        })
      }
      case 'sprints':
        return sprints()
      case 'sprint-close':
        return sprintClose()
      case 'sprint-report': {
        const sprint = projectRecord(data().sprints, project(), backgroundRecord(), recordProvided())
        if (!sprint)
          return FlowEmpty({
            title: tr('flow.record.notFound'),
            description: tr('flow.record.notFoundHelp'),
            action: navButton('sprints', routes.sprints.title, 'arrow'),
          })
        const input = { sprintId: sprint.id },
          closed = ['closed', 'completed'].includes(sprint.state)
        const page = closed ? reportWindows.state(input) : planningWindows.state(input)
        const report = page?.report,
          tasks = closed ? (page?.items ?? []) : planningTasks(input)
        if (closed && !report)
          return FlowSection({
            title: sprint.title,
            children: stack(
              page?.loading ? FlowLoading({ label: tr('flow.ui.opening.flow') }) : null,
              planningMore(input, reportWindows),
            ),
          })
        return FlowSection({
          title: sprint?.title ?? tr('flow.ui.sprint.summary'),
          children: stack(
            FlowHint({
              children: report
                ? tr('flow.ui.committed.points.added.removed.completed.carried.to', [
                    report.committedPoints ?? '—',
                    report.added ?? 0,
                    report.removed ?? 0,
                    report.completed,
                    report.carried,
                    report.carryTo,
                  ])
                : tr('flow.ui.this.sprint.is.still.open.this.is.current.progress'),
            }),
            report
              ? stack(
                  ...extensions.flatMap((x) => x.sprintSummary?.(report) ?? []),
                  ...tasks.map((t) =>
                    FlowListItem({
                      title: t.id + ' · ' + t.title,
                      description: tr('flow.ui.points.fd5863', [
                        t.creditedPoints ?? t.points ?? 0,
                        data().columns.find((c) => c.id === t.status)?.label ?? t.status,
                      ]),
                      actions: navButton('issue', tr('flow.ui.open.task'), 'arrow', 'secondary', {
                        id: t.id,
                        project: project(),
                      }),
                    }),
                  ),
                  planningMore(input, reportWindows),
                )
              : stack(metrics(tasks, false, page?.metrics), planningTable(input)),
          ),
        })
      }
      case 'page':
        return null
      case 'page-move':
        return pageMove()
      case 'settings':
        return settings()
      case 'task-exchange':
        return taskExchange.view()
      case 'workspace-settings':
        return workspaceSettings()
      case 'tags':
        return FlowSection({
          title: tr('flow.ui.task.labels.organization'),
          actions:
            canWrite() && canManageScope(data(), 'company', companyId())
              ? navButton('tag-edit', tr('flow.ui.add.label'), 'plus')
              : null,
          children: stack(
            !canManageScope(data(), 'company', companyId())
              ? FlowNotice({ title: tr('flow.ui.view.only'), message: tr('flow.catalog.managerRequired') })
              : null,
            !data().tags.some((t) => !t.archived && !t.projectId)
              ? FlowHint({ children: tr('flow.catalog.noActiveLabels') })
              : null,
            ...data()
              .tags.filter((t) => !t.archived && !t.projectId)
              .map((t) =>
                FlowNotice({
                  title: FlowTag({ label: t.title, tone: t.color ?? 'neutral' }),
                  message: tr(
                    'flow.ui.used.by.tasks.and.projects.this.label.belongs.to.the.organization.library',
                    [
                      data().labelUsage?.[t.id]?.tasks ??
                        data().tasks.filter((x) => !x.archived && x.tags?.includes(t.id)).length,
                      data().labelUsage?.[t.id]?.projects ??
                        data().projects.filter((x) => !x.archived && x.tags?.includes(t.id)).length,
                    ],
                  ),
                  action: inline(
                    navButton('tag-edit', tr('flow.ui.edit.label'), 'settings', 'secondary', { id: t.id }),
                    canManageScope(data(), 'company', companyId())
                      ? action(tr('flow.ui.archive'), () => {
                          pendingAction.set({
                            title: tr('flow.ui.archive.label', [t.title]),
                            message: tr('flow.labels.archiveHelp'),
                            label: tr('flow.ui.archive'),
                            action: () =>
                              mutate('flow.entity.action', {
                                collection: 'tags',
                                entityId: t.id,
                                action: 'archive',
                              }),
                          })
                        })
                      : null,
                  ),
                }),
              ),
            data().tags.some((t) => t.archived && !t.projectId)
              ? FlowDisclosure({
                  title: tr('flow.catalog.archivedLabels'),
                  children: stack(
                    ...data()
                      .tags.filter((t) => t.archived && !t.projectId)
                      .map((t) =>
                        FlowNotice({
                          title: FlowTag({ label: t.title, tone: t.color ?? 'neutral' }),
                          message: tr('flow.labels.archiveHelp'),
                          action: canManageScope(data(), 'company', companyId())
                            ? action(tr('flow.ui.restore'), () =>
                                mutate('flow.entity.action', {
                                  collection: 'tags',
                                  entityId: t.id,
                                  action: 'restore',
                                }),
                              )
                            : null,
                        }),
                      ),
                  ),
                })
              : null,
            catalogPageView('tags'),
          ),
        })
      case 'invitation-accept': {
        const offer = data().invitationOffer
        return FlowSection({
          title: tr('flow.invitation.title'),
          children: stack(
            FlowHint({
              children: tr(offer?.available ? 'flow.invitation.offer' : 'flow.invitation.unavailable'),
            }),
            offer?.available
              ? FlowButton({
                  label: tr('flow.invitation.accept'),
                  disabled: busy(),
                  onClick: () =>
                    mutate(
                      'flow.invitation.accept',
                      { token: record() },
                      () =>
                        navigate(
                          'my-work',
                          { workspace: data()?.context?.workspaceId ?? workspaceId() },
                          { replace: true, freshShell: true },
                        ),
                      { allowReadOnly: true },
                    ),
                })
              : null,
          ),
        })
      }
      case 'dashboard':
        return dashboard()
      case 'cmdk':
        return cmdk()
      case 'display':
        return display()
      case 'timezone':
        return timezone()
      default:
        throw new Error(`Missing product presenter: ${key}`)
    }
  }
  const sidebar = () =>
    !data()
      ? FlowNavigation({
          name: 'Flow',
          company: '',
          search: globalSearch.trigger(),
          children: null,
          footer: null,
        })
      : FlowNavigation({
          name: 'Flow',
          search: globalSearch.trigger(),
          company: data().workspaces
            ? `${data().company.name} · ${data().workspaces.find((w) => w.id === workspaceId())?.title ?? 'Workspace'}`
            : data().company.name,
          context: data().workspaces
            ? FlowContextPicker({
                companyId: companyId(),
                workspaceId: workspaceId(),
                companies: data().companies,
                workspaces: data().workspaces,
                disabled: busy(),
                onWorkspace: (id) => void switchContext(companyId(), id),
                onManage:
                  data().members?.find((m) => m.id === data().user.id)?.role === 'guest'
                    ? undefined
                    : () => navigate('workspace-overview'),
              })
            : null,
          children: html`
      ${FlowNavGroup({ title: tr('flow.ui.personal'), children: stack(link('my-work', tr('flow.ui.my.tasks'), 'inbox'), link('inbox', tr('flow.ui.inbox'), 'inbox'), ...extensionLinks('personal')) })}
      ${
        data().members?.find((m) => m.id === data().user.id)?.role !== 'guest'
          ? FlowNavGroup({
              title: 'Workspace',
              children: stack(
                link('workspace-overview', tr('flow.ui.overview'), 'grid'),
                link('all-issues', tr('flow.ui.all.tasks'), 'list'),
                ...extensionLinks('workspace'),
                link('all-pages', tr('flow.ui.workspace.documents'), 'book', { projectFilter: 'workspace' }),
              ),
            })
          : null
      }
      ${FlowProjectDirectory({
        onCreate:
          canWrite() && (!data().workspaces || canManageScope(data(), 'workspace', workspaceId()))
            ? () => navigate('project-new')
            : undefined,
        projects: data()
          .projects.filter((p) => !data().workspaces || p.workspaceId === workspaceId())
          .map((p) => ({
            id: p.id,
            title: p.title,
            active: scopeOf(screen()) === 'project' && project() === p.id,
            href: href(p.defaultView ?? 'board', { project: p.id, workspace: p.workspaceId }),
            onOpen: (e) => {
              if (e.button > 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return
              e.preventDefault()
              navigate(p.defaultView ?? 'board', { project: p.id, workspace: p.workspaceId })
            },
          })),
      })}
      ${!data().workspaces ? link('workspace-settings', tr('flow.ui.workspace.settings'), 'settings') : null}`,

          footer: inline(
            screenHelpTrigger(activeRoute()),
            FlowAvatar({ name: data().user.name }),
            FlowUserMenu({
              language: flowLocale(),
              languages: FLOW_LANGUAGES,
              onLanguage: changeLanguage,
              name: data().user.name,
              companyId: companyId(),
              companies: data().companies ?? [{ id: companyId(), name: data().company.name }],
              disabled: busy(),
              onCompany: (id) => void switchContext(id),
              items: [
                { label: tr('flow.ui.personal.settings'), onClick: () => navigate('personal-settings') },
                ...(data().members?.find((m) => m.id === data().user.id)?.role === 'guest'
                  ? []
                  : [
                      {
                        label: tr('flow.ui.organization.d9c0c0') + data().company.name,
                        onClick: () => navigate('organization'),
                        active: managementNavigation(screen(), data())?.scope === 'company',
                      },
                    ]),
              ],
            }),
            FlowButton({
              label:
                theme() === 'light' ? tr('flow.ui.switch.to.dark.mode') : tr('flow.ui.switch.to.light.mode'),
              icon: theme() === 'light' ? 'moon' : 'sun',
              action: 'theme',
              iconOnly: true,
              variant: 'ghost',
              onClick: () => changeAppearance('theme', theme() === 'light' ? 'dark' : 'light'),
            }),
          ),
        })
  const openListView = (id) => {
    const v = data().views.find((v) => v.id === id && (v.projectId ?? 'core') === project())
    navigate('project-issues', {
      q: v?.query ?? '',
      status: v?.status ?? 'all',
      ...(v ? { view: v.id } : {}),
    })
  }
  const projectViews = () =>
    FlowToolbar({
      children: FlowProjectViews({
        selectedView: selectedView(),
        views: data().views.filter((v) => !v.archived && (v.projectId ?? 'core') === project()),
        onView: openListView,
        onSave: openSavedView,
        canSave: canWrite(),
        value: pageRoutes.has(screen()) ? 'pages' : screen(),
        options: [
          { value: 'board', label: tr('flow.ui.board'), icon: 'board' },
          { value: 'project-issues', label: tr('flow.ui.list'), icon: 'list' },
          { value: 'calendar', label: tr('flow.ui.calendar'), icon: 'calendar' },
          ...(routes.gantt ? [{ value: 'gantt', label: tr('flow.ui.timeline'), icon: 'clock' }] : []),
          ...(usesSprints(selectedProject()) ? [{ value: 'sprints', label: 'Sprint', icon: 'reset' }] : []),
          { value: 'epics', label: 'Epic', icon: 'layers' },
          { value: 'pages', label: tr('flow.ui.documents'), icon: 'book' },
          ...(routes.atlas ? [{ value: 'atlas', label: 'Atlas', icon: 'layers' }] : []),
        ],
        onChange: (key) =>
          key === 'project-issues'
            ? openListView('')
            : navigate(key, { ...(key === 'pages' ? { scope: 'project' } : {}) }),
      }),
      trailing: FlowTag({ label: data().projects.find((p) => p.id === project())?.code ?? 'KV' }),
    })
  const managementViews = () => {
    const nav = managementNavigation(screen(), data())
    if (!nav || data().members?.find((m) => m.id === data().user.id)?.role === 'guest') return null
    return FlowScopeTabs({
      label:
        nav.scope === 'company'
          ? tr('flow.ui.organization.management', [data().company.name])
          : tr('flow.ui.workspace.management', [
              data().workspaces?.find((w) => w.id === workspaceId())?.title ?? 'Workspace',
            ]),
      value: nav.active,
      options: nav.options.map((option) => ({ ...option, href: href(option.value) })),
      onChange: (key) => navigate(key),
    })
  }
  const isGuest = () => data().members?.find((m) => m.id === data().user.id)?.role === 'guest'
  const adminRoutes = new Set([
    'settings',
    'project-profile',
    'project-members',
    'project-move',
    'automations',
    'forms',
    'github',
  ])
  const scopeDenied = () =>
    failure()?.code === 'forbidden' && (readFailure() || data()?.problem?.code === 'forbidden')
  const denied = (retry = false) =>
    FlowEmpty({
      title: tr('flow.ui.access.denied'),
      description: tr('flow.review.accessHelp'),
      action: inline(
        navButton('my-work', tr('flow.ui.my.tasks'), 'arrow', 'secondary', retry ? { workspace: '' } : {}),
        retry ? FlowButton({ label: tr('flow.ui.try.again'), size: 'sm', onClick: reload }) : null,
      ),
    })
  const projectActions = () =>
    isGuest()
      ? null
      : !canWrite()
        ? inline(
            FlowButton({
              label: tr('flow.ui.project.tools.e0b7ca'),
              disabled: true,
              disabledReason: tr('flow.review.editRequired'),
            }),
            FlowButton({
              label: tr('flow.ui.project.setup'),
              disabled: true,
              disabledReason: tr('flow.review.editRequired'),
            }),
          )
        : inline(
            FlowScopeMenu({
              label: tr('flow.ui.project.tools.e0b7ca'),
              items: [
                ...(routes.automations
                  ? [{ label: tr('flow.ui.automations'), onClick: () => navigate('automations') }]
                  : []),
                { label: tr('flow.ui.intake.forms'), onClick: () => navigate('forms') },
                ...(routes.github
                  ? [{ label: tr('flow.ui.project.github'), onClick: () => navigate('github') }]
                  : []),
              ],
            }),
            navButton('settings', tr('flow.ui.project.setup'), 'settings'),
          )
  const operationsState = createOperationsState(data)
  const operationsContext = {
    state: operationsState,
    reloadCalendar: () => void reload(),
    collectionMore,
    screen,
    data,
    workspaceId,
    projectId: project,
    record,
    close: closeModal,
    canWrite: () => ['inbox', 'personal-settings'].includes(activeRoute()) || canWrite(),
    busy,
    requestLeave,
    confirmAction,
    clearCompletedFeedback: feedback.clear,
    formError,
    mutate,
    call,
    refused: (error) => {
      reads.clear()
      data.set(null)
      primaryReady.set(true)
      failure.set({ code: error.code, message: error.message })
    },
    loadInboxPage: (input) =>
      call(
        'flow.inbox.list',
        { ...input, workspaceId: personalWorkspace() === 'all' ? undefined : personalWorkspace() },
        { signal: lifetime },
      ),
    inboxReadError: (error) => {
      if (!['forbidden', 'unauthenticated'].includes(error.code)) return
      reads.clear()
      data.set(null)
      primaryReady.set(true)
      failure.set({ code: error.code, message: error.message })
    },
    acceptInboxPage: (page, append) => {
      if (activeRoute() !== 'inbox') return
      const items = append ? [...data().inbox, ...page.items] : page.items
      reads.clear()
      data.set({
        ...data(),
        inbox: [...new Map(items.map((item) => [item.id, item])).values()],
        inboxPage: { cursor: page.cursor, total: page.total, filter: page.filter },
        inboxUnreadCount: page.unreadCount,
      })
    },
    navigate,
    filtered,
    filterbar,
    workspaceFilter,
    openSavedView,
    inboxFilter: (n) =>
      personalWorkspace() === 'all' ||
      data().projects.find(
        (p) => p.id === (n.projectId ?? data().tasks.find((t) => t.id === n.taskId)?.projectId),
      )?.workspaceId === personalWorkspace(),
    themeControl: () =>
      FlowSelectField({
        name: 'personal-theme',
        label: tr('flow.ui.appearance'),
        value: theme(),
        options: [
          { value: 'light', label: tr('flow.ui.light') },
          { value: 'dark', label: tr('flow.ui.dark') },
        ],
        onChange: (e) => changeAppearance('theme', e.target.value),
      }),
  }
  const operationsController = createDeferredController({
    load: () => import('./operations.mjs').then((module) => () => module.createOperations(operationsContext)),
    loading: () => FlowLoading({ label: tr('flow.ui.opening.flow') }),
    failed: (retry) =>
      FlowEmpty({
        title: tr('flow.ui.unable.to.open.flow'),
        action: FlowButton({ label: tr('flow.exchange.retry'), onClick: retry }),
      }),
  })
  const operations = {
    ...operationsController,
    calendarWindow: operationsState.calendarWindow,
    inboxFilter: operationsState.inboxTab,
    reset() {
      operationsState.reset()
      operationsController.reset()
    },
  }
  // Extensions see the same narrow context the built-in feature modules get; core never names them.
  const extensionContext = {
    filtered,
    filterbar,
    table,
    openTask: taskOpen,
    root: () => host,
    theme,
    params: () =>
      typeof location === 'undefined' ? props : Object.fromEntries(new URL(location.href).searchParams),
    data,
    record,
    workspaceId,
    projectId: project,
    screen,
    canWrite,
    busy,
    mutate,
    call,
    refused: (error) => {
      reads.clear()
      data.set(null)
      failure.set({ code: error.code, message: error.message })
    },
    navigate,
    close: closeModal,
    requestLeave,
    confirmAction,
    history,
    formError,
    feedback,
    feedbackView: () => feedbackToast(),
  }
  const extensionOwners = flowExtensions().map((x) => ({
    extension: x,
    instance: x.create(extensionContext),
  }))
  const extensions = extensionOwners.map((x) => x.instance)
  const extensionFor = (key) =>
    extensionOwners.find((x) => x.extension.routes?.[key] || x.extension.forms?.[key])?.instance
  const extensionLinks = (group) =>
    extensions.flatMap((x) => x.navigation?.(group) ?? []).map((e) => link(e.key, e.label, e.icon))
  const extensionValue = (hook, ...args) => {
    for (const x of extensions) {
      const value = x[hook]?.(...args)
      if (value != null) return value
    }
    return null
  }
  const transitionFor = (task, columnId) => extensionValue('transition', task, columnId)
  let searchEntryPending = props.screen === 'cmdk'
  const globalSearch = createGlobalSearch({
    data,
    companyId,
    call,
    root: () => host,
    navigate,
    recent: () => recentCommands.get(companyId()) ?? [],
    remember: (id) =>
      recentCommands.set(
        companyId(),
        [id, ...(recentCommands.get(companyId()) ?? []).filter((x) => x !== id)].slice(0, 8),
      ),
  })
  const firstRun = createFirstRun({
    call,
    reload,
    data,
    demo: props.signInDemo,
    finish: (id) => switchContext(companyId(), id, true),
  })
  const organizationContext = {
    route: activeRoute,
    refused: (error) => {
      reads.clear()
      data.set(null)
      failure.set({ code: error.code, message: error.message })
    },
    memberPageView,
    invitationPageView,
    accessPageView,
    // The first page failed: the members list explains it and offers to read it again.
    accessPageFailure: () => (data()?.accessPage ? null : accessPageError()),
    retryAccessPage: () => void ensureAccessPage(),
    teamPageView,
    catalogPageView,
    confirmAction,
    settingsSection: (key, entity) => extensions.map((x) => x.settingsSection?.(key, entity) ?? null),
    data,
    workspaceId,
    projectId: activeProject,
    record,
    recordProvided,
    canWrite: () => primaryReady() && canWrite(),
    busy,
    formError,
    mutate,
    call,
    navigate,
    close: closeModal,
    isModal: () => Boolean(modalRoute()),
    switchWorkspace: (id) => switchContext(companyId(), id, true),
    params: () =>
      typeof location === 'undefined' ? props : Object.fromEntries(new URL(location.href).searchParams),
  }
  const organization = createDeferredController({
    load: () =>
      import('./organization.mjs').then((module) => () => module.createOrganization(organizationContext)),
    loading: () => FlowLoading({ label: tr('flow.ui.opening.flow') }),
    failed: (retry) =>
      FlowEmpty({
        title: tr('flow.ui.unable.to.open.flow'),
        action: FlowButton({ label: tr('flow.exchange.retry'), onClick: retry }),
      }),
  })
  const documents = createDocuments({
    serverShell: props.serverShell,
    focusDocument: props.focus === 'content',
    sidebar,
    data,
    loading,
    workspaceId,
    project: () => (scopeOf(screen()) === 'project' ? project() : null),
    projectViews,
    projectActions,
    managementViews,
    libraryFilter,
    librarySearch,
    libraryVisibility,
    updateLibrary: (patch) => {
      const url = new URL(location.href)
      for (const [name, value] of Object.entries(patch)) url.searchParams.set(name, value)
      history.replaceState(history.state, '', url)
      librarySearch.set(url.searchParams.get('docq') ?? '')
      libraryVisibility.set(url.searchParams.get('visibility') === 'private' ? 'private' : 'shared')
    },
    documentReturn,
    returnToLibrary: () => {
      const target = libraryReturn(documentReturn(), base)
      navigate(
        'all-pages',
        target ? Object.fromEntries(new URL(target, 'http://flow.local').searchParams) : {},
      )
    },
    libraryURL: () =>
      typeof location === 'undefined' ? href('all-pages') : location.pathname + location.search,
    record: backgroundRecord,
    screen,
    canWrite,
    busy,
    mutate,
    navigate,
    root: () => host,
    routeTitle: () => routes[screen()].title,
    confirmAction,
    call,
    refused: (error) => {
      reads.clear()
      data.set(null)
      failure.set({ code: error.code, message: error.message })
    },
    notices: () =>
      html`${!canWrite() ? FlowNotice({ title: tr('flow.ui.view.only'), message: tr('flow.ui.you.can.read.documents.but.cannot.edit.them'), tone: 'yellow' }) : null}`,
  })
  const formModal = () => {
    const key = modalRoute()
    if (!formModalRoutes.has(key)) return null
    if (key === 'cmdk') return cmdk()
    const readPending = modalReadFallback('flow-form-modal', key)
    if (readPending) return readPending
    // An extension form over a task waits for the task's record, as the task detail does; its
    // body is not composed from a summary.
    const pending = opensTask(key) ? openTaskPending() : null
    const record =
      formDefinitions[key] && !(isGuest() && adminRoutes.has(key))
        ? recordForm({ separateActions: true })
        : key === 'page-move'
          ? pageMove({ separateActions: true })
          : key === 'sprint-close'
            ? sprintClose({ separateActions: true })
            : organizationForms[key] && !isGuest()
              ? organization.modal(key, { separateActions: true })
              : extensionForms[key] && !pending
                ? extensionFor(key)?.modalRecord?.(key)
                : null
    const body =
      isGuest() && (adminRoutes.has(key) || organizationForms[key])
        ? denied()
        : extensionForms[key]
          ? (pending ?? record?.body ?? extensionFor(key)?.modal?.(key))
          : organizationForms[key]
            ? record?.body
            : record
              ? record.body
              : key === 'page-move'
                ? pageMove()
                : key === 'sprint-close'
                  ? sprintClose()
                  : key === 'display'
                    ? display()
                    : key === 'timezone'
                      ? timezone()
                      : cmdk()
    if (record?.confirmation)
      return FlowConfirmDialog({
        id: 'flow-form-modal',
        title: routes[key].title,
        ...record.confirmation,
        cancelLabel: tr('flow.ui.cancel'),
        confirmLabel: tr('flow.ui.archive.workspace'),
        loading: busy(),
        onCancel: closeModal,
        feedback: feedbackToast('inline'),
      })
    return FlowDialog({
      id: documentModalRoutes.has(key) ? 'flow-document-modal' : 'flow-form-modal',
      title: extensionFor(key)?.modalTitle?.(key) ?? routes[key].title,
      size:
        extensionForms[key]?.size ?? (['project-new', 'project-profile'].includes(key) ? 'setup' : 'default'),
      onRequestClose: closeModal,
      closeDisabled: busy(),
      body,
      footer: record?.footer,
      feedback: feedbackToast('inline'),
    })
  }
  const taskModal = () => {
    const key = modalRoute()
    if (!taskModalRoutes.has(key)) return null
    const readPending = modalReadFallback('flow-task-modal', key)
    if (readPending) return readPending
    const task = currentTask()
    if (relocationRoutes.has(key) && task && relocation.state().preview)
      return FlowConfirmDialog({
        id: 'flow-task-modal',
        title: `${routes[key].title} · ${task.id}`,
        message: `${task.title} → ${relocation.state().projects.find((p) => p.id === relocation.state().target)?.title ?? ''}. ${tr(key === 'issue-copy' ? 'flow.relocation.copyHelp' : 'flow.relocation.transferHelp')}`,
        details: relocation.impactView(),
        confirmLabel: tr(
          key === 'issue-copy' ? 'flow.relocation.confirmCopy' : 'flow.relocation.confirmTransfer',
        ),
        cancelLabel: tr('flow.relocation.editChoices'),
        loading: busy(),
        onCancel: () => relocation.change({ preview: null }),
        onConfirm: () => void relocation.confirm(),
        feedback: feedbackToast('inline'),
      })
    if (key === 'subtask-new' && (!task || task.archived))
      return FlowDialog({
        id: 'flow-task-modal',
        title: routes[key].title,
        onRequestClose: closeModal,
        body: FlowEmpty({
          title: tr('flow.ui.task.not.found'),
          description: tr('flow.ui.this.task.may.have.been.moved.or.archived'),
        }),
      })
    if (key === 'issue-archive' && task)
      return FlowConfirmDialog({
        id: 'flow-task-modal',
        title: `${routes[key].title} · ${task.id}`,
        message: tr(
          'flow.ui.archiving.is.not.completion.subtasks.remain.dependent.tasks.stay.blocked.restore',
          [
            data().tasks.filter((item) => item.parentId === task.id).length,
            data().tasks.filter((item) => item.blockedBy.includes(task.id) && !isDone(data(), item)).length,
          ],
        ),
        details: taskOperation(),
        confirmLabel: tr('flow.ui.confirm.archive'),
        cancelLabel: tr('flow.ui.cancel'),
        confirmDisabled: !canWrite(),
        loading: busy(),
        onCancel: closeModal,
        onConfirm: () => host?.querySelector('#flow-task-archive-form')?.requestSubmit(),
        feedback: feedbackToast('inline'),
      })
    const creating = ['issue-new', 'subtask-new'].includes(key)
    /** Changing status, sprint, dependency, archive or comment is one short choice: it gets a form-width dialog, not the record layout. */
    const operation = !creating && !detailKeys.has(key)
    const body = creating ? composer.view() : operation ? taskOperation() : taskDetail()
    if (!creating && !task)
      return FlowDialog({
        id: 'flow-task-modal',
        title: key === 'issue' ? tr('flow.ui.task', [record()]) : routes[key].title,
        onRequestClose: closeModal,
        body,
      })
    const state = creating
      ? null
      : liveTaskState()[record()] && liveTaskState()[record()] !== 'saved'
        ? liveTaskState()[record()]
        : autosave.state(record())
    const readOnly = FlowNotice({
      title: tr('flow.ui.view.only'),
      message: tr('flow.ui.you.cannot.edit.this.task'),
      tone: 'yellow',
    })
    if (operation)
      return FlowDialog({
        id: 'flow-task-modal',
        title: routes[key].title,
        onRequestClose: closeModal,
        body: canWrite() || key === 'issue-copy' ? body : stack(readOnly, body),
        feedback: feedbackToast('inline'),
      })
    return FlowDialog({
      id: 'flow-task-modal',
      size: 'task',
      headerActions: FlowRecordAsideTrigger(),
      title: key === 'issue' ? tr('flow.ui.task', [currentTask()?.id ?? record()]) : routes[key].title,
      onRequestClose: closeModal,
      body: !canWrite() ? html`${FlowSection({ children: readOnly })}${body}` : body,
      feedback: feedbackToast('inline'),
      footer: creating
        ? actions(
            html`<span data-flow="muted">${tr('flow.ui.drafts.are.kept.in.this.session')}</span>`,
            inline(
              FlowButton({ label: tr('flow.ui.cancel'), onClick: closeModal }),
              FlowButton({
                label: tr('flow.ui.create.task'),
                variant: 'primary',
                loading: busy(),
                disabled: !canWrite() || !composer.ready(),
                onClick: () => host?.querySelector('#flow-task-create')?.requestSubmit(),
              }),
            ),
          )
        : inline(
            FlowTag({
              label: !canWrite()
                ? tr('flow.ui.view.only')
                : state === 'error' || state === 'offline'
                  ? tr('flow.ui.not.saved.try.again')
                  : state === 'saving' || state === 'pending'
                    ? tr('flow.ui.autosaving')
                    : tr('flow.ui.saved'),
              tone: state === 'error' || state === 'offline' ? 'red' : 'neutral',
            }),
            html`<span data-flow="muted">${tr('flow.ui.property.changes.are.saved.automatically')}</span>`,
            (state === 'error' || state === 'offline') && !failure()
              ? FlowButton({
                  label: tr('flow.ui.retry.save'),
                  onClick: () => {
                    void flushLiveTasks()
                    retryTaskSave()
                  },
                })
              : null,
          ),
    })
  }
  const feedbackToast = (placement = 'overlay') => {
    if (scopeDenied()) return null
    const problem = failure()
    if (problem && data()) {
      const expired = problem.code === 'fixtureSession'
      saveRevision()
      const retryAutosave = data().tasks.some((t) => autosave.state(t.id) === 'error')
      const title =
        {
          blocked: tr('flow.ui.task.is.blocked'),
          conflict: tr('flow.ui.new.version.available'),
          validation: tr('flow.ui.check.details'),
          cycle: tr('flow.ui.cannot.create.a.cycle'),
          fixtureSession: tr('flow.ui.session.expired'),
        }[problem.code] ?? tr('flow.ui.action.could.not.be.completed')
      const action = expired
        ? FlowButton({ label: tr('flow.ui.reload.page'), size: 'sm', onClick: () => location.reload() })
        : retryAutosave
          ? FlowButton({
              label: tr('flow.ui.retry.save'),
              size: 'sm',
              disabled: busy(),
              onClick: () => {
                void flushLiveTasks()
                retryTaskSave()
              },
            })
          : problem.code === 'conflict' || readFailure()
            ? FlowButton({
                label: tr(readFailure() ? 'flow.ui.try.again' : 'flow.ui.load.new.version'),
                size: 'sm',
                disabled: busy(),
                onClick: reload,
              })
            : null
      return FlowToast({
        placement,
        tone: 'error',
        title,
        message: problem.message,
        action,
        onClose: () => {
          failure.set(null)
          feedback.clear()
        },
      })
    }
    if (notice())
      return FlowToast({
        placement,
        message: notice().message ?? notice(),
        action: notice().target
          ? FlowButton({
              label: tr('flow.ui.open'),
              size: 'sm',
              onClick: () => navigate(notice().target.route, notice().target.params),
            })
          : null,
        onClose: feedback.clear,
        onPause: feedback.pause,
        onResume: feedback.resume,
      })
    if (data()?.notice && dismissedDataNotice() !== data().notice)
      return FlowToast({
        placement,
        tone: 'warning',
        title: tr('flow.ui.incomplete.results'),
        message: data().notice,
        onClose: () => dismissedDataNotice.set(data().notice),
      })
    return null
  }
  const changeLanguage = async (value) => {
    if (props.serverShell) {
      if (formGuard.hasChanges()) {
        requestLeave(() => void changeLanguage(value))
        return
      }
      if (!(await documents.flush())) return
      await autosave.flushAll()
      if (!(await flushLiveTasks())) return
      if (data()?.tasks.some((t) => autosave.state(t.id) === 'error')) return
    }
    setFlowLocale(value)
    try {
      localStorage.setItem('flow.language', flowLocale())
    } catch {}
    if (typeof document !== 'undefined') document.documentElement.lang = flowLocale()
    if (typeof location !== 'undefined') {
      const url = new URL(location.href)
      url.searchParams.set('lang', flowLocale())
      history.replaceState(history.state, '', url)
      if (props.serverShell) location.reload()
    }
  }
  const mainContent = () =>
    (scopeDenied() ? denied(true) : null) ??
    (props.serverShell && !primaryReady() ? FlowLoading({ label: tr('flow.ui.opening.flow') }) : null) ??
    (screen() === 'invitation-accept' ? null : firstRun.page(failure())) ??
    (loading() && !data()
      ? FlowLoading({ label: tr('flow.ui.opening.flow') })
      : !data()
        ? FlowEmpty({
            titleLevel: props.serverShell && props.chrome && !documentRoutes.has(screen()) ? undefined : 1,
            title:
              failure()?.code === 'forbidden'
                ? tr('flow.ui.access.denied')
                : tr('flow.ui.unable.to.open.flow'),
            description:
              (failure()?.message ?? tr('flow.ui.try.again.to.continue')) +
              (failure()?.code === 'forbidden' ? ' · ' + tr('flow.review.accessHelp') : ''),
            action: FlowButton({ label: tr('flow.ui.try.again'), onClick: reload }),
          })
        : documentRoutes.has(screen())
          ? documents.view()
          : html`${!canWrite() && screen() !== 'invitation-accept' ? FlowNotice({ title: tr('flow.ui.view.only'), message: tr('flow.ui.you.can.view.content.but.cannot.change.data'), tone: 'yellow' }) : null}${content()}`)
  const shellOptions = (children) =>
    !data() || (screen() !== 'invitation-accept' && firstRun.page(failure()))
      ? { title: 'Flow', titleAsLabel: true, sidebar: sidebar(), children }
      : documentRoutes.has(screen())
        ? { ...documents.chrome(), sidebar: sidebar(), children }
        : {
            title:
              screen() === 'issue'
                ? tr('flow.ui.task', [currentTask()?.id ?? ''])
                : (routes[screen()]?.title ?? 'Flow'),
            breadcrumb:
              scopeOf(screen()) === 'project'
                ? `${data().workspaces?.find((w) => w.id === workspaceId())?.title ?? data().company.name} · ${selectedProject()?.title ?? ''}`
                : scopeOf(screen()) === 'personal' ||
                    (organizationRoutes[screen()] ?? extensionRoutes[screen()])?.group ===
                      tr('flow.ui.organization') ||
                    ['team', 'teams', 'permissions', 'workspaces'].includes(screen())
                  ? data().company.name
                  : (data().workspaces?.find((w) => w.id === workspaceId())?.title ?? data().company.name),
            sidebar: sidebar(),
            actions: scopeDenied()
              ? null
              : inline(
                  scopeOf(screen()) === 'project' && selectedProject() ? projectActions() : null,
                  extensionRoutes[screen()]
                    ? extensionFor(screen())?.topAction?.(screen())
                    : organizationRoutes[screen()]
                      ? organization.topAction(screen())
                      : extensionRoutes[screen()] ||
                          [
                            'automations',
                            'forms',
                            'saved-views',
                            'personal-settings',
                            'workspace-settings',
                            'workspace-integrations',
                            'settings',
                            'project-profile',
                            'github',
                            'tags',
                          ].includes(screen())
                        ? null
                        : FlowButton({
                            label: tr('flow.ui.create.task'),
                            icon: 'plus',
                            variant: 'primary',
                            size: 'sm',
                            disabled: !canWrite(),
                            onClick: () => navigate('issue-new'),
                          }),
                ),
            contentWidth: contentWidthFor(screen(), routes[screen()]),
            contentMode: screen() === 'project-profile' ? 'form' : undefined,
            navigation:
              scopeOf(screen()) === 'project' && selectedProject() ? projectViews() : managementViews(),
            children,
          }
  const chromeRegions = () => {
    const p = shellOptions(null)
    return {
      sidebar: html`${p.sidebar}`,
      header: html`${FlowShellHeader(p)}`,
      tabs: html`${p.navigation ?? null}`,
    }
  }
  const shellView = (children) => {
    const p = shellOptions(children)
    const regions = chromeRegions()
    return html`<div data-flow-ui data-flow-app data-rendering="server-shell" lang=${flowLocale()} data-theme=${theme()} data-density=${density()}>
      ${FlowShell({
        ...p,
        sidebar: html`<div data-flow-chrome="sidebar">${p.sidebar}</div>`,
        header: html`<div data-flow-chrome="header" data-ket-slot="flow.header">${regions.header}</div>`,
        navigation: html`<div data-flow-chrome="tabs" data-ket-slot="flow.tabs">${regions.tabs}</div>`,
        children: html`<div data-ket-slot="flow.content">${children}</div>`,
      })}
    </div>`
  }
  const chromeRoots = new Map()
  const relocation = createTaskRelocation({
    route: activeRoute,
    task: currentTask,
    data,
    call,
    mutate,
    busy,
    failure,
    company: companyId,
    refresh: () => void reload(),
    completed(value, destination) {
      const params = { id: value.id, project: destination.id, workspace: destination.workspaceId }
      const background = href('project-issues', {
        project: destination.id,
        workspace: destination.workspaceId,
      })
      const target = href('issue', { ...params, background })
      // A destination may be outside the current bounded bootstrap. The native
      // navigator obtains authorized SSR chrome for that owner before hydration.
      if (props.serverShell && dependencies.navigatePage)
        void dependencies.navigatePage(target, { fallback: 'error' }).catch((error) => {
          if (error.name !== 'AbortError') feedback.show(tr('flow.ui.unable.to.open.flow'))
        })
      else if (props.serverShell) location.assign(target)
      else navigate('issue', params)
    },
  })
  let chromeBound = false,
    appearanceStop,
    relocationStop
  const enhanceChrome = () => {
    if (!props.serverShell || chromeBound) return
    // Hydrate the exact SSR snapshot before auth/bootstrap can change its shape.
    // Anonymous first-run chrome is valid even without business data.
    chromeBound = true
    const regions = chromeRegions()
    for (const [name, template] of Object.entries(regions)) {
      const element = host.querySelector(`[data-flow-chrome="${name}"]`)
      if (element)
        chromeRoots.set(
          name,
          hydrateRoot(domHost(), element, name === 'sidebar' ? template : html`${template}`),
        )
    }
    runtime.sync()
  }
  const view = () =>
    html`<div data-flow-ui lang=${flowLocale()} data-theme=${theme()} data-density=${density()}>
      ${props.serverShell ? mainContent() : data() && documentRoutes.has(screen()) && !firstRun.page(failure()) ? documents.view() : FlowShell(shellOptions(mainContent()))}
      ${data() && primaryReady() && !scopeDenied() ? taskModal() : null}${data() && primaryReady() && !scopeDenied() && modalRoute() ? filePreview() : null}${data() && primaryReady() && !scopeDenied() ? formModal() : null}${data() && primaryReady() && !scopeDenied() ? savedViewDialog() : null}
      ${discardConfirmation()}
      ${destructiveConfirmation()}
      ${globalSearch.view()}
      ${help.view()}
      ${screen() !== 'project-profile' && !pendingAction() && !pendingLeave() && !modalRoute() && !savedViewOpen() && !extensions.some((x) => x.ownsFeedback?.()) ? feedbackToast() : null}
    </div>`
  return {
    view,
    shellView,
    chromeRegions,
    fragmentSlots(children) {
      const regions = chromeRegions()
      return {
        'flow.header': () => regions.header,
        'flow.tabs': () => regions.tabs,
        'flow.content': () => html`${children}`,
      }
    },
    // KetJS reconciles this keyed island in place. Chrome arrives as SSR slots;
    // the existing sidebar and its hydrated callbacks remain mounted.
    update(nextProps) {
      memberOptions.close(memberOptions.state.peek().id)
      statusChoices.close(statusChoices.state.peek().id)
      readController?.abort()
      if (props.screen === 'task-exchange' && nextProps.screen !== 'task-exchange') taskExchange.dispose()
      const retained = nextProps.chrome?.problem
        ? null
        : retainedDocumentSnapshot(
            data(),
            {
              ready: primaryReady(),
              screen: screen(),
              workspaceId: workspaceId(),
              project: scopeOf(screen()) === 'project' ? project() : '',
            },
            nextProps,
          )
      if (nextProps.screen === 'project-profile' || props.screen === 'project-profile') projectSetup.reset()
      props = nextProps
      if (!props.serverShell) {
        if (mounted) {
          readUrl()
          void reload({ navigation: true })
        }
        return
      }
      const nextModal = modalRoutes.has(props.screen) ? props.screen : null
      const nextBackground = nextModal
        ? (parseBackground(props.background, props.companyId ?? 'demo', base) ?? fallbackBackground())
        : null
      const nextBackgroundParams = nextBackground
        ? new URL(nextBackground.url, 'http://flow.local').searchParams
        : null
      if (nextBackground) modalBackground = nextBackground
      batch(() => {
        primaryReady.set(!!retained || !!props.chrome?.problem)
        loading.set(true)
        failure.set(props.chrome?.problem ?? null)
        readFailure.set(false)
        companyId.set(props.companyId ?? 'demo')
        workspaceId.set(props.workspaceId ?? '')
        screen.set(nextBackground?.screen ?? (props.screen === 'cmdk' ? 'my-work' : props.screen))
        modalRoute.set(nextModal)
        project.set(nextBackgroundParams?.get('project') ?? props.project ?? '')
        modalProject.set(props.project ?? '')
        modalScope.set(props.scope ?? '')
        documentScope.set(props.scope ?? 'workspace')
        libraryFilter.set(props.projectFilter ?? 'all')
        librarySearch.set(props.docq ?? '')
        libraryVisibility.set(props.visibility === 'private' ? 'private' : 'shared')
        documentReturn.set(libraryReturn(props.returnTo, base))
        record.set(props.record ?? 'KV-142')
        recordProvided.set(props.recordProvided ?? false)
        query.set(props.query ?? '')
        status.set(props.status ?? 'all')
        selectedView.set(props.view ?? '')
        selected.set([])
        pendingAction.set(null)
        formError.set({})
        operations.reset()
        data.set(retained ?? props.chrome ?? null)
        if (props.focus === 'content') documents.requestFocus()
      })
      const regions = chromeRegions()
      chromeRoots.get('sidebar')?.render(regions.sidebar)
      for (const name of ['header', 'tabs']) {
        chromeRoots.get(name)?.dispose({ remove: false })
        const element = host.querySelector(`[data-flow-chrome="${name}"]`)
        if (element) chromeRoots.set(name, hydrateRoot(domHost(), element, html`${regions[name]}`))
      }
      const options = shellOptions(null)
      syncFlowShellNavigation(host, {
        width: options.contentWidth,
        mode: options.contentMode,
        activeHref: (href) => {
          const url = new URL(href, location.href)
          const key = url.pathname.slice(base.length).replace(/\/$/, '')
          if (url.searchParams.has('project'))
            return scopeOf(screen()) === 'project' && url.searchParams.get('project') === project()
          return (
            key === screen() ||
            (key === 'all-pages' && pageRoutes.has(screen()) && scopeOf(screen()) === 'workspace')
          )
        },
      })
      runtime?.sync()
      const area = host?.querySelector('[data-flow="shell-content"]')
      if (area && !retained) area.scrollTop = 0
    },
    mount(context) {
      try {
        appearanceStorage = localStorage
      } catch {}
      const appearance = readFlowAppearance(appearanceStorage)
      theme.set(appearance.theme)
      density.set(appearance.density)
      if (typeof location !== 'undefined') {
        let saved
        try {
          saved = localStorage.getItem('flow.language')
        } catch {}
        const requested = new URL(location.href).searchParams.get('lang')
        setFlowLocale(requested ?? saved ?? 'en')
        // A server-rendered document has one language and loads only its message
        // catalog. A different saved preference starts a document in that language.
        if (props.serverShell && typeof document !== 'undefined' && !requested) {
          const rendered = normalizeFlowLocale(document.documentElement.lang)
          if (flowLocale() !== rendered) {
            const url = new URL(location.href)
            url.searchParams.set('lang', flowLocale())
            setFlowLocale(rendered)
            location.replace(url)
          }
        }
        if (typeof document !== 'undefined') document.documentElement.lang = flowLocale()
      }
      host = props.serverShell ? (context.root.closest('[data-flow-app]') ?? context.root) : context.root
      if (props.serverShell)
        appearanceStop = effect(() => {
          host.setAttribute('data-theme', theme())
          host.setAttribute('data-density', density())
          host.setAttribute('lang', flowLocale())
          syncFlowThemeButton(host, theme())
        })
      lifetime = context.lifetime
      lifetime.addEventListener('abort', memberOptions.dispose, { once: true })
      lifetime.addEventListener('abort', statusChoices.dispose, { once: true })
      if (typeof location !== 'undefined') {
        if (props.serverShell && props.chrome?.context) {
          // Adopt authorized route ownership before binding SSR chrome. A record
          // opened with stale workspace parameters must not hydrate another frame.
          const initialURL = new URL(location.href)
          const initialWorkspaceTarget = workspaceRecordTarget(
            props.screen,
            props.record,
            props.recordProvided,
            props.workspaceId,
          )
          if (initialWorkspaceTarget !== null && !initialURL.searchParams.has('id'))
            initialURL.searchParams.set('id', initialWorkspaceTarget)
          if (props.workspaceId) initialURL.searchParams.set('workspace', props.workspaceId)
          else initialURL.searchParams.delete('workspace')
          if (routeScope(props.screen, props.scope) === 'project' && props.project)
            initialURL.searchParams.set('project', props.project)
          if (props.recordProvided && ['page', 'page-child', 'page-move'].includes(props.screen)) {
            initialURL.searchParams.set('scope', props.scope)
            if (props.scope === 'workspace') initialURL.searchParams.delete('project')
          }
          if (initialURL.href !== location.href) history?.replaceState(history.state, '', initialURL)
        }
        history?.initialize(location.href)
        readUrl()
      }
      help.attach(host, lifetime)
      runtime = attachFlowUI(host)
      globalSearch.contextChanged()
      enhanceChrome()
      globalSearch.afterRender()
      observer = new MutationObserver(() => {
        enhanceChrome()
        runtime.sync()
        documents.afterRender()
        help.afterRender(host)
        globalSearch.afterRender()
        if (searchEntryPending && data()) {
          searchEntryPending = false
          globalSearch.focus()
        }
        for (const x of extensions) void x.afterRender?.()
        formGuard.sync()
      })
      observer.observe(host, {
        subtree: true,
        childList: true,
        attributes: true,
        attributeFilter: [
          'value',
          'checked',
          'data-flow-value',
          'data-focus-key',
          'aria-selected',
          'data-live-key',
          'data-open',
        ],
      })
      const pendingTaskSaves = () =>
        data()?.tasks.some((task) => autosave.state(task.id) !== 'saved') ||
        [...liveTaskControllers.values()].some((editor) => editor.isPending())
      const readHistory = () => {
        const target = new URL(location.href)
        const key = target.pathname.slice(base.length).replace(/\/$/, '')
        if (
          props.serverShell &&
          dependencies.navigatePage &&
          !modalRoutes.has(key) &&
          (key !== screen() || (target.searchParams.get('project') ?? '') !== project())
        )
          void dependencies.navigatePage(target.href, { replace: true, fallback: 'error' }).catch((error) => {
            if (error.name !== 'AbortError') feedback.show(tr('flow.ui.unable.to.open.flow'))
          })
        else readUrl()
      }
      let finishHistoryRestore
      const historyGuard = history
        ? createHistoryLeaveGuard(history, {
            hasChanges: () => formGuard.hasChanges() || documents.hasPendingNotes() || !!pendingTaskSaves(),
            request: (action, returning) => {
              returningHistory.set(returning)
              const restored = returning
                ? new Promise((resolve) => {
                    finishHistoryRestore = resolve
                  })
                : Promise.resolve()
              if (formGuard.hasChanges()) pendingLeave.set({ action })
              else
                void (async () => {
                  const notesSaved = await documents.flush()
                  await autosave.flushAll()
                  await flushLiveTasks()
                  await restored
                  if (lifetime.aborted) return
                  if (notesSaved && !pendingTaskSaves()) action()
                  else if (!notesSaved)
                    pendingLeave.set({
                      message: tr('flow.draft.documentMessage'),
                      action: () => {
                        documents.discardPendingNotes()
                        action()
                      },
                    })
                })()
            },
            restored: () => {
              returningHistory.set(false)
              finishHistoryRestore?.()
              finishHistoryRestore = undefined
            },
            read: readHistory,
          })
        : null
      if (props.serverShell && dependencies.navigatePage) {
        document.addEventListener(
          'ket:navigation-complete',
          (event) => {
            history?.navigated(event.detail.url, event.detail.mode)
            readUrl()
            void reload({ navigation: true })
          },
          { signal: lifetime },
        )
        document.addEventListener(
          'ket:popstate',
          (event) => {
            const target = new URL(event.detail.url)
            const key = target.pathname.slice(base.length).replace(/\/$/, '')
            if (
              historyGuard?.restoring ||
              modalRoute() ||
              modalRoutes.has(key) ||
              formGuard.hasChanges() ||
              documents.hasPendingNotes() ||
              pendingTaskSaves()
            ) {
              event.preventDefault()
              if (historyGuard) historyGuard.pop(target.pathname + target.search)
              else readUrl()
            }
          },
          { signal: lifetime },
        )
      } else
        window.addEventListener(
          'popstate',
          () => (historyGuard ? historyGuard.pop(location.pathname + location.search) : readUrl()),
          { signal: lifetime },
        )
      host.addEventListener(
        'reset',
        (event) => {
          if (!(event.target instanceof HTMLFormElement)) return
          const form = event.target
          // Reset's default action runs after this event. A successful command
          // may reset a check-in/comment form without creating another draft.
          queueMicrotask(() => {
            if (!lifetime.aborted && !event.defaultPrevented) formGuard.reset(form)
          })
        },
        { capture: true, signal: lifetime },
      )
      host.addEventListener(
        'submit',
        (event) => {
          if (!(event.target instanceof HTMLFormElement)) return
          const submission = formGuard.submission(event.target)
          submittedForm = submission
          queueMicrotask(() => {
            if (submittedForm === submission) submittedForm = null
          })
        },
        { capture: true, signal: lifetime },
      )
      window.addEventListener(
        'beforeunload',
        (event) => {
          if (!formGuard.hasChanges() && !documents.hasChanges() && !pendingTaskSaves()) return
          event.preventDefault()
          event.returnValue = ''
        },
        { signal: lifetime },
      )
      if (typeof location !== 'undefined') {
        const params = new URL(location.href).searchParams
        savedViewOpen.set(params.get('modal') === 'save-view')
        selectedView.set(params.get('view') ?? '')
      }
      window.addEventListener(
        'keydown',
        (e) => {
          if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
            e.preventDefault()
            if (e.repeat) return
            if (!modalRoute() && !savedViewOpen()) globalSearch.focus()
          }
          if (
            e.key === 'Escape' &&
            !modalRoute() &&
            !savedViewOpen() &&
            !(e.target instanceof Element && e.target.closest('dialog, [popover]'))
          ) {
            selected.set([])
            if (screen() === 'cmdk') navigate('my-work')
          }
        },
        { signal: lifetime },
      )
      // Mobile menu starts collapsed once shell mounts; desktop remains expanded.
      let collapsed = false
      const mobileObserver = new MutationObserver(() => {
        if (!collapsed && matchMedia('(max-width:760px)').matches) {
          const menu = host.querySelector('[data-flow="mobile-nav"]')
          if (menu) {
            menu.open = false
            const tree = host.querySelector('[data-flow="docs-tree-disclosure"]')
            if (tree) tree.open = false
            collapsed = true
            mobileObserver.disconnect()
          }
        }
      })
      mobileObserver.observe(host, { childList: true, subtree: true })
      lifetime.addEventListener('abort', () => mobileObserver.disconnect(), { once: true })
      mounted = true
      relocationStop = effect(() => relocation.sync())
      reload()
    },
    dispose() {
      appearanceStop?.()
      relocationStop?.()
      relocation.dispose()
      taskExchange.dispose()
      composer.dispose()
      help.dispose()
      organization.dispose()
      operations.dispose()
      planningWindows.dispose()
      reportWindows.dispose()
      for (const root of chromeRoots.values()) root.dispose({ remove: false })
      formGuard.dispose()
      feedback.dispose()
      for (const x of extensions) x.dispose?.()
      autosave.dispose()
      pendingOperations.clear()
      documents.dispose()
      globalSearch.dispose()
      readController?.abort()
      observer?.disconnect()
      runtime?.dispose()
    },
  }
}
