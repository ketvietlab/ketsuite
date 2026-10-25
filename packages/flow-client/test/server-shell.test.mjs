import assert from 'node:assert/strict'
import test from 'node:test'
import {
  html,
  renderIsland,
  renderToString,
  renderToStaticString,
  trustedMarkup,
} from '@ketvietlab/ketjs-view'
import { createFlowWorkspace, routes } from '../dist/workspace.mjs'
import { routeScope } from '../dist/navigation.mjs'
import { flowShellData } from '../dist/shell-model.mjs'
import { createOrganizationSession } from '../atlas/organization-store.mjs'
import { atlasShellRequest, atlasShellProps } from '../atlas/shell-request.mjs'

test('SSR fallback context preserves the explicit or legacy Workspace mutation target', () => {
  for (const screen of ['workspace-edit', 'workspace-archive']) {
    const props = { screen, workspaceId: 'lab', record: 'KV-142', recordProvided: false }
    const resolved = atlasShellProps(props, { context: { workspaceId: 'product' } })
    assert.equal(resolved.workspaceId, 'product')
    assert.equal(resolved.record, 'lab')
    assert.equal(resolved.recordProvided, true)
    const explicit = atlasShellProps(
      { ...props, record: 'missing', recordProvided: true },
      { context: { workspaceId: 'product' } },
    )
    assert.equal(explicit.record, 'missing')
  }
  const overview = atlasShellProps(
    { screen: 'workspace-overview', workspaceId: 'lab', recordProvided: false },
    { context: { workspaceId: 'product' } },
  )
  assert.equal(overview.recordProvided, false)
})

test('SSR shell ownership ignores default editor IDs and resolves explicit record and project owners', () => {
  const fixture = createOrganizationSession('baseline', 'projects')
  const props = {
    screen: 'projects',
    companyId: 'demo',
    workspaceId: 'lab',
    scope: 'workspace',
    project: 'core',
    record: 'KV-142',
    recordProvided: false,
  }
  const read = (overrides) =>
    fixture.call('flow.workspace.bootstrap', atlasShellRequest({ ...props, ...overrides })).value
  assert.equal(read().context.workspaceId, 'lab')
  assert.equal(read().context.projectId, null)
  assert.equal(read({ screen: 'issue', scope: 'project', recordProvided: true }).context.projectId, 'core')
  assert.equal(
    read({ screen: 'project-profile', scope: 'project', project: 'ops' }).context.workspaceId,
    'operations',
  )
  assert.equal(read({ screen: 'page', record: 'handoff', recordProvided: true }).context.projectId, 'core')
  fixture.sessions.get('demo').data.pages.push({
    id: 'workspace-note',
    title: 'Note',
    projectId: null,
    workspaceId: 'operations',
    ownerId: 'mai',
    visibility: 'shared',
  })
  assert.equal(
    read({ screen: 'page', record: 'workspace-note', recordProvided: true }).context.workspaceId,
    'operations',
  )
  const documentProps = { ...props, screen: 'page', record: 'workspace-note', recordProvided: true }
  const canonical = atlasShellProps(documentProps, flowShellData(read(documentProps)))
  assert.equal(canonical.scope, 'workspace')
  assert.equal(canonical.workspaceId, 'operations')
  assert.equal(canonical.project, '')
  const projectDocument = atlasShellProps(
    { ...props, screen: 'page', recordProvided: true },
    flowShellData(read({ screen: 'page', record: 'handoff', recordProvided: true })),
  )
  assert.equal(projectDocument.scope, 'project')
  assert.equal(projectDocument.project, 'core')
})

