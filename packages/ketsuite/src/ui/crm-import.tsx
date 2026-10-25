import type { JSXChild } from '@ketvietlab/ketjs-view'

// The CRM import screens' own markup, kept in the kit like every other screen's: the native forms their
// commands post, the hidden values those forms carry, and the rule fields the import island reveals.

/** Hidden inputs for a native form. A list posts one input per value under the same name. */
export const HiddenValues = ({ values }: { values: Record<string, unknown> }) => (
  <>
    {Object.entries(values).flatMap(([name, value]) =>
      (Array.isArray(value) ? value : [value]).map((item) => (
        <input type="hidden" name={name} value={String(item ?? '')} autocomplete="off" />
      )),
    )}
  </>
)

/** A native POST form around an import command; `upload` lets it send the file field it contains. */
export const ImportForm = ({
  id,
  action,
  upload = false,
  children,
}: {
  id?: string
  action: string
  upload?: boolean
  children: JSXChild
}) => (
  <form id={id} method="post" action={action} enctype={upload ? 'multipart/form-data' : undefined}>
    {children}
  </form>
)

/** A rule field that applies to one choice only; the import island toggles `hidden` when the choice changes. */
export const ImportReveal = ({
  part,
  hidden,
  children,
}: {
  part: 'team' | 'person' | 'due'
  hidden: boolean
  children: JSXChild
}) => (
  <div data-import-reveal={part} hidden={hidden}>
    {children}
  </div>
)

/** What only a browser without the import runtime needs, such as the button that redraws a step. */
export const WithoutScript = ({ children }: { children: JSXChild }) => <noscript>{children}</noscript>

/** The element the import island looks its screen up from. */
export const ImportRoot = ({ children }: { children: JSXChild }) => <div data-crm-import-root>{children}</div>
