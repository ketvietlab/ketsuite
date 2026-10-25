import { tr, flowLocale } from './i18n.mjs'
import { DatePicker } from '@ketvietlab/design-system/date-picker'
import { html, each } from '@ketvietlab/ketjs-view'
import { taskDrag } from './task-drag.mjs'
// Lucide glyphs, vendored like the design system: regenerate with tools/vendor-lucide.mjs.
import { icons } from './icons.mjs'

/** @typedef {import('@ketvietlab/ketjs-view').TemplateResult} View */
/** @typedef {import('@ketvietlab/ketjs-view').Renderable} Child */
/** @typedef {'todo'|'progress'|'review'|'done'} Status */
/** @typedef {'normal'|'high'|'urgent'} Priority */
/** @typedef {{id:string, title:string, project:string, status:Status, priority:Priority, assignee:string, assignees?:{id:string,name:string,avatarUrl?:string}[], due:string,statusLabel?:string,statusColor?:string}} FlowTask */
/** @typedef {{label:string, value:string}} Option */

/** Decorative only; controls must supply their own accessible name. @param {keyof typeof icons} name */
export const FlowIcon = (name) =>
  html`<svg
    data-flow="icon"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    stroke-width="2"
    stroke-linecap="round"
    stroke-linejoin="round"
    aria-hidden="true"
  >
    <path d=${icons[name]}></path>
  </svg>`

/** `form` associates a submit button with a native form outside its DOM parent (for persistent dialog actions). @param {{label:string, variant?:'primary'|'secondary'|'ghost'|'danger', size?:'sm'|'md', icon?:keyof typeof icons, iconOnly?:boolean, disabled?:boolean, disabledReason?:string, loading?:boolean, pressed?:boolean, action?:string, type?:'button'|'submit', form?:string, onClick?:(event:Event)=>void}} p */
export const FlowButton = (p) =>
  html`<button
    data-flow="button"
    data-flow-action=${p.action ?? null}
    data-variant=${p.variant ?? 'secondary'}
    data-size=${p.size ?? 'md'}
    data-icon-only=${p.iconOnly ? true : null}
    type=${p.type ?? 'button'}
    form=${p.form ?? null}
    disabled=${p.disabled || p.loading || false}
    aria-busy=${p.loading ? 'true' : null}
    aria-pressed=${p.pressed === undefined ? null : String(p.pressed)}
    aria-label=${p.iconOnly ? p.label : null}
    title=${p.disabled ? (p.disabledReason ?? tr('flow.review.unavailable')) : p.iconOnly ? p.label : null}
    on:click=${p.onClick}
  >
    ${p.loading ? html`<span data-flow="spinner" aria-hidden="true"></span>` : p.icon ? FlowIcon(p.icon) : null}${p.iconOnly ? null : p.label}
  </button>`

/** Canonical DS calendar with Flow-owned sibling layout and translated content.
 * @param {{id:string,name?:string,label:string,icon?:keyof typeof icons,value?:string,min?:string,max?:string,step?:string,required?:boolean,disabled?:boolean,readOnly?:boolean,error?:string,onInput?:(event:Event)=>void,onChange?:(event:Event)=>void,onBlur?:(event:Event)=>void}} p */
export const FlowDateInput = (p) =>
  html`<div data-flow="field" data-flow-date-input data-kv-design-system><span>${p.icon ? FlowIcon(p.icon) : null}${p.label}</span>${DatePicker(
    {
      id: p.id,
      name: p.name ?? p.id,
      label: p.label,
      labelHidden: true,
      locale: flowLocale(),
      value: p.value ?? '',
      min: p.min,
      max: p.max,
      step: p.step,
      required: p.required,
      disabled: p.disabled,
      readOnly: p.readOnly,
      error: p.error,
      onInput: p.onInput,
      onChange: p.onChange,
      onBlur: p.onBlur,
    },
  )}</div>`

/** `name: null` leaves the input unnamed, outside any surrounding form's data.
 * @param {{id:string,name?:string|null,label:string,icon?:keyof typeof icons,value?:string,placeholder?:string,type?:string,autocomplete?:string,required?:boolean,disabled?:boolean,min?:string,max?:string,step?:string,readOnly?:boolean,multiple?:boolean,onBlur?:(event:Event)=>void,onChange?:(event:Event)=>void,error?:string,onInput?:(event:Event)=>void}} p */
