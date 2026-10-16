// @ts-nocheck Browser only; the island attaches it when it mounts and its lifetime ends it.
// What a CRM sales screen does around its island in the browser: command forms post in place, a draft is
// asked about before it is left, and a dialog the island draws becomes a client modal. DS owns every dialog,
// field and focus rule; the island owns the page and announces each drawing with `crm:sales-rendered`.

const copy = {
  vi: {
    discard: 'Huỷ thay đổi chưa lưu?',
    keep: 'Giữ nguyên',
    discardAction: 'Bỏ thay đổi',
    leave: 'Bỏ thay đổi chưa lưu trước khi rời trang?',
    other: 'Bỏ thay đổi ở form khác trước khi thực hiện thao tác này?',
    offline: 'Mất kết nối. Dữ liệu nhập vẫn giữ; thử lại.',
  },
  en: {
    discard: 'Discard unsaved changes?',
    keep: 'Keep working',
    discardAction: 'Discard changes',
    leave: 'Discard changes before leaving?',
    other: 'Discard the other unsaved form before this action?',
    offline: 'Connection failed. Your input is retained; retry.',
  },
}

/** Asks before a draft is dropped, in the shared small centred ConfirmDialog; resolves to the answer. */
const askToDiscard = ({ view, ds, words, message, signal }) => {
  const { createRoot, domHost, html } = view
  const invoking = document.activeElement,
    id = `crm-sales-confirm-${crypto.randomUUID()}`
  const host = document.createElement('div'),
    design = document.querySelector('[data-kv-design-system]')
  host.setAttribute('data-kv-design-system', '')
  for (const attribute of ['data-density', 'data-presentation', 'data-theme', 'data-kv-theme'])
    if (design?.hasAttribute(attribute)) host.setAttribute(attribute, design.getAttribute(attribute))
  document.body.append(host)
  const drawn = createRoot(domHost(), host)
  drawn.render(
    html`<form id=${id}>${ds.ConfirmDialog({
      id: `${id}-dialog`,
      title: words.discard,
      message,
      closeHref: location.href,
      closeLabel: words.keep,
      confirmForm: id,
      confirmLabel: words.discardAction,
      confirmVariant: 'destructive',
    })}</form>`,
  )
  const others = [...document.body.children].filter(
    (element) => element !== host && !element.matches('script, style'),
  )
  const inert = others.map((element) => [element, element.inert])
  for (const element of others) element.inert = true
  const own = new AbortController()
  return new Promise((resolve) => {
    const finish = (answer) => {
      own.abort()
      drawn.dispose({ remove: true })
      host.remove()
      for (const [element, was] of inert) if (element.isConnected) element.inert = was
      if (invoking?.isConnected && !invoking.closest('[inert]')) invoking.focus()
      resolve(answer)
    }
    signal.addEventListener('abort', () => finish(false), { once: true, signal: own.signal })
    addEventListener(
      'click',
      (event) => {
        if (!(event.target instanceof Element) || !host.contains(event.target)) return
        const control = event.target.closest("a, button, [data-ui='modal-backdrop']")
        if (!control) return
        event.preventDefault()
        event.stopImmediatePropagation()
        finish(control.matches('button[name="intent"][value="confirm"]'))
      },
      { capture: true, signal: own.signal },
    )
    addEventListener(
      'submit',
      (event) => {
        if (!host.contains(event.target)) return
        event.preventDefault()
        event.stopImmediatePropagation()
        finish(true)
      },
      { capture: true, signal: own.signal },
    )
    addEventListener(
      'keydown',
      (event) => {
        if (event.key === 'Escape') {
          event.preventDefault()
          event.stopImmediatePropagation()
          finish(false)
          return
        }
        if (event.key !== 'Tab') return
        event.stopImmediatePropagation()
        const controls = [
          ...host.querySelectorAll('a[href], button:not(:disabled), input:not(:disabled), [tabindex="0"]'),
        ].filter((element) => element.getClientRects().length)
        const first = controls[0],
          last = controls.at(-1)
        if (event.shiftKey && (document.activeElement === first || !host.contains(document.activeElement))) {
          event.preventDefault()
          last?.focus()
        } else if (
          !event.shiftKey &&
          (document.activeElement === last || !host.contains(document.activeElement))
        ) {
          event.preventDefault()
          first?.focus()
        }
      },
      { capture: true, signal: own.signal },
    )
    host.querySelector('footer a[href]')?.focus()
  })
}

