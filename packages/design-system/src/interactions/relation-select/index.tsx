// Unlike its neighbors here, this is a ketjs-view *island*: it owns reactive state
// (`signal`) and fetches its own data (`/_ket/fn/...`, a ketjs runtime contract, not
// an application-specific one) rather than being a static, server-rendered control
// wired up by the shared `attachDesignSystemInteractions` delegator. A consuming app
// mounts it through its own island runtime (see `defineIsland` in `@ketvietlab/ketjs-view`)
// and supplies the `manager` config that names which functions to call.

import { each, effect, signal } from '@ketvietlab/ketjs-view'
import type { IslandController, IslandProps, TemplateResult } from '@ketvietlab/ketjs-view'
import { relationMenuPlacement } from './placement.ts'
import { restoreRelationSelectionFocus } from './focus.ts'

export const HOOKS = [
  'relation-select',
  'relation-native',
  'relation-trigger',
  'relation-value',
  'relation-caret',
  'relation-chips',
  'relation-chip',
  'relation-chip-clear',
  'relation-menu',
  'relation-search',
  'relation-options',
  'relation-option',
  'relation-footer',
  'relation-empty',
  'relation-editor',
  'relation-dialog-toolbar',
  'relation-search-field',
  'relation-search-icon',
  'relation-dialog-list',
  'relation-dialog-row',
  'relation-dialog-main',
  'relation-dialog-meta',
  'relation-dialog-actions',
] as const

export type RelationOption = { value: string; label: string; description?: string | null }

export type RelationEditorField = {
  name: string
  label: string
  type?: 'text' | 'email' | 'tel' | 'select'
  required?: boolean
  options?: RelationOption[]
}

export type RelationManager = {
  listFunction: string
  /** Read the server while typing in the inline picker, rather than filtering only primed options. */
  searchInDropdown?: boolean
  listInput?: Record<string, unknown>
  searchParam?: string
  limitParam?: string
  limit?: number
  idField?: string
  labelField?: string
  descriptionField?: string
  saveFunction?: string
  saveDefaults?: Record<string, unknown>
  removeFunction?: string
  removeDefaults?: Record<string, unknown>
  fields?: RelationEditorField[]
  excludeIds?: string[]
}

export type RelationSelectLabels = {
  choose: string
  search: string
  more: string
  noRecords: string
  loading: string
  loadError: string
  dialogTitle: string
  close: string
  select: string
  create: string
  edit: string
  save: string
  cancel: string
  remove: string
  confirmRemove: string
  retry: string
  clear: string
  chosen: string
}

export type RelationSelectConfig = {
  name: string
  ariaLabel: string
  /** Public field association for enhanced controls; existing callers may omit all three. */
  triggerId?: string
  invalid?: boolean
  describedBy?: string | null
  value?: string | null
  /**
   * Several records under one field name, joined by a comma on the way out.
   *
   * A repeated form key would not survive `readForm`, which builds a
   * `Record<string, string>` and keeps only the last value — so a multi-valued
   * field posts one comma-separated string, which is also what the routes that
   * take value lists already parse.
   */
  multiple?: boolean
  values?: string[]
  options: RelationOption[]
  required?: boolean
  disabled?: boolean
  labels: RelationSelectLabels
  manager?: RelationManager
}

/** Client-only composition hooks; keep callbacks out of serialized island props. */
export type RelationSelectCallbacks = {
  options?: () => RelationOption[]
  disabled?: () => boolean
  onSelect?: (option: RelationOption) => void
  onCreate?: (query: string) => void
  /** An add-to-list picker returns to its placeholder after each selection. */
  resetAfterSelect?: boolean
}

type RelationRow = Record<string, unknown>
type RelationEditor = { id: string; row: RelationRow }
type RelationSelectIslandProps = IslandProps & { id: string; config: RelationSelectConfig }
type ApiPayload = {
  ok?: boolean
  value?: unknown
  message?: unknown
  errors?: Array<{ message?: unknown; code?: unknown }>
}

const array = <Value,>(value: unknown): Value[] => (Array.isArray(value) ? (value as Value[]) : [])
const string = (value: unknown): string => (value == null ? '' : String(value))