test('every Core route renders chrome outside the data island without serializing its business records', () => {
  for (const screen of Object.keys(routes)) {
    const fixture = createOrganizationSession('baseline', screen)
    const value = fixture.call('flow.workspace.bootstrap', {
      companyId: 'demo',
      workspaceId: 'product',
      projectId: routeScope(screen) === 'project' ? 'core' : undefined,
      route: screen,
    }).value
    const initialShellData = flowShellData(value)
    const props = {
      serverShell: true,
      chrome: initialShellData,
      screen,
      workspaceId: initialShellData?.context?.workspaceId ?? 'product',
      project: initialShellData?.context?.projectId ?? 'core',
    }
    const content = renderIsland('flow.workspace', createFlowWorkspace, props, { tag: 'div' })
    const workspace = createFlowWorkspace(props, { initialShellData })
    try {
      const output = renderToString(workspace.shellView(trustedMarkup(content)))
      assert.equal((output.match(/data-flow="shell-sidebar"/g) ?? []).length, 1, screen)
      assert.equal((output.match(/data-flow="shell-header"/g) ?? []).length, 1, screen)
      assert.equal((output.match(/data-flow="search-trigger"/g) ?? []).length, 1, screen)
      assert.ok(output.indexOf('data-flow-chrome="tabs"') < output.indexOf('data-ket-island'), screen)
      assert.doesNotMatch(
        content,
        /shell-header|shell-sidebar|project-views|scope-tabs|type="search"/,
        screen,
      )
      assert.doesNotMatch(output, /data-flow="task-row"|data-flow="doc-editable"/, screen)
      for (const task of value?.tasks ?? []) assert.ok(!output.includes(task.title), `${screen}: ${task.id}`)
    } finally {
      workspace.dispose()
    }
  }
})

test('project tabs and workspace management tabs are SSR while content starts with only loading', () => {
  for (const [screen, marker] of [
    ['board', 'project-views'],
    ['project-profile', 'project-views'],
    ['workspace-members', 'scope-tabs'],
    ['page', 'project-views'],
  ]) {
    const fixture = createOrganizationSession('baseline', screen)
    const initialShellData = fixture.call('flow.workspace.bootstrap', {
      companyId: 'demo',
      workspaceId: 'product',
      projectId: 'core',
      route: screen,
    }).value
    const workspace = createFlowWorkspace(
      { serverShell: true, screen, project: 'core', workspaceId: 'product' },
      { initialShellData },
    )
    try {
      assert.match(
        renderToStaticString(workspace.shellView(html`<div>Data region</div>`)),
        new RegExp(`data-flow="${marker}"`),
      )
    } finally {
      workspace.dispose()
    }
    const client = createFlowWorkspace({ serverShell: true, screen })
    try {
      const output = renderToStaticString(client.view())
      assert.match(output, /data-flow="loading"/)
      assert.doesNotMatch(output, /shell-header|shell-sidebar|scope-tabs|project-views/)
    } finally {
      client.dispose()
    }
  }
})

test('a modal URL retains its authorized background for SSR reload and rejects foreign backgrounds', () => {
  const fixture = createOrganizationSession('baseline', 'project-new')
  const chrome = flowShellData(
    fixture.call('flow.workspace.bootstrap', {
      companyId: 'demo',
      workspaceId: 'product',
      route: 'project-new',
    }).value,
  )
  for (const [background, valid] of [
    ['/flow/board?company=demo&workspace=product&project=core&q=handoff&group=priority', true],
    ['https://foreign.example/flow/board?company=demo', false],
    ['/flow/board?company=other', false],
    ['/flow/issue-new?company=demo', false],
  ]) {
    const workspace = createFlowWorkspace({
      serverShell: true,
      chrome,
      companyId: 'demo',
      workspaceId: 'product',
      screen: 'project-new',
      background,
    })
    try {
      const output = renderToStaticString(workspace.shellView(workspace.view()))
      assert.equal(output.includes('data-flow="project-views"'), valid, background)
      assert.doesNotMatch(output, /data-flow="task-row"/)
    } finally {
      workspace.dispose()
    }
  }
})