export const FlowInput = (p) =>
  p.type === 'date'
    ? FlowDateInput({ ...p, name: p.name ?? undefined })
    : html`<label data-flow="field" for=${p.id}
    ><span id=${`${p.id}-label`}>${p.icon ? FlowIcon(p.icon) : null}${p.label}</span
    ><input
      data-flow="input"
      data-flow-value=${p.value ?? ''}
      id=${p.id}
      name=${p.name === null ? null : (p.name ?? p.id)}
      type=${p.type ?? 'text'}
      autocomplete=${p.autocomplete ?? null}
      min=${p.min ?? null}
      max=${p.max ?? null}
      step=${p.step ?? null}
      multiple=${p.multiple ?? false}
      on:blur=${p.onBlur}
      on:change=${p.onChange}
      value=${p.value ?? ''}
      placeholder=${p.placeholder ?? ''}
      required=${p.required ?? false}
      disabled=${p.disabled ?? false}
      aria-invalid=${p.error ? 'true' : null}
      aria-labelledby=${`${p.id}-label`}
      aria-describedby=${p.error ? `${p.id}-error` : null}
      on:input=${p.onInput}
    />${p.error ? html`<small id=${`${p.id}-error`} data-flow="field-error">${p.error}</small>` : null}</label
  >`

/** @param {{label:string,value:string,placeholder?:string,onInput:(event:Event)=>void}} p */
export const FlowSearch = (p) =>
  html`<label data-flow="search"
    >${FlowIcon('search')}<input
      type="search"
      data-flow-value=${p.value}
      data-flow-controlled
      aria-label=${p.label}
      placeholder=${p.placeholder ?? p.label}
      value=${p.value}
      on:input=${p.onInput}
      on:search=${p.onInput}
  /></label>`

/** @param {{label:string,value:string,options:readonly Option[],size?:'sm'|'md',id?:string,name?:string,disabled?:boolean,invalid?:boolean,descriptionId?:string,onChange?:(event:Event)=>void}} p */
export const FlowSelect = (p) =>
  html`<span data-flow="select-wrap"><select
    data-flow="select"
    data-size=${p.size ?? 'md'}
    id=${p.id ?? null}
    name=${p.name ?? null}
    disabled=${p.disabled ?? false}
    data-flow-value=${p.value}
    data-flow-controlled=${p.onChange ? true : null}
    aria-label=${p.label}
    aria-invalid=${p.invalid ? 'true' : null}
    aria-describedby=${p.descriptionId ?? null}
    on:change=${p.onChange}
  >
    ${each(
      p.options,
      (o) => o.value,
      (o) => html`<option value=${o.value} selected=${p.value === o.value}>${o.label}</option>`,
    )}
  </select><span data-flow="select-caret" aria-hidden="true">${FlowIcon('down')}</span></span>`

/** `standalone` provides a native clickable label; use `native` inside an existing label.
 * @param {{label:string,checked:boolean,name?:string,value?:string,target?:'native'|'standalone',indeterminate?:boolean,disabled?:boolean,onChange?:(event:Event)=>void}} p */
export const FlowCheckbox = (p) => {
  const input = html`<input
    data-flow="checkbox"
    disabled=${p.disabled ?? false}
    type="checkbox"
    name=${p.name ?? null}
    value=${p.value ?? null}
    aria-label=${p.label}
    checked=${p.checked}
    aria-checked=${p.indeterminate ? 'mixed' : null}
    data-flow-indeterminate=${p.indeterminate ? 'true' : null}
    on:change=${p.onChange}
  />`
  return p.target === 'standalone'
    ? html`<label data-flow="checkbox-target" data-disabled=${String(!!p.disabled)}>${input}</label>`
    : input
}

export const FLOW_STATUSES = /** @type {const} */ ({
  get todo() {
    return tr('flow.ui.not.started')
  },
  get progress() {
    return tr('flow.ui.in.progress.ae8756')
  },
  get review() {
    return tr('flow.ui.awaiting.review')
  },
  get done() {
    return tr('flow.ui.complete')
  },
})

/** @param {{status:Status,label?:string,color?:string,compact?:boolean}} p */
export const FlowStatus = (p) =>
  html`<span data-flow="status" data-status=${p.status} data-color=${p.color} title=${p.label ?? FLOW_STATUSES[p.status]}
    ><span data-flow="status-mark" aria-hidden="true"
      >${p.status === 'done' ? FlowIcon('check') : null}</span
    >${p.compact ? html`<span data-flow="sr">${p.label ?? FLOW_STATUSES[p.status]}</span>` : (p.label ?? FLOW_STATUSES[p.status])}</span
  >`

