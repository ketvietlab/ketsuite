import { callFn, type Adapter } from '@ketvietlab/ketjs'
import type { TestFixtures } from '@ketvietlab/ketjs/testing'

/** The fixture's SQL is written with `?`; PostgreSQL numbers its parameters. */
const portable = (adapter: Adapter, sql: string) => {
  if (adapter.name !== 'postgres') return sql
  let index = 0
  return sql.replace(/\?/g, () => `$${++index}`)
}

/** Provision explicit synthetic location data for older workflow fixtures, before the command under test.
 * Explicit null/empty location inputs are left untouched so refusal cases cannot be repaired by this helper.
 * Direct fixture inserts deliberately do not run catalogue commands or change property versions.
 */
export async function roomFixtureInput(
  adapter: Adapter,
  company: string,
  name: string,
  input: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  if (
    !['hospitality_core.saveRoom', 'saveRoom'].includes(name) ||
    Object.hasOwn(input, 'floorId') ||
    Object.hasOwn(input, 'buildingId')
  )
    return input
  const propertyId = String(input.propertyId ?? '')
  if (
    !(
      await adapter.all(
        portable(adapter, 'SELECT id FROM hospitality_core_property WHERE id = ? AND "companyId" = ?'),
        [propertyId, company],
      )
    ).length
  )
    return input
  const current = (
    await adapter.all(
      portable(
        adapter,
        'SELECT "buildingId", "floorId" FROM hospitality_core_room WHERE id = ? AND "companyId" = ?',
      ),
      [String(input.id ?? ''), company],
    )
  )[0]
  if (current?.floorId) return { buildingId: current.buildingId, floorId: current.floorId, ...input }
  const buildingId = String(input.buildingId ?? `fixture-building:${company}:${propertyId}`)
  const floorId = `fixture-floor:${buildingId}`
  if (
    !(
      await adapter.all(portable(adapter, 'SELECT id FROM hospitality_core_building WHERE id = ?'), [
        buildingId,
      ])
    ).length
  )
    await adapter.run(
      portable(
        adapter,
        'INSERT INTO hospitality_core_building (id, "companyId", "propertyId", code, name, sequence, active, version) VALUES (?, ?, ?, ?, ?, 1, TRUE, 1)',
      ),
      [buildingId, company, propertyId, 'FIXTURE', 'Synthetic building'],
    )
  if (
    !(await adapter.all(portable(adapter, 'SELECT id FROM hospitality_core_floor WHERE id = ?'), [floorId]))
      .length
  )
    await adapter.run(
      portable(
        adapter,
        'INSERT INTO hospitality_core_floor (id, "companyId", "propertyId", "buildingId", code, name, sequence, level, active, version) VALUES (?, ?, ?, ?, ?, ?, 1, 1, TRUE, 1)',
      ),
      [floorId, company, propertyId, buildingId, 'FIXTURE', 'Synthetic floor'],
    )
  return { buildingId, floorId, ...input }
}

/** Only legacy synthetic setup uses this adapter; public client calls stay untouched. */
export const roomFixtureCall: typeof callFn = async (name, input, options) =>
  callFn(name, await roomFixtureInput(options.adapter, options.scope?.company ?? '', name, input), options)

export async function deploymentRoomFixture<T = unknown>(
  fixture: TestFixtures,
  name: string,
  input: Record<string, unknown> = {},
  options: NonNullable<Parameters<TestFixtures['call']>[2]> = {},
) {
  if (
    name !== 'hospitality_core.saveRoom' ||
    Object.hasOwn(input, 'floorId') ||
    Object.hasOwn(input, 'buildingId')
  )
    return fixture.call<T>(name, input, options)
  const args = await fixture.withTenant(options.tenant ?? '', ({ adapter }) =>
    roomFixtureInput(adapter, options.scope?.company ?? '', name, input),
  )
  return fixture.call<T>(name, args, options)
}
