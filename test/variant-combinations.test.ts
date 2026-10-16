import assert from 'node:assert/strict'
import { test } from 'node:test'
import { variantCombinationPreview } from '../packages/ketsuite/src/ui/client/variant-combinations.ts'
const group = (id: string, count: number) => ({
  attributeId: id,
  values: Array.from({ length: count }, (_, i) => ({ valueId: `${id}-${i}` })),
})
test('variant previews keep combinations and exact boundary without materializing huge products', () => {
  assert.deepEqual(variantCombinationPreview([]), { overflow: false, combinations: [] })
  const result = variantCombinationPreview([group('a', 16), group('b', 16)])
  assert.equal(result.overflow, false)
  assert.equal(result.combinations.length, 256)
  assert.deepEqual(result.combinations.at(-1), { a: 'a-15', b: 'b-15' })
  assert.deepEqual(variantCombinationPreview([group('a', 17), group('b', 16)]), {
    overflow: true,
    combinations: [],
  })
  assert.deepEqual(variantCombinationPreview(Array.from({ length: 30 }, (_, i) => group(`g${i}`, 100))), {
    overflow: true,
    combinations: [],
  })
})
