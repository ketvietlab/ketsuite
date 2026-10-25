import type { JSXChild, TemplateResult } from '@ketvietlab/ketjs-view'
import { IconButton } from '../../primitives/actions/index.tsx'
import { Icon } from '../../primitives/icon/index.tsx'

export const HOOKS = [
  'dock-region',
  'dock',
  'dock-head',
  'dock-heading',
  'dock-eyebrow',
  'dock-title',
  'dock-status',
  'dock-tools',
  'dock-body',
  'dock-foot',
  'dock-actions',
] as const

export type DockProps = {
  /** The stem of the title, body and toggle ids. */
  id: string
  title: string
  /** What the panel is doing now (an incoming call, a call in progress), above the title. */
  eyebrow?: string | null
  /** Live facts beside the title: a timer, a recording badge. Not announced. */
  status?: JSXChild
  /** The panel's working content, hidden while it is collapsed. */
  body?: JSXChild
  /** Commands for this state, at most one primary. They stay in view while the panel is collapsed. */
  actions?: JSXChild
  /** Shows the head and the actions only, so the page under the panel can be used. */
  collapsed?: boolean
  /**
   * Shows the collapse control (`<id>-toggle`, which names the body with `aria-controls`). The owner
   * flips `collapsed` when it is pressed. Omit for a panel without a body.
   */
  toggle?: { collapseLabel: string; expandLabel: string } | null
  /** Other head tools before the toggle, such as closing an idle panel. Small icon actions. */
  tools?: JSXChild
  /** `attention` frames a panel that waits for the reader, such as a ringing call. */
  tone?: 'default' | 'attention'
}

/**
 * A non-modal panel for a task that runs beside the page, such as a phone call or a chat
 * conversation: the reader keeps working on the page under it. It is not a dialog; it takes no
 * focus and does not make the page inert. In a DockRegion it floats at the bottom end of the
 * viewport; anywhere else it is laid out in place (documentation, catalogue specimens).
 */
export const Dock = (props: DockProps): TemplateResult => {
  const collapsed = props.collapsed === true && props.body !== undefined
  return (
    <section
      data-ui="dock"
      id={props.id}
      aria-labelledby={`${props.id}-title`}
      data-tone={props.tone ?? 'default'}
      data-collapsed={collapsed ? 'true' : 'false'}
    >
      <header data-ui="dock-head">
        {/* Announced when the task changes state; the status beside it (a timer) is not. */}
        <div data-ui="dock-heading" aria-live="polite">
          {!!props.eyebrow && <p data-ui="dock-eyebrow">{props.eyebrow}</p>}
          <h2 data-ui="dock-title" id={`${props.id}-title`}>
            {props.title}
          </h2>
        </div>
        {(props.tools !== undefined || (props.toggle && props.body !== undefined)) && (
          <div data-ui="dock-tools">
            {props.tools}
            {props.toggle && props.body !== undefined && (
              <IconButton
                id={`${props.id}-toggle`}
                label={collapsed ? props.toggle.expandLabel : props.toggle.collapseLabel}
                icon={<Icon name={collapsed ? 'maximize-2' : 'minimize-2'} size="small" />}
                expanded={!collapsed}
                controls={`${props.id}-body`}
              />
            )}
          </div>
        )}
        {props.status !== undefined && <div data-ui="dock-status">{props.status}</div>}
      </header>
      {props.body !== undefined && (
        <div data-ui="dock-body" id={`${props.id}-body`} hidden={collapsed}>
          {props.body}
        </div>
      )}
      {props.actions !== undefined && (
        <footer data-ui="dock-foot">
          <div data-ui="dock-actions">{props.actions}</div>
        </footer>
      )}
    </section>
  )
}

export type DockRegionProps = {
  /**
   * The open docks, the newest last: it sits at the end edge and the others line up before it.
   * Several channels share the region (a call beside chat conversations); each owns its Dock.
   */
  docks?: JSXChild
  /** `fixed` (default) floats at the bottom end of the viewport. `embedded` stays in place for specimens. */
  placement?: 'fixed' | 'embedded'
}

/**
 * The page's one place for docks, at the bottom end of the viewport, above the page and under
 * menus, popovers and dialogs. It shows only while it holds a Dock. While it does, the page keeps
 * scroll room under its last row for a collapsed dock and toasts move to the top end, so neither
 * covers the other. Render it once per page, inside the design system scope; an island may keep
 * it empty until a dock opens.
 */
export const DockRegion = (props: DockRegionProps): TemplateResult => (
  <div data-ui="dock-region" data-placement={props.placement ?? 'fixed'}>
    {props.docks}
  </div>
)
