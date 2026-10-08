/**
 * The browser runtime. It owns everything the views may not touch: the
 * address, focus, the network and the try-it drafts. Three regions render
 * from one store: the topbar, the navigation and the main page. Links and
 * the search form stay native, so every view also works as a plain page.
 */
import {
  domHost,
  effect,
  type HostNode,
  type Mounted,
  mount,
  renderToStaticString,
  signal,
} from '@ketvietlab/ketjs-view'
import { attachClientModalInteractions } from '@ketvietlab/design-system'
import { specTranslator } from './messages.ts'
import { findOperation, readSpec, type SpecModel, type SpecOperation } from './model.ts'
import {
  type BuiltRequest,
  buildRequest,
  credentialOptions,
  curlOf,
  fieldName,
  initialValues,
  newIdempotencyKey,
  readResponse,
} from './request.ts'
import {
  emptyRoute,
  fieldId,
  GENERATE_SUFFIX,
  routeFrom,
  routeSearch,
  SIGN_IN_CANCEL_ID,
  SIGN_IN_FORM_ID,
  SIGN_IN_ID,
  SIGN_OUT_ID,
  SpecDialogs,
  type SpecBrand,
  SpecMain,
  SpecNavigation,
  type SpecRoute,
  type SpecState,
  SpecTopbar,
  type SpecViewProps,
  TRY_CANCEL_ID,
  TRY_FORM_ID,
  TRY_RESET_ID,
  TRY_SIGN_IN_ID,
  type TryState,
} from './views.tsx'

export type MountSpecOptions = {
  /** The application root: an element carrying `data-kv-design-system`. */
  root: HTMLElement
  /** An OpenAPI document already in the page. Takes precedence over `specUrl`. */
  document?: unknown
  /** Where to fetch the OpenAPI document from when none is given. */
  specUrl?: string
  locale?: string
  brand: SpecBrand
  /** Seconds before an unanswered try-it request is abandoned. Default 30. */
  timeoutSeconds?: number
  /** Attaches the design-system runtime (drawer, search dialog, tree keys) once the page has settled. */
  attachInteractions?: (root: HTMLElement) => () => void
  fetch?: typeof fetch
}

export type SpecController = {
  /** Navigates in place, as a link click would. */
  navigate: (route: SpecRoute, mode?: 'push' | 'replace') => void
  dispose: () => void
}

/** Typing pauses this long before the curl preview is rebuilt. */
const PREVIEW_DELAY_MS = 150

const blankTry = (): TryState => ({ values: {}, problems: {}, phase: 'idle', response: null, preview: null })

const isSecretField = (name: string) => name.startsWith('auth.')

