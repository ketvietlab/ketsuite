import { each } from '@ketvietlab/ketjs-view'
import type { JSXChild, TemplateResult } from '@ketvietlab/ketjs-view'
import { Icon } from '../../primitives/icon/index.tsx'
import { Text } from '../../primitives/status/index.tsx'
import type { Tone } from '../../primitives/status.tsx'

export const HOOKS = [
  'stack',
  'inline',
  'grid',
  'card-grid',
  'surface',
  'surface-head',
  'surface-heading',
  'surface-title',
  'surface-description',
  'surface-actions',
  'disclosure',
  'disclosure-summary',
  'disclosure-body',
  'disclosure-label',
  'disclosure-meta',
  'section',
  'section-head',
  'section-eyebrow',
  'section-title',
  'section-description',
  'section-actions',
  'section-body',
  'content-card',
  'card-media',
  'card-content',
  'card-head',
  'card-leading',
  'card-heading',
  'card-eyebrow',
  'card-title',
  'card-summary',
  'card-status',
  'card-body',
  'card-meta',
  'card-actions',
  'kanban',
  'kanban-empty',
  'kanban-card',
  'kanban-media',
  'kanban-title',
  'kanban-meta',
  'kanban-note',
  'kanban-actions',
  'metric',
  'metric-icon',
  'metric-label',
  'metric-value',
  'metric-change',
  'metric-detail',
] as const

export { AppShell, Page, PageHeader, RecordCanvas, RecordSection } from '../shell.tsx'

const Items = (props: { items: readonly JSXChild[] }): TemplateResult => (
  <>
    {each(
      props.items,
      (_, index) => index,
      // biome-ignore lint/complexity/noUselessFragments: `each` requires a TemplateResult callback.
      (item) => (typeof item === 'string' || typeof item === 'number' ? <span>{item}</span> : <>{item}</>),
    )}
  </>
)

export type LayoutGap = 'none' | 'tight' | 'compact' | 'column' | 'default' | 'loose'
export type ResponsiveGap = LayoutGap | { desktop: LayoutGap; mobile: LayoutGap }
const gapAttributes = (gap: ResponsiveGap | undefined, fallback: LayoutGap) => ({
  'data-gap': typeof gap === 'object' ? gap.desktop : (gap ?? fallback),
  'data-mobile-gap': typeof gap === 'object' ? gap.mobile : null,
})

/**
 * `divided` draws a hairline between items, the peer-section divider of Két Design System visual contract
 * L3 (a form with several groups, a list of sections in a modal). It never frames
 * an item.
 */
export const Stack = (props: {
  items: readonly JSXChild[]
  gap?: ResponsiveGap
  inlineAlign?: 'start' | 'center' | 'end' | 'stretch'
  divided?: boolean
}): TemplateResult => (
  <div
    data-ui="stack"
    data-pattern="stack"
    {...gapAttributes(props.gap, 'default')}
    data-inline-align={props.inlineAlign ?? null}
    data-divided={props.divided === true ? 'true' : null}
  >
    <Items items={props.items} />
  </div>
)

export const Inline = (props: {
  items: readonly JSXChild[]
  gap?: ResponsiveGap
  align?: 'start' | 'center' | 'end' | 'between'
  blockAlign?: 'start' | 'center' | 'end' | 'baseline' | 'stretch'
  wrap?: boolean
}): TemplateResult => (
  <div
    data-ui="inline"
    {...gapAttributes(props.gap, 'compact')}
    data-align={props.align ?? null}
    data-block-align={props.blockAlign ?? null}
    data-wrap={props.wrap === false ? 'false' : null}
  >
    <Items items={props.items} />
  </div>
)

/**
 * Fixed columns. `align="stretch"` gives every block in a row the row's height,
 * so side-by-side dashboard cards end on one line instead of leaving a hole
 * under the shorter one.
 */
export const Grid = (props: {
  items: readonly JSXChild[]
  columns?: 2 | 3 | 4
  mobileColumns?: 1 | 2
  gap?: ResponsiveGap
  align?: 'start' | 'stretch'
}): TemplateResult => (
  <div
    data-ui="grid"
    data-columns={String(props.columns ?? 3)}
    data-align={props.align === 'stretch' ? 'stretch' : null}
    {...gapAttributes(props.gap, 'default')}
    data-mobile-columns={props.mobileColumns ? String(props.mobileColumns) : null}
  >
    <Items items={props.items} />
  </div>
)

export type CardGridProps<T> = {
  items: readonly T[]
  id: (item: T) => unknown
  card: (item: T) => TemplateResult
  minimum?: 'compact' | 'default' | 'wide'
}

/** An adaptive card collection; unlike `Grid`, column count follows available width. */
export const CardGrid = <T,>(props: CardGridProps<T>): TemplateResult => (
  <div data-ui="card-grid" data-minimum={props.minimum === 'default' ? null : props.minimum}>
    {each(props.items, props.id, (item) => props.card(item))}
  </div>
)

