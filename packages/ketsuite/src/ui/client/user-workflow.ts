import { clearFieldError, showFieldError } from '@ketvietlab/design-system'

type EmailMessages = Record<'checking' | 'available' | 'taken' | 'invalid' | 'unknown', string>

/**
 * The create-user form (`ui/user-workflow.tsx`): checks the email while it is typed. The result is said in the
 * email field's help line; an email someone already uses is the field's error, as the server would render it.
 * The server checks the email again when the step is submitted, so a check that could not run leaves the
 * form free to submit. The words come from the form, in the page's language.
 */
export function installUserWorkflow(lifetime: AbortSignal): () => void {
  let abort: AbortController | undefined,
    timer: ReturnType<typeof setTimeout> | undefined,
    sequence = 0
  async function check(form: HTMLFormElement, edited = false) {
    const input = form.querySelector<HTMLInputElement>('input[type=email]'),
      status = input && document.getElementById(`${input.id}-help`)
    if (!input || !status) return
    abort?.abort()
    clearTimeout(timer)
    const request = ++sequence
    const value = input.value.trim(),
      next = form.querySelector<HTMLButtonElement>('[data-ui="form-actions"] button[type="submit"]'),
      words = JSON.parse(form.dataset.emailMessages ?? '{}') as Partial<EmailMessages>
    // The server's message about the email is about what was submitted, not what is typed now.
    if (edited) clearFieldError(input)
    /** `taken` stops the step; `unknown` lets it through for the server to decide. */
    const paint = (message: string, state: 'available' | 'taken' | 'checking' | 'unknown') => {
      if (next) next.disabled = state === 'taken' || state === 'checking'
      form.dataset.emailAvailable = state === 'taken' ? 'false' : 'true'
      if (state === 'taken') {
        // The help line goes back to what it said; the answer is the field's error, read out at once.
        status.textContent = status.dataset.help ?? ''
        showFieldError(input, message, { focus: false, announce: true })
        return
      }
      status.textContent = message
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) {
      // An empty field keeps the help the page was drawn with.
      paint(value ? (words.invalid ?? '') : (status.dataset.help ?? ''), 'unknown')
      return
    }
    paint(words.checking ?? '', 'checking')
    timer = setTimeout(async () => {
      abort = new AbortController()
      try {
        const response = await fetch(form.dataset.emailCheck!, {
          method: 'POST',
          cache: 'no-store',
          headers: { 'content-type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams({ email: value }),
          signal: AbortSignal.any([abort.signal, AbortSignal.timeout(10000)]),
        })
        if (!response.ok) throw new Error('email-check-failed')
        const result = (await response.json()) as { available: boolean; ok: boolean }
        if (request !== sequence || !form.isConnected) return
        if (!result.ok) throw new Error('email-check-failed')
        paint(
          (result.available ? words.available : words.taken) ?? '',
          result.available ? 'available' : 'taken',
        )
      } catch {
        if (request !== sequence || !form.isConnected) return
        paint(words.unknown ?? '', 'unknown')
      }
    }, 400)
  }
  function scan() {
    for (const form of document.querySelectorAll<HTMLFormElement>('form[data-user-workflow]'))
      if (!form.dataset.initialized) {
        form.dataset.initialized = 'true'
        const input = form.querySelector<HTMLInputElement>('input[type=email]'),
          status = input && document.getElementById(`${input.id}-help`)
        if (!input || !status) continue
        status.dataset.help = status.textContent ?? ''
        status.setAttribute('role', 'status')
        status.setAttribute('aria-live', 'polite')
        // A refused email keeps the server's reason in view until the person edits it.
        if (input.getAttribute('aria-invalid') !== 'true') void check(form)
      }
  }
  document.addEventListener(
    'input',
    (event) => {
      const input = event.target as HTMLInputElement,
        form = input.closest<HTMLFormElement>('form[data-user-workflow]')
      if (form && input.type === 'email') void check(form, true)
    },
    { signal: lifetime },
  )
  document.addEventListener(
    'submit',
    (event) => {
      const form = event.target as HTMLFormElement
      if (form.matches('form[data-user-workflow]') && form.dataset.emailAvailable === 'false')
        event.preventDefault()
    },
    { signal: lifetime },
  )
  const observer = new MutationObserver(scan)
  observer.observe(document.documentElement, { childList: true, subtree: true })
  scan()
  return () => {
    abort?.abort()
    clearTimeout(timer)
    observer.disconnect()
  }
}
