import assert from 'node:assert/strict'
import test from 'node:test'
import { navigablePage, NAVIGATION_TYPE } from '@ketvietlab/ketjs'
import { html, renderIsland, renderToString, trustedMarkup } from '@ketvietlab/ketjs-view'
import { createFlowWorkspace } from '../dist/workspace.mjs'
import { flowShellData } from '../dist/shell-model.mjs'
import { createOrganizationSession } from '../atlas/organization-store.mjs'

function screen(fixture, route, project) {
  const chrome = flowShellData(
    fixture.call('flow.workspace.bootstrap', {
      shellOnly: true,
      companyId: 'demo',
      workspaceId: 'product',
      route,
      projectId: project,
    }).value,
  )
  const props = {
    serverShell: true,
    companyId: 'demo',
    workspaceId: 'product',
    screen: route,
    project: project ?? '',
    scope: project ? 'project' : 'workspace',
    chrome,
  }
  const island = renderIsland('flow.workspace', createFlowWorkspace, props, {
    tag: 'div',
    key: ['companyId', 'workspaceId'],
  })
  const controller = createFlowWorkspace(props, { initialShellData: chrome })
  return { controller, island }
}

test('SSR navigation replaces only header, tabs and primary data; sidebar stays outside the protocol', () => {
  const fixture = createOrganizationSession('baseline', 'my-work')
  for (const [route, project] of [
    ['my-work'],
    ['workspace-overview'],
    ['board', 'core'],
    ['pages', 'core'],
  ]) {
    const { controller, island } = screen(fixture, route, project)
    try {
      const result = navigablePage(
        { headers: { 'x-ket-navigation': 'fragment-v1' } },
        {
          title: 'Flow',
          document: () => {
            throw new Error('a fragment must not render a full document')
          },
          slots: controller.fragmentSlots(trustedMarkup(island)),
        },
      )
      assert.equal(result.type, NAVIGATION_TYPE)
      assert.equal(result.headers.vary, 'X-Ket-Navigation')
      assert.deepEqual(
        [...result.body.matchAll(/<template data-ket-slot="([^"]+)"/g)].map((m) => m[1]),
        ['flow.header', 'flow.tabs', 'flow.content'],
      )
      assert.doesNotMatch(
        result.body,
        /shell-sidebar|search-trigger|type="search"|data-flow="task-row"|data-flow="doc-editable"/,
      )
      // Both representations must retain exactly the same hydration markers.
      const regions = controller.chromeRegions()
      for (const name of ['header', 'tabs']) {
        const body = result.body.match(
          new RegExp(`<template data-ket-slot="flow.${name}">([\\s\\S]*?)</template>`),
        )[1]
        assert.equal(body, renderToString(html`${regions[name]}`), `${route}: ${name}`)
      }
    } finally {
      controller.dispose()
    }
  }
})

test('navigation keeps one island identity within a workspace, independently of the route or project', () => {
  const fixture = createOrganizationSession('baseline', 'my-work')
  const keys = []
  for (const [route, project] of [['my-work'], ['board', 'core'], ['board', 'docs'], ['pages', 'core']]) {
    const { controller, island } = screen(fixture, route, project)
    try {
      assert.equal(typeof controller.update, 'function')
      keys.push(island.match(/data-key="([^"]+)"/)[1])
    } finally {
      controller.dispose()
    }
  }
  assert.equal(new Set(keys).size, 1)
})

test('direct GET retains the complete SSR document and native navigation fallback', () => {
  const fixture = createOrganizationSession('baseline', 'board')
  const { controller, island } = screen(fixture, 'board', 'core')
  try {
    const result = navigablePage(
      { headers: {} },
      {
        title: 'Flow',
        document: () => html`<html><body>${controller.shellView(trustedMarkup(island))}</body></html>`,
        slots: controller.fragmentSlots(trustedMarkup(island)),
      },
    )
    assert.match(result.body, /^<!doctype html>/)
    assert.match(result.body, /shell-sidebar/)
    assert.match(result.body, /data-ket-slot="flow.header"/)
    assert.match(result.body, /data-flow="project-views"/)
    assert.doesNotMatch(result.body, /data-flow="task-row"/)
  } finally {
    controller.dispose()
  }
})
