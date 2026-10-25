import { setFlowLocale } from '@ketvietlab/flow-client/i18n.mjs'
setFlowLocale('vi')
import test from 'node:test'
import assert from 'node:assert/strict'
import { commandResults } from '@ketvietlab/flow-client/command-search.mjs'
const data = {
  company: { name: 'Két Việt' },
  user: { id: 'u' },
  members: [{ id: 'u', role: 'member' }],
  workspaces: [{ id: 'w', title: 'Sản phẩm' }],
  projects: [{ id: 'p', title: 'Core', workspaceId: 'w' }],
  tasks: [
    { id: 'KV-142', title: 'Đồng bộ tồn phòng', projectId: 'p' },
    { id: 'KV-1', title: 'Lưu trữ', projectId: 'p', archived: true },
  ],
  pages: [
    { id: 'doc', title: 'Quy ước bàn giao', projectId: 'p' },
    { id: 'shared', title: 'Hướng dẫn chung', projectId: null, workspaceId: 'w' },
  ],
}
const search = (query, d = data) => commandResults(d, query, { workspaceId: 'w' }).flatMap((g) => g.items)
test('command search normalizes Vietnamese and resolves actual task/project/document destinations', () => {
  assert.equal(search('dong bo')[0].params.id, 'KV-142')
  assert.equal(search('KV-142')[0].route, 'issue')
  assert.deepEqual(search('quy uoc')[0].params, { id: 'doc', project: 'p', workspace: 'w', scope: 'project' })
  assert.equal(search('Core').find((x) => x.route === 'board').params.project, 'p')
  assert.equal(search('huong dan')[0].params.scope, 'workspace')
  assert.deepEqual(search('nothingmatches'), [])
  assert.deepEqual(search('Lưu trữ'), [])
})
test('command search keeps only available data and hides organization management for guests', () => {
  const guest = { ...data, members: [{ id: 'u', role: 'guest' }], tasks: [], pages: [], projects: [] }
  assert.deepEqual(search('KV-142', guest), [])
  assert.deepEqual(search('tổ chức', guest), [])
  assert.ok(!search('', guest).some((x) => x.route === 'workspace-overview'))
  assert.ok(search('cài đặt cá nhân', guest).length)
})
test('recent commands stay within authorized bootstrap and do not duplicate results', () => {
  const groups = commandResults(data, '', {
    workspaceId: 'w',
    recent: ['task:KV-142', 'task:outside', 'page:doc'],
  })
  assert.equal(groups[0].id, 'recent')
  assert.deepEqual(
    groups[0].items.map((x) => x.id),
    ['task:KV-142', 'page:doc'],
  )
  assert.equal(groups.flatMap((g) => g.items).filter((x) => x.id === 'task:KV-142').length, 1)
})

test('a large authorized collection yields a bounded set of distinct destinations', () => {
  const large = {
    ...data,
    tasks: Array.from({ length: 10000 }, (_, i) => ({
      id: `KV-${i}`,
      title: `Large match ${i}`,
      projectId: 'p',
    })),
  }
  const rows = search('Large match', large)
  assert.equal(rows.filter((x) => x.id.startsWith('task:')).length, 6)
  assert.equal(new Set(rows.map((x) => JSON.stringify([x.route, x.params]))).size, rows.length)
})
test('a saved view opens as the saved views screen opens it, for members and guests alike', async () => {
  const { routes } = await import('../dist/routes.mjs')
  const { organizationRoutes } = await import('../dist/organization-routes.mjs')
  const { operationRoutes } = await import('../dist/operations-state.mjs')
  const views = [{ id: 'v', title: 'Việc của tôi', projectId: 'p', query: 'tồn', status: 'progress' }]
  // A project opens on its default view, as from the sidebar.
  const listed = { ...data, projects: [{ ...data.projects[0], defaultView: 'project-issues' }] }
  assert.equal(search('Core', listed).find((x) => x.id === 'project:p')?.route, 'project-issues')
  assert.equal(search('Core').find((x) => x.id === 'project:p')?.route, 'board')
  for (const members of [data.members, [{ id: 'u', role: 'guest' }]]) {
    const items = search('', { ...data, members, views })
    const view = items.find((x) => x.id === 'view:v')
    assert.equal(view?.route, 'project-issues')
    assert.deepEqual(view.params, { project: 'p', view: 'v', q: 'tồn', status: 'progress' })
    // Every result opens a screen the client has.
    for (const item of items)
      assert.ok(
        routes[item.route] || organizationRoutes[item.route] || operationRoutes.has(item.route),
        `${item.id} opens ${item.route}`,
      )
  }
})
