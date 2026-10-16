import { html, each } from '@ketvietlab/ketjs-view'
import { FlowIcon, FlowButton } from './index.mjs'
import { tr } from './i18n.mjs'

/** One persistent input; its non-modal list belongs to this same combobox.
 * @param {{id:string,query:string,open:boolean,loading?:boolean,error?:string,disabled?:boolean,activeId?:string,groups:{id:string,label:string,items:{id:string,title:string,description?:string,icon:Parameters<typeof FlowIcon>[0]}[]}[],onQuery:(value:string)=>void,onOpen:()=>void,onClose:()=>void,onActive:(id:string)=>void,onSelect:(id:string)=>void,onRetry:()=>void}} p */
export function FlowGlobalSearch(p) {
  const items = p.groups.flatMap((g) => g.items)
  const active = p.loading || p.error ? null : (items.find((x) => x.id === p.activeId) ?? items[0])
  const optionId = /** @param {string} id */ (id) => `${p.id}-option-${encodeURIComponent(id)}`
  return html`<div data-flow="global-search" data-open=${String(p.open)} on:flowsearchdismiss=${p.onClose}>
    <label data-flow="search">${FlowIcon('search')}
      <input id=${p.id} type="search" role="combobox" aria-label=${tr('flow.ui.search.flow')} aria-autocomplete="list" aria-expanded=${String(p.open)} aria-controls=${`${p.id}-results`} aria-activedescendant=${p.open && active ? optionId(active.id) : null} aria-keyshortcuts="Meta+K Control+K" autocomplete="off" spellcheck="false" maxlength="200" disabled=${p.disabled} value=${p.query} data-flow-value=${p.query} data-flow-controlled placeholder=${tr('flow.ui.search.everything')} on:focus=${p.onOpen} on:input=${/** @param {Event} e */ (e) => p.onQuery(/** @type {HTMLInputElement} */ (e.target).value)} on:keydown=${
        /** @param {KeyboardEvent} e */ (e) => {
          if (e.isComposing) return
          if (e.key === 'Escape') {
            e.preventDefault()
            e.stopPropagation()
            p.onClose()
          }
          if (['ArrowDown', 'ArrowUp'].includes(e.key)) {
            e.preventDefault()
            p.onOpen()
            if (!items.length || p.loading || p.error) return
            const i = items.findIndex((x) => x.id === active?.id)
            p.onActive(items[(i + (e.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length].id)
          }
          if (e.key === 'Enter') {
            e.preventDefault()
            if (p.open && active) p.onSelect(active.id)
          }
        }
      } />
      <kbd aria-hidden="true">⌘K</kbd>
    </label>
    <div data-flow="global-search-panel" popover="auto" aria-label=${tr('flow.ui.search.flow')}>
      <div id=${`${p.id}-results`} role="listbox" aria-label=${tr('flow.ui.search.flow')} aria-busy=${String(!!p.loading)}>
        ${
          !p.loading && !p.error
            ? each(
                p.groups,
                (g) => g.id,
                (g) =>
                  html`<div role="group" aria-labelledby=${`${p.id}-group-${g.id}`}><div data-flow="spotlight-group" id=${`${p.id}-group-${g.id}`}>${g.label}</div>${each(
                    g.items,
                    (x) => x.id,
                    (x) =>
                      html`<div data-flow="spotlight-option" id=${optionId(x.id)} role="option" aria-selected=${String(active?.id === x.id)} on:pointermove=${() => p.onActive(x.id)} on:mousedown=${/** @param {Event} e */ (e) => e.preventDefault()} on:click=${() => p.onSelect(x.id)}><span data-flow="spotlight-symbol">${FlowIcon(x.icon)}</span><span data-flow="spotlight-copy"><strong>${x.title}</strong>${x.description ? html`<small>${x.description}</small>` : null}</span></div>`,
                  )}</div>`,
              )
            : null
        }
      </div>
      ${
        p.loading
          ? html`<p data-flow="search-status" role="status">${tr('flow.ui.search.loading')}</p>`
          : p.error
            ? html`<div data-flow="search-status" role="alert"><p>${p.error}</p>${FlowButton({
                label: tr('flow.ui.search.retry'),
                onClick: /** @param {Event} event */ (event) => {
                  const button = /** @type {HTMLElement} */ (event.currentTarget)
                  button.closest('[data-flow="global-search"]')?.querySelector('input')?.focus()
                  p.onRetry()
                },
              })}</div>`
            : !items.length
              ? html`<div data-flow="search-status" role="status"><strong>${tr('flow.ui.no.results.found')}</strong><p>${tr('flow.ui.search.refine')}</p></div>`
              : html`<p data-flow="search-status" role="status">${tr('flow.ui.search.refine')}</p>`
      }
    </div>
  </div>`
}
