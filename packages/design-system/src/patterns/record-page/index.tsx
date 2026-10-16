import type { JSXChild, TemplateResult } from '@ketvietlab/ketjs-view'
import { pageIdentityContent, type PageIdentityKind } from '../page-shell.tsx'

export const HOOKS = [
  'record-page',
  'record-page-context',
  'record-page-header',
  'record-page-title-row',
  'record-page-heading',
  'record-page-title',
  'record-page-subline',
  'record-page-status',
  'record-page-actions',
  'record-page-meta',
  'record-page-path',
  'record-page-controller',
  'record-page-navigation',
  'record-page-layout',
  'record-page-body',
  'record-page-aside',
] as const

export type RecordPageSlots = {
  header: string
  body: string
  fragmentTitle?: string
}

export type RecordPageProps = {
  title: string
  body: JSXChild
  context?: JSXChild
  variant?: 'operational'
  width?: 'default' | 'wide'
  scope?: string | null
  status?: JSXChild
  actions?: JSXChild
  meta?: JSXChild
  /**
   * Where the record stands in its process (a `StagePath`). It belongs to the record's identity, so it is
   * the header's last row and the header owns its spacing; `controller` is for a working editor below it.
   */
  path?: JSXChild
  controller?: JSXChild
  navigation?: JSXChild
  aside?: JSXChild
  asideLabel?: string | null
  /**
   * Where the rail goes once the page stacks into one column. `after` (default) follows the record;
   * `before` leads it, for a rail of blockers the reader must see first. A leading rail also comes
   * first in the document, so focus and reading order match what a narrow screen shows; a wide page
   * still places it in the rail column.
   */
  asideWhenStacked?: 'after' | 'before'
  slots?: RecordPageSlots
}

type RecordPageKind = Extract<PageIdentityKind, 'record-page' | 'form-page'>

export const recordPage = (props: RecordPageProps, compatibilityKind?: RecordPageKind): TemplateResult => {
  const kind = compatibilityKind ?? 'record-page'
  const leading = props.asideWhenStacked === 'before'
  const path = props.path !== undefined && <div data-ui={`${kind}-path`}>{props.path}</div>
  const aside = props.aside !== undefined && (
    <aside data-ui={`${kind}-aside`} aria-label={props.asideLabel ?? null}>
      {props.aside}
    </aside>
  )
  if (props.slots?.fragmentTitle !== undefined)
    return (
      <ket-fragments data-title={props.slots.fragmentTitle}>
        <template data-ket-slot={props.slots.header}>
          {pageIdentityContent(kind, props)}
          {path}
        </template>
        <template data-ket-slot={props.slots.body}>{props.body}</template>
      </ket-fragments>
    )
  return (
    <section
      data-ui={kind}
      data-scope={props.scope ?? null}
      data-has-aside={String(props.aside !== undefined)}
      data-aside-stacked={props.aside !== undefined && props.asideWhenStacked === 'before' ? 'before' : null}
      data-variant={props.variant ?? null}
      data-width={props.width ?? 'default'}
      data-pattern="record"
    >
      {props.context != null && <div data-ui={`${kind}-context`}>{props.context}</div>}
      <header data-ui={`${kind}-header`} data-ket-slot={props.slots?.header}>
        {pageIdentityContent(kind, props)}
        {path}
      </header>
      {props.controller !== undefined && <div data-ui={`${kind}-controller`}>{props.controller}</div>}
      {props.navigation !== undefined && <div data-ui={`${kind}-navigation`}>{props.navigation}</div>}
      <div data-ui={`${kind}-layout`}>
        {leading && aside}
        <div data-ui={`${kind}-body`} data-ket-slot={props.slots?.body}>
          {props.body}
        </div>
        {!leading && aside}
      </div>
    </section>
  )
}

/** One durable subject: create, edit, inspect or advance its workflow. */
export const RecordPage = (props: RecordPageProps): TemplateResult => recordPage(props)
