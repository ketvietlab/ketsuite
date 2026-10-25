import type { JSXChild, TemplateResult } from '@ketvietlab/ketjs-view'
import { pageIdentity, type PageIdentityKind } from '../page-shell.tsx'

export const HOOKS = [
  'workspace-page',
  'workspace-page-context',
  'workspace-page-header',
  'workspace-page-heading',
  'workspace-page-eyebrow',
  'workspace-page-title-row',
  'workspace-page-title',
  'workspace-page-subline',
  'workspace-page-status',
  'workspace-page-actions',
  'workspace-page-meta',
  'workspace-page-toolbar',
  'workspace-page-controls',
  'workspace-page-body',
] as const

/** Hooks of the master-detail body: a list of items beside the one being worked on. */
export const SPLIT_HOOKS = ['workspace-split', 'workspace-master', 'workspace-detail'] as const

export type WorkspacePageProps = {
  title: string
  body: JSXChild
  context?: JSXChild
  variant?: 'operational'
  /** Vertical work surfaces use flow; boards, timelines and maps use canvas. */
  layout?: 'flow' | 'canvas'
  eyebrow?: string | null
  status?: JSXChild
  meta?: JSXChild
  actions?: JSXChild
  controls?: JSXChild
  /**
   * Master-detail: the items to work through (usually a `ResourceList` with `currentId`), shown
   * beside `body`, which works on the current one. Side by side while the detail keeps more than
   * 60% of the width and the 38rem a table needs; stacked, master first, when it would not.
   */
  master?: JSXChild
  /** Names the master region, e.g. "Unmatched transactions". Required with `master`. */
  masterLabel?: string
}

type CompatibilityKind = Extract<PageIdentityKind, 'dashboard-page' | 'board-page'>

export const workspacePage = (
  props: WorkspacePageProps,
  compatibilityKind?: CompatibilityKind,
): TemplateResult => {
  const kind = compatibilityKind ?? (props.layout === 'canvas' ? 'board-page' : 'dashboard-page')
  return (
    <section
      data-ui={kind}
      data-variant={props.variant ?? null}
      data-layout={props.layout ?? 'flow'}
      data-pattern="workspace"
    >
      {pageIdentity(kind, props)}
      {props.controls !== undefined && (
        <div data-ui={`${kind}-toolbar`}>
          <div data-ui={`${kind}-controls`}>{props.controls}</div>
        </div>
      )}
      <div data-ui={`${kind}-body`}>
        {props.master === undefined ? (
          props.body
        ) : (
          <div data-ui="workspace-split">
            <section data-ui="workspace-master" aria-label={props.masterLabel}>
              {props.master}
            </section>
            <div data-ui="workspace-detail">{props.body}</div>
          </div>
        )}
      </div>
    </section>
  )
}

/** One operational canvas, with flow and horizontal-canvas layout modes. */
export const WorkspacePage = (props: WorkspacePageProps): TemplateResult => workspacePage(props)