export const Surface = (props: {
  body: JSXChild
  title?: string
  /** One line under the title. A dashboard block keeps its heading, context and content in one card. */
  description?: string | null
  actions?: JSXChild
  tone?: 'default' | 'subtle' | 'raised'
  padding?: 'none' | 'compact' | 'default'
  /** The card's anchor, for a link elsewhere on the page that points at it (`#id`). */
  id?: string
}): TemplateResult => (
  <div
    data-ui="surface"
    id={props.id}
    data-tone={props.tone ?? 'default'}
    data-padding={props.padding ?? 'default'}
    data-has-heading={props.title ? 'true' : null}
  >
    {props.title && (
      <header data-ui="surface-head">
        {props.description ? (
          <div data-ui="surface-heading">
            <h2 data-ui="surface-title">
              <Text>{props.title}</Text>
            </h2>
            <p data-ui="surface-description">{props.description}</p>
          </div>
        ) : (
          <h2 data-ui="surface-title">
            <Text>{props.title}</Text>
          </h2>
        )}
        {props.actions !== undefined && <div data-ui="surface-actions">{props.actions}</div>}
      </header>
    )}
    {props.body}
  </div>
)

/** Native, keyboard-accessible progressive disclosure for dense secondary detail. */
/**
 * Detail behind one line. `meta` is what the line says about it at a glance (a
 * status, a level), kept beside the label so a closed list still reads.
 */
export const Disclosure = (props: {
  summary: string
  meta?: JSXChild
  body: JSXChild
  open?: boolean
}): TemplateResult => (
  <details data-ui="disclosure" open={props.open === true ? true : undefined}>
    <summary data-ui="disclosure-summary">
      {props.meta === undefined ? (
        props.summary
      ) : (
        <>
          <span data-ui="disclosure-label">{props.summary}</span>
          <span data-ui="disclosure-meta">{props.meta}</span>
        </>
      )}
    </summary>
    <div data-ui="disclosure-body">{props.body}</div>
  </details>
)

export const Section = (props: {
  title: string
  body: JSXChild
  description?: string | null
  eyebrow?: string | null
  actions?: JSXChild
  /**
   * Names the section by its title. Give one when sections repeat the same fields (one per guest, one per
   * line): a field's label alone ("Name") then does not say whose it is.
   */
  id?: string | null
}): TemplateResult => (
  <section
    data-ui="section"
    id={props.id ?? undefined}
    aria-labelledby={props.id ? `${props.id}-title` : undefined}
  >
    <header data-ui="section-head">
      <div>
        {!!props.eyebrow && <p data-ui="section-eyebrow">{props.eyebrow}</p>}
        <h2 data-ui="section-title" id={props.id ? `${props.id}-title` : undefined}>
          <Text>{props.title}</Text>
        </h2>
        {!!props.description && <p data-ui="section-description">{props.description}</p>}
      </div>
      {props.actions !== undefined && <div data-ui="section-actions">{props.actions}</div>}
    </header>
    <div data-ui="section-body">{props.body}</div>
  </section>
)

export type ContentCardProps = {
  title: string
  eyebrow?: string | null
  summary?: string | null
  leading?: JSXChild
  media?: JSXChild
  /**
   * `top` (default) runs `media` edge to edge above the card. `start` keeps a square
   * picture beside all of the card's content, for catalogue items whose image identifies
   * them; the `meta` row then holds the item's key figure (a price) at the content's end.
   */
  mediaPlacement?: 'top' | 'start'
  status?: JSXChild
  body?: JSXChild
  meta?: JSXChild
  actions?: JSXChild
  href?: string | null
  selected?: boolean
  tone?: 'default' | 'subtle' | 'raised'
  padding?: 'compact' | 'default'
}

export const ContentCard = (props: ContentCardProps): TemplateResult => {
  const besideMedia = props.media !== undefined && props.mediaPlacement === 'start'
  const content = (
    <>
      <header data-ui="card-head">
        {props.leading !== undefined && (
          <span data-ui="card-leading" aria-hidden="true">
            {props.leading}
          </span>
        )}
        <div data-ui="card-heading">
          {!!props.eyebrow && <p data-ui="card-eyebrow">{props.eyebrow}</p>}
          <h3 data-ui="card-title">{props.href ? <a href={props.href}>{props.title}</a> : props.title}</h3>
          {!!props.summary && <p data-ui="card-summary">{props.summary}</p>}
        </div>
        {props.status !== undefined && <div data-ui="card-status">{props.status}</div>}
      </header>
      {props.body !== undefined && <div data-ui="card-body">{props.body}</div>}
      {props.meta !== undefined && <div data-ui="card-meta">{props.meta}</div>}
      {props.actions !== undefined && <div data-ui="card-actions">{props.actions}</div>}
    </>
  )
  return (
    <article
      data-ui="content-card"
      data-interactive={String(!!props.href)}
      data-selected={String(props.selected === true)}
      data-tone={props.tone ?? 'default'}
      data-padding={props.padding ?? 'default'}
      data-media={besideMedia ? 'start' : null}
    >
      {props.media !== undefined && <div data-ui="card-media">{props.media}</div>}
      {besideMedia ? <div data-ui="card-content">{content}</div> : content}
    </article>
  )
}

