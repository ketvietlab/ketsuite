import { recordModalCreateHref, recordModalClosedHref } from '../../../ui/record-modal.tsx'
import type { TemplateResult } from '@ketvietlab/ketjs-view'
import { addCalendarDays } from '../calendar.ts'
import { roomOperationsWorkbench, type RoomOperationsRecord } from './room-operations-workbench.tsx'
import type { OperationResult } from './request-shared.tsx'
import { ActionGroup, LinkButton, RecordForm } from '@ketvietlab/design-system'
import { relationControl, relationLabels } from '../../backend/relation-select.ts'
import { adminPage, operationErrors, readForm, seeOther, text } from './request-shared.tsx'
import type { Route, ServeContext } from './request-shared.tsx'
import type { RouteEntry } from '@ketvietlab/ketjs'
import { housekeepingRoomsScreen, type RoomBoardData } from './housekeeping-rooms.tsx'

export const hospitalityRequestHousekeepingRooms: RouteEntry =
  (ctx: ServeContext): Route =>
  async (url, req) => {
    if (!['GET', 'POST'].includes(req.method ?? 'GET')) return text('GET or POST', { status: 405 })
    let attempted: Record<string, string> | undefined,
      errors: readonly string[] = []
    const commands: Record<string, { fn: string; dialog: string }> = {
      'block-room': { fn: 'blockRoom', dialog: 'block' },
      'reopen-room': { fn: 'reopenRoom', dialog: 'reopen' },
      'inspect-room': { fn: 'inspectRoom', dialog: 'fail' },
      'complete-room-cleaning': { fn: 'completeRoomCleaning', dialog: 'cleaned' },
    }
    if (req.method === 'POST') {
      attempted = await readForm(req)
      const command = commands[attempted.operation ?? ''],
        roomId = url.searchParams.get('peek')
      if (!command || !roomId) return text('Unknown room operation', { status: 400 })
      const dialog = command.fn === 'inspectRoom' && attempted.passed === '1' ? 'pass' : command.dialog
      url = new URL(url)
      url.searchParams.set('dialog', dialog)
      if (attempted.kind) url.searchParams.set('kind', attempted.kind)
      const until = attempted.until ?? ''
      if (
        command.fn === 'blockRoom' &&
        attempted.kind === 'ooo' &&
        (!/^\d{4}-\d{2}-\d{2}$/.test(until) ||
          !Number.isFinite(Date.parse(`${until}T00:00:00Z`)) ||
          new Date(`${until}T00:00:00Z`).toISOString().slice(0, 10) !== until)
      ) {
        errors = [ctx.translate(ctx.localeOf(url, req))('hospitality_core.validation.date')]
      } else {
        const result = (await ctx.call(
          `hospitality_core.${command.fn}`,
          {
            roomId,
            expectedVersion: Number(attempted.expectedVersion),
            requestKey: attempted.requestKey,
            ...(command.fn === 'blockRoom'
              ? {
                  kind: attempted.kind,
                  dateFrom: attempted.dateFrom,
                  dateTo: attempted.kind === 'ooo' ? addCalendarDays(until, 1) : attempted.dateTo,
                  backLocal: attempted.backLocal || undefined,
                  reason: attempted.reason,
                }
              : {}),
            ...(command.fn === 'reopenRoom' ? { id: attempted.id } : {}),
            ...(command.fn === 'inspectRoom'
              ? { passed: attempted.passed === '1', reason: attempted.reason || undefined }
              : {}),
          },
          url,
          req,
        )) as OperationResult
        if (result.ok) {
          const next = new URL(url)
          next.searchParams.delete('dialog')
          next.searchParams.delete('kind')
          return seeOther(next.pathname + next.search)
        }
        errors = operationErrors(ctx, url, req, result)
      }
    }
    const lang = ctx.localeOf(url, req),
      _ = ctx.translate(lang)
    const data = (await ctx.call(
      'hospitality_core.getRoomBoard',
      {
        propertyId: url.searchParams.get('property') || undefined,
        floorId: url.searchParams.get('floor') || undefined,
        state: url.searchParams.get('state') || undefined,
        q: url.searchParams.get('q') || undefined,
        peek: url.searchParams.get('peek') || undefined,
        page: Math.max(1, Math.trunc(Number(url.searchParams.get('page')) || 1)),
      },
      url,
      req,
    )) as RoomBoardData
    const scope = [...url.searchParams].filter(([key]) =>
      ['company', 'companies', 'branch', 'branches', 'lang'].includes(key),
    )
    const picker = async (
      name: string,
      fn: string,
      value: string | null,
      label: string,
      options: { value: string; label: string }[],
      input = {},
    ) =>
      relationControl(ctx, url, req, `board-${name}`, {
        name,
        ariaLabel: label,
        value,
        options,
        labels: relationLabels(_, label),
        disabled: !(await ctx.allows(`hospitality_core.${fn}`, url, req)),
        manager: {
          listFunction: `hospitality_core.${fn}`,
          listInput: input,
          searchInDropdown: true,
          requestQuery: new URLSearchParams(scope).toString(),
          limit: 20,
          resolveParam: 'id',
          idField: 'id',
          labelField: 'name',
        },
      })
    const property = await picker(
      'property',
      'lookupProperties',
      data.property?.id ?? null,
      _('hospitality_core.menu.properties'),
      data.property ? [{ value: data.property.id, label: data.property.name }] : [],
    )
    const floor = await picker(
      'floor',
      'lookupFloors',
      data.query.floorId ?? null,
      _('hospitality_core.board.floor'),
      [],
      { propertyId: data.property?.id },
    )
    const controls = (
      <RecordForm
        action="/admin/hospitality/housekeeping/rooms"
        method="get"
        columns={2}
        hidden={{
          ...Object.fromEntries(
            [...new Set(scope.map(([key]) => key))].map((key) => [key, url.searchParams.getAll(key)]),
          ),
          q: data.query.q ?? '',
          state: data.query.state ?? 'all',
        }}
        submitLabel={_('hospitality_core.action.apply')}
        submitVariant="secondary"
        fields={[
          {
            id: 'board-property',
            name: 'property',
            label: _('hospitality_core.menu.properties'),
            control: property,
          },
          { id: 'board-floor', name: 'floor', label: _('hospitality_core.board.floor'), control: floor },
        ]}
      />
    )
    const source = new URL(url)
    if (data.property) source.searchParams.set('property', data.property.id)
    let dialogs: TemplateResult | undefined, boardActions: TemplateResult | undefined
    if (data.selected && (await ctx.allows('hospitality_core.getRoomOperationsRecord', url, req))) {
      const operational = (await ctx.call(
        'hospitality_core.getRoomOperationsRecord',
        { id: data.selected.id },
        url,
        req,
      )) as RoomOperationsRecord
      const canAssign = await ctx.allows('hospitality_core.saveCleaningTask', url, req)
      const capabilities = Object.fromEntries(
        await Promise.all(
          ['blockRoom', 'reopenRoom', 'inspectRoom', 'completeRoomCleaning'].map(async (name) => [
            name,
            await ctx.allows(`hospitality_core.${name}`, url, req),
          ]),
        ),
      )
      if (operational.room && operational.property) {
        dialogs = roomOperationsWorkbench(_, operational, source, capabilities, errors, attempted, true)
        const t = (key: string) => _(`hospitality_core.roomOperations.${key}`)
        const at = (dialog: string) => {
          const next = new URL(recordModalClosedHref(source), source)
          next.searchParams.set('dialog', dialog)
          return next.pathname + next.search
        }
        const actions = []
        if (operational.blocks.length) {
          if (capabilities.reopenRoom)
            actions.push(<LinkButton href={at('reopen')} label={t('reopen')} variant="primary" />)
        } else {
          if (canAssign && data.selected.status !== 'inspection') {
            const create = new URL(recordModalClosedHref(source), source)
            create.searchParams.delete('dialog')
            create.searchParams.delete('kind')
            create.searchParams.set('room', data.selected.id)
            actions.push(
              <LinkButton
                href={recordModalCreateHref(create, { kind: 'hospitality.cleaningTask' })}
                label={_('hospitality_core.board.assign')}
              />,
            )
          }

          if (capabilities.completeRoomCleaning && ['dirty', 'cleaning'].includes(data.selected.status))
            actions.push(<LinkButton href={at('cleaned')} label={t('cleaned')} variant="primary" />)
          if (capabilities.inspectRoom && data.selected.status === 'inspection')
            actions.push(
              <LinkButton href={at('pass')} label={t('pass')} variant="primary" />,
              <LinkButton href={at('fail')} label={t('fail')} />,
            )
          if (
            capabilities.blockRoom &&
            !['occupied', 'maintenance', 'out_of_order'].includes(data.selected.status)
          )
            actions.push(<LinkButton href={at('block')} label={t('block')} />)
        }
        boardActions = <ActionGroup actions={actions} />
      }
    }
    return adminPage(ctx, url, req, {
      title: 'hospitality_core.screen.housekeepingRooms.title',
      body: (_, frame) =>
        housekeepingRoomsScreen(_, data, lang, frame, source, controls, boardActions, dialogs),
    })
  }
