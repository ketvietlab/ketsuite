/**
 * The browser entry of a Spec page rendered by `renderSpecPage` or the
 * `ketspec` command: reads what the server wrote into the page and mounts the
 * application over it.
 */
import { attachDesignSystemInteractions } from '@ketvietlab/design-system/runtime'
import { mountSpec } from './client.ts'
import { routeSearch } from './views.tsx'

const root = document.querySelector<HTMLElement>('#spec[data-ketspec]')

if (root) {
  const embedded = document.getElementById('spec-document')
  const brandHref = `${location.pathname}${routeSearch({ operation: null, group: null, q: null }, new URLSearchParams(location.search))}`
  mountSpec({
    root,
    document: embedded?.textContent ? JSON.parse(embedded.textContent) : undefined,
    specUrl: root.dataset.specUrl,
    locale: document.documentElement.lang,
    brand: {
      href: brandHref,
      image: root.dataset.brandImage ?? '',
      darkImage: root.dataset.brandDarkImage ?? '',
    },
    timeoutSeconds: root.dataset.specTimeout ? Number(root.dataset.specTimeout) : undefined,
    attachInteractions: (element) => attachDesignSystemInteractions(element),
  })
}
