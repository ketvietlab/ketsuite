import { each } from '@ketvietlab/ketjs-view'
import type { TemplateResult } from '@ketvietlab/ketjs-view'
import { Icon } from '../../primitives/icon/index.tsx'
import { Text } from '../../primitives/status/index.tsx'

export const HOOKS = [
  'stage-path',
  'stage-path-step',
  'stage-path-label',
  'stage-path-marker',
  'stage-path-text',
] as const

export type StagePathStep = {
  id: string
  label: string
  /** Where the record stands against this step. One step is `current`. */
  state: 'complete' | 'current' | 'upcoming'
  /** Moves the record to this step. Omit it when the viewer may not, and for the current step. */
  href?: string | null
  /** The outcome a closing step records, which colours it once it is current. */
  tone?: 'positive' | 'danger' | null
}

/**
 * Where one record stands in its process, like Salesforce's Path or an ERP's status bar.
 *
 * Not a `Pipeline`, which counts the work sitting in every stage of a process. A path
 * carries no numbers: each step is passed, current or still ahead. The current step
 * has `aria-current="step"`; a passed step says so in words as well as with a check,
 * because colour alone does not.
 *
 * Each chevron is drawn behind its step by the stylesheet, so the shape never clips a
 * focus ring. Names wrap rather than truncate. Once the path is narrower than 48rem,
 * steps other than the current one fold to their marker (a check, or their number);
 * their names stay in the accessible tree.
 */
export const StagePath = (props: {
  label: string
  /** Read after a passed step's name, for example "completed". */
  completeLabel: string
  steps: readonly StagePathStep[]
}): TemplateResult => (
  <ol data-ui="stage-path" aria-label={props.label}>
    {each(
      props.steps,
      (step) => step.id,
      (step, index) => {
        const current = step.state === 'current'
        const content = (
          <>
            {!current && (
              <span data-ui="stage-path-marker" aria-hidden="true">
                {step.state === 'complete' ? <Icon name="check" size="small" /> : String(index + 1)}
              </span>
            )}
            <span data-ui="stage-path-text">{step.label}</span>
            {step.state === 'complete' && <Text visuallyHidden>{`, ${props.completeLabel}`}</Text>}
          </>
        )
        return (
          <li data-ui="stage-path-step" data-state={step.state} data-tone={step.tone ?? null}>
            {step.href && !current ? (
              <a data-ui="stage-path-label" href={step.href}>
                {content}
              </a>
            ) : (
              <span data-ui="stage-path-label" aria-current={current ? 'step' : null}>
                {content}
              </span>
            )}
          </li>
        )
      },
    )}
  </ol>
)
