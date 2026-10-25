import { RoomTypeFormSections } from './form-sections.tsx'
import {
  Badge,
  Button,
  DescriptionList,
  LinkButton,
  Notice,
  Section,
  Stack,
  Text,
} from '@ketvietlab/design-system'
import type { FieldProps } from '@ketvietlab/design-system'
import { recordIsland, createRecordModal } from '../../../ui/client/record-modal.tsx'
import type { RecordModalContext, RecordModalDefinition } from '../../../ui/client/record-modal.tsx'
import { RecordModalForm, recordStateSelectControl } from '../../../ui/client/record-modal-form.tsx'
import { catalogueRecords, HOSPITALITY_RECORD_LABELS } from './config.ts'
import type { CatalogueRecord } from './config.ts'
type Data = {
  record: Record<string, unknown>
  choices: Record<string, Array<Record<string, unknown>>>
  canSave: boolean
  canStart?: boolean
  canComplete?: boolean
  canLifecycle?: boolean
  canConfirm?: boolean
  canRefresh?: boolean
  now?: string
  propertyVersion?: number
  propertyLocked?: boolean
  locale: 'vi' | 'en'
  commandKey: string
}
type Context = RecordModalContext<Data>
const label = (c: Context, key: string) => c.t(`hospitality_core.collection.${key}`)
const selectedProperty = (c: Context) =>
  c.state('propertyId', c.draft('propertyId', String(c.data.record.propertyId ?? '')))
const timezone = (c: Context) =>
  String(
    c.data.choices.properties?.find((row) => row.id === selectedProperty(c))?.timezone ??
      c.data.record.timezone ??
      'Asia/Ho_Chi_Minh',
  )
