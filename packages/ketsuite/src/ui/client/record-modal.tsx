// The record-modal contract, browser half.
//
// A module describes a record — how to read it, its tabs, dialogs and commands —
// and this runtime owns everything that must behave the same in every module:
// opening from a link or deep link, history, focus, Escape, the inert background,
// loading and failure states, submitting through `/_ket/fn`, showing a refusal on
// the field that caused it without losing what was typed, the unsaved-input guard,
// and telling the collection behind the modal that its records changed.
//
// Views are render-pure: they read the context and return design-system markup.
// They never fetch, never touch history and never query the document.

import { each } from '@ketvietlab/ketjs-view'
import { batch, signal } from '@ketvietlab/ketjs-view'
import type { IslandController, IslandProps, JSXChild, TemplateResult } from '@ketvietlab/ketjs-view'
import type { ActionVariant } from '@ketvietlab/design-system'
import {
  Button,
  ConfirmDialog,
  LoadingState,
  ModalSheet,
  Notice,
  RecordPage,
  Stack,
  TabbedView,
} from '@ketvietlab/design-system'
import {
  RECORD_NEW_ID,
  RECORD_PARAM,
  RECORD_TAB_PARAM,
  readRecordModalTarget,
  recordModalClosedHref,
  recordModalCreateHref,
  recordModalHost,
  recordModalHref,
  recordPageLoading,
  recordPanelLoading,
  recordPanelFrame,
  recordPageTrail,
  recordPageFrame,
  recordPageShell,
} from '../record-modal.tsx'
import type { RecordModalTarget, RecordPageIslandProps } from '../record-modal.tsx'

// ── Function calls ────────────────────────────────────────────────────────────

export type RecordIssue = {
  field: string | null
  code: string
  message: string | null
  messageKey?: string
  params: Record<string, unknown>
}

export type RecordCallResult<Value = unknown> =
  | { ok: true; value: Value }
  | { ok: false; issues: RecordIssue[]; message: string | null; status: number }

const issuesOf = (source: unknown): RecordIssue[] => {
  const holder = (source ?? {}) as { errors?: unknown; issues?: unknown }
  const list = Array.isArray(holder.errors)
    ? holder.errors
    : Array.isArray(holder.issues)
      ? holder.issues
      : []
  return list.map((raw) => {
    const item = (raw ?? {}) as Record<string, unknown>
    const path = Array.isArray(item.path) ? item.path.join('.') : null
    return {
      field: typeof item.field === 'string' ? item.field : path,
      code: String(item.code ?? 'invalid'),
      message: typeof item.message === 'string' ? item.message : null,
      ...(typeof item.messageKey === 'string' ? { messageKey: item.messageKey } : {}),
      params: (item.params && typeof item.params === 'object' ? item.params : {}) as Record<string, unknown>,
    }
  })
}

/**
 * Call a server function as the signed-in viewer.
 *
 * A domain refusal (`{ ok: false, errors }` inside the value) and a transport or
 * permission refusal (`ok: false` on the envelope) come back in one shape, so a
 * view never has to know which layer said no.
 */
export const recordRequestHref = (href: string, currentHref: string): string => {
  const current = new URL(currentHref),
    target = new URL(href, current)
  if (target.origin !== current.origin) throw new Error('Record requests require a same-origin route')
  for (const key of ['company', 'companies', 'branch', 'branches', 'lang']) {
    if (target.searchParams.has(key)) continue
    for (const value of current.searchParams.getAll(key)) target.searchParams.append(key, value)
  }
  return target.href
}

/** Route context keys are explicit; unrelated collection filters stay out of the read request. */
export const recordContextRequestHref = (
  href: string,
  currentHref: string,
  keys: readonly string[] = [],
): string => {
  const current = new URL(currentHref),
    target = new URL(recordRequestHref(href, currentHref))
  for (const key of keys) {
    if (target.searchParams.has(key)) continue
    for (const value of current.searchParams.getAll(key)) target.searchParams.append(key, value)
  }
  return target.href
}

/** Only the return entry made by this modal belongs to its pending close. */
export const recordModalReturnMatches = (expected: string, current: string): boolean => {
  const left = new URL(expected, current),
    right = new URL(current)
  left.searchParams.sort()
  right.searchParams.sort()
  return (
    left.origin === right.origin &&
    left.pathname === right.pathname &&
    left.search === right.search &&
    left.hash === right.hash
  )
}

/** Reconciliation during draft capture may detach and empty the old native select. */
export const applyRecordControlState = (
  control: { value: string },
  captureDrafts: () => void,
  apply: (value: string) => void,
): void => {
  const value = control.value
  captureDrafts()
  apply(value)
}

export const callRecordRoute = async <Value = unknown>(
  route: string,
  input: Record<string, unknown>,
  options: { signal?: AbortSignal; idempotencyKey?: string } = {},
): Promise<RecordCallResult<Value>> => {
  const target = new URL(route, 'https://record.invalid')
  if (target.origin !== 'https://record.invalid' || !route.startsWith('/') || route.startsWith('//'))
    throw new Error('Record commands require a same-origin route')
  const response = await fetch(
    typeof location === 'undefined'
      ? target.pathname + target.search
      : recordRequestHref(target.pathname + target.search, location.href),
    {
      method: 'POST',
      credentials: 'same-origin',
      headers: {
        'content-type': 'application/json',
        ...(options.idempotencyKey ? { 'idempotency-key': options.idempotencyKey } : {}),
      },
      body: JSON.stringify(input),
      signal: options.signal,
    },
  )
  const payload = (await response.json().catch(() => ({}))) as {
    ok?: boolean
    value?: unknown
    error?: { message?: string; issues?: unknown }
    message?: string
  }
  if (!response.ok || payload.ok === false)
    return {
      ok: false,
      issues: issuesOf(payload.error ?? payload),
      // A server failure is not the user's to read: its text is for the log, and
      // the modal falls back to its own words.
      message: response.status >= 500 ? null : (payload.error?.message ?? payload.message ?? null),
      status: response.status,
    }
  const value = payload.value as { ok?: boolean } | undefined
  if (value && typeof value === 'object' && value.ok === false)
    return { ok: false, issues: issuesOf(value), message: null, status: response.status }
  return { ok: true, value: payload.value as Value }
}

/** Call a declared function through the same response and refusal contract. */
export const callRecordFunction = <Value = unknown>(
  name: string,
  input: Record<string, unknown>,
  options: { signal?: AbortSignal; idempotencyKey?: string } = {},
): Promise<RecordCallResult<Value>> =>
  callRecordRoute<Value>(`/_ket/fn/${encodeURIComponent(name)}`, input, options)

// ── Definition ────────────────────────────────────────────────────────────────

/** What every record context read must return next to its data. */
export type RecordContextEnvelope<Data> = {
  data: Data
  /** Translated strings this record's views use, including `recordModal.*` runtime labels. */
  messages: Record<string, string>
}

export type RecordModalContext<Data> = {
  kind: string
  id: string
  /** The modal was opened by a create action (`record=<kind>:new`); there is no record yet. */
  creating: boolean
  tab: string
  data: Data
  /** Translate a key the context shipped, interpolating `{name}` params. */
  t: (key: string, params?: Record<string, unknown>) => string
  /** The refusal for one field of the last submit, translated. */
  fieldError: (name: string) => string | null
  /** What was typed into a field before a refused submit, or the fallback. */
  draft: (name: string, fallback?: string) => string
  /** Read a captured parent-record draft when explicitly seeding a child workflow. */
  recordDraft?: (name: string, fallback?: string) => string
  /** Parent edits captured before opening a child decision. */
  recordChanged?: boolean
  /** The layer owning this view's inputs; `dialog` metadata also exists on the parent. */
  draftScope?: 'record' | 'dialog'
  /** Whether a checkbox/radio value was selected before the view re-rendered. */
  draftChecked: (name: string, value?: string, fallback?: boolean) => boolean
  /** Captured selections in this layer, including inputs on unmounted pages. */
  draftCheckedValues?: (name: string) => readonly string[]
  /**
   * What a preview command answered, for the view to render. Null until that
   * command has run in this layer, and again as soon as anything moves.
   */
  outcome: <T>(command: string) => T | null
  /**
   * A submit has been in flight long enough to be worth saying so. A command the
   * server answers at once never sets it, so a button bound to it does not flash
   * its spinner; the runtime stops a second submit either way.
   */
  busy: boolean
  dialog: { name: string; params: Record<string, string> } | null
  href: (tab: string) => string
  /**
   * Whether the record is shown in a modal over its collection or on its own page.
   * Views place controls by it: a page's actions sit in its header, a modal's in
   * its footer, so a menu opens downward on a page and upward in a modal.
   * The runtime always sets it; absent (a hand-built context) reads as a modal.
   */
  presentation?: 'modal' | 'page'
  /** View-local state, set by `data-record-state` controls (click, or change for inputs). */
  state: (key: string, fallback?: string) => string
}

/** Attachments a command uploaded before its function ran, by form field. */
export type RecordUploads = Record<string, { id: string; name: string | null }>

/** Read-only context routes compose permission-checked function calls on the server. */
export const readRecordContextRoute = async <Data,>(
  href: string,
  signal?: AbortSignal,
  keys: readonly string[] = [],
): Promise<RecordCallResult<Data | null>> => {
  const url = new URL(recordContextRequestHref(href, location.href, keys))
  if (url.origin !== location.origin) throw new Error('Record context must stay same-origin')
  const response = await fetch(url.href, {
    credentials: 'same-origin',
    signal,
    headers: { accept: 'application/json' },
  })
  if (!response.ok) return { ok: false, issues: [], message: null, status: response.status }
  return { ok: true, value: (await response.json()) as Data | null }
}

/** One extra call of a multi-step command — see `RecordModalCommand.also`. */
export type RecordModalCommandStep<Data> = {
  fn: string
  input: (
    form: FormData,
    context: RecordModalContext<Data>,
    uploads: RecordUploads,
  ) => Record<string, unknown>
  /**
   * Skip this step — a module not installed, a permission the viewer lacks, or a
   * submitted value that leaves this step nothing to do.
   */
  when?: (context: RecordModalContext<Data>, form: FormData) => boolean
}

export type RecordModalCommand<Data> = ({ fn: string; route?: never } | { fn?: never; route: string }) & {
  /** Same-origin destination after a successful command; evaluated by the runtime. */
  navigate?: (value: unknown, context: RecordModalContext<Data>) => string
  /** Fields consumed by this command; preserve other record drafts and clear only after all steps succeed. */
  clearRecordDrafts?: readonly string[]
  /** Keep the current dialog input when an ancillary mutation refreshes it. Default: consume it. */
  retainDialogDraft?: boolean
  /**
   * Read the record again quietly after a refusal, keeping what was typed and the refusal's
   * guidance: for a command refused because the record, or what it depends on, moved since it
   * was read (a revision stamp, an availability slice). The retry then carries the new stamps.
   */
  refreshOnRefusal?: boolean
  /** Map server paths to stable native field names using the submitted snapshot. */
  issueField?: (field: string, form: FormData, context: RecordModalContext<Data>) => string
  /** Map the submitted form to the function's input. */
  input: (
    form: FormData,
    context: RecordModalContext<Data>,
    uploads: RecordUploads,
  ) => Record<string, unknown>
  /**
   * Further calls made right after `fn`/`input` succeeds, in order, as part of
   * the same user-facing action — one busy state, one success notice, one set
   * of field refusals — stopping at the first one that fails. For an edit that
   * spans functions in different modules that cannot call one another (a
   * single `product.saveTemplate` cannot also configure stock tracking or
   * tax), this is what lets one "Save" button still read as one save.
   */
  also?: readonly RecordModalCommandStep<Data>[]
  /**
   * File fields stored through `/files` before the function runs, each mapped to
   * the attachment's metadata (`resModel`, `resId`, `resField`, `public`). The
   * stored attachment ids reach `input` as its third argument.
   */
  upload?: Record<string, (form: FormData, context: RecordModalContext<Data>) => Record<string, string>>
  /** A destructive command asks first; declining leaves the record untouched. */
  confirm?: (context: RecordModalContext<Data>) => string | null
  /**
   * What happens after success. Defaults to `close`. `reload` reads the record
   * again behind a loading state and closes a dialog; `refresh` reads it again in
   * place, keeping the tab, the open dialog and any islands mounted in them.
   * `open` is for a create command: the modal switches to the record it created
   * (the id from `created`, else the function value's `id`) on the tab named by
   * `openTab`, replacing the `:new` history entry.
   */
  after?: 'close' | 'reload' | 'refresh' | 'stay' | 'open' | { tab: string } | { dialog: string | null }
  /**
   * The command asks what would happen instead of making it happen: its function
   * writes nothing, so the record is not re-read, the collection is not told and
   * what was typed stays on screen. The answer reaches the view through
   * `context.outcome`, beside the very form that asked for it, so the person can
   * read the consequence and then submit the command that commits it. `after` is
   * not consulted — a preview always stays in its layer.
   */
  preview?: boolean
  /**
   * The view answers this command itself from `context.outcome`: a password shown once, the
   * address a link went to. The runtime's own "saved" notice would only repeat that answer, or
   * misname it, so a command that stays open says nothing more.
   */
  showsOutcome?: boolean
  /** The id of the record a create command made, read from the function's value. */
  created?: (value: unknown) => string | null
  /** Tab to open on the created record when `after` is `open`. */
  openTab?: string
}

