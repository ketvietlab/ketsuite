import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createTestDeployment } from '@ketvietlab/ketjs/testing'
import { ketsuite } from '../apps/ketsuite/deployment.ts'
import type { RecordModalDefinition } from '../packages/ketsuite/src/ui/client/record-modal.tsx'
import { attributeModalDefinition } from '../packages/ketsuite/src/modules/product_backend/modal/attribute-modal-view.tsx'
import { templateModalDefinition } from '../packages/ketsuite/src/modules/product_backend/modal/product-modal-view.tsx'
import { vendorPricelistDefinition } from '../packages/ketsuite/src/modules/purchase_backend/modal/pricelist-view.tsx'
import { purchaseOrderModalDefinition } from '../packages/ketsuite/src/modules/purchase_backend/modal/order-modal-view.tsx'
import { invoicingPolicyDefinition } from '../packages/ketsuite/src/modules/sale_backend/modal/policy-view.tsx'
import { saleOrderModalDefinition } from '../packages/ketsuite/src/modules/sale_backend/modal/order-modal-view.tsx'
import { stockConfigurationDefinition } from '../packages/ketsuite/src/modules/stock_backend/modal/configuration-view.tsx'
import { inventoryCountDefinition } from '../packages/ketsuite/src/modules/stock_backend/modal/inventory-view.tsx'
import { transferModalDefinition } from '../packages/ketsuite/src/modules/stock_backend/modal/transfer-view.tsx'
import { accessPolicyModalDefinition } from '../packages/ketsuite/src/modules/user_backend/modal/access-policy-modal-view.tsx'
import { roleModalDefinition } from '../packages/ketsuite/src/modules/user_backend/modal/role-modal-view.tsx'
import {
  userModalDefinition,
  userPageDefinition,
} from '../packages/ketsuite/src/modules/user_backend/modal/user-modal-view.tsx'

const definitions = [
  attributeModalDefinition,
  templateModalDefinition,
  vendorPricelistDefinition,
  purchaseOrderModalDefinition,
  invoicingPolicyDefinition,
  saleOrderModalDefinition,
  ...['warehouse', 'location', 'picking-type', 'lot', 'route', 'replenishment'].map(
    stockConfigurationDefinition,
  ),
  inventoryCountDefinition,
  transferModalDefinition,
  accessPolicyModalDefinition,
  roleModalDefinition,
  userModalDefinition,
  userPageDefinition,
] as RecordModalDefinition<unknown>[]

// Internal and returning a one-time secret: a stored replay would keep the
// token. The command needs a trusted route before it can carry a key.
const pendingInternal = ['user.issueAuthToken']

test('every record command that writes calls a function that accepts its idempotency key', async (t) => {
  const app = await createTestDeployment(ketsuite, { worker: false })
  t.after(() => app.close())
  const functions = app.deployment.manifest.functions
  const keyed = new Set<string>()
  for (const definition of definitions)
    for (const command of Object.values(definition.commands ?? {})) {
      // The runtime sends a key with every call a command makes, except a preview.
      if (command.preview) continue
      const calls = [command.fn, ...(command.also ?? []).map((step) => step.fn)]
      for (const fn of calls) if (fn) keyed.add(fn)
    }
  const refused = [...keyed].filter(
    (fn) => functions[fn] && !functions[fn].idempotent && !pendingInternal.includes(fn),
  )
  assert.deepEqual(refused, [], 'declare these functions idempotent')
  for (const fn of pendingInternal) {
    assert.ok(keyed.has(fn), `${fn} is no longer a record command; drop it from pendingInternal`)
    assert.equal(functions[fn]?.exposure, 'internal', `${fn} is callable now; declare it idempotent`)
  }
  assert.ok(keyed.has('product.saveAttributeDraft'))
  assert.ok(keyed.size > 40, `only ${keyed.size} keyed functions found`)
})