const civilTime = (value: string, zone: string) => {
  if (!value || !Number.isFinite(Date.parse(value))) return value
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en', {
      timeZone: zone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    })
      .formatToParts(new Date(value))
      .filter((part) => part.type !== 'literal')
      .map((part) => [part.type, part.value]),
  )
  return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}`
}
const fields = (definition: CatalogueRecord, c: Context): FieldProps[] => {
  const result = definition.fields.map((field) => {
    const rawValue = String(
      c.data.record[field.name] ??
        (definition.kind === 'policy' && field.name === 'feeRule' && c.creating ? 'template' : undefined) ??
        (definition.kind === 'notice' && field.name === 'submittedAt' ? c.data.now : undefined) ??
        field.default ??
        '',
    )
    const value = c.draft(
      field.name,
      field.type === 'datetime-local' ? civilTime(rawValue, timezone(c)) : rawValue,
    )
    const choices = field.lookup
      ? (c.data.choices[field.lookup] ?? []).filter(
          (item) => !item.propertyId || !selectedProperty(c) || item.propertyId === selectedProperty(c),
        )
      : []
    const options =
      field.options?.map((option) => ({
        value: option,
        label: c.t(`hospitality_core.record.option.${option}`),
      })) ??
      (field.lookup
        ? [
            { value: '', label: label(c, 'choose') },
            ...choices.map((item) => ({
              value: String(item.id),
              label: String(item.name ?? item.code ?? item.id),
            })),
          ]
        : undefined)
    const disabled =
      c.busy ||
      !c.data.canSave ||
      (definition.kind === 'cleaningTask' &&
        !c.creating &&
        !['todo', 'in_progress'].includes(String(c.data.record.state))) ||
      (!c.creating &&
        field.fixed &&
        !(
          definition.kind === 'cleaningTask' &&
          field.name === 'taskType' &&
          c.data.record.state === 'todo'
        )) ||
      (field.name === 'propertyId' && c.data.propertyLocked === true) ||
      (definition.kind === 'roomType' &&
        field.name === 'bedQuantity' &&
        c.state('bedType', c.draft('bedType', String(c.data.record.bedType ?? 'queen'))) === 'keep')
    const fieldProps: FieldProps = {
      id: `${c.kind}-${field.name}`,
      name: field.name,
      label: label(c, field.label),
      locale: c.data.locale,
      type: field.type ?? 'text',
      required: field.required,
      step: field.type === 'number' ? 'any' : undefined,
      submitValue: field.type === 'checkbox' ? '1' : undefined,
      value,
      checked:
        field.type === 'checkbox'
          ? c.draftChecked(
              field.name,
              undefined,
              c.data.record[field.name] === true || field.default === true,
            )
          : undefined,
      options,
      error: c.fieldError(field.name),
      help: definition.kind === 'policy' && field.name === 'feeRule' ? label(c, 'feeRuleHint') : undefined,
      disabled,
      span: field.type === 'textarea' ? 'full' : undefined,
    }
    if (definition.kind === 'roomType' && field.name === 'bedType') {
      fieldProps.control = recordStateSelectControl({
        id: fieldProps.id!,
        name: field.name,
        state: 'bedType',
        value: c.state('bedType', value),
        options: options ?? [],
        required: true,
        disabled: Boolean(disabled),
        invalid: Boolean(fieldProps.error),
        describedBy: fieldProps.error ? `${fieldProps.id}-error` : undefined,
      })
    }
    if (field.lookup) {
      const functions = {
        policies: 'lookupPolicies',
        amenities: 'lookupRoomAmenities',
        properties: 'lookupProperties',
        roomTypes: 'lookupRoomTypes',
        buildings: 'lookupBuildings',
        floors: 'lookupFloors',
        categories: 'lookupAmenityCategories',
        rooms: 'lookupRooms',
        staff: 'lookupCleaningStaff',
        serviceTargets: 'lookupServiceTargets',
        serviceProducts: 'lookupServiceProducts',
      }
      const names = [
        'choose',
        'search',
        'more',
        'noRecords',
        'loading',
        'loadError',
        'dialogTitle',
        'close',
        'select',
        'create',
        'edit',
        'save',
        'cancel',
        'remove',
        'confirmRemove',
        'retry',
        'clear',
        'chosen',
      ]
      const relationLabels = Object.fromEntries(names.map((name) => [name, label(c, `lookup.${name}`)]))
      fieldProps.control = recordIsland('backend.relation-select', {
        id: fieldProps.id,
        config: {
          name: field.name,
          triggerId: fieldProps.id,
          invalid: Boolean(fieldProps.error),
          describedBy: [
            fieldProps.help ? `${fieldProps.id}-help` : null,
            fieldProps.error ? `${fieldProps.id}-error` : null,
          ]
            .filter(Boolean)
            .join(' '),
          ariaLabel: fieldProps.label,
          value: field.name === 'propertyId' ? selectedProperty(c) : value || null,
          multiple: field.multiple,
          values: field.multiple ? value.split(',').filter(Boolean) : undefined,
          options: (options ?? []).filter((option) => option.value),
          required: field.required,
          disabled:
            disabled ||
            (field.lookup === 'floors' &&
              !c.state('buildingId', c.draft('buildingId', String(c.data.record.buildingId ?? '')))) ||
            (field.lookup !== 'properties' &&
              field.lookup !== 'categories' &&
              field.lookup !== 'amenities' &&
              field.lookup !== 'policies' &&
              !selectedProperty(c)),
          labels: relationLabels,
          manager: {
            listFunction: `hospitality_core.${functions[field.lookup]}`,
            requestQuery:
              typeof location === 'undefined'
                ? ''
                : new URLSearchParams(
                    [...new URL(location.href).searchParams].filter(([key]) =>
                      ['company', 'companies', 'branch', 'branches', 'lang'].includes(key),
                    ),
                  ).toString(),
            searchInDropdown: true,
            resolveParam: 'id',
            limit: 80,
            listInput: {
              propertyId: field.lookup === 'properties' ? null : selectedProperty(c) || null,
              ...(field.name === 'floorId'
                ? {
                    buildingId:
                      c.state('buildingId', c.draft('buildingId', String(c.data.record.buildingId ?? ''))) ||
                      null,
                  }
                : {}),
            },
            idField: 'id',
            labelField: 'name',
          },
        },
      })
    }
    return fieldProps
  })
  if (definition.kind === 'service') {
    const product = c.data.choices.serviceProducts?.find(
      (row) => row.id === c.state('productId', c.draft('productId', String(c.data.record.productId ?? ''))),
    )
    result.push({
      id: `${c.kind}-unit`,
      name: '__unit',
      label: label(c, 'unit'),
      value: String(product?.unitName ?? c.data.record.unitName ?? ''),
      readOnly: true,
      control: recordIsland('hospitality.service-unit', {
        productId: c.state('productId', c.draft('productId', String(c.data.record.productId ?? ''))),
        propertyId: selectedProperty(c),
        value: String(product?.unitName ?? c.data.record.unitName ?? ''),
        loading: label(c, 'loading'),
        priceInputId: `${c.kind}-unitPrice`,
        query:
          typeof location === 'undefined'
            ? ''
            : new URLSearchParams(
                [...new URL(location.href).searchParams].filter(([key]) =>
                  ['company', 'companies', 'branch', 'branches', 'lang'].includes(key),
                ),
              ).toString(),
      }),
    })
  }
  return result
}
const values = (definition: CatalogueRecord, form: FormData, c: Context) => {
  const input: Record<string, unknown> = {
    id: c.creating ? c.data.record.id : c.id,
    expectedVersion: c.data.record.version ?? 0,
    requestKey: c.data.commandKey,
  }
  if (definition.parentVersion && selectedProperty(c) === String(c.data.record.propertyId ?? ''))
    input.expectedPropertyVersion = c.data.propertyVersion ?? 0
  for (const field of definition.fields) {
    if (
      (field.fixed &&
        !c.creating &&
        !(
          definition.kind === 'cleaningTask' &&
          field.name === 'taskType' &&
          c.data.record.state === 'todo'
        )) ||
      (field.name === 'propertyId' && c.data.propertyLocked)
    ) {
      input[field.name] = c.data.record[field.name]
      continue
    }
    const raw = String(form.get(field.name) ?? '').trim()
    if (field.type === 'datetime-local' && ['cleaningTask', 'notice'].includes(definition.kind)) {
      input[definition.kind === 'notice' ? 'submittedLocal' : 'dueLocal'] = raw
      continue
    }
    input[field.name] = field.multiple
      ? raw
          .split(',')
          .map((value) => value.trim())
          .filter(Boolean)
      : field.type === 'datetime-local'
        ? raw
          ? new Date(raw).toISOString()
          : null
        : field.type === 'checkbox'
          ? ['on', 'true', '1'].includes(String(form.getAll(field.name).at(-1) ?? ''))
          : field.type === 'number' &&
              !['amount', 'baseRate', 'sizeSqm', 'penaltyPercent', 'unitPrice', 'quantity'].includes(
                field.name,
              )
            ? raw
              ? Number(raw)
              : null
            : raw || null
  }
  if (definition.kind === 'service') {
    const target = String(input.target ?? '')
    const separator = target.indexOf(':')
    if (separator > 0 && ['reservation', 'stay'].includes(target.slice(0, separator)))
      input[`${target.slice(0, separator)}Id`] = target.slice(separator + 1)
    delete input.target
    input.active = c.creating ? true : c.data.record.active !== false
  }
  return input
}
const taskCommandDraftPrompt = (c: Context): string | null => {
  const changed = ['assigneeId', 'priority', 'notes', 'dueAt'].some((name) => {
    const value =
      name === 'dueAt'
        ? civilTime(String(c.data.record[name] ?? ''), timezone(c))
        : String(c.data.record[name] ?? '')
    return c.draft(name, value) !== value
  })
  return changed ? c.t('hospitality_core.cleaning.discardAssignmentDraft') : null
}
const noticeInstant = (c: Context, value: unknown) => {
  const instant = new Date(String(value ?? ''))
  return Number.isFinite(instant.getTime())
    ? new Intl.DateTimeFormat(c.data.locale === 'en' ? 'en-GB' : 'vi', {
        timeZone: timezone(c),
        dateStyle: 'short',
        timeStyle: 'short',
        hourCycle: 'h23',
      }).format(instant)
    : '—'
}
const noticeBody = (c: Context, recordFields: FieldProps[]) => {
  const r = c.data.record
  const facts = [
    ['guest', r.guestName],
    ['stay', r.stayCode],
    ['deadline', noticeInstant(c, r.dueAt)],
    [
      'noticeDocument',
      [
        r.documentType ? c.t(`hospitality_core.document.${r.documentType}`) : null,
        r.documentLast4 ? `••••${r.documentLast4}` : null,
      ]
        .filter(Boolean)
        .join(' · '),
    ],
    ['noticeEvidence', r.receiptRef],
    ['noticeSentAt', r.submittedAt ? noticeInstant(c, r.submittedAt) : null],
    ['noticeConfirmedAt', r.confirmedAt ? noticeInstant(c, r.confirmedAt) : null],
  ]
  const history = Array.isArray(r.history) ? (r.history as Array<Record<string, unknown>>) : []
  const scoped = (path: string) => {
    const url = new URL(path, typeof location === 'undefined' ? 'http://localhost' : location.origin)
    if (typeof location !== 'undefined')
      for (const [key, value] of new URL(location.href).searchParams)
        if (['company', 'companies', 'branch', 'branches', 'lang'].includes(key))
          url.searchParams.append(key, value)
    return url.pathname + url.search
  }
  return Stack({
    items: [
      Section({
        title: label(c, 'noticePrepared'),
        body: (
          <DescriptionList
            items={facts.map(([key, value]) => ({
              id: String(key),
              label: label(c, String(key)),
              value: String(value ?? '—') || '—',
            }))}
          />
        ),
      }),
      r.state === 'attention' ? (
        <Notice
          tone="warning"
          title={label(c, 'noticeMissing')}
          message={(Array.isArray(r.issueCodes) ? r.issueCodes : [])
            .map((code) => c.t(`hospitality_core.validation.${code}`))
            .join(' · ')}
        />
      ) : null,
      r.state === 'attention' ? (
        <LinkButton
          href={scoped(`/admin/hospitality/stays/${encodeURIComponent(String(r.stayId))}?action=guest`)}
          label={label(c, 'noticeFixGuest')}
        />
      ) : null,
      r.state === 'ready' && c.data.canSave ? (
        <RecordModalForm kind={c.kind} id={`${c.kind}-form`} fields={recordFields} />
      ) : (
        <RecordModalForm
          kind={c.kind}
          id={`${c.kind}-form`}
          fields={
            r.state === 'submitted' && c.data.canConfirm
              ? [
                  {
                    id: `${c.kind}-receipt`,
                    name: 'receiptRef',
                    label: label(c, 'noticeEvidence'),
                    value: c.draft('receiptRef', String(r.receiptRef ?? '')),
                    required: true,
                    error: c.fieldError('receiptRef'),
                  },
                ]
              : []
          }
        />
      ),
      <Notice
        tone={r.state === 'confirmed' ? 'positive' : 'warning'}
        title={label(c, r.state === 'confirmed' ? 'noticeDone' : 'noticeManual')}
        message={label(c, r.state === 'confirmed' ? 'noticeDoneHint' : 'noticeManualHint')}
      />,
      r.submissionNote ? <Text variant="bodySm">{String(r.submissionNote)}</Text> : null,
      history.length
        ? Section({
            title: label(c, 'noticeHistory'),
            body: (
              <DescriptionList
                columns={1}
                items={history.map((row, index) => ({
                  id: String(index),
                  label: noticeInstant(c, row.occurredAt),
                  value: [
                    c.t(`hospitality_core.collection.noticeAction.${row.action}`),
                    row.actorName ?? label(c, row.actorId ? 'history.staff' : 'history.system'),
                  ]
                    .filter(Boolean)
                    .join(' · '),
                }))}
              />
            ),
          })
        : null,
    ],
  })
}
export const catalogueDefinition = (definition: CatalogueRecord): RecordModalDefinition<Data> => ({
  kind: `hospitality.${definition.kind}`,
  resetRelationsOnChange: {
    propertyId: [
      'roomTypeId',
      'buildingId',
      'floorId',
      'roomId',
      'assigneeId',
      'target',
      'productId',
      'unitPrice',
    ],
    buildingId: ['floorId'],
    productId: ['unitPrice'],
  },
  context: {
    route: (id, creating) => {
      const record = creating ? 'new' : encodeURIComponent(id)
      return `/admin/hospitality/${definition.path}/${record}/record-context`
    },
    query: [
      'company',
      'companies',
      'branch',
      'branches',
      'lang',
      'property',
      'building',
      'locale',
      'roomType',
      'target',
      ...(definition.kind === 'cleaningTask' ? ['room'] : []),
    ],
  },
  cache: false,
  labels: () =>
    HOSPITALITY_RECORD_LABELS[
      typeof document !== 'undefined' && document.documentElement.lang === 'en' ? 'en' : 'vi'
    ],
  title: (c) =>
    c.creating
      ? c.t(`hospitality_core.${definition.title}.create`)
      : String(
          c.data.record.name ??
            (definition.kind === 'locale' ? c.data.record.title : undefined) ??
            c.data.record.description ??
            c.data.record.title ??
            c.data.record.code ??
            c.t(`hospitality_core.${definition.title}`),
        ),
  status: (c) =>
    c.creating ? undefined : definition.kind === 'notice' ? (
      <Badge
        tone={
          c.data.record.state === 'confirmed'
            ? 'positive'
            : c.data.record.state === 'attention'
              ? 'warning'
              : 'info'
        }
        label={c.t(`hospitality_core.stayNotice.state.${c.data.record.state}`)}
      />
    ) : (
      <Badge
        tone={
          definition.kind === 'cleaningTask'
            ? c.data.record.state === 'done'
              ? 'positive'
              : c.data.record.state === 'in_progress'
                ? 'info'
                : 'neutral'
            : c.data.record.active === false
              ? 'neutral'
              : 'positive'
        }
        label={
          definition.kind === 'cleaningTask'
            ? c.t(`hospitality_core.cleaningState.${c.data.record.state}`)
            : c.data.record.status
              ? c.t(`hospitality_core.roomStatus.${c.data.record.status}`)
              : label(c, `state.${c.data.record.active === false ? 'inactive' : 'active'}`)
        }
      />
    ),
  body: (c) =>
    definition.kind === 'notice' ? (
      noticeBody(c, fields(definition, c))
    ) : (
      <RecordModalForm
        kind={c.kind}
        id={`${c.kind}-form`}
        fields={definition.kind === 'roomType' ? [] : fields(definition, c)}
        body={
          definition.kind === 'roomType' ? (
            <RoomTypeFormSections fields={fields(definition, c)} id={c.kind} t={c.t} />
          ) : definition.kind === 'service' ? (
            <Text variant="bodySm">
              {c.t(
                c.data.canSave
                  ? 'hospitality_core.services.stockNotice'
                  : 'hospitality_core.services.lockedNotice',
              )}
            </Text>
          ) : !c.data.canSave ? (
            <Text variant="bodySm">{label(c, 'readOnly')}</Text>
          ) : undefined
        }
      />
    ),
  actions: (c) => (
    <>
      {definition.lifecycle && !c.creating && c.data.canLifecycle ? (
        <Button
          type="submit"
          form={`${c.kind}-form`}
          name="__command"
          value="lifecycle"
          label={c.t(
            c.data.record.active === false
              ? 'hospitality_core.propertyWorkbench.restore'
              : 'hospitality_core.propertyWorkbench.archive',
          )}
          disabled={c.busy}
        />
      ) : null}
      {c.data.canSave &&
      (definition.kind !== 'cleaningTask' ||
        c.creating ||
        ['todo', 'in_progress'].includes(String(c.data.record.state))) ? (
        <Button
          type="submit"
          form={`${c.kind}-form`}
          name="__command"
          value={c.creating ? 'create' : 'save'}
          label={label(c, definition.kind === 'notice' ? 'noticeSubmit' : c.creating ? 'create' : 'save')}
          variant="primary"
          disabled={c.busy}
        />
      ) : null}
      {definition.kind === 'notice' && c.data.canConfirm ? (
        <Button
          type="submit"
          form={`${c.kind}-form`}
          name="__command"
          value="confirm"
          label={label(c, 'noticeConfirm')}
          variant="primary"
          disabled={c.busy}
        />
      ) : null}
      {definition.kind === 'notice' && c.data.canRefresh ? (
        <Button
          type="submit"
          form={`${c.kind}-form`}
          name="__command"
          value="refresh"
          label={label(c, 'noticeRefresh')}
          disabled={c.busy}
        />
      ) : null}
      {definition.kind === 'cleaningTask' &&
      !c.creating &&
      c.data.record.state === 'todo' &&
      c.data.canStart ? (
        <Button
          type="submit"
          form={`${c.kind}-form`}
          name="__command"
          value="start"
          label={c.t('hospitality_core.housekeeping.action.start')}
          disabled={c.busy}
        />
      ) : null}
      {definition.kind === 'cleaningTask' &&
      !c.creating &&
      c.data.record.state === 'in_progress' &&
      c.data.canComplete ? (
        <LinkButton
          label={c.t('hospitality_core.taskPage.openChecklist')}
          href={`/admin/hospitality/housekeeping/tasks/${encodeURIComponent(c.id)}?${typeof location === 'undefined' ? '' : new URLSearchParams([...new URL(location.href).searchParams].filter(([key]) => ['company', 'companies', 'branch', 'branches', 'lang'].includes(key))).toString()}`}
        />
      ) : null}
    </>
  ),
  commands: {
    ...(definition.kind === 'notice'
      ? {
          confirm: {
            fn: 'hospitality_core.confirmStayNotice',
            input: (form: FormData, c: Context) => ({
              id: c.id,
              receiptRef: String(form.get('receiptRef') ?? ''),
              expectedVersion: c.data.record.version ?? 0,
              requestKey: c.data.commandKey,
            }),
            after: 'refresh' as const,
          },
          refresh: {
            fn: 'hospitality_core.requestStayNoticeRefresh',
            input: (_form: FormData, c: Context) => ({ stayId: c.data.record.stayId }),
            after: 'refresh' as const,
          },
        }
      : {}),
    ...(definition.lifecycle
      ? {
          lifecycle: {
            fn: `hospitality_core.${definition.lifecycle}`,
            input: (_form: FormData, c: Context) => ({
              id: c.id,
              propertyId: c.data.record.propertyId,
              active: c.data.record.active === false,
              expectedVersion: c.data.record.version ?? 0,
              expectedPropertyVersion: c.data.propertyVersion ?? 0,
              requestKey: c.data.commandKey,
            }),
            after: 'refresh' as const,
            confirm: (c: Context) =>
              c.t(
                c.data.record.active === false
                  ? 'hospitality_core.propertyWorkbench.restoreHint'
                  : 'hospitality_core.propertyWorkbench.archiveHint',
              ),
          },
        }
      : {}),
    ...(definition.kind === 'cleaningTask'
      ? {
          start: {
            fn: 'hospitality_core.startCleaningTask',
            input: (_form: FormData, c: Context) => ({
              id: c.id,
              expectedVersion: c.data.record.version ?? 0,
              requestKey: c.data.commandKey,
            }),
            after: 'refresh' as const,
            confirm: taskCommandDraftPrompt,
          },
        }
      : {}),
    create: {
      fn: `hospitality_core.${definition.save}`,
      input: (form, c) => values(definition, form, c),
      after: 'open',
      created: (value) => String((value as { id: string }).id),
    },
    save: {
      fn: `hospitality_core.${definition.save}`,
      input: (form, c) => values(definition, form, c),
      after: definition.kind === 'notice' ? 'refresh' : 'close',
    },
  },
})
export const roomModal = createRecordModal(
  catalogueDefinition(catalogueRecords.find((item) => item.kind === 'room')!),
)
export const roomTypeModal = createRecordModal(
  catalogueDefinition(catalogueRecords.find((item) => item.kind === 'roomType')!),
)
export const amenityModal = createRecordModal(
  catalogueDefinition(catalogueRecords.find((item) => item.kind === 'amenity')!),
)
export const policyModal = createRecordModal(
  catalogueDefinition(catalogueRecords.find((item) => item.kind === 'policy')!),
)
export const rateModal = createRecordModal(
  catalogueDefinition(catalogueRecords.find((item) => item.kind === 'rate')!),
)

export const cleaningTaskModal = createRecordModal(
  catalogueDefinition(catalogueRecords.find((item) => item.kind === 'cleaningTask')!),
)

export const buildingModal = createRecordModal(
  catalogueDefinition(catalogueRecords.find((item) => item.kind === 'building')!),
)

export const floorModal = createRecordModal(
  catalogueDefinition(catalogueRecords.find((item) => item.kind === 'floor')!),
)

export const feeModal = createRecordModal(
  catalogueDefinition(catalogueRecords.find((item) => item.kind === 'fee')!),
)

export const localeModal = createRecordModal(
  catalogueDefinition(catalogueRecords.find((item) => item.kind === 'locale')!),
)

export const serviceModal = createRecordModal(
  catalogueDefinition(catalogueRecords.find((item) => item.kind === 'service')!),
)

export const noticeModal = createRecordModal(
  catalogueDefinition(catalogueRecords.find((item) => item.kind === 'notice')!),
)
