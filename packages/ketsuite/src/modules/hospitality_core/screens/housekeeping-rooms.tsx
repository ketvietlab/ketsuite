import { recordModalHref, recordModalClosedHref } from '../../../ui/record-modal.tsx'
import {
  Badge,
  CardGrid,
  ContentCard,
  DescriptionList,
  EmptyState,
  Inline,
  LinkButton,
  ListChrome,
  Notice,
  Peek,
  PeekLayout,
  Stack,
  Surface,
  Text,
} from '@ketvietlab/design-system'
import { addCalendarDays } from '../calendar.ts'
import { ROOM_STATUSES, WorkspaceScreen, statusTone } from './shared.tsx'
import type { Frame, RoomRow, TemplateResult, Translator } from './shared.tsx'
import { hospitalityScopedHref } from './scoped-href.ts'

export type RoomBoardData = {
  property: { id: string; name: string; inspectionRequired: boolean; timezone: string } | null
  rows: Array<RoomRow & { arrivingAt?: string | null }>
  priority?: { count: number; first: { code: string; time: string } | null }
  selected:
    | (RoomRow & {
        arrivingAt?: string | null
        departingAt?: string | null
        latestOperation?: { action: string; occurredAt: string; actorName: string | null } | null
        tasks: Array<{
          id: string
          code: string
          taskType: string
          state: string
          assigneeName: string | null
        }>
        block: {
          kind: string
          dateFrom: string
          dateTo: string
          plannedBackAt: string | null
          reason: string
        } | null
      })
    | null
  total: number
  page: number
  pages: number
  query: { q?: string; floorId?: string; state?: string }
  counts: { state?: Record<string, number> }
}
export const housekeepingRoomsScreen = (
  _: Translator,
  data: RoomBoardData,
  locale: string,
  frame: Frame,
  source: URL,
  controls: TemplateResult,
  boardActions?: TemplateResult,
  dialogs?: TemplateResult,
): TemplateResult => {
  const t = (key: string) => _(`hospitality_core.board.${key}`)
  const time = (value: string) =>
    new Intl.DateTimeFormat(locale, {
      dateStyle: 'short',
      timeStyle: 'short',
      timeZone: data.property?.timezone ?? 'UTC',
    }).format(new Date(value))
  const at = (patch: Record<string, string | null>) => {
    const next = new URL(recordModalClosedHref(source), source)
    next.searchParams.delete('dialog')
    next.searchParams.delete('kind')
    for (const [key, value] of Object.entries(patch))
      value === null ? next.searchParams.delete(key) : next.searchParams.set(key, value)
    return next.pathname + next.search
  }
  const status = (room: RoomRow) => (
    <Badge label={_(`hospitality_core.roomStatus.${room.status}`)} tone={statusTone(room.status)} />
  )
  const groups =
    data.query.state === 'priority' ? ['priority'] : [...new Set(data.rows.map((row) => row.floorId ?? ''))]
  const selected = data.selected,
    index = data.rows.findIndex((row) => row.id === selected?.id)
  const step = (offset: number) => {
    const row = index >= 0 ? data.rows[index + offset] : null
    return { label: t(offset < 0 ? 'previous' : 'next'), href: row ? at({ peek: row.id }) : null }
  }
  const recordHref = selected
    ? recordModalHref(at({ peek: selected.id }), { kind: 'hospitality.room', id: selected.id })
    : ''
  const peek = selected ? (
    <Peek
      id="hospitality-room-peek"
      title={selected.code}
      eyebrow={[data.property?.name, selected.floor?.name].filter(Boolean).join(' · ')}
      status={status(selected)}
      closeLabel={t('close')}
      closeHref={at({ peek: null })}
      previous={step(-1)}
      next={step(1)}
      record={{ label: t('record'), href: recordHref }}
      body={
        <Stack
          items={[
            <DescriptionList
              columns={1}
              items={[
                { id: 'name', label: _('hospitality_core.col.name'), value: selected.name },
                {
                  id: 'type',
                  label: _('hospitality_core.col.roomType'),
                  value: selected.roomType?.name ?? '—',
                },
                {
                  id: 'floor',
                  label: t('floor'),
                  value: [selected.building?.name, selected.floor?.name].filter(Boolean).join(' · ') || '—',
                },
                ...(selected.arrivingAt
                  ? [{ id: 'arrival', label: t('arrival'), value: selected.arrivingAt }]
                  : []),
                ...(selected.departingAt
                  ? [{ id: 'departure', label: t('departure'), value: time(selected.departingAt) }]
                  : []),
                ...(selected.latestOperation
                  ? [
                      {
                        id: 'latest',
                        label: t('latestOperation'),
                        value: `${_(`hospitality_core.roomOperations.event.${selected.latestOperation.action}`)} · ${time(selected.latestOperation.occurredAt)} · ${selected.latestOperation.actorName ?? _('hospitality_core.collection.history.system')}`,
                      },
                    ]
                  : []),
                {
                  id: 'capacity',
                  label: _('hospitality_core.col.capacity'),
                  value: String(selected.capacity),
                },
                {
                  id: 'tasks',
                  label: t('tasks'),
                  value: selected.tasks.length ? (
                    <Stack
                      items={selected.tasks.map((task) => (
                        <Text variant="bodySm">{`${_(`hospitality_core.cleaningType.${task.taskType}`)} · ${task.assigneeName ?? t('unassigned')} · ${_(`hospitality_core.cleaningState.${task.state}`)}`}</Text>
                      ))}
                    />
                  ) : (
                    t('noTasks')
                  ),
                },
                ...(selected.block
                  ? [
                      {
                        id: 'block',
                        label: _(`hospitality_core.roomOperations.${selected.block.kind}`),
                        value: `${selected.block.reason} · ${selected.block.dateFrom} → ${addCalendarDays(selected.block.dateTo, -1)}${selected.block.plannedBackAt ? ` · ${selected.block.plannedBackAt}` : ''}`,
                      },
                    ]
                  : []),
              ]}
            />,
            data.property?.inspectionRequired && ['dirty', 'cleaning'].includes(selected.status) ? (
              <Text variant="bodySm" tone="muted">
                {t('inspection')}
              </Text>
            ) : null,
          ]}
        />
      }
      actions={
        boardActions ?? (
          <LinkButton
            label={t('operations')}
            href={hospitalityScopedHref(
              source,
              `/admin/hospitality/housekeeping/rooms/${encodeURIComponent(selected.id)}?returnTo=${encodeURIComponent(at({ peek: selected.id }))}`,
            )}
          />
        )
      }
    />
  ) : null
  const main = data.rows.length ? (
    <Stack
      items={groups.map((floorId) => {
        const rooms =
          data.query.state === 'priority'
            ? data.rows
            : data.rows.filter((row) => (row.floorId ?? '') === floorId)
        return (
          <Surface
            title={data.query.state === 'priority' ? t('priority') : (rooms[0]?.floor?.name ?? t('noFloor'))}
            body={
              <CardGrid
                minimum="compact"
                items={rooms}
                id={(row) => row.id}
                card={(row) => (
                  <ContentCard
                    title={row.code}
                    summary={row.roomType?.name ?? row.name}
                    status={
                      <Inline
                        items={[
                          status(row),
                          row.arrivingAt && row.status !== 'available' ? (
                            <Badge label={t('priorityBadge')} tone="danger" />
                          ) : null,
                        ]}
                      />
                    }
                    body={
                      row.arrivingAt ? (
                        <Text variant="bodySm">{`${t('arrival')} · ${row.arrivingAt}`}</Text>
                      ) : undefined
                    }
                    href={at({ peek: row.id })}
                    selected={row.id === selected?.id}
                    padding="compact"
                  />
                )}
              />
            }
          />
        )
      })}
    />
  ) : (
    <EmptyState
      title={t('empty')}
      message={t('emptyHint')}
      actions={
        <LinkButton
          label={t('reset')}
          href={at({ floor: null, state: null, q: null, page: null, peek: null })}
        />
      }
    />
  )
  return (
    <WorkspaceScreen
      translator={_}
      title={_('hospitality_core.screen.housekeepingRooms.title')}
      frame={frame}
      body={
        <Stack
          items={[
            controls,
            <ListChrome
              search={{
                id: 'board-search',
                action: source.pathname,
                name: 'q',
                value: data.query.q ?? '',
                label: t('search'),
                placeholder: t('search'),
                submitLabel: t('searchAction'),
                hidden: Object.fromEntries(
                  [...source.searchParams].filter(
                    ([key]) => !['q', 'page', 'peek', 'dialog', 'kind'].includes(key),
                  ),
                ),
              }}
              filtersLabel={t('filters')}
              filtersToggle={{
                label: t('filters'),
                count: data.query.state && data.query.state !== 'all' ? 1 : 0,
              }}
              facets={['all', 'priority', ...ROOM_STATUSES].map((state) => ({
                id: state,
                label: state === 'priority' ? t('priority') : _(`hospitality_core.roomStatus.${state}`),
                count: data.counts.state?.[state] ?? 0,
                active: (data.query.state ?? 'all') === state,
                href: at({ state: state === 'all' ? null : state, page: null, peek: null }),
              }))}
            />,
            data.priority?.count && data.priority.first && data.query.state !== 'priority' ? (
              <Notice
                tone="warning"
                title={_('hospitality_core.board.priorityTitle', { count: data.priority.count })}
                message={`${t('earliest')} ${data.priority.first.code} · ${data.priority.first.time}`}
                actions={
                  <LinkButton
                    label={t('showPriority')}
                    href={at({ state: 'priority', page: null, peek: null })}
                  />
                }
              />
            ) : null,
            <PeekLayout peekId="hospitality-room-peek" main={main} peek={peek} />,
            <Inline
              items={[
                data.page > 1 ? (
                  <LinkButton
                    label={t('previousPage')}
                    href={at({ page: String(data.page - 1), peek: null })}
                  />
                ) : null,
                <Text variant="bodySm">{`${data.page} / ${data.pages} · ${data.total} ${t(data.total === 1 ? 'room' : 'rooms')}`}</Text>,
                data.page < data.pages ? (
                  <LinkButton label={t('nextPage')} href={at({ page: String(data.page + 1), peek: null })} />
                ) : null,
              ]}
            />,
            dialogs ?? null,
          ]}
        />
      }
    />
  )
}
