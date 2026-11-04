import type { TemplateResult } from '@ketvietlab/ketjs-view'
import { Field } from '../../primitives/field/index.tsx'
import type { FieldOption, FieldProps } from '../../primitives/field/index.tsx'
import { issueFor } from '../shared.tsx'
import type { FieldIssue } from '../shared.tsx'

export const HOOKS = ['switch-control', 'switch-track'] as const

type CommonProps = Omit<FieldProps, 'type' | 'fields' | 'control' | 'error'> & {
  issues?: readonly FieldIssue[]
  error?: string | null
}

/** Shared field metadata. Each scalar exposes only the options it implements. */
export type ScalarFieldBase = Pick<
  CommonProps,
  | 'id'
  | 'name'
  | 'label'
  | 'size'
  | 'labelHidden'
  | 'help'
  | 'error'
  | 'issues'
  | 'required'
  | 'disabled'
  | 'span'
  | 'width'
>
export type TextFieldProps = ScalarFieldBase &
  Pick<
    CommonProps,
    | 'value'
    | 'placeholder'
    | 'readOnly'
    | 'autocomplete'
    | 'appearance'
    | 'prefix'
    | 'suffix'
    | 'inputMode'
    | 'align'
    | 'maxLength'
    | 'minLength'
    | 'pattern'
  > & { type?: 'text' | 'email' | 'tel' | 'password' | 'url' }
export type TextAreaProps = ScalarFieldBase &
  Pick<
    CommonProps,
    'value' | 'placeholder' | 'readOnly' | 'appearance' | 'rows' | 'resize' | 'maxLength' | 'minLength'
  >
export type NumberFieldProps = ScalarFieldBase &
  Pick<
    CommonProps,
    | 'value'
    | 'placeholder'
    | 'readOnly'
    | 'appearance'
    | 'min'
    | 'max'
    | 'step'
    | 'prefix'
    | 'suffix'
    | 'align'
  > & {
    /**
     * Type and show the number as this language writes it: "28.600" is 28600 in `vi`. Submits the plain
     * decimal through the design-system runtime; without a locale the native number input is kept.
     */
    locale?: string
  }
export type MoneyFieldProps = NumberFieldProps & { currency?: string; precision?: number }
export type SearchFieldProps = Omit<TextFieldProps, 'type'> & { clearable?: boolean; clearLabel?: string }
export type CheckboxProps = ScalarFieldBase & {
  checked?: boolean | 'indeterminate'
  value?: string | boolean
  submitValue?: string
}
export type ChoiceGroupProps = ScalarFieldBase & Pick<CommonProps, 'options' | 'optionsOrientation' | 'value'>
export type SelectProps = ScalarFieldBase &
  Pick<CommonProps, 'value' | 'options' | 'placeholder' | 'selectionHidden' | 'appearance'>
export type SwitchProps = ScalarFieldBase & {
  checked?: boolean
  value?: string
  /** Keep the label and control together in compact toolbars, including on mobile. */
  inline?: boolean
}

const normalize = (props: CommonProps): FieldProps => ({
  ...props,
  error: props.error ?? issueFor(props.issues, props.name),
})

export const TextField = (props: TextFieldProps): TemplateResult => (
  <Field {...normalize(props)} type={props.type ?? 'text'} />
)
export const TextArea = (props: TextAreaProps): TemplateResult => (
  <Field {...normalize(props)} type="textarea" />
)
export const NumberField = ({ locale, ...props }: NumberFieldProps): TemplateResult => (
  <Field {...normalize(props)} type="number" inputMode="decimal" numberLocale={locale} />
)
export const MoneyField = ({
  locale,
  currency,
  precision: places,
  ...props
}: MoneyFieldProps): TemplateResult => {
  const precision = Math.max(0, Math.min(6, Math.trunc(Number.isFinite(places) ? (places ?? 2) : 2)))
  return (
    <Field
      {...normalize({ ...props, step: props.step ?? String(10 ** -precision) })}
      type="decimal"
      inputMode="decimal"
      numberLocale={locale}
      align={props.align ?? 'end'}
      suffix={props.suffix ?? currency}
    />
  )
}
export const SearchField = (props: SearchFieldProps): TemplateResult => (
  <Field {...normalize(props)} type="search" inputMode="search" />
)
export const Checkbox = (props: CheckboxProps): TemplateResult => (
  <Field
    {...normalize(props)}
    type="checkbox"
    submitValue={
      props.submitValue ??
      (props.checked !== undefined && typeof props.value === 'string' ? props.value : undefined)
    }
  />
)
export const CheckboxGroup = (props: ChoiceGroupProps): TemplateResult => (
  <Field {...normalize(props)} type="checkbox-group" />
)
export const RadioGroup = (props: ChoiceGroupProps): TemplateResult => (
  <Field {...normalize(props)} type="radio" />
)
export const Select = (props: SelectProps): TemplateResult => <Field {...normalize(props)} type="select" />

export const Switch = (props: SwitchProps): TemplateResult => (
  <Field
    {...normalize(props)}
    type="switch"
    checked={props.checked ?? props.value === '1'}
    value={props.value ?? '1'}
    layout={props.inline ? 'inline' : undefined}
  />
)

export type { CommonProps as ScalarFieldProps, FieldIssue, FieldOption }
