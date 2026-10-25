import assert from 'node:assert/strict'
import { test } from 'node:test'
import { renderToString } from '@ketvietlab/ketjs-view'
import type { MenuNode } from '@ketvietlab/ketjs'
import { AppSwitcher } from '@ketvietlab/design-system'
import { suiteApplications, suiteMainMenu } from '../packages/ketsuite/src/ui/application-switcher.ts'
import { createFlowWorkspaceModule } from '../packages/ketsuite/src/modules/flow_workspace/index.ts'

const entry = (id: string, path: string | null, children: MenuNode[] = []): MenuNode => ({
  id,
  path,
  label: id,
  icon: null,
  active: false,
  secondary: false,
  children,
})

test('native Flow app uses the permitted destination once, with a native new-tab link', () => {
  const menu = [entry('hr', '/admin/hr'), entry('flow', '/flow/my-work')]
  const apps = suiteApplications(menu, (key) => key)
  assert.equal(apps.items.find((item) => item.id === 'flow')?.href, '/flow/my-work')
  assert.deepEqual(
    suiteMainMenu(menu).map((node) => node.id),
    ['hr'],
  )
  const markup = renderToString(<AppSwitcher {...apps} />)
  assert.match(markup, /href="\/flow\/my-work" target="_blank" rel="noopener noreferrer"/)
  assert.doesNotMatch(markup, /aria-disabled="true"[^>]*data-app-id="flow"/)
  const module = createFlowWorkspaceModule()
  assert.equal(module.menus?.flow.needs, 'flow.workspace.bootstrap')
})

test('missing permission supplies no Flow link, and the legacy admin menu remains intact', () => {
  const legacy = entry('flow', null, [entry('flow.mine', '/admin/flow/mine')])
  for (const menu of [[], [legacy]]) {
    const apps = suiteApplications(menu, (key) => key)
    assert.equal(apps.items.find((item) => item.id === 'flow')?.href, undefined)
  }
  assert.deepEqual(suiteMainMenu([legacy]), [legacy])
})
