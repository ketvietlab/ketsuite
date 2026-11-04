// A document carries two dates, and the Vietnamese copy names them "Ngày chứng từ"
// and "Ngày hạch toán". "Ngày ghi sổ" reads as a third date that does not exist —
// a landed cost and a period-result entry both showed it for the accounting date.

import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { test } from 'node:test'

const root = 'packages/ketsuite/src/modules'

test('no screen names a document date anything but its document or accounting date', () => {
  const found: string[] = []
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name)
      if (entry.isDirectory()) walk(path)
      else if (/\.tsx?$/.test(entry.name))
        readFileSync(path, 'utf8')
          .split('\n')
          .forEach((line, index) => {
            if (/Ngày ghi sổ/i.test(line)) found.push(`${path}:${index + 1}`)
          })
    }
  }
  walk(root)
  assert.deepEqual(found, [])
})
