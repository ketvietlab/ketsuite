import assert from 'node:assert/strict'
import { test } from 'node:test'
import { setup } from './fixtures/sale/commerce.ts'

/** The rail's ? as one response carries it: its slot, and the label it names. */
const railHelp = (html: string) =>
  /data-ket-slot="backend\.app-help"[^>]*>([\s\S]*?)<\/(?:div|template)>/.exec(html)?.[1] ?? null
const labelOf = (help: string | null) => /aria-label="([^"]*)"/.exec(help ?? '')?.[1] ?? null

test('#1817 the rail ? names the guide of the screen fragment navigation shows, Back included', async (t) => {
  const r = await setup(t)
  // A full load of the lots list: the rail holds Help in its slot, named for the lots.
  const lots = await (await r.app.client.get('/admin/stock/lots?lang=vi')).text()
  assert.match(lots, /<div data-ui="app-switcher-help-slot" data-ket-slot="backend\.app-help">/)
  assert.equal(labelOf(railHelp(lots)), 'Hướng dẫn Lô hàng')

  // Going to Search in Stock, or back to it, swaps the content and keeps the rail: Help comes with it.
  const fragment = async (path: string) => {
    const response = await r.app.client.request(path, {
      headers: { accept: 'text/html', 'x-ket-navigation': 'fragment-v1' },
    })
    assert.equal(response.status, 200, path)
    const html = await response.text()
    assert.match(html, /^<ket-fragments/, path)
    return html
  }
  assert.equal(labelOf(railHelp(await fragment('/admin/stock/search?lang=vi'))), 'Hướng dẫn Tìm trong Kho')
  assert.equal(labelOf(railHelp(await fragment('/admin/stock/lots?lang=vi'))), 'Hướng dẫn Lô hàng')
  assert.equal(labelOf(railHelp(await fragment('/admin/stock/transfers?lang=vi'))), 'Hướng dẫn Phiếu kho')
})
