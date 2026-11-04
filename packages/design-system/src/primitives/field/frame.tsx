import type { JSXChild, TemplateResult } from '@ketvietlab/ketjs-view'
import { Text } from '../status/index.tsx'

export type FieldFrameProps = {
  id: string
  label: string
  size?: 'default' | 'large'
  control: JSXChild
  help?: string | null
  error?: string | null
  required?: boolean
  labelHidden?: boolean
  selectionHidden?: boolean
  span?: 'half' | 'full'
  /**
   * How long the value is, so the control is no wider than it needs: `xs` a few characters (a rate, a
   * count of months), `sm` a short value (an amount, a date, a reference, a barcode), `md` a short choice
   * (a unit, a group, a warehouse). Without it the control fills its column. Label, help and error keep
   * their tracks; the control never grows past its column.
   */
  width?: FieldWidth
  kind: string
  layout?: 'inline'
  group?: boolean
  action?: JSXChild
}

export type FieldWidth = 'xs' | 'sm' | 'md'

export const describedBy = (id: string, help?: string | null, error?: string | null): string | null =>
  [help ? `${id}-help` : null, error ? `${id}-error` : null].filter(Boolean).join(' ') || null

export const FieldMessages = (props: Pick<FieldFrameProps, 'id' | 'help' | 'error'>): TemplateResult => (
  <>
    {!!props.help && (
      <small data-ui="field-help" id={`${props.id}-help`}>
        <Text>{props.help}</Text>
      </small>
    )}
    {!!props.error && (
      <small data-ui="field-error" id={`${props.id}-error`}>
        <Text>{props.error}</Text>
      </small>
    )}
  </>
)

/** Owns label/help/error association for native, choice and enhanced controls. */
export const FieldFrame = (props: FieldFrameProps): TemplateResult => {
  const Label = props.group ? 'span' : 'label'
  return (
    <div
      data-ui="field"
      data-kind={props.kind}
      data-layout={props.layout ?? null}
      data-size={props.size ?? null}
      data-span={props.span ?? 'half'}
      data-width={props.width ?? null}
      data-label-hidden={props.labelHidden ? 'true' : null}
      data-selection-hidden={props.selectionHidden ? 'true' : null}
      data-invalid={String(!!props.error)}
    >
      <Label
        data-ui="field-label"
        id={props.group ? `${props.id}-label` : undefined}
        for={props.group ? null : props.id}
      >
        <Text>{props.label}</Text>
        {props.required && (
          <span data-ui="field-required" aria-hidden="true">
            {' *'}
          </span>
        )}
      </Label>
      {props.action === undefined ? (
        props.control
      ) : (
        <div data-ui="field-row">
          {props.control}
          {props.action}
        </div>
      )}
      <FieldMessages {...props} />
    </div>
  )
}
