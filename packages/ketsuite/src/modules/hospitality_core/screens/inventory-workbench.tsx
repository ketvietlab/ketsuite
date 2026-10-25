import { randomUUID } from 'node:crypto'
import type { JSXChild } from '@ketvietlab/ketjs-view'
import type { Translator } from '@ketvietlab/ketjs'
import {
  ActionGroup,
  Badge,
  Button,
  Dialog,
  EmptyState,
  Field,
  FormGrid,
  KetTable,
  Link,
  LinkButton,
  Notice,
  RecordForm,
  Section,
  Stack,
  Text,
} from '@ketvietlab/design-system'
import type { FieldProps } from '@ketvietlab/design-system'
import { workspaceScreen } from '../../../ui/layout.tsx'
import type { Frame } from '../../../ui/index.ts'
import { addCalendarDays } from '../calendar.ts'

type Night = {
  date: string
  total: number
  sold: number
  blocked: number
  available: number
  totalManual: boolean
  minLos: number
  maxLos: number
  stopSell: boolean
  closedToArrival: boolean
  closedToDeparture: boolean
}
type RoomType = { id: string; name: string; code: string; physical: number; nights: Night[] }
export type InventoryWorkbench = {
  property: { id: string; name: string; version: number; active: boolean }
  today: string
  from: string
  to: string
  days: string[]
  roomTypes: RoomType[]
  total: number
  page: number
  pages: number
}
export type InventoryError = {
  field?: string
  code: string
  messageKey?: string
  params?: Record<string, string | number>
}