export const attachSalesRuntime = ({ view, ds, routes, root, signal, lang = 'vi' }) => {
  const words = copy[lang === 'en' ? 'en' : 'vi']
  // What the reader typed, per command form, when it was drawn. Hidden inputs (versions, request ids)
  // follow the data and never make a form unsaved.
  const dirty = new Map()
  const typed = (form) =>
    JSON.stringify(
      [...form.elements]
        .filter((field) => field.name && !['hidden', 'submit', 'button'].includes(field.type))
        .map((field) => [
          field.name,
          field.type === 'checkbox' || field.type === 'radio' ? field.checked : field.value,
        ]),
    )
  const forms = () =>
    root.querySelectorAll('form[data-ui="record-form"][method="post"],form[data-crm-command]')
  const changed = (except = null) =>
    [...dirty].some(([form, value]) => form !== except && form.isConnected && typed(form) !== value)
  const command = new URL(routes.command, location.href).pathname
  const ask = (message) => askToDiscard({ view, ds, words, message, signal })

  let submitting = false,
    prompting = false,
    layer = null,
    releaseDialog = () => {}
  const scan = (reset) => {
    if (reset) dirty.clear()
    for (const form of dirty.keys()) if (!form.isConnected) dirty.delete(form)
    for (const form of forms()) if (!dirty.has(form)) dirty.set(form, typed(form))
  }
  // A dialog drawn by the island becomes a client modal once; redrawing it (a quote line added) keeps the
  // same layer and the reader's focus. Closing it is a link the island follows in place.
  const dialog = () => {
    const next = root.querySelector('[data-ui="modal-layer"][data-route-modal="true"]')
    if (next && next !== layer) {
      releaseDialog()
      layer = next
      layer.removeAttribute('data-route-modal')
      layer.setAttribute('data-client-modal', 'true')
      releaseDialog = ds.attachClientModalInteractions(root)
    } else if (layer && !layer.isConnected) {
      releaseDialog()
      layer = null
      releaseDialog = () => {}
    }
  }
  signal.addEventListener('abort', () => releaseDialog(), { once: true })
  document.addEventListener(
    'crm:sales-rendered',
    (event) => {
      scan(event.detail?.reset)
      dialog()
    },
    { signal },
  )
  // Following a link leaves the drafts on this page: ask first. The help drawer is not leaving.
  document.addEventListener(
    'click',
    async (event) => {
      const link = event.target instanceof Element ? event.target.closest('a[href]') : null
      if (
        !link ||
        event.defaultPrevented ||
        event.button !== 0 ||
        event.ctrlKey ||
        event.metaKey ||
        event.shiftKey ||
        link.target ||
        link.hasAttribute('download') ||
        link.getAttribute('href').startsWith('#') ||
        link.closest('[data-ui="help-drawer"]') ||
        submitting ||
        prompting ||
        !changed()
      )
        return
      event.preventDefault()
      event.stopImmediatePropagation()
      prompting = true
      const proceed = await ask(words.leave)
      prompting = false
      if (!proceed) return
      // The confirmation already authorised discarding: forget the drafts, then follow the link.
      dirty.clear()
      const go = new CustomEvent('crm:sales-navigate', { cancelable: true, detail: { href: link.href } })
      if (document.dispatchEvent(go)) {
        submitting = true
        location.assign(link.href)
      }
    },
    { capture: true, signal },
  )
  document.addEventListener(
    'submit',
    async (event) => {
      const form = event.target
      if (
        !(form instanceof HTMLFormElement) ||
        !root.contains(form) ||
        form.method !== 'post' ||
        new URL(form.action, location.href).pathname !== command
      )
        return
      event.preventDefault()
      if (submitting) return
      if (changed(form)) {
        if (prompting) return
        prompting = true
        const proceed = await ask(words.other)
        prompting = false
        if (!proceed) return
      }
      submitting = true
      form.setAttribute('aria-busy', 'true')
      form.querySelector('[data-crm-network-error]')?.remove()
      const data = new URLSearchParams(
        [...new FormData(form, event.submitter)].filter(([, value]) => typeof value === 'string'),
      )
      if (routes.demo) {
        const scenario = new URLSearchParams(location.search).get('writeScenario')
        if (scenario) data.set('scenario', scenario)
      }
      try {
        const response = await fetch(form.action, {
          method: 'POST',
          headers: { 'x-crm-sales-resolve': '1' },
          body: data,
          signal,
        })
        const result = await response.json()
        if (!result.location) throw Error('No destination')
        submitting = false
        form.removeAttribute('aria-busy')
        // The island draws its own screen in place, with the command's reply; another screen is a page load.
        const go = new CustomEvent('crm:sales-navigate', {
          cancelable: true,
          detail: {
            href: result.location,
            command: data.get('command'),
            response: result.response ?? null,
            notice: result.notice ?? null,
          },
        })
        if (document.dispatchEvent(go)) {
          submitting = true
          location.assign(result.location)
        }
      } catch (error) {
        if (error?.name === 'AbortError') return
        submitting = false
        form.removeAttribute('aria-busy')
        // Keep the DOM and the draft when the request fails.
        const status = document.createElement('p')
        status.setAttribute('data-crm-network-error', '')
        status.setAttribute('role', 'alert')
        status.textContent = words.offline
        form.prepend(status)
      }
    },
    { signal },
  )
  addEventListener(
    'beforeunload',
    (event) => {
      if (changed() && !submitting) {
        event.preventDefault()
        event.returnValue = ''
      }
    },
    { signal },
  )
}
