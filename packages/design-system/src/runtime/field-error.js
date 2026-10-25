const FIELD = '[data-ui="field"]'
const CONTROLS = '[data-ui="field-control"], [data-ui="field-options"], [data-ui="field-option-input"]'

/**
 * A server's validation message on a Field that is already on the page.
 *
 * `Field` draws its error when it renders with `error`. A form that posts with fetch only
 * hears about the error afterwards, and the browser's own validity bubble is the wrong
 * answer: it covers the help text, disappears on the next click and leaves nothing for a
 * screen reader to find again. `showFieldError` puts the message where `Field` would have
 * rendered it, with the same markup, `data-invalid`, `aria-invalid` and `aria-describedby`,
 * and moves focus to the control so the message is read with it. The next input or change
 * in that Field takes the message away and restores the attributes it found.
 */

/** @type {WeakMap<Element, () => void>} */
const shown = new WeakMap()

/**
 * @param {Element} field
 * @param {Element} control
 * @returns {string}
 */
const fieldId = (field, control) => {
  const label = [...field.children].find((child) => child.getAttribute('data-ui') === 'field-label')
  const id = label?.getAttribute('for') || label?.getAttribute('id')?.replace(/-label$/u, '') || control.id
  return id || `field-${Math.random().toString(36).slice(2, 10)}`
}

/**
 * Removes a message `showFieldError` put on the Field holding `control`, or one the Field
 * was rendered with. Does nothing when the Field shows no error.
 * @param {Element} control a control inside the Field, or the Field itself
 */
export const clearFieldError = (control) => {
  const field = control.closest(FIELD)
  if (!field) return
  const clear = shown.get(field)
  if (clear) {
    clear()
    return
  }
  const error = [...field.children].find((child) => child.getAttribute('data-ui') === 'field-error')
  if (!error) return
  const token = error.id
  error.remove()
  field.setAttribute('data-invalid', 'false')
  for (const target of field.querySelectorAll(CONTROLS)) {
    if (target.closest(FIELD) !== field) continue
    target.removeAttribute('aria-invalid')
    const rest = (target.getAttribute('aria-describedby') ?? '')
      .split(/\s+/u)
      .filter((id) => id && id !== token)
    if (rest.length) target.setAttribute('aria-describedby', rest.join(' '))
    else target.removeAttribute('aria-describedby')
  }
}

/**
 * Shows `message` under the Field that holds `control`, as `Field` renders its `error`, and
 * focuses the control. A second call replaces the first message. Returns a function that
 * removes the message, which also happens on the next input or change in the Field.
 * `announce` is for a check that answers while the person is still typing in the Field: focus
 * stays where it is, so the message is an alert and is read out when it appears.
 * @param {HTMLElement} control a control inside the Field; for a choice group, any of its inputs
 * @param {string} message
 * @param {{ focus?: boolean, announce?: boolean }} [options]
 * @returns {() => void}
 */
export const showFieldError = (control, message, options = {}) => {
  const field = control.closest(FIELD)
  if (!field) return () => {}
  clearFieldError(field)
  const document = field.ownerDocument
  const token = `${fieldId(field, control)}-error`
  const error = document.createElement('small')
  error.setAttribute('data-ui', 'field-error')
  error.id = token
  if (options.announce === true) error.setAttribute('role', 'alert')
  const text = document.createElement('span')
  text.setAttribute('data-ui', 'text')
  text.setAttribute('data-tone', 'default')
  text.textContent = message
  error.append(text)
  field.append(error)
  const invalid = field.getAttribute('data-invalid')
  field.setAttribute('data-invalid', 'true')
  const targets = [...field.querySelectorAll(CONTROLS)].filter((target) => target.closest(FIELD) === field)
  if (!targets.includes(control)) targets.push(control)
  const before = targets.map((target) => ({
    target,
    ariaInvalid: target.getAttribute('aria-invalid'),
    describedBy: target.getAttribute('aria-describedby'),
  }))
  for (const target of targets) {
    const ids = (target.getAttribute('aria-describedby') ?? '').split(/\s+/u).filter(Boolean)
    target.setAttribute('aria-invalid', 'true')
    target.setAttribute('aria-describedby', [...ids.filter((id) => id !== token), token].join(' '))
  }
  const restore = (
    /** @type {Element} */ target,
    /** @type {string} */ name,
    /** @type {string | null} */ value,
  ) => (value === null ? target.removeAttribute(name) : target.setAttribute(name, value))
  const clear = () => {
    if (shown.get(field) !== clear) return
    shown.delete(field)
    field.removeEventListener('input', clear)
    field.removeEventListener('change', clear)
    error.remove()
    restore(field, 'data-invalid', invalid)
    for (const { target, ariaInvalid, describedBy } of before) {
      restore(target, 'aria-invalid', ariaInvalid)
      restore(target, 'aria-describedby', describedBy)
    }
  }
  shown.set(field, clear)
  field.addEventListener('input', clear)
  field.addEventListener('change', clear)
  if (options.focus !== false) control.focus()
  return clear
}
