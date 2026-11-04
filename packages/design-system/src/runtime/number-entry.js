// A number field with a `locale` (NumberField or MoneyField) is typed and read the way its language
// writes numbers: "28.600" is twenty-eight thousand six hundred in Vietnamese. The browser's number
// input reads "." as a decimal point whatever the language and shows no grouping, so these fields are
// text inputs. This runtime regroups a value when the reader leaves the field and puts the plain
// decimal ("28600") into the form data, which is what the server reads.

const FIELD = 'input[data-number-locale]'
const CANONICAL = /^(-?)(\d+)(?:\.(\d+))?$/u

/** @type {Map<string, { group: string, decimal: string }>} */
const known = new Map()

/** The grouping and decimal marks of a language, from the platform's own number format. */
const separators = (/** @type {string} */ locale) => {
  const cached = known.get(locale)
  if (cached) return cached
  let parts = []
  try {
    parts = new Intl.NumberFormat(locale).formatToParts(1234567.5)
  } catch {
    parts = new Intl.NumberFormat('en').formatToParts(1234567.5)
  }
  const marks = {
    group: parts.find((part) => part.type === 'group')?.value ?? ',',
    decimal: parts.find((part) => part.type === 'decimal')?.value ?? '.',
  }
  known.set(locale, marks)
  return marks
}

const escapeRegex = (/** @type {string} */ text) => text.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&')

/**
 * The plain decimal ("-1234.5") a reader meant, or null when the text is not a number in that
 * language. Grouping marks are accepted only in groups of three; a single mark that cannot be
 * grouping (Vietnamese "12.5") reads as the decimal point of the other habit. Empty text stays empty.
 * @param {string} text
 * @param {string} locale
 * @returns {string | null}
 */
export const parseLocaleNumber = (text, locale) => {
  if (typeof text !== 'string') return null
  let value = text.replace(/[\s  ]/gu, '').replace(/^−/u, '-')
  if (value === '') return ''
  const negative = value.startsWith('-')
  if (negative || value.startsWith('+')) value = value.slice(1)
  const { group, decimal } = separators(locale)
  let whole = value
  let fraction = ''
  const decimalAt = value.indexOf(decimal)
  if (decimalAt >= 0) {
    if (value.lastIndexOf(decimal) !== decimalAt) return null
    whole = value.slice(0, decimalAt)
    fraction = value.slice(decimalAt + 1)
    if (!/^\d+$/u.test(fraction)) return null
  }
  if (!/^\d*$/u.test(whole)) {
    if (new RegExp(`^\\d{1,3}(?:${escapeRegex(group)}\\d{3})+$`, 'u').test(whole))
      whole = whole.split(group).join('')
    else {
      const at = whole.indexOf(group)
      const single = decimalAt < 0 && at > 0 && at === whole.lastIndexOf(group)
      if (!single || !/^\d+$/u.test(whole.slice(0, at)) || !/^\d+$/u.test(whole.slice(at + 1))) return null
      fraction = whole.slice(at + 1)
      whole = whole.slice(0, at)
    }
  }
  if (whole === '' && fraction === '') return null
  whole = whole.replace(/^0+(?=\d)/u, '') || '0'
  const zero = /^0+$/u.test(whole) && !/[1-9]/u.test(fraction)
  return `${negative && !zero ? '-' : ''}${whole}${fraction ? `.${fraction}` : ''}`
}

/**
 * A plain decimal written for a language ("1.800.000" in Vietnamese). Anything else, such as text a
 * reader typed that is not a number, is shown as it is.
 * @param {string | number | null | undefined} value
 * @param {string} locale
 * @returns {string}
 */
export const formatLocaleNumber = (value, locale) => {
  const text = String(value ?? '').trim()
  const match = CANONICAL.exec(text)
  if (!match) return text
  const { group, decimal } = separators(locale)
  const whole = (match[2] ?? '').replace(/\B(?=(\d{3})+(?!\d))/gu, group)
  return `${match[1]}${whole}${match[3] ? `${decimal}${match[3]}` : ''}`
}

/**
 * What a control holds as data: the plain decimal of a localized number field (its text, or the given
 * text such as its default value), and the text unchanged for any other control or a typo.
 * @param {{ value?: string, getAttribute?: (name: string) => string | null }} control
 * @param {string} [text]
 * @returns {string}
 */
export const numberControlValue = (control, text = control?.value ?? '') => {
  const locale = control?.getAttribute?.('data-number-locale')
  if (!locale) return text
  const parsed = parseLocaleNumber(text, locale)
  return parsed === null ? text : parsed
}

/**
 * Put each localized field's plain decimal in the form data, in place of the text it shows. A name the
 * form submits from anything else as well is left as it is.
 * @param {readonly { name: string, value: string, getAttribute(name: string): string | null }[]} controls
 * @param {{ getAll(name: string): unknown[], delete(name: string): void, append(name: string, value: string): void }} formData
 */
export const normalizeNumberEntries = (controls, formData) => {
  /** @type {Map<string, typeof controls[number][]>} */
  const byName = new Map()
  for (const control of controls) byName.set(control.name, [...(byName.get(control.name) ?? []), control])
  for (const [name, list] of byName) {
    const values = formData.getAll(name)
    if (values.length !== list.length || values.some((value) => typeof value !== 'string')) continue
    formData.delete(name)
    list.forEach((control, index) => {
      formData.append(name, numberControlValue(control, /** @type {string} */ (values[index])))
    })
  }
}

const attached = new WeakSet()

/**
 * @param {Document} doc
 * @returns {() => void}
 */
export const attachNumberEntry = (doc = document) => {
  if (attached.has(doc)) return () => {}
  attached.add(doc)
  /** @param {Event} event */
  const regroup = (event) => {
    const input = /** @type {HTMLInputElement | null} */ (event.target)
    if (!input?.matches?.(FIELD) || input.readOnly) return
    const locale = input.getAttribute('data-number-locale') ?? ''
    const parsed = parseLocaleNumber(input.value, locale)
    if (!parsed) return
    const shown = formatLocaleNumber(parsed, locale)
    if (shown !== input.value) input.value = shown
  }
  /** @param {Event} event */
  const submit = (event) => {
    const form = /** @type {HTMLFormElement | null} */ (event.target)
    const formData = /** @type {FormDataEvent} */ (event).formData
    if (!form?.elements || !formData) return
    const controls = [...form.elements].filter(
      (control) =>
        /** @type {HTMLInputElement} */ (control).matches?.(FIELD) &&
        /** @type {HTMLInputElement} */ (control).name &&
        !(/** @type {HTMLInputElement} */ (control).disabled),
    )
    if (controls.length) normalizeNumberEntries(/** @type {HTMLInputElement[]} */ (controls), formData)
  }
  doc.addEventListener('focusout', regroup, true)
  doc.addEventListener('formdata', submit, true)
  return () => {
    doc.removeEventListener('focusout', regroup, true)
    doc.removeEventListener('formdata', submit, true)
    attached.delete(doc)
  }
}
