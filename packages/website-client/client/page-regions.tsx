// A page is composed once with public DS components. The host places independently hydratable
// regions in its data-dependent slots; the pattern, identity and title stay server-owned.
import {
  ListPage as NativeListPage,
  RecordPage as NativeRecordPage,
  WorkspacePage as NativeWorkspacePage,
  ModalSheet as NativeModalSheet,
  IconButton,
  Icon,
} from '@ketvietlab/design-system'
import { tr } from './i18n.ts'
import { html, signal, trustedMarkup } from '@ketvietlab/ketjs-view'
import type { JSXChild, TemplateResult } from '@ketvietlab/ketjs-view'
import type { ListPageProps, RecordPageProps, WorkspacePageProps } from '@ketvietlab/design-system'
type ModalSheetProps = Parameters<typeof NativeModalSheet>[0]

export type RegionPlacement = (id: string, value: JSXChild, loading: boolean) => JSXChild
type Boundary = { place: RegionPlacement; index: number }
let boundary: Boundary | null = null

/** Synchronous, render-pure scope; never hold this scope across an await. */
export function withPageRegions<T>(render: () => T, place: RegionPlacement): T {
  const previous = boundary
  boundary = { place, index: 0 }
  try {
    return render()
  } finally {
    boundary = previous
  }
}

/** Public component slots are the boundary; no DS DOM inspection or private markup is involved. */
export function pageRegions<P extends { body: JSXChild }>(
  kind: string,
  props: P,
  render: (props: P) => TemplateResult,
  slots: readonly (keyof P)[],
): TemplateResult {
  if (!boundary) return render(props)
  const current = boundary
  const id = `${kind}-${current.index++}`
  const framed = { ...props }
  for (const slot of slots) {
    // Always place the body. Optional regions exist only when the presenter declares them.
    if (slot !== 'body' && props[slot] == null) continue
    framed[slot] = current.place(
      `${id}.${String(slot)}`,
      props[slot] as JSXChild,
      slot === 'body',
    ) as P[keyof P]
  }
  return render(framed)
}

// Studio pages share the DS operational header rhythm; body anatomy must not choose header density.
const helpAction = () => (
  <IconButton
    label={tr('website.help.open')}
    icon={<Icon name="info" />}
    name="screen-help"
    value="website-screen-help"
    controls="website-screen-help"
    expanded={false}
    variant="tertiary"
  />
)
const operational = <P extends { variant?: 'operational'; actions?: JSXChild }>(props: P): P => ({
  ...props,
  variant: props.variant ?? 'operational',
  actions: (
    <>
      {props.actions}
      {helpAction()}
    </>
  ),
})

export const ListPage = (props: ListPageProps) =>
  pageRegions('list', operational(props), NativeListPage, [
    'headerActions',
    'actions',
    'controls',
    'selection',
    'status',
    'body',
    'footer',
  ])
export const RecordPage = (props: RecordPageProps) =>
  pageRegions('record', operational(props), NativeRecordPage, [
    'actions',
    'meta',
    'status',
    'controller',
    'navigation',
    'body',
    'aside',
  ])
export const WorkspacePage = (props: WorkspacePageProps) =>
  pageRegions('workspace', operational(props), NativeWorkspacePage, [
    'actions',
    'meta',
    'status',
    'controls',
    'body',
  ])
export const ModalSheet = (props: ModalSheetProps) =>
  pageRegions(
    'modal',
    {
      ...props,
      actions: (
        <>
          {props.actions}
          {helpAction()}
        </>
      ),
    },
    NativeModalSheet,
    ['body', 'actions'],
  )

export const emptyRegion = () => html``

export type StudioRegionProps = { id: string; initial: string }
/** The first client render is always the server's region, even when another region has loaded. */
export function createWebsiteRegion(props: StudioRegionProps, render?: () => TemplateResult) {
  const mounted = signal(false)
  return {
    view: () => (mounted() && render ? render() : html`${trustedMarkup(props.initial)}`),
    mount: () => mounted.set(true),
  }
}
