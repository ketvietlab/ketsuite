import { each } from '@ketvietlab/ketjs-view'
import type { JSXChild, TemplateResult } from '@ketvietlab/ketjs-view'
import { ActionGroup, Button, LinkButton } from '../../primitives/actions.tsx'
import type { ActionVariant } from '../../primitives/actions.tsx'
import { Field } from '../../primitives/field.tsx'
import type { FieldProps } from '../../primitives/field.tsx'

export const HOOKS = ['record-form', 'form-errors', 'form-fields', 'form-grid', 'form-actions'] as const

export type RecordFormProps = {
  id?: string | null
  action: string
  method?: 'get' | 'post'
  fields: readonly FieldProps[]
  /** Three peer fields on wide forms; narrow containers retain the single-column layout. */
  columns?: 2 | 3
  submitLabel: string
  submitVariant?: ActionVariant
  cancelHref?: string | null
  cancelLabel?: string | null
  errors?: readonly string[]
  hidden?: Record<string, string>
  /** A GET filter form without a submit step: the runtime submits a choice at once and typed text after
   * a pause. The submit button stays only as a hidden default button, so Enter still applies at once. */
  applyOnInput?: boolean
}

export type FormGridProps = {
  /** Fields of one group of a larger form; the `<form>` around the groups belongs to the caller. */
  items: readonly JSXChild[]
  /** Three peer fields per row once the group itself is 52rem wide, as a default-size dialog is. */
  columns?: 2 | 3
}

/**
 * The record form's field grid for one group of a form split into sections (a dialog's steps, a record's
 * groups). The group measures its own width, so a section of a dialog lays its fields out the way a record
 * form does without a record form around it.
 */
export const FormGrid = (props: FormGridProps): TemplateResult => (
  <div data-ui="form-fields">
    <div data-ui="form-grid" data-columns={props.columns === 3 ? '3' : undefined}>
      {each(
        props.items.filter((item) => item !== null && item !== undefined && item !== false && item !== ''),
        (_, index) => index,
        // `each` requires a TemplateResult callback, so the fragment wraps each item.
        (item) => (
          <>{item}</>
        ),
      )}
    </div>
  </div>
)

export const RecordForm = (props: RecordFormProps): TemplateResult => (
  <form
    data-ui="record-form"
    id={props.id ?? undefined}
    action={props.action}
    method={props.method ?? 'post'}
    data-apply={props.applyOnInput ? 'input' : undefined}
  >
    {Object.entries(props.hidden ?? {}).map(([name, value]) => (
      <input type="hidden" name={name} value={value} />
    ))}
    {!!props.errors?.length && (
      <ul data-ui="form-errors" role="alert">
        {each(
          props.errors,
          (error, index) => `${index}:${error}`,
          (error) => (
            <li>{error}</li>
          ),
        )}
      </ul>
    )}
    <div data-ui="form-grid" data-columns={props.columns === 3 ? '3' : undefined}>
      {each(
        props.fields,
        (field) => field.id,
        (field) => (
          <Field {...field} />
        ),
      )}
    </div>
    {props.applyOnInput && <button type="submit" hidden aria-label={props.submitLabel} />}
    {(!props.applyOnInput || !!props.cancelHref) && (
      <div data-ui="form-actions">
        <ActionGroup
          actions={[
            ...(props.applyOnInput
              ? []
              : [
                  <Button
                    label={props.submitLabel}
                    variant={props.submitVariant ?? 'primary'}
                    type="submit"
                  />,
                ]),
            ...(props.cancelHref
              ? [
                  <LinkButton
                    label={props.cancelLabel ?? 'Cancel'}
                    href={props.cancelHref}
                    variant="tertiary"
                  />,
                ]
              : []),
          ]}
        />
      </div>
    )}
  </form>
)
