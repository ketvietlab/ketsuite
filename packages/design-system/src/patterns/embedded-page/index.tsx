import type { TemplateResult } from '@ketvietlab/ketjs-view'

export const HOOKS = ['embedded-page', 'embedded-page-frame'] as const

export type EmbeddedPageProps = {
  /** The page to show: an absolute http(s) URL on another origin, chosen by the host. */
  src: string
  /** Names the screen (a visually hidden level-one heading) and the frame. */
  title: string
}

/**
 * A page served elsewhere shown as this whole screen, edge to edge below the shell's top bar:
 * for example a product introduction from a marketing site. The screen has no page header of
 * its own, so the title is its visually hidden heading. The frame is sandboxed (scripts, forms
 * and pop-ups, no navigating this page) and tells the other site only this origin.
 */
export const EmbeddedPage = (props: EmbeddedPageProps): TemplateResult => (
  <section data-ui="embedded-page">
    <h1 data-ui="visually-hidden">{props.title}</h1>
    <iframe
      data-ui="embedded-page-frame"
      src={props.src}
      title={props.title}
      referrerpolicy="strict-origin-when-cross-origin"
      sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-popups-to-escape-sandbox"
    ></iframe>
  </section>
)
