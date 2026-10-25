import { signal, batch } from '@ketvietlab/ketjs-view'
import { FlowSearchTrigger, FlowSpotlight } from '@ketvietlab/flow-ui/workspace'
import { syncFlowSearchTrigger } from '@ketvietlab/flow-ui/runtime'
import { tr } from './i18n.mjs'
import { extensionSearchLabels } from './extensions.mjs'
import { routes } from './routes.mjs'

export function createGlobalSearch(ctx) {
  const query = signal(''),
    open = signal(false),
    loading = signal(false),
    error = signal(''),
    groups = signal([]),
    active = signal('')
  let timer,
    controller,
    revision = 0,
    disposed = false,
    company,
    authorization,
    focusPending = false
  const cancel = () => {
    clearTimeout(timer)
    controller?.abort()
    revision++
  }
  const read = async () => {
    cancel()
    if (disposed || !ctx.data()) return
    const sequence = revision,
      tenant = ctx.companyId(),
      current = new AbortController()
    controller = current
    batch(() => {
      loading.set(true)
      error.set('')
    })
    try {
      const value = await ctx.call(
        'flow.search',
        { query: query(), recent: ctx.recent() },
        { signal: current.signal },
      )
      if (disposed || sequence !== revision || tenant !== ctx.companyId()) return
      const labels = {
        tasks: tr('flow.ui.tasks'),
        projects: tr('flow.ui.projects'),
        pages: tr('flow.ui.documents'),
        workspaces: tr('flow.ui.search.workspaces'),
        people: tr('flow.ui.search.group.people'),
        teams: 'Team',
        epics: tr('flow.ui.search.epics'),
        sprints: tr('flow.ui.search.sprints'),
        forms: tr('flow.ui.forms'),
        views: tr('flow.ui.saved.views'),
        files: tr('flow.ui.attachments'),
        inbox: tr('flow.ui.inbox'),
        catalog: tr('flow.ui.setup'),
        recent: tr('flow.ui.recent'),
        navigation: tr('flow.ui.navigation'),
        ...extensionSearchLabels(),
      }
      batch(() => {
        groups.set(
          (value.groups ?? []).map((g) => ({
            ...g,
            label: labels[g.id] ?? g.label,
            items: g.items.map((item) =>
              item.id.startsWith('nav:') && routes[item.route]
                ? { ...item, title: routes[item.route].title }
                : item,
            ),
          })),
        )
        active.set('')
      })
    } catch (e) {
      if (!current.signal.aborted && sequence === revision && tenant === ctx.companyId())
        error.set(e.message || tr('flow.ui.try.again.to.continue'))
    } finally {
      if (sequence === revision && !disposed) loading.set(false)
    }
  }
  const show = () => {
    if (!ctx.data() || disposed) return
    if (!open()) {
      focusPending = true
      open.set(true)
      void read()
    }
  }
  const close = () => {
    cancel()
    open.set(false)
    loading.set(false)
    focusPending = false
  }
  const change = (value) => {
    cancel()
    batch(() => {
      query.set(value.slice(0, 200))
      active.set('')
      open.set(true)
      loading.set(true)
      error.set('')
    })
    timer = setTimeout(read, 200)
  }
  const focus = () => {
    show()
    ctx.root()?.querySelector('#flow-command-modal-input')?.focus()
  }
  return {
    show,
    close,
    read,
    change,
    contextChanged() {
      const d = ctx.data()
      const next = JSON.stringify([
        ctx.companyId(),
        d?.user?.id,
        d?.members?.find((m) => m.id === d.user.id)?.role,
        d?.capabilities,
        d?.projects?.map((p) => p.id),
        d?.pages?.map((p) => p.id),
      ])
      if (authorization !== next) {
        authorization = next
        close()
        groups.set([])
      }
      if (company !== ctx.companyId()) {
        company = ctx.companyId()
        close()
        batch(() => {
          query.set('')
          groups.set([])
        })
      }
    },
    focus,
    afterRender() {
      if (ctx.root())
        syncFlowSearchTrigger(ctx.root(), {
          open: open(),
          disabled: !ctx.data(),
          dialogId: 'flow-command-modal',
        })
      if (!focusPending || !open()) return
      const input = ctx.root()?.querySelector('#flow-command-modal-input')
      if (input) {
        input.focus()
        focusPending = false
      }
    },
    trigger: () =>
      FlowSearchTrigger({
        onClick: focus,
        disabled: !ctx.data(),
        open: open(),
        dialogId: 'flow-command-modal',
      }),
    view: () =>
      open()
        ? FlowSpotlight({
            id: 'flow-command-modal',
            query: query(),
            scope: tr('flow.ui.search.flow'),
            loading: loading(),
            error: error(),
            groups: groups(),
            activeId: active(),
            onQuery: change,
            onClose: close,
            onActive: active.set,
            onRetry: read,
            onSelect: (id) => {
              if (!open() || loading() || error()) return
              const item = groups()
                .flatMap((g) => g.items)
                .find((x) => x.id === id)
              if (!item) return
              ctx.remember(id)
              close()
              ctx.navigate(item.route, item.params)
            },
          })
        : null,
    dispose() {
      disposed = true
      cancel()
    },
  }
}
