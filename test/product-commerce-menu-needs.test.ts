// A Commerce menu entry that opens a screen names the function behind it. `/admin`
// sends a person to the first entry they may see; an entry without `needs` is seen
// by everyone, so a role with no part in it lands on a refusal (M2: Combo sent the
// tenant security administrator to a 403).

import assert from 'node:assert/strict'
import { test } from 'node:test'
import { compose } from '@ketvietlab/ketjs'
import { commerce } from '../packages/ketsuite/src/deployment.ts'

const modules = [...commerce.modules, ...(commerce.theme ? [commerce.theme] : []), ...(commerce.themes ?? [])]
const manifest = compose(modules, {
  headless: commerce.headless ?? false,
  companies: commerce.companies,
  modulePermissionDeclarations: commerce.permissions?.modules,
  roleTemplates: commerce.permissions?.roleTemplates,
})

test('commerce menus: every entry with a path names a function that exists', () => {
  const entries = Object.entries(manifest.menus).filter(([, menu]) => menu.path)
  assert.ok(entries.some(([key]) => key === 'admin.product.combos'))
  const missing = entries.filter(([, menu]) => !menu.needs).map(([key, menu]) => `${key} (${menu.by})`)
  assert.deepEqual(missing, [])
  const unknown = entries
    .filter(([, menu]) => menu.needs && !manifest.functions[menu.needs])
    .map(([key, menu]) => `${key} → ${menu.needs}`)
  assert.deepEqual(unknown, [])
  assert.equal(manifest.menus['admin.product.combos']?.needs, 'product_backend.searchCombos')
})