/** @param {{priority:Priority}} p */
export const FlowPriority = (p) =>
  html`<span data-flow="priority" data-priority=${p.priority}
    >${FlowIcon('flag')}${{ normal: tr('flow.ui.normal'), high: tr('flow.ui.high'), urgent: tr('flow.ui.urgent') }[p.priority]}</span
  >`

/** Identity hue for a name: the same person keeps one of five chart hues on every screen. @param {string} name */
const avatarHue = (name) => {
  let hash = 0
  for (const char of name) hash = (hash * 31 + (char.codePointAt(0) ?? 0)) >>> 0
  return hash % 5
}

/** @param {{name:string,size?:'sm'|'md',src?:string}} p */
export const FlowAvatar = (p) =>
  html`<span
    data-flow="avatar"
    data-size=${p.size ?? 'sm'}
    data-color=${avatarHue(p.name)}
    title=${p.name}
    aria-label=${p.name}
    >${
      p.src
        ? html`<img src=${p.src} alt="" loading="lazy" on:error=${
            /** @param {Event} e */ (e) => {
              const img = /** @type {HTMLImageElement} */ (e.currentTarget)
              img.hidden = true
            }
          } />`
        : null
    }${p.name
      .split(' ')
      .map((x) => x[0])
      .slice(-2)
      .join('')}</span
  >`

/** @param {{users:{id:string,name:string,avatarUrl?:string}[],limit?:number,showOverflow?:boolean}} p */
export const FlowAvatarGroup = (p) =>
  html`<span data-flow="avatar-group" aria-label=${p.users.length ? p.users.map((u) => u.name).join(', ') : tr('flow.ui.unassigned.1f3799')} title=${p.users.map((u) => u.name).join(', ')}>${each(
    p.users.slice(0, p.limit ?? 3),
    (u) => u.id,
    (u) => FlowAvatar({ name: u.name, src: u.avatarUrl }),
  )}${p.showOverflow !== false && p.users.length > (p.limit ?? 3) ? html`<span data-flow="avatar-overflow">+${p.users.length - (p.limit ?? 3)}</span>` : null}${p.users.length ? null : FlowIcon('user')}</span>`

/** @param {{label:string,tone?:'neutral'|'blue'|'green'|'yellow'|'red'}} p */
export const FlowTag = (p) => html`<span data-flow="tag" data-tone=${p.tone ?? 'neutral'}>${p.label}</span>`

/** Ordinary toggle buttons, not ARIA tabs: the consumer owns content. @param {{label:string,value:string,appearance?:'pill'|'underline',options:readonly (Option & {icon?:keyof typeof icons})[],onChange:(value:string)=>void}} p */
export const FlowSegmented = (p) =>
  html`<div
    data-flow="segmented"
    data-appearance=${p.appearance ?? 'pill'}
    role="group"
    aria-label=${p.label}
  >
    ${each(
      p.options,
      (o) => o.value,
      (o) =>
        html`<button
          type="button"
          aria-pressed=${String(o.value === p.value)}
          on:click=${() => p.onChange(o.value)}
        >
          ${o.icon ? FlowIcon(o.icon) : null}${o.label}
        </button>`,
    )}
  </div>`

/** @typedef {"standard"|"wide"|"full"} FlowContentWidth */
/** Shared task/document topbar. @param {{title:string,breadcrumb?:string,search?:Child,actions?:Child,documentTitle?:boolean,titleAsLabel?:boolean}} p */
export const FlowShellHeader = (
  p,
) => html`<header data-flow="shell-header" data-has-search=${p.search ? 'true' : null}>
        <div data-flow="shell-heading">
          ${p.breadcrumb ? html`<span>${p.breadcrumb}</span>${FlowIcon('chevron')}` : null}
          ${p.documentTitle || p.titleAsLabel ? html`<strong>${p.title}</strong>` : html`<h1>${p.title}</h1>`}
        </div>
        ${p.search ? html`<div data-flow="shell-search">${p.search}</div>` : null}
        <div data-flow="shell-actions">${p.actions ?? null}</div>
      </header>`
