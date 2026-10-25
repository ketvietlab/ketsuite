import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'

const authored = import.meta.url.endsWith('.ts')
const root = fileURLToPath(new URL(authored ? '../' : '../../', import.meta.url))
const audit = fileURLToPath(
  new URL(authored ? '../tools/zero-dep-audit.ts' : '../tools/zero-dep-audit.js', import.meta.url),
)
const manifest = JSON.parse(readFileSync(join(root, 'packages/ketsuite/package.json'), 'utf8'))

function check(source: string) {
  const root = mkdtempSync(join(tmpdir(), 'website-studio-dependency-'))
  try {
    writeFileSync(join(root, 'package.json'), JSON.stringify({ private: true }))
    for (const name of ['design-system', 'ketspec', 'ketsuite', 'flow-client', 'flow-ui']) {
      const dir = join(root, 'packages', name)
      mkdirSync(join(dir, 'src'), { recursive: true })
      writeFileSync(join(dir, 'package.json'), JSON.stringify(name === 'ketsuite' ? manifest : {}))
    }
    writeFileSync(join(root, 'packages/ketsuite/src/consumer.ts'), source)
    return spawnSync(process.execPath, [audit], { cwd: root, encoding: 'utf8' })
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
}

test('Website Studio SSR dependency is declared and its public entry is accepted', () => {
  assert.equal(manifest.dependencies['@ketvietlab/website-client'], manifest.version)
  const result = check("import { createWebsiteStudio } from '@ketvietlab/website-client'\n")
  assert.equal(result.status, 0, result.stderr)
})

test('Website Studio dependency does not allow private implementation imports', () => {
  const result = check("import { createWebsiteStudio } from '@ketvietlab/website-client/client/studio'\n")
  assert.equal(result.status, 1)
  assert.match(result.stderr, /must use the public entry/)
})

test('Website Studio dependency does not allow unrelated external imports', () => {
  const result = check("import anything from 'unapproved-renderer'\n")
  assert.equal(result.status, 1)
  assert.match(result.stderr, /may only reach/)
})
