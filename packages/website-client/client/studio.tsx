import { uploadImage } from './image-upload.tsx'
import { attachLiveDescriptions } from './live-description.tsx'
// Shared data/command store for server-framed Studio pages. SSR owns the shell and page identity;
// independently hydrated page regions share this store and preserve drafts across navigation.
import {
  signal,
  batch,
  computed,
  effect,
  html,
  renderIsland,
  renderToStaticString,
  trustedMarkup,
} from '@ketvietlab/ketjs-view'
import { attachDesignSystemInteractions, ToastRegion } from '@ketvietlab/design-system'
import { WorkspacePage, withPageRegions, emptyRegion, createWebsiteRegion } from './page-regions.tsx'
import type { StudioRegionProps } from './page-regions.tsx'
import { routes, websiteExtensions, ownerOf, INSTANCE_HOOKS } from './extensions.ts'
import { matchRoute, buildHref } from './routes.ts'
import { tr } from './i18n.ts'
import { createCoreScreens } from './screens/index.ts'
import { studioFrame, loadingView, failureView, activeEntry } from './shell.tsx'
import { handleArchiveClick } from './archive-actions.tsx'
import { screenHelp } from './help.tsx'
import { parseCommand } from './ui.tsx'
import type { WebsiteExtensionInstance } from './extensions.ts'
import type {
  Boot,
  Call,
  Command,
  ImageUpload,
  Screen,
  Site,
  StudioContext,
  Toast,
  WebsiteLocation,
} from './types.ts'

export type StudioProps = {
  path?: string
  query?: Record<string, string>
  basePath?: string
  applications?: import('@ketvietlab/design-system').AppSwitcherProps
  bootstrap?: Boot
  frameFallback?: boolean
}
export type StudioDependencies = {
  call?: Call
  uploadImage?: ImageUpload
  /** The host obtains a new SSR frame for route/record/site navigation, preserving this store. */
  frame?: (
    href: string,
    signal: AbortSignal,
  ) => Promise<{ fallback: boolean; bootstrap?: Boot; canonicalHref?: string } | undefined>
  /** After a save, refresh only server-owned identities; keep data regions and form focus. */
  identity?: (href: string, signal: AbortSignal) => Promise<void>
}
/** What the current route read: its own value, the value behind a modal, and extension extras. */
type Loaded = { key: string; value: unknown; back: unknown; extras: Record<string, unknown> }

const THEME_KEY = 'ketsuite.theme'
/** A saved choice wins; without one, follow the system like the KetSuite shell does. */
export const initialTheme = (): 'dark' | 'light' => {
  const saved = globalThis.localStorage?.getItem(THEME_KEY)
  if (saved === 'dark' || saved === 'light') return saved
  return globalThis.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
}

