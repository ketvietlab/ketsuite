import { propertyStructure } from './property-structure.tsx'
import { propertyGallery } from './property-gallery.tsx'
import { recordModalHref } from '../../../ui/record-modal.tsx'
import { hospitalityScopedHref } from './scoped-href.ts'
import { randomUUID } from 'node:crypto'
import type { Translator } from '@ketvietlab/ketjs'
import type { JSXChild } from '@ketvietlab/ketjs-view'
import {
  ActionGroup,
  Badge,
  ConfirmDialog,
  Dialog,
  LinkButton,
  Notice,
  RecordForm,
  Section,
  Stack,
  TabbedView,
  Text,
} from '@ketvietlab/design-system'
import { RecordScreen } from '../../../ui/index.ts'
import type { Frame } from '../../../ui/index.ts'
import { propertyFeedback, propertyForm } from './shared.tsx'
import type { BranchChoice, PolicyRow, PropertyDetail, PropertyFormValues } from './shared.tsx'

type Item = Record<string, unknown>
export type PropertyWorkbench = {
  images?: Item[]
  photoTarget?: string | null
  buildings: Item[]
  floors: Item[]
  charges: Item[]
  locales: Item[]
  roomTypes: Item[]
  imageCount: number
  primaryImage: boolean
  history?: Item[]
  timezoneLocked?: boolean
  missingContent: Array<{ code: string; name?: string }>
}
export type Readiness = {
  types: number
  rooms: number
  rates: number
  staying: number
  upcoming: number
  channels?: number
}

