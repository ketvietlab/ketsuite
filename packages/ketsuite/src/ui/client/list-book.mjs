// @ts-nocheck Shared by the server render and the browser; its tests exercise it.
// The engine behind the lists that read one page of one query at a time, including every collection built
// on `collection-book.mjs`. Each is three islands sharing one store: controls in the page's controls slot, a KetTable in its body and the
// row pager in its footer. The server renders a bounded optional first page, or its loading contract; the browser asks the list's
// read through `/_ket/fn` for the page it shows. Every control is a link or a GET form the page would
// follow without this runtime; the runtime follows them in place and keeps the URL, the history and the
// result in step.
//
// A row opens its record's page with the way back in `returnTo`: the list's URL naming the row
// (`#row=<id>`); a short record opens in a modal over the list instead (`record=<kind>:<id>`). Coming back through that link or through Back, the list shows the same query, marks the
// row current and, once the rows are on screen, puts it back where it stood with focus on its link.
//
// A list supplies its `spec`: the screen it lives on, its query codec, its controls, columns, empty
// states and words. The same module runs in Node (server render) and in the browser, which resolve
// ketjs-view and the design system from different paths; the caller passes both in.

export const fold = (value) =>
  String(value ?? '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/đ/g, 'd')

export const pageSize = 25
export const maxPageSize = 100
// The list may update its query in place; record/configuration and scope changes need a route.
export const isListNavigation = (url, current, screen) =>
  url.origin === current.origin &&
  url.pathname === current.pathname &&
  url.searchParams.get('screen') === screen &&
  !['record', 'id', 'dialog'].some((key) => url.searchParams.has(key)) &&
  ['actor', 'mode', 'viewer', 'role', 'lang'].every(
    (key) => url.searchParams.get(key) === current.searchParams.get(key),
  )

export const whole = (value) => {
  const number = Number.parseInt(value, 10)
  return Number.isFinite(number) ? number : null
}

const cacheSize = 20
// A refresh that answers within this long swaps the rows without dimming them first.
const dimAfter = 150
// How long the reader may pause typing before the list searches.
const settle = 250

/**
 * `spec`:
 * - `screen`: the atlas screen the list lives on; links to it are followed in place.
 * - `codec`: `{ fromUrl(params, limits), toParams(query), toInput(query, store) }`; `names` are the URL
 *   parameters `toParams` writes, so anything else on the URL (screen, state, mode) is left alone.
 * - `limits(props)`: what the list holds, for the codec. `extend(store, props)` adds the list's helpers.
 * - `ids`: `{ search, retry }`, the controls the runtime listens to.
 * - `words`: `{ describe(value, query), lost, pager, labels, denied: { title, message }, subject }`.
 * - `controls(store, props)`, `columns(store, query)`, `twoLines`, `sort(query)`, `empty(store, query, value, props)`.
 * - Optional `placeholder(store, query)` and `tableProps(store, query, value)` compose public table
 *   loading/selection contracts. `controlsMount`/`resultsMount` own disposable product effects.
 * - `tableLayout` applies the same native layout to placeholders and loaded results.
 * - `record(row)` may retain a business `state` filter using `clearState: false`.
 * - Optional `content(store, query, value)` shows an answer as something other than a table, such as
 *   the lanes of a board; the engine still owns the query, the history, the cache and every state.
 */
export const createBook = ({ view: { html, signal, batch, effect }, ds, browser = false }, spec) => {
  const {
    Button,
    KetTable,
    ListChrome,
    Notice,
    Stack,
    Text,
    readRowAnchor,
    rememberRowAnchor,
    restoreRowAnchor,
    rowAnchorHref,
    takeRowAnchor,
  } = ds
  const { codec, ids } = spec
  const wordsOf = (props) => (typeof spec.words === 'function' ? spec.words(props) : spec.words)

  const createStore = (props) => {
    const words = wordsOf(props)
    const limits = spec.limits(props)
    const query = signal(props.query)
    // The last answer, kept on screen while the next one loads.
    const seed = spec.initial?.(props) ?? null
    const result = signal(seed)
    // `loading` before the first answer; `failed`, `offline` or `denied` when the last read did not answer.
    const phase = signal(seed ? 'ready' : 'loading')
    const dimmed = signal(false)
    const announcement = signal('')
    // The row the reader came back to from its page; cleared when the query changes.
    const current = signal(null)

    const linkTo = (next) => {
      const [path, search = ''] = props.listHref.split('?')
      const params = new URLSearchParams(search)
      for (const name of codec.names) params.delete(name)
      for (const [name, value] of Object.entries(codec.toParams(next))) params.set(name, value)
      return `${path}?${params}`
    }
    // A filter starts the list on its first page; a page link keeps the rest.
    const at = (change) => linkTo({ ...query(), page: 1, ...change })
    const searchFields = () => ({
      ...Object.fromEntries(
        Object.entries(props.hidden ?? {}).filter(([name]) => !codec.names.includes(name)),
      ),
      ...codec.toParams({ ...query(), q: '', page: 1 }),
    })
    // A row's page, with the way back to this query and this row.
    const recordLink = (row, value = query()) => {
      const record = spec.record?.(row, props) ?? { href: props.recordHref, id: row.id }
      // A short record (`record.modal`, its kind) opens in a modal over this list: the list's own URL
      // naming it; the modal closes back to this query with the row marked (`row` when the record is
      // another row's, such as a billing line's rule).
      if (record.modal) {
        const params = new URLSearchParams(linkTo(value).split('?')[1])
        if (record.clearState !== false) params.delete('state')
        params.set('record', `${record.modal}:${record.id}`)
        if (record.id !== row.id) params.set('row', row.id)
        return `${linkTo(value).split('?')[0]}?${params.toString().replaceAll('%3A', ':')}`
      }
      // A record href is a URL taking `id`, or a function of the id for hosts that put it in the path.
      const named = typeof record.href === 'function'
      const [address, hash] = (named ? record.href(record.id) : record.href).split('#'),
        [recordPath, search = ''] = address.split('?')
      const params = new URLSearchParams(search)
      if (!named) params.set('id', record.id)
      params.set(record.backParam ?? 'returnTo', rowAnchorHref(linkTo(value), row.id))
      return `${recordPath}?${params}${hash ? '#' + hash : ''}`
    }
    const store = {
      query,
      result,
      phase,
      dimmed,
      announcement,
      current,
      at,
      linkTo,
      recordLink,
      searchFields,
      limits,
      navigate: () => {},
      retry: () => {},
      read: () => {},
      sync: () => {},
    }
    spec.extend?.(store, props)
    if (!browser) return store

    let scenario = props.scenario
    let sequence = 0
    let controller = null
    let dimming = 0
    const cache = new Map()
    // The anchor still waiting for its rows: set on arrival and on Back/Forward, settled by the first answer.
    let pending = null
    let rows = null

    const write = (value, push) => {
      const url = new URL(location.href)
      // Another query is another list; the row named for the last one no longer applies.
      url.hash = ''
      for (const name of codec.names) url.searchParams.delete(name)
      for (const [name, item] of Object.entries(codec.toParams(value))) url.searchParams.set(name, item)
      if (url.href !== location.href)
        history[push ? 'pushState' : 'replaceState'](history.state, '', url.href)
    }
    const show = (value, { announce }) => {
      clearTimeout(dimming)
      batch(() => {
        // The function clamps a page past the end; the URL follows it rather than naming an empty page.
        if (value.page !== query().page) {
          query.set({ ...query(), page: value.page })
          write(query(), false)
        }
        result.set(value)
        store.onResult?.(value)
        phase.set('ready')
        dimmed.set(false)
        if (announce) announcement.set(words.describe(value, query()))
      })
      if (pending) place(pending)
    }
    // After the rows render, the anchored row goes back where it stood. A row this answer does not hold
    // (moved out of a filter by a change) is said, not guessed at.
    const place = (anchor) => {
      pending = null
      requestAnimationFrame(() => {
        if (rows && !(spec.anchor?.restore(rows, anchor) ?? restoreRowAnchor(rows, anchor))) {
          current.set(null)
          announcement.set(words.lost)
        }
      })
    }
    const fail = (kind) => {
      clearTimeout(dimming)
      batch(() => {
        phase.set(kind)
        dimmed.set(false)
        // The notice that replaces the rows announces itself; the live region does not repeat it.
        announcement.set('')
      })
    }

    const load = () => {
      const input = codec.toInput(query(), store)
      const key = JSON.stringify(input)
      const current = ++sequence
      controller?.abort()
      controller = null
      clearTimeout(dimming)
      // The atlas's loading state is the list before any answer, held still.
      if (scenario === 'loading' && spec.loadingPreview !== 'transport') return
      const announce = result() !== null || phase() !== 'loading'
      const held = cache.get(key)
      if (held) {
        // Back and Forward show the page they left at once; the read below brings it up to date.
        cache.delete(key)
        cache.set(key, held)
        show(held, { announce })
      } else if (result() !== null) {
        dimming = setTimeout(() => dimmed.set(true), dimAfter)
      }
      // The atlas's failures reach the list as its transport would deliver them, once: a retry recovers.
      const once =
        scenario === 'error' ||
        scenario === 'offline' ||
        (scenario === 'loading' && spec.loadingPreview === 'transport')
          ? scenario
          : null
      if (once) scenario = null
      if (once === 'offline') {
        queueMicrotask(() => current === sequence && fail('offline'))
        return
      }
      controller = new AbortController()
      fetch(props.source, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          ...(once || scenario ? { 'x-atlas-scenario': once ?? scenario } : {}),
        },
        body: JSON.stringify(input),
        signal: controller.signal,
      })
        .then(
          async (response) => {
            const reply = await response.json().catch(() => null)
            if (response.ok && reply?.ok) return reply.value
            throw Object.assign(new Error(reply?.code ?? `HTTP ${response.status}`), {
              status: response.status,
            })
          },
          (error) => {
            throw Object.assign(error, { network: error?.name !== 'AbortError' })
          },
        )
        .then((value) => {
          if (current !== sequence) return
          cache.set(key, value)
          if (cache.size > cacheSize) cache.delete(cache.keys().next().value)
          show(value, { announce: announce && !held })
        })
        .catch((error) => {
          if (current !== sequence || error?.name === 'AbortError') return
          fail(error.network ? 'offline' : error.status === 403 ? 'denied' : 'failed')
        })
    }

    // `record: false` when the URL already holds the query (Back/Forward, first load).
    store.navigate = (next, { push = true, record = true, anchor = null } = {}) => {
      pending = anchor
      batch(() => {
        query.set(next)
        current.set(anchor?.id ?? null)
      })
      if (record) write(next, push)
      load()
    }
    // Back and Forward: the entry's own query, and the row it names if the reader left from one.
    store.read = (url) =>
      store.navigate(codec.fromUrl(url.searchParams, limits), {
        record: false,
        anchor: readRowAnchor(url, history.state),
      })
    // Back/Forward, and a record modal opened, switched or closed over the list in place
    // (`list:navigate`): the list reads again only when its own query changed. Otherwise it keeps
    // its rows and marks the row the entry names, so a modal never reloads the list under it.
    store.sync = (url) => {
      const next = codec.fromUrl(url.searchParams, limits)
      // Field by field: the query the server handed over and one read from a URL list their fields in
      // different orders.
      const [asked, shown] = [codec.toInput(next, store), codec.toInput(query(), store)]
      const fields = new Set([...Object.keys(asked), ...Object.keys(shown)])
      if ([...fields].some((name) => JSON.stringify(asked[name]) !== JSON.stringify(shown[name])))
        return store.read(url)
      const anchor = readRowAnchor(url, history.state)
      if (!anchor) return
      current.set(anchor.id)
      if (result() === null) pending = anchor
      else place(anchor)
    }
    // The page loading: the same, with the browser's scroll restoration held until the row is placed.
    store.arrive = (root) => {
      rows = root
      pending = takeRowAnchor()
      current.set(pending?.id ?? null)
      // The server's first page already answers this query: kept, not read a second time.
      if (seed && result() === seed) {
        cache.set(JSON.stringify(codec.toInput(query(), store)), seed)
        if (pending) place(pending)
        return
      }
      load()
    }
    // A row followed in this tab: this entry names it, so Back finds it marked if the page is kept.
    store.leave = (link) => {
      const id = spec.anchor?.remember(link) ?? rememberRowAnchor(link)
      if (id) current.set(id)
    }
    store.retry = () => {
      if (spec.recover?.(props)) scenario = null
      load()
    }
    store.load = load
    store.dispose = () => {
      ++sequence
      controller?.abort()
      clearTimeout(dimming)
      cache.clear()
      stores.delete(props.key)
    }
    return store
  }

  // The server renders each island once per request; the browser shares one store between the three.
  const stores = new Map()
  const storeOf = (props) => {
    if (!browser) return createStore(props)
    if (!stores.has(props.key)) stores.set(props.key, createStore(props))
    return stores.get(props.key)
  }
  const closeMenus = (link) => {
    // The menu closes, and so does the folded filter panel holding it on a phone.
    for (let open = link.closest('details[open]'); open; open = open.parentElement?.closest('details[open]'))
      open.removeAttribute('open')
  }
  // A plain click on a link to this list is followed in place; a modified click opens a tab as usual.
  const listLink = (event) => {
    const link = event.target instanceof Element ? event.target.closest('a[href]') : null
    if (
      !link ||
      event.defaultPrevented ||
      event.button !== 0 ||
      event.metaKey ||
      event.ctrlKey ||
      event.shiftKey ||
      event.altKey
    )
      return null
    const url = new URL(link.href, location.href)
    // A link naming a record (`record=<kind>:<id>`) opens its modal over the list: the page follows it.
    return isListNavigation(url, new URL(location.href), spec.screen) ? { link, url } : null
  }
  const follow = (store) => (event) => {
    const target = listLink(event)
    if (!target) return
    event.preventDefault()
    closeMenus(target.link)
    store.navigate(codec.fromUrl(target.url.searchParams, store.limits))
    return target
  }

  const controls = (props) => {
    const store = storeOf(props)
    let typing = 0
    return {
      view: () => spec.controls(store, props),
      mount: ({ root, lifetime }) => {
        spec.controlsMount?.(store, { root, lifetime })
        root.addEventListener('click', follow(store), { signal: lifetime })
        // Search narrows the list as the reader types; the history keeps one entry per search, not per
        // key, so Back from a search returns to the list as it was before it.
        root.addEventListener(
          'input',
          (event) => {
            if (!(event.target instanceof HTMLInputElement) || event.target.id !== ids.search) return
            const value = event.target.value
            clearTimeout(typing)
            typing = setTimeout(() => {
              typing = 0
              store.navigate({ ...store.query(), q: value, page: 1 }, { push: !store.query().q.trim() })
            }, settle)
          },
          { signal: lifetime },
        )
        root.addEventListener(
          'submit',
          (event) => {
            const form = event.target instanceof HTMLFormElement ? event.target : null
            const search = form?.querySelector(`#${ids.search}`)
            if (!search) return
            event.preventDefault()
            clearTimeout(typing)
            typing = 0
            store.navigate({ ...store.query(), q: search.value.trim(), page: 1 })
          },
          { signal: lifetime },
        )
        // Back and Forward drop a search still waiting: the entry they reach names its own. Capture runs this
        // before the list reads that entry.
        addEventListener(
          'popstate',
          () => {
            clearTimeout(typing)
            typing = 0
          },
          { signal: lifetime, capture: true },
        )
        // The field shows the search the list shows. Back, Forward and a link that clears the search change
        // it under the field, which no longer follows its `value` attribute once typed in; text still
        // waiting to be searched is the reader's and stays.
        const follows = effect(() => {
          const { q } = store.query()
          const field = root.querySelector(`#${ids.search}`)
          if (!typing && field instanceof HTMLInputElement && field.value !== q) field.value = q
        })
        lifetime.addEventListener('abort', () => {
          clearTimeout(typing)
          follows()
        })
      },
    }
  }

  const results = (props) => {
    const store = storeOf(props)
    const words = wordsOf(props)
    const { labels } = words
    // Before the first answer the table holds its header and a page of rows shaped like the rows to come
    // (two lines where a cell has two), so little moves when they land.
    const placeholder = (query) =>
      spec.placeholder?.(store, query) ??
      KetTable({
        layout: spec.tableLayout,
        columns: spec.columns(store, query),
        rows: [],
        // KetTable draws the skeleton rows itself, two lines where a cell has two.
        loading: {
          rows: Math.min(query.pageSize, Math.max(1, props.initialRowCount ?? pageSize)),
          lines: Object.fromEntries(spec.twoLines.map((key) => [key, 2])),
        },
        id: (row) => row.id,
        caption: null,
        responsive: 'stack',
        labels,
      })
    const table = (query, value) =>
      KetTable({
        layout: spec.tableLayout,
        columns: spec.columns(store, query),
        rows: value.rows,
        id: (row) => row.id,
        rowHref: (row) => store.recordLink(row, query),
        currentRow: store.current(),
        caption: null,
        responsive: 'stack',
        sort: spec.sort(query),
        groups: spec.groups?.(store, query, value),
        // A refresh that outlasts a moment dims the rows it is replacing.
        busy: store.dimmed(),
        labels,
        ...spec.tableProps?.(store, query, value),
      })
    const failure = (phase, stale) => {
      const retry = Button({ id: ids.retry, label: labels.retry, variant: 'secondary' })
      if (phase === 'denied') return Notice({ tone: 'warning', ...words.denied })
      if (phase === 'offline') {
        return Notice({
          tone: 'warning',
          title: words.offline?.title ?? 'Mất kết nối',
          message:
            words.offline?.message?.(stale) ??
            (stale
              ? `Đang hiện kết quả lần trước. ${words.subject} tự tải lại khi có mạng.`
              : `${words.subject} tự tải lại khi có mạng.`),
          actions: retry,
        })
      }
      return Notice({
        tone: 'danger',
        title: labels.loadError,
        message:
          words.error?.(stale) ??
          (stale
            ? 'Đang hiện kết quả lần trước. Thử lại; chưa có thay đổi nào được gửi.'
            : 'Kết nối tạm thời gián đoạn. Thử lại; chưa có thay đổi nào được gửi.'),
        actions: retry,
      })
    }
    const render = () => {
      const query = store.query()
      const value = store.result()
      const phase = store.phase()
      const failed = ['failed', 'offline', 'denied'].includes(phase)
      const content =
        phase === 'denied'
          ? null
          : value
            ? value.total
              ? (spec.content?.(store, query, value, props, () => table(query, value)) ?? table(query, value))
              : spec.empty(store, query, value, props)
            : failed
              ? null
              : placeholder(query)
      return html`<div data-list-book-results aria-busy=${phase === 'loading' || store.dimmed() ? 'true' : 'false'}>
        <div role="status" aria-live="polite">${Text({ children: store.announcement() || (phase === 'loading' && !value ? labels.loading : ''), visuallyHidden: true })}</div>
        ${Stack({ items: [failed ? failure(phase, Boolean(value)) : null, content].filter(Boolean) })}
      </div>`
    }
    return {
      view: render,
      mount: ({ root, lifetime }) => {
        root.addEventListener(
          'click',
          (event) => {
            if (event.target instanceof Element && event.target.closest(`#${ids.retry}`)) {
              store.retry()
              return
            }
            // Sorting and the empty state's links stay in the list; a row opens its record's page or modal.
            if (follow(store)(event)) return
            const row =
              event.target instanceof Element
                ? (event.target.closest('[data-ui="kt-row-link"]') ??
                  event.target.closest(spec.linkSelector ?? '[data-ui="kt-row"] a[href]'))
                : null
            const plain =
              !event.defaultPrevented &&
              event.button === 0 &&
              !event.metaKey &&
              !event.ctrlKey &&
              !event.shiftKey &&
              !event.altKey
            if (row && plain) store.leave(row)
          },
          { signal: lifetime },
        )
        addEventListener('online', () => store.phase() === 'offline' && store.retry(), { signal: lifetime })
        const sync = () => store.sync(new URL(location.href))
        addEventListener('popstate', sync, { signal: lifetime })
        addEventListener('list:navigate', sync, { signal: lifetime })
        lifetime.addEventListener('abort', () => store.dispose(), { once: true })
        store.arrive(root)
        spec.resultsMount?.(store, { root, lifetime })
      },
    }
  }

  const footer = (props) => {
    const store = storeOf(props)
    const words = wordsOf(props),
      count = (value) => value.toLocaleString(props.lang === 'en' ? 'en-VN' : 'vi-VN')
    const render = () => {
      const query = store.query()
      const value = store.result()
      if (!value || value.pages <= 1 || ['failed', 'offline', 'denied'].includes(store.phase()))
        return html`<div hidden></div>`
      const first = (value.page - 1) * query.pageSize + 1
      // The design system styles a pager inside ListChrome, so the row pager rides in one too.
      return ListChrome({
        pager: {
          label: words.pager,
          summary: `${count(first)}–${count(first + value.rows.length - 1)} / ${count(value.total)}`,
          previousHref: value.page > 1 ? store.at({ page: value.page - 1 }) : null,
          nextHref: value.page < value.pages ? store.at({ page: value.page + 1 }) : null,
          previousLabel: words.labels.previousPage ?? 'Trang trước',
          nextLabel: words.labels.nextPage ?? 'Trang sau',
        },
      })
    }
    return {
      view: render,
      mount: ({ root, lifetime }) => {
        root.addEventListener(
          'click',
          (event) => {
            if (!follow(store)(event)) return
            // A new page starts at its first row, as a page load would.
            const table = document.querySelector('[data-list-book-results]')
            if (table && table.getBoundingClientRect().top < 0) table.scrollIntoView({ block: 'start' })
          },
          { signal: lifetime },
        )
      },
    }
  }

  return { controls, results, footer }
}