export const mountSpec = (options: MountSpecOptions): SpecController => {
  const { root } = options
  const t = specTranslator(options.locale ?? root.closest('[lang]')?.getAttribute('lang'))
  const fetcher = options.fetch ?? globalThis.fetch.bind(globalThis)
  const timeoutSeconds = options.timeoutSeconds ?? 30
  const basePath = location.pathname

  const state = signal<SpecState>({ kind: 'loading' })
  const route = signal<SpecRoute>(routeFrom(location.search))
  /** Settled try-it states by operation id. Drafts live outside the store so typing never re-renders. */
  const tries = signal<ReadonlyMap<string, TryState>>(new Map())
  const drafts = new Map<string, Record<string, string>>()
  /** Credentials are entered once, under Sign in, shared by every operation and kept only in this tab's memory. */
  const credentials = signal<Readonly<Record<string, string>>>({})
  const signInOpen = signal(false)
  let inflight: {
    operation: string
    controller: AbortController
    reason: 'cancel' | 'timeout' | null
  } | null = null

  const model = (): SpecModel | null => {
    const current = state()
    return current.kind === 'ready' && current.result.ok ? current.result.model : null
  }

  const draftOf = (operation: SpecOperation): Record<string, string> => {
    let values = drafts.get(operation.id)
    if (!values) {
      const current = model()
      values = current ? initialValues(current, operation, newIdempotencyKey) : {}
      drafts.set(operation.id, values)
    }
    return values
  }

  const tryState = (operation: SpecOperation): TryState => {
    const settled = tries().get(operation.id) ?? blankTry()
    return { ...settled, values: { ...draftOf(operation), ...credentials() } }
  }

  const setTry = (operation: SpecOperation, patch: Partial<TryState>) => {
    const next = new Map(tries.peek())
    next.set(operation.id, { ...(next.get(operation.id) ?? blankTry()), ...patch })
    tries.set(next)
  }

  const href = (target: SpecRoute) => `${basePath}${routeSearch(target, location.search)}`

  const props = (): SpecViewProps => ({
    state: state(),
    route: route(),
    t,
    href,
    brand: options.brand,
    tryState,
    timeoutSeconds,
  })

  const region = (name: string): HTMLElement => {
    const element = root.querySelector<HTMLElement>(`[data-spec-region="${name}"]`)
    if (!element) throw new Error(`Spec: the page has no "${name}" region`)
    // Server markup is replaced rather than adopted: the client renders the same view, and
    // replacing keeps this runtime independent of hydration markers.
    element.replaceChildren()
    return element
  }

  const mainRegion = region('main')
  mainRegion.tabIndex = -1
  const host = domHost(document)
  // The DOM host's nodes are the document's own elements.
  const node = (element: HTMLElement) => element as unknown as HostNode
  // The topbar goes through the HTML parser rather than the view runtime: its search dialog keeps
  // the modal layer in a <template>, whose children only the parser places in `template.content`,
  // and the design-system runtime moves those nodes. So it re-renders whole, and only when the
  // description settles, never on navigation; its events are delegated to the root.
  const topbar = region('topbar')
  let detachInteractions: (() => void) | null = null
  const attachOnce = () => {
    if (detachInteractions || !options.attachInteractions) return
    detachInteractions = options.attachInteractions(root)
  }
  const signedIn = () => Object.values(credentials()).some((value) => value !== '')
  const stopTopbar = effect(() => {
    const current = state()
    topbar.innerHTML = renderToStaticString(
      SpecTopbar({ state: current, t, href, query: route.peek().q, signedIn: signedIn() }),
    )
    // A re-rendered topbar has new search controls; the runtime must bind to them, not the replaced ones.
    if (current.kind === 'loading') return
    detachInteractions?.()
    detachInteractions = null
    attachOnce()
  })
  const dialogRegion = region('dialog')
  const mounted: Mounted[] = [
    mount(host, node(region('navigation')), () => SpecNavigation(props())),
    mount(host, node(mainRegion), () => SpecMain(props())),
    mount(host, node(dialogRegion), () =>
      SpecDialogs({ signInOpen: signInOpen(), model: model(), t, credentials: credentials() }),
    ),
  ]

  const currentOperation = (): SpecOperation | null => {
    const current = model()
    return current ? findOperation(current, route().operation) : null
  }

  const syncTitle = () => {
    const current = model()
    const operation = currentOperation()
    const name = current?.title ?? t('spec.brand')
    document.title = operation
      ? `${operation.summary ?? operation.operationId ?? operation.path} · ${name} · ${t('spec.brand')}`
      : `${name} · ${t('spec.brand')}`
  }

  const navigate = (target: SpecRoute, mode: 'push' | 'replace' = 'push') => {
    const url = href(target)
    if (mode === 'push') history.pushState(null, '', url)
    else history.replaceState(null, '', url)
    route.set(target)
    syncTitle()
    window.scrollTo({ top: 0 })
    mainRegion.focus({ preventScroll: true })
  }

  // -------------------------------------------------------------------------
  // Loading

  const settle = (next: SpecState) => {
    state.set(next)
    syncTitle()
    // Hosts and tests can wait on this instead of guessing when the page is usable.
    root.dataset['specState'] = next.kind
  }

  const load = async () => {
    if (options.document !== undefined) {
      settle({ kind: 'ready', result: readSpec(options.document) })
      return
    }
    settle({ kind: 'loading' })
    if (!options.specUrl) {
      settle({ kind: 'failed', failure: { reason: 'network' } })
      return
    }
    try {
      const response = await fetcher(options.specUrl, { headers: { Accept: 'application/json' } })
      if (!response.ok) {
        settle({ kind: 'failed', failure: { reason: 'fetch', status: response.status } })
        return
      }
      const text = await response.text()
      let parsed: unknown
      try {
        parsed = JSON.parse(text)
      } catch {
        settle({ kind: 'failed', failure: { reason: 'json' } })
        return
      }
      settle({ kind: 'ready', result: readSpec(parsed) })
    } catch {
      settle({ kind: 'failed', failure: { reason: 'network' } })
    }
  }

  // -------------------------------------------------------------------------
  // Try it

  const tryForm = (): HTMLFormElement | null => {
    const element = document.getElementById(TRY_FORM_ID)
    return element instanceof HTMLFormElement && root.contains(element) ? element : null
  }

  /** Copies what the reader typed into the drafts. Credentials are shown read-only; Sign in owns them. */
  const collect = (operation: SpecOperation, element: HTMLFormElement) => {
    const values = draftOf(operation)
    for (const [name, value] of new FormData(element)) {
      if (typeof value === 'string' && !isSecretField(name)) values[name] = value
    }
  }

  // -------------------------------------------------------------------------
  // Sign in

  let detachDialog: (() => void) | null = null
  /** Where focus returns: the opener may be re-rendered while the dialog is open. */
  let opener: string | null = null

  const openSignIn = (from: string) => {
    if (signInOpen.peek() || !model()) return
    // Typed drafts survive the re-render that follows signing in.
    const operation = currentOperation()
    const element = tryForm()
    if (operation && element) collect(operation, element)
    opener = from
    signInOpen.set(true)
    detachDialog = attachClientModalInteractions(root)
    // The runtime focuses the first control, the close button; a reader opened this to type.
    dialogRegion.querySelector<HTMLInputElement>('input')?.focus()
  }

  const closeSignIn = () => {
    if (!signInOpen.peek()) return
    detachDialog?.()
    detachDialog = null
    signInOpen.set(false)
    if (opener) document.getElementById(opener)?.focus()
    opener = null
  }

  const updateCredentials = (next: Record<string, string>) => {
    const kept = Object.fromEntries(Object.entries(next).filter(([, value]) => value !== ''))
    credentials.set(kept)
    const operation = currentOperation()
    if (!operation) return
    const problems = { ...(tries.peek().get(operation.id)?.problems ?? {}) }
    for (const name of Object.keys(problems)) if (isSecretField(name) && kept[name]) delete problems[name]
    setTry(operation, { problems, preview: previewOf(operation) })
  }

  const saveSignIn = (element: HTMLFormElement) => {
    const next: Record<string, string> = {}
    for (const [name, value] of new FormData(element))
      if (typeof value === 'string' && isSecretField(name)) next[name] = value.trim()
    updateCredentials(next)
    closeSignIn()
  }

  const previewOf = (operation: SpecOperation): string | null => {
    const current = model()
    if (!current) return null
    const built = buildRequest(current, operation, tryState(operation).values, location.origin)
    return built.ok ? curlOf(built.request) : null
  }

  let previewTimer: ReturnType<typeof setTimeout> | null = null
  const schedulePreview = (operation: SpecOperation) => {
    if (previewTimer) clearTimeout(previewTimer)
    previewTimer = setTimeout(() => {
      previewTimer = null
      if (currentOperation()?.id === operation.id) setTry(operation, { preview: previewOf(operation) })
    }, PREVIEW_DELAY_MS)
  }

  /** Writes into a control the reader may already have edited, where a re-rendered attribute would not show. */
  const setControl = (operation: SpecOperation, name: string, value: string) => {
    const control = document.getElementById(fieldId(operation, name))
    if (control instanceof HTMLInputElement || control instanceof HTMLTextAreaElement) control.value = value
  }

  const focusFirstProblem = (operation: SpecOperation, problems: Readonly<Record<string, string>>) => {
    const first = Object.keys(problems)[0]
    if (first) document.getElementById(fieldId(operation, first))?.focus()
  }

  /** Cookie schemes need the browser to send its cookies, including to another origin. */
  const credentialsMode = (operation: SpecOperation): RequestCredentials => {
    const current = model()
    if (!current) return 'same-origin'
    const choices = credentialOptions(current, operation)
    const chosen =
      choices.find((choice) => choice.id === tryState(operation).values[fieldName.credential]) ?? choices[0]
    return chosen?.schemes.some((scheme) => scheme.type === 'apiKey' && scheme.in === 'cookie')
      ? 'include'
      : 'same-origin'
  }

  const send = async (operation: SpecOperation, request: BuiltRequest) => {
    const controller = new AbortController()
    const call: { operation: string; controller: AbortController; reason: 'cancel' | 'timeout' | null } = {
      operation: operation.id,
      controller,
      reason: null,
    }
    inflight = call
    const timer = setTimeout(() => {
      call.reason = 'timeout'
      controller.abort()
    }, timeoutSeconds * 1000)
    setTry(operation, { phase: 'sending', problems: {}, response: null, preview: curlOf(request) })
    const started = performance.now()
    try {
      const response = await fetcher(request.url, {
        method: request.method,
        headers: request.headers.map(([name, value]) => [name, value] as [string, string]),
        body: request.body,
        credentials: credentialsMode(operation),
        cache: 'no-store',
        signal: controller.signal,
      })
      const text = await response.text()
      setTry(operation, {
        phase: 'done',
        response: readResponse({
          status: response.status,
          statusText: response.statusText,
          headers: [...response.headers],
          text,
          durationMs: performance.now() - started,
        }),
      })
    } catch {
      setTry(operation, {
        phase:
          call.reason === 'timeout'
            ? 'timeout'
            : call.reason === 'cancel'
              ? 'cancelled'
              : navigator.onLine
                ? 'network'
                : 'offline',
      })
    } finally {
      clearTimeout(timer)
      if (inflight === call) inflight = null
    }
  }

  const submit = (operation: SpecOperation, element: HTMLFormElement) => {
    const current = model()
    if (!current || inflight) return
    collect(operation, element)
    if (!navigator.onLine) {
      setTry(operation, { phase: 'offline', response: null })
      return
    }
    const built = buildRequest(current, operation, tryState(operation).values, location.origin)
    if (!built.ok) {
      setTry(operation, { phase: 'invalid', problems: built.problems, response: null, preview: null })
      queueMicrotask(() => focusFirstProblem(operation, built.problems))
      return
    }
    void send(operation, built.request)
  }

  // -------------------------------------------------------------------------
  // Events: one listener per kind on the root, so re-rendered regions need no rebinding.

  const sameDocumentLink = (anchor: HTMLAnchorElement): URL | null => {
    if (anchor.target && anchor.target !== '_self') return null
    if (anchor.hasAttribute('download')) return null
    const url = new URL(anchor.href, location.href)
    return url.origin === location.origin && url.pathname === basePath ? url : null
  }

  const onClick = (event: MouseEvent) => {
    if (event.defaultPrevented || event.button !== 0) return
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return
    const target = event.target instanceof Element ? event.target : null
    if (!target) return
    if (target.closest('#spec-retry')) {
      void load()
      return
    }
    const signIn = target.closest(`#${SIGN_IN_ID}, #${TRY_SIGN_IN_ID}`)
    if (signIn) {
      openSignIn(signIn.id)
      return
    }
    if (dialogRegion.contains(target)) {
      if (target.closest(`#${SIGN_OUT_ID}`)) {
        updateCredentials({})
        closeSignIn()
      } else if (target.closest(`#${SIGN_IN_CANCEL_ID}, [data-ui="modal-close"], [data-ui="modal-backdrop"]`))
        closeSignIn()
      return
    }
    const operation = currentOperation()
    if (operation && target.closest(`#${TRY_CANCEL_ID}`)) {
      if (inflight?.operation === operation.id) {
        inflight.reason = 'cancel'
        inflight.controller.abort()
      }
      return
    }
    if (operation && target.closest(`#${TRY_RESET_ID}`)) {
      const current = model()
      if (!current) return
      const body = initialValues(current, operation, newIdempotencyKey)[fieldName.body] ?? ''
      draftOf(operation)[fieldName.body] = body
      setControl(operation, fieldName.body, body)
      const problems = { ...(tries.peek().get(operation.id)?.problems ?? {}) }
      delete problems[fieldName.body]
      setTry(operation, { problems, preview: previewOf(operation) })
      return
    }
    const generate = target.closest(`[id$="${GENERATE_SUFFIX}"]`)
    if (operation && generate) {
      const control = document.getElementById(generate.id.slice(0, -GENERATE_SUFFIX.length))
      if (control instanceof HTMLInputElement) {
        control.value = newIdempotencyKey()
        draftOf(operation)[control.name] = control.value
        setTry(operation, { preview: previewOf(operation) })
        control.focus()
      }
      return
    }
    const anchor = target.closest('a[href]')
    if (!(anchor instanceof HTMLAnchorElement)) return
    const url = sameDocumentLink(anchor)
    if (!url) return
    event.preventDefault()
    navigate(routeFrom(url.search))
  }

  const onSubmit = (event: SubmitEvent) => {
    const element = event.target
    if (!(element instanceof HTMLFormElement)) return
    if (element.matches('[data-ui="global-search"]')) {
      event.preventDefault()
      const query = String(new FormData(element).get('q') ?? '').trim()
      element.closest('dialog')?.close()
      navigate({ ...emptyRoute, q: query || null })
      return
    }
    if (element.id === SIGN_IN_FORM_ID) {
      event.preventDefault()
      saveSignIn(element)
      return
    }
    if (element.id !== TRY_FORM_ID) return
    event.preventDefault()
    const operation = currentOperation()
    if (operation && element.dataset['specTry'] === operation.id) submit(operation, element)
  }

  const onInput = (event: Event) => {
    const element = tryForm()
    const operation = currentOperation()
    if (!element || !operation || !(event.target instanceof Node) || !element.contains(event.target)) return
    collect(operation, element)
    schedulePreview(operation)
  }

  const onPopState = () => {
    route.set(routeFrom(location.search))
    syncTitle()
  }

  const onOnline = () => {
    const operation = currentOperation()
    if (operation && tries.peek().get(operation.id)?.phase === 'offline') setTry(operation, { phase: 'idle' })
    if (state.peek().kind === 'failed') void load()
  }

  root.addEventListener('click', onClick)
  root.addEventListener('submit', onSubmit)
  root.addEventListener('input', onInput)
  root.addEventListener('change', onInput)
  window.addEventListener('popstate', onPopState)
  window.addEventListener('online', onOnline)

  // Each opened operation gets its curl preview once; later edits refresh it after a pause.
  const stopPreview = effect(() => {
    const operation = currentOperation()
    if (operation && !tries.peek().get(operation.id)?.preview)
      queueMicrotask(() => setTry(operation, { preview: previewOf(operation) }))
  })

  void load()

  return {
    navigate,
    dispose: () => {
      inflight?.controller.abort()
      if (previewTimer) clearTimeout(previewTimer)
      root.removeEventListener('click', onClick)
      root.removeEventListener('submit', onSubmit)
      root.removeEventListener('input', onInput)
      root.removeEventListener('change', onInput)
      window.removeEventListener('popstate', onPopState)
      window.removeEventListener('online', onOnline)
      detachDialog?.()
      detachInteractions?.()
      stopPreview()
      stopTopbar()
      for (const entry of mounted) entry.dispose()
      credentials.set({})
    },
  }
}
