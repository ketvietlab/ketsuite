import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { Translator } from '@ketvietlab/ketjs'
import { renderToString } from '@ketvietlab/ketjs-view'
import { contextScreen } from '../packages/ketsuite/src/modules/user_backend/screens/index.ts'

const translate = ((key: string) => key) as Translator
translate.locale = 'en'
translate.has = () => true
translate.resolves = () => true

test('working context chooses one company and reads only its branches', () => {
  const html = renderToString(
    contextScreen(
      translate,
      {},
      {
        companies: [
          { id: 'acme', code: 'ACME', name: 'ACME' },
          { id: 'globex', code: 'GLOBEX', name: 'Globex' },
        ],
        branches: [
          { id: 'root:acme', companyId: 'acme', code: 'ROOT', name: 'Root', isRoot: true },
          { id: 'root:globex', companyId: 'globex', code: 'ROOT', name: 'Root', isRoot: true },
        ],
        selectedBranches: ['root:acme'],
        companyId: 'acme',
        branchId: 'root:acme',
        action: '/admin/context?lang=en',
      },
    ),
  )
  assert.match(html, /data-ui="form-page" data-scope="working-context-page"/)
  assert.match(html, /id="working-context-form"/)
  assert.match(html, /name="action" value="save"/)
  assert.match(html, /type="submit"[^>]*form="working-context-form"/)
  assert.match(html, /<select[^>]*name="companyId"/)
  // A session works in one company: there is nothing to tick for another one.
  assert.doesNotMatch(html, /name="company\./)
  assert.match(html, /name="branch\.root:acme"[^>]*checked/)
  assert.doesNotMatch(html, /name="branch\.root:globex"/)
  // The write branch may still name any company's branch; switching resolves it.
  assert.match(html, /<option value="root:globex"/)
})
