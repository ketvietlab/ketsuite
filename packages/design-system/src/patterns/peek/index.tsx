import type { JSXChild, TemplateResult } from '@ketvietlab/ketjs-view'
import { IconButton, LinkButton } from '../../primitives/actions/index.tsx'
import { Icon } from '../../primitives/icon/index.tsx'
import { Skeleton } from '../../interactions/skeleton/index.tsx'

export const HOOKS = [
  'peek-layout',
  'peek-layout-main',
  'peek-layout-aside',
  'peek',
  'peek-head',
  'peek-heading',
  'peek-eyebrow',
  'peek-title',
  'peek-status',
  'peek-tools',
  'peek-body',
  'peek-foot',
  'peek-actions',
] as const

/** A step to the previous or next record of the same view; `href: null` is the end of the run. */
export type PeekStep = { label: string; href: string | null }

export type PeekProps = {
  /**
   * The `peekId` of the PeekLayout it sits in: the stem of the title and close control ids.
   * Invokers name the layout's place with `aria-controls`, which keeps the id while no Peek is open.
   */
  id: string
  title: string
  /** The record's code or kind, above the title. */
  eyebrow?: string | null
  /** Badges for the record's state, under the title. */
  status?: JSXChild
  /** A summary only: description lists, short notes. No editable fields. */
  body: JSXChild
  /** Two or three commands for this state, at most one primary. They open nested dialogs. */
  actions?: JSXChild
  /**
   * A peek always leads to the full record: its page (or modal) is where the work happens.
   * It is the expand tool in the head, beside close, so the commands keep the whole foot.
   */
  record: { label: string; href: string }
  closeLabel: string
  /** A link when the peek is in the URL (`peek=<id>`); without it the close control is a button. */
  closeHref?: string | null
  /** A CSR owner may wrap the public close action in its own state trigger. */
  closeControl?: JSXChild
  previous?: PeekStep | null
  next?: PeekStep | null
  /**
   * Shows the frame with a skeleton body while the record's summary loads, so the
   * panel keeps its place and width; the title comes from the invoker the user picked.
   */
  loading?: { label: string } | null
}

type ToolIcon = 'chevron-left' | 'chevron-right' | 'maximize-2' | 'x'

/** Header tools keep the 32px target; the glyph is the small size, so the title leads. */
const tool = (props: {
  label: string
  icon: ToolIcon
  href?: string | null
  id?: string
  disabled?: boolean
}): TemplateResult => {
  const glyph = <Icon name={props.icon} size="small" />
  return props.href ? (
    <LinkButton
      id={props.id}
      label={props.label}
      href={props.href}
      leading={glyph}
      iconOnly
      variant="tertiary"
    />
  ) : (
    <IconButton id={props.id} label={props.label} icon={glyph} disabled={props.disabled} />
  )
}

/** A step to the previous or next record; `href: null` renders the end of the run disabled. */
const step = (item: PeekStep, icon: ToolIcon): TemplateResult =>
  tool({ label: item.label, icon, href: item.href, disabled: item.href === null })

/**
 * A non-modal summary of one record, docked beside a spatial view (tape chart,
 * timeline, board) in a PeekLayout. The view stays interactive: picking another
 * item replaces the peek's content. It is a first look, not an editor: commands
 * open nested dialogs, and `record` opens the full record.
 */
export const Peek = (props: PeekProps): TemplateResult => (
  <aside
    data-ui="peek"
    aria-labelledby={`${props.id}-title`}
    aria-busy={props.loading ? 'true' : null}
    tabindex="-1"
  >
    <header data-ui="peek-head">
      {/* Announced when another item replaces the content while focus stays in the view. */}
      <div data-ui="peek-heading" aria-live="polite">
        {!!props.eyebrow && <p data-ui="peek-eyebrow">{props.eyebrow}</p>}
        <h2 data-ui="peek-title" id={`${props.id}-title`}>
          {props.title}
        </h2>
      </div>
      <div data-ui="peek-tools">
        {props.previous ? step(props.previous, 'chevron-left') : null}
        {props.next ? step(props.next, 'chevron-right') : null}
        {tool({ label: props.record.label, icon: 'maximize-2', href: props.record.href })}
        {props.closeControl ??
          tool({ id: `${props.id}-close`, label: props.closeLabel, icon: 'x', href: props.closeHref })}
      </div>
      {props.status !== undefined && !props.loading && <div data-ui="peek-status">{props.status}</div>}
    </header>
    <div data-ui="peek-body">
      {props.loading ? <Skeleton label={props.loading.label} lines={6} /> : props.body}
    </div>
    {props.actions !== undefined && !props.loading && (
      <footer data-ui="peek-foot">
        <div data-ui="peek-actions">{props.actions}</div>
      </footer>
    )}
  </aside>
)

export type PeekLayoutProps = {
  /**
   * The id of the peek's place, which stays in the DOM while no Peek is open, so invokers in
   * `main` can name it with `aria-controls` in every state. The Peek inside takes it as `id`.
   */
  peekId: string
  /** The spatial view. */
  main: JSXChild
  /** The Peek, or the island that renders it. Hidden while it holds no Peek. */
  peek?: JSXChild
  /**
   * `docked` (default) keeps the peek in view beside the work, and makes it a sheet over the
   * lower part of the view below 64rem (tablet and phone).
   * `embedded` lays it out in place, for documentation and catalogue specimens.
   */
  mode?: 'docked' | 'embedded'
}

/** Docks a Peek beside its view from 64rem, and over its lower part below that. */
export const PeekLayout = (props: PeekLayoutProps): TemplateResult => (
  <div data-ui="peek-layout" data-peek-id={props.peekId} data-mode={props.mode ?? 'docked'}>
    <div data-ui="peek-layout-main">{props.main}</div>
    <div data-ui="peek-layout-aside" id={props.peekId}>
      {props.peek}
    </div>
  </div>
)