/** Compact viewport shell; header may be an SSR enhancement region. @param {{sidebar:Child,title:string,titleAsLabel?:boolean,breadcrumb?:string,search?:Child,actions?:Child,header?:Child,navigation?:Child,contentWidth?:FlowContentWidth,contentMode?:'documents'|'form',children:Child,footer?:Child}} p */
export const FlowShell = (p) =>
  FlowFrame({
    sidebar: p.sidebar,
    children: html`<main data-flow="shell-main" data-content-mode=${p.contentMode ?? null}>
      ${p.header ?? FlowShellHeader(p)}
      <div data-flow="shell-content">
        ${p.navigation ?? null}
        <div data-flow="content-container" data-width=${p.contentWidth ?? 'standard'}>${p.children}</div>
      </div>
      ${p.footer ? html`<footer data-flow="shell-footer">${p.footer}</footer>` : null}
    </main>`,
  })

/** @param {{value:number,total:number,label:string}} p */
export const FlowProgress = (p) =>
  html`<progress
    data-flow="progress"
    aria-label=${p.label}
    max=${Math.max(1, p.total)}
    value=${Math.max(0, Math.min(p.value, p.total))}
  ></progress>`

/** @param {{title:string,description:string,action?:Child,titleLevel?:1}} p */
export const FlowEmpty = (p) =>
  html`<div data-flow="empty">
    ${FlowIcon('inbox')}${p.titleLevel === 1 ? html`<h1 data-flow="empty-title">${p.title}</h1>` : html`<strong data-flow="empty-title">${p.title}</strong>`}
    <p>${p.description}</p>
    ${p.action ?? null}
  </div>`

/** Native dialog supplies modality, focus trapping and Escape. Call runtime.open(id) from the opener. @param {{id:string,title:string,body:Child,feedback?:Child,footer?:Child,headerActions?:Child,size?:'default'|'wide'|'task'|'spotlight'|'setup'|'media'|'confirm'|(string&{}),role?:'dialog'|'alertdialog',descriptionId?:string,autoOpen?:boolean,closeDisabled?:boolean,onRequestClose?:()=>void}} p */
export const FlowDialog = (p) =>
  html`<dialog
    data-flow="dialog"
    data-size=${p.size ?? 'default'}
    data-flow-route-modal=${p.onRequestClose && p.autoOpen !== false ? true : null}
    id=${p.id}
    role=${p.role ?? null}
    aria-labelledby=${`${p.id}-title`}
    aria-describedby=${p.descriptionId ?? null}
    on:cancel=${
      /** @param {Event} e */ (e) => {
        if (p.closeDisabled) {
          e.preventDefault()
          return
        }
        if (p.onRequestClose) {
          e.preventDefault()
          p.onRequestClose()
        }
      }
    }
    on:click=${
      /** @param {MouseEvent} e */ (e) => {
        if (p.closeDisabled) return
        const dialog = /** @type {HTMLDialogElement} */ (e.currentTarget)
        const r = dialog.getBoundingClientRect()
        if (
          e.target === dialog &&
          (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom)
        )
          p.onRequestClose?.()
      }
    }
  >
    <header>
      <h2 id=${`${p.id}-title`}>${p.title}</h2>
      <div data-flow="dialog-header-actions">${p.headerActions ?? null}<button
        data-flow="button"
        data-size="md"
        data-icon-only
        data-variant="ghost"
        type="button"
        disabled=${p.closeDisabled ?? false}
        data-flow-close=${p.onRequestClose ? null : true}
        on:click=${p.onRequestClose}
        aria-label=${tr('flow.ui.close.5d54c2')}
      >
        ${FlowIcon('close')}
      </button></div>
    </header>
    <div data-flow="dialog-body">${p.body}</div>
    ${p.footer ? html`<footer>${p.footer}</footer>` : null}
    ${p.feedback ? html`<div data-flow="dialog-feedback">${p.feedback}</div>` : null}
  </dialog>`

/** A small centred question, including on mobile; consumers own the action. Details explain prerequisites without replacing the associated question. @param {{id:string,title:string,message:string,details?:Child,confirmLabel:string,cancelLabel:string,onConfirm:()=>void,onCancel:()=>void,tone?:'danger'|'primary',confirmDisabled?:boolean,loading?:boolean,autoOpen?:boolean,feedback?:Child}} p */
export const FlowConfirmDialog = (p) =>
  FlowDialog({
    id: p.id,
    title: p.title,
    role: 'alertdialog',
    descriptionId: `${p.id}-description`,
    autoOpen: p.autoOpen,
    size: 'confirm',
    closeDisabled: p.loading,
    feedback: p.feedback,
    onRequestClose: p.onCancel,
    body: html`<div data-flow="stack"><p data-flow="confirm-message" id=${`${p.id}-description`}>${p.message}</p>${p.details}</div>`,
    footer: html`${FlowButton({ label: p.cancelLabel, disabled: p.loading, onClick: p.onCancel })}${FlowButton({ label: p.confirmLabel, variant: p.tone ?? 'danger', disabled: p.confirmDisabled, loading: p.loading, onClick: p.onConfirm })}`,
  })

