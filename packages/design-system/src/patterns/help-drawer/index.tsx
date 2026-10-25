import type { JSXChild, TemplateResult } from '@ketvietlab/ketjs-view'
import { Icon } from '../../primitives/icon/index.tsx'

export const HOOKS = [
  'help-drawer',
  'help-head',
  'help-heading',
  'help-label',
  'help-title',
  'help-close',
  'help-body',
] as const
export type HelpDrawerProps = { id: string; label: string; title: string; closeLabel: string; body: JSXChild }

/** One screen-owned guide; the shell trigger and shared runtime own opening and focus. */
export const HelpDrawer = (props: HelpDrawerProps): TemplateResult => (
  <dialog data-ui="help-drawer" id={props.id} aria-labelledby={`${props.id}-title`}>
    <header data-ui="help-head">
      <Icon name="circle-help" />
      <div data-ui="help-heading">
        <p data-ui="help-label">{props.label}</p>
        <h2 data-ui="help-title" id={`${props.id}-title`}>
          {props.title}
        </h2>
      </div>
      <button data-ui="help-close" type="button" aria-label={props.closeLabel} title={props.closeLabel}>
        <Icon name="x" />
      </button>
    </header>
    <div data-ui="help-body">{props.body}</div>
  </dialog>
)