const callApi = async (name: string, input: unknown, requestSignal?: AbortSignal): Promise<unknown> => {
  const response = await fetch(`/_ket/fn/${encodeURIComponent(name)}`, {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(input),
    signal: requestSignal,
  })
  const payload = (await response.json()) as ApiPayload
  if (!response.ok || payload.ok === false) {
    const domainError = array<{ message?: unknown; code?: unknown }>(payload.errors)[0]
    throw new Error(
      string(domainError?.message ?? domainError?.code ?? payload.message ?? `HTTP ${response.status}`),
    )
  }
  return payload.value
}

/**
 * Records a manager picker learned after its props were written: one it created, or a
 * search result it chose. A record form re-mounts its islands from props that predate
 * them, so without this the choice loses its label (the native select cannot hold it)
 * and the list loses the new record until the page reloads. Keyed by the list function,
 * so every picker of that list on the page knows them.
 */
const learnedOptions = new Map<string, RelationOption[]>()
const learnOption = (key: string, option: RelationOption): void => {
  const held = learnedOptions.get(key) ?? []
  learnedOptions.set(key, [...held.filter((entry) => string(entry.value) !== string(option.value)), option])
}
const forgetOption = (key: string, id: string): void => {
  const held = learnedOptions.get(key)
  if (held)
    learnedOptions.set(
      key,
      held.filter((entry) => string(entry.value) !== id),
    )
}