/** @param {{task:FlowTask,selected:boolean,onSelect:()=>void,onOpen:()=>void,statusControl?:Child,priorityControl?:Child,assigneeControl?:Child,dueControl?:Child,statusHint?:Child} & import("./task-drag.mjs").TaskDrop} p */
export const FlowTaskRow = (p) => {
  const drag = taskDrag(p, p.task.id)
  return html`<tr data-flow="task-row" data-task-id=${p.task.id} data-selected=${String(p.selected)} data-flow-drag-count=${p.dragCount ?? 1}
    draggable="false" data-flow-task-drop=${p.onDropTask ? 'item' : null} on:flowtaskdrop=${drag.pointerDrop} on:flowtaskdragcheck=${drag.check} tabindex=${p.onDropTask ? 0 : null}
    title=${p.onDropTask ? tr('flow.ui.drag.to.reorder.alt.to.reorder.alt.to.move.groups') : null}
    on:keydown=${drag.key}>
    <td>

      ${FlowCheckbox({ target: 'standalone', label: tr('flow.ui.select.85cbcf', [p.task.id]), checked: p.selected, onChange: p.onSelect })}
    </td>
    <td>
      <button data-flow="task-open" type="button" on:click=${p.onOpen}>
        <span data-flow="task-id" title=${p.task.id}>${p.task.id}</span
        ><span data-flow="task-title">${p.task.title}${p.task.project ? html`<small data-flow="task-project">${p.task.project}</small>` : null}</span>
      </button>
    </td>
    <td><div data-flow="task-status-cell">${p.statusControl ?? FlowStatus({ status: p.task.status, label: p.task.statusLabel, color: p.task.statusColor })}${p.statusHint ? html`<small>${p.statusHint}</small>` : null}</div></td>
    <td>${p.priorityControl ?? FlowPriority({ priority: p.task.priority })}</td>
    <td>${p.assigneeControl ?? FlowAvatarGroup({ users: p.task.assignees ?? (p.task.assignee ? [{ id: p.task.assignee, name: p.task.assignee }] : []) })}</td>
    <td data-flow="due">${p.dueControl ?? p.task.due}</td>
  </tr>`
}

/** @param {{task:FlowTask,onOpen:()=>void,statusHint?:string} & import("./task-drag.mjs").TaskDrop} p */
export const FlowTaskCard = (p) => {
  const drag = taskDrag(p, p.task.id)
  return html`<div data-flow="task-card-drag" data-task-id=${p.task.id}
    draggable="false" data-flow-task-drop=${p.onDropTask ? 'item' : null} on:flowtaskdrop=${drag.pointerDrop} on:flowtaskdragcheck=${drag.check}
    title=${p.onDropTask ? tr('flow.ui.drag.to.reorder.alt.to.reorder.alt.to.move.groups') : null}
    on:keydown=${drag.key}>

    <button data-flow="task-card" type="button" on:click=${p.onOpen}>
    <span data-flow="card-top"
      ><span data-flow="task-id">${p.task.id}</span
      >${FlowPriority({ priority: p.task.priority })}</span
    ><strong>${p.task.title}</strong>${p.task.project ? html`<span data-flow="card-project">${p.task.project}</span>` : null}<span data-flow="card-bottom"
      ><span>${FlowIcon('calendar')}${p.task.due}</span
      >${FlowAvatarGroup({ users: p.task.assignees ?? (p.task.assignee ? [{ id: p.task.assignee, name: p.task.assignee }] : []) })}</span
    >${p.statusHint ? html`<span data-flow="card-status-hint">${p.statusHint}</span>` : null}
  </button></div>`
}

/** Shared app frame keeps normal Flow navigation across workspace modes. @param {{sidebar:Child,children:Child}} p */
export const FlowFrame = (p) =>
  html`<div data-flow="shell">
    <aside data-flow="shell-sidebar" aria-label=${tr('flow.ui.flow.navigation')}>${p.sidebar}</aside>
    <div data-flow="app-body">${p.children}</div>
  </div>`

export {
  FlowLiveDoc,
  FlowLiveDocText,
  FlowLiveDocBlocks,
  FlowLiveDocLegacyBlocks,
  setFlowLiveDocEditor,
} from './live-doc.mjs'
