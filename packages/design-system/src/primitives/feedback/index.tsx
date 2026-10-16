import { Icon } from '../icon/index.tsx'
import type { IconName } from '../icon/index.tsx'
import { Text } from '../status/index.tsx'
import { Skeleton } from '../../interactions/skeleton/index.tsx'
import type { JSXChild, TemplateResult } from '@ketvietlab/ketjs-view'

export const HOOKS = [
  'notice',
  'notice-mark',
  'notice-copy',
  'notice-title',
  'notice-message',
  'notice-actions',
  'empty',
  'empty-visual',
  'empty-art',
  'empty-mark',
  'empty-title',
  'empty-message',
  'empty-actions',
  'loading',
  'loading-label',
] as const

export type NoticeTone = 'info' | 'positive' | 'warning' | 'danger'

const NOTICE_ICONS: Record<NoticeTone, IconName> = {
  info: 'info',
  positive: 'circle-check',
  warning: 'triangle-alert',
  danger: 'circle-alert',
}

export const Notice = (props: {
  title: string
  message: string
  tone?: NoticeTone
  actions?: JSXChild
  announcement?: 'off' | 'polite' | 'assertive'
}): TemplateResult => (
  <aside
    data-ui="notice"
    data-pattern="notice"
    data-tone={props.tone ?? 'info'}
    role={
      props.announcement === 'off'
        ? undefined
        : props.announcement === 'assertive' || (props.announcement === undefined && props.tone === 'danger')
          ? 'alert'
          : 'status'
    }
  >
    <span data-ui="notice-mark" aria-hidden="true">
      <Icon name={NOTICE_ICONS[props.tone ?? 'info']} size="small" />
    </span>
    <div data-ui="notice-copy">
      <p data-ui="notice-title">
        <Text>{props.title}</Text>
      </p>
      <p data-ui="notice-message">
        <Text>{props.message}</Text>
      </p>
    </div>
    {props.actions !== undefined && <div data-ui="notice-actions">{props.actions}</div>}
  </aside>
)

/**
 * Why the region is empty, shown as the badge on the illustration. `empty` is the neutral default;
 * `start` invites the first record, `search` follows filters that match nothing, `done` marks a cleared
 * queue and `locked` a region the reader may not see.
 */
export type EmptyVisual = 'empty' | 'start' | 'search' | 'done' | 'locked'

const EMPTY_BADGES: Record<EmptyVisual, IconName> = {
  empty: 'inbox',
  start: 'plus',
  search: 'search',
  done: 'check',
  locked: 'lock',
}

/**
 * One frame and one size wherever a region is empty: a dashed placeholder panel holding an illustration,
 * the title, the message and an optional next step. The panel owns its inset and minimum height, so a
 * list, a record table and a dashboard block show the same state.
 */
export const EmptyState = (props: {
  title: string
  message: string
  actions?: JSXChild
  visual?: EmptyVisual
  /** Replaces the badge glyph of the chosen visual. */
  icon?: IconName
}): TemplateResult => {
  const visual = props.visual ?? 'empty'
  return (
    <div data-ui="empty" data-visual={visual} role="status">
      <span data-ui="empty-visual" aria-hidden="true">
        <svg data-ui="empty-art" viewBox="0 0 120 96" focusable="false" aria-hidden="true">
          <circle data-part="backdrop" cx="60" cy="50" r="42" />
          <rect
            data-part="sheet-back"
            x="30"
            y="22"
            width="50"
            height="60"
            rx="7"
            transform="rotate(-9 55 52)"
          />
          <rect data-part="sheet" x="38" y="16" width="50" height="62" rx="7" />
          <rect data-part="heading" x="47" y="27" width="20" height="5" rx="2.5" />
          <rect data-part="text" x="47" y="39" width="32" height="4" rx="2" />
          <rect data-part="text" x="47" y="49" width="26" height="4" rx="2" />
          <rect data-part="text" x="47" y="59" width="16" height="4" rx="2" />
        </svg>
        <span data-ui="empty-mark">
          <Icon name={props.icon ?? EMPTY_BADGES[visual]} size="small" />
        </span>
      </span>
      <p data-ui="empty-title">
        <Text>{props.title}</Text>
      </p>
      <p data-ui="empty-message">
        <Text>{props.message}</Text>
      </p>
      {props.actions !== undefined && <div data-ui="empty-actions">{props.actions}</div>}
    </div>
  )
}

export const LoadingState = (props: { label: string; lines?: number }): TemplateResult => (
  <div data-ui="loading" role="status" aria-live="polite">
    <span data-ui="loading-label">{props.label}</span>
    <Skeleton label={props.label} lines={props.lines} decorative />
  </div>
)
