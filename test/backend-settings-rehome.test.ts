import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { SettingsDirectoryModule } from '@ketvietlab/design-system'
import { rehome } from '../packages/ketsuite/src/modules/backend/settings.tsx'

const block = (id: string, links: string[]): SettingsDirectoryModule =>
  ({
    id,
    label: id,
    icon: null,
    links: links.map((link) => ({ id: link, label: link, href: `/${link}` })),
  }) as never
const shown = (modules: SettingsDirectoryModule[]) =>
  Object.fromEntries(modules.map((module) => [module.id, module.links.map((link) => link.id)]))

test('#1677 pricelists move to the Sales block when there is one, and stay under System otherwise', () => {
  assert.deepEqual(
    shown(
      rehome([block('admin.sale', ['sale.tags']), block('admin.config', ['pricing.lists', 'company.list'])]),
    ),
    { 'admin.sale': ['sale.tags', 'pricing.lists'], 'admin.config': ['company.list'] },
  )
  // A deployment without Sales (POS, office) keeps the entry where its own module put it.
  assert.deepEqual(shown(rehome([block('admin.config', ['pricing.lists', 'company.list'])])), {
    'admin.config': ['pricing.lists', 'company.list'],
  })
  // A block left empty by the move is not drawn.
  assert.deepEqual(
    shown(rehome([block('admin.sale', ['sale.tags']), block('admin.config', ['pricing.lists'])])),
    {
      'admin.sale': ['sale.tags', 'pricing.lists'],
    },
  )
})