export function createWebsiteStudio(props: StudioProps = {}, dependencies: StudioDependencies = {}) {
  const base = props.basePath ?? '/website/'
  const call: Call =
    dependencies.call ??
    (() => Promise.reject(Object.assign(new Error('No Website transport'), { code: 'transport' })))
  const first = matchRoute(routes, props.path ?? '') ?? { key: 'overview', params: {} }
  const route = signal<WebsiteLocation>({
    key: first.key,
    params: first.params,
    query: { ...(props.query ?? {}) },
  })
  const boot = signal<Boot | null>(props.bootstrap ?? null)
  const data = signal<Loaded | null>(null)
  const failure = signal<unknown>(null)
  const toasts = signal<Toast[]>([])
  const busy = signal(false)
  const theme = signal(initialTheme())
  let reading: AbortController | null = null
  let readKey: string | null = null
  let framing: AbortController | null = null
  let navigating: AbortController | null = null
  let identifying: AbortController | null = null
  let fallbackFrame = props.frameFallback ?? false
  let toastSeq = 0
  const cleanup: (() => void)[] = []

  const href: StudioContext['href'] = (key, params = {}, query = {}) =>
    buildHref(routes, base, key, params, { site: route().query.site ?? boot()?.site?.id, ...query })
  const can: StudioContext['can'] = (capability) =>
    !capability || Boolean(boot()?.actor?.capabilities?.includes(capability))
  const notify: StudioContext['notify'] = (title, tone = 'positive') => {
    const id = `toast-${++toastSeq}`
    toasts.set((list) => [...list.slice(-2), { id, title, tone }])
    const timer = setTimeout(() => toasts.set((list) => list.filter((t) => t.id !== id)), 5000)
    cleanup.push(() => clearTimeout(timer))
  }

  /** Shared with every screen and extension instance. Nothing here grants authority. */
  const ctx: StudioContext = {
    applications: props.applications,
    tr,
    call,
    uploadImage: dependencies.uploadImage ?? uploadImage,
    href,
    can,
    notify,
    navigate: (key, params, query, options) => go(href(key, params, query), options),
    route: () => route(),
    // Both are read only after the bootstrap answered; site-scoped screens need its site.
    boot: () => boot()!,
    theme: () => theme(),
    site: () => boot()?.site as Site,
    busy: () => busy(),
    /** For a screen whose modal dialog hides the frame's toast region. */
    toasts: () => toasts(),
    refresh: async () => {
      await readRoute(true)
      if (dependencies.identity) {
        identifying?.abort()
        const controller = new AbortController()
        identifying = controller
        await dependencies.identity(href(route().key, route().params, route().query), controller.signal)
      }
    },
    /** Re-read the bootstrap (site, actor, offer) and then the route, after a site-level change. */
    reload: async () => {
      await bootstrap(boot()?.site?.id)
      if (dependencies.frame) await replaceFrame(route())
      await readRoute(true)
    },
    /** Values contributed by extensions for a named slot, in registration order. Each instance also
     *  receives what its own `readFor` returned for the current route. */
    slot: (hook, value) =>
      instances.flatMap(({ name, instance }) => {
        const contributed = instance[hook]?.(value, data()?.extras?.[name])
        return contributed == null ? [] : [contributed]
      }),
  }

  const instances = websiteExtensions().map((extension) => {
    const instance: WebsiteExtensionInstance = extension.create(ctx) ?? {}
    const unknown = Object.keys(instance).filter((hook) => !INSTANCE_HOOKS.includes(hook))
    if (unknown.length)
      throw new Error(`Website extension ${extension.name} has unknown hooks: ${unknown.join(', ')}`)
    return { name: extension.name, instance }
  })
  const screens: Record<string, Screen> = createCoreScreens(ctx)
  const commands = new Map<string, { owner: string; run: Command }>()
  const addCommands = (owner: string, table: Record<string, Command> = {}) => {
    for (const [name, run] of Object.entries(table)) {
      if (commands.has(name))
        throw new Error(`Website command ${name} is defined by ${commands.get(name)!.owner} and ${owner}`)
      commands.set(name, { owner, run })
    }
  }
  addCommands('core:studio', {
    'studio.retry': () =>
      boot() ? readRoute(true) : bootstrap(route().query.site).then(() => readRoute(true)),
    'studio.theme': () => {
      theme.set(theme() === 'dark' ? 'light' : 'dark')
      globalThis.localStorage?.setItem(THEME_KEY, theme())
    },
  })
  for (const [key, screen] of Object.entries(screens)) addCommands(`core:${key}`, screen.commands)
  for (const { name, instance } of instances) addCommands(name, instance.commands)

  /** Core screens and extension routes answer the same three questions. */
  const screenOf = (key: string): Screen | undefined => {
    const owner = ownerOf(key)
    if (!owner) return screens[key]
    const { instance } = instances.find((x) => x.name === owner)!
    const read = instance.read
    return {
      read: read ? (r, signal) => read(key, r, signal) : null,
      view: (value) => instance.view?.(key, value) ?? null,
    }
  }

  const fromLocation = (url: URL): WebsiteLocation | null => {
    const relative = url.pathname.startsWith(base) ? url.pathname.slice(base.length) : ''
    const found = matchRoute(routes, relative)
    if (!found) return null
    return { ...found, query: Object.fromEntries(url.searchParams) }
  }

  async function bootstrap(site: string | null | undefined, signal?: AbortSignal) {
    const value = await call<Boot>('website_studio.bootstrap', { site: site ?? null }, { signal })
    if (signal?.aborted) throw new DOMException('Navigation cancelled', 'AbortError')
    const previous = boot()?.site?.id
    batch(() => {
      boot.set(value)
      failure.set(null)
    })
    if (previous && previous !== value.site?.id) for (const { instance } of instances) instance.reset?.()
  }

  async function readRoute(force = false) {
    const current = route()
    const screen = screenOf(current.key)
    const back = routes[current.key]?.modal?.back
    if ((routes[current.key]?.scope ?? 'site') === 'site' && boot() && !boot()!.site) {
      reading?.abort()
      readKey = null
      batch(() => {
        data.set({ key: current.key, value: null, back: null, extras: {} })
        failure.set({ code: 'noSite' })
      })
      return
    }
    const key = JSON.stringify([current.key, screen?.readKey?.(current) ?? current, boot()?.site?.id])
    if (!force && key === readKey && data()) return
    reading?.abort()
    const controller = new AbortController()
    reading = controller
    readKey = key
    try {
      const extras = ownerOf(current.key)
        ? Promise.resolve({})
        : Promise.all(
            instances.map(async ({ name, instance }): Promise<[string, unknown]> => {
              try {
                return [name, await instance.readFor?.(current.key, current, controller.signal)]
              } catch (error) {
                if (!controller.signal.aborted)
                  console.error(`Website extension ${name} failed to read`, error)
                return [name, undefined]
              }
            }),
          ).then(Object.fromEntries)
      const [value, backValue, extraValues] = await Promise.all([
        screen?.read ? screen.read(current, controller.signal) : null,
        back && screenOf(back)?.read ? screenOf(back)!.read!(current, controller.signal) : null,
        extras,
      ])
      if (controller.signal.aborted) return
      applyPageMetadata(globalThis.document, screen?.metadata?.(value))
      batch(() => {
        data.set({ key: current.key, value, back: backValue, extras: extraValues })
        failure.set(null)
      })
      // A server read can fail before it knows the record's pattern/title. After recovery, obtain
      // its real server frame instead of trying to render that identity in a client data region.
      if (fallbackFrame && dependencies.frame) await replaceFrame(current)
    } catch (error) {
      if (controller.signal.aborted || (error as Error | null)?.name === 'AbortError') return
      readKey = null
      batch(() => {
        data.set({ key: current.key, value: null, back: null, extras: {} })
        failure.set(error)
      })
    }
  }

  async function go(target: string, { replace = false } = {}) {
    const url = new URL(target, globalThis.location?.href ?? 'http://studio.invalid/')
    const next = fromLocation(url)
    if (!next) return
    if (globalThis.history)
      history[replace ? 'replaceState' : 'pushState'](null, '', url.pathname + url.search)
    await apply(next)
  }

  async function apply(next: WebsiteLocation) {
    navigating?.abort()
    identifying?.abort()
    const controller = new AbortController()
    navigating = controller
    const previous = route()
    const siteChanged = Boolean(next.query.site) && next.query.site !== boot()?.site?.id
    const frameChanged =
      siteChanged ||
      next.key !== previous.key ||
      JSON.stringify(next.params) !== JSON.stringify(previous.params)
    framing?.abort()
    reading?.abort()
    route.set(next)
    try {
      if (siteChanged) await bootstrap(next.query.site, controller.signal)
      if (controller.signal.aborted) return
      if (frameChanged && dependencies.frame) {
        data.set(null)
        const current = await replaceFrame(next)
        if (!current) return
      }
      await readRoute()
    } catch (error) {
      if (!controller.signal.aborted && (error as Error)?.name !== 'AbortError') failure.set(error)
    }
  }

  async function replaceFrame(next: WebsiteLocation) {
    framing?.abort()
    const controller = new AbortController()
    framing = controller
    const result = await dependencies.frame?.(href(next.key, next.params, next.query), controller.signal)
    if (!controller.signal.aborted) {
      fallbackFrame = result?.fallback ?? false
      if (result?.bootstrap) boot.set(result.bootstrap)
      if (result?.canonicalHref) {
        const canonical = fromLocation(new URL(result.canonicalHref, location.href))
        if (canonical) {
          route.set(canonical)
          history.replaceState(null, '', result.canonicalHref)
        }
      }
    }
    return !controller.signal.aborted
  }

  async function run(value: string, form?: FormData) {
    const { name, args } = parseCommand(value)
    const command = commands.get(name)
    if (!command) throw new Error(`Unknown Website command ${name}`)
    toasts.set((list) => list.filter((t) => t.tone !== 'danger'))
    busy.set(true)
    try {
      await command.run(args, form)
    } catch (error) {
      for (const { instance } of instances) {
        const claimed = instance.mutationError?.(error, name)
        if (claimed !== undefined) {
          if (claimed.message) notify(claimed.message, 'danger')
          return
        }
      }
      const { code, message } = (error ?? {}) as { code?: string; message?: string }
      notify(
        code === 'conflict' ? tr('website.error.conflict') : (message ?? tr('website.error.request')),
        'danger',
      )
    } finally {
      busy.set(false)
    }
  }

  const onClick = (e: Event) => {
    const event = e as MouseEvent
    if (
      event.defaultPrevented ||
      event.button !== 0 ||
      event.metaKey ||
      event.ctrlKey ||
      event.shiftKey ||
      event.altKey
    )
      return
    if (handleArchiveClick(event, { run, busy })) return
    const target = event.target as Element
    const button = target.closest?.<HTMLButtonElement>('button[name="command"]')
    if (button && button.type !== 'submit') {
      event.preventDefault()
      if (!button.disabled && !busy()) run(button.value)
      return
    }
    const link = target.closest?.<HTMLAnchorElement>('a[href]')
    if (!link || link.target || link.hasAttribute('download')) return
    const url = new URL(link.href)
    if (url.origin !== location.origin || !url.pathname.startsWith(base)) return
    event.preventDefault()
    go(url.href)
  }
  /** `form[data-live=command]`: local draft edits on every keystroke. No request, no busy state. */
  const onInput = (event: Event) => {
    const form = (event.target as Element).closest?.<HTMLFormElement>('form[data-live]')
    if (!form) return
    const command = commands.get(form.dataset.live!)
    if (!command) throw new Error(`Unknown Website command ${form.dataset.live}`)
    command.run({}, new FormData(form))
  }
  const onChange = (event: Event) => {
    const target = event.target as HTMLInputElement
    if (target.name !== '__order') return
    const form = target.closest?.<HTMLFormElement>('form[data-reorder]')
    if (form) commands.get(form.dataset.reorder!)?.run({}, new FormData(form))
  }
  const onSubmit = (e: Event) => {
    const event = e as SubmitEvent
    const form = event.target as HTMLFormElement
    const submitter = event.submitter as HTMLButtonElement | null
    if (submitter?.name === 'command') {
      event.preventDefault()
      if (Number(form.dataset.uploading || 0) > 0) {
        notify(tr('website.taxonomy.waitUpload'), 'danger')
        return
      }
      if (!busy()) run(submitter.value, new FormData(form))
      return
    }
    // A GET form into the Studio (the location strip's search) is a route change, not a reload.
    // The action's own query (the site) is kept; a native GET submission would drop it.
    if (form.method !== 'get') return
    const url = new URL(form.action)
    if (url.origin !== location.origin || !url.pathname.startsWith(base)) return
    event.preventDefault()
    for (const [name, value] of new FormData(form))
      if (typeof value === 'string') url.searchParams.set(name, value)
    go(url.href)
  }

  /** The list a record route belongs to, for leaving a missing record. */
  const createSite = () =>
    can('website.site.manage') ? { label: tr('website.site.create'), href: href('sites-edit') } : undefined
  const listOf = (key: string) => {
    const owner = activeEntry(key)
    return owner && owner !== key && routes[owner]
      ? { label: tr('website.error.backTo', { title: tr(routes[owner].title) }), href: ctx.href(owner) }
      : undefined
  }
  const content = () => {
    const current = route()
    const loaded = data()
    const ready = loaded?.key === current.key
    const back = routes[current.key]?.modal?.back
    return {
      key: current.key,
      route: routes[current.key],
      body: !ready
        ? null
        : failure()
          ? failureView(failure(), listOf(current.key), createSite())
          : screenOf(current.key)?.view(loaded!.value, current),
      background: back && ready && !failure() ? screenOf(back)?.view(loaded!.back, current) : null,
    }
  }

  const toastView = () => <ToastRegion label={tr('website.toast.region')} toasts={toasts()} />
  const regions = computed(() => {
    const values = new Map<string, unknown>()
    if (boot() && data()?.key === route().key) {
      const current = withPageRegions(content, (id, value) => {
        values.set(id, value)
        return emptyRegion()
      })
      // An error or a screen without a pattern still has a data body, never a client shell.
      if (!values.size) values.set('fallback.body', current.body)
    }
    values.set('studio.toasts', toastView())
    return values
  })
  const region = ({ id, initial }: StudioRegionProps) => {
    const values = regions()
    if (id === 'studio.toasts') return html`${values.get(id)}`
    if (!data() || data()?.key !== route().key) {
      if (failure() && id.endsWith('.body')) return failureView(failure(), listOf(route().key), createSite())
      return html`${trustedMarkup(initial)}`
    }
    const value = values.has(id)
      ? values.get(id)
      : id.endsWith('.body') && failure()
        ? failureView(failure(), listOf(route().key), createSite())
        : null
    return html`${value}`
  }

  /** Host-side identity read. Only the page frame is delivered; data bodies start in loading. */
  async function serverFrame() {
    try {
      if (!boot()) await bootstrap(route().query.site)
      await readRoute()
    } catch (error) {
      failure.set(error)
    }
    let count = 0
    const place = (id: string, value: unknown, loading: boolean) => {
      count++
      const initial = renderToStaticString(html`${loading ? loadingView() : value}`)
      const markup = renderIsland('website.region', createWebsiteRegion, { id, initial }, { tag: 'div' })
      return html`${trustedMarkup(markup.replace('<div ', '<div class="website-region" '))}`
    }
    let current = withPageRegions(content, place)
    const fallback = !count
    if (!count) {
      // A failed read cannot construct its normal presenter. Keep an SSR identity and retry body.
      current = {
        ...current,
        body: (
          <WorkspacePage
            title={tr(routes[route().key]?.title ?? 'website.route.overview')}
            body={place('fallback.body', null, true)}
          />
        ),
      }
    }
    current = {
      ...current,
      body: (
        <>
          {current.body}
          {screenHelp(ctx, tr(current.route?.title ?? 'website.brand'))}
        </>
      ),
    }
    const frame = boot() ? (
      studioFrame(
        ctx,
        current,
        [],
        place('studio.toasts', <ToastRegion label={tr('website.toast.region')} toasts={[]} />, false),
      )
    ) : (
      <>
        {current.body}
        {place('studio.toasts', null, false)}
      </>
    )
    return {
      view: (
        <div
          data-website-studio
          data-website-rendering="ssr-regions"
          data-website-frame-fallback={fallback ? 'yes' : null}
        >
          {frame}
        </div>
      ),
      bootstrap: boot() ?? undefined,
      fallback,
    }
  }

  const view = () => html`${content().body ?? loadingView()}`

  return {
    view,
    region,
    serverFrame,
    navigate: ctx.navigate,
    refresh: ctx.refresh,
    mount({ root, lifetime }: { root: HTMLElement; lifetime: AbortSignal }) {
      root.addEventListener('click', onClick, { signal: lifetime })
      root.addEventListener('input', onInput, { signal: lifetime })
      root.addEventListener('change', onChange, { signal: lifetime })
      root.addEventListener('submit', onSubmit, { signal: lifetime })
      // Theme belongs to the design-system root the host renders around the island.
      const scope = root.closest<HTMLElement>('[data-kv-design-system]')
      const stopTheme = effect(() => {
        document.documentElement.dataset.theme = theme()
        if (scope) scope.dataset.theme = theme()
        root
          .querySelector('button[name="command"][value="studio.theme"]')
          ?.setAttribute('aria-pressed', String(theme() === 'dark'))
      })
      // GAP ds-runtime-rebind: the DS runtime binds the elements present when it attaches (menus,
      // navigation drawer, search dialog) and refocuses its attach-time element when detached. A
      // client-rendered app re-attaches after each route, site or data change and puts focus back.
      const syncDescriptions = attachLiveDescriptions(root, lifetime)
      let detach: (() => void) | null = null
      const reattach = () => {
        root
          .querySelector('button[name="command"][value="studio.theme"]')
          ?.setAttribute('aria-pressed', String(theme() === 'dark'))
        const focused = document.activeElement
        detach?.()
        detach = attachDesignSystemInteractions(root)
        if (focused instanceof HTMLElement && focused.isConnected && focused !== document.activeElement)
          focused.focus()
      }
      const stopRuntime = effect(() => {
        route()
        boot()
        data()
        queueMicrotask(() => {
          if (!lifetime.aborted) {
            reattach()
            void syncDescriptions()
          }
        })
      })
      lifetime.addEventListener(
        'abort',
        () => {
          stopTheme()
          stopRuntime()
          detach?.()
        },
        { once: true },
      )
      const onPop = () => {
        const next = fromLocation(new URL(location.href))
        if (next) apply(next)
      }
      addEventListener('popstate', onPop)
      lifetime.addEventListener('abort', () => removeEventListener('popstate', onPop), { once: true })
      const ready = boot() ? Promise.resolve() : bootstrap(route().query.site)
      ready
        .then(() => {
          // Canonical URL: the site the server chose becomes explicit, so reload and share keep it.
          const site = boot()?.site?.id
          if (site && route().query.site !== site) {
            const next = { ...route(), query: { ...route().query, site } }
            route.set(next)
            history.replaceState(null, '', href(next.key, next.params, next.query))
          }
          return readRoute()
        })
        .catch((error) => failure.set(error))
    },
    dispose() {
      navigating?.abort()
      identifying?.abort()
      framing?.abort()
      reading?.abort()
      for (const stop of cleanup.splice(0)) stop()
      for (const screen of new Set(Object.values(screens))) screen.dispose?.()
      for (const { instance } of instances) instance.dispose?.()
    },
  }
}
import { applyPageMetadata } from './metadata.ts'
