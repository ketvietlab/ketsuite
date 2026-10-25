import type { JSXChild, TemplateResult } from '@ketvietlab/ketjs-view'

/**
 * How a finished shell takes a URL-owned modal into its content slot.
 *
 * A screen frame returns the whole shell, and `modalWorkspace` used to put the modal after it. A
 * full load shows that, but fragment navigation only replaces the shell's slots, so a modal
 * opened by a row or a link changed the URL and showed nothing until a reload. The shell records
 * here how to render itself again with the modal inside `backend.content`, which both a full
 * load and a fragment carry.
 */
const withModal = new WeakMap<object, (modal: JSXChild) => TemplateResult>()

export const rememberShell = (
  result: TemplateResult,
  render: (modal: JSXChild) => TemplateResult,
): TemplateResult => {
  withModal.set(result as object, render)
  return result
}

/** The shell rendered again with `modal` in its content slot, or null for anything else. */
export const shellWithModal = (background: JSXChild, modal: JSXChild): TemplateResult | null => {
  if (!background || typeof background !== 'object') return null
  return withModal.get(background as object)?.(modal) ?? null
}
