// A GET filter form rendered by `RecordForm({ applyOnInput: true })` has no submit step: a choice
// applies at once and typed text after a pause. Whether the submit reloads the page or an island redraws
// the form in place, the field the reader was typing in gets focus back with the caret at the end, so
// typing continues.

const FORM = 'form[data-ui="record-form"][data-apply="input"]'
const FOCUS_KEY = 'kv.design-system.apply-on-input.focus'
const TYPING_PAUSE = 400
const FOCUS_WINDOW = 10_000
const TEXT_TYPES = new Set(['', 'text', 'search', 'email', 'tel', 'url', 'number'])

/** @param {EventTarget | null} target */
const typedField = (target) =>
  !!target &&
  'tagName' in target &&
  ((target.tagName === 'INPUT' && TEXT_TYPES.has(/** @type {HTMLInputElement} */ (target).type ?? '')) ||
    target.tagName === 'TEXTAREA')

// Nested hosts may attach the runtime again; an event still submits once.
const handled = new WeakSet()

/**
 * @param {Document} doc
 * @param {{ form?: unknown, field?: unknown, at?: unknown } | null} saved
 */
const refocus = (doc, saved) => {
  if (!saved || typeof saved.field !== 'string' || !(Date.now() - Number(saved.at) < FOCUS_WINDOW))
    return false
  const field = doc.getElementById(saved.field)
  const form = field && 'form' in field ? /** @type {HTMLInputElement} */ (field).form : null
  if (!field || !form || form.id !== saved.form || !form.matches(FORM) || !typedField(field)) return false
  const input = /** @type {HTMLInputElement} */ (field)
  input.focus()
  const end = input.value.length
  if (input.type !== 'number') input.setSelectionRange?.(end, end)
  return true
}

/**
 * @param {Document} [doc]
 * @param {Pick<Storage, 'getItem' | 'setItem' | 'removeItem'> | null} [storage]
 * @returns {() => void}
 */
export const attachApplyOnInput = (doc = document, storage = sessionStorageOrNull()) => {
  /** @type {ReturnType<typeof setTimeout> | undefined} */
  let typing
  /** @type {(() => void) | undefined} */
  let stopFollowing
  // An island that redraws the form in place replaces the focused field; focus follows it to the new
  // field unless the reader has moved on. A reloaded page restores it from storage instead.
  /** @param {Element} field @param {{ form: string, field: string, at: number }} saved */
  const follow = (field, saved) => {
    stopFollowing?.()
    if (typeof MutationObserver !== 'function') return
    const observer = new MutationObserver(() => {
      // While the typed field stays, it either keeps focus or the reader has left it.
      if (field.isConnected) {
        if (doc.activeElement !== field) stopFollowing?.()
        return
      }
      const active = doc.activeElement
      if (active && active !== doc.body) return stopFollowing?.()
      if (refocus(doc, saved)) {
        storage?.removeItem(FOCUS_KEY)
        stopFollowing?.()
      }
    })
    const expire = setTimeout(() => stopFollowing?.(), FOCUS_WINDOW)
    stopFollowing = () => {
      observer.disconnect()
      clearTimeout(expire)
      stopFollowing = undefined
    }
    observer.observe(doc, { childList: true, subtree: true })
  }
  /** @param {HTMLFormElement} form @param {Element | null} field */
  const submit = (form, field) => {
    clearTimeout(typing)
    typing = undefined
    if (field?.id && form.id && typedField(field)) {
      const saved = { form: form.id, field: field.id, at: Date.now() }
      try {
        storage?.setItem(FOCUS_KEY, JSON.stringify(saved))
      } catch {
        // Storage denial only loses restoration after a reload; the filter still applies.
      }
      follow(field, saved)
    }
    form.requestSubmit()
  }
  /** @param {Event} event */
  const onEvent = (event) => {
    if (handled.has(event)) return
    const field = /** @type {HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement | null} */ (
      event.target
    )
    const form = field && 'form' in field ? field.form : null
    if (!form?.matches(FORM)) return
    handled.add(event)
    if (typedField(field)) {
      if (event.type !== 'input') return
      clearTimeout(typing)
      typing = setTimeout(() => submit(form, field), TYPING_PAUSE)
      return
    }
    if (event.type === 'change') submit(form, field)
  }
  /** @param {Event} event */
  const onSubmit = (event) => {
    if (
      event.target instanceof Object &&
      'matches' in event.target &&
      /** @type {Element} */ (event.target).matches(FORM)
    ) {
      clearTimeout(typing)
      typing = undefined
    }
  }

  try {
    const saved = JSON.parse(storage?.getItem(FOCUS_KEY) ?? 'null')
    storage?.removeItem(FOCUS_KEY)
    refocus(doc, saved)
  } catch {
    // An unreadable entry is dropped; nothing else depends on it.
  }

  doc.addEventListener('input', onEvent)
  doc.addEventListener('change', onEvent)
  doc.addEventListener('submit', onSubmit, true)
  return () => {
    clearTimeout(typing)
    stopFollowing?.()
    doc.removeEventListener('input', onEvent)
    doc.removeEventListener('change', onEvent)
    doc.removeEventListener('submit', onSubmit, true)
  }
}

function sessionStorageOrNull() {
  try {
    return globalThis.sessionStorage ?? null
  } catch {
    return null
  }
}