export type KanbanCardProps = {
  id: string
  title: string
  href?: string | null
  media?: JSXChild
  meta?: JSXChild
  note?: string | null
  actions?: JSXChild
  selected?: boolean
  /** Native drag source; the product runtime validates and handles the move. */
  draggable?: boolean
}

export const KanbanCard = (props: KanbanCardProps): TemplateResult => (
  <article
    data-ui="kanban-card"
    data-key={props.id}
    draggable={props.draggable === true ? 'true' : undefined}
    data-interactive={String(!!props.href)}
    data-selected={String(props.selected === true)}
  >
    {props.media !== undefined && <div data-ui="kanban-media">{props.media}</div>}
    <h3 data-ui="kanban-title">
      {props.href ? (
        // The link covers the card; a draggable card is dragged as itself, not as a link.
        <a href={props.href} draggable={props.draggable === true ? 'false' : undefined}>
          {props.title}
        </a>
      ) : (
        props.title
      )}
    </h3>
    {props.meta !== undefined && <div data-ui="kanban-meta">{props.meta}</div>}
    {!!props.note && <p data-ui="kanban-note">{props.note}</p>}
    {props.actions !== undefined && <div data-ui="kanban-actions">{props.actions}</div>}
  </article>
)

export type KanbanGridProps<T> = {
  rows: readonly T[]
  id: (row: T) => unknown
  card: (row: T) => TemplateResult
  /** A lane remains a usable drop target even when rows is empty. */
  dropTarget?: string
  dropLabel?: string
  emptyLabel?: string
}

export const KanbanGrid = <T,>(props: KanbanGridProps<T>): TemplateResult => (
  <div data-ui="kanban" data-drop-target={props.dropTarget} role="group" aria-label={props.dropLabel}>
    {each(props.rows, props.id, (row) => props.card(row))}
    {props.dropTarget && props.rows.length === 0 && (
      <p data-ui="kanban-empty">{props.emptyLabel ?? props.dropLabel}</p>
    )}
  </div>
)

/**
 * One number, with the context that makes it mean something.
 *
 * `tone` colours a dot beside the label and nothing else. The number itself stays
 * in the page's ink: a KPI row is read by comparing figures, and four differently
 * coloured figures are compared by colour instead. The dot is drawn only when a
 * tone is passed, so a metric that has no state to report does not grow a grey
 * bullet that means nothing.
 *
 * `href` makes the whole card the link rather than the label, because the card is
 * what the pointer is already over. There is nothing else inside a metric to
 * click, which is exactly why `ContentCard` does the opposite.
 *
 * `change` compares the figure with an earlier period. The label carries the
 * signed amount and the period in words ("+12.4% vs previous 7 days"), the arrow
 * repeats the direction, and the tone says whether that direction is good: a cost
 * that went up is `danger` although its arrow points up. Colour is never the only
 * cue, and the figure itself stays in the page's ink.
 */
export type MetricChange = {
  label: string
  direction: 'up' | 'down' | 'flat'
  tone?: 'positive' | 'danger' | 'neutral'
}

export const Metric = (props: {
  label: string
  value: string | number
  detail?: string | null
  tone?: Tone
  /**
   * A glyph naming the quantity, in a tile beside it. Decorative: the label is
   * the name of the number, so this is hidden from assistive technology.
   */
  icon?: JSXChild
  href?: string | null
  change?: MetricChange | null
}): TemplateResult => {
  const attributes = {
    'data-ui': 'metric',
    'data-tone': props.tone ?? 'neutral',
    // One marker to a card, never two. The dot reports state for a metric that
    // has no glyph; where there is a glyph, the glyph is already the thing the
    // eye lands on, and a coloured bullet beside the label competes with it.
    'data-dot': String(props.tone !== undefined && props.icon === undefined),
  }
  const body = (
    <>
      {props.icon !== undefined && (
        <span data-ui="metric-icon" aria-hidden="true">
          {props.icon}
        </span>
      )}
      <p data-ui="metric-label">{props.label}</p>
      <p data-ui="metric-value">{String(props.value)}</p>
      {!!props.change && (
        <p
          data-ui="metric-change"
          data-direction={props.change.direction}
          data-tone={props.change.tone ?? 'neutral'}
        >
          <Icon
            name={
              props.change.direction === 'up'
                ? 'trending-up'
                : props.change.direction === 'down'
                  ? 'trending-down'
                  : 'minus'
            }
            size="small"
          />
          {props.change.label}
        </p>
      )}
      {!!props.detail && <p data-ui="metric-detail">{props.detail}</p>}
    </>
  )
  return props.href ? (
    <a {...attributes} data-interactive="true" href={props.href}>
      {body}
    </a>
  ) : (
    <article {...attributes} data-interactive="false">
      {body}
    </article>
  )
}
