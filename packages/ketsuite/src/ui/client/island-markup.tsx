import type { JSXChild } from '@ketvietlab/ketjs-view'

// The few elements a client island draws around its design-system patterns:
// the region its runtime and tests find it by, the polite announcement of
// what a change showed, and the native form a bulk action posts. They live
// in the kit so a module island composes them instead of writing markup.

/** The element an island's controller is found by, `data-<marker>="true"`. */
export const IslandRegion = (props: { marker: string; busy?: boolean; children?: JSXChild }) => {
  const attributes: Record<string, string> = { [`data-${props.marker}`]: 'true' }
  if (props.busy !== undefined) attributes['aria-busy'] = props.busy ? 'true' : 'false'
  return <div {...attributes}>{props.children}</div>
}

/** Read out when it changes, without moving focus. */
export const PoliteStatus = (props: { children?: JSXChild }) => (
  <div role="status" aria-live="polite">
    {props.children}
  </div>
)

/** A form controls elsewhere on the page submit through `form={id}`; it posts its hidden fields. */
export const HiddenPostForm = (props: { id: string; action: string; fields: Record<string, string> }) => (
  <form id={props.id} method="post" action={props.action}>
    {Object.entries(props.fields).map(([name, value]) => (
      <input type="hidden" name={name} value={value} autocomplete="off" />
    ))}
  </form>
)