export type RecordModalTab<Data> = {
  id: string
  label: (context: RecordModalContext<Data>) => string
  visible?: (context: RecordModalContext<Data>) => boolean
  view: (context: RecordModalContext<Data>) => JSXChild
}

export type RecordModalDialog<Data> = {
  title: (context: RecordModalContext<Data>) => string
  /** Keep the parent record identity visible while completing a nested action. */
  description?: (context: RecordModalContext<Data>) => string | null
  /** ModalSheet's width: small for a short single-column form, large for a dense workspace. */
  size?: 'small' | 'default' | 'large'
  /** Only non-persistent previews may discard their own draft without confirmation. Parent drafts keep their guard. */
  discardPolicy?: 'confirm' | 'allow'
  view: (context: RecordModalContext<Data>) => JSXChild
  /** Fixed actions for this dialog layer, outside its scrolling body. */
  actions?: (context: RecordModalContext<Data>) => JSXChild
  /** A hard-to-undo decision uses the shared small centred ConfirmDialog. */
  confirmation?: {
    message: (context: RecordModalContext<Data>) => string
    label: (context: RecordModalContext<Data>) => string
    cancelLabel?: (context: RecordModalContext<Data>) => string
    form: (context: RecordModalContext<Data>) => string
    command: string
    variant?: 'primary' | 'secondary' | 'destructive'
    disabled?: (context: RecordModalContext<Data>) => boolean
  }
}

export type RecordModalDefinition<Data> = {
  kind: string
  /** Clear dependent relation drafts when their parent relation changes. */
  resetRelationsOnChange?: Readonly<Record<string, readonly string[]>>
  size?:
    | 'small'
    | 'default'
    | 'large'
    | ((context: RecordModalContext<Data>) => 'small' | 'default' | 'large')
  /**
   * Compatibility override for workflows with an explicitly sized tabbed surface.
   * By default the runtime holds the tallest rendered tab as a min-height,
   * capped by the available viewport. Single-tab and nested dialogs size to content.
   */
  fixedHeight?: string
  /**
   * A permission-checked read returning `{ data, messages }`. For a create action
   * the default input is `{}` (no id): the read returns the empty record's defaults,
   * the choices its form needs and the viewer's permissions.
   */
  context:
    | { fn: string; input?: (id: string, creating: boolean) => Record<string, unknown> }
    | { route: (id: string, creating: boolean) => string; query?: readonly string[] }
  title: (context: RecordModalContext<Data>) => string
  description?: (context: RecordModalContext<Data>) => string | null
  /**
   * What state this record is in, beside the modal's title: a badge, not a
   * strip. It stays put while the body scrolls, and a reader looking at the
   * title learns the state without reading down into the form.
   */
  status?: (context: RecordModalContext<Data>) => JSXChild
  /** A strip above the body — a customer, a summary — for what a badge cannot hold. */
  header?: (context: RecordModalContext<Data>) => JSXChild
  /**
   * A footer strip below the body, outside the scrolling area and the same on
   * every tab — the natural home for a record's primary actions (save, close,
   * more) so they stay reachable without hunting through the tab that happens
   * to hold the save button. Return `undefined` (not `''`) to render no footer
   * at all, e.g. while creating, when the create form owns its own submit.
   */
  actions?: (context: RecordModalContext<Data>) => JSXChild | undefined
  /**
   * On a record page (`createRecordPage`), the commands beside the title. A page
   * has no footer: its body scrolls with the document, so the record's own
   * commands sit in the header the way a list page's create action does.
   */
  pageActions?: (context: RecordModalContext<Data>) => JSXChild | undefined
  /** Supporting record information beside a page; ignored by modal presentation. */
  pageAside?: (context: RecordModalContext<Data>) => JSXChild | undefined
  pageAsideLabel?: (context: RecordModalContext<Data>) => string
  /**
   * Where the rail sits in reading and keyboard order (`RecordPage.asideWhenStacked`).
   * `before`, the default, leads the record with it: a rail of things to act on first.
   * `after` keeps reference facts behind the record's own fields. A wide page draws the
   * rail beside the record either way.
   */
  pageAsideWhenStacked?: 'before' | 'after'
  tabs?: readonly RecordModalTab<Data>[]
  /**
   * Tabs other modules add to this record, read from its context: they follow the
   * declared tabs, in composition order, and render through the same TabbedView.
   * A module that owns the record cannot know them when it is built.
   */
  extensionTabs?: (context: RecordModalContext<Data>) => readonly RecordModalTab<Data>[]
  /** The body of a record without tabs. */
  body?: (context: RecordModalContext<Data>) => JSXChild
  dialogs?: Record<string, RecordModalDialog<Data>>
  commands?: Record<string, RecordModalCommand<Data>>
  /**
   * Runtime labels (`recordModal.*`) in the page's language, available before the
   * record's context has loaded. Without them the loading state has only the
   * built-in English defaults, because `messages` arrive with the context.
   */
  labels?: Record<string, string> | (() => Record<string, string>)
  /**
   * Keep read contexts in memory so reopening a record shows at once and is read
   * again quietly (stale-while-revalidate). On by default; set `false` for a kind
   * whose context must never be shown before a fresh read.
   */
  cache?: boolean
  /**
   * The record changes without the reader (a background job's status). An open modal
   * of this kind reads it again when `ket:records-changed` names it, as a record page
   * does, unless a command is running or the reader typed into it. Off by default: a
   * form keeps the context it opened with.
   */
  follow?: boolean
}

/** How many record contexts one island keeps for instant reopening. */
export const RECORD_MODAL_CACHE_SIZE = 30

/**
 * English defaults for every label the runtime itself shows. A module passes its
 * own language through `labels`; these only guarantee a reader never sees a key.
 */
export const RECORD_MODAL_LABELS: Readonly<Record<string, string>> = Object.freeze({
  'recordModal.close': 'Close',
  'recordModal.loading': 'Loading…',
  'recordModal.loadFailed': 'The record could not be read.',
  'recordModal.notFound': 'The record is gone or you cannot see it.',
  'recordModal.retry': 'Retry',
  'recordModal.save': 'Save',
  'recordModal.errorTitle': 'Not saved',
  'recordModal.saveFailed': 'That did not work. Try again.',
  'recordModal.savedTitle': 'Saved',
  'recordModal.saved': 'The change is in.',
  'recordModal.unsaved': 'Discard what you typed?',
  'recordModal.unsavedDetail': 'Closing now loses what you typed here.',
  'recordModal.discard': 'Discard',
  'recordModal.keepEditing': 'Keep editing',
  'recordModal.confirm': 'Continue',
  'recordModal.back': 'Go back',
  'recordModal.deniedTitle': 'You cannot open this record',
  'recordModal.denied': 'Ask an administrator for access.',
  'recordModal.uploadFailed': 'The file could not be uploaded. Try again.',
})

/**
 * The text for a key: the loaded context's messages, then the messages of the
 * last record this modal opened, then the module's labels, then the defaults.
 * Unknown refusal codes use a friendly fallback; other unknown keys fall through to themselves.
 */
export const resolveRecordModalLabel = (
  key: string,
  sources: {
    messages?: Record<string, string> | null
    previous?: Record<string, string> | null
    labels?: Record<string, string> | null
  },
): string =>
  sources.messages?.[key] ??
  sources.previous?.[key] ??
  sources.labels?.[key] ??
  RECORD_MODAL_LABELS[key] ??
  (/^E_[A-Z_]+$/u.test(key) ? resolveRecordModalLabel('recordModal.saveFailed', sources) : key)

/**
 * The text for a refusal code. A server may refuse with any code; one no source
 * translates reads as the save failure rather than as the code itself.
 */
export const resolveRecordModalIssue = (
  code: string,
  sources: Parameters<typeof resolveRecordModalLabel>[1],
): string => {
  const text = resolveRecordModalLabel(code, sources)
  return text === code ? resolveRecordModalLabel('recordModal.saveFailed', sources) : text
}

/** Field a form (or its submitter) uses to name the command it runs. */
export const RECORD_COMMAND_FIELD = '__command'
/** Field a link or button uses to open a dialog of the same record. */
export const RECORD_DIALOG_ATTRIBUTE = 'data-record-dialog'

/** Native HelpDrawer/confirmation dialogs own their keyboard layer above record sheets. */
export const recordLayerOwnsKey = (key: string, defaultPrevented: boolean, nativeDialogOpen: boolean) =>
  !defaultPrevented && !nativeDialogOpen && (key === 'Escape' || key === 'Tab')

/** Both island hosts a page may use: the `ket-island` element and a `div` that names its island. */
export const RECORD_ISLAND_HOST = 'ket-island, div[data-ket-island]'

/** A nested island owns its native submit, including inline variant editors. */
export const recordFormOwnedByHost = (form: { closest(selector: string): unknown }, host: unknown) =>
  form.closest(RECORD_ISLAND_HOST) === host

/** A read refused for access is said so, without a retry that would only be refused again. */
export const recordReadDenied = (status: number | undefined): boolean => status === 403

/** A retained island host must receive fresh validation, draft and busy props. */
export const recordIslandChanges = (records: MutationRecord[], root: Element) => {
  const selector = RECORD_ISLAND_HOST
  const holds = (node: Node): node is Element =>
    node instanceof Element && (node.matches(selector) || node.querySelector(selector) !== null)
  const removed = new Set<Element>()
  const added = new Set<Element>()
  const updated = new Set<Element>()
  for (const record of records) {
    for (const node of record.removedNodes) if (holds(node)) removed.add(node)
    for (const node of record.addedNodes) if (holds(node) && node.isConnected) added.add(node)
    if (
      record.type === 'attributes' &&
      record.attributeName === 'data-props' &&
      record.target instanceof Element &&
      record.target !== root &&
      record.target.matches(selector) &&
      record.target.isConnected
    )
      updated.add(record.target)
  }
  return { removed, added, updated: [...updated].filter((node) => !removed.has(node) && !added.has(node)) }
}

/** Retain a write intent across an uncertain response; changed input gets a new intent. */
export const createRecordCommandIntents = (makeKey: () => string, limit = 20) => {
  const held = new Map<string, string>()
  return {
    get: (operation: string, input: Record<string, unknown>) => {
      const signature = JSON.stringify([operation, input])
      let key = held.get(signature)
      if (!key) {
        key = makeKey()
        held.set(signature, key)
        while (held.size > limit) held.delete(held.keys().next().value!)
      }
      return key
    },
    clear: () => held.clear(),
  }
}

/** A client-read page owns its tab and child decision in the URL. */
export const recordClientPageHref = (
  path: string,
  currentHref: string,
  tab: string | null,
  dialogName?: string | null,
  contextKeys: readonly string[] = [],
): string => {
  const url = new URL(recordContextRequestHref(path, currentHref, contextKeys))
  if (tab) url.searchParams.set(RECORD_TAB_PARAM, tab)
  else url.searchParams.delete(RECORD_TAB_PARAM)
  if (dialogName) url.searchParams.set('dialog', dialogName)
  else {
    url.searchParams.delete('dialog')
    url.searchParams.delete('dialogId')
  }
  return `${url.pathname}${url.search}`
}

// ── Runtime helpers ───────────────────────────────────────────────────────────

