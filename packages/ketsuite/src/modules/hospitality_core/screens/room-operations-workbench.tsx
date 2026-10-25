import {
  Badge,
  ConfirmDialog,
  Dialog,
  LinkButton,
  Notice,
  RecordForm,
  Section,
  Stack,
  Text,
} from '@ketvietlab/design-system'
import { randomUUID } from 'node:crypto'
import type { Translator } from '@ketvietlab/ketjs'
import type { TemplateResult } from '@ketvietlab/ketjs-view'
import { addCalendarDays, dateKeyIn } from '../calendar.ts'
export type RoomOperationsRecord = {
  room: {
    id: string
    code: string
    status: string
    active: boolean
    version: number | null
    propertyId: string
  } | null
  property: { id: string; timezone: string; inspectionRequired: boolean } | null
  blocks: Array<{
    id: string
    kind: string
    dateFrom: string
    dateTo: string
    reason: string
    plannedBackAt: string | null
  }>
  history: Array<{
    id: string
    action: string
    actorId: string | null
    occurredAt: string
    details: Record<string, unknown>
  }>
}
export function roomOperationsWorkbench(
  _: Translator,
  data: RoomOperationsRecord,
  url: URL,
  capabilities: Record<string, boolean>,
  errors: readonly string[] = [],
  attempted?: Record<string, string>,
  dialogsOnly = false,
): TemplateResult {
  const room = data.room!,
    property = data.property!,
    t = (key: string) => _(`hospitality_core.roomOperations.${key}`)
  const base = new URL(url)
  base.searchParams.delete('dialog')
  base.searchParams.delete('kind')
  const action = base.pathname + base.search,
    at = (dialog: string, kind?: string) => {
      const next = new URL(base)
      next.searchParams.set('dialog', dialog)
      if (kind) next.searchParams.set('kind', kind)
      return next.pathname + next.search
    }
  const block = data.blocks[0],
    kind = (attempted?.kind ?? url.searchParams.get('kind')) === 'oos' ? 'oos' : 'ooo',
    today = dateKeyIn(new Date(), property.timezone),
    version = String(room.version ?? 0),
    requestKey = randomUUID()
  const hidden = { roomId: room.id, expectedVersion: version, requestKey }
  const work: TemplateResult[] = []
  if (dialogsOnly && errors.length)
    work.push(<Notice tone="danger" title={t('failed')} message={errors.join(' · ')} />)
  if (!dialogsOnly && block) {
    work.push(
      <Section
        title={t(block.kind)}
        body={
          <Stack
            items={[
              <Badge label={t(block.kind)} />,
              <Text variant="bodySm">{`${block.dateFrom} → ${block.dateTo} · ${block.reason}${block.plannedBackAt ? ` · ${block.plannedBackAt}` : ''}`}</Text>,
              capabilities.reopenRoom ? <LinkButton href={at('reopen')} label={t('reopen')} /> : null,
            ]}
          />
        }
      />,
    )
  } else if (!dialogsOnly && room.active) {
    const commands: TemplateResult[] = []
    if (capabilities.completeRoomCleaning && ['dirty', 'cleaning'].includes(room.status))
      commands.push(
        <RecordForm
          action={action}
          method="post"
          submitLabel={t('cleaned')}
          submitVariant="primary"
          fields={[]}
          hidden={{ ...hidden, operation: 'complete-room-cleaning' }}
        />,
      )
    if (capabilities.inspectRoom && room.status === 'inspection')
      commands.push(
        <RecordForm
          action={action}
          method="post"
          submitLabel={t('pass')}
          submitVariant="primary"
          fields={[]}
          hidden={{ ...hidden, operation: 'inspect-room', passed: '1' }}
        />,
        <LinkButton href={at('fail')} label={t('fail')} />,
      )
    if (capabilities.blockRoom && !['occupied', 'maintenance', 'out_of_order'].includes(room.status))
      commands.push(<LinkButton href={at('block')} label={t('block')} />)
    if (commands.length) work.push(<Section title={t('actions')} body={<Stack items={commands} />} />)
  }
  if (url.searchParams.get('dialog') === 'block' && capabilities.blockRoom && !block)
    work.push(
      <Dialog
        id="hospitality-room-block"
        title={t('block')}
        closeHref={action}
        closeLabel={t('cancel')}
        body={
          <Stack
            items={[
              <Stack
                items={[
                  <LinkButton
                    href={at('block', 'ooo')}
                    label={t('ooo')}
                    variant={kind === 'ooo' ? 'primary' : 'secondary'}
                  />,
                  <LinkButton
                    href={at('block', 'oos')}
                    label={t('oos')}
                    variant={kind === 'oos' ? 'primary' : 'secondary'}
                  />,
                ]}
              />,
              <Text variant="bodySm">{t(kind === 'ooo' ? 'oooHint' : 'oosHint')}</Text>,
              <RecordForm
                action={action}
                method="post"
                errors={errors}
                submitLabel={t('block')}
                submitVariant="primary"
                hidden={{
                  ...hidden,
                  operation: 'block-room',
                  kind,
                  dateFrom: today,
                  dateTo: addCalendarDays(today, 1),
                }}
                fields={[
                  ...(kind === 'ooo'
                    ? [
                        {
                          id: 'block-until',
                          name: 'until',
                          type: 'date' as const,
                          locale: url.searchParams.get('lang') === 'en' ? ('en' as const) : ('vi' as const),
                          label: t('until'),
                          value: attempted?.until ?? today,
                          min: today,
                          required: true,
                        },
                      ]
                    : [
                        {
                          id: 'block-back',
                          name: 'backLocal',
                          type: 'time' as const,
                          label: t('back'),
                          value: attempted?.backLocal,
                          required: true,
                        },
                      ]),
                  {
                    id: 'block-reason',
                    name: 'reason',
                    type: 'textarea',
                    label: t('reason'),
                    value: attempted?.reason,
                    required: true,
                  },
                ]}
              />,
            ]}
          />
        }
      />,
    )
  if (url.searchParams.get('dialog') === 'fail' && capabilities.inspectRoom && room.status === 'inspection')
    work.push(
      <Dialog
        id="hospitality-room-inspection-failed"
        title={t('fail')}
        closeHref={action}
        closeLabel={t('cancel')}
        body={
          <RecordForm
            action={action}
            method="post"
            errors={errors}
            submitLabel={t('fail')}
            hidden={{ ...hidden, operation: 'inspect-room', passed: '0' }}
            fields={[
              {
                id: 'inspection-reason',
                name: 'reason',
                type: 'textarea',
                label: t('reason'),
                value: attempted?.reason,
                required: true,
              },
            ]}
          />
        }
      />,
    )
  if (url.searchParams.get('dialog') === 'reopen' && capabilities.reopenRoom && block)
    work.push(
      <>
        <form id="room-reopen-form" action={action} method="post">
          <input type="hidden" name="operation" value="reopen-room" autocomplete="off" />
          <input type="hidden" name="id" value={block.id} autocomplete="off" />
          <input type="hidden" name="expectedVersion" value={version} autocomplete="off" />
          <input type="hidden" name="requestKey" value={requestKey} autocomplete="off" />
        </form>
        <ConfirmDialog
          id="room-reopen-confirm"
          title={t('reopen')}
          message={t('reopenHint')}
          closeHref={action}
          closeLabel={t('cancel')}
          confirmLabel={t('reopen')}
          confirmForm="room-reopen-form"
        />
      </>,
    )
  const dialog = url.searchParams.get('dialog')
  if (
    (dialog === 'cleaned' &&
      capabilities.completeRoomCleaning &&
      ['dirty', 'cleaning'].includes(room.status) &&
      !block) ||
    (dialog === 'pass' && capabilities.inspectRoom && room.status === 'inspection' && !block)
  ) {
    const operation = dialog === 'pass' ? 'inspect-room' : 'complete-room-cleaning'
    work.push(
      <Dialog
        id="hospitality-room-ready"
        title={t(dialog)}
        closeHref={action}
        closeLabel={t('cancel')}
        body={
          <RecordForm
            action={action}
            method="post"
            errors={errors}
            submitLabel={t(dialog)}
            submitVariant="primary"
            hidden={{ ...hidden, operation, passed: '1' }}
            fields={[]}
          />
        }
      />,
    )
  }
  if (!dialogsOnly && data.history.length)
    work.push(
      <Section
        title={t('history')}
        body={
          <Stack
            items={data.history.map((row) => (
              <Text variant="bodySm">{`${row.occurredAt} · ${t(`event.${row.action}`)}${row.actorId ? ` · ${row.actorId}` : ''}`}</Text>
            ))}
          />
        }
      />,
    )
  return <Stack items={work} />
}