export function inventoryWorkbenchScreen(
  _: Translator,
  frame: Frame,
  data: InventoryWorkbench | null,
  properties: Array<{ id: string; name: string }>,
  canChange: boolean,
  url: URL,
  draft?: Record<string, string>,
  errors: InventoryError[] = [],
  controlsInput: { propertyControl?: JSXChild; roomTypeControl?: JSXChild } = {},
) {
  const t = (key: string, params?: Record<string, string | number>) =>
    _(`hospitality_core.inventoryWorkbench.${key}`, params)
  const lang = frame.locale === 'en' ? 'en' : 'vi'
  const href = (changes: Record<string, string | number | null> = {}) => {
    const next = new URL(url)
    for (const key of ['dialog', 'roomType', 'date', 'status', 'action']) next.searchParams.delete(key)
    if (data) {
      next.searchParams.set('property', data.property.id)
      next.searchParams.set('from', data.from)
      next.searchParams.set('page', String(data.page))
    }
    for (const [key, value] of Object.entries(changes))
      value === null ? next.searchParams.delete(key) : next.searchParams.set(key, String(value))
    return next.pathname + next.search
  }
  const format = (date: string) =>
    new Intl.DateTimeFormat(lang, {
      weekday: 'short',
      day: '2-digit',
      month: '2-digit',
      timeZone: 'UTC',
    }).format(new Date(`${date}T12:00:00Z`))
  const change = canChange && data?.property.active === true
  const scope = Object.fromEntries(
    ['company', 'companies', 'branch', 'branches', 'lang']
      .filter((key) => url.searchParams.has(key))
      .map((key) => [key, url.searchParams.getAll(key)]),
  )
  const propertyOptions = properties.map((p) => ({ value: p.id, label: p.name }))
  if (data && !properties.some((p) => p.id === data.property.id))
    propertyOptions.unshift({ value: data.property.id, label: data.property.name })
  const controls = (
    <Stack
      items={[
        <RecordForm
          id="inventory-navigation"
          action={url.pathname}
          method="get"
          hidden={scope}
          submitLabel={t('show')}
          fields={[
            {
              id: 'inventory-property',
              name: 'property',
              type: 'select',
              label: t('property'),
              value: data?.property.id,
              options: propertyOptions,
              control: controlsInput.propertyControl,
              required: true,
            },
            {
              id: 'inventory-start',
              name: 'from',
              type: 'date',
              label: t('weekFrom'),
              value: data?.from,
              min: data?.today,
              max: data ? addCalendarDays(data.today, 358) : undefined,
              locale: lang,
            },
          ]}
        />,
        data ? (
          <ActionGroup
            label={t('weekNavigation')}
            actions={[
              data.from > data.today ? (
                <LinkButton href={href({ from: addCalendarDays(data.from, -7) })} label={t('previousWeek')} />
              ) : null,
              <LinkButton href={href({ from: data.today })} label={t('today')} />,
              data.to < addCalendarDays(data.today, 364) ? (
                <LinkButton href={href({ from: addCalendarDays(data.from, 7) })} label={t('nextWeek')} />
              ) : null,
            ]}
          />
        ) : null,
      ]}
    />
  )
  const cell = (type: RoomType, index: number) => {
    const night = type.nights[index]!
    return (
      <Stack
        gap="compact"
        items={[
          change ? (
            <Link
              label={t('available', { count: night.available })}
              href={href({ dialog: 'rules', roomType: type.id, date: night.date })}
            />
          ) : (
            <Text variant="bodyMd">{t('available', { count: night.available })}</Text>
          ),
          <Text variant="bodySm" tone="muted">
            {t('capacity', { sold: night.sold, total: night.total, blocked: night.blocked })}
          </Text>,
          night.totalManual ? <Badge label={t('manual')} tone="neutral" /> : null,
          night.stopSell ? <Badge label={t('stopSell')} tone="danger" /> : null,
          night.closedToArrival ? <Badge label={t('closedToArrival')} tone="warning" /> : null,
          night.closedToDeparture ? <Badge label={t('closedToDeparture')} tone="warning" /> : null,
          night.minLos || night.maxLos ? (
            <Text variant="bodySm">{t('nights', { min: night.minLos || 1, max: night.maxLos || 30 })}</Text>
          ) : null,
        ]}
      />
    )
  }
  const errorMessage = (error: InventoryError) =>
    _(error.messageKey ?? `hospitality_core.validation.${error.code}`, error.params)
  const dialog =
    change &&
    data &&
    (draft || url.searchParams.get('dialog') === 'rules' || url.searchParams.get('action') === 'restriction')
      ? (() => {
          const roomTypeId =
            draft?.roomTypeId ?? url.searchParams.get('roomType') ?? data.roomTypes[0]?.id ?? ''
          const date = data.days.includes(url.searchParams.get('date') ?? '')
            ? url.searchParams.get('date')!
            : data.from
          const field = (name: string, options: Partial<FieldProps> = {}) => (
            <Field
              id={`inventory-${name}`}
              name={name}
              label={t(name)}
              value={draft?.[name] ?? ''}
              locale={lang}
              error={
                errors.find((error) => error.field === name)
                  ? errorMessage(errors.find((error) => error.field === name)!)
                  : undefined
              }
              {...options}
            />
          )
          const toggle = (name: string) =>
            field(name, {
              type: 'select',
              options: [
                { value: '', label: t('keep') },
                { value: '1', label: t('on') },
                { value: '0', label: t('off') },
              ],
            })
          return (
            <Dialog
              id="inventory-rules-dialog"
              title={t('change')}
              description={t('sparseHint')}
              closeHref={href()}
              closeLabel={t('cancel')}
              unsavedPrompt={t('discard')}
              size="large"
              body={
                <form id="inventory-rules-form" method="post" action={href({ dialog: 'rules' })}>
                  {Object.entries({
                    operation: 'change-rules',
                    propertyId: data.property.id,
                    expectedVersion: draft?.expectedVersion ?? String(data.property.version),
                    requestKey: draft?.requestKey ?? randomUUID(),
                  }).map(([name, value]) => (
                    <input type="hidden" name={name} value={value} autocomplete="off" />
                  ))}
                  <Stack
                    items={[
                      errors.length ? (
                        <Notice
                          title={t('invalid')}
                          message={errors.map(errorMessage).join(' ')}
                          tone="danger"
                        />
                      ) : null,
                      <FormGrid
                        items={[
                          field('roomTypeId', {
                            type: 'select',
                            value: roomTypeId,
                            control: controlsInput.roomTypeControl,
                            required: true,
                            options: data.roomTypes.map((type) => ({ value: type.id, label: type.name })),
                          }),
                          field('from', {
                            type: 'date',
                            value: draft?.from ?? date,
                            min: data.today,
                            max: addCalendarDays(data.today, 364),
                            required: true,
                          }),
                          field('to', {
                            type: 'date',
                            value: draft?.to ?? (url.searchParams.has('date') ? date : data.to),
                            min: data.today,
                            max: addCalendarDays(data.today, 364),
                            required: true,
                          }),
                        ]}
                      />,
                      field('weekdays', {
                        type: 'checkbox-group',
                        options: Array.from({ length: 7 }, (_, i) => ({
                          name: `weekday${i + 1}`,
                          value: '1',
                          label: t(`weekday.${i + 1}`),
                          checked: draft ? draft[`weekday${i + 1}`] === '1' : true,
                        })),
                      }),
                      <Section
                        title={t('capacityTitle')}
                        description={t('capacityHint')}
                        body={
                          <FormGrid
                            items={[
                              field('total', { type: 'number', min: 0, step: '1' }),
                              field('followRooms', {
                                type: 'checkbox',
                                checked: draft?.followRooms === '1',
                                submitValue: '1',
                              }),
                            ]}
                          />
                        }
                      />,
                      <Section
                        title={t('restrictions')}
                        body={
                          <FormGrid
                            items={[
                              field('minLos', {
                                type: 'number',
                                min: 1,
                                max: 30,
                                step: '1',
                                help: t('minHint'),
                              }),
                              field('maxLos', {
                                type: 'number',
                                min: 1,
                                max: 30,
                                step: '1',
                                help: t('maxHint'),
                              }),
                              toggle('stopSell'),
                              toggle('closedToArrival'),
                              toggle('closedToDeparture'),
                            ]}
                          />
                        }
                      />,
                    ]}
                  />
                </form>
              }
              actions={
                <ActionGroup
                  actions={[
                    <LinkButton label={t('cancel')} href={href()} />,
                    <Button label={t('apply')} type="submit" form="inventory-rules-form" variant="primary" />,
                  ]}
                />
              }
            />
          )
        })()
      : null
  return workspaceScreen({
    translator: _,
    frame,
    title: _('hospitality_core.screen.inventory.title'),
    controls,
    actions:
      change && data.roomTypes.length ? (
        <LinkButton label={t('change')} href={href({ dialog: 'rules' })} variant="primary" />
      ) : null,
    body: (
      <Stack
        items={[
          url.searchParams.get('status') === 'saved' ? (
            <Notice title={t('saved')} message={t('savedHint')} tone="positive" />
          ) : null,
          data?.roomTypes.length ? (
            <Section
              title={`${format(data.from)} – ${format(data.to)}`}
              description={t('matrixHint')}
              body={
                <KetTable
                  rows={data.roomTypes}
                  id={(type) => type.id}
                  rowLink={false}
                  responsive="scroll"
                  columns={[
                    {
                      key: 'roomType',
                      label: t('roomTypeId'),
                      width: 'wide',
                      cell: (type) => (
                        <Stack
                          gap="compact"
                          items={[
                            <Text variant="bodyMd">{type.name}</Text>,
                            <Text variant="bodySm" tone="muted">
                              {type.code}
                            </Text>,
                          ]}
                        />
                      ),
                    },
                    ...data.days.map((date, index) => ({
                      key: date,
                      label: format(date),
                      width: 'medium' as const,
                      cell: (type: RoomType) => cell(type, index),
                    })),
                  ]}
                  labels={{
                    region: t('matrix'),
                    selectAll: _('backend.table.selectAll'),
                    selectRow: _('backend.table.selectRow'),
                    sortedAscending: _('backend.table.sortAscending'),
                    sortedDescending: _('backend.table.sortDescending'),
                    previousPage: _('backend.chrome.previous'),
                    nextPage: _('backend.chrome.next'),
                    loading: _('backend.relation.loading'),
                    loadError: _('backend.error.failed.title'),
                    retry: _('backend.relation.retry'),
                    empty: t('empty'),
                    emptyHint: '',
                  }}
                />
              }
            />
          ) : (
            <EmptyState title={t('empty')} message={t('emptyHint')} />
          ),
          data && data.pages > 1 ? (
            <Stack
              items={[
                <Text variant="bodySm">
                  {t('page', { page: data.page, pages: data.pages, total: data.total })}
                </Text>,
                <ActionGroup
                  actions={[
                    data.page > 1 ? (
                      <LinkButton href={href({ page: data.page - 1 })} label={_('backend.chrome.previous')} />
                    ) : null,
                    data.page < data.pages ? (
                      <LinkButton href={href({ page: data.page + 1 })} label={_('backend.chrome.next')} />
                    ) : null,
                  ]}
                />,
              ]}
            />
          ) : null,
          dialog,
        ]}
      />
    ),
  })
}