const interpolate = (text: string, params: Record<string, unknown> = {}): string =>
  text.replace(/\{([a-zA-Z0-9_]+)\}/gu, (whole, name: string) =>
    name in params ? String(params[name] ?? '') : whole,
  )

const focusable = [
  'a[href]',
  'button:not(:disabled)',
  'input:not(:disabled):not([type="hidden"])',
  'select:not(:disabled)',
  'textarea:not(:disabled)',
  '[tabindex]:not([tabindex="-1"])',
].join(', ')

const focusablesIn = (element: HTMLElement): HTMLElement[] =>
  [...element.querySelectorAll<HTMLElement>(focusable)].filter(
    (item) =>
      !item.hidden &&
      item.getAttribute('aria-hidden') !== 'true' &&
      !item.matches('[data-ui="modal-backdrop"]'),
  )

/** Whether anything in a layer was typed into since it rendered. Same rule as route modals. */
export const recordLayerHasDraft = (layer: HTMLElement): boolean => {
  if (layer.querySelector('[data-record-dirty="true"]')) return true
  for (const field of layer.querySelectorAll<HTMLInputElement>('input:not([type="hidden"])')) {
    if (field.disabled) continue
    if (field.type === 'checkbox' || field.type === 'radio') {
      if (field.checked !== field.defaultChecked) return true
    } else if (field.value !== field.defaultValue) return true
  }
  for (const area of layer.querySelectorAll<HTMLTextAreaElement>('textarea'))
    if (!area.disabled && area.value !== area.defaultValue) return true
  for (const select of layer.querySelectorAll<HTMLSelectElement>('select')) {
    if (select.disabled) continue
    for (const option of select.options) if (option.selected !== option.defaultSelected) return true
  }
  return false
}

/** Make everything outside `keep` inert, walking up to the body; returns the undo. */
const inertOutside = (keep: HTMLElement): (() => void) => {
  const changed: Array<{ element: HTMLElement; inert: boolean }> = []
  let node: HTMLElement | null = keep
  while (node && node !== document.body) {
    const parent: HTMLElement | null = node.parentElement
    if (!parent) break
    for (const sibling of parent.children)
      if (sibling instanceof HTMLElement && sibling !== node && !sibling.matches('script, style, template')) {
        changed.push({ element: sibling, inert: sibling.inert })
        sibling.inert = true
      }
    node = parent
  }
  return () => {
    for (const { element, inert } of changed) element.inert = inert
  }
}

