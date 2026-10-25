import { tr } from './i18n.mjs'
import { FlowInput } from '@ketvietlab/flow-ui'
import { FlowSelectField, FlowTagPicker } from '@ketvietlab/flow-ui/workspace'

/** Shared custom field controls for task creation and task detail. */
export function taskFieldControl(field, value, { disabled, error, change }) {
  const id = 'custom-' + field.id
  const kind =
    { checkbox: 'boolean', multiselect: 'multi-select', 'single-select': 'select' }[field.kind] ?? field.kind
  const options = (field.options ?? []).map((option) =>
    typeof option === 'string'
      ? { value: option, label: option }
      : { value: option.id, label: option.title ?? option.label ?? option.id },
  )
  const common = {
    icon: kind === 'date' ? 'calendar' : kind === 'boolean' ? 'check' : 'list',
    label: field.title + (field.required ? ' *' : ''),
    disabled,
    error,
  }
  if (kind === 'multi-select')
    return FlowTagPicker({
      ...common,
      id,
      placeholder: tr('flow.ui.select.value'),
      value: value ?? [],
      options: options.map((x) => ({ id: x.value, title: x.label, color: 'neutral' })),
      onChange: change,
    })
  if (kind === 'select' || kind === 'boolean')
    return FlowSelectField({
      ...common,
      name: id,
      value: value == null ? '' : String(value),
      options: [
        { value: '', label: tr('flow.ui.not.selected') },
        ...(kind === 'boolean'
          ? [
              { value: 'true', label: tr('flow.ui.true') },
              { value: 'false', label: tr('flow.ui.false') },
            ]
          : options),
      ],
      onChange: (event) =>
        change(
          kind === 'boolean'
            ? event.target.value === ''
              ? null
              : event.target.value === 'true'
            : event.target.value,
        ),
    })
  return FlowInput({
    ...common,
    id,
    type: kind ?? 'text',
    value: String(value ?? ''),
    onChange: (event) =>
      change(
        kind === 'number' && event.target.value !== '' ? Number(event.target.value) : event.target.value,
      ),
  })
}
