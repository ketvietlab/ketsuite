import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { MenuNode } from '@ketvietlab/ketjs'
import { queryEntryActive } from '../packages/ketsuite/src/modules/backend/screen.ts'
import { setup } from './fixtures/sale/commerce.ts'

/** The sidebar entries, in order, each with whether it is lit. */
const entries = (html: string) => {
  const nav = html.slice(html.indexOf('data-ui="app-navigation"'))
  return [...nav.matchAll(/<a data-ui="navigation-item"([^>]*)>([\s\S]*?)<\/a>/g)].map((match) => ({
    href: /href="([^"]*)"/.exec(match[1]!)?.[1]?.replaceAll('&amp;', '&') ?? '',
    active: match[1]!.includes('data-active="true"'),
    label: match[2]!.replace(/<[^>]*>/g, '').trim(),
  }))
}

test('D6 the Sales sidebar keeps daily work and lights the queue being read', async (t) => {
  const r = await setup(t)
  const sales = (html: string) => entries(html).filter((entry) => entry.href.startsWith('/admin/sales'))
  const overview = sales(await (await r.app.client.get('/admin/sales?lang=vi')).text())
  assert.deepEqual(
    overview.map((entry) => entry.label),
    ['Tổng quan', 'Báo giá', 'Đơn bán hàng', 'Cần xuất hoá đơn', 'Khách hàng', 'Phân tích'],
  )
  // The queue opens the orders list on its preset and is the entry lit there; the list is lit
  // without it, and with any other filter beside it the queue is still what is showing.
  const lit = async (path: string) =>
    sales(await (await r.app.client.get(path)).text())
      .filter((entry) => entry.active)
      .map((entry) => entry.label)
  assert.deepEqual(await lit('/admin/sales/orders?lang=vi&preset=to%20invoice'), ['Cần xuất hoá đơn'])
  assert.deepEqual(await lit('/admin/sales/orders?lang=vi&preset=to+invoice&preset=locked'), [
    'Cần xuất hoá đơn',
  ])
  assert.deepEqual(await lit('/admin/sales/orders?lang=vi'), ['Đơn bán hàng'])
  assert.deepEqual(await lit('/admin/sales/orders?lang=vi&preset=locked'), ['Đơn bán hàng'])
  assert.equal(
    overview.find((entry) => entry.label === 'Cần xuất hoá đơn')?.href,
    '/admin/sales/orders?preset=to%20invoice',
  )
  // Configuration is behind the gear: no sidebar entry opens pricelists, the gear does.
  const html = await (await r.app.client.get('/admin/sales?lang=vi')).text()
  assert.ok(!entries(html).some((entry) => entry.href.startsWith('/admin/pricing')))
  const settings = await (await r.app.client.get('/admin/settings?lang=vi')).text()
  // #1677: pricelists sit in the Sales block of the gear, beside the other sales settings, not in System.
  const block = (id: string) => new RegExp(`data-module-id="${id}"[\\s\\S]*?</ul>`).exec(settings)?.[0] ?? ''
  assert.match(block('admin.sale'), /href="\/admin\/pricing\/pricelists[^"]*"/)
  assert.match(block('admin.sale'), /href="\/admin\/sales\/invoicing-policies[^"]*"/)
  assert.doesNotMatch(block('admin.config'), /pricing\/pricelists/)
  assert.equal(settings.match(/href="\/admin\/pricing\/pricelists/g)?.length, 1)
  // The pricelists page lights its gear entry, not a sidebar app of its own.
  const pricelists = await r.app.client.get('/admin/pricing/pricelists?lang=vi')
  assert.equal(pricelists.status, 200)
  assert.ok(!entries(await pricelists.text()).some((entry) => entry.href.startsWith('/admin/pricing')))
})

test('D6 an entry with a query lights only when the address carries all of it', () => {
  const node = (id: string, path: string | null, children: MenuNode[] = [], active = false): MenuNode =>
    ({ id, label: id, path, icon: null, active, secondary: false, children }) as MenuNode
  const tree = [
    node(
      'sale',
      null,
      [
        node('orders', '/admin/sales/orders', [], true),
        node('toInvoice', '/admin/sales/orders?preset=to%20invoice&state=sale'),
      ],
      true,
    ),
    node('crm', null, [node('process', '/admin/crm/configuration?tab=process')]),
  ]
  const lit = (href: string) => {
    const flat: string[] = []
    const walk = (nodes: MenuNode[]) => {
      for (const entry of nodes) {
        if (entry.active) flat.push(entry.id)
        walk(entry.children)
      }
    }
    walk(queryEntryActive(tree, new URL(href, 'http://ket.local')))
    return flat
  }
  assert.deepEqual(lit('/admin/sales/orders?state=sale&preset=to+invoice&lang=en'), ['sale', 'toInvoice'])
  // Part of the query is not the entry: the path's own lighting stands.
  assert.deepEqual(lit('/admin/sales/orders?preset=to+invoice'), ['sale', 'orders'])
  assert.deepEqual(lit('/admin/sales/quotations?preset=to+invoice&state=sale'), ['sale', 'orders'])
  assert.deepEqual(lit('/admin/crm/configuration?tab=process'), ['crm', 'process'])
})

test('D2 an order shows its deliveries and opens them in Stock; it does not deliver', async (t) => {
  const r = await setup(t)
  await r.add()
  await r.save('sale.confirmOrder', { id: 'order' })
  const { data } = (await (await r.app.client.get('/admin/sales/record/order/context?lang=vi')).json()) as {
    data: { record: { moves: Array<Record<string, unknown>> } }
  }
  const moves = data.record.moves
  assert.ok(moves.length > 0)
  for (const move of moves) {
    assert.ok(move.state, 'each delivery says where it stands')
    assert.match(String(move.pickingHref), /^\/admin\/stock\/transfers\/[^/?]+\?/)
  }
  // The picking it opens is Stock's page.
  const picking = await r.app.client.get(String(moves[0]!.pickingHref))
  assert.equal(picking.status, 200)
  assert.doesNotMatch(
    await picking.text(),
    /data-ui="navigation-item" data-active="true"[^>]*href="\/admin\/sales/,
  )
})
