import type { Translator } from '@ketvietlab/ketjs'
import type { JSXChild } from '@ketvietlab/ketjs-view'
import { ListPage } from '../../packages/ketsuite/src/ui/list-page.tsx'
import { bulkActions } from '../../packages/ketsuite/src/ui/chrome.tsx'
import { inline } from '../../packages/ketsuite/src/ui/primitives.tsx'

// The list page the bulk-selection tests render, on the server (test/) and in Chrome (test/browser/).
export const translate = ((key: string) => key) as Translator
translate.locale = 'en'
translate.has = () => true
translate.resolves = translate.has
export const selection = (id: string) => ({
  formId: id,
  action: '/bulk',
  hidden: { token: 'preserved' },
  actions: [{ id: 'archive', label: 'Archive' }],
})
export const page = (id: string, extra?: JSXChild, headerActions?: JSXChild) => (
  <ListPage
    variant="operational"
    context="Test"
    frame={{ chrome: { create: { path: '/new', label: 'Create' } } }}
    headerActions={headerActions}
    title={id}
    actions={inline([bulkActions(translate, selection(id)), extra])}
    body={<input type="checkbox" data-ui="row-select" form={id} name="ids" value={id} />}
  />
)
