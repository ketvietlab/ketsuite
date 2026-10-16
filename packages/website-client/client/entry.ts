import { createIslandManager, domHost } from '@ketvietlab/ketjs-view'
import type { IslandElement } from '@ketvietlab/ketjs-view'
import { uploadImage } from './image-upload.tsx'
import {
  createWebsiteStudio,
  createFnClient,
  createWebsiteRegion,
  matchRoute,
  routes,
  buildHref,
} from './index.ts'
import type { StudioProps } from './index.ts'
const documentRoot = document.getElementById('website-studio')
const root = documentRoot?.querySelector<HTMLElement>('[data-website-studio]')
if (documentRoot && root) {
  // The public DOM host adapts native nodes; its shared HostNode type is host-neutral.
  const rootNode = root as unknown as IslandElement
  const props: StudioProps = JSON.parse(documentRoot.dataset.props!)
  const call = createFnClient({
    fetch: async (url, options) => {
      const response = await fetch(String(url).replace('/_ket/fn/', '/website/api/'), options)
      if (response.status === 401) {
        const next = window.location.pathname + window.location.search
        window.location.assign(`/login?next=${encodeURIComponent(next)}`)
      }
      return response
    },
  })
  const readFrame = async (href: string, signal: AbortSignal) => {
    const response = await fetch(href, { credentials: 'same-origin', signal })
    if (response.redirected && new URL(response.url).pathname === '/login') {
      window.location.assign(response.url)
      throw new Error('Session expired')
    }
    if (!response.ok) throw new Error('Không thể tải khung trang Website.')
    return new DOMParser().parseFromString(await response.text(), 'text/html')
  }
  const studio = createWebsiteStudio(props, {
    call,
    uploadImage: (file, options) =>
      uploadImage(file, {
        ...options,
        endpoint: options.resModel?.startsWith('website_catalog.')
          ? `/website/catalog/images/${encodeURIComponent(options.resModel.split('.')[1]!)}/${encodeURIComponent(options.id)}/${encodeURIComponent(options.field)}?site=${encodeURIComponent(options.siteId)}`
          : `/website/images/${encodeURIComponent(options.id)}/${encodeURIComponent(options.field)}?site=${encodeURIComponent(options.siteId)}`,
      }),
    async frame(href, signal) {
      const document = await readFrame(href, signal)
      const next = document.querySelector('[data-website-studio]')
      const state = document.getElementById('website-studio')?.dataset.props
      if (signal.aborted) return
      if (!next || !state) throw new Error('Khung trang Website không hợp lệ.')
      const props = JSON.parse(state) as StudioProps
      const route = matchRoute(routes, props.path ?? '')
      if (!route) throw new Error('Invalid Website route')
      manager.dispose(rootNode)
      root.replaceChildren(...next.childNodes)
      manager.hydrate(rootNode)
      return {
        fallback: next.getAttribute('data-website-frame-fallback') === 'yes',
        bootstrap: props.bootstrap,
        canonicalHref: buildHref(routes, '/website/', route.key, route.params, props.query),
      }
    },
    async identity(href, signal) {
      const next = await readFrame(href, signal)
      if (signal.aborted) return
      const before = root.querySelectorAll('[data-kv-page-identity="title"]')
      const after = next.querySelectorAll('[data-kv-page-identity="title"]')
      if (before.length !== after.length) return
      before.forEach((title, index) => {
        if (title.textContent !== after[index].textContent) title.replaceWith(after[index]!)
      })
    },
  })
  const manager = createIslandManager(
    domHost(),
    {
      'website.region': (props) => {
        if (typeof props.id !== 'string' || typeof props.initial !== 'string')
          throw new Error('Invalid Website region')
        const region = { id: props.id, initial: props.initial }
        return createWebsiteRegion(region, () => studio.region(region))
      },
    },
    { strict: true },
  )
  const lifetime = new AbortController()
  manager.hydrate(rootNode)
  studio.mount({ root, lifetime: lifetime.signal })
  window.addEventListener(
    'pagehide',
    () => {
      lifetime.abort()
      studio.dispose()
      manager.dispose(rootNode)
    },
    { once: true },
  )
}
