import assert from 'node:assert/strict'
import test from 'node:test'
import { renderToStaticString } from '@ketvietlab/ketjs-view'
import { routes } from '../client/workspace.mjs'
import { organizationRoutes } from '../client/organization.mjs'
import { screenHelp, hasFlowHelp, loadScreenHelp, createScreenHelp } from '../client/screen-help.mjs'
import { setFlowLocale } from '../client/i18n.mjs'

test('every Core route has authored VI/EN screen guidance through the public DS drawer', async () => {
  assert.equal(screenHelp('my-work', 'Tasks'), null, 'closed Help has no eagerly rendered drawer')
  const guides = await loadScreenHelp()
  for (const route of new Set([...Object.keys(routes), ...Object.keys(organizationRoutes)])) {
    assert.ok(hasFlowHelp(route), 'missing guide: ' + route)
    for (const language of ['vi', 'en']) {
      setFlowLocale(language)
      const output = renderToStaticString(screenHelp(route, 'Current screen', guides))
      assert.match(output, /data-ui="help-drawer"/)
      assert.match(output, /data-ui="markdown"/)
      assert.match(output, /<h3>/, 'Markdown headings sit below the drawer title')
      assert.ok(output.length > 800, route + ' contains real guidance')
      assert.doesNotMatch(output, /TODO|placeholder/)
    }
  }
  setFlowLocale('en')
  assert.equal(screenHelp('private-extension-without-guide', 'Private'), null)
})

test('lazy Help rejects a response after navigation and retries failed imports', async () => {
  let key = 'one',
    resolve,
    reject,
    errors = 0
  const help = createScreenHelp({
    key: () => key,
    route: () => 'my-work',
    title: () => 'Tasks',
    allowed: () => true,
    error: () => errors++,
    load: () =>
      new Promise((yes, no) => {
        resolve = yes
        reject = no
      }),
  })
  const host = new EventTarget(),
    lifetime = new AbortController()
  help.attach(host, lifetime.signal)
  assert.equal(help.view(), null)
  host.dispatchEvent(new Event('ket:screen-help-request', { cancelable: true }))
  key = 'two'
  resolve(await loadScreenHelp())
  await new Promise((r) => setTimeout(r, 0))
  assert.equal(help.view(), null)
  host.dispatchEvent(new Event('ket:screen-help-request', { cancelable: true }))
  reject(new Error('offline'))
  await new Promise((r) => setTimeout(r, 0))
  assert.equal(errors, 1)
  host.dispatchEvent(new Event('ket:screen-help-request', { cancelable: true }))
  resolve(await loadScreenHelp())
  await new Promise((r) => setTimeout(r, 0))
  assert.match(renderToStaticString(help.view()), /data-ui="help-drawer"/)
  lifetime.abort()
  help.dispose()
})