test('direct board-move fallback binds the authorized project before the initial shell render', () => {
  const fixture = createOrganizationSession('board-blocked', 'board-move')
  const chrome = flowShellData(
    fixture.call('flow.workspace.bootstrap', {
      companyId: 'demo',
      workspaceId: 'product',
      project: 'core',
      route: 'board-move',
    }).value,
  )
  for (const background of [undefined, '/flow/board?company=foreign&project=ops']) {
    const client = createFlowWorkspace({
      serverShell: true,
      chrome,
      screen: 'board-move',
      companyId: 'demo',
      workspaceId: 'product',
      project: 'core',
      record: 'KV-131',
      background,
    })
    try {
      const output = renderToStaticString(client.shellView(client.view()))
      assert.match(output, /data-flow="project-views"/)
      assert.match(output, /project=core/)
      assert.doesNotMatch(output, /project=ops|company=foreign/)
      assert.doesNotMatch(output, /data-flow="task-row"/)
    } finally {
      client.dispose()
    }
  }
})

test('project document SSR chrome includes library return navigation before its data read', () => {
  const fixture = createOrganizationSession('baseline', 'page')
  const chrome = flowShellData(
    fixture.call('flow.workspace.bootstrap', {
      companyId: 'demo',
      workspaceId: 'product',
      projectId: 'core',
      route: 'page',
      shellOnly: true,
    }).value,
  )
  const workspace = createFlowWorkspace(
    {
      serverShell: true,
      chrome,
      companyId: 'demo',
      workspaceId: 'product',
      project: 'core',
      scope: 'project',
      screen: 'page',
      returnTo: '/flow/all-pages?visibility=private&projectFilter=core',
    },
    { initialShellData: chrome },
  )
  try {
    const output = renderToStaticString(workspace.shellView(html`<div>Primary data</div>`))
    assert.ok(output.includes('Back to library'))
    assert.ok(!output.includes('data-flow="live-doc"'))
  } finally {
    workspace.dispose()
  }
})

test('the authorized shell read preserves primary-data failure/recovery fixtures and never bypasses denial', () => {
  const args = { companyId: 'demo', workspaceId: 'product', projectId: 'core', route: 'board' }
  const fixture = createOrganizationSession('error', 'board')
  const metadata = fixture.call('flow.workspace.bootstrap', { ...args, shellOnly: true })
  assert.ok(flowShellData(metadata.value)?.projects.length)
  assert.equal(fixture.call('flow.workspace.bootstrap', args).value.errors[0].code, 'unavailable')
  assert.ok(fixture.call('flow.workspace.bootstrap', args).value.tasks.length)
  const conflict = createOrganizationSession('conflict', 'board')
  assert.equal(conflict.call('flow.workspace.bootstrap', { ...args, shellOnly: true }).value.problem, null)
  assert.equal(conflict.call('flow.workspace.bootstrap', args).value.problem.code, 'conflict')
  const denied = createOrganizationSession('forbidden', 'board')
  assert.equal(
    denied.call('flow.workspace.bootstrap', { ...args, shellOnly: true }).value.errors[0].code,
    'forbidden',
  )
})

test('workspace documents have a library action and chrome carries ownership without document content', () => {
  const fixture = createOrganizationSession('baseline', 'all-pages')
  const chrome = flowShellData(
    fixture.call('flow.workspace.bootstrap', {
      companyId: 'demo',
      workspaceId: 'product',
      route: 'all-pages',
    }).value,
  )
  for (const page of chrome.pages)
    assert.ok(Object.keys(page).every((key) => ['id', 'projectId'].includes(key)))
  const workspace = createFlowWorkspace({
    serverShell: true,
    chrome,
    companyId: 'demo',
    workspaceId: 'product',
    screen: 'page',
    scope: 'workspace',
    project: '',
  })
  try {
    const output = renderToStaticString(workspace.shellView(workspace.view()))
    assert.match(output, /Document library/)
    assert.doesNotMatch(output, /data-flow="project-views"|data-flow="doc-editable"/)
  } finally {
    workspace.dispose()
  }
})