export function createRelationSelectView(
  props: RelationSelectIslandProps,
  callbacks: RelationSelectCallbacks = {},
): IslandController {
  const { id: islandId, config } = props
  const labels = config.labels
  const manager = config.manager
  // One representation for both modes: an array of chosen ids. Single-select is
  // the array of length 0 or 1, so downstream code only branches where the UI
  // genuinely differs — the trigger and the chips.
  const multiple = config.multiple === true
  const chosen = signal(
    multiple
      ? array<unknown>(config.values).map(string).filter(Boolean)
      : [string(config.value)].filter(Boolean),
  )
  const selected = (): string => chosen()[0] ?? ''
  const isChosen = (value: unknown): boolean => chosen().includes(string(value))
  const learnedKey = manager?.listFunction ?? ''
  const primed = array<RelationOption>(config.options)
  const learned = learnedOptions.get(learnedKey) ?? []
  const learnedAs = (value: unknown) => learned.find((entry) => string(entry.value) === string(value))
  // A record renamed here keeps its new label; one created here joins the list.
  const options = signal<RelationOption[]>([
    ...primed.map((entry) => learnedAs(entry.value) ?? entry),
    ...learned.filter((entry) => !primed.some((held) => string(held.value) === string(entry.value))),
  ])
  const availableOptions = (): RelationOption[] => callbacks.options?.() ?? options()
  const disabled = (): boolean => callbacks.disabled?.() ?? config.disabled === true
  const open = signal(false)
  const dialog = signal(false)
  const query = signal('')
  const rows = signal<RelationRow[]>([])
  const dropdownRows = signal<{ query: string; options: RelationOption[] } | null>(null)
  const loading = signal(false)
  const error = signal('')
  const editor = signal<RelationEditor | null>(null)
  const pendingRemove = signal('')
  let activeRequest: AbortController | null = null
  let searchTimer: ReturnType<typeof setTimeout> | undefined
  let disposed = false

  const rowId = (row: RelationRow): string => string(row[manager?.idField ?? 'id'])
  const rowLabel = (row: RelationRow): string =>
    string(row[manager?.labelField ?? 'name']) || labels.noRecords
  const rowDescription = (row: RelationRow): string => string(row[manager?.descriptionField ?? 'ref'])
  const selectedLabel = (): string =>
    options().find((entry) => string(entry.value) === selected())?.label ?? labels.choose

  const filteredOptions = (): RelationOption[] => {
    if (manager?.searchInDropdown && dropdownRows()?.query === query().trim())
      return dropdownRows()!.options.slice(0, 7)
    if (manager?.searchInDropdown && query().trim()) return []
    const needle = query().trim().toLocaleLowerCase()
    const held = needle
      ? availableOptions().filter((entry) =>
          `${string(entry.label)} ${string(entry.description)}`.toLocaleLowerCase().includes(needle),
        )
      : availableOptions()
    // Only a manager can browse past the dropdown; a local picker lists every match.
    return callbacks.options || !manager ? held : held.slice(0, 7)
  }

  const choose = (value: unknown, label: unknown, description: unknown = ''): void => {
    if (disabled()) return
    const id = string(value)
    if (!options().some((entry) => string(entry.value) === id)) {
      const option = { value: id, label: string(label), description: string(description) }
      options.set([...options(), option])
      if (learnedKey && id) learnOption(learnedKey, option)
    }
    if (multiple) {
      chosen.set(isChosen(id) ? chosen().filter((held) => held !== id) : [...chosen(), id])
      callbacks.onSelect?.({ value: id, label: string(label), description: string(description) })
      return
    }
    chosen.set(id ? [id] : [])
    open.set(false)
    dialog.set(false)
    query.set('')
    editor.set(null)
    pendingRemove.set('')
    if (callbacks.resetAfterSelect) chosen.set([])
    callbacks.onSelect?.({ value: id, label: string(label), description: string(description) })
  }

  const unchoose = (value: unknown): void => {
    chosen.set(chosen().filter((held) => held !== string(value)))
  }

  const labelOf = (value: unknown): string =>
    options().find((entry) => string(entry.value) === string(value))?.label ?? string(value)

  const loadRows = async (): Promise<void> => {
    if (!manager?.listFunction) return
    activeRequest?.abort()
    const request = new AbortController()
    activeRequest = request
    loading.set(true)
    error.set('')
    try {
      const input: Record<string, unknown> = { ...(manager.listInput ?? {}) }
      input[manager.searchParam ?? 'search'] = query().trim()
      input[manager.limitParam ?? 'limit'] = manager.limit ?? 80
      const value = await callApi(manager.listFunction, input, request.signal)
      if (disposed || activeRequest !== request) return
      const excluded = new Set(array<unknown>(manager.excludeIds).map(string))
      const result = array<RelationRow>(value).filter((row) => !excluded.has(rowId(row)))
      rows.set(result)
      if (manager.searchInDropdown)
        dropdownRows.set({
          query: String(input[manager.searchParam ?? 'search']),
          options: result.map((row) => ({
            value: rowId(row),
            label: rowLabel(row),
            description: rowDescription(row),
          })),
        })
    } catch (caught) {
      if (disposed || activeRequest !== request || (caught instanceof Error && caught.name === 'AbortError'))
        return
      error.set(caught instanceof Error ? caught.message : labels.loadError)
    } finally {
      if (activeRequest === request) loading.set(false)
    }
  }

  const openDialog = async (): Promise<void> => {
    open.set(false)
    dialog.set(true)
    editor.set(null)
    pendingRemove.set('')
    await loadRows()
  }

  const closeDialog = (event?: Event): void => {
    // A manager dialog may sit inside a record modal. Closing this layer must
    // not reach the record modal's document-level close handler.
    event?.stopPropagation()
    dialog.set(false)
    editor.set(null)
    pendingRemove.set('')
    error.set('')
  }

  const searchManager = (event: Event): void => {
    if (!(event.currentTarget instanceof HTMLInputElement)) return
    query.set(event.currentTarget.value)
    activeRequest?.abort()
    activeRequest = null
    loading.set(true)
    error.set('')
    clearTimeout(searchTimer)
    searchTimer = setTimeout(loadRows, 180)
  }

  const save = async (event: Event): Promise<void> => {
    event.preventDefault()
    if (!manager?.saveFunction || !(event.currentTarget instanceof HTMLFormElement)) return
    const editing = editor()
    const id = editing?.id || crypto.randomUUID()
    const payload: Record<string, unknown> = { ...(manager.saveDefaults ?? {}), id }
    for (const [name, value] of new FormData(event.currentTarget).entries()) payload[name] = string(value)
    loading.set(true)
    error.set('')
    try {
      await callApi(manager.saveFunction, payload)
      const label = string(payload[manager.labelField ?? 'name'])
      if (!editing?.id) {
        choose(id, label)
        if (multiple) {
          editor.set(null)
          await loadRows()
        }
        return
      }
      options.set(
        options().map((entry) =>
          string(entry.value) === id ? { ...entry, label: label || entry.label } : entry,
        ),
      )
      const renamed = options().find((entry) => string(entry.value) === id)
      if (learnedKey && renamed && label) learnOption(learnedKey, renamed)
      editor.set(null)
      await loadRows()
    } catch (caught) {
      error.set(caught instanceof Error ? caught.message : labels.loadError)
    } finally {
      loading.set(false)
    }
  }

  const remove = async (row: RelationRow): Promise<void> => {
    const id = rowId(row)
    if (pendingRemove() !== id) {
      pendingRemove.set(id)
      return
    }
    if (!manager?.removeFunction) return
    loading.set(true)
    error.set('')
    try {
      await callApi(manager.removeFunction, { ...(manager.removeDefaults ?? {}), id })
      unchoose(id)
      options.set(options().filter((entry) => string(entry.value) !== id))
      forgetOption(learnedKey, id)
      pendingRemove.set('')
      await loadRows()
    } catch (caught) {
      error.set(caught instanceof Error ? caught.message : labels.loadError)
    } finally {
      loading.set(false)
    }
  }

  const editorField = (field: RelationEditorField): TemplateResult => {
    const held = editor()?.row ?? manager?.saveDefaults ?? {}
    const value = string(held[field.name])
    const fieldId = `${islandId}-relation-editor-${field.name}`
    return (
      <label data-ui="form-field" data-span="full" htmlFor={fieldId}>
        <span data-ui="form-label">
          {field.label}
          {field.required ? (
            <span data-ui="form-required" aria-hidden="true">
              {' '}
              *
            </span>
          ) : null}
        </span>
        {field.type === 'select' ? (
          <select data-ui="form-control" id={fieldId} name={field.name} required={field.required === true}>
            {each(
              array<RelationOption>(field.options),
              (entry) => entry.value,
              (entry) => (
                <option value={entry.value} selected={string(entry.value) === value}>
                  {entry.label}
                </option>
              ),
            )}
          </select>
        ) : (
          <input
            data-ui="form-control"
            id={fieldId}
            type={field.type ?? 'text'}
            name={field.name}
            value={value}
            autocomplete="off"
            required={field.required === true}
          />
        )}
      </label>
    )
  }

  const editorForm = (): TemplateResult => (
    <form data-ui="relation-editor" onSubmit={save}>
      <div data-ui="form-grid">
        {each(array<RelationEditorField>(manager?.fields), (field) => field.name, editorField)}
      </div>
      <div data-ui="form-actions">
        <div data-ui="action-group">
          <button data-ui="action" data-variant="primary" type="submit" disabled={loading()}>
            {labels.save}
          </button>
          <button data-ui="action" data-variant="tertiary" type="button" onClick={() => editor.set(null)}>
            {labels.cancel}
          </button>
        </div>
      </div>
    </form>
  )

  const managerRow = (row: RelationRow): TemplateResult => {
    const id = rowId(row)
    const description = rowDescription(row)
    return (
      <li data-ui="relation-dialog-row" data-selected={String(isChosen(id))}>
        <button
          data-ui="relation-dialog-main"
          type="button"
          aria-pressed={multiple ? String(isChosen(id)) : null}
          onClick={() => choose(id, rowLabel(row), description)}
        >
          <strong>{rowLabel(row)}</strong>
          {description ? <small data-ui="relation-dialog-meta">{description}</small> : null}
        </button>
        <div data-ui="relation-dialog-actions">
          <button
            data-ui="action"
            data-size="compact"
            data-variant={isChosen(id) ? 'primary' : 'secondary'}
            type="button"
            onClick={() => choose(id, rowLabel(row), description)}
          >
            {isChosen(id) ? labels.chosen : labels.select}
          </button>
          {manager?.saveFunction ? (
            <button
              data-ui="action"
              data-size="compact"
              data-variant="tertiary"
              type="button"
              onClick={() => editor.set({ id, row })}
            >
              {labels.edit}
            </button>
          ) : null}
          {manager?.removeFunction ? (
            <button
              data-ui="action"
              data-size="compact"
              data-variant="destructive"
              type="button"
              onClick={() => remove(row)}
            >
              {pendingRemove() === id ? labels.confirmRemove : labels.remove}
            </button>
          ) : null}
        </div>
      </li>
    )
  }

  const dialogView = (): TemplateResult => (
    <div data-ui="modal-layer" data-presentation="dialog">
      <button data-ui="modal-backdrop" type="button" aria-label={labels.close} onClick={closeDialog}>
        <span>{labels.close}</span>
      </button>
      <section
        data-ui="modal-sheet"
        role="dialog"
        aria-modal="true"
        aria-labelledby={`${islandId}-relation-title`}
      >
        <header data-ui="modal-head">
          <h2 data-ui="modal-title" id={`${islandId}-relation-title`}>
            {labels.dialogTitle}
          </h2>
          <button
            data-ui="modal-close"
            type="button"
            aria-label={labels.close}
            title={labels.close}
            onClick={closeDialog}
          >
            ×
          </button>
        </header>
        <div data-ui="modal-body">
          <div data-ui="relation-dialog-toolbar">
            <div data-ui="relation-search-field">
              <span data-ui="relation-search-icon" aria-hidden="true">
                <svg
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  stroke-width="2"
                  stroke-linecap="round"
                  stroke-linejoin="round"
                  aria-hidden="true"
                  focusable="false"
                >
                  <circle cx="11" cy="11" r="8" />
                  <path d="m21 21-4.3-4.3" />
                </svg>
              </span>
              <input
                data-ui="field-control"
                type="search"
                value={query()}
                autocomplete="off"
                placeholder={labels.search}
                aria-label={labels.search}
                onInput={searchManager}
              />
            </div>
            {manager?.saveFunction ? (
              <button
                data-ui="action"
                data-variant="primary"
                type="button"
                onClick={() => editor.set({ id: '', row: manager.saveDefaults ?? {} })}
              >
                {labels.create}
              </button>
            ) : null}
          </div>
          {error() ? (
            <aside data-ui="notice" data-tone="danger" role="alert">
              <div data-ui="notice-copy">
                <p data-ui="notice-title">{labels.loadError}</p>
                <p data-ui="notice-message">{error()}</p>
              </div>
              <button data-ui="action" data-variant="secondary" type="button" onClick={loadRows}>
                {labels.retry}
              </button>
            </aside>
          ) : null}
          {editor() ? editorForm() : null}
          {loading() ? (
            <p data-ui="relation-empty" role="status">
              {labels.loading}
            </p>
          ) : null}
          {!loading() && !editor() ? (
            rows().length ? (
              <ul data-ui="relation-dialog-list">{each(rows(), rowId, managerRow)}</ul>
            ) : (
              <p data-ui="relation-empty">{labels.noRecords}</p>
            )
          ) : null}
        </div>
      </section>
    </div>
  )

  const handleKeydown = (event: Event): void => {
    if (!(event instanceof KeyboardEvent) || event.key !== 'Escape') return
    if (!open() && !dialog()) return
    event.preventDefault()
    event.stopPropagation()
    const trigger = (event.currentTarget as HTMLElement | null)?.querySelector<HTMLElement>(
      '[data-ui="relation-trigger"]',
    )
    open.set(false)
    closeDialog()
    trigger?.focus()
  }

  const handleInvalid = (event: Event): void => {
    event.preventDefault()
    open.set(true)
    if (event.currentTarget instanceof HTMLSelectElement)
      (event.currentTarget.nextElementSibling as HTMLElement | null)?.focus()
  }

  return {
    view: () => (
      <div data-ui="relation-select" role="group" aria-label={config.ariaLabel} onKeydown={handleKeydown}>
        {/* biome-ignore lint/a11y/noAriaHiddenOnFocusable: the off-tab native control preserves form submission and constraint validation while the adjacent trigger is the accessible interactive control. */}
        <select
          data-ui="relation-native"
          name={config.name}
          required={config.required === true}
          disabled={disabled()}
          tabindex="-1"
          aria-hidden="true"
          onInvalid={handleInvalid}
        >
          <option value="" selected={!chosen().length} />
          {multiple ? (
            chosen().length ? (
              <option value={chosen().join(',')} selected>
                {chosen().map(labelOf).join(', ')}
              </option>
            ) : null
          ) : (
            each(
              options().filter((entry) => string(entry.value)),
              (entry) => entry.value,
              (entry) => (
                <option value={entry.value} selected={string(entry.value) === selected()}>
                  {entry.label}
                </option>
              ),
            )
          )}
        </select>
        <button
          data-ui="relation-trigger"
          id={config.triggerId}
          aria-invalid={config.invalid === true ? 'true' : undefined}
          aria-describedby={config.describedBy || undefined}
          data-empty={String(!chosen().length)}
          type="button"
          aria-haspopup="listbox"
          aria-label={config.ariaLabel}
          aria-expanded={String(open())}
          aria-controls={`${islandId}-relation-menu`}
          disabled={disabled()}
          onClick={(event) => {
            open.set(!open())
            if (open() && manager?.searchInDropdown) void loadRows()
            // Opening is the start of a search: typing goes straight to the filter.
            const group = (event.currentTarget as HTMLElement | null)?.parentElement
            if (open() && typeof group?.querySelector === 'function')
              queueMicrotask(() => group.querySelector<HTMLElement>('[data-ui="relation-search"]')?.focus())
          }}
        >
          <span data-ui="relation-value">{multiple ? labels.choose : selectedLabel()}</span>
          <span data-ui="relation-caret" aria-hidden="true">
            ▾
          </span>
        </button>
        {multiple && chosen().length ? (
          <ul data-ui="relation-chips" aria-label={labels.chosen}>
            {each(
              chosen(),
              (value) => value,
              (value) => (
                <li data-ui="relation-chip">
                  <span>{labelOf(value)}</span>
                  <button
                    data-ui="relation-chip-clear"
                    type="button"
                    aria-label={`${labels.clear}: ${labelOf(value)}`}
                    title={labels.clear}
                    disabled={disabled()}
                    onClick={() => unchoose(value)}
                  >
                    ×
                  </button>
                </li>
              ),
            )}
          </ul>
        ) : null}
        {open() ? (
          <div
            data-ui="relation-menu"
            id={`${islandId}-relation-menu`}
            role="group"
            aria-label={config.ariaLabel}
          >
            <input
              data-ui="relation-search"
              type="search"
              value={query()}
              autocomplete="off"
              placeholder={labels.search}
              aria-label={labels.search}
              onInput={(event) => {
                if (manager?.searchInDropdown) searchManager(event)
                else if (event.currentTarget instanceof HTMLInputElement) query.set(event.currentTarget.value)
              }}
            />
            <div data-ui="relation-options" role="listbox" aria-busy={loading() ? 'true' : undefined}>
              {manager?.searchInDropdown && loading() ? (
                <p data-ui="relation-empty" role="status">
                  {labels.loading}
                </p>
              ) : manager?.searchInDropdown && error() ? (
                <div>
                  <p data-ui="relation-empty" role="alert">
                    {error()}
                  </p>
                  <button
                    data-ui="action"
                    data-variant="tertiary"
                    type="button"
                    onClick={() => void loadRows()}
                  >
                    {labels.retry}
                  </button>
                </div>
              ) : filteredOptions().length ? (
                each(
                  filteredOptions(),
                  (entry) => entry.value,
                  (entry) => (
                    <button
                      data-ui="relation-option"
                      type="button"
                      role="option"
                      data-selected={String(isChosen(entry.value))}
                      aria-selected={String(isChosen(entry.value))}
                      onClick={() => choose(entry.value, entry.label, entry.description)}
                    >
                      <span>{entry.label}</span>
                      {entry.description ? <small>{entry.description}</small> : null}
                    </button>
                  ),
                )
              ) : (
                <p data-ui="relation-empty">{labels.noRecords}</p>
              )}
            </div>
            {manager || callbacks.onCreate ? (
              <footer data-ui="relation-footer">
                {manager ? (
                  <button data-ui="action" data-variant="tertiary" type="button" onClick={openDialog}>
                    {labels.more}
                  </button>
                ) : null}
                {callbacks.onCreate ? (
                  <button
                    data-ui="action"
                    data-variant="tertiary"
                    type="button"
                    disabled={disabled()}
                    onClick={() => {
                      if (disabled()) return
                      const name = query().trim()
                      open.set(false)
                      query.set('')
                      callbacks.onCreate?.(name)
                    }}
                  >
                    {labels.create}
                  </button>
                ) : null}
              </footer>
            ) : null}
          </div>
        ) : null}
        {dialog() ? dialogView() : null}
      </div>
    ),
    // The hidden native select stands in for a real one — including firing
    // `change` for whatever the host page already listens for there (a state
    // recomputed off another field's selection, say). Skip the effect's own
    // eager first run: nothing has changed yet, only settled onto its initial value.
    // The dispatch itself waits a microtask: firing it synchronously, still
    // inside the signal write that is choosing this very value, let a listener
    // that reacts by re-rendering (and so disposing and re-mounting this same
    // island) re-enter this instance's own `choose()` while it was still on the
    // stack — deferring runs it only once the choice has fully settled.
    mount: ({ root, lifetime }) => {
      let first = true
      const stop = effect(() => {
        chosen()
        if (first) {
          first = false
          return
        }
        queueMicrotask(() => {
          if (disposed || lifetime.aborted) return
          const native = [...root.querySelectorAll('[data-ui="relation-native"]')][0]
          if (native instanceof HTMLSelectElement)
            native.dispatchEvent(new Event('change', { bubbles: true }))
          if (!multiple && !open() && !dialog()) {
            const trigger = [...root.querySelectorAll('[data-ui="relation-trigger"]')][0]
            if (trigger instanceof HTMLElement && !disabled())
              restoreRelationSelectionFocus<Element>(trigger, document.activeElement, document.body, popup)
          }
        })
      })
      lifetime.addEventListener('abort', stop)
      // Keep the popup in its island's DOM (form, theme and focus ownership),
      // while the browser's top layer escapes any ancestor Surface clipping.
      let popup: HTMLElement | null = null
      let frame = 0
      const position = () => {
        if (disposed || lifetime.aborted || !open() || !popup?.isConnected) return
        const trigger = [...root.querySelectorAll('[data-ui="relation-trigger"]')][0]
        if (!(trigger instanceof HTMLElement)) return
        const style = getComputedStyle(popup)
        const viewport = window.visualViewport
        popup.style.width = `${trigger.getBoundingClientRect().width}px`
        popup.style.maxHeight = ''
        const box = popup.getBoundingClientRect()
        const placement = relationMenuPlacement({
          anchor: trigger.getBoundingClientRect(),
          width: box.width,
          height: box.height,
          viewport: {
            left: viewport?.offsetLeft ?? 0,
            top: viewport?.offsetTop ?? 0,
            width: viewport?.width ?? window.innerWidth,
            height: viewport?.height ?? window.innerHeight,
          },
          gap: parseFloat(style.scrollMarginTop),
          inset: parseFloat(style.scrollMarginInlineStart),
          rtl: getComputedStyle(trigger).direction === 'rtl',
        })
        popup.style.left = `${placement.left}px`
        popup.style.top = `${placement.top}px`
        popup.style.width = `${placement.width}px`
        popup.style.maxHeight = `${placement.maxHeight}px`
      }
      const schedule = () => {
        cancelAnimationFrame(frame)
        frame = requestAnimationFrame(position)
      }
      const stopPopup = effect(() => {
        const expanded = open()
        filteredOptions()
        loading()
        error()
        queueMicrotask(() => {
          if (disposed || lifetime.aborted) return
          if (!expanded) {
            if (popup?.isConnected && popup.matches(':popover-open')) popup.hidePopover()
            popup = null
            return
          }
          const menu = [...root.querySelectorAll('[data-ui="relation-menu"]')][0]
          if (!(menu instanceof HTMLElement) || typeof menu.showPopover !== 'function') return
          const firstOpen = popup !== menu
          popup = menu
          menu.setAttribute('popover', 'manual')
          if (!menu.matches(':popover-open')) menu.showPopover()
          position()
          if (firstOpen) menu.querySelector<HTMLElement>('[data-ui="relation-search"]')?.focus()
        })
      })
      const cleanupPopup = () => {
        stopPopup()
        cancelAnimationFrame(frame)
        if (popup?.isConnected && popup.matches(':popover-open')) popup.hidePopover()
        popup = null
      }
      lifetime.addEventListener('abort', cleanupPopup, { once: true })
      window.addEventListener('resize', schedule, { signal: lifetime })
      window.addEventListener('scroll', schedule, { capture: true, signal: lifetime })
      window.visualViewport?.addEventListener('resize', schedule, { signal: lifetime })
      window.visualViewport?.addEventListener('scroll', schedule, { signal: lifetime })
      document.addEventListener(
        'focusout',
        (event) => {
          if (
            !open() ||
            !(root instanceof Node) ||
            !(event.target instanceof Node) ||
            !root.contains(event.target)
          )
            return
          const next = event.relatedTarget
          if (next instanceof Node && !root.contains(next)) open.set(false)
        },
        { signal: lifetime },
      )
      // The inline dropdown isn't a <details> — nothing in the shared
      // `attachDesignSystemInteractions` outside-click delegator sees it, so it
      // closes itself the same way every other popup does. The dialog already
      // closes on its own backdrop click.
      document.addEventListener(
        'click',
        (event) => {
          if (!open()) return
          const target = event.target
          if (target instanceof Node && (root as unknown as Node).contains(target)) return
          open.set(false)
        },
        { signal: lifetime },
      )
    },
    dispose: () => {
      disposed = true
      clearTimeout(searchTimer)
      activeRequest?.abort()
    },
  }
}

export const relationSelect = (props: IslandProps): IslandController =>
  createRelationSelectView(props as RelationSelectIslandProps)
