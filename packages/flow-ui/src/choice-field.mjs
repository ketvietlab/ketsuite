import { html, each } from '@ketvietlab/ketjs-view'
import { FlowIcon, FlowButton, FlowInput } from './index.mjs'
import { tr } from './i18n.mjs'
/** @typedef {import('@ketvietlab/ketjs-view').Renderable} Child */
/** A single choice with rich selected/option content; consumer owns persistence.
 * With `menu`, the options are built only while the consumer reports the menu open
 * (one open menu per screen keeps long lists light); without it they are always built.
 * `onToggle(true)` runs before the menu shows, `onToggle(false)` after it has hidden and
 * returned focus, so another menu may already report open when a closed one reports.
 * @param {{id:string,label:string,size?:'sm'|'md',icon?:Parameters<typeof FlowIcon>[0],value:string,selected?:{label:string,content:Child},options:{value:string,label:string,content:Child,disabled?:boolean,description?:string}[],disabled?:boolean,menu?:{open:boolean,onToggle:(open:boolean)=>void},remote?:{loading:boolean,error?:string|null,onRetry:()=>void,query?:string,onQuery?:(value:string)=>void,onMore?:()=>void},onChange:(value:string)=>void}} p */
export function FlowChoiceField(p) {
  const selected = p.options.find((o) => o.value === p.value) ?? p.selected
  /** @param {HTMLElement} menu */
  const focusSelected = (menu) =>
    /** @type {HTMLElement|null} */ (
      menu.querySelector('[data-flow-choice-search] input') ??
        menu.querySelector('[aria-selected="true"]:not(:disabled)') ??
        menu.querySelector('[role="option"]:not(:disabled)') ??
        menu
    )?.focus()
  /** @param {HTMLElement} trigger */
  const position = (trigger) => {
    const menu = /** @type {HTMLElement} */ (trigger.parentElement?.querySelector('[popover]'))
    const rect = trigger.getBoundingClientRect(),
      width = Math.min(320, window.innerWidth - 16),
      height = p.remote ? 280 : Math.min(280, p.options.length * 44 + 8)
    menu.style.width = `${width}px`
    menu.style.left = `${Math.max(8, Math.min(rect.left, window.innerWidth - width - 8))}px`
    menu.style.top = `${Math.max(8, Math.min(rect.bottom + 4, window.innerHeight - height - 8))}px`
    return menu
  }
  // The remote search filters options and stays unnamed: it is no field of the form around
  // the picker, so an open picker never reads as a draft.
  return html`<div data-flow="field" data-choice-size=${p.size ?? 'md'}><span id=${`${p.id}-label`}>${p.icon ? FlowIcon(p.icon) : null}${p.label}</span>
 <div data-flow="choice-field">
  <button id=${p.id} type="button" data-flow="choice-trigger" disabled=${p.disabled ?? false} aria-labelledby=${`${p.id}-label ${p.id}-value`} aria-haspopup=${p.remote ? 'dialog' : 'listbox'} popovertarget=${`${p.id}-menu`}
   on:click=${/** @param {MouseEvent} e */ (e) => position(/** @type {HTMLElement} */ (e.currentTarget))}
   on:keydown=${
     /** @param {KeyboardEvent} e */ (e) => {
       if (['ArrowDown', 'ArrowUp'].includes(e.key) && !p.disabled) {
         e.preventDefault()
         e.stopPropagation()
         const menu = position(/** @type {HTMLElement} */ (e.currentTarget))
         menu.showPopover()
         focusSelected(menu)
       }
     }
}>
   <span id=${`${p.id}-value`}>${selected?.content ?? selected?.label ?? p.value}</span>${FlowIcon('down')}
  </button>
  <div data-flow="choice-menu" id=${`${p.id}-menu`} popover="auto" tabindex="-1" role=${p.remote ? 'dialog' : 'listbox'} aria-labelledby=${`${p.id}-label`}
   on:beforetoggle=${/** @param {ToggleEvent} e */ (e) => e.newState === 'open' && p.menu?.onToggle(true)}
   on:toggle=${
     /** @param {ToggleEvent} e */ (e) => {
       if (e.newState === 'open') focusSelected(/** @type {HTMLElement} */ (e.currentTarget))
       // Closed after the browser returned focus to the trigger, so dropping options cannot strand it.
       else p.menu?.onToggle(false)
     }
}
   on:keydown=${
     /** @param {KeyboardEvent} e */ (e) => {
       if (e.key !== 'Escape') e.stopPropagation()
       if (e.target instanceof HTMLInputElement && !['ArrowDown', 'ArrowUp'].includes(e.key)) return
       if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(e.key)) return
       e.preventDefault()
       const menu = /** @type {HTMLElement} */ (e.currentTarget)
       const choices = Array.from(menu.querySelectorAll(/** @type {'button'} */ ('button:not(:disabled)')))
       const current = choices.indexOf(/** @type {HTMLButtonElement} */ (document.activeElement))
       const next =
         e.key === 'Home'
           ? 0
           : e.key === 'End'
             ? choices.length - 1
             : (current + (e.key === 'ArrowDown' ? 1 : -1) + choices.length) % choices.length
       choices[next]?.focus()
     }
}>
   ${
     (!p.menu || p.menu.open) && p.remote?.onQuery
       ? html`<div data-flow-choice-search>${FlowInput({
           id: p.id + '-search',
           name: null,
           label: p.label,
           type: 'search',
           value: p.remote.query ?? '',
           onInput: (event) => {
             if (event.target instanceof HTMLInputElement) p.remote?.onQuery?.(event.target.value)
           },
         })}</div>`
       : null
}
   ${p.menu && !p.menu.open ? null : p.remote?.loading ? html`<p role="status">${tr('flow.ui.search.loading')}</p>` : null}
   ${p.menu && !p.menu.open ? null : p.remote?.error ? html`<p role="alert">${p.remote.error}</p>${FlowButton({ label: tr('flow.ui.search.retry'), size: 'sm', onClick: p.remote.onRetry })}` : null}
   ${(!p.menu || p.menu.open) && p.remote && !p.remote.loading && !p.remote.error && !p.options.some((option) => !option.disabled) ? html`<p role="status">${tr('flow.ui.no.available.options')}</p>` : null}
   <div role=${p.remote ? 'listbox' : null} aria-labelledby=${p.remote ? `${p.id}-label` : null} aria-busy=${p.remote ? String(p.remote.loading) : null}>${
     p.menu && !p.menu.open
       ? null
       : each(
           p.options,
           (o) => o.value,
           (
             o,
           ) => html`<button data-flow="choice-option" type="button" role="option" aria-label=${o.label} aria-selected=${String(o.value === p.value)} tabindex=${o.value === p.value ? 0 : -1} disabled=${p.disabled || o.disabled || false}
    on:click=${
      /** @param {MouseEvent} e */ (e) => {
        if (p.disabled || o.disabled) return
        const menu = /** @type {HTMLElement} */ (
          /** @type {HTMLElement} */ (e.currentTarget).closest('[popover]')
        )
        menu.hidePopover()
        const trigger = menu.parentElement?.querySelector('[data-flow="choice-trigger"]')
        if (trigger instanceof HTMLElement) trigger.focus()
        if (o.value !== p.value) p.onChange(o.value)
      }
    }>${o.description ? html`<span data-flow="choice-copy">${o.content}<small>${o.description}</small></span>` : o.content}${o.value === p.value ? FlowIcon('check') : null}</button>`,
         )
}</div>
   ${(!p.menu || p.menu.open) && p.remote?.onMore ? FlowButton({ label: tr('flow.ui.options.more'), size: 'sm', disabled: p.remote.loading, onClick: p.remote.onMore }) : null}
  </div>
 </div></div>`
}
