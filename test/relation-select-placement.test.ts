import assert from 'node:assert/strict'
import { test } from 'node:test'
import { relationMenuPlacement } from '../packages/design-system/src/interactions/relation-select/placement.ts'

const place = (
  anchor: { left: number; right: number; top: number; bottom: number },
  width = 352,
  height = 360,
  rtl = false,
) =>
  relationMenuPlacement({
    anchor,
    width,
    height,
    viewport: { left: 0, top: 0, width: 390, height: 844 },
    gap: 4,
    inset: 8,
    rtl,
  })

test('relation menu fits narrow viewports without clipping the right edge', () => {
  const box = place({ left: 40, right: 366, top: 300, bottom: 332 })
  assert.deepEqual(box, { left: 30, top: 336, width: 352, maxHeight: 500 })
  assert.ok(box.left + box.width <= 382)
})

test('relation menu opens above a low trigger and bounds tall content', () => {
  const box = place({ left: 40, right: 366, top: 740, bottom: 772 }, 352, 900)
  assert.deepEqual(box, { left: 30, top: 8, width: 352, maxHeight: 728 })
})

test('relation menu honours RTL alignment and the visual viewport when a keyboard is open', () => {
  const box = relationMenuPlacement({
    anchor: { left: 100, right: 600, top: 220, bottom: 252 },
    width: 352,
    height: 360,
    viewport: { left: 0, top: 100, width: 720, height: 320 },
    gap: 4,
    inset: 8,
    rtl: true,
  })
  assert.deepEqual(box, { left: 248, top: 256, width: 352, maxHeight: 156 })
})

test('relation menu clamps oversized content and fractional geometry to whole CSS pixels', () => {
  const box = place({ left: 0.4, right: 390.4, top: 100.4, bottom: 132.4 }, 910, 200)
  assert.equal(box.width, 374)
  assert.equal(box.left, 8)
  assert.equal(box.top, 136)
})
