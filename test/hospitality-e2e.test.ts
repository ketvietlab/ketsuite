import { deploymentRoomFixture } from './helpers/hospitality-room-fixture.ts'
import assert from 'node:assert/strict'
import { test } from 'node:test'
import sharp from 'sharp'
import { createTestDeployment } from '@ketvietlab/ketjs/testing'
import type { Row, Scope } from '@ketvietlab/ketjs'
import { ketsuite } from '../apps/ketsuite/deployment.ts'

const scope: Scope = { company: 'default', companies: ['default'], branches: null }

/** No message key reaches the reader as text; an island's own props are data and may name keys. */
const assertNoVisibleKey = (html: string) => {
  const leaked = html.match(/(?:>|placeholder="|aria-label="|title=")[^<"]*hospitality_core\.[\w.]*/u)
  assert.equal(leaked, null, `visible message key: ${leaked?.[0]}`)
}

const decode = (value: string) =>
  value
    .replaceAll('&quot;', '"')
    .replaceAll('&#39;', "'")
    .replaceAll('&lt;', '<')
    .replaceAll('&gt;', '>')
    .replaceAll('&amp;', '&')

/** Every hidden field of the form on a page that posts to `action`. */
const hiddenFields = (html: string, action: string): Record<string, string> => {
  const at = html.search(
    new RegExp(`<form[^>]*action="[^"]*${action.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&')}`),
  )
  if (at < 0) return {}
  const form = html.slice(at, html.indexOf('</form>', at))
  const hidden: Record<string, string> = {}
  for (const [, name, value] of form.matchAll(/<input type="hidden" name="([^"]+)" value="([^"]*)"/g))
    hidden[name!] = decode(value!)
  return hidden
}

/** Every hidden field of the form that carries `operation`, whatever its attribute order. */
const operationFields = (html: string, operation: string): Record<string, string> => {
  const form = html
    .split('<form')
    .find((chunk) => chunk.split('</form>')[0]!.includes(`value="${operation}"`))
    ?.split('</form>')[0]
  const hidden: Record<string, string> = {}
  for (const [input] of form?.matchAll(/<input[^>]*>/g) ?? []) {
    if (!/type="hidden"/.test(input)) continue
    const name = input.match(/name="([^"]*)"/)?.[1]
    if (name) hidden[name] = decode(input.match(/value="([^"]*)"/)?.[1] ?? '')
  }
  return hidden
}

/** What a record form carries besides its fields: the version it was read at and its request key. */
const formState = (html: string, marker = 'data-has-fields="true"'): Record<string, string> => {
  const form = html.slice(html.indexOf(marker)).split('</form>')[0]!
  const hidden: Record<string, string> = {}
  for (const name of ['expectedVersion', 'requestKey']) {
    const value = form.match(new RegExp(`name="${name}" value="([^"]*)"`))?.[1]
    if (value !== undefined) hidden[name] = value
  }
  return hidden
}

