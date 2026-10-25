/** Full-page native forms: the server owns draft values and the host owns navigation. */
export const nativeFormValues = (form: HTMLFormElement): string =>
  JSON.stringify(
    Array.from(form.elements).flatMap<unknown>((element) => {
      if (!['INPUT', 'SELECT', 'TEXTAREA'].includes(element.tagName)) return []
      const field = element as HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement
      if (!field.name) return []
      if (field.type === 'checkbox' || field.type === 'radio')
        return [[field.name, field.value, (field as HTMLInputElement).checked]]
      if (field.type === 'select-multiple')
        return [
          [
            field.name,
            Array.from((field as HTMLSelectElement).selectedOptions).map((option) => option.value),
          ],
        ]
      return [[field.name, field.value]]
    }),
  )

type DraftBaseline = { values: string; initialDraft: boolean; url: string; state: unknown }
export const installNativeFormGuard = (document: Document, lifetime: AbortSignal): (() => void) => {
  const baselines = new WeakMap<HTMLFormElement, DraftBaseline>()
  let approvedUnload = false
  const forms = () =>
    [...document.querySelectorAll<HTMLFormElement>('form[data-unsaved-prompt]')].filter(
      (form) => !form.closest('[role="dialog"]'),
    )
  const capture = () => {
    for (const form of forms())
      if (!baselines.has(form))
        baselines.set(form, {
          values: nativeFormValues(form),
          initialDraft: form.dataset.initialDraft === 'true',
          url: location.href,
          state: history.state,
        })
  }
  capture()
  const observer = new MutationObserver(capture)
  observer.observe(document.body, { childList: true, subtree: true })
  const draft = () =>
    forms().find((form) => {
      const baseline = baselines.get(form)
      return baseline && (baseline.initialDraft || nativeFormValues(form) !== baseline.values)
    })
  const allow = (form: HTMLFormElement) => {
    const accepted = globalThis.confirm(form.dataset.unsavedPrompt)
    approvedUnload = accepted
    return accepted
  }
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
      const anchor =
        event.target instanceof Element ? event.target.closest<HTMLAnchorElement>('a[href]') : null
      if (!anchor || anchor.hasAttribute('download') || (anchor.target && anchor.target !== '_self')) return
      const target = new URL(anchor.href, location.href),
        current = new URL(location.href)
      if (
        target.origin === current.origin &&
        target.pathname === current.pathname &&
        target.search === current.search
      )
        return
      const form = draft()
      if (form && !allow(form)) {
        event.preventDefault()
        event.stopPropagation()
      }
    },
    { capture: true, signal: lifetime },
  )
  document.addEventListener(
    'submit',
    (event) => {
      if (event.defaultPrevented) return
      const form = draft()
      if (!form) return
      if (event.target === form) {
        queueMicrotask(() => {
          if (!event.defaultPrevented) approvedUnload = true
        })
        return
      }
      if (!allow(form)) {
        event.preventDefault()
        event.stopPropagation()
      }
    },
    { capture: true, signal: lifetime },
  )
  document.addEventListener(
    'ket:popstate',
    (event) => {
      if (event.defaultPrevented) return
      const form = draft(),
        baseline = form && baselines.get(form)
      if (form && baseline && !allow(form)) {
        event.preventDefault()
        event.stopPropagation()
        // A declined history traversal keeps the mounted draft and restores its URL.
        history.pushState(baseline.state, '', baseline.url)
      }
    },
    { signal: lifetime },
  )
  window.addEventListener(
    'beforeunload',
    (event) => {
      if (!approvedUnload && draft()) {
        event.preventDefault()
        event.returnValue = ''
      }
    },
    { signal: lifetime },
  )
  document.addEventListener(
    'ket:navigation-complete',
    () => {
      approvedUnload = false
      capture()
      // Fragments mount before the shell commits history; update ownership after that commit.
      for (const form of forms()) {
        const baseline = baselines.get(form)
        if (baseline) {
          baseline.url = location.href
          baseline.state = history.state
        }
      }
    },
    { signal: lifetime },
  )
  document.addEventListener(
    'ket:navigation-error',
    () => {
      approvedUnload = false
      capture()
    },
    { signal: lifetime },
  )
  return () => observer.disconnect()
}
