// @ts-nocheck Shared by the server render and the browser; its tests exercise it.
// `crm.sales-screen`: one island owns a CRM sales screen whole — title, commands, controls, body, aside
// and dialogs — like Customer Care's follow-up workspace. The server sends the shell, this island and the
// help drawer; the page is drawn from `/_ket/fn/crm.sales.read` and redrawn in place as the address changes.
import { createSalesScreens, salesTitle } from './screens.mjs'
import { salesDataQuery } from './kit.mjs'
import { quoteLineKeys } from './dialogs.mjs'
import { createCrmSalesBook, salesBookProps } from './book.mjs'
import { attachSalesRuntime } from './runtime.mjs'

// Simulated read outcomes (`scenario=` in the address) of a demo's routes, each shown once; Retry then reads
// for real.
const simulated = ['loading', 'offline', 'error', 'denied']
const dialogKeys = ['dialog', 'id', 'activity', 'quote', 'group', 'configId', 'memberId']

export const createSalesIsland = ({ view, ds, routes }) => {
  const { signal, batch, mount, domHost } = view
  const screens = createSalesScreens({ view, ds, routes })
  let book = null

  return (props) => {
    const lang = props.lang === 'en' ? 'en' : 'vi'
    const phase = signal('loading'),
      data = signal(null),
      // The address the drawn page answers. It moves with its read, so a page never shows one address's
      // controls over another address's data; soft keys (peek, tab, bucket) move at once.
      address = signal(String(props.query ?? '')),
      lead = signal({})
    const quotes = new Map(),
      requests = new Map()
    const env = () => ({
      screen: props.screen,
      query: address(),
      lang,
      requestId: (key) => {
        if (!requests.has(key))
          requests.set(key, globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${requests.size}`)
        return requests.get(key)
      },
      quoteLines: (key, initial) => {
        if (!quotes.has(key)) quotes.set(key, signal(initial.map((line) => ({ ...line }))))
        return quotes.get(key)()
      },
      leadDraft: () => lead(),
    })

    let root = null,
      mounted = false,
      title = '',
      pending = false,
      after = { reset: false, focus: null, resync: null },
      // What follows each drawing (title, book, peek, focus); the mounted island supplies it.
      rendered = () => {}
    const settle = () => {
      if (!mounted || pending) return
      pending = true
      queueMicrotask(() => {
        pending = false
        rendered()
      })
    }

    return {
      view: () => {
        const state = phase(),
          model = data()
        if (model && (state === 'ready' || state === 'loading')) {
          const drawn = screens.page(model, env())
          title = drawn.title
          settle()
          return drawn.view
        }
        settle()
        return screens.frame(env(), state)
      },
      mount: ({ root: element, lifetime }) => {
        root = element
        mounted = true
        attachSalesRuntime({ view, ds, routes, root: element, signal: lifetime, lang })
        const suffix = document.title.includes(' · ')
          ? document.title.slice(document.title.indexOf(' · '))
          : ''
        let scenario = routes.demo && simulated.includes(props.scenario) ? props.scenario : null,
          controller = null,
          sequence = 0,
          // The reply of the last command (a refusal with its draft, or a notice), when the host hands it over
          // with the destination instead of keeping it for the next read.
          carried = null

        const read = async (query, next = {}) => {
          const current = ++sequence
          controller?.abort()
          controller = new AbortController()
          after = { ...after, ...next }
          if (data()) root.setAttribute('aria-busy', 'true')
          else phase.set('loading')
          const requested = scenario
          if (requested && requested !== 'loading') scenario = null
          if (requested === 'loading') return
          if (requested) {
            root.removeAttribute('aria-busy')
            batch(() => {
              data.set(null)
              phase.set(requested)
            })
            return
          }
          try {
            const response = await fetch(routes.read(query), {
              method: 'POST',
              headers: { 'content-type': 'application/json' },
              body: JSON.stringify({ query }),
              signal: controller.signal,
            })
            if (!response.ok) throw Object.assign(new Error('CRM read failed'), { status: response.status })
            const reply = await response.json()
            if (current !== sequence) return
            if (!reply?.ok) throw new Error('Invalid CRM reply')
            root.removeAttribute('aria-busy')
            const value = carried ? { ...reply.value, ...carried } : reply.value
            carried = null
            batch(() => {
              address.set(query)
              data.set(value)
              phase.set('ready')
            })
          } catch (error) {
            if (current !== sequence || error.name === 'AbortError') return
            root.removeAttribute('aria-busy')
            batch(() => {
              data.set(null)
              phase.set(error.status === 403 ? 'denied' : error instanceof TypeError ? 'offline' : 'error')
            })
          }
        }

        // ── Following an address ────────────────────────────────────────────────────────────
        const own = (url) =>
          url.origin === location.origin && routes.parse(url)?.get('screen') === props.screen
        const go = (url, { history: mode = 'push', reset = false, force = false } = {}) => {
          const next = routes.parse(url).toString(),
            shown = new URLSearchParams(address())
          if (mode === 'push') history.pushState(null, '', url.href)
          else if (mode === 'replace') history.replaceState(null, '', url.href)
          // A dialog that closes hands focus back to whatever opened it: the link naming the same dialog
          // for the same subject (record, activity, quote, member, setting).
          const closing =
            shown.get('dialog') && !new URLSearchParams(next).get('dialog')
              ? Object.fromEntries(
                  dialogKeys.filter((key) => shown.has(key)).map((key) => [key, shown.get(key)]),
                )
              : null
          if (props.screen === 'cases') dispatchEvent(new CustomEvent('list:navigate'))
          if (
            !reset &&
            !force &&
            data() &&
            phase() === 'ready' &&
            salesDataQuery(next) === salesDataQuery(address())
          ) {
            after = { ...after, focus: closing }
            address.set(next)
            return
          }
          read(next, { reset, focus: closing })
        }
        const closeMenus = (element) => {
          for (
            let open = element.closest('details[open]');
            open;
            open = open.parentElement?.closest('details[open]')
          )
            open.removeAttribute('open')
        }
        root.addEventListener(
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
            const target = event.target instanceof Element ? event.target : null
            if (target?.closest('#crm-sales-retry')) {
              read(address())
              return
            }
            const link = target?.closest('a[href]')
            if (!(link instanceof HTMLAnchorElement) || link.target || link.hasAttribute('download')) return
            const url = new URL(link.href, location.href)
            if (!own(url)) return
            event.preventDefault()
            closeMenus(link)
            go(url)
          },
          { signal: lifetime },
        )
        // A search or filter form of this screen (GET) is followed the same way.
        root.addEventListener(
          'submit',
          (event) => {
            const form = event.target
            if (
              event.defaultPrevented ||
              !(form instanceof HTMLFormElement) ||
              form.method.toLowerCase() !== 'get'
            )
              return
            const url = new URL(form.action, location.href)
            url.search = new URLSearchParams(
              [...new FormData(form, event.submitter)].filter(([, value]) => typeof value === 'string'),
            ).toString()
            if (!own(url)) return
            event.preventDefault()
            go(url)
          },
          { signal: lifetime },
        )
        addEventListener(
          'popstate',
          () => {
            const url = new URL(location.href)
            if (!own(url)) location.reload()
            else go(url, { history: 'none' })
          },
          { signal: lifetime },
        )
        // The command runtime (and the bulk selection) hands over a destination: this screen's own is
        // drawn in place; a successful write starts its forms afresh, a refusal keeps the draft.
        document.addEventListener(
          'crm:sales-navigate',
          (event) => {
            const url = new URL(event.detail?.href ?? '', location.href)
            if (!own(url)) return
            event.preventDefault()
            const { response = null, notice = null } = event.detail ?? {}
            carried = response || notice ? { response, notice } : null
            go(url, {
              reset: !url.searchParams.has('error') && !response && !!event.detail?.command,
              force: !!carried,
            })
          },
          { signal: lifetime },
        )
        addEventListener('online', () => ['offline', 'error'].includes(phase()) && read(address()), {
          signal: lifetime,
        })

        // ── Quote lines: totals follow every keystroke ──────────────────────────────────────
        const linesOf = (editor) =>
          Array.from({ length: editor.querySelectorAll('[name^="product-"]').length }, (_, i) =>
            Object.fromEntries(
              quoteLineKeys.map((part) => [part, editor.querySelector(`[name="${part}-${i}"]`)?.value ?? '']),
            ),
          )
        const editorOf = (element) => element?.closest?.('[data-crm-quote-editor]')
        root.addEventListener(
          'click',
          (event) => {
            const button =
                event.target instanceof Element
                  ? event.target.closest('button[name="add-line"],button[name="remove-line"]')
                  : null,
              editor = editorOf(button)
            if (!button || !editor) return
            event.preventDefault()
            const key = editor.dataset.crmQuoteEditor,
              lines = linesOf(editor)
            if (button.name === 'add-line') {
              const product = data()?.products?.[0]
              lines.push({
                product: product?.id ?? '',
                quantity: 1,
                price: product?.price ?? 0,
                discount: 0,
                tax: 8,
              })
            } else lines.splice(Number(button.value), 1)
            after = {
              ...after,
              resync: key,
              focusLine:
                button.name === 'add-line' ? lines.length - 1 : Math.max(0, Number(button.value) - 1),
            }
            quotes.get(key)?.set(lines)
          },
          { signal: lifetime },
        )
        root.addEventListener(
          'input',
          (event) => {
            const editor = editorOf(event.target)
            if (editor) quotes.get(editor.dataset.crmQuoteEditor)?.set(linesOf(editor))
          },
          { signal: lifetime },
        )
        root.addEventListener(
          'change',
          (event) => {
            const field = event.target,
              editor = editorOf(field)
            if (!editor || !(field instanceof HTMLSelectElement) || !field.name.startsWith('product-')) return
            // Choosing a product brings its list price; the reader may still change it.
            const product = data()?.products?.find((p) => p.id === field.value),
              price = editor.querySelector(`[name="price-${field.name.slice(8)}"]`)
            if (product && price instanceof HTMLInputElement) price.value = String(product.price)
            quotes.get(editor.dataset.crmQuoteEditor)?.set(linesOf(editor))
          },
          { signal: lifetime },
        )

        // ── New record: the contact typed is checked against existing customers ─────────────
        let typing = 0
        root.addEventListener(
          'input',
          (event) => {
            const form =
              event.target instanceof Element ? event.target.closest('[data-crm-lead-form] form') : null
            if (!form || !['phone', 'email', 'partnerId'].includes(event.target.name)) return
            clearTimeout(typing)
            typing = setTimeout(() => {
              const values = new FormData(form)
              lead.set({
                phone: values.get('phone') ?? '',
                email: values.get('email') ?? '',
                partnerId: values.get('partnerId') ?? '',
              })
            }, 300)
          },
          { signal: lifetime },
        )

        // ── Pipeline: drag a card to another stage ──────────────────────────────────────────
        let dragging = null
        const cardOf = (id) =>
          data()
            ?.pipeline?.lanes.flatMap((lane) => lane.cards)
            .find((card) => card.id === id) ?? null
        const accepts = (row, stageId) => {
          const stage = data()?.stages.find((s) => s.id === stageId)
          return (
            !!stage &&
            stage.active &&
            stage.terminalState === 'open' &&
            !stage.fold &&
            stage.id !== row.stageId &&
            stage.allowedKinds.includes(row.kind) &&
            (!stage.teamId || stage.teamId === row.teamId)
          )
        }
        const lanes = () => root.querySelectorAll('[data-crm-board] [data-crm-lane][data-crm-stage]')
        const endDrag = () => {
          dragging = null
          for (const lane of lanes()) lane.removeAttribute('data-drop-state')
          for (const card of root.querySelectorAll('[data-ui="kanban-card"][data-dragging]'))
            card.removeAttribute('data-dragging')
        }
        root.addEventListener(
          'dragstart',
          (event) => {
            const card =
              event.target instanceof Element
                ? event.target.closest('[data-crm-board] [data-ui="kanban-card"][draggable="true"]')
                : null
            const row = card ? cardOf(card.dataset.key) : null
            if (!row) return
            dragging = row
            event.dataTransfer.effectAllowed = 'move'
            event.dataTransfer.setData('text/plain', row.id)
            card.setAttribute('data-dragging', 'true')
            for (const lane of lanes())
              lane.setAttribute('data-drop-state', accepts(row, lane.dataset.crmStage) ? 'accept' : 'reject')
          },
          { signal: lifetime },
        )
        root.addEventListener(
          'dragover',
          (event) => {
            const lane =
              event.target instanceof Element
                ? event.target.closest("[data-crm-lane][data-drop-state='accept']")
                : null
            if (!dragging || !lane) return
            event.preventDefault()
            event.dataTransfer.dropEffect = 'move'
          },
          { signal: lifetime },
        )
        root.addEventListener(
          'drop',
          (event) => {
            const lane =
                event.target instanceof Element
                  ? event.target.closest("[data-crm-lane][data-drop-state='accept']")
                  : null,
              row = dragging,
              form = root.querySelector('#crm-sales-move')
            endDrag()
            if (!lane || !row || !(form instanceof HTMLFormElement)) return
            event.preventDefault()
            const set = (name, value) => {
              const input = form.elements.namedItem(name)
              if (input instanceof HTMLInputElement) input.value = value
            }
            set('id', row.id)
            set('version', String(row.version))
            set('stageId', lane.dataset.crmStage)
            set('requestId', globalThis.crypto?.randomUUID?.() ?? `${Date.now()}`)
            form.requestSubmit()
          },
          { signal: lifetime },
        )
        root.addEventListener('dragend', endDrag, { signal: lifetime })

        // ── After each drawing ──────────────────────────────────────────────────────────────
        let peekLayout = null,
          releasePeek = () => {},
          bookMount = null
        const unmountBook = () => {
          bookMount?.dispose()
          bookMount = null
        }
        const mountBook = () => {
          const parts = ['controls', 'results', 'footer']
          const wrappers = parts.map((part) => root.querySelector(`[data-crm-book="${part}"]`))
          if (bookMount && wrappers.every((wrapper, i) => wrapper === bookMount.wrappers[i])) return
          unmountBook()
          if (!wrappers.every(Boolean) || !data()) return
          book ??= createCrmSalesBook({ view, ds, browser: true, lang, routes }, 'cases')
          const bookProps = salesBookProps(data(), address(), lang, routes),
            alive = new AbortController()
          const views = parts.map((part, i) => {
            const island = book[part](bookProps)
            const drawn = mount(domHost(), wrappers[i], island.view)
            island.mount?.({ root: wrappers[i], lifetime: alive.signal })
            return drawn
          })
          bookMount = {
            wrappers,
            dispose: () => {
              alive.abort()
              for (const drawn of views) drawn.dispose()
            },
          }
        }
        rendered = () => {
          if (!root?.isConnected) return
          // `drawn`: the page is on screen (perhaps while its next read runs); `ready`: that read landed.
          const drawn = !!data() && ['ready', 'loading'].includes(phase()),
            ready = drawn && phase() === 'ready'
          document.title = `${drawn ? title : salesTitle(props.screen, lang)}${suffix}`
          document.documentElement.dataset.crmSales = phase()
          // A write lands in the list's own read: the list starts again from the server.
          if (props.screen === 'cases') {
            if (after.reset && ready) unmountBook()
            drawn ? mountBook() : unmountBook()
          }
          // Board cards open the peek beside the board; the peek runtime returns focus to the card.
          const layout = root.querySelector('[data-ui="peek-layout"]')
          if (layout !== peekLayout) {
            releasePeek()
            peekLayout = layout
            releasePeek = layout ? ds.attachPeekInteractions(layout) : () => {}
          }
          if (layout) {
            const peeked = new URLSearchParams(address()).get('peek')
            for (const card of layout.querySelectorAll(
              '[data-ui="peek-layout-main"] [data-ui="kanban-card"]',
            )) {
              const link = card.querySelector('h3 a, a[href]')
              if (!link) continue
              link.setAttribute('aria-controls', layout.dataset.peekId)
              if (card.dataset.key === peeked) link.setAttribute('aria-current', 'true')
              else link.removeAttribute('aria-current')
            }
          }
          // Lines that moved under their inputs (one removed above them) show their own values again.
          if (after.resync) {
            const editor = root.querySelector(`[data-crm-quote-editor="${CSS.escape(after.resync)}"]`),
              lines = quotes.get(after.resync)?.peek?.() ?? []
            if (editor)
              lines.forEach((line, i) => {
                for (const part of quoteLineKeys) {
                  const input = editor.querySelector(`[name="${part}-${i}"]`)
                  if (input && input.value !== String(line[part] ?? ''))
                    input.value = String(line[part] ?? '')
                }
              })
            editor?.querySelector(`[name="product-${after.focusLine ?? 0}"]`)?.focus()
          }
          const reset = after.reset && ready
          if (reset)
            for (const form of root.querySelectorAll('form'))
              if (!form.closest('[data-crm-book]')) form.reset()
          if (after.focus && ready) {
            const wanted = Object.entries(after.focus)
            const trigger = [...root.querySelectorAll('a[href]')].find((link) => {
              // Compared as addresses: a host may carry the record id in the path rather than the query.
              const url = new URL(link.href, location.href),
                params = routes.parse(url) ?? url.searchParams
              return wanted.every(([key, value]) => params.get(key) === value)
            })
            // The row that opened it may be gone (the activity is done): the page heading takes focus instead.
            const heading = trigger ? null : root.querySelector('h1')
            if (heading && !heading.hasAttribute('tabindex')) heading.setAttribute('tabindex', '-1')
            ;(trigger ?? heading)?.focus?.()
          }
          if (ready) after = { reset: false, focus: null, resync: null }
          document.dispatchEvent(new CustomEvent('crm:sales-rendered', { detail: { reset } }))
        }
        lifetime.addEventListener(
          'abort',
          () => {
            mounted = false
            controller?.abort()
            clearTimeout(typing)
            releasePeek()
            unmountBook()
          },
          { once: true },
        )
        read(address())
      },
    }
  }
}