test('hospitality e2e: authenticated booking and front-desk flow crosses real HTTP', async (t) => {
  // The desk's day is 20 August 2026, early afternoon at the property.
  t.mock.timers.enable({ apis: ['Date'], now: new Date('2026-08-20T06:00:00.000Z') })
  const e2e = await createTestDeployment(ketsuite)
  t.after(() => e2e.close())
  const seed = (name: string, input: Record<string, unknown>) =>
    deploymentRoomFixture(e2e.fixture, name, input, { scope })
  // Every record form is read before it is posted, as a browser does.
  const formOf = async (path: string) => {
    const page = await e2e.client.get(path)
    return page.ok ? formState(await page.text()) : {}
  }
  // A reservation's workspace is an island that holds the version it read.
  const reservationState = async (id: string) => ({
    expectedVersion: String(
      ((await e2e.client.call('hospitality_core.getReservation', { id })).value as Row).version,
    ),
    requestKey: `e2e-${crypto.randomUUID()}`,
  })
  // Arrival and departure change the stay, so they carry the stay's version.
  const stayState = async (id: string) => ({
    // A record never claimed yet counts as version 0.
    expectedVersion: String(
      ((await e2e.client.call('hospitality_core.getStay', { id })).value as Row).version ?? 0,
    ),
    requestKey: `e2e-${crypto.randomUUID()}`,
  })
  // Charges, invoices and payments change the guest bill, so they carry its version.
  const folioState = async (id: string) => ({
    expectedVersion: String(
      ((await e2e.client.call('hospitality_core.getFolio', { id })).value as Row).version ?? 0,
    ),
    requestKey: `e2e-${crypto.randomUUID()}`,
  })
  const propertyState = async (id: string) => ({
    // A record never claimed yet counts as version 0.
    expectedVersion: String(
      ((await e2e.client.call('hospitality_core.getProperty', { id })).value as Row).version ?? 0,
    ),
    requestKey: `e2e-${crypto.randomUUID()}`,
  })
  const everyWeekday = Object.fromEntries(Array.from({ length: 7 }, (_, day) => [`weekday${day + 1}`, '1']))
  const hiddenOf = async (path: string, action: string) => {
    const page = await e2e.client.get(path)
    return page.ok ? hiddenFields(await page.text(), action) : {}
  }

  await seed('partner.savePartner', {
    id: 'company-partner',
    kind: 'company',
    name: 'Ket Hospitality',
  })
  await seed('company.saveCompany', {
    id: 'default',
    partnerId: 'company-partner',
    currency: 'VND',
  })
  await seed('user.createUser', {
    id: 'admin',
    login: 'admin',
    password: 'hospitality-e2e',
    name: 'Hospitality admin',
    defaultCompanyId: 'default',
    superuser: true,
  })
  await seed('user.grantCompany', {
    id: 'admin:default',
    userId: 'admin',
    companyId: 'default',
  })
  await seed('partner.savePartner', { id: 'guest', kind: 'person', name: 'Nguyễn An' })
  await seed('partner.savePartner', { id: 'companion', kind: 'person', name: 'Trần Bình' })
  await seed('uom.saveUnit', { id: 'service-unit', name: 'Lần', relativeFactor: '1' })
  await seed('product.saveTemplate', {
    id: 'breakfast-template',
    name: 'Bữa sáng',
    type: 'service',
    uomId: 'service-unit',
    listPrice: '25',
    saleOk: true,
  })
  await seed('product.saveVariant', {
    id: 'breakfast',
    templateId: 'breakfast-template',
    defaultCode: 'BF',
    combinationKey: '',
  })
  await seed('hospitality_core.saveProperty', {
    id: 'hotel',
    code: 'HCM',
    name: 'Ket Hotel',
    accommodationType: 'hotel',
    timezone: 'Asia/Ho_Chi_Minh',
    street1: '123 Nguyễn Huệ',
    locality: 'Thành phố Hồ Chí Minh',
  })
  // Cleaning is given to staff who work at the property's branch.
  const hotelBranch = ((await seed('hospitality_core.getProperty', { id: 'hotel' })).value as Row).branchId
  for (const [id, name] of [
    ['housekeeper-01', 'Housekeeper One'],
    ['supervisor-01', 'Supervisor One'],
  ] as const) {
    await seed('partner.savePartner', { id: `${id}-party`, kind: 'person', name })
    await seed('user.createUser', {
      id,
      partnerId: `${id}-party`,
      login: id,
      password: 'hospitality-e2e',
      name,
      defaultCompanyId: 'default',
    })
    await seed('user.grantCompany', { id: `${id}:default`, userId: id, companyId: 'default' })
    await seed('user.grantBranch', { id: `${id}:branch`, userId: id, branchId: hotelBranch })
  }
  await seed('hospitality_core.saveRoomType', {
    id: 'deluxe',
    propertyId: 'hotel',
    code: 'DLX',
    name: 'Deluxe',
    baseRate: '100',
    published: true,
  })
  await seed('hospitality_core.saveRoom', {
    id: '101',
    propertyId: 'hotel',
    roomTypeId: 'deluxe',
    code: '101',
    name: 'Phòng 101',
  })
  await seed('hospitality_core.saveRoom', {
    id: '102',
    propertyId: 'hotel',
    roomTypeId: 'deluxe',
    code: '102',
    name: 'Phòng 102',
  })
  await seed('hospitality_core.saveRoom', {
    id: '103',
    propertyId: 'hotel',
    roomTypeId: 'deluxe',
    code: '103',
    name: 'Phòng 103',
  })
  await seed('hospitality_core.saveRoom', {
    id: '104',
    propertyId: 'hotel',
    roomTypeId: 'deluxe',
    code: '104',
    name: 'Phòng 104',
  })
  await seed('hospitality_core.saveRoom', {
    id: 'archived-room',
    propertyId: 'hotel',
    roomTypeId: 'deluxe',
    code: '199',
    name: 'Phòng đã lưu trữ',
  })
  await e2e.fixture.withTenant('', async ({ adapter }) => {
    await adapter.run('UPDATE hospitality_core_room SET active = ? WHERE id = ?', [false, 'archived-room'])
  })

  await e2e.client.login({ login: 'admin', password: 'hospitality-e2e' })

  const propertyList = await e2e.client.get('/admin/hospitality/properties?lang=vi')
  const propertyListHtml = await propertyList.text()
  assert.equal(propertyList.status, 200, propertyListHtml)
  assert.match(propertyListHtml, /Tạo cơ sở/)
  // The rows arrive in the results island, which opens a property on its own page.
  assert.match(propertyListHtml, /data-island="hospitality\.collection-results"/)
  assert.match(propertyListHtml, /&quot;recordPath&quot;:&quot;\/admin\/hospitality\/properties&quot;/)
  const listed = (await e2e.client.call('hospitality_core.searchProperties', {})).value as {
    rows: Array<{ id: string }>
  }
  assert.ok(listed.rows.some((row) => row.id === 'hotel'))
  // No message key reaches the reader as text. The search-filter bar names the
  // functions it calls in its island props, which is data, not a key.
  assert.doesNotMatch(propertyListHtml, /(?:>|placeholder="|aria-label="|title=")[^<"]*hospitality_core\./u)

  const preservedProperty = await e2e.client.post(
    '/admin/hospitality/properties/hotel?lang=en',
    new URLSearchParams({
      ...(await formOf('/admin/hospitality/properties/hotel?lang=en')),
      code: 'HCM',
      name: 'Ket Hotel',
      publicName: 'Ket Hotel Saigon',
      accommodationType: 'hotel',
      starRating: '0',
      timezone: 'Asia/Ho_Chi_Minh',
      defaultCheckIn: '14:00',
      defaultCheckOut: '12:00',
      enforceTimes: '1',
      longStayBillOnCheckIn: '1',
    }),
    {
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      redirect: 'manual',
    },
  )
  assert.equal(preservedProperty.status, 303, await preservedProperty.clone().text())
  assert.match(String(preservedProperty.headers.get('location')), /status=saved/)
  // The form does not carry the address, so saving it keeps the stored one.
  const preserved = (await e2e.client.call('hospitality_core.getProperty', { id: 'hotel' })).value as Row
  assert.deepEqual(
    { street1: preserved.street1, locality: preserved.locality },
    { street1: '123 Nguyễn Huệ', locality: 'Thành phố Hồ Chí Minh' },
  )

  const newProperty = await e2e.client.get('/admin/hospitality/properties/new?lang=en')
  const newPropertyHtml = await newProperty.text()
  assert.equal(newProperty.status, 200, newPropertyHtml)
  assert.match(newPropertyHtml, /Create property/)
  assert.match(newPropertyHtml, /type="time"[^>]*name="defaultCheckIn"[^>]*value="14:00"/)
  assertNoVisibleKey(newPropertyHtml)

  const invalidProperty = await e2e.client.post(
    '/admin/hospitality/properties/new?lang=en',
    new URLSearchParams({
      ...(await formOf('/admin/hospitality/properties/new?lang=en')),
      code: 'TZ-BAD',
      name: 'Invalid timezone property',
      accommodationType: 'hotel',
      starRating: '0',
      timezone: 'Asia/Nowhere',
      defaultCheckIn: '14:00',
      defaultCheckOut: '12:00',
    }),
    { headers: { 'content-type': 'application/x-www-form-urlencoded' } },
  )
  const invalidPropertyHtml = await invalidProperty.text()
  assert.equal(invalidProperty.status, 200, invalidPropertyHtml)
  assert.match(invalidPropertyHtml, /Timezone must be a valid IANA name/)

  const createdProperty = await e2e.client.post(
    '/admin/hospitality/properties/new?lang=vi',
    new URLSearchParams({
      ...(await formOf('/admin/hospitality/properties/new?lang=vi')),
      code: 'DAD',
      name: 'Két Hotel Đà Nẵng',
      publicName: 'Két Riverside',
      accommodationType: 'boutique',
      starRating: '4',
      timezone: 'Asia/Ho_Chi_Minh',
      defaultCheckIn: '15:00',
      defaultCheckOut: '11:00',
      enforceTimes: '1',
      longStayBillOnCheckIn: '1',
      minimumGuestAge: '18',
      description: 'Khách sạn ven sông dành cho chuyến đi thành phố.',
      houseRules: 'Không hút thuốc trong phòng.',
    }),
    {
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      redirect: 'manual',
    },
  )
  assert.equal(createdProperty.status, 303, await createdProperty.clone().text())
  const propertyLocation = createdProperty.headers.get('location') ?? ''
  assert.match(propertyLocation, /^\/admin\/hospitality\/properties\/[^?]+\?status=created&lang=vi$/)
  const propertyDetailPath = propertyLocation.split('?')[0]!
  const createdPropertyId = propertyDetailPath.split('/').at(-1)!
  const createdPropertyPage = await e2e.client.get(propertyLocation)
  const createdPropertyHtml = await createdPropertyPage.text()
  assert.match(createdPropertyHtml, /Đã tạo cơ sở lưu trú/)
  assert.match(createdPropertyHtml, /Két Riverside/)
  assert.match(createdPropertyHtml, /15:00/)
  assertNoVisibleKey(createdPropertyHtml)

  const updatedProperty = await e2e.client.post(
    `${propertyDetailPath}?lang=en`,
    new URLSearchParams({
      ...(await formOf(`${propertyDetailPath}?lang=en`)),
      code: 'DAD',
      name: 'Ket Hotel Da Nang',
      publicName: 'Ket Riverside Hotel',
      accommodationType: 'boutique',
      starRating: '5',
      timezone: 'Asia/Ho_Chi_Minh',
      defaultCheckIn: '15:00',
      defaultCheckOut: '11:00',
      enforceTimes: '1',
      childrenStayFree: '1',
      minimumGuestAge: '18',
      description: 'A riverside city stay.',
      houseRules: 'No smoking in guest rooms.',
    }),
    {
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      redirect: 'manual',
    },
  )
  assert.equal(updatedProperty.status, 303, await updatedProperty.clone().text())
  const updatedPropertyPage = await e2e.client.get(updatedProperty.headers.get('location')!)
  const updatedPropertyHtml = await updatedPropertyPage.text()
  assert.match(updatedPropertyHtml, /Property settings saved/)
  assert.match(updatedPropertyHtml, /Ket Riverside Hotel/)
  assert.match(updatedPropertyHtml, /value="5"/)
  assertNoVisibleKey(updatedPropertyHtml)

  const roomTypeList = await e2e.client.get('/admin/hospitality/room-types?property=hotel&lang=en')
  const roomTypeListHtml = await roomTypeList.text()
  assert.equal(roomTypeList.status, 200, roomTypeListHtml)
  assert.match(roomTypeListHtml, /Add room type/)
  // A room type opens in its record dialog, from the results island.
  assert.match(roomTypeListHtml, /&quot;recordKind&quot;:&quot;hospitality\.roomType&quot;/)
  assert.doesNotMatch(roomTypeListHtml, /(?:>|placeholder="|aria-label="|title=")[^<"]*hospitality_core\./u)

  const newRoomType = await e2e.client.get(
    `/admin/hospitality/room-types/new?property=${encodeURIComponent(createdPropertyId)}&lang=vi`,
  )
  const newRoomTypeHtml = await newRoomType.text()
  assert.equal(newRoomType.status, 200, newRoomTypeHtml)
  assert.match(newRoomTypeHtml, /Tạo loại phòng/)
  assert.match(newRoomTypeHtml, /type="color"[^>]*name="color"[^>]*value="#2563eb"/)
  assertNoVisibleKey(newRoomTypeHtml)

  const invalidRoomType = await e2e.client.post(
    '/admin/hospitality/room-types/new?lang=en',
    new URLSearchParams({
      ...(await formOf('/admin/hospitality/room-types/new?lang=en')),
      propertyId: 'hotel',
      code: 'BAD-RATE',
      name: 'Invalid rate room',
      defaultCapacity: '4',
      maxAdults: '2',
      maxChildren: '1',
      maxInfants: '0',
      maxExtraBeds: '0',
      baseRate: '1',
      viewType: 'space',
      color: 'blue',
    }),
    { headers: { 'content-type': 'application/x-www-form-urlencoded' } },
  )
  const invalidRoomTypeHtml = await invalidRoomType.text()
  assert.equal(invalidRoomType.status, 200, invalidRoomTypeHtml)
  assert.match(invalidRoomTypeHtml, /Default guests cannot exceed/)
  assert.match(invalidRoomTypeHtml, /View type is invalid/)
  assert.match(invalidRoomTypeHtml, /#RRGGBB/)

  const invalidDecimalRoomType = await e2e.client.post(
    '/admin/hospitality/room-types/new?lang=en',
    new URLSearchParams({
      ...(await formOf('/admin/hospitality/room-types/new?lang=en')),
      propertyId: 'hotel',
      code: 'BAD-DECIMAL',
      name: 'Invalid decimal room',
      defaultCapacity: '2',
      maxAdults: '2',
      maxChildren: '0',
      maxInfants: '0',
      maxExtraBeds: '0',
      baseRate: 'invalid',
      color: '#2563eb',
    }),
    { headers: { 'content-type': 'application/x-www-form-urlencoded' } },
  )
  const invalidDecimalRoomTypeHtml = await invalidDecimalRoomType.text()
  assert.equal(invalidDecimalRoomType.status, 200, invalidDecimalRoomTypeHtml)
  assert.match(invalidDecimalRoomTypeHtml, /valid decimal number/)

  const createdRoomType = await e2e.client.post(
    `/admin/hospitality/room-types/new?property=${encodeURIComponent(createdPropertyId)}&lang=vi`,
    new URLSearchParams({
      ...(await formOf(
        `/admin/hospitality/room-types/new?property=${encodeURIComponent(createdPropertyId)}&lang=vi`,
      )),
      propertyId: createdPropertyId,
      code: 'RIVER-DLX',
      name: 'Deluxe ven sông',
      publicName: 'Deluxe River View',
      description: 'Phòng hướng sông với khu vực làm việc riêng.',
      defaultCapacity: '3',
      maxAdults: '2',
      maxChildren: '1',
      maxInfants: '1',
      maxExtraBeds: '1',
      sizeSqm: '31.5',
      viewType: 'river',
      baseRate: '1850000',
      color: '#0f766e',
      published: '1',
    }),
    {
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      redirect: 'manual',
    },
  )
  assert.equal(createdRoomType.status, 303, await createdRoomType.clone().text())
  const roomTypeLocation = createdRoomType.headers.get('location') ?? ''
  assert.match(roomTypeLocation, /^\/admin\/hospitality\/room-types\/[^?]+\?status=created&lang=vi$/)
  const roomTypeDetailPath = roomTypeLocation.split('?')[0]!
  const createdRoomTypePage = await e2e.client.get(roomTypeLocation)
  const createdRoomTypeHtml = await createdRoomTypePage.text()
  assert.match(createdRoomTypeHtml, /Đã tạo loại phòng/)
  assert.match(createdRoomTypeHtml, /Deluxe River View/)
  assert.match(createdRoomTypeHtml, /value="river" selected/)
  assert.match(createdRoomTypeHtml, /type="color"[^>]*value="#0f766e"/)
  assertNoVisibleKey(createdRoomTypeHtml)

  const updatedRoomType = await e2e.client.post(
    `${roomTypeDetailPath}?lang=en`,
    new URLSearchParams({
      ...(await formOf(`${roomTypeDetailPath}?lang=en`)),
      propertyId: createdPropertyId,
      code: 'RIVER-DLX',
      name: 'River Deluxe',
      publicName: 'River Deluxe Suite',
      description: 'An updated river-facing room type.',
      defaultCapacity: '2',
      maxAdults: '2',
      maxChildren: '1',
      maxInfants: '1',
      maxExtraBeds: '1',
      sizeSqm: '32',
      viewType: 'river',
      baseRate: '1950000',
      color: '#115e59',
      published: '1',
    }),
    {
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      redirect: 'manual',
    },
  )
  assert.equal(updatedRoomType.status, 303, await updatedRoomType.clone().text())
  const updatedRoomTypePage = await e2e.client.get(updatedRoomType.headers.get('location')!)
  const updatedRoomTypeHtml = await updatedRoomTypePage.text()
  assert.match(updatedRoomTypeHtml, /Room type saved/)
  assert.match(updatedRoomTypeHtml, /River Deluxe Suite/)
  assert.match(updatedRoomTypeHtml, /value="1950000"/)
  assertNoVisibleKey(updatedRoomTypeHtml)

  const buildingCreated = await e2e.client.post(
    `/admin/hospitality/rooms?property=${encodeURIComponent(createdPropertyId)}&lang=en`,
    new URLSearchParams({
      ...(await formOf(`/admin/hospitality/rooms?property=${encodeURIComponent(createdPropertyId)}&lang=en`)),
      operation: 'save-building',
      propertyId: createdPropertyId,
      code: 'RIVER',
      name: 'River Tower',
      sequence: '10',
    }),
    { headers: { 'content-type': 'application/x-www-form-urlencoded' }, redirect: 'manual' },
  )
  assert.equal(buildingCreated.status, 303, await buildingCreated.clone().text())
  // The room list it returns to is the results island, so the new building is read back directly.
  assert.match(String(buildingCreated.headers.get('location')), /status=building-created/)
  const buildings = (
    await e2e.client.call('hospitality_core.listBuildings', { propertyId: createdPropertyId })
  ).value as Row[]
  const buildingId = buildings.find((row) => row.name === 'River Tower')?.id as string | undefined
  assert.ok(buildingId)

  const floorCreated = await e2e.client.post(
    `/admin/hospitality/rooms?property=${encodeURIComponent(createdPropertyId)}&lang=vi`,
    new URLSearchParams({
      ...(await formOf(`/admin/hospitality/rooms?property=${encodeURIComponent(createdPropertyId)}&lang=vi`)),
      operation: 'save-floor',
      propertyId: createdPropertyId,
      buildingId,
      code: '01',
      name: 'Tầng sông',
      sequence: '1',
    }),
    { headers: { 'content-type': 'application/x-www-form-urlencoded' }, redirect: 'manual' },
  )
  assert.equal(floorCreated.status, 303, await floorCreated.clone().text())
  assert.match(String(floorCreated.headers.get('location')), /status=floor-created/)
  const floors = (
    await e2e.client.call('hospitality_core.listFloors', { propertyId: createdPropertyId, buildingId })
  ).value as Row[]
  const riverFloorId = floors.find((row) => row.name === 'Tầng sông')?.id as string | undefined
  assert.ok(riverFloorId)
  const floorDetailPath = `/admin/hospitality/levels/${encodeURIComponent(riverFloorId)}`

  const buildingDetailPage = await e2e.client.get(`/admin/hospitality/buildings/${buildingId}?lang=en`)
  const buildingDetailHtml = await buildingDetailPage.text()
  assert.equal(buildingDetailPage.status, 200, buildingDetailHtml)
  assert.match(buildingDetailHtml, /Archive building/)
  assert.match(buildingDetailHtml, /River Tower/)
  assert.doesNotMatch(
    buildingDetailHtml,
    /Building record|data-ui="record-thumbnail"|data-ui="record-kicker"/,
  )
  assert.match(buildingDetailHtml, /data-ui="form-page-context"[\s\S]*?data-ui="breadcrumbs"/)
  assertNoVisibleKey(buildingDetailHtml)

  const buildingUpdated = await e2e.client.post(
    `/admin/hospitality/buildings/${buildingId}?lang=en`,
    new URLSearchParams({
      ...(await formOf(`/admin/hospitality/buildings/${buildingId}?lang=en`)),
      propertyId: createdPropertyId,
      code: 'RIVER',
      name: 'River Wing',
      sequence: '12',
    }),
    { headers: { 'content-type': 'application/x-www-form-urlencoded' }, redirect: 'manual' },
  )
  assert.equal(buildingUpdated.status, 303, await buildingUpdated.clone().text())
  const buildingUpdatedHtml = await (await e2e.client.get(buildingUpdated.headers.get('location')!)).text()
  assert.match(buildingUpdatedHtml, /Building saved/)
  assert.match(buildingUpdatedHtml, /River Wing/)

  const floorDetailPage = await e2e.client.get(`${floorDetailPath}?lang=vi`)
  const floorDetailHtml = await floorDetailPage.text()
  assert.equal(floorDetailPage.status, 200, floorDetailHtml)
  assert.match(floorDetailHtml, /Lưu trữ tầng/)
  assert.match(floorDetailHtml, /River Wing/)
  assert.doesNotMatch(
    floorDetailHtml,
    /Hồ sơ tầng|data-ui="record-thumbnail"|data-ui="record-kicker"|hospitality_core\./,
  )
  assert.match(floorDetailHtml, /data-ui="form-page-context"[\s\S]*?data-ui="breadcrumbs"/)

  const floorUpdated = await e2e.client.post(
    `${floorDetailPath}?lang=vi`,
    new URLSearchParams({
      ...(await formOf(`${floorDetailPath}?lang=vi`)),
      propertyId: createdPropertyId,
      buildingId,
      code: '01',
      name: 'Tầng ven sông',
      sequence: '2',
    }),
    { headers: { 'content-type': 'application/x-www-form-urlencoded' }, redirect: 'manual' },
  )
  assert.equal(floorUpdated.status, 303, await floorUpdated.clone().text())
  const floorUpdatedHtml = await (await e2e.client.get(floorUpdated.headers.get('location')!)).text()
  assert.match(floorUpdatedHtml, /Đã lưu tầng/)
  assert.match(floorUpdatedHtml, /Tầng ven sông/)

  const blockedBuildingArchive = await e2e.client.post(
    `/admin/hospitality/buildings/${buildingId}/archive?lang=vi`,
    new URLSearchParams({
      ...(await hiddenOf(`/admin/hospitality/buildings/${buildingId}?lang=vi`, '/archive')),
      action: 'archive',
    }),
    { headers: { 'content-type': 'application/x-www-form-urlencoded' } },
  )
  const blockedBuildingArchiveHtml = await blockedBuildingArchive.text()
  assert.equal(blockedBuildingArchive.status, 200, blockedBuildingArchiveHtml)
  assert.match(blockedBuildingArchiveHtml, /vẫn còn tầng hoạt động/)

  const floorArchived = await e2e.client.post(
    `${floorDetailPath}/archive?lang=en`,
    new URLSearchParams({
      ...(await hiddenOf(`${floorDetailPath}?lang=en`, '/archive')),
      action: 'archive',
    }),
    { headers: { 'content-type': 'application/x-www-form-urlencoded' }, redirect: 'manual' },
  )
  assert.equal(floorArchived.status, 303, await floorArchived.clone().text())
  const buildingArchived = await e2e.client.post(
    `/admin/hospitality/buildings/${buildingId}/archive?lang=en`,
    new URLSearchParams({
      ...(await hiddenOf(`/admin/hospitality/buildings/${buildingId}?lang=en`, '/archive')),
      action: 'archive',
    }),
    { headers: { 'content-type': 'application/x-www-form-urlencoded' }, redirect: 'manual' },
  )
  assert.equal(buildingArchived.status, 303, await buildingArchived.clone().text())

  const blockedFloorRestore = await e2e.client.post(
    `${floorDetailPath}/archive?lang=en`,
    new URLSearchParams({
      ...(await hiddenOf(`${floorDetailPath}?lang=en`, '/archive')),
      action: 'restore',
    }),
    { headers: { 'content-type': 'application/x-www-form-urlencoded' } },
  )
  const blockedFloorRestoreHtml = await blockedFloorRestore.text()
  assert.equal(blockedFloorRestore.status, 200, blockedFloorRestoreHtml)
  assert.match(blockedFloorRestoreHtml, /location is archived/)

  const buildingRestored = await e2e.client.post(
    `/admin/hospitality/buildings/${buildingId}/archive?lang=en`,
    new URLSearchParams({
      ...(await hiddenOf(`/admin/hospitality/buildings/${buildingId}?lang=en`, '/archive')),
      action: 'restore',
    }),
    { headers: { 'content-type': 'application/x-www-form-urlencoded' }, redirect: 'manual' },
  )
  assert.equal(buildingRestored.status, 303, await buildingRestored.clone().text())
  const floorRestored = await e2e.client.post(
    `${floorDetailPath}/archive?lang=en`,
    new URLSearchParams({
      ...(await hiddenOf(`${floorDetailPath}?lang=en`, '/archive')),
      action: 'restore',
    }),
    { headers: { 'content-type': 'application/x-www-form-urlencoded' }, redirect: 'manual' },
  )
  assert.equal(floorRestored.status, 303, await floorRestored.clone().text())

  const newRoom = await e2e.client.get(
    `/admin/hospitality/rooms/new?property=${encodeURIComponent(createdPropertyId)}&lang=vi`,
  )
  const newRoomHtml = await newRoom.text()
  assert.equal(newRoom.status, 200, newRoomHtml)
  assert.match(newRoomHtml, /Tạo phòng vật lý/)
  assert.doesNotMatch(newRoomHtml, /name="status"/)
  const floorId = newRoomHtml.match(/<select[^>]*name="floorId"[^>]*>[\s\S]*?<option value="([^"]+)"/)?.[1]
  assert.ok(floorId)

  const createdRoomTypeId = roomTypeDetailPath.split('/').at(-1)!
  const physicalRoomCreated = await e2e.client.post(
    `/admin/hospitality/rooms/new?property=${encodeURIComponent(createdPropertyId)}&lang=vi`,
    new URLSearchParams({
      ...(await formOf(
        `/admin/hospitality/rooms/new?property=${encodeURIComponent(createdPropertyId)}&lang=vi`,
      )),
      propertyId: createdPropertyId,
      roomTypeId: createdRoomTypeId,
      buildingId,
      floorId,
      code: 'R101',
      name: 'Phòng ven sông 101',
      capacity: '3',
    }),
    { headers: { 'content-type': 'application/x-www-form-urlencoded' }, redirect: 'manual' },
  )
  assert.equal(physicalRoomCreated.status, 303, await physicalRoomCreated.clone().text())
  const roomLocation = physicalRoomCreated.headers.get('location') ?? ''
  assert.match(roomLocation, /^\/admin\/hospitality\/rooms\/[^?]+\?status=created&lang=vi$/)
  const roomDetailPath = roomLocation.split('?')[0]!
  const physicalRoomPage = await e2e.client.get(roomLocation)
  const physicalRoomHtml = await physicalRoomPage.text()
  assert.match(physicalRoomHtml, /Đã tạo phòng vật lý/)
  assert.match(physicalRoomHtml, /Phòng ven sông 101/)
  assert.match(physicalRoomHtml, /River Wing · Tầng ven sông/)
  assert.doesNotMatch(physicalRoomHtml, /name="status"/)
  assertNoVisibleKey(physicalRoomHtml)

  const blockedFloorWithRoom = await e2e.client.post(
    `${floorDetailPath}/archive?lang=en`,
    new URLSearchParams({
      ...(await hiddenOf(`${floorDetailPath}?lang=en`, '/archive')),
      action: 'archive',
    }),
    { headers: { 'content-type': 'application/x-www-form-urlencoded' } },
  )
  const blockedFloorWithRoomHtml = await blockedFloorWithRoom.text()
  assert.equal(blockedFloorWithRoom.status, 200, blockedFloorWithRoomHtml)
  assert.match(blockedFloorWithRoomHtml, /still has active rooms/)

  const physicalRoomUpdated = await e2e.client.post(
    `${roomDetailPath}?lang=en`,
    new URLSearchParams({
      ...(await formOf(`${roomDetailPath}?lang=en`)),
      propertyId: createdPropertyId,
      roomTypeId: createdRoomTypeId,
      buildingId,
      floorId,
      code: 'R101',
      name: 'River Room 101',
      // No more than the room type's two adults and one child.
      capacity: '3',
    }),
    { headers: { 'content-type': 'application/x-www-form-urlencoded' }, redirect: 'manual' },
  )
  assert.equal(physicalRoomUpdated.status, 303, await physicalRoomUpdated.clone().text())
  const physicalRoomUpdatedPage = await e2e.client.get(physicalRoomUpdated.headers.get('location')!)
  const physicalRoomUpdatedHtml = await physicalRoomUpdatedPage.text()
  assert.match(physicalRoomUpdatedHtml, /Room settings saved/)
  assert.match(physicalRoomUpdatedHtml, /River Room 101/)
  assert.match(physicalRoomUpdatedHtml, /name="capacity"[^>]*value="3"|value="3"[^>]*name="capacity"/)
  assertNoVisibleKey(physicalRoomUpdatedHtml)

  const physicalRoomArchived = await e2e.client.post(
    `${roomDetailPath}/archive?lang=vi`,
    new URLSearchParams({
      ...(await hiddenOf(`${roomDetailPath}?lang=vi`, '/archive')),
      action: 'archive',
    }),
    { headers: { 'content-type': 'application/x-www-form-urlencoded' }, redirect: 'manual' },
  )
  assert.equal(physicalRoomArchived.status, 303, await physicalRoomArchived.clone().text())
  const physicalRoomArchivedPage = await e2e.client.get(physicalRoomArchived.headers.get('location')!)
  const physicalRoomArchivedHtml = await physicalRoomArchivedPage.text()
  assert.match(physicalRoomArchivedHtml, /Đã lưu trữ phòng/)
  assert.match(physicalRoomArchivedHtml, /Khôi phục phòng/)
  assertNoVisibleKey(physicalRoomArchivedHtml)

  const physicalRoomRestored = await e2e.client.post(
    `${roomDetailPath}/archive?lang=en`,
    new URLSearchParams({
      ...(await hiddenOf(`${roomDetailPath}?lang=en`, '/archive')),
      action: 'restore',
    }),
    { headers: { 'content-type': 'application/x-www-form-urlencoded' }, redirect: 'manual' },
  )
  assert.equal(physicalRoomRestored.status, 303, await physicalRoomRestored.clone().text())
  const physicalRoomRestoredHtml = await (
    await e2e.client.get(physicalRoomRestored.headers.get('location')!)
  ).text()
  assert.match(physicalRoomRestoredHtml, /Room restored/)
  assert.match(physicalRoomRestoredHtml, /Archive room/)
  assertNoVisibleKey(physicalRoomRestoredHtml)

  // The desk sells only an open property: it has a rate, its rooms are clean, and it is opened.
  await seed('hospitality_core.saveRatePlan', {
    id: 'hotel-rate',
    propertyId: 'hotel',
    roomTypeId: 'deluxe',
    code: 'BAR',
    name: 'Best rate',
    rateType: 'nightly',
    amount: '100',
  })
  for (const id of ['101', '102', '103', '104']) {
    const room = (await seed('hospitality_core.getRoom', { id })).value as Row
    await seed('hospitality_core.completeRoomCleaning', {
      roomId: id,
      expectedVersion: room.version,
      requestKey: `e2e-clean-${id}`,
    })
  }
  const hotel = (await seed('hospitality_core.getProperty', { id: 'hotel' })).value as Row
  const opened = await seed('hospitality_core.setPropertyLifecycle', {
    propertyId: 'hotel',
    lifecycle: 'active',
    expectedVersion: hotel.version,
    requestKey: 'e2e-open-hotel',
  })
  assert.equal((opened.value as Row).ok, true, JSON.stringify(opened.value))

  const directQuote = await e2e.client.post(
    '/admin/hospitality/reservations',
    new URLSearchParams({
      ...(await formOf('/admin/hospitality/reservations')),
      operation: 'quote',
      lang: 'vi',
      property: 'hotel',
      id: 'direct-web',
      code: 'WEB-001',
      partnerId: 'guest',
      roomTypeId: 'deluxe',
      bookingType: 'nightly',
      checkIn: '2026-08-22T14:00',
      checkOut: '2026-08-23T12:00',
      adults: '2',
      children: '0',
    }),
    { headers: { 'content-type': 'application/x-www-form-urlencoded' }, redirect: 'manual' },
  )
  assert.equal(directQuote.status, 303, await directQuote.clone().text())
  assert.match(directQuote.headers.get('location') ?? '', /status=quoted/)
  const quotePage = await e2e.client.get(directQuote.headers.get('location')!)
  const quoteHtml = await quotePage.text()
  assert.equal(quotePage.status, 200)
  assert.match(quoteHtml, /Báo giá sẵn sàng/)
  assert.match(quoteHtml, /100/)
  // A desk booking is a page of its own, not a dialog over the reservation list.
  assert.match(quoteHtml, /data-island="hospitality\.desk-booking-page"/)
  assertNoVisibleKey(quoteHtml)

  const impossibleLocalDate = await e2e.client.post(
    '/admin/hospitality/reservations',
    new URLSearchParams({
      ...(await formOf('/admin/hospitality/reservations')),
      operation: 'quote',
      lang: 'vi',
      property: 'hotel',
      id: 'invalid-local-date',
      partnerId: 'guest',
      roomTypeId: 'deluxe',
      bookingType: 'nightly',
      checkIn: '2026-02-31T14:00',
      checkOut: '2026-03-04T12:00',
      adults: '1',
      children: '0',
    }),
    { headers: { 'content-type': 'application/x-www-form-urlencoded' }, redirect: 'manual' },
  )
  assert.equal(impossibleLocalDate.status, 303, await impossibleLocalDate.clone().text())
  assert.match(impossibleLocalDate.headers.get('location') ?? '', /status=invalid/)

  const confirmDirect = () =>
    e2e.client.post(
      '/admin/hospitality/reservations',
      new URLSearchParams({
        operation: 'create',
        lang: 'vi',
        property: 'hotel',
        id: 'direct-web',
        code: 'WEB-001',
        partnerId: 'guest',
        roomTypeId: 'deluxe',
        bookingType: 'nightly',
        checkIn: '2026-08-22T14:00',
        checkOut: '2026-08-23T12:00',
        adults: '2',
        children: '0',
        rate: '100',
      }),
      { headers: { 'content-type': 'application/x-www-form-urlencoded' }, redirect: 'manual' },
    )
  const directCreated = await confirmDirect()
  assert.equal(directCreated.status, 303, await directCreated.clone().text())
  assert.match(directCreated.headers.get('location') ?? '', /status=saved/)
  const directRetried = await confirmDirect()
  assert.equal(directRetried.status, 303, await directRetried.clone().text())
  await e2e.fixture.withTenant('', async ({ adapter }) => {
    const count = await adapter.all(
      `SELECT COUNT(*) AS n FROM hospitality_core_reservation WHERE id = 'direct-web'`,
    )
    assert.equal(Number(count[0]?.n), 1, 'a retried confirmation keeps the same reservation')
  })
  const directDetailVi = await e2e.client.get('/admin/hospitality/reservations/direct-web?lang=vi')
  assert.equal(directDetailVi.status, 200)
  const directDetailViHtml = await directDetailVi.text()
  assert.match(directDetailViHtml, /WEB-001/)
  assert.match(directDetailViHtml, /Cập nhật đặt phòng/)
  assert.match(directDetailViHtml, /Nhận phòng/)
  assertNoVisibleKey(directDetailViHtml)
  const directDetailEn = await e2e.client.get('/admin/hospitality/reservations/direct-web?lang=en')
  assert.equal(directDetailEn.status, 200)
  const directDetailEnHtml = await directDetailEn.text()
  assert.match(directDetailEnHtml, /Check in/)
  assert.match(directDetailEnHtml, /Update reservation/)
  assert.match(directDetailEnHtml, /Cancel reservation/)
  assertNoVisibleKey(directDetailEnHtml)
  const directAmended = await e2e.client.post(
    '/admin/hospitality/reservations/direct-web?lang=vi',
    new URLSearchParams({
      ...(await reservationState('direct-web')),
      operation: 'amend',
      lang: 'vi',
      partnerId: 'guest',
      roomTypeId: 'deluxe',
      checkIn: '2026-08-23T14:00',
      checkOut: '2026-08-25T12:00',
      adults: '2',
      children: '0',
      rate: '120',
    }),
    { headers: { 'content-type': 'application/x-www-form-urlencoded' }, redirect: 'manual' },
  )
  assert.equal(directAmended.status, 303, await directAmended.clone().text())
  assert.match(directAmended.headers.get('location') ?? '', /status=amended/)
  const amendedPage = await e2e.client.get(directAmended.headers.get('location')!)
  const amendedHtml = await amendedPage.text()
  assert.match(amendedHtml, /Đã cập nhật đặt phòng/)
  assert.match(amendedHtml, /240/)
  assertNoVisibleKey(amendedHtml)
  await e2e.fixture.withTenant('', async ({ adapter }) => {
    await adapter.exec(`UPDATE hospitality_core_reservation SET provider = 'booking' WHERE id = 'direct-web'`)
  })
  // A channel's booking follows the channel: the desk cannot amend what it sold.
  const externalAmend = await e2e.client.post(
    '/admin/hospitality/reservations/direct-web?lang=en',
    new URLSearchParams({
      ...(await reservationState('direct-web')),
      operation: 'amend',
      lang: 'en',
      partnerId: 'guest',
      roomTypeId: 'deluxe',
      checkIn: '2026-08-23T14:00',
      checkOut: '2026-08-25T12:00',
      adults: '2',
      children: '0',
      rate: '130',
    }),
    { headers: { 'content-type': 'application/x-www-form-urlencoded' }, redirect: 'manual' },
  )
  const externalAmendHtml = await externalAmend.text()
  assert.match(externalAmendHtml, /OTA reservations follow channel revisions/)
  assertNoVisibleKey(externalAmendHtml)
  const directCancelled = await e2e.client.post(
    '/admin/hospitality/reservations/direct-web?lang=vi',
    new URLSearchParams({
      ...(await reservationState('direct-web')),
      operation: 'cancel',
      lang: 'vi',
      reason: 'Khách đổi lịch',
    }),
    { headers: { 'content-type': 'application/x-www-form-urlencoded' }, redirect: 'manual' },
  )
  assert.equal(directCancelled.status, 303, await directCancelled.clone().text())
  assert.match(directCancelled.headers.get('location') ?? '', /status=cancelled/)
  const cancelledPage = await e2e.client.get(directCancelled.headers.get('location')!)
  const cancelledHtml = await cancelledPage.text()
  assert.match(cancelledHtml, /Đã hủy đặt phòng/)
  assert.match(cancelledHtml, /Khách đổi lịch/)

  const noShowCreated = await e2e.client.call<Row>('hospitality_core.createReservation', {
    id: 'no-show-web',
    code: 'WEB-NOSHOW',
    propertyId: 'hotel',
    roomTypeId: 'deluxe',
    partnerId: 'guest',
    bookingType: 'nightly',
    // Due at noon, so by early afternoon the desk can record that the guest never came.
    checkIn: '2026-08-20T05:00:00.000Z',
    checkOut: '2026-08-21T05:00:00.000Z',
    rate: '100',
  })
  assert.equal(noShowCreated.value.ok, true)
  const noShowDetailEn = await e2e.client.get('/admin/hospitality/reservations/no-show-web?lang=en')
  const noShowDetailEnHtml = await noShowDetailEn.text()
  assert.match(noShowDetailEnHtml, /Mark guest as no-show/)
  assert.match(noShowDetailEnHtml, /No-show note/)
  assertNoVisibleKey(noShowDetailEnHtml)
  const noShowMarked = await e2e.client.post(
    '/admin/hospitality/reservations/no-show-web?lang=vi',
    new URLSearchParams({
      ...(await reservationState('no-show-web')),
      operation: 'no-show',
      lang: 'vi',
      reason: 'Không liên lạc được với khách',
    }),
    { headers: { 'content-type': 'application/x-www-form-urlencoded' }, redirect: 'manual' },
  )
  assert.equal(noShowMarked.status, 303, await noShowMarked.clone().text())
  assert.match(noShowMarked.headers.get('location') ?? '', /status=no-show/)
  const noShowPage = await e2e.client.get(noShowMarked.headers.get('location')!)
  const noShowHtml = await noShowPage.text()
  assert.match(noShowHtml, /Đã ghi nhận khách không đến/)
  assert.match(noShowHtml, /Khách không đến/)
  assertNoVisibleKey(noShowHtml)

  // A marketing image is large enough to crop: its short edge is at least 1024 px.
  const contentImage = await sharp({
    create: { width: 1024, height: 1024, channels: 3, background: '#aaccee' },
  })
    .png()
    .toBuffer()
  const uploadTarget = (await e2e.client.call('hospitality_core.getProperty', { id: 'hotel' })).value as Row
  const contentUpload = new FormData()
  // The command fields come before the file, so the upload is refused before its body is read.
  contentUpload.set('expectedPropertyVersion', String(uploadTarget.version))
  contentUpload.set('requestKey', 'e2e-content-upload')
  contentUpload.set('category', 'exterior')
  contentUpload.set('file', new File([new Uint8Array(contentImage)], 'hotel-e2e.png', { type: 'image/png' }))
  const uploaded = await e2e.client.post(
    '/admin/hospitality/content/upload?lang=en&property=hotel&target=property',
    contentUpload,
    { redirect: 'manual' },
  )
  assert.equal(uploaded.status, 303, await uploaded.clone().text())
  assert.match(uploaded.headers.get('location') ?? '', /status=saved/)
  const contentMedia = await e2e.client.call<Row[]>('hospitality_core.listContentImages', {
    propertyId: 'hotel',
  })
  assert.equal(contentMedia.value.length, 1)
  assert.equal(contentMedia.value[0]!.primary, true)
  const downloaded = await e2e.client.get(`/files/${contentMedia.value[0]!.attachmentId}`)
  assert.equal(downloaded.status, 200)
  assert.equal(downloaded.headers.get('content-type'), 'image/png')
  // Read from the database rather than from the call's write log, which a real call does not return.
  const roomNight = () =>
    e2e.fixture.withTenant('', async ({ adapter }) => ({
      sold: Number(
        (
          await adapter.all(
            'SELECT sold FROM hospitality_core_availability_ledger WHERE "propertyId" = ? AND "roomTypeId" = ? AND "date" = ?',
            ['hotel', 'deluxe', '2026-08-20'],
          )
        )[0]?.sold ?? 0,
      ),
      changes: Number(
        (
          await adapter.all(
            'SELECT COUNT(*) AS n FROM hospitality_core_inventory_change WHERE "propertyId" = ?',
            ['hotel'],
          )
        )[0]?.n ?? 0,
      ),
    }))
  const before = await roomNight()
  const booked = await e2e.client.call<Row>(
    'hospitality_core.createReservation',
    {
      id: 'booking-1',
      propertyId: 'hotel',
      roomTypeId: 'deluxe',
      partnerId: 'guest',
      bookingType: 'nightly',
      checkIn: '2026-08-20T14:00:00.000Z',
      checkOut: '2026-08-21T12:00:00.000Z',
      rate: '100',
      createdAt: '2026-08-20T01:00:00.000Z',
    },
    { idempotencyKey: 'hospitality-booking-1' },
  )
  assert.equal(booked.value.ok, true)
  // The booking, its stay and folio, its room-night inventory and the change signal commit in the one call.
  const after = await roomNight()
  assert.equal(after.sold, before.sold + 1, 'room-night inventory')
  assert.ok(after.changes > before.changes, 'inventory change signal')
  await e2e.fixture.withTenant('', async ({ adapter }) => {
    assert.equal(
      (await adapter.all('SELECT id FROM hospitality_core_reservation WHERE id = ?', ['booking-1'])).length,
      1,
    )
    const stays = await adapter.all('SELECT "folioId" FROM hospitality_core_stay WHERE "reservationId" = ?', [
      'booking-1',
    ])
    assert.equal(stays.length, 1, 'stay')
    assert.equal(
      (await adapter.all('SELECT id FROM hospitality_core_folio WHERE id = ?', [stays[0]!.folioId])).length,
      1,
      'folio',
    )
  })
  // A booked stay is worked from its reservation's workspace.
  const stayIntake = await e2e.client.get('/admin/hospitality/stays/booking-1%3Astay?lang=vi', {
    redirect: 'manual',
  })
  assert.equal(stayIntake.status, 303)
  assert.match(stayIntake.headers.get('location') ?? '', /^\/admin\/hospitality\/reservations\/booking-1\?/)
  const guestDocument = await e2e.client.post(
    '/admin/hospitality/stays/booking-1%3Astay?lang=vi',
    new URLSearchParams({
      ...(await formOf('/admin/hospitality/stays/booking-1%3Astay?lang=vi')),
      operation: 'save-document',
      lang: 'vi',
      documentId: 'booking-1-document',
      partnerId: 'guest',
      type: 'cccd',
      number: '079203001234',
      fullName: 'Nguyễn An',
      dateOfBirth: '1990-05-12',
      // An arrival declaration names every field the stay notice needs.
      gender: 'other',
      nationality: 'VN',
      permanentAddress: '12 Đường Riêng Tư',
    }),
    { headers: { 'content-type': 'application/x-www-form-urlencoded' }, redirect: 'manual' },
  )
  assert.equal(guestDocument.status, 303, await guestDocument.clone().text())
  assert.match(guestDocument.headers.get('location') ?? '', /status=document-saved/)
  // What a reader is given of the document is its last four digits, never the number or address.
  const documents = (
    await e2e.client.call('hospitality_core.listGuestDocuments', { stayId: 'booking-1:stay' })
  ).value as Row[]
  assert.deepEqual(
    documents.map((document) => document.numberLast4),
    ['1234'],
  )
  assert.doesNotMatch(JSON.stringify(documents), /079203001234|12 Đường Riêng Tư/)

  const rateSaved = await e2e.client.post(
    '/admin/hospitality/rate-plans?lang=vi',
    new URLSearchParams({
      ...(await formOf('/admin/hospitality/rate-plans?lang=vi')),
      operation: 'save-rate-plan',
      propertyId: 'hotel',
      roomTypeId: 'deluxe',
      code: 'WEB-FLEX',
      name: 'Giá trực tiếp',
      rateType: 'nightly',
      amount: '120',
      minStay: '0',
      maxStay: '0',
      active: '1',
    }),
    { headers: { 'content-type': 'application/x-www-form-urlencoded' }, redirect: 'manual' },
  )
  assert.equal(rateSaved.status, 303, await rateSaved.clone().text())
  assert.match(rateSaved.headers.get('location') ?? '', /status=saved/)
  const inventorySaved = await e2e.client.post(
    '/admin/hospitality/inventory?lang=vi',
    new URLSearchParams({
      ...(await propertyState('hotel')),
      operation: 'change-rules',
      propertyId: 'hotel',
      roomTypeId: 'deluxe',
      from: '2026-08-20',
      to: '2026-08-20',
      ...everyWeekday,
      total: '1',
    }),
    { headers: { 'content-type': 'application/x-www-form-urlencoded' }, redirect: 'manual' },
  )
  assert.equal(inventorySaved.status, 303, await inventorySaved.clone().text())
  assert.match(inventorySaved.headers.get('location') ?? '', /status=saved/)
  const inventoryRejected = await e2e.client.post(
    '/admin/hospitality/inventory?lang=vi',
    new URLSearchParams({
      ...(await propertyState('hotel')),
      operation: 'change-rules',
      propertyId: 'hotel',
      roomTypeId: 'deluxe',
      from: '2026-08-20',
      to: '2026-08-20',
      ...everyWeekday,
      total: '0',
    }),
    { headers: { 'content-type': 'application/x-www-form-urlencoded' }, redirect: 'manual' },
  )
  // The night is already sold, so it cannot be taken back to nothing; the workbench says so in place.
  assert.equal(inventoryRejected.status, 200, await inventoryRejected.clone().text())
  const keptNight = (
    await e2e.client.call('hospitality_core.listInventory', {
      propertyId: 'hotel',
      roomTypeId: 'deluxe',
      from: '2026-08-20',
      to: '2026-08-20',
    })
  ).value as Row[]
  assert.equal(Number(keptNight[0]?.total), 1)

  const feeSaved = await e2e.client.post(
    '/admin/hospitality/services?lang=vi&property=hotel',
    new URLSearchParams({
      ...(await formOf('/admin/hospitality/services?lang=vi&property=hotel')),
      operation: 'save-property-charge',
      id: 'city-tax',
      propertyId: 'hotel',
      chargeType: 'city_tax',
      name: 'Thuế thành phố',
      amount: '20',
      active: '1',
    }),
    { headers: { 'content-type': 'application/x-www-form-urlencoded' }, redirect: 'manual' },
  )
  assert.equal(feeSaved.status, 303, await feeSaved.clone().text())
  assert.match(feeSaved.headers.get('location') ?? '', /status=saved/)
  const extraSaved = await e2e.client.post(
    '/admin/hospitality/services?lang=vi&property=hotel',
    new URLSearchParams({
      ...(await formOf('/admin/hospitality/services?lang=vi&property=hotel')),
      operation: 'save-extra-line',
      id: 'breakfast-extra',
      target: 'reservation:booking-1',
      productId: 'breakfast',
      quantity: '1',
      recurrence: 'once',
      active: '1',
    }),
    { headers: { 'content-type': 'application/x-www-form-urlencoded' }, redirect: 'manual' },
  )
  assert.equal(extraSaved.status, 303, await extraSaved.clone().text())
  assert.match(extraSaved.headers.get('location') ?? '', /status=saved/)
  const extraPosted = await e2e.client.post(
    '/admin/hospitality/services?lang=vi&property=hotel',
    new URLSearchParams({
      ...(await formOf('/admin/hospitality/services?lang=vi&property=hotel')),
      operation: 'materialize-extra',
      id: 'breakfast-extra',
      requestKey: 'e2e-breakfast',
    }),
    { headers: { 'content-type': 'application/x-www-form-urlencoded' }, redirect: 'manual' },
  )
  assert.equal(extraPosted.status, 303, await extraPosted.clone().text())
  assert.match(extraPosted.headers.get('location') ?? '', /status=saved/)

  // The guest arrives that evening, after the booked check-in time.
  t.mock.timers.setTime(Date.parse('2026-08-20T14:05:00.000Z'))
  // With billing installed, a booking arrives only once it is guaranteed.
  const guaranteed = await e2e.client.call<Row>('hospitality_billing.setReservationGuarantee', {
    reservationId: 'booking-1',
    kind: 'card',
    amount: '100',
    reference: 'authorization:e2e-booking-1',
    expectedVersion: Number((await reservationState('booking-1')).expectedVersion),
    requestKey: 'e2e-guarantee-booking-1',
  })
  assert.equal(guaranteed.value.ok, true, JSON.stringify(guaranteed.value))
  const checkedIn = await e2e.client.post(
    '/admin/hospitality/reservations/booking-1?lang=vi',
    new URLSearchParams({
      ...(await stayState('booking-1:stay')),
      operation: 'check-in',
      lang: 'vi',
      roomId: '101',
    }),
    { headers: { 'content-type': 'application/x-www-form-urlencoded' }, redirect: 'manual' },
  )
  assert.equal(checkedIn.status, 303, await checkedIn.clone().text())
  assert.match(checkedIn.headers.get('location') ?? '', /status=checked-in/)
  const checkedInPage = await e2e.client.get(checkedIn.headers.get('location')!)
  const checkedInHtml = await checkedInPage.text()
  assert.match(checkedInHtml, /Đã nhận phòng/)
  assert.match(checkedInHtml, /Trả phòng/)
  assert.match(checkedInHtml, /Điều chỉnh ngày trả phòng/)
  assertNoVisibleKey(checkedInHtml)

  // The field is a datetime-local, read in the property's timezone. Building it
  // from toISOString() spells the instant in UTC, so once UTC and Ho Chi Minh
  // City fall on different dates — every day from 17:00 UTC — "tomorrow" arrived
  // as tomorrow-in-UTC, which is still today where the property is. The stay then
  // had no night left to release and the early checkout stopped being early.
  const adjustedCheckOut = new Date(Date.now() + 24 * 60 * 60 * 1000)
    .toLocaleString('sv-SE', { timeZone: 'Asia/Ho_Chi_Minh' })
    .slice(0, 16)
    .replace(' ', 'T')
  const departureAdjusted = await e2e.client.post(
    '/admin/hospitality/reservations/booking-1?lang=vi',
    new URLSearchParams({
      ...(await stayState('booking-1:stay')),
      operation: 'adjust-departure',
      lang: 'vi',
      checkOut: adjustedCheckOut,
    }),
    { headers: { 'content-type': 'application/x-www-form-urlencoded' }, redirect: 'manual' },
  )
  assert.equal(departureAdjusted.status, 303, await departureAdjusted.clone().text())
  assert.match(departureAdjusted.headers.get('location') ?? '', /status=departure-adjusted/)
  const departurePage = await e2e.client.get(departureAdjusted.headers.get('location')!)
  const departureHtml = await departurePage.text()
  assert.match(departureHtml, /Đã cập nhật ngày trả phòng/)
  const adjustedStay = (await e2e.client.call('hospitality_core.getStay', { id: 'booking-1:stay' }))
    .value as Row
  assert.equal(
    new Date(String(adjustedStay.checkOut))
      .toLocaleString('sv-SE', { timeZone: 'Asia/Ho_Chi_Minh' })
      .slice(0, 16)
      .replace(' ', 'T'),
    adjustedCheckOut,
  )
  assertNoVisibleKey(departureHtml)
  const departurePageEn = await e2e.client.get('/admin/hospitality/reservations/booking-1?lang=en')
  const departureHtmlEn = await departurePageEn.text()
  assert.match(departureHtmlEn, /Adjust departure/)
  assertNoVisibleKey(departureHtmlEn)

  // The stay itself is worked from the reservation's workspace.
  const stayDetailEn = await e2e.client.get('/admin/hospitality/stays/booking-1%3Astay?lang=en', {
    redirect: 'manual',
  })
  assert.equal(stayDetailEn.status, 303)
  assert.match(stayDetailEn.headers.get('location') ?? '', /^\/admin\/hospitality\/reservations\/booking-1\?/)
  // A guest who joins is declared on the reservation page, where the document and the
  // room's capacity are checked; the stay page no longer takes a bare name.
  const guestRefused = await e2e.client.post(
    '/admin/hospitality/stays/booking-1%3Astay?lang=vi',
    new URLSearchParams({
      operation: 'add-guest',
      lang: 'vi',
      displayName: 'Trần Bình',
      partnerId: 'companion',
    }),
    { headers: { 'content-type': 'application/x-www-form-urlencoded' }, redirect: 'manual' },
  )
  assert.match(await guestRefused.text(), /Dùng Thêm khách lưu trú trên trang đặt phòng/)
  const companion = await e2e.client.call<Row>('hospitality_core.addInHouseGuest', {
    stayId: 'booking-1:stay',
    guest: {
      partnerId: 'companion',
      fullName: 'Trần Bình',
      type: 'passport',
      number: 'P1234567',
      birth: '1988-04-20',
      gender: 'other',
      nationality: 'VN',
    },
    expectedVersion: Number((await stayState('booking-1:stay')).expectedVersion),
    expectedReservationVersion: Number((await reservationState('booking-1')).expectedVersion),
    requestKey: 'e2e-companion',
  })
  assert.equal(companion.value.ok, true, JSON.stringify(companion.value))
  // Later that evening the guest asks for a quieter room.
  t.mock.timers.setTime(Date.parse('2026-08-20T14:30:00.000Z'))
  const roomMoved = await e2e.client.post(
    '/admin/hospitality/stays/booking-1%3Astay?lang=vi',
    new URLSearchParams({
      ...(await formOf('/admin/hospitality/stays/booking-1%3Astay?lang=vi')),
      operation: 'move-room',
      lang: 'vi',
      roomId: '102',
      reason: 'Khách cần phòng yên tĩnh hơn',
    }),
    { headers: { 'content-type': 'application/x-www-form-urlencoded' }, redirect: 'manual' },
  )
  assert.equal(roomMoved.status, 303, await roomMoved.clone().text())
  assert.match(roomMoved.headers.get('location') ?? '', /status=room-moved/)
  const moved = (await e2e.client.call('hospitality_core.getStay', { id: 'booking-1:stay' })).value as Row
  assert.equal(moved.currentRoomId, '102')
  const staying = (await e2e.client.call('hospitality_core.listStayGuests', { stayId: 'booking-1:stay' }))
    .value as Row[]
  assert.ok(staying.some((guest) => guest.displayName === 'Trần Bình'))

  const folioDetailEn = await e2e.client.get('/admin/hospitality/folios/booking-1%3Afolio?lang=en')
  assert.equal(folioDetailEn.status, 200)
  const folioDetailEnHtml = await folioDetailEn.text()
  assert.match(folioDetailEnHtml, /Not an invoice yet/)
  assert.match(folioDetailEnHtml, /Post charge/)
  assertNoVisibleKey(folioDetailEnHtml)
  const chargePosted = await e2e.client.post(
    '/admin/hospitality/folios/booking-1%3Afolio?lang=vi',
    new URLSearchParams({
      ...(await folioState('booking-1:folio')),
      operation: 'post-charge',
      id: 'e2e-manual-charge',
      lang: 'vi',
      stayId: 'booking-1:stay',
      description: 'Dịch vụ spa',
      type: 'spa',
      quantity: '2',
      unitPrice: '10',
    }),
    { headers: { 'content-type': 'application/x-www-form-urlencoded' }, redirect: 'manual' },
  )
  assert.equal(chargePosted.status, 303, await chargePosted.clone().text())
  assert.match(chargePosted.headers.get('location') ?? '', /status=charge-posted/)
  const chargeVoided = await e2e.client.post(
    '/admin/hospitality/folios/booking-1%3Afolio?lang=vi',
    new URLSearchParams({
      ...(await folioState('booking-1:folio')),
      operation: 'void-charge',
      lang: 'vi',
      chargeId: 'e2e-manual-charge',
      reason: 'Lễ tân ghi nhầm số lượng',
    }),
    { headers: { 'content-type': 'application/x-www-form-urlencoded' }, redirect: 'manual' },
  )
  assert.equal(chargeVoided.status, 303, await chargeVoided.clone().text())
  assert.match(chargeVoided.headers.get('location') ?? '', /status=charge-voided/)
  const correctedFolio = await e2e.client.get(chargeVoided.headers.get('location')!)
  const correctedFolioHtml = await correctedFolio.text()
  assert.match(correctedFolioHtml, /Đã hủy khoản phí/)
  assert.match(correctedFolioHtml, /Dịch vụ spa/)
  assertNoVisibleKey(correctedFolioHtml)
  // Other deployment jobs may also be due; this flow requires the stay notice preparation.
  await e2e.drainJobs()
  assert.ok(
    e2e.records.of('job_completed').some((record) => record.fn === 'hospitality_core.prepareStayNotices'),
  )

  const noticeId = 'booking-1:stay:notice:booking-1:guest'
  const notices = (await e2e.client.call('hospitality_core.listStayNotices', { propertyId: 'hotel' }))
    .value as Row[]
  const prepared = notices.find((notice) => notice.id === noticeId)
  assert.equal(prepared?.documentLast4, '1234')
  assert.doesNotMatch(JSON.stringify(notices), /079203001234/)
  const noticeState = async () => ({
    expectedVersion: String(
      (
        (await e2e.client.call('hospitality_core.listStayNotices', { propertyId: 'hotel' })).value as Row[]
      ).find((notice) => notice.id === noticeId)?.version ?? 0,
    ),
    requestKey: `e2e-${crypto.randomUUID()}`,
  })

  const submission = await e2e.client.post(
    '/admin/hospitality/stay-notices?lang=vi&property=hotel',
    new URLSearchParams({
      ...(await noticeState()),
      operation: 'record-submission',
      id: 'booking-1:stay:notice:booking-1:guest',
      stayId: 'booking-1:stay',
      property: 'hotel',
      state: 'all',
      reason: 'tourism',
      channel: 'online',
      evidenceRef: 'DVC-E2E-0001',
    }),
    { headers: { 'content-type': 'application/x-www-form-urlencoded' }, redirect: 'manual' },
  )
  assert.equal(submission.status, 303, await submission.clone().text())
  assert.match(submission.headers.get('location') ?? '', /status=submitted/)
  const confirmation = await e2e.client.post(
    '/admin/hospitality/stay-notices?lang=vi&property=hotel',
    new URLSearchParams({
      ...(await noticeState()),
      operation: 'confirm',
      id: 'booking-1:stay:notice:booking-1:guest',
      stayId: 'booking-1:stay',
      property: 'hotel',
      state: 'all',
      receiptRef: 'DVC-E2E-0001',
    }),
    { headers: { 'content-type': 'application/x-www-form-urlencoded' }, redirect: 'manual' },
  )
  assert.equal(confirmation.status, 303, await confirmation.clone().text())
  assert.match(confirmation.headers.get('location') ?? '', /status=confirmed/)

  // A guest who should have left yesterday is still in room 104. Their stay began on
  // 18 August, so the fixture opens that business day for it and then puts today back.
  const businessDay = (day: string) =>
    e2e.fixture.withTenant('', ({ adapter }) =>
      adapter.run('UPDATE hospitality_core_property SET "businessDate" = ? WHERE id = ?', [day, 'hotel']),
    )
  const currentBusinessDay = String(
    ((await seed('hospitality_core.getProperty', { id: 'hotel' })).value as Row).businessDate,
  )
  await businessDay('2026-08-18')
  const overdueReservation = await seed('hospitality_core.createReservation', {
    id: 'overdue-booking',
    code: 'RES-OVERDUE',
    propertyId: 'hotel',
    roomTypeId: 'deluxe',
    partnerId: 'companion',
    checkIn: '2026-08-18T07:00:00.000Z',
    checkOut: '2026-08-19T05:00:00.000Z',
    rate: '100',
  })
  assert.equal((overdueReservation.value as Row).ok, true, JSON.stringify(overdueReservation.value))
  const overdueGuarantee = await seed('hospitality_billing.setReservationGuarantee', {
    reservationId: 'overdue-booking',
    kind: 'card',
    amount: '100',
    reference: 'authorization:e2e-overdue',
    expectedVersion: 1,
    requestKey: 'e2e-overdue-guarantee',
  })
  assert.equal((overdueGuarantee.value as Row).ok, true, JSON.stringify(overdueGuarantee.value))
  const overdueCheckIn = await seed('hospitality_core.checkIn', {
    stayId: 'overdue-booking:stay',
    roomId: '104',
    at: '2026-08-18T07:00:00.000Z',
    guests: [
      {
        fullName: 'Trần Bình',
        type: 'passport',
        number: 'P7654321',
        birth: '1988-04-20',
        gender: 'other',
        nationality: 'VN',
      },
    ],
  })
  assert.equal((overdueCheckIn.value as Row).ok, true, JSON.stringify(overdueCheckIn.value))
  await businessDay(currentBusinessDay)

  // The day closes after 23:00 at the property.
  t.mock.timers.setTime(Date.parse('2026-08-20T16:30:00.000Z'))
  const auditQueued = await e2e.client.post(
    '/admin/hospitality/night-audit?lang=vi&property=hotel&auditDate=2026-08-20',
    new URLSearchParams({
      ...(await propertyState('hotel')),
      operation: 'request-night-audit',
      propertyId: 'hotel',
      auditDate: '2026-08-20',
    }),
    { headers: { 'content-type': 'application/x-www-form-urlencoded' }, redirect: 'manual' },
  )
  assert.equal(auditQueued.status, 303, await auditQueued.clone().text())
  assert.match(auditQueued.headers.get('location') ?? '', /status=queued/)

  const screens = [
    ['/admin/hospitality/front-desk?lang=vi&property=hotel&date=2026-08-20', 'Bàn lễ tân'],
    ['/admin/hospitality/tape-chart?lang=vi&from=2026-08-20', 'Lịch phòng'],
    ['/admin/hospitality/reservations?lang=vi', 'Đặt phòng'],
    ['/admin/hospitality/stays?lang=vi', 'Khách đang lưu trú'],
    ['/admin/hospitality/folios?lang=vi', 'Phiếu chi phí'],
    ['/admin/hospitality/properties?lang=vi', 'Cơ sở lưu trú'],
    ['/admin/hospitality/rooms?lang=vi', 'Danh mục phòng'],
    ['/admin/hospitality/room-types?lang=vi', 'Loại phòng'],
    [
      '/admin/hospitality/content?lang=vi&property=hotel&target=room_type%3Adeluxe',
      'Nội dung &amp; hình ảnh',
    ],
    ['/admin/hospitality/rate-plans?lang=vi', 'Bảng giá'],
    ['/admin/hospitality/services?lang=vi&property=hotel', 'Dịch vụ &amp; phụ phí'],
    ['/admin/hospitality/night-audit?lang=vi&property=hotel&auditDate=2026-08-20', 'Chốt ngày vận hành'],
    ['/admin/hospitality/stay-notices?lang=vi&property=hotel', 'Thông báo lưu trú'],
    [
      '/admin/hospitality/inventory?lang=vi&property=hotel&roomType=deluxe&from=2026-08-20&to=2026-08-22',
      'Phòng trống và điều kiện bán',
    ],
    ['/admin/hospitality/amenities?lang=vi', 'Danh mục tiện nghi'],
    ['/admin/hospitality/policies?lang=vi', 'Chính sách hủy'],
  ] as const
  for (const [path, title] of screens) {
    const response = await e2e.client.get(path)
    assert.equal(response.status, 200, path)
    const html = await response.text()
    // As above: a bar's island props name functions, which are not keys.
    assert.doesNotMatch(html, /(?:>|placeholder="|aria-label="|title=")[^<"]*hospitality_core\./u, path)
    assert.match(html, new RegExp(title), path)
    assert.doesNotMatch(html, /data-route-modal="true"/, path)
  }

  for (const path of [
    '/admin/hospitality/rate-plans?lang=vi&property=hotel&create=1',
    '/admin/hospitality/housekeeping?lang=vi&property=hotel&create=1',
    '/admin/hospitality/amenities?lang=vi&create=1',
    '/admin/hospitality/policies?lang=vi&create=1',
  ] as const) {
    const response = await e2e.client.get(path)
    const html = await response.text()
    assert.equal(response.status, 200, `${path}: ${html}`)
    assert.match(html, /data-ui="list-page"/, path)
    assert.match(html, /data-route-modal="true"/, path)
    assert.match(html, /role="dialog"/, path)
  }
  // A desk booking is its own page, and billing rules have nothing to create: each type is set up from its row.
  const deskCreate = await (
    await e2e.client.get('/admin/hospitality/reservations?lang=vi&property=hotel&create=1')
  ).text()
  assert.match(deskCreate, /data-island="hospitality\.desk-booking-page"/)
  const rulesCreate = await (await e2e.client.get('/admin/hospitality/billing/rules?lang=vi&create=1')).text()
  assert.match(rulesCreate, /data-island="hospitality\.collection-results"/)
  assert.doesNotMatch(rulesCreate, /data-route-modal="true"/)

  const frontDesk = await e2e.client.get(
    '/admin/hospitality/front-desk?lang=vi&property=hotel&date=2026-08-20',
  )
  const html = await frontDesk.text()
  assert.match(html, /Bàn lễ tân/)
  assert.match(html, /Lưu trú quá giờ trả phòng/)
  assert.match(html, /RES-OVERDUE/)
  assert.match(html, /Trần Bình/)
  // Every heading says "today", and ?date= means today can be a Thursday in
  // August. The screen names the day it is actually showing.
  assert.match(html, /20\/08\/2026/)
  // The desk works two queues: who is still to arrive, and who is due out.
  assert.match(html, /Khách đến hôm nay/)
  assert.match(html, /Khách rời hôm nay/)
  // Nguyễn An arrived today and was shown to a room; the desk is done with
  // them until Friday, so they leave the queues and stay on the stays list.
  assert.doesNotMatch(html, /Nguyễn An/)
  const staysList = await e2e.client.get('/admin/hospitality/stays?lang=vi&property=hotel')
  assert.equal(staysList.status, 200)
  // The guests in house are the rows of the stay book's island.
  const inHouse = (await e2e.client.call('hospitality_core.listStays', { propertyId: 'hotel' }))
    .value as Row[]
  assert.ok(inHouse.some((stay) => stay.id === 'booking-1:stay' && stay.state === 'checked_in'))

  const english = await e2e.client.get('/admin/hospitality/front-desk?lang=en&property=hotel&date=2026-08-20')
  assert.equal(english.status, 200)
  const englishHtml = await english.text()
  assert.match(englishHtml, /Front desk/)
  assert.match(englishHtml, /Overdue departures/)
  assert.match(englishHtml, /Arriving today/)
  assert.match(englishHtml, /Departing today/)
  assert.match(englishHtml, /RES-OVERDUE/)
  const englishServices = await e2e.client.get('/admin/hospitality/services?lang=en&property=hotel')
  assert.equal(englishServices.status, 200)
  const englishServicesHtml = await englishServices.text()
  assert.match(englishServicesHtml, /Services &amp; fees/)
  assertNoVisibleKey(englishServicesHtml)
  const englishAudit = await e2e.client.get(
    '/admin/hospitality/night-audit?lang=en&property=hotel&auditDate=2026-08-20',
  )
  assert.equal(englishAudit.status, 200)
  const englishAuditHtml = await englishAudit.text()
  assert.match(englishAuditHtml, /Night audit/)
  assertNoVisibleKey(englishAuditHtml)
  const englishStayNotices = await e2e.client.get('/admin/hospitality/stay-notices?lang=en&property=hotel')
  assert.equal(englishStayNotices.status, 200)
  const englishStayNoticesHtml = await englishStayNotices.text()
  assert.match(englishStayNoticesHtml, /Stay notices/)
  assert.match(englishStayNoticesHtml, /Confirmed/)
  assert.doesNotMatch(englishStayNoticesHtml, /079203001234/)
  assertNoVisibleKey(englishStayNoticesHtml)

  await e2e.fixture.withTenant('', async ({ adapter }) => {
    const stays = await adapter.all('SELECT state, "currentRoomId" FROM hospitality_core_stay WHERE id = ?', [
      'booking-1:stay',
    ])
    assert.deepEqual({ ...stays[0] }, { state: 'checked_in', currentRoomId: '102' })
    const notices = await adapter.all(
      'SELECT state, "packageHash", "submittedBy", "confirmedBy", "receiptRef" FROM hospitality_core_stay_notice WHERE id = ?',
      ['booking-1:stay:notice:booking-1:guest'],
    )
    assert.equal(notices[0]?.state, 'confirmed')
    assert.match(String(notices[0]?.packageHash), /^[a-f0-9]{64}$/)
    assert.equal(notices[0]?.submittedBy, 'admin')
    assert.equal(notices[0]?.confirmedBy, 'admin')
    assert.equal(notices[0]?.receiptRef, 'DVC-E2E-0001')
    const correction = await adapter.all(
      'SELECT state, "voidReason" FROM hospitality_core_charge WHERE id = ?',
      ['e2e-manual-charge'],
    )
    assert.deepEqual({ ...correction[0] }, { state: 'void', voidReason: 'Lễ tân ghi nhầm số lượng' })
  })

  // The audit closes 20 August overnight; the guest leaves the next morning.
  await e2e.drainJobs()
  assert.equal(
    String(((await seed('hospitality_core.getProperty', { id: 'hotel' })).value as Row).businessDate),
    '2026-08-21',
  )
  t.mock.timers.setTime(Date.parse('2026-08-21T02:00:00.000Z'))
  // The desk reads the departure before it closes it: who and which room, what
  // is on the bill, and whether anything is still owed. The button lives here.
  const prep = await e2e.client.get('/admin/hospitality/reservations/booking-1?action=check-out&lang=vi')
  const prepHtml = await prep.text()
  assert.equal(prep.status, 200, prepHtml)
  assert.match(prepHtml, /Chuẩn bị trả phòng/)
  assert.match(prepHtml, /Thông tin bàn giao/)
  assert.match(prepHtml, /Các khoản của khách/)
  // Leaving is not paying, and the page says so rather than implying otherwise.
  assert.match(prepHtml, /Đủ điều kiện trả phòng/)
  assert.match(prepHtml, /Hóa đơn và khoản thu là bước sau/)
  assertNoVisibleKey(prepHtml)

  const checkedOut = await e2e.client.post(
    '/admin/hospitality/reservations/booking-1?lang=vi',
    new URLSearchParams({
      ...(await stayState('booking-1:stay')),
      operation: 'check-out',
      lang: 'vi',
      // The desk has the keys back and has checked the minibar and services.
      'handover-keys': 'yes',
      'handover-charges': 'yes',
    }),
    { headers: { 'content-type': 'application/x-www-form-urlencoded' }, redirect: 'manual' },
  )
  assert.equal(checkedOut.status, 303, await checkedOut.clone().text())
  // The guest leaves on the day they were due; an earlier departure is first moved to today.
  assert.match(checkedOut.headers.get('location') ?? '', /status=checked-out(?:&|$)/)
  const departed = (await e2e.client.call('hospitality_core.getStay', { id: 'booking-1:stay' })).value as Row
  assert.equal(departed.state, 'checked_out')

  // The checkout clean opens in its task workspace; what it holds is read back directly.
  const taskPath = '/admin/hospitality/housekeeping/tasks/checkout%3Abooking-1%3Astay'
  const checkoutTask = async () =>
    (await e2e.client.call('hospitality_core.getCleaningTask', { id: 'checkout:booking-1:stay' }))
      .value as Row
  const taskVi = await e2e.client.get(`${taskPath}?lang=vi`)
  const taskViHtml = await taskVi.text()
  assert.equal(taskVi.status, 200, taskViHtml)
  assertNoVisibleKey(taskViHtml)
  assert.equal((await checkoutTask()).code, 'HK-S-BOOKING-1')

  const startedTask = await e2e.client.post(
    `${taskPath}?lang=vi`,
    new URLSearchParams({ operation: 'start', lang: 'vi', assigneeId: 'housekeeper-01' }),
    { headers: { 'content-type': 'application/x-www-form-urlencoded' }, redirect: 'manual' },
  )
  assert.equal(startedTask.status, 303, await startedTask.clone().text())
  assert.match(startedTask.headers.get('location') ?? '', /status=started/)
  const taskEn = await e2e.client.get(`${taskPath}?lang=en`)
  const taskEnHtml = await taskEn.text()
  assert.equal(taskEn.status, 200, taskEnHtml)
  assertNoVisibleKey(taskEnHtml)
  const started = await checkoutTask()
  assert.deepEqual(
    { state: started.state, assigneeId: started.assigneeId },
    { state: 'in_progress', assigneeId: 'housekeeper-01' },
  )

  // Completing confirms every check on the list.
  const completedTask = await e2e.client.post(
    `${taskPath}?lang=en`,
    new URLSearchParams({
      operation: 'complete',
      lang: 'en',
      'check-linen': 'yes',
      'check-bathroom': 'yes',
      'check-supplies': 'yes',
      'check-final': 'yes',
      // The task workspace holds the version it read.
      expectedVersion: String(
        await e2e.fixture.withTenant(
          '',
          async ({ adapter }) =>
            (
              await adapter.all('SELECT version FROM hospitality_core_cleaning_task WHERE id = ?', [
                'checkout:booking-1:stay',
              ])
            )[0]?.version ?? 0,
        ),
      ),
      requestKey: 'e2e-checkout-clean-complete',
    }),
    { headers: { 'content-type': 'application/x-www-form-urlencoded' }, redirect: 'manual' },
  )
  assert.equal(completedTask.status, 303, await completedTask.clone().text())
  assert.match(completedTask.headers.get('location') ?? '', /status=completed/)
  const completed = await checkoutTask()
  assert.equal(completed.state, 'done')
  assert.ok(completed.doneAt)

  const createdTask = await e2e.client.post(
    '/admin/hospitality/housekeeping?lang=vi&property=hotel',
    new URLSearchParams({
      ...(await formOf('/admin/hospitality/housekeeping?lang=vi&property=hotel')),
      operation: 'create',
      lang: 'vi',
      id: 'manual-inspection',
      code: 'HK-MANUAL-001',
      propertyId: 'hotel',
      state: 'all',
      roomId: '102',
      taskType: 'inspection',
      priority: 'normal',
      assigneeId: 'supervisor-01',
      notes: 'Kiểm tra minibar sau khi vệ sinh.',
    }),
    { headers: { 'content-type': 'application/x-www-form-urlencoded' }, redirect: 'manual' },
  )
  assert.equal(createdTask.status, 303, await createdTask.clone().text())
  assert.match(createdTask.headers.get('location') ?? '', /status=created/)
  const manual = (await e2e.client.call('hospitality_core.getCleaningTask', { id: 'manual-inspection' }))
    .value as Row
  assert.equal(manual.code, 'HK-MANUAL-001')

  const roomBoard = await e2e.client.get('/admin/hospitality/housekeeping/rooms?lang=vi&property=hotel')
  const roomBoardHtml = await roomBoard.text()
  assert.equal(roomBoard.status, 200, roomBoardHtml)
  assert.match(roomBoardHtml, /Bảng trạng thái phòng/)
  // The board's rows are its island's read: rooms in service, not archived ones.
  const board = (await e2e.client.call('hospitality_core.getRoomBoard', { propertyId: 'hotel' })).value as {
    rows: Row[]
  }
  const boardNames = JSON.stringify(board.rows)
  assert.match(boardNames, /Phòng 103/)
  assert.doesNotMatch(boardNames, /Phòng đã lưu trữ/)
  assertNoVisibleKey(roomBoardHtml)

  const roomPath = '/admin/hospitality/housekeeping/rooms/103'
  const roomDetail = await e2e.client.get(`${roomPath}?lang=en`)
  const roomDetailHtml = await roomDetail.text()
  assert.equal(roomDetail.status, 200, roomDetailHtml)
  assert.match(roomDetailHtml, /Room 103/)
  assert.match(roomDetailHtml, /Block room/)
  assertNoVisibleKey(roomDetailHtml)

  // A short repair takes the room out of service until later today; the
  // workbench's form carries the room version it read.
  const blockDialog = await e2e.client.get(`${roomPath}?lang=en&dialog=block&kind=oos`)
  const blockFields = operationFields(await blockDialog.text(), 'block-room')
  assert.equal(blockFields.kind, 'oos')
  const blockedRoom = await e2e.client.post(
    `${roomPath}?lang=en`,
    new URLSearchParams({ ...blockFields, backLocal: '17:00', reason: 'Air-conditioning inspection.' }),
    { headers: { 'content-type': 'application/x-www-form-urlencoded' }, redirect: 'manual' },
  )
  assert.equal(blockedRoom.status, 303, await blockedRoom.clone().text())
  assert.match(blockedRoom.headers.get('location') ?? '', /status=updated/)
  const blockedHtml = await (await e2e.client.get(blockedRoom.headers.get('location')!)).text()
  assert.match(blockedHtml, /Room status updated/)
  assert.match(blockedHtml, /Air-conditioning inspection/)
  assert.match(blockedHtml, /Reopen room/)
  assertNoVisibleKey(blockedHtml)

  // Reopening asks first; its confirm dialog submits the form that names the block.
  const reopenDialog = await e2e.client.get(`${roomPath}?lang=vi&dialog=reopen`)
  const reopenFields = operationFields(await reopenDialog.text(), 'reopen-room')
  assert.ok(reopenFields.id, 'the reopen form names the active block')
  const reopenedRoom = await e2e.client.post(`${roomPath}?lang=vi`, new URLSearchParams(reopenFields), {
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    redirect: 'manual',
  })
  assert.equal(reopenedRoom.status, 303, await reopenedRoom.clone().text())
  const reopenedHtml = await (await e2e.client.get(reopenedRoom.headers.get('location')!)).text()
  assert.match(reopenedHtml, /Đã cập nhật trạng thái phòng/)
  assert.match(reopenedHtml, /Chưa vệ sinh/)
  assert.equal(
    ((await e2e.client.call('hospitality_core.getRoom', { id: '103' })).value as Row).status,
    'dirty',
  )
  const preselectedQueue = await e2e.client.get(
    '/admin/hospitality/housekeeping?lang=vi&property=hotel&room=103&create=1',
  )
  assert.match(await preselectedQueue.text(), /<option(?=[^>]*value="103")(?=[^>]*selected)[^>]*>/)

  for (const [path, title] of [
    ['/admin/hospitality/housekeeping?lang=vi', 'Việc dọn phòng'],
    ['/admin/hospitality/housekeeping/rooms?lang=vi', 'Bảng trạng thái phòng'],
  ] as const) {
    const response = await e2e.client.get(path)
    const page = await response.text()
    assert.equal(response.status, 200, `${path}: ${page}`)
    assert.match(page, new RegExp(title), path)
    assertNoVisibleKey(page)
  }

  await e2e.fixture.withTenant('', async ({ adapter }) => {
    const tasks = await adapter.all(
      'SELECT id, state, priority, "roomId", "taskType" FROM hospitality_core_cleaning_task ORDER BY id',
    )
    assert.deepEqual(
      tasks.map((task) => ({ ...task })),
      [
        {
          id: 'checkout:booking-1:stay',
          state: 'done',
          priority: 'urgent',
          roomId: '102',
          taskType: 'checkout_clean',
        },
        {
          id: 'manual-inspection',
          state: 'todo',
          priority: 'normal',
          roomId: '102',
          taskType: 'inspection',
        },
        {
          id: 'move:booking-1:stay:assignment:1:clean',
          state: 'todo',
          priority: 'normal',
          roomId: '101',
          // The room a guest moved out of is turned over as after a departure.
          taskType: 'checkout_clean',
        },
      ],
    )
    const cleanedRoom = await adapter.all('SELECT status FROM hospitality_core_room WHERE id = ?', ['102'])
    assert.equal(cleanedRoom[0]?.status, 'available')
    const manualTask = await adapter.all(
      'SELECT "assigneeId", notes FROM hospitality_core_cleaning_task WHERE id = ?',
      ['manual-inspection'],
    )
    assert.deepEqual(
      { ...manualTask[0] },
      { assigneeId: 'supervisor-01', notes: 'Kiểm tra minibar sau khi vệ sinh.' },
    )
  })
})
