import { randomUUID } from 'node:crypto'
import type { Translator } from '@ketvietlab/ketjs'
import {
  Badge,
  ConfirmDialog,
  Inline,
  Link,
  LinkButton,
  Menu,
  Notice,
  Section,
  Stack,
  Text,
  TreeGrid,
} from '@ketvietlab/design-system'
import type { MenuEntry } from '@ketvietlab/design-system'
import type { PropertyWorkbench } from './property-workbench.tsx'
import type { PropertyDetail } from './shared.tsx'

type Item = Record<string, unknown>
type StructureRow = { kind: 'building' | 'floor'; item: Item; building?: Item }

export function propertyStructure(
  _: Translator,
  property: PropertyDetail,
  data: PropertyWorkbench,
  capabilities: Record<string, boolean>,
  url: URL,
  action: string,
  href: (changes?: Record<string, string>) => string,
  record: (kind: string, id?: string, extra?: Record<string, string>) => string,
  destination: (path: string) => string,
) {
  const t = (key: string, params?: Record<string, string | number>) =>
    _(`hospitality_core.propertyWorkbench.${key}`, params)
  const sorted = (items: Item[]) =>
    [...items].sort(
      (a, b) =>
        Number(a.sequence ?? 10) - Number(b.sequence ?? 10) ||
        String(a.name).localeCompare(String(b.name)) ||
        String(a.id).localeCompare(String(b.id)),
    )
  const rows = sorted(data.buildings).flatMap((item) => {
    const floors = sorted(data.floors.filter((floor) => floor.buildingId === item.id))
    return [
      {
        row: { kind: 'building', item } as StructureRow,
        level: 1,
        hasChildren: floors.length > 0,
        expanded: true,
      },
      ...floors.map((floor) => ({
        row: { kind: 'floor', item: floor, building: item } as StructureRow,
        level: 2,
      })),
    ]
  })
  const formId = ({ kind, item }: StructureRow) =>
    `property-${kind}-restore-${encodeURIComponent(String(item.id))}`
  const canChange = (kind: string) =>
    Boolean(capabilities[kind === 'building' ? 'archiveBuilding' : 'archiveFloor'])
  const restoreBlocked = (row: StructureRow) =>
    property.active !== true || (row.kind === 'floor' && row.building?.active !== true)
  const hidden = (row: StructureRow, active: boolean) => ({
    operation: `${row.kind}-active`,
    id: String(row.item.id),
    active: active ? '1' : '0',
    expectedVersion: String(row.item.version ?? 0),
    expectedPropertyVersion: String(property.version ?? 0),
    requestKey: randomUUID(),
  })
  const form = (row: StructureRow, active: boolean, id: string) => (
    <form hidden id={id} action={action} method="post">
      {Object.entries(hidden(row, active)).map(([name, value]) => (
        <input type="hidden" name={name} value={value} autocomplete="off" />
      ))}
    </form>
  )
  const roomHref = (row: StructureRow) =>
    destination(
      `/admin/hospitality/rooms?property=${encodeURIComponent(property.id)}&${row.kind}=${encodeURIComponent(String(row.item.id))}`,
    )
  const menu = (row: StructureRow) => {
    const { kind, item, building } = row
    const entries: MenuEntry[] = []
    if (capabilities[kind === 'building' ? 'saveBuilding' : 'saveFloor'])
      entries.push({ id: 'edit', label: t('edit'), href: record(kind, String(item.id)) })
    if (kind === 'building' && item.active && capabilities.saveFloor)
      entries.push({
        id: 'floor',
        label: t('newFloor'),
        href: record('floor', 'new', { building: String(item.id) }),
      })
    if (kind === 'floor' && Number(item.roomCount ?? 0) > 0)
      entries.push({ id: 'rooms', label: t('viewRooms'), href: roomHref(row) })
    if (canChange(kind))
      entries.push(
        item.active
          ? {
              id: 'archive',
              label: t(`archive.${kind}`),
              destructive: true,
              href: href({ dialog: `archive-${kind}`, item: String(item.id) }),
            }
          : {
              id: 'restore',
              label: t(`restore.${kind}`),
              form: formId(row),
              disabled: restoreBlocked(row),
              description:
                kind === 'floor' && building?.active !== true ? t('restoreBuildingFirst') : undefined,
            },
      )
    return entries.length ? (
      <Menu
        id={`property-structure-${kind}-${encodeURIComponent(String(item.id))}`}
        label={t('rowActions', { name: String(item.name) })}
        trigger={<span aria-hidden="true">···</span>}
        align="end"
        mobileAlign="end"
        items={entries}
      />
    ) : null
  }
  const selected = rows
    .map((row) => row.row)
    .find(
      (row) =>
        url.searchParams.get('dialog') === `archive-${row.kind}` &&
        row.item.id === url.searchParams.get('item'),
    )
  const activeFloors = Number(selected?.item.activeFloorCount ?? 0),
    activeRooms = Number(selected?.item.activeRoomCount ?? 0)
  return (
    <>
      <Section
        title={t('structure')}
        actions={
          capabilities.saveBuilding ? (
            <LinkButton href={record('building')} label={t('newBuilding')} />
          ) : undefined
        }
        body={
          <Stack
            items={[
              <Text variant="bodySm" tone="muted">
                {t('structureHint')}
              </Text>,
              rows.length ? (
                <TreeGrid
                  label={t('structure')}
                  primaryLabel={t('structureName')}
                  rows={rows}
                  id={(row) => `${row.kind}:${row.item.id}`}
                  primary={(row) => (
                    <Stack
                      gap="none"
                      items={[
                        row.kind === 'floor' && Number(row.item.roomCount ?? 0) > 0 ? (
                          <Link href={roomHref(row)} label={String(row.item.name)} />
                        ) : (
                          <Text variant="bodyMd" fontWeight={row.kind === 'building' ? 'medium' : undefined}>
                            {String(row.item.name)}
                          </Text>
                        ),
                        <Inline
                          gap="tight"
                          wrap
                          items={[
                            <Text variant="bodySm" tone="muted">
                              {t('structureCode', { code: String(row.item.code) })}
                            </Text>,
                            row.item.active !== true ? (
                              <Badge label={t('archived')} size="small" />
                            ) : row.kind === 'floor' && row.building?.active !== true ? (
                              <Badge label={t('buildingArchived')} size="small" />
                            ) : null,
                          ]}
                        />,
                      ]}
                    />
                  )}
                  columns={[
                    {
                      key: 'rooms',
                      label: t('roomsCount'),
                      cell: (row) => <Text variant="bodySm">{String(row.item.roomCount ?? 0)}</Text>,
                    },
                    { key: 'actions', label: t('actions'), cell: menu },
                  ]}
                />
              ) : (
                <Notice title={t('structureEmpty')} message={t('structureEmptyHint')} />
              ),
            ]}
          />
        }
      />
      {rows.map(({ row }) =>
        row.item.active !== true && canChange(row.kind) && !restoreBlocked(row)
          ? form(row, true, formId(row))
          : null,
      )}
      {selected && selected.item.active && canChange(selected.kind) ? (
        <>
          {form(selected, false, 'property-structure-archive-form')}
          <ConfirmDialog
            id="property-structure-archive-confirm"
            title={t(`archive.${selected.kind}`)}
            message={t(activeFloors || activeRooms ? 'structureBlocked' : 'structureArchiveHint')}
            details={
              <Stack
                items={[
                  <Text variant="bodyMd">{String(selected.item.name)}</Text>,
                  <Text variant="bodySm">
                    {t('structureDependencies', { floors: activeFloors, rooms: activeRooms })}
                  </Text>,
                  activeRooms && selected.kind === 'floor' ? (
                    <LinkButton href={roomHref(selected)} label={t('viewRooms')} />
                  ) : null,
                ]}
              />
            }
            closeHref={action}
            closeLabel={t('cancel')}
            confirmForm="property-structure-archive-form"
            confirmLabel={t(`archive.${selected.kind}`)}
            confirmDisabled={activeFloors + activeRooms > 0}
          />
        </>
      ) : null}
    </>
  )
}