const uuid = (): string =>
  typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`

type Status = 'idle' | 'loading' | 'ready' | 'error'

type DraftState = {
  values: Record<string, string>
  checks: Record<string, boolean>
  initialValues: Record<string, string>
  initialChecks: Record<string, boolean>
}

/** Compare against the first render, including fields on tabs no longer mounted. */
export const recordDraftHasChanges = (draft: DraftState): boolean =>
  Object.entries(draft.values).some(([key, value]) => value !== draft.initialValues[key]) ||
  Object.entries(draft.checks).some(([key, value]) => value !== draft.initialChecks[key])

/** A preview opt-out belongs to its dialog, never to the parent record. */
export const recordDiscardAccepted = (
  draft: DraftState,
  hasFile: boolean,
  policy: 'confirm' | 'allow' | undefined,
  confirm: () => boolean,
): boolean => policy === 'allow' || (!recordDraftHasChanges(draft) && !hasFile) || confirm()

/** Captured checked values belong to one named field in one draft layer. */
export const recordDraftCheckedValues = (draft: DraftState, name: string): readonly string[] => {
  const prefix = `${name}\u0000`
  return Object.entries(draft.checks)
    .filter(([key, checked]) => checked && key.startsWith(prefix))
    .map(([key]) => key.slice(prefix.length))
}

/** Cancel one inline editor without losing edits elsewhere in the record. */
export const resetRecordDraftFields = (previous: DraftState, names: readonly string[]): DraftState => {
  const omit = <T,>(values: Record<string, T>, checked = false): Record<string, T> =>
    Object.fromEntries(
      Object.entries(values).filter(([key]) => !names.includes(checked ? key.split('\u0000', 1)[0] : key)),
    )
  return {
    values: omit(previous.values),
    checks: omit(previous.checks, true),
    initialValues: omit(previous.initialValues),
    initialChecks: omit(previous.initialChecks, true),
  }
}

type DraftScope = 'record' | 'dialog'

const emptyDraftState = (): DraftState => ({ values: {}, checks: {}, initialValues: {}, initialChecks: {} })
/** A successful inline command consumes only its declared record fields. */
export const consumeRecordCommandDrafts = (previous: DraftState, names?: readonly string[]): DraftState =>
  names ? resetRecordDraftFields(previous, names) : emptyDraftState()

export const consumeRecordDialogDrafts = (previous: DraftState, retain = false): DraftState =>
  retain ? previous : emptyDraftState()

/**
 * Drop baselines no capture holds. `draft()` seeds a field's baseline from the record each
 * render reads, so the render between a command and its re-read seeds the very data that
 * command replaced; left in place, a saved field would read as edited until the page reloads.
 */
export const settleRecordDraftBaselines = (previous: DraftState): DraftState => ({
  values: previous.values,
  checks: previous.checks,
  initialValues: Object.fromEntries(
    Object.entries(previous.initialValues).filter(([key]) => key in previous.values),
  ),
  initialChecks: Object.fromEntries(
    Object.entries(previous.initialChecks).filter(([key]) => key in previous.checks),
  ),
})
const draftCheckKey = (name: string, value: string): string => `${name}\u0000${value}`

/** Name prefix of a checkbox that ticks every checkbox of its form sharing the rest of its name. */
export const CHECK_ALL = '__all:'

const after_ = <Data,>(command: RecordModalCommand<Data>) => command.after ?? 'close'

/**
 * How long a command may run before its button says so. Below this the answer
 * arrives while the reader is still lifting their finger, and a spinner shown
 * and withdrawn inside that window is noise; above it, silence would read as a
 * click that did nothing.
 */
export const BUSY_AFTER_MS = 400

/**
 * A flag that turns on late and off at once. Work that finishes inside the
 * window never raises it, so a progress indicator bound to it appears only when
 * there is progress to report, and never flashes on its way back out.
 */
export const delayedFlag = (
  show: (value: boolean) => void,
  after: number = BUSY_AFTER_MS,
): { set: (running: boolean) => void; stop: () => void } => {
  let timer: ReturnType<typeof setTimeout> | undefined
  const stop = (): void => {
    clearTimeout(timer)
    timer = undefined
  }
  return {
    set: (running) => {
      stop()
      if (!running) {
        show(false)
        return
      }
      timer = setTimeout(() => show(true), after)
    },
    stop,
  }
}

/** Controls inside a row do their own thing; the row's destination is for the rest of it. */
const rowControl = 'a, button, input, select, textarea, label, summary, details, [data-ui="select-cell"]'

/**
 * Where a click is asking to go: the link it landed on, or the row it landed
 * in. A table row carries its destination on the row itself (`rowLink: false`),
 * so the whole row is one target rather than a link around the first cell. The
 * shell would navigate such a row through the navigation layer, which fetches
 * the collection again and leaves the modal unopened, so this reads it first.
 */
export const openerHref = (element: Element | null): string | null => {
  const anchor = element?.closest<HTMLAnchorElement>('a[href]')
  if (anchor) return anchor.target && anchor.target !== '_self' ? null : anchor.href
  if (element?.closest(rowControl)) return null
  return element?.closest<HTMLElement>('[data-row-href]')?.getAttribute('data-row-href') ?? null
}

/**
 * Create the island controller for one record kind.
 *
 * The returned factory is what a module exports as its island client:
 * `export const followupModal = createRecordModal(definition)`.
 */
export type RecordRuntimeOptions = { presentation?: 'modal' | 'page' }

export const createRecordModal =
  <Data,>(definition: RecordModalDefinition<Data>, options: RecordRuntimeOptions = {}) =>
  (props: IslandProps = {}): IslandController =>
    recordController(
      definition,
      options.presentation === 'page' ? { props: props as unknown as RecordPageIslandProps } : null,
    )()

/** Where a record kind's page lives, for `createRecordPage`. */
export type RecordPageOptions = {
  /** The path of one record's page, without query: `new` names the create form. */
  path: (id: string) => string
}

/**
 * The same record, on its own page instead of in a modal over its collection.
 *
 * The definition is unchanged — context read, tabs, dialogs, commands, drafts and
 * refusals behave exactly as in the modal. What differs is presentation: the record
 * renders client-side inside a RecordPage, tabs change `?tab=` on the page's own
 * path, nothing outside it turns inert or traps focus, Close returns to the
 * collection, and a created record replaces `new` in the address with its id.
 * Nested dialogs stay modal layers over the page.
 */
export const createRecordPage =
  <Data,>(definition: RecordModalDefinition<Data>, options?: RecordPageOptions) =>
  (props: RecordPageIslandProps): IslandController =>
    recordController(definition, { ...options, props })()

/** A record form inside an existing SSR page/tab; it owns no page title or route tabs. */
export const createRecordPanel =
  <Data,>(definition: RecordModalDefinition<Data>) =>
  (props: RecordPageIslandProps): IslandController =>
    recordController(definition, {
      props,
      panel: true,
      path: () => `${location.pathname}${location.search}`,
    })()

type PageMode = Partial<RecordPageOptions> & { props: RecordPageIslandProps; panel?: boolean }

const MODAL_LAYER = '[data-ui="modal-layer"][data-client-modal="true"]'
/** Wraps the runtime's own question, which is a modal layer but never a record layer. */
const ASK_LAYER = '[data-record-ask]'
/** The value of the confirm button in the runtime's question; it submits nothing. */
export const RECORD_ASK_CONFIRM = 'record-ask-confirm'

/** The name a submitter shows, which a question about its command repeats. */
export const recordSubmitterLabel = (submitter: Element | null): string | null =>
  (
    submitter?.getAttribute('aria-label') ??
    submitter?.querySelector('[data-ui="action-label"]')?.textContent ??
    submitter?.textContent ??
    ''
  ).trim() || null

const recordController =
  <Data,>(definition: RecordModalDefinition<Data>, page: PageMode | null) =>
  (): IslandController => {
    const commandIntents = createRecordCommandIntents(uuid)
    // Pages with a path own client-read/create navigation; other pages adopt route context.
    const serverPage = Boolean(page && !page.path)
    const pageProps = serverPage ? page!.props : null
    const adopted = signal(!serverPage)
    // A page's record layer is its RecordPage; nested dialogs are modal layers in either case.
    const layerSelector = page?.panel
      ? `[data-record-layer="panel"], ${MODAL_LAYER}`
      : serverPage
        ? `[data-record-layer="page"], ${MODAL_LAYER}`
        : page
          ? `[data-ui="record-page"], ${MODAL_LAYER}`
          : MODAL_LAYER
    const hrefFor = (id: string, tab: string | null, dialogName?: string | null): string => {
      if (!page) return recordModalHref(location.href, { kind: definition.kind, id, tab, dialog: dialogName })
      if (serverPage) return `${location.pathname}${location.search}`
      const url = new URL(
        recordClientPageHref(
          page.path!(id),
          location.href,
          tab,
          dialogName,
          'route' in definition.context ? definition.context.query : [],
        ),
        location.href,
      )
      if (page.props.back) url.searchParams.set('returnTo', page.props.back)
      return `${url.pathname}${url.search}`
    }
    // A link this record answers: in a modal, one naming its kind on the same
    // collection; on a page, one to the page's own path (a tab).
    const targetOf = (url: URL): RecordModalTarget | null => {
      if (page?.panel) return null
      if (!page) {
        const target = readRecordModalTarget(url)
        return target?.kind === definition.kind ? target : null
      }
      if (serverPage || url.pathname !== location.pathname) return null
      const tab = url.searchParams.get(RECORD_TAB_PARAM)
      const current = open()
      const data = envelope()?.data
      // A tab another route serves (a server-rendered page on the same path) is a navigation.
      // The tab already open is this page's own, declared or not (a page's route may name
      // one, such as `general`, its definition has no tab for): a link to it stays here.
      if (
        tab &&
        current &&
        tab !== current.tab &&
        data !== undefined &&
        !visibleTabs(contextFor(current, data)).some((item) => item.id === tab)
      )
        return null
      return {
        kind: definition.kind,
        id: current?.id ?? page.props.id,
        tab,
        dialog: url.searchParams.get('dialog') ?? undefined,
      }
    }
    // Leave the page through the shell's own link handling, as a click on a link would.
    const leave = (): void => {
      if (!page?.props.back) return
      const link = document.createElement('a')
      link.href = page.props.back
      // The fragment navigator's response URL cannot contain a row fragment.
      // Keep anchored collection returns on the framework's native reload path.
      if (new URL(link.href).hash) link.setAttribute('data-ket-reload', '')
      link.hidden = true
      document.body.append(link)
      link.click()
      link.remove()
    }
    const open = signal<{ id: string; tab: string } | null>(null)
    const status = signal<Status>('idle')
    const envelope = signal<RecordContextEnvelope<Data> | null>(null)
    const failure = signal<string | null>(null)
    const failureStatus = signal<number | undefined>(undefined)
    const issues = signal<RecordIssue[]>([])
    const recordDrafts = signal<DraftState>(emptyDraftState())
    const dialogDrafts = signal<DraftState>(emptyDraftState())
    // `running` is the guard — one command at a time — and `busy` is what the
    // views show. They are not the same thing: a save the server answers in
    // twenty milliseconds would otherwise flash the button through its spinner
    // and back, which reads as a glitch rather than as progress. The spinner
    // waits; the guard does not.
    const running = signal(false)
    const busy = signal(false)
    const showBusy = delayedFlag((value) => busy.set(value))
    // A command that succeeded while the modal stayed open. Saving is usually
    // answered before the button could say anything, and a record that looks
    // the same afterwards leaves the reader unsure anything happened, so the
    // form says so where it would have said the opposite.
    const saved = signal(false)
    const setRunning = (value: boolean): void => {
      running.set(value)
      showBusy.set(value)
      if (value) saved.set(false)
    }
    const dialog = signal<{ name: string; params: Record<string, string> } | null>(null)
    const version = signal(0)
    const viewState = signal<Record<string, string>>({})
    const dialogViewState = signal<Record<string, string>>({})
    // What the last preview command answered. One at a time: a second preview
    // replaces the first, and anything that moves the layer clears it, so a
    // consequence is never read beside a selection it was not computed from.
    const outcome = signal<{ command: string; value: unknown } | null>(null)

    // Contexts this island has read, newest last: reopening a record (or the create
    // form) renders immediately and revalidates in place. Bounded and page-scoped;
    // a successful command or `ket:records-changed` for this kind drops the entries.
    const cache = new Map<string, RecordContextEnvelope<Data>>()
    const remember = (id: string, value: RecordContextEnvelope<Data>): void => {
      cache.delete(id)
      cache.set(id, value)
      while (cache.size > RECORD_MODAL_CACHE_SIZE) cache.delete(cache.keys().next().value as string)
    }

    // A record page is open from the start, on the record its route named.
    if (pageProps) {
      open.set({ id: String(pageProps.id), tab: '' })
      if (pageProps.envelope) {
        envelope.set(pageProps.envelope as RecordContextEnvelope<Data>)
        status.set('ready')
      }
    }

    let root: HTMLElement | null = null
    let request: AbortController | null = null
    let pushed = false
    let pendingHistoryClose: string | null = null
    let returnFocus: HTMLElement | null = null
    let dialogReturnFocus: HTMLElement | null = null
    let releaseInert: (() => void) | null = null

    // The question asked before discarding input or running a command that asks first,
    // in the shared ConfirmDialog. One at a time; answering settles what `ask` returned.
    type Question = {
      title: string
      message: string
      confirmLabel: string
      cancelLabel: string
      variant: ActionVariant
      settle: (accepted: boolean) => void
    }
    const asking = signal<Question | null>(null)

    // Messages of the last record this modal loaded: opening the next record clears
    // the envelope, and its loading state still needs words rather than keys.
    let previousMessages: Record<string, string> | null = null
    const labels = (): Record<string, string> =>
      typeof definition.labels === 'function' ? definition.labels() : (definition.labels ?? {})
    const sources = () => ({ messages: envelope()?.messages, previous: previousMessages, labels: labels() })
    const t = (key: string, params?: Record<string, unknown>): string =>
      interpolate(resolveRecordModalLabel(key, sources()), params)
    const issueText = (issue: RecordIssue): string =>
      issue.message ??
      interpolate(resolveRecordModalIssue(issue.messageKey ?? issue.code, sources()), issue.params)
    const visibleTabs = (context: RecordModalContext<Data>) =>
      [...(definition.tabs ?? []), ...(definition.extensionTabs?.(context) ?? [])].filter(
        (tab) => tab.visible?.(context) ?? true,
      )

    const contextFor = (
      current: { id: string; tab: string },
      data: Data,
      scope: DraftScope = 'record',
    ): RecordModalContext<Data> => {
      const draftState = (): DraftState => (scope === 'dialog' ? dialogDrafts() : recordDrafts())
      const base: RecordModalContext<Data> = {
        kind: definition.kind,
        id: current.id,
        creating: current.id === RECORD_NEW_ID,
        tab: current.tab,
        data,
        t,
        fieldError: (name) => {
          const hit = issues().find((issue) => issue.field === name)
          return hit ? issueText(hit) : null
        },
        draft: (name, fallback = '') => {
          const draft = draftState()
          draft.initialValues[name] ??= fallback
          return draft.values[name] ?? fallback
        },
        recordDraft: (name, fallback = '') => recordDrafts().values[name] ?? fallback,
        recordChanged: recordDraftHasChanges(recordDrafts()),
        draftScope: scope,
        draftCheckedValues: (name) => recordDraftCheckedValues(draftState(), name),
        draftChecked: (name, value = '1', fallback = false) => {
          const draft = draftState()
          const key = draftCheckKey(name, value)
          draft.initialChecks[key] ??= fallback
          return draft.checks[key] ?? fallback
        },
        outcome: <T,>(command: string) => {
          const held = outcome()
          return held?.command === command ? (held.value as T) : null
        },
        busy: busy(),
        dialog: dialog(),
        href: (tab) => hrefFor(current.id, tab),
        presentation: page ? 'page' : 'modal',
        state: (key, fallback = '') =>
          (scope === 'dialog' ? dialogViewState()[key] : undefined) ?? viewState()[key] ?? fallback,
      }
      const tabs = visibleTabs(base)
      if (tabs.length && !tabs.some((tab) => tab.id === current.tab)) base.tab = tabs[0]!.id
      return base
    }

    let pendingEntryDialog: string | null = null
    // A record read again replaces the baselines of fields nobody captured, in the same
    // render, so `draft()` seeds them from what was read now.
    const adopt = (next: RecordContextEnvelope<Data>): void =>
      batch(() => {
        envelope.set(next)
        recordDrafts.set(settleRecordDraftBaselines(recordDrafts()))
        dialogDrafts.set(settleRecordDraftBaselines(dialogDrafts()))
      })
    const load = async (id: string, quiet = false): Promise<void> => {
      request?.abort()
      const controller = new AbortController()
      request = controller
      // A record opened before shows at once from the in-memory cache and is read
      // again quietly behind it; the reader never waits on a frame they have seen.
      const cached = definition.cache === false ? undefined : cache.get(id)
      if (cached) {
        previousMessages = cached.messages ?? previousMessages
        adopt(cached)
        status.set('ready')
        quiet = true
      }
      if (!quiet) status.set('loading')
      failure.set(null)
      failureStatus.set(undefined)
      try {
        const creating = id === RECORD_NEW_ID
        const result =
          'route' in definition.context
            ? await readRecordContextRoute<RecordContextEnvelope<Data>>(
                definition.context.route(id, creating),
                controller.signal,
                definition.context.query,
              )
            : await callRecordFunction<RecordContextEnvelope<Data> | null>(
                definition.context.fn,
                definition.context.input ? definition.context.input(id, creating) : creating ? {} : { id },
                { signal: controller.signal },
              )
        if (controller.signal.aborted) return
        if (!result.ok || !result.value) {
          const denied = !result.ok && recordReadDenied(result.status)
          failure.set(
            result.ok
              ? 'recordModal.notFound'
              : (result.message ?? (denied ? 'recordModal.denied' : 'recordModal.loadFailed')),
          )
          failureStatus.set(result.ok ? undefined : result.status)
          status.set('error')
          return
        }
        previousMessages = result.value.messages ?? previousMessages
        if (definition.cache !== false) remember(id, result.value)
        adopt(result.value)
        status.set('ready')
        if (pendingEntryDialog && definition.dialogs?.[pendingEntryDialog]) {
          dialog.set({
            name: pendingEntryDialog,
            params: new URL(location.href).searchParams.has('dialogId')
              ? { id: new URL(location.href).searchParams.get('dialogId')! }
              : {},
          })
          afterRender()
        }
        pendingEntryDialog = null
      } catch (caught) {
        if (controller.signal.aborted || (caught as Error)?.name === 'AbortError') return
        failure.set('recordModal.loadFailed')
        status.set('error')
      }
    }

    const layers = (): HTMLElement[] =>
      root
        ? [...root.querySelectorAll<HTMLElement>(layerSelector)].filter((layer) => !layer.closest(ASK_LAYER))
        : []
    const recordLayer = (): HTMLElement | null => layers()[0] ?? null
    const topLayer = (): HTMLElement | null => layers().at(-1) ?? null

    // Hold only the height actually seen for this record, never the viewport height.
    let tallestRecordHeight = 0
    const fitRecordHeight = (): void => {
      if (definition.fixedHeight || status() !== 'ready') return
      const sheet = recordLayer()?.querySelector<HTMLElement>('[data-ui="modal-sheet"][data-height="fixed"]')
      if (!sheet) return
      // Match ModalSheet's compact contract: mobile dialogs occupy the screen.
      // Do not retain that viewport height as a desktop content measurement.
      if (window.matchMedia('(max-width: 47.9375rem)').matches) {
        sheet.style.setProperty('height', '100dvh', 'important')
        sheet.style.removeProperty('min-height')
        return
      }
      const tabs = sheet.querySelector<HTMLElement>('[data-ui="tabbed-view"]')
      if (!tabs) return
      const panel = tabs.querySelector<HTMLElement>('[data-ui="tab-panel"]')
      const scrollTop = panel?.scrollTop ?? 0
      sheet.style.setProperty('height', 'auto', 'important')
      sheet.style.setProperty('min-height', '0')
      tabs.style.setProperty('height', 'auto')
      tallestRecordHeight = Math.max(tallestRecordHeight, Math.ceil(sheet.getBoundingClientRect().height))
      tabs.style.removeProperty('height')
      const cap = getComputedStyle(sheet).maxHeight
      sheet.style.setProperty(
        'min-height',
        cap === 'none' ? `${tallestRecordHeight}px` : `min(${tallestRecordHeight}px, ${cap})`,
      )
      if (panel) panel.scrollTop = scrollTop
    }

    const keepDrafts = (current: HTMLElement | null, scope: DraftScope): void => {
      if (!current) return
      const previous = scope === 'dialog' ? dialogDrafts() : recordDrafts()
      const kept: DraftState = {
        values: { ...previous.values },
        checks: { ...previous.checks },
        initialValues: { ...previous.initialValues },
        initialChecks: { ...previous.initialChecks },
      }
      for (const control of current.querySelectorAll<
        HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement
      >('input[name], select[name], textarea[name]')) {
        if (control.disabled || !control.name || control.name === RECORD_COMMAND_FIELD) continue
        if (control instanceof HTMLInputElement) {
          // DateTimePicker progressively hides its canonical named field. Its
          // unnamed day/time inputs are helpers, not separate draft fields.
          const picker = control.closest('[data-ui="date-time-picker"]')
          if (picker && control.matches('[data-ui="field-control"]')) {
            const day = picker.querySelector<HTMLInputElement>('input[type="date"]')
            const time = picker.querySelector<HTMLInputElement>('input[type="time"]')
            kept.initialValues[control.name] ??=
              day && time
                ? day.defaultValue || time.defaultValue
                  ? `${day.defaultValue}T${time.defaultValue}`
                  : ''
                : control.defaultValue
            kept.values[control.name] = control.value
            continue
          }
          if (control.type === 'file' || control.type === 'hidden') continue
          if (control.type === 'checkbox' || control.type === 'radio') {
            const key = draftCheckKey(control.name, control.value)
            kept.initialChecks[key] ??= control.defaultChecked
            kept.checks[key] = control.checked
            // Keep checkbox/radio values available to draft(), but compare these
            // groups by checked state: several controls may share one name.
            if (control.type === 'checkbox') kept.values[control.name] = control.checked ? control.value : ''
            else if (control.checked) kept.values[control.name] = control.value
            kept.initialValues[control.name] = kept.values[control.name] ?? ''
            continue
          }
        }
        kept.initialValues[control.name] ??=
          control instanceof HTMLSelectElement
            ? ([...control.options].find((option) => option.defaultSelected)?.value ??
              control.options[0]?.value ??
              '')
            : control.defaultValue
        kept.values[control.name] = control.value
      }
      if (scope === 'dialog') dialogDrafts.set(kept)
      else recordDrafts.set(kept)
    }

    const keepAllDrafts = (): void => {
      const currentLayers = layers()
      keepDrafts(currentLayers[0] ?? null, 'record')
      if (currentLayers.length > 1) keepDrafts(currentLayers.at(-1) ?? null, 'dialog')
    }

    const ask = (question: Omit<Question, 'settle'>): Promise<boolean> => {
      if (asking()) return Promise.resolve(false)
      const trigger = document.activeElement instanceof HTMLElement ? document.activeElement : null
      // Everything under the question is out of reach until it is answered.
      const beneath = layers()
      const wasInert = beneath.map((layer) => layer.inert)
      const releaseOutside = page && !releaseInert && root ? inertOutside(root) : null
      return new Promise((resolve) => {
        const asked: Question = {
          ...question,
          settle: (accepted) => {
            if (asking() !== asked) return
            asking.set(null)
            beneath.forEach((layer, index) => {
              layer.inert = wasInert[index] ?? false
            })
            releaseOutside?.()
            // Declining returns to where the question was asked; accepting lets the caller move on.
            if (!accepted && trigger?.isConnected) requestAnimationFrame(() => trigger.focus())
            resolve(accepted)
          },
        }
        asking.set(asked)
        requestAnimationFrame(() => {
          if (asking() !== asked) return
          for (const layer of beneath) layer.inert = true
          // The safe answer has focus: Enter on an unread question keeps what is there.
          root?.querySelector<HTMLElement>(`${ASK_LAYER} [data-client-modal-close] button`)?.focus()
        })
      })
    }

    const mayDiscard = async (current: HTMLElement | null): Promise<boolean> => {
      if (!current) return true
      const scope = dialog() && current === topLayer() ? 'dialog' : 'record'
      keepDrafts(current, scope)
      const draft = scope === 'dialog' ? dialogDrafts() : recordDrafts()
      const hasFile = [...current.querySelectorAll<HTMLInputElement>('input[type="file"]')].some(
        (field) => !field.disabled && Boolean(field.files?.length),
      )
      const policy = scope === 'dialog' ? definition.dialogs?.[dialog()!.name]?.discardPolicy : undefined
      if (recordDiscardAccepted(draft, hasFile, policy, () => false)) return true
      return ask({
        title: t('recordModal.unsaved'),
        message: t('recordModal.unsavedDetail'),
        confirmLabel: t('recordModal.discard'),
        cancelLabel: t('recordModal.keepEditing'),
        variant: 'destructive',
      })
    }

    const afterRender = (preferred?: () => HTMLElement | null): void => {
      requestAnimationFrame(() => {
        const currentLayers = layers()
        const record = currentLayers[0]
        const top = currentLayers.at(-1)
        if (!top) return
        if (record) record.inert = currentLayers.length > 1
        if (page) {
          // A page is not a modal: only a dialog over it fences off the rest of the
          // document, and closing the last dialog hands the page back untouched.
          if (currentLayers.length > 1) {
            if (root && !releaseInert) releaseInert = inertOutside(root)
          } else {
            releaseInert?.()
            releaseInert = null
            const target = preferred?.()
            if (target?.isConnected) target.focus()
            return
          }
        }
        const target = preferred?.()
        if (target?.isConnected && top.contains(target)) {
          target.focus()
          return
        }
        if (top.contains(document.activeElement)) return
        const sheet = top.querySelector<HTMLElement>('[data-ui="modal-sheet"]')
        const first = focusablesIn(top).find((item) => !item.matches('[data-ui="modal-close"]'))
        ;(first ?? sheet)?.focus()
      })
    }

    const show = (
      id: string,
      tab: string | null,
      how: 'push' | 'replace' | 'none',
      preferredFocus?: () => HTMLElement | null,
      entryDialog?: string | null,
      /** The opened dialog's parameters, read from the link that named it. */
      entryParams?: Record<string, string>,
      opener?: HTMLElement | null,
    ): void => {
      const current = open()
      const sameRecord = current?.id === id
      const nextTab = tab ?? (sameRecord ? current.tab : '')
      if (!sameRecord) {
        tallestRecordHeight = 0
        pendingEntryDialog = entryDialog ?? null
        returnFocus =
          opener ?? (document.activeElement instanceof HTMLElement ? document.activeElement : null)
        // Signals render synchronously. Remove the previous record before clearing
        // drafts, or its fields seed the new record's initial values again.
        envelope.set(null)
        issues.set([])
        saved.set(false)
        recordDrafts.set(emptyDraftState())
        dialogDrafts.set(emptyDraftState())
        dialogViewState.set({})
        viewState.set({})
        outcome.set(null)
        dialog.set(null)
        dialogReturnFocus = null
        void load(id)
      }
      if (sameRecord && entryDialog && definition.dialogs?.[entryDialog]) {
        keepAllDrafts()
        dialogDrafts.set(emptyDraftState())
        dialogViewState.set({})
        // As from a dialog button: the last command's answer is not this dialog's.
        issues.set([])
        outcome.set(null)
        saved.set(false)
        dialog.set({
          name: entryDialog,
          params:
            entryParams ??
            (new URL(location.href).searchParams.has('dialogId')
              ? { id: new URL(location.href).searchParams.get('dialogId')! }
              : {}),
        })
      }
      open.set({ id, tab: nextTab })
      const entryHref = new URL(hrefFor(id, nextTab || null, entryDialog), location.href)
      if (entryDialog && entryParams?.id) entryHref.searchParams.set('dialogId', entryParams.id)
      const href = `${entryHref.pathname}${entryHref.search}`
      if (how === 'push') {
        // The shell's own navigation snapshots scroll onto the entry it leaves
        // before pushing (`saveScroll` in packages/ketjs/src/server/http.ts) so
        // going back restores it; this push must do the same, or closing the
        // modal later restores no scroll and the page it sits over jumps to top.
        history.replaceState(
          { ...(history.state ?? {}), __ketScroll: [window.scrollX, window.scrollY] },
          '',
          location.href,
        )
        history.pushState({ ...(history.state ?? {}), __ketRecordModal: definition.kind }, '', href)
        pushed = true
      } else if (how === 'replace') history.replaceState(history.state ?? {}, '', href)
      if (page) {
        // A page is not a layer: the reader keeps their place, nothing else turns inert.
        if (preferredFocus) afterRender(preferredFocus)
        return
      }
      if (root && !releaseInert) releaseInert = inertOutside(root)
      afterRender(preferredFocus)
    }

    const hide = (how: 'history' | 'replace' | 'none', afterHidden?: () => void): void => {
      // Closing a page is leaving it, for the collection it came from.
      if (page && how !== 'none') {
        leave()
        return
      }
      const target = returnFocus
      const href = target?.closest<HTMLAnchorElement>('a[href]')?.href
      const restoreFocus = () =>
        requestAnimationFrame(() => {
          const current = target?.isConnected
            ? target
            : href
              ? [...document.querySelectorAll<HTMLAnchorElement>('a[href]')].find(
                  (link) => link.href === href,
                )
              : null
          current?.focus()
        })
      const done = () => {
        afterHidden?.()
        restoreFocus()
      }
      const back = how === 'history' && pushed
      // Set the closed address before disposal can trigger a shell/island reconciliation.
      if (!back && how !== 'none')
        history.replaceState(history.state ?? {}, '', recordModalClosedHref(location.href))
      request?.abort()
      open.set(null)
      tallestRecordHeight = 0
      dialog.set(null)
      issues.set([])
      saved.set(false)
      recordDrafts.set(emptyDraftState())
      dialogDrafts.set(emptyDraftState())
      dialogViewState.set({})
      viewState.set({})
      outcome.set(null)
      status.set('idle')
      envelope.set(null)
      releaseInert?.()
      releaseInert = null
      pushed = false
      if (back) {
        pendingHistoryClose = recordModalClosedHref(location.href)
        window.addEventListener('popstate', done, { once: true })
        history.back()
      } else done()
      returnFocus = null
      dialogReturnFocus = null
    }

    const close = async (): Promise<void> => {
      // A question already on screen is answered first; Escape or a second click does not stack another.
      if (asking()) return
      const opened = dialog()
      if (opened) {
        if (!(await mayDiscard(topLayer())) || dialog() !== opened) return
        const target = dialogReturnFocus
        dialogReturnFocus = null
        dialog.set(null)
        const current = open()
        if (current && !serverPage)
          history.replaceState(history.state ?? {}, '', hrefFor(current.id, current.tab || null))
        dialogDrafts.set(emptyDraftState())
        dialogViewState.set({})
        issues.set([])
        outcome.set(null)
        afterRender(() => (target?.isConnected ? target : null))
        return
      }
      // Route-context pages stay open; client-read pages return through their back action.
      if (serverPage) return
      const current = open()
      if (!(await mayDiscard(recordLayer())) || open() !== current) return
      hide('history')
    }

    const run = async (name: string, form: HTMLFormElement, submitter: HTMLElement | null): Promise<void> => {
      const command = definition.commands?.[name]
      const current = open()
      const data = envelope()?.data
      if (!command || !current || data === undefined || running()) return
      const formData = new FormData(form, submitter instanceof HTMLButtonElement ? submitter : null)
      const currentLayer = form.closest<HTMLElement>(layerSelector)
      const scope: DraftScope = dialog() && currentLayer === topLayer() ? 'dialog' : 'record'
      keepDrafts(currentLayer, scope)
      const context = contextFor(current, data, scope)
      const question = command.confirm?.(context)
      if (question) {
        // The question repeats the command's own name, so the answer reads as the act itself.
        const label = recordSubmitterLabel(submitter) ?? t('recordModal.confirm')
        const accepted = await ask({
          title: label,
          message: question,
          confirmLabel: label,
          cancelLabel: t('recordModal.back'),
          variant:
            submitter instanceof HTMLElement && submitter.dataset.variant === 'destructive'
              ? 'destructive'
              : 'primary',
        })
        if (!accepted || open() !== current || running()) return
      }
      setRunning(true)
      issues.set([])
      try {
        const uploads: RecordUploads = {}
        for (const [field, target] of Object.entries(command.upload ?? {})) {
          const file = formData.get(field)
          if (!(file instanceof File) || file.size === 0) continue
          const body = new FormData()
          for (const [key, value] of Object.entries(target(formData, context))) body.append(key, value)
          body.append('file', file, file.name)
          const response = await fetch('/files', { method: 'POST', credentials: 'same-origin', body })
          const stored = (await response.json().catch(() => null)) as {
            id?: unknown
            name?: unknown
            message?: unknown
          } | null
          if (!response.ok || !stored?.id) {
            issues.set([
              {
                field: null,
                code: 'recordModal.uploadFailed',
                message: typeof stored?.message === 'string' ? stored.message : null,
                params: {},
              },
            ])
            return
          }
          uploads[field] = {
            id: String(stored.id),
            name: typeof stored.name === 'string' ? stored.name : null,
          }
        }
        // A preview reads and never writes, so the function behind it is not declared
        // idempotent and the server refuses a key on it.
        const intent = (operation: string, input: Record<string, unknown>) =>
          command.preview ? undefined : commandIntents.get(operation, input)
        const invoke = (fn: string, input: Record<string, unknown>) =>
          callRecordFunction(fn, input, { idempotencyKey: intent(fn, input) })
        const primaryInput = command.input(formData, context, uploads)
        let result = command.route
          ? await callRecordRoute(command.route, primaryInput, {
              idempotencyKey: intent(command.route, primaryInput),
            })
          : await invoke(command.fn!, primaryInput)
        // Further calls run only once the first succeeds, and stop at the first
        // one that does not — a later step's success never papers over an
        // earlier failure.
        for (const step of result.ok ? (command.also ?? []) : []) {
          if (step.when && !step.when(context, formData)) continue
          result = await invoke(step.fn, step.input(formData, context, uploads))
          if (!result.ok) break
        }
        if (!result.ok) {
          // The layer was snapshotted before the busy state rendered, including unchecked controls.
          // A refused submit leaves an answer that was computed from something else.
          outcome.set(null)
          issues.set(
            result.issues.length
              ? result.issues.map((issue) => ({
                  ...issue,
                  field:
                    issue.field && command.issueField
                      ? command.issueField(issue.field, formData, context)
                      : issue.field,
                }))
              : [
                  {
                    field: null,
                    code: result.message ?? 'recordModal.saveFailed',
                    message: result.message,
                    params: {},
                  },
                ],
          )
          // Hidden stamps are never drafts, so the quiet re-read replaces them while typed values stay.
          if (command.refreshOnRefusal) await load(current.id, true)
          afterRender(() => topLayer()?.querySelector<HTMLElement>('[aria-invalid="true"]') ?? null)
          return
        }
        if (command.preview) {
          // Nothing changed, so nothing is dropped, re-read or announced — and the
          // drafts snapshotted before this submit stay, so the selection is still on
          // screen beside the answer it produced.
          outcome.set({ command: name, value: result.value })
          version.set(version() + 1)
          return
        }
        commandIntents.clear()
        if (scope === 'dialog') {
          dialogDrafts.set(consumeRecordDialogDrafts(dialogDrafts(), command.retainDialogDraft === true))
          if (!command.retainDialogDraft) dialogViewState.set({})
        } else recordDrafts.set(consumeRecordCommandDrafts(recordDrafts(), command.clearRecordDrafts))
        if (scope === 'dialog' && command.clearRecordDrafts?.length)
          recordDrafts.set(resetRecordDraftFields(recordDrafts(), command.clearRecordDrafts))
        // A command that stays in its layer leaves its answer for the view, which is
        // how something the server can only say once — a one-time credential — reaches
        // the reader. Every other `after` replaces the layer, so the answer goes.
        outcome.set(after_(command) === 'stay' ? { command: name, value: result.value } : null)
        if (!(scope === 'dialog' && command.retainDialogDraft)) form.reset()
        const value = result.value as { id?: unknown } | null | undefined
        const createdId =
          after_(command) === 'open'
            ? (command.created?.(result.value) ??
              (value && typeof value === 'object' && value.id != null ? String(value.id) : null))
            : null
        // What the command changed is no longer what the cache holds.
        cache.delete(current.id)
        if (createdId) cache.delete(createdId)
        const announce = (closing = false): void => {
          document.dispatchEvent(
            new CustomEvent('ket:records-changed', {
              // A collection island that reads itself again cancels the event, and
              // the shell leaves the content slot alone (table-selection-view.tsx).
              cancelable: true,
              // `page`: no collection sits behind a record page, so the shell
              // has nothing to refresh; the page re-reads its own context.
              // `href`: a closing modal still names its record in the address bar, which
              // it leaves only after this event; the collection is read without it.
              detail: {
                kind: definition.kind,
                ids: [createdId ?? current.id],
                ...(page ? { page: true } : {}),
                ...(closing
                  ? { href: new URL(recordModalClosedHref(location.href), location.href).href }
                  : {}),
              },
            }),
          )
        }
        if (command.navigate) {
          const destination = new URL(command.navigate(result.value, context), location.href)
          if (destination.origin !== location.origin)
            throw new Error('Record navigation must stay same-origin')
          if (!page) hide('none')
          location.assign(destination.href)
          return
        }
        // A route-context page never closes or switches tab: what would close the modal closes the
        // dialog that ran the command and reads the record again in place.
        const declared = after_(command)
        const after: ReturnType<typeof after_> =
          serverPage &&
          (declared === 'close' ||
            declared === 'reload' ||
            declared === 'open' ||
            (typeof declared === 'object' && 'tab' in declared))
            ? { dialog: null }
            : declared
        // A modal that closes says so by closing; one that stays owes an answer. A
        // page whose dialog closed shows the change itself, read again in place.
        if (
          after !== 'close' &&
          after === declared &&
          !(scope === 'dialog' && command.retainDialogDraft) &&
          command.showsOutcome !== true
        )
          saved.set(true)
        if (after === 'open') {
          dialog.set(null)
          dialogDrafts.set(emptyDraftState())
          dialogViewState.set({})
          // Replace `:new` in the address bar before the collection refreshes: the
          // shell re-fetches `location.href`, which must already name the new record.
          if (createdId) {
            show(createdId, command.openTab ?? null, 'replace')
            if (createdId === current.id) await load(createdId)
          } else hide('history')
          announce()
          return
        }
        if (after === 'close') {
          hide('history', () => announce(true))
          return
        }
        announce()
        if (after === 'reload') {
          const target = dialogReturnFocus
          dialogReturnFocus = null
          dialog.set(null)
          dialogDrafts.set(emptyDraftState())
          dialogViewState.set({})
          history.replaceState(history.state ?? {}, '', hrefFor(current.id, current.tab || null))
          await load(current.id)
          afterRender(() => (target?.isConnected ? target : null))
        } else if (after === 'refresh') await load(current.id, true)
        else if (after === 'stay') version.set(version() + 1)
        else if ('tab' in after) {
          dialogReturnFocus = null
          dialog.set(null)
          dialogDrafts.set(emptyDraftState())
          dialogViewState.set({})
          show(current.id, after.tab, 'replace')
          await load(current.id)
        } else {
          const target = after.dialog ? null : dialogReturnFocus
          dialogReturnFocus = after.dialog && submitter instanceof HTMLElement ? submitter : null
          dialog.set(after.dialog ? { name: after.dialog, params: {} } : null)
          dialogDrafts.set(emptyDraftState())
          dialogViewState.set({})
          await load(current.id, true)
          afterRender(() => (target?.isConnected ? target : null))
        }
      } catch {
        issues.set([{ field: null, code: 'recordModal.saveFailed', message: null, params: {} }])
      } finally {
        setRunning(false)
      }
    }

    const formIssues = (context: RecordModalContext<Data>): JSXChild => {
      const general = issues().filter((issue) => !issue.field)
      const fieldless = issues().filter(
        (issue) => issue.field && !root?.querySelector(`[name="${CSS.escape(issue.field)}"]`),
      )
      const all = [...general, ...fieldless]
      if (!all.length)
        return saved()
          ? Notice({
              title: context.t('recordModal.savedTitle'),
              message: context.t('recordModal.saved'),
              tone: 'positive',
            })
          : ''
      return Notice({
        title: context.t('recordModal.errorTitle'),
        message: all.map(issueText).join(' · '),
        tone: 'danger',
      })
    }

    const recordBody = (): TemplateResult | string => {
      const current = open()
      if (!current) return ''
      // A refused read says why and offers nothing to retry; another failure may pass next time.
      if (status() === 'error' && recordReadDenied(failureStatus()))
        return Notice({
          title: t('recordModal.deniedTitle'),
          message: t(failure() ?? 'recordModal.denied'),
          tone: 'warning',
        })
      if (status() === 'error')
        return (
          <>
            {Notice({
              title: t('recordModal.loadFailed'),
              message: t(failure() ?? 'recordModal.loadFailed'),
              tone: 'danger',
            })}
            {Button({ label: t('recordModal.retry'), variant: 'secondary', name: 'intent', value: 'retry' })}
          </>
        )
      const data = envelope()?.data
      if (status() !== 'ready' || data === undefined) return LoadingState({ label: t('recordModal.loading') })
      const context = contextFor(current, data)
      const tabs = visibleTabs(context)
      const active = tabs.find((tab) => tab.id === context.tab)
      const header = definition.header?.(context) ?? ''
      const issueNotice = formIssues(context)
      const body = active ? active.view(context) : (definition.body?.(context) ?? '')
      if (tabs.length)
        return TabbedView({
          id: `record-view-${definition.kind.replaceAll('.', '-')}`,
          label: definition.title(context),
          items: tabs.map((tab) => ({
            id: tab.id,
            label: tab.label(context),
            href: context.href(tab.id),
            active: tab.id === context.tab,
          })),
          context:
            header !== '' || issueNotice !== '' ? (
              <>
                {header}
                {issueNotice}
              </>
            ) : undefined,
          body,
        })
      // The stack owns the gap under a header or notice. Each part keeps its position
      // (an empty one renders nothing), so a refusal's notice never rebuilds the form.
      return Stack({ items: [header || null, issueNotice || null, body || null] })
    }

    // A refused read is titled as such; any other failure could not load.
    const failureTitle = (): string =>
      t(recordReadDenied(failureStatus()) ? 'recordModal.deniedTitle' : 'recordModal.loadFailed')

    const askLayer = (): TemplateResult | string => {
      const question = asking()
      if (!question) return ''
      return (
        <div data-record-ask>
          {ConfirmDialog({
            id: `record-ask-${definition.kind.replaceAll('.', '-')}`,
            mode: 'client',
            size: 'small',
            title: question.title,
            message: question.message,
            closeHref: '#',
            closeLabel: question.cancelLabel,
            confirmLabel: question.confirmLabel,
            confirmValue: RECORD_ASK_CONFIRM,
            confirmVariant: question.variant,
          })}
        </div>
      )
    }

    const dialogLayer = (): TemplateResult | string => {
      const current = open()
      const opened = dialog()
      const data = envelope()?.data
      if (!current || !opened || data === undefined) return ''
      const spec = definition.dialogs?.[opened.name]
      if (!spec) return ''
      const context = contextFor(current, data, 'dialog')
      if (spec.confirmation) {
        const decision = spec.confirmation
        return ConfirmDialog({
          id: `record-dialog-${definition.kind.replaceAll('.', '-')}-${opened.name}`,
          mode: 'client',
          size: 'small',
          title: spec.title(context),
          closeHref: '#',
          closeLabel: decision.cancelLabel?.(context) ?? t('recordModal.close'),
          message: decision.message(context),
          confirmLabel: decision.label(context),
          confirmForm: decision.form(context),
          confirmName: RECORD_COMMAND_FIELD,
          confirmValue: decision.command,
          confirmVariant: decision.variant,
          confirmDisabled: decision.disabled?.(context) ?? false,
          details: Stack({ items: [formIssues(context) || null, spec.view(context) || null] }),
        })
      }
      return ModalSheet({
        id: `record-dialog-${definition.kind.replaceAll('.', '-')}-${opened.name}`,
        mode: 'client',
        presentation: 'dialog',
        size: spec.size ?? 'default',
        title: spec.title(context),
        description: spec.description?.(context),
        actions: spec.actions?.(context),
        closeLabel: t('recordModal.close'),
        body: Stack({ items: [formIssues(context) || null, spec.view(context) || null] }),
      })
    }

    // The record as the page itself: the trail back to its collection, its
    // identity and commands, then the body. Dialogs still open over it.
    const serverPageView = (): TemplateResult => {
      if (!adopted()) return recordPageShell(pageProps!)
      const current = open()!
      const data = envelope()?.data
      const context = data === undefined ? null : contextFor(current, data)
      const title = context
        ? definition.title(context)
        : status() === 'error'
          ? failureTitle()
          : pageProps!.title
      return (
        <>
          {recordPageFrame({
            title,
            trail: pageProps!.trail,
            trailLabel: pageProps!.trailLabel,
            meta: context ? (definition.description?.(context) ?? undefined) : undefined,
            status: context ? definition.status?.(context) : undefined,
            actions: context ? definition.pageActions?.(context) : undefined,
            aside: context ? definition.pageAside?.(context) : undefined,
            asideLabel: context ? definition.pageAsideLabel?.(context) : undefined,
            asideWhenStacked: definition.pageAsideWhenStacked,
            body: recordBody(),
          })}
          {dialogLayer()}
          {askLayer()}
        </>
      )
    }

    const pageView = (mode: PageMode): TemplateResult => {
      if (serverPage) return serverPageView()
      const current = open()
      const data = envelope()?.data
      const context = current && data !== undefined ? contextFor(current, data) : null
      if (mode.panel) {
        if (!current || (status() !== 'error' && !context)) return recordPanelLoading(mode.props)
        return (
          <>
            {recordPanelFrame({
              actions: context
                ? (definition.pageActions?.(context) ?? definition.actions?.(context))
                : undefined,
              body: recordBody(),
              aside: context ? definition.pageAside?.(context) : undefined,
            })}
            {dialogLayer()}
            {askLayer()}
          </>
        )
      }
      // Until the record has loaded, the page is exactly what the server rendered.
      if (!current || (status() !== 'error' && !context)) return recordPageLoading(mode.props)
      const size =
        typeof definition.size === 'function'
          ? context
            ? definition.size(context)
            : 'default'
          : (definition.size ?? 'default')
      const title = context ? definition.title(context) : failureTitle()
      // The document title follows the record, as a server-rendered page's would:
      // a created record replaces `new`, a rename shows after saving.
      if (context && document.title !== title) queueMicrotask(() => (document.title = title))
      return (
        <>
          {RecordPage({
            variant: 'operational',
            width: size === 'large' ? 'wide' : 'default',
            context: recordPageTrail(mode.props.trail, mode.props.trailLabel ?? mode.props.title),
            title,
            status: context ? definition.status?.(context) : undefined,
            actions: context
              ? (definition.pageActions?.(context) ?? definition.actions?.(context))
              : undefined,
            aside: context ? definition.pageAside?.(context) : undefined,
            asideLabel: context ? definition.pageAsideLabel?.(context) : undefined,
            asideWhenStacked: definition.pageAsideWhenStacked ?? 'before',
            body: recordBody(),
          })}
          {dialogLayer()}
          {askLayer()}
        </>
      )
    }

    return {
      view: () => {
        version()
        if (page) return pageView(page)
        const current = open()
        if (!current) return recordModalHost(definition.kind)
        const data = envelope()?.data
        const context = data === undefined ? null : contextFor(current, data)
        return (
          <>
            {recordModalHost(definition.kind)}
            {ModalSheet({
              id: `record-modal-${definition.kind.replaceAll('.', '-')}`,
              mode: 'client',
              presentation: 'dialog',
              size:
                typeof definition.size === 'function'
                  ? context
                    ? definition.size(context)
                    : 'default'
                  : (definition.size ?? 'default'),
              // The runtime measures rendered tabs and holds their largest height.
              // Start at natural height so loading/short records never fill the viewport.
              height:
                (definition.tabs?.length ?? 0) + (definition.extensionTabs ? 1 : 0) > 1 ? 'fixed' : 'content',
              fixedHeight: definition.fixedHeight ?? 'auto',
              title: context
                ? definition.title(context)
                : status() === 'error'
                  ? failureTitle()
                  : t('recordModal.loading'),
              description: context ? (definition.description?.(context) ?? null) : null,
              status: context ? definition.status?.(context) : undefined,
              actions: context ? definition.actions?.(context) : undefined,
              closeLabel: t('recordModal.close'),
              body: recordBody(),
            })}
            {dialogLayer()}
            {askLayer()}
          </>
        )
      },
      mount: ({ root: host, lifetime }) => {
        root = host as unknown as HTMLElement
        // Object URLs of the images chosen but not sent yet (see the `change` handler).
        const filePreviews = new Set<string>()
        lifetime.addEventListener('abort', () => {
          for (const src of filePreviews) URL.revokeObjectURL(src)
        })

        // Links anywhere on the page that name this kind open it; a link naming the
        // record already open switches its tab. Runs before the navigation layer.
        document.addEventListener(
          'click',
          (event) => {
            if (
              event.defaultPrevented ||
              event.button !== 0 ||
              event.metaKey ||
              event.ctrlKey ||
              event.shiftKey ||
              event.altKey
            )
              return
            const element = event.target instanceof Element ? event.target : null
            // The question answers before anything under it: its confirm submits nothing.
            const question = asking()
            const inAsk = question && element?.closest(ASK_LAYER)
            if (inAsk && root?.contains(inAsk)) {
              const confirmed = element?.closest(`button[value="${RECORD_ASK_CONFIRM}"]`)
              const declined = element?.closest(
                '[data-ui="modal-close"], [data-ui="modal-backdrop"], [data-client-modal-close]',
              )
              if (confirmed || declined) {
                event.preventDefault()
                question.settle(Boolean(confirmed))
              }
              return
            }
            const inModal = element?.closest(layerSelector)
            if (inModal && root?.contains(inModal)) {
              // A child control can open its own dialog inside this record.
              // Close/backdrop actions in that layer belong to the child.
              const nearestModal = element?.closest('[data-ui="modal-layer"]')
              if (nearestModal && nearestModal !== inModal && inModal.contains(nearestModal)) return
              // `data-ui="modal-close"` is the chrome's own × control; `data-record-close`
              // marks a module's own labeled close button placed elsewhere in the body
              // (the two can't share one attribute — a labeled button needs `data-ui="action"`
              // for its styling, not the icon-only close control's). Route-context pages have no close.
              if (
                (!serverPage || inModal.matches('[data-ui="modal-layer"]')) &&
                element?.closest(
                  '[data-ui="modal-close"], [data-ui="modal-backdrop"], [data-record-close], [data-client-modal-close]',
                )
              ) {
                event.preventDefault()
                void close()
                return
              }
              const stateControl = element?.closest<HTMLElement>(
                'button[data-record-state], a[data-record-state], [data-record-state-trigger]',
              )
              if (stateControl) {
                event.preventDefault()
                keepAllDrafts()
                const reset = stateControl.getAttribute('data-record-reset-fields')
                if (reset) {
                  const names: unknown = JSON.parse(reset)
                  if (Array.isArray(names) && names.every((name) => typeof name === 'string')) {
                    const store = dialog() ? dialogDrafts : recordDrafts
                    store.set(resetRecordDraftFields(store(), names))
                  }
                }
                const stateStore = dialog() ? dialogViewState : viewState
                stateStore.set({
                  ...stateStore(),
                  [stateControl.getAttribute('data-record-state-trigger') ??
                    stateControl.getAttribute('data-record-state') ??
                    '']: stateControl.getAttribute('data-record-value') ?? '',
                })
                return
              }
              const opener = element?.closest<HTMLElement>(`[${RECORD_DIALOG_ATTRIBUTE}]`)
              if (opener) {
                event.preventDefault()
                keepDrafts(recordLayer(), 'record')
                const focused = document.activeElement
                dialogReturnFocus =
                  focused instanceof HTMLElement && opener.contains(focused)
                    ? focused
                    : opener.querySelector<HTMLElement>(focusable)
                dialogDrafts.set(emptyDraftState())
                dialogViewState.set({})
                const params: Record<string, string> = {}
                for (const [key, value] of Object.entries(opener.dataset))
                  if (key.startsWith('recordParam') && value !== undefined)
                    params[key.slice('recordParam'.length).replace(/^./u, (c) => c.toLowerCase())] = value
                issues.set([])
                outcome.set(null)
                saved.set(false)
                const name = opener.getAttribute(RECORD_DIALOG_ATTRIBUTE) ?? ''
                dialog.set({ name, params })
                if (page && !serverPage) {
                  const current = open()!
                  const url = new URL(hrefFor(current.id, current.tab || null, name), location.href)
                  if (params.id) url.searchParams.set('dialogId', params.id)
                  history.pushState(history.state ?? {}, '', `${url.pathname}${url.search}`)
                }
                afterRender()
                return
              }
              if (element?.closest('button[name="intent"][value="retry"]')) {
                event.preventDefault()
                const current = open()
                if (current) void load(current.id)
                return
              }
            }
            if (serverPage) return
            // A page answers only its own links; the shell's links on the same path stay navigations.
            if (page && !(element && root?.contains(element))) return
            const href = openerHref(element)
            if (!href) return
            const url = new URL(recordRequestHref(href, location.href))
            if (url.origin !== location.origin || url.pathname !== location.pathname) return
            const target = targetOf(url)
            if (!target) return
            event.preventDefault()
            const current = open()
            const contextQuery = 'route' in definition.context ? (definition.context.query ?? []) : []
            const previousUrl = new URL(location.href)
            const changedContext = contextQuery.some(
              (key) => previousUrl.searchParams.get(key) !== url.searchParams.get(key),
            )
            if (changedContext) {
              // These keys belong to the context reader (for example item pagination).
              // Preserve collection filters and record drafts while replacing this slice.
              keepDrafts(recordLayer(), 'record')
              for (const key of contextQuery) {
                const value = url.searchParams.get(key)
                if (value === null) previousUrl.searchParams.delete(key)
                else previousUrl.searchParams.set(key, value)
              }
              history.replaceState(history.state ?? {}, '', previousUrl.href)
              if (current?.id === target.id) void load(current.id)
            }
            if (current?.id === target.id) {
              if ((target.tab ?? '') === current.tab && !target.dialog) return
              // Switching tab is not discarding: what was typed rides along as drafts,
              // which the views read back, so no prompt stands between two tabs.
              keepDrafts(recordLayer(), 'record')
              issues.set([])
              if (target.dialog) {
                // A link naming one of this record's dialogs (an overflow menu's command)
                // opens it as its trigger would: a new entry Back closes, focus in the
                // dialog, then back on what opened it — the menu's own button when the
                // link sat in a disclosure that has closed since. Like any opened dialog,
                // it clears the answer of the layer below.
                outcome.set(null)
                const opener = element?.closest<HTMLElement>('a[href]') ?? null
                dialogReturnFocus =
                  opener?.closest('details')?.querySelector<HTMLElement>(':scope > summary') ?? opener
                const dialogId = url.searchParams.get('dialogId')
                show(
                  target.id,
                  target.tab ?? null,
                  'push',
                  () => null,
                  target.dialog,
                  dialogId ? { id: dialogId } : {},
                )
                return
              }
              // The answer belonged to the tab that asked for it.
              outcome.set(null)
              show(
                target.id,
                target.tab ?? null,
                'replace',
                () =>
                  recordLayer()?.querySelector<HTMLElement>('[data-ui="tab"][data-active="true"]') ?? null,
                target.dialog,
              )
              return
            }
            show(
              target.id,
              target.tab ?? null,
              'push',
              undefined,
              target.dialog,
              undefined,
              element?.closest<HTMLElement>('a[href], button, [tabindex]') ?? null,
            )
          },
          // Capture: the navigation layer listens on the document too, and was
          // installed first, so a bubbling listener would see the page fetched.
          { signal: lifetime, capture: true },
        )

        // A row is reached by keyboard, not by pointer alone: Enter and Space on
        // the focused row open what clicking it opens.
        document.addEventListener(
          'keydown',
          (event) => {
            if (serverPage || event.defaultPrevented || (event.key !== 'Enter' && event.key !== ' ')) return
            const element = event.target instanceof Element ? event.target : null
            if (!element?.matches('[data-row-href][tabindex="0"]')) return
            if (page && !root?.contains(element)) return
            const href = element.getAttribute('data-row-href')
            const url = href ? new URL(href, location.href) : null
            if (!url || url.origin !== location.origin || url.pathname !== location.pathname) return
            const target = targetOf(url)
            if (!target) return
            event.preventDefault()
            show(
              target.id,
              target.tab ?? null,
              'push',
              undefined,
              target.dialog,
              undefined,
              element instanceof HTMLElement ? element : null,
            )
          },
          { signal: lifetime, capture: true },
        )

        document.addEventListener(
          'submit',
          (event) => {
            const form = event.target instanceof HTMLFormElement ? event.target : null
            if (!form || !root?.contains(form) || !recordFormOwnedByHost(form, root)) return
            const submitter = (event as SubmitEvent).submitter ?? null
            const name =
              (submitter instanceof HTMLButtonElement && submitter.name === RECORD_COMMAND_FIELD
                ? submitter.value
                : null) ?? String(new FormData(form).get(RECORD_COMMAND_FIELD) ?? '')
            // Native search forms inside a record page keep their GET navigation.
            if (!name) return
            event.preventDefault()
            void run(name, form, submitter)
          },
          { signal: lifetime },
        )

        document.addEventListener(
          'keydown',
          (event) => {
            if (!open()) return
            if (
              !recordLayerOwnsKey(event.key, event.defaultPrevented, !!document.querySelector('dialog[open]'))
            )
              return
            // Only modal layers trap keys: a page answers Escape and Tab only while a dialog is up.
            const layers = root?.querySelectorAll<HTMLElement>(MODAL_LAYER)
            const top = layers?.[layers.length - 1]
            if (!top) return
            if (event.key === 'Escape') {
              event.preventDefault()
              const question = asking()
              if (question) question.settle(false)
              else void close()
              return
            }
            if (event.key !== 'Tab') return
            const items = focusablesIn(top)
            if (!items.length) {
              event.preventDefault()
              top.querySelector<HTMLElement>('[data-ui="modal-sheet"]')?.focus()
              return
            }
            const first = items[0]!
            const last = items.at(-1)!
            if (
              event.shiftKey &&
              (document.activeElement === first || !top.contains(document.activeElement))
            ) {
              event.preventDefault()
              last.focus()
            } else if (
              !event.shiftKey &&
              (document.activeElement === last || !top.contains(document.activeElement))
            ) {
              event.preventDefault()
              first.focus()
            }
          },
          { signal: lifetime },
        )

        // An input or select carrying `data-record-state` feeds view state as it
        // changes; a file chosen in a `data-record-submit` input submits its form.
        // A design-system `RelationSelect`'s own hidden native select carries no
        // such marker (the package knows nothing of this runtime), but it fires a
        // real `change` too — keyed by its `name`, which every field in this kit
        // already sets to the same key `state()` reads it back under.
        document.addEventListener(
          'change',
          (event) => {
            const control = event.target instanceof Element ? event.target : null
            if (!control || !root?.contains(control)) return
            // A checkbox named `__all:<prefix>` ticks or clears every checkbox of its
            // form whose name starts with that prefix, so one control stands for a
            // row or a whole section. Any tick in such a form is kept as a draft, so
            // the view re-renders and each "all" box reads whether it is now full.
            if (control instanceof HTMLInputElement && control.type === 'checkbox' && control.form) {
              const form = control.form
              if (form.querySelector(`input[type="checkbox"][name^="${CHECK_ALL}"]`)) {
                if (control.name.startsWith(CHECK_ALL)) {
                  const prefix = control.name.slice(CHECK_ALL.length)
                  for (const target of form.querySelectorAll<HTMLInputElement>('input[type="checkbox"]'))
                    if (
                      !target.disabled &&
                      !target.name.startsWith(CHECK_ALL) &&
                      target.name.startsWith(prefix)
                    )
                      target.checked = control.checked
                }
                keepAllDrafts()
                return
              }
            }
            const stateKey =
              control.getAttribute('data-record-state') ??
              (['relation-native', 'reorder-list-value'].includes(control.getAttribute('data-ui') ?? '')
                ? control.getAttribute('name')
                : null)
            if ((control instanceof HTMLSelectElement || control instanceof HTMLInputElement) && stateKey) {
              const stateStore = dialog() ? dialogViewState : viewState
              applyRecordControlState(control, keepAllDrafts, (value) => {
                const reset =
                  stateStore()[stateKey] === value
                    ? []
                    : (definition.resetRelationsOnChange?.[stateKey] ?? [])
                if (reset.length) {
                  const drafts = dialog() ? dialogDrafts : recordDrafts
                  drafts.set({
                    ...drafts(),
                    values: { ...drafts().values, ...Object.fromEntries(reset.map((name) => [name, ''])) },
                  })
                }
                stateStore.set({
                  ...stateStore(),
                  [stateKey]: value,
                  ...Object.fromEntries(reset.map((name) => [name, ''])),
                })
              })
              return
            }
            if (
              control instanceof HTMLInputElement &&
              control.type === 'file' &&
              (control.hasAttribute('data-record-submit') ||
                control.form?.hasAttribute('data-record-dropzone')) &&
              control.files?.length
            ) {
              control.form?.requestSubmit()
              return
            }
            // A form sent by its button shows the image it is about to send: the view
            // reads `state('file:<name>')` (and `:name`) and gives it to DropZone as
            // its preview. Anything but an image clears it.
            if (control instanceof HTMLInputElement && control.type === 'file' && control.name) {
              keepAllDrafts()
              const key = `file:${control.name}`
              const stateStore = dialog() ? dialogViewState : viewState
              const previous = stateStore()[key]
              if (previous) {
                URL.revokeObjectURL(previous)
                filePreviews.delete(previous)
              }
              const file = control.files?.[0]
              const src = file?.type.startsWith('image/') ? URL.createObjectURL(file) : ''
              if (src) filePreviews.add(src)
              stateStore.set({ ...stateStore(), [key]: src, [`${key}:name`]: src ? file!.name : '' })
            }
          },
          { signal: lifetime },
        )

        // A form marked `data-record-dropzone` takes a dropped file into its file
        // input and submits, so dragging a photo in is the same command as choosing it.
        const dropzoneOf = (event: Event): HTMLFormElement | null => {
          const element = event.target instanceof Element ? event.target : null
          const zone = element?.closest<HTMLFormElement>('form[data-record-dropzone]') ?? null
          return zone && root?.contains(zone) ? zone : null
        }
        document.addEventListener(
          'dragover',
          (event) => {
            const zone = dropzoneOf(event)
            if (!zone) return
            event.preventDefault()
            zone.dataset.drag = '1'
          },
          { signal: lifetime },
        )
        document.addEventListener(
          'dragleave',
          (event) => {
            const zone = dropzoneOf(event)
            if (!zone) return
            const related = (event as DragEvent).relatedTarget
            if (related instanceof Node && zone.contains(related)) return
            delete zone.dataset.drag
          },
          { signal: lifetime },
        )
        document.addEventListener(
          'drop',
          (event) => {
            const zone = dropzoneOf(event)
            if (!zone) return
            event.preventDefault()
            delete zone.dataset.drag
            const files = (event as DragEvent).dataTransfer?.files
            const input = zone.querySelector<HTMLInputElement>('input[type="file"]')
            if (!input || !files?.length) return
            const transfer = new DataTransfer()
            transfer.items.add(files[0]!)
            input.files = transfer.files
            zone.requestSubmit()
          },
          { signal: lifetime },
        )

        // Islands a view places with `recordIsland` start when their host appears
        // and stop when it leaves, through the page's own island manager.
        const observer = new MutationObserver((records) => {
          fitRecordHeight()
          if (!root) return
          const { removed, added, updated } = recordIslandChanges(records, root)
          for (const node of [...removed, ...updated])
            document.dispatchEvent(new CustomEvent('ket:islands-detach', { detail: { root: node } }))
          // Disposing stops effects/listeners; a fresh mount does not remove the
          // retained host's old DOM. The island owns these children, not this view.
          for (const node of updated) node.replaceChildren()
          for (const node of [...added, ...updated])
            document.dispatchEvent(new CustomEvent('ket:islands-attach', { detail: { root: node } }))
        })
        observer.observe(root, {
          childList: true,
          subtree: true,
          characterData: true,
          attributes: true,
          attributeFilter: ['data-props'],
        })
        lifetime.addEventListener('abort', () => observer.disconnect())
        window.addEventListener('resize', fitRecordHeight, { signal: lifetime })
        // Images and native disclosures change layout without adding text nodes.
        root.addEventListener('load', fitRecordHeight, { capture: true, signal: lifetime })
        root.addEventListener('toggle', fitRecordHeight, { capture: true, signal: lifetime })
        // Web fonts can arrive after the first record measurement.
        void document.fonts?.ready.then(() => {
          if (!lifetime.aborted) fitRecordHeight()
        })
        fitRecordHeight()

        // Another island (or this one) changed records of this kind: drop them so the
        // next opening reads fresh data first.
        document.addEventListener(
          'ket:records-changed',
          (event) => {
            const detail = (event as CustomEvent<{ kind?: string; ids?: unknown[] }>).detail
            if (detail?.kind !== definition.kind) return
            if (!Array.isArray(detail.ids) || !detail.ids.length) cache.clear()
            else for (const id of detail.ids) cache.delete(String(id))
            // A page keeps showing its record, so it reads the change at once; so does a
            // modal that follows its record, unless the reader typed into it.
            const current = open()
            if (
              (page || (definition.follow === true && !!root && !recordLayerHasDraft(root))) &&
              current &&
              !running() &&
              (!Array.isArray(detail.ids) ||
                !detail.ids.length ||
                detail.ids.map(String).includes(current.id))
            )
              void load(current.id, true)
          },
          { signal: lifetime },
        )

        lifetime.addEventListener('abort', () => {
          request?.abort()
          showBusy.stop()
          releaseInert?.()
          releaseInert = null
          root = null
        })
        // A page belongs to its address; history and links are the shell's.
        if (serverPage) {
          adopted.set(true)
          const entry = pageProps?.dialog
          if (entry && Object.hasOwn(definition.dialogs ?? {}, entry)) {
            dialog.set({ name: entry, params: {} })
            afterRender()
          }
          if (status() !== 'ready') void load(open()!.id)
          return
        }

        // Back and forward over entries this modal created change only the modal.
        if (page)
          window.addEventListener(
            'popstate',
            () => {
              const current = open()
              if (
                !current ||
                !page.path ||
                new URL(page.path(current.id), location.href).pathname !== location.pathname
              )
                return
              const url = new URL(location.href)
              const name = url.searchParams.get('dialog')
              if (!name && dialog()) {
                void close()
                return
              }
              show(current.id, url.searchParams.get(RECORD_TAB_PARAM), 'none', undefined, name)
            },
            { signal: lifetime },
          )
        document.addEventListener(
          'ket:popstate',
          (event) => {
            // A page's entries are the shell's: back leaves it like any other page.
            if (page) return
            if (pendingHistoryClose) {
              const ownsReturn = recordModalReturnMatches(pendingHistoryClose, location.href)
              pendingHistoryClose = null
              if (ownsReturn) {
                event.preventDefault()
                return
              }
            }
            const target = readRecordModalTarget(location.href)
            const mine = target?.kind === definition.kind
            if (!mine && !open()) return
            event.preventDefault()
            if (mine && target) show(target.id, target.tab ?? null, 'none', undefined, target.dialog)
            else hide('none')
          },
          { signal: lifetime },
        )

        // Cross-collection links (for example global search results) use the
        // shell navigation first. This persistent island is not remounted when
        // those slots change, so open the destination record after URL commit.
        // A refresh of an already open record must not reset its draft or tab.
        document.addEventListener(
          'ket:navigation-complete',
          () => {
            if (page) return
            const target = readRecordModalTarget(location.href)
            if (target?.kind === definition.kind) {
              if (open()?.id !== target.id)
                show(target.id, target.tab ?? null, 'none', undefined, target.dialog)
            } else if (open()) hide('none')
          },
          { signal: lifetime },
        )

        if (page) {
          const tab = page.props.tab ?? new URL(location.href).searchParams.get(RECORD_TAB_PARAM) ?? null
          // Fragment hydration can precede the shell's URL commit. Adopt the context
          // computed for this destination; rereading location here would fetch the
          // previous search (and discard the user's newly submitted GET parameters).
          if (page.props.envelope) {
            open.set({ id: String(page.props.id), tab: '' })
            envelope.set(page.props.envelope as RecordContextEnvelope<Data>)
            status.set('ready')
          }
          show(
            page.props.id,
            tab,
            'none',
            undefined,
            page.props.dialog ?? new URL(location.href).searchParams.get('dialog'),
          )
        } else {
          const initial = readRecordModalTarget(location.href)
          if (initial?.kind === definition.kind)
            show(initial.id, initial.tab ?? null, 'none', undefined, initial.dialog)
        }
      },
    }
  }

/**
 * Place an island inside a record view. The runtime starts it when the host
 * appears and disposes it when the host leaves; props must be JSON.
 */
export const recordIsland = (name: string, props: Record<string, unknown>): TemplateResult => (
  <>
    {each(
      [props],
      (value) => JSON.stringify(value),
      (value) => (
        <ket-island data-island={name} data-props={JSON.stringify(value)} />
      ),
    )}
  </>
)

export {
  RECORD_NEW_ID,
  RECORD_PARAM,
  RECORD_TAB_PARAM,
  recordModalHref,
  recordModalCreateHref,
  recordModalClosedHref,
  readRecordModalTarget,
}

export {
  RecordModalForm,
  RecordImageField,
  RecordActionForm,
  RecordCloseTrigger,
  RecordDialogTrigger,
  RecordStateTrigger,
  RecordCommandForm,
  recordStateSelectControl,
} from './record-modal-form.tsx'