export function propertyWorkbenchScreen(
  _: Translator,
  property: PropertyDetail,
  policies: PolicyRow[],
  branches: BranchChoice[],
  data: PropertyWorkbench,
  readiness: Readiness,
  url: URL,
  frame: Frame,
  capabilities: Record<string, boolean>,
  errors: readonly string[] = [],
  attempted?: PropertyFormValues,
  draft?: Record<string, string>,
) {
  const t = (key: string, params?: Record<string, string | number>) =>
      _(`hospitality_core.propertyWorkbench.${key}`, params),
    section = ['information', 'structure', 'fees', 'content'].includes(url.searchParams.get('section') ?? '')
      ? url.searchParams.get('section')!
      : 'information'
  const base = new URL(url)
  for (const key of ['dialog', 'item', 'locale', 'status', 'record']) base.searchParams.delete(key)
  const href = (changes: Record<string, string> = {}) => {
    const next = new URL(base)
    for (const [key, value] of Object.entries(changes)) next.searchParams.set(key, value)
    return next.pathname + next.search
  }
  const record = (kind: string, id = 'new', extra: Record<string, string> = {}) => {
    const next = new URL(href({ property: property.id, ...extra }), url)
    return recordModalHref(next.pathname + next.search, { kind: `hospitality.${kind}`, id })
  }
  const destination = (path: string) => hospitalityScopedHref(url, path)
  const action = href(),
    version = String(property.version ?? 0),
    lifecycle = property.lifecycle ?? (property.active ? 'active' : 'stopped'),
    dialog = url.searchParams.get('dialog'),
    itemId = url.searchParams.get('item')
  const hidden = (operation: string, row?: Item) => ({
    operation,
    propertyId: property.id,
    expectedPropertyVersion: version,
    expectedVersion: String(row?.version ?? 0),
    requestKey: randomUUID(),
  })
  const field = (name: string, row?: Item, fallback = '') => draft?.[name] ?? String(row?.[name] ?? fallback)
  const notices = (
    <Stack
      items={[
        propertyFeedback(_, url.searchParams.get('status'), errors),
        <Badge
          label={t(`lifecycle.${lifecycle}`)}
          tone={lifecycle === 'active' ? 'positive' : lifecycle === 'setup' ? 'info' : 'neutral'}
        />,
      ]}
    />
  )
  let body: JSXChild
  const dialogs = []
  if (section === 'information') {
    const blocked = readiness.staying + readiness.upcoming + (readiness.channels ?? 0)
    const next = lifecycle === 'stopped' ? 'setup' : lifecycle === 'setup' ? 'active' : 'stopped'
    body = (
      <Stack
        items={[
          capabilities.saveProperty ? (
            <Section
              title={t('information')}
              body={propertyForm(
                _,
                {
                  ...(attempted ?? property),
                  code: property.code,
                  editing: true,
                  timezoneLocked: data.timezoneLocked,
                  timezone: data.timezoneLocked
                    ? property.timezone
                    : (attempted?.timezone ?? property.timezone),
                },
                policies,
                branches,
                frame.locale ?? 'vi',
                action,
                t('save'),
                href(),
              )}
            />
          ) : (
            <Notice title={t('readOnly')} message={t('readOnlyHint')} />
          ),
          <Section
            title={t('operation')}
            body={
              <Stack
                items={[
                  <Text variant="bodySm">
                    {t('readiness', {
                      types: readiness.types,
                      rooms: readiness.rooms,
                      rates: readiness.rates,
                    })}
                  </Text>,
                  capabilities.setInspectionRequirement ? (
                    <RecordForm
                      action={action}
                      method="post"
                      fields={[]}
                      submitLabel={t(property.inspectionRequired ? 'disableInspection' : 'enableInspection')}
                      hidden={{
                        ...hidden('inspection'),
                        expectedVersion: version,
                        required: property.inspectionRequired ? '0' : '1',
                      }}
                    />
                  ) : null,
                  capabilities.setPropertyLifecycle ? (
                    <LinkButton href={href({ dialog: 'lifecycle' })} label={t(`command.${next}`)} />
                  ) : null,
                ]}
              />
            }
          />,
        ]}
      />
    )
    if (dialog === 'lifecycle' && capabilities.setPropertyLifecycle)
      dialogs.push(
        <>
          <form id="property-lifecycle-form" action={action} method="post">
            <input type="hidden" name="operation" value="lifecycle" autocomplete="off" />
            <input type="hidden" name="lifecycle" value={next} autocomplete="off" />
            <input type="hidden" name="expectedVersion" value={version} autocomplete="off" />
            <input type="hidden" name="requestKey" value={randomUUID()} autocomplete="off" />
          </form>
          <ConfirmDialog
            id="property-lifecycle-confirm"
            title={t(`command.${next}`)}
            message={t(
              next === 'stopped' && blocked
                ? 'stopBlocked'
                : next === 'stopped'
                  ? 'stopHint'
                  : next === 'setup'
                    ? 'reactivateHint'
                    : 'openHint',
            )}
            closeHref={action}
            closeLabel={t('cancel')}
            confirmLabel={t(`command.${next}`)}
            confirmForm="property-lifecycle-form"
            confirmDisabled={next === 'stopped' && blocked > 0}
            details={
              <Stack
                items={[
                  // Channels are counted by the OTA extension, where a deployment installs it.
                  <Text variant="bodySm">{`${t('staying')}: ${readiness.staying} · ${t('upcoming')}: ${readiness.upcoming}${readiness.channels === undefined ? '' : ` · ${t('channels')}: ${readiness.channels}`}`}</Text>,
                  <LinkButton
                    href={destination(`/admin/hospitality/stays?property=${encodeURIComponent(property.id)}`)}
                    label={t('staying')}
                  />,
                  <LinkButton
                    href={destination(
                      `/admin/hospitality/reservations?property=${encodeURIComponent(property.id)}`,
                    )}
                    label={t('upcoming')}
                  />,
                  ...(readiness.channels === undefined
                    ? []
                    : [
                        <LinkButton
                          href={destination(
                            `/admin/hospitality/ota/connections?property=${encodeURIComponent(property.id)}`,
                          )}
                          label={t('channels')}
                        />,
                      ]),
                ]}
              />
            }
          />
        </>,
      )
  } else if (section === 'structure') {
    body = propertyStructure(_, property, data, capabilities, url, action, href, record, destination)
  } else if (section === 'fees') {
    body = (
      <Stack
        items={[
          <Text variant="bodySm">{t('feesHint')}</Text>,
          capabilities.savePropertyCharge ? (
            <ActionGroup actions={[<LinkButton href={record('fee')} label={t('newFee')} />]} />
          ) : null,
          ...data.charges.map((row) => (
            <Section
              title={String(row.name)}
              actions={
                capabilities.savePropertyCharge ? (
                  <LinkButton href={record('fee', String(row.id))} label={t('edit')} />
                ) : undefined
              }
              body={
                <Text variant="bodySm">{`${t(`fee.${row.chargeType}`)} · ${row.amount} · ${t(`basis.${row.basis ?? 'per_stay'}`)} · ${t(row.included ? 'included' : 'extra')}`}</Text>
              }
            />
          )),
        ]}
      />
    )
    if (dialog === 'fee' && capabilities.savePropertyCharge) {
      const row = data.charges.find((item) => item.id === itemId)
      dialogs.push(
        <Dialog
          id="property-fee-dialog"
          title={t(row ? 'editFee' : 'newFee')}
          closeHref={action}
          closeLabel={t('cancel')}
          body={
            <RecordForm
              action={action}
              method="post"
              errors={errors}
              submitLabel={t('save')}
              hidden={{ ...hidden('save-fee', row), id: row ? String(row.id) : randomUUID() }}
              fields={[
                {
                  id: 'property-workbench-name',
                  name: 'name',
                  label: t('name'),
                  value: field('name', row),
                  required: true,
                },
                {
                  id: 'property-workbench-chargeType',
                  name: 'chargeType',
                  type: 'select',
                  label: t('feeType'),
                  value: field('chargeType', row, 'other'),
                  options: ['parking', 'city_tax', 'internet', 'resort_fee', 'other'].map((value) => ({
                    value,
                    label: t(`fee.${value}`),
                  })),
                },
                {
                  id: 'property-workbench-amount',
                  name: 'amount',
                  type: 'number',
                  label: t('amount'),
                  value: field('amount', row, '0'),
                  min: '0',
                  step: '0.01',
                  required: true,
                },
                {
                  id: 'property-workbench-basis',
                  name: 'basis',
                  type: 'select',
                  label: t('basis'),
                  value: field('basis', row, 'per_stay'),
                  options: ['per_night', 'per_stay', 'per_person', 'per_room'].map((value) => ({
                    value,
                    label: t(`basis.${value}`),
                  })),
                },
                {
                  id: 'property-workbench-included',
                  name: 'included',
                  type: 'checkbox',
                  label: t('included'),
                  value: !!row?.included,
                },
                {
                  id: 'property-workbench-description',
                  name: 'description',
                  type: 'textarea',
                  label: t('description'),
                  value: field('description', row),
                },
                {
                  id: 'property-workbench-active',
                  name: 'active',
                  type: 'checkbox',
                  label: t('active'),
                  value: row ? !!row.active : true,
                },
              ]}
            />
          }
        />,
      )
    }
  } else {
    const roomTypeId = data.photoTarget ?? null
    const locales = data.locales.filter((row) => (row.roomTypeId ?? null) === roomTypeId)
    const localeExtra: Record<string, string> = roomTypeId ? { roomType: roomTypeId } : {}
    body = (
      <Stack
        items={[
          data.missingContent.length ? (
            <Notice
              tone="warning"
              title={t('contentMissing')}
              message={data.missingContent
                .map((item) => `${t(`missing.${item.code}`)}${item.name ? `: ${item.name}` : ''}`)
                .join(' · ')}
            />
          ) : (
            <Notice tone="positive" title={t('contentReady')} message={t('contentReadyHint')} />
          ),
          capabilities.saveContentLocale ? (
            <ActionGroup
              actions={[<LinkButton href={record('locale', 'new', localeExtra)} label={t('newLocale')} />]}
            />
          ) : null,
          ...locales.map((row) => (
            <Section
              title={String(row.locale)}
              body={
                <Stack
                  items={[
                    <Text variant="bodyMd">{String(row.title)}</Text>,
                    <Text variant="bodySm">{String(row.description)}</Text>,
                    <ActionGroup
                      actions={[
                        capabilities.saveContentLocale ? (
                          <LinkButton
                            href={record('locale', String(row.id), localeExtra)}
                            label={t('edit')}
                          />
                        ) : null,
                        capabilities.removeContentLocale && row.locale !== 'vi' ? (
                          <LinkButton
                            href={href({ dialog: 'locale-remove', item: String(row.id) })}
                            label={t('removeLocale')}
                          />
                        ) : null,
                      ]}
                    />,
                  ]}
                />
              }
            />
          )),
          !locales.some((row) => row.locale === 'vi') && capabilities.saveContentLocale ? (
            <LinkButton
              href={record('locale', 'new', { ...localeExtra, locale: 'vi' })}
              label={t('defaultLocale')}
            />
          ) : null,
          propertyGallery(_, property, data, url, capabilities, errors, draft),
        ]}
      />
    )
    if (dialog === 'locale-remove' && capabilities.removeContentLocale) {
      const row = locales.find((item) => item.id === itemId)
      if (row)
        dialogs.push(
          <>
            <form
              id="property-locale-remove-form"
              action={href({ dialog: 'locale-remove', item: String(row.id) })}
              method="post"
            >
              {Object.entries({
                ...hidden('remove-locale', row),
                locale: String(row.locale),
                roomTypeId: roomTypeId ?? '',
              }).map(([name, value]) => (
                <input type="hidden" name={name} value={value} autocomplete="off" />
              ))}
            </form>
            <ConfirmDialog
              id="property-locale-remove-confirm"
              title={t('removeLocale')}
              message={t('removeLocaleHint', { locale: String(row.locale) })}
              closeHref={action}
              closeLabel={t('cancel')}
              confirmLabel={t('removeLocale')}
              confirmForm="property-locale-remove-form"
              confirmDisabled={row.locale === 'vi'}
            />
          </>,
        )
    }
    if (dialog === 'locale' && capabilities.saveContentLocale) {
      const selected = url.searchParams.get('locale'),
        row = locales.find((item) => item.locale === selected)
      dialogs.push(
        <Dialog
          id="property-locale-dialog"
          title={t('editLocale')}
          closeHref={action}
          closeLabel={t('cancel')}
          body={
            <RecordForm
              action={action}
              method="post"
              errors={errors}
              submitLabel={t('save')}
              hidden={{ ...hidden('save-locale', row) }}
              fields={[
                {
                  id: 'property-workbench-locale',
                  name: 'locale',
                  label: t('locale'),
                  value: field('locale', row, selected === 'new' ? '' : (selected ?? 'vi')),
                  required: true,
                  readOnly: !!row,
                },
                {
                  id: 'property-workbench-title',
                  name: 'title',
                  label: t('publicTitle'),
                  value: field('title', row, property.publicName ?? property.name),
                  required: true,
                },
                {
                  id: 'property-workbench-description',
                  name: 'description',
                  type: 'textarea',
                  label: t('description'),
                  value: field('description', row, selected === 'vi' ? (property.description ?? '') : ''),
                  required: true,
                },
              ]}
            />
          }
        />,
      )
    }
  }
  const history = data.history?.length ? (
    <Section
      title={t('history')}
      body={
        <Stack
          items={data.history.map((row) => (
            <Text variant="bodySm">{`${new Intl.DateTimeFormat(frame.locale ?? 'vi', { dateStyle: 'short', timeStyle: 'short', timeZone: property.timezone }).format(new Date(String(row.occurredAt)))} · ${String(row.actorName ?? row.actorId ?? t('system'))} · ${_.resolves(`hospitality_core.propertyWorkbench.event.${String(row.action)}`) ? t(`event.${String(row.action)}`) : t('otherChange')}`}</Text>
          ))}
        />
      }
    />
  ) : null
  return (
    <RecordScreen
      translator={_}
      title={property.name}
      frame={frame}
      body={
        <Stack
          items={[
            notices,
            <TabbedView
              id="property-workbench"
              label={t('sections')}
              scroll="page"
              items={['information', 'structure', 'fees', 'content'].map((id) => ({
                id,
                label: t(id),
                href: href({ section: id }),
                active: id === section,
              }))}
              body={body}
            />,
            history,
            ...dialogs,
          ]}
        />
      }
    />
  )
}
