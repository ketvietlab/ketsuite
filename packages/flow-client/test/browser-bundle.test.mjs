import assert from 'node:assert/strict'
import test from 'node:test'
import { readFile, writeFile, unlink } from 'node:fs/promises'
import { renderToString } from '@ketvietlab/ketjs-view'
import { createFlowWorkspace, routes } from '../dist/workspace.mjs'
import { flowShellData } from '../dist/shell-model.mjs'
import { createOrganizationSession } from '../atlas/organization-store.mjs'
import { registerFlowExtension } from '../dist/extensions.mjs'

test('the canonical browser bundle preserves SSR hydration markers and the extension singleton', async () => {
  const target = new URL('../dist/.browser-contract-' + process.pid + '.mjs', import.meta.url)
  const body = (await readFile(new URL('../dist/workspace.browser.mjs', import.meta.url), 'utf8'))
    .replaceAll('"/_ket/view/index.js"', '"@ketvietlab/ketjs-view"')
    .replaceAll('"/_ket/view/jsx-runtime.js"', '"@ketvietlab/ketjs-view/jsx-runtime"')
  await writeFile(target, body)
  try {
    assert.match(
      body,
      /from\s*["']@ketvietlab\/flow-client\/navigation-host\.mjs["']/,
      'the workspace and framework enhancement must share one navigation host',
    )
    assert.match(
      body,
      /from\s*["']@ketvietlab\/flow-client\/i18n\.mjs["']/,
      'versioned island URLs must resolve the single-language catalogue via the canonical import map',
    )
    assert.doesNotMatch(body, /from\s*["']\.\/(?:i18n|navigation-host|extensions|routes|navigation)\.mjs["']/)
    assert.doesNotMatch(
      body,
      /Flow navigation is not attached/,
      'the navigation host must not be embedded as a second singleton',
    )
    assert.doesNotMatch(
      body,
      /export const flowHelp =|## Track task deadlines/,
      'guide content is lazy, outside list startup',
    )
    assert.match(body, /import\(["']@ketvietlab\/flow-client\/help\.generated\.mjs["']\)/)
    assert.match(
      body,
      /import\(["']@ketvietlab\/flow-client\/operations\.mjs["']\)/,
      'secondary screen controllers load at their route boundary',
    )
    const browser = await import(target.href)
    registerFlowExtension({
      name: 'browser-boundary-probe',
      routes: {
        'browser-boundary-probe': {
          title: 'Boundary probe',
          group: 'Probe',
          pattern: 'workspace',
          scope: 'workspace',
          tab: { group: 'workspace', icon: 'flag' },
        },
      },
      create: () => ({}),
    })
    for (const screen of Object.keys(routes)) {
      const fixture = createOrganizationSession('baseline', screen)
      const data = fixture.call('flow.workspace.bootstrap', { route: screen, companyId: 'demo' }).value
      const props = {
        serverShell: true,
        screen,
        companyId: 'demo',
        workspaceId: 'product',
        project: 'core',
        chrome: flowShellData(data),
      }
      const original = createFlowWorkspace(props),
        built = browser.createFlowWorkspace(props)
      try {
        assert.equal(
          renderToString(built.shellView(null)),
          renderToString(original.shellView(null)),
          screen + ' shell markers',
        )
        assert.equal(
          renderToString(built.view()),
          renderToString(original.view()),
          screen + ' island markers',
        )
      } finally {
        original.dispose()
        built.dispose()
      }
    }
  } finally {
    await unlink(target)
  }
})
