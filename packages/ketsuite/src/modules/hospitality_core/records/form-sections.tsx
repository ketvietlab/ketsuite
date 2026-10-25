import { Field, FormGrid, Section, Stack } from '@ketvietlab/design-system'
import type { FieldProps } from '@ketvietlab/design-system'
import { RecordModalForm } from '../../../ui/client/record-modal-form.tsx'

type FormProps = Parameters<typeof RecordModalForm>[0]
type Translate = (key: string) => string

/** Keep each adult's identity in a named region without introducing another form owner. */
export const HospitalityGuestForm = ({
  t,
  guestOffset = 0,
  ...props
}: FormProps & { t: Translate; guestOffset?: number }) => {
  const groups = new Map<string, FieldProps[]>()
  const common: FieldProps[] = []
  for (const field of props.fields) {
    const match = /^guest-(\d+)-(.+)$/u.exec(field.name ?? '')
    if (!match) {
      common.push(field)
      continue
    }
    const fields = groups.get(match[1]!) ?? []
    fields.push({
      ...field,
      label: t(`hospitality_core.stay.document.${match[2] === 'birth' ? 'dateOfBirth' : match[2]}`),
    })
    groups.set(match[1]!, fields)
  }
  if (!groups.size) return <RecordModalForm {...props} />
  return (
    <RecordModalForm
      {...props}
      fields={[]}
      body={
        <Stack
          items={[
            common.length ? <FormGrid columns={3} items={common.map(Field)} /> : null,
            ...[...groups].map(([index, fields]) => (
              <Section
                id={`${props.id ?? props.kind}-guest-${index}`}
                title={t('hospitality_core.form.guest').replace(
                  '{number}',
                  String(guestOffset + Number(index) + 1),
                )}
                body={<FormGrid columns={3} items={fields.map(Field)} />}
              />
            )),
            props.body,
          ]}
        />
      }
    />
  )
}

export const RoomTypeFormSections = (props: { fields: readonly FieldProps[]; id: string; t: Translate }) => {
  const groups = [
    ['identity', ['propertyId', 'code', 'name', 'publicName']],
    ['capacity', ['defaultCapacity', 'maxAdults', 'maxChildren', 'maxInfants', 'maxExtraBeds', 'sizeSqm']],
    ['bedding', ['bedType', 'bedQuantity', 'amenityIds']],
    ['selling', ['baseRate', 'cancellationPolicyId', 'description']],
  ] as const
  return (
    <Stack
      items={groups.map(([key, names]) => (
        <Section
          id={`${props.id}-${key}`}
          title={props.t(`hospitality_core.form.${key}`)}
          body={
            <FormGrid
              columns={3}
              items={props.fields
                .filter((field) => (names as readonly string[]).includes(field.name ?? ''))
                .map(Field)}
            />
          }
        />
      ))}
    />
  )
}
