import { each } from '@ketvietlab/ketjs-view'
import type { JSXChild, TemplateResult } from '@ketvietlab/ketjs-view'
import { Progress } from '../../primitives/progress/index.tsx'
import type { Tone } from '../../primitives/status/index.tsx'

export const HOOKS = [
  'toast-region',
  'toast',
  'toast-copy',
  'toast-title',
  'toast-message',
  'toast-actions',
  'toast-progress',
] as const

export type ToastProps = {
  id: string
  title: string
  message?: string
  tone?: Tone
  actions?: JSXChild
  /**
   * How far the work this toast reports has got, for work that runs in the background
   * (an import). The bar and its label are not announced: a live region would read every
   * update, so the title and message carry what a reader must hear (started, finished).
   */
  progress?: { value: number; label: string }
}

export const Toast = (props: ToastProps): TemplateResult => (
  <article
    data-ui="toast"
    data-tone={props.tone ?? 'neutral'}
    role={props.tone === 'danger' ? 'alert' : 'status'}
  >
    <div data-ui="toast-copy">
      <strong data-ui="toast-title">{props.title}</strong>
      {props.message && <p data-ui="toast-message">{props.message}</p>}
    </div>
    {props.actions !== undefined && <div data-ui="toast-actions">{props.actions}</div>}
    {props.progress && (
      <div data-ui="toast-progress" aria-live="off">
        <Progress value={props.progress.value} label={props.progress.label} size="small" />
      </div>
    )}
  </article>
)

export const ToastRegion = (props: { label: string; toasts: readonly ToastProps[] }): TemplateResult => (
  <section data-ui="toast-region" aria-label={props.label} aria-live="polite" aria-relevant="additions text">
    {each(
      props.toasts,
      (toast) => toast.id,
      (toast) => (
        <Toast {...toast} />
      ),
    )}
  </section>
)
