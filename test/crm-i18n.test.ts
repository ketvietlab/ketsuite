import assert from 'node:assert/strict'
import { test } from 'node:test'
import { compose, formatMissing, missingMessages } from '@ketvietlab/ketjs'
import { ketsuite } from '../apps/ketsuite/deployment.ts'

test('crm i18n: every installed CRM screen and message has vi/en parity', () => {
  const modules = [...ketsuite.modules, ...(ketsuite.theme ? [ketsuite.theme] : [])]
  const gaps = missingMessages(compose(modules, { companies: true }), ['vi', 'en'])
  assert.deepEqual(gaps, {}, formatMissing(gaps))
})
