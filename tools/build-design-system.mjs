// Scoped producer build for native consumers (Phoenix) and the KetAtlas renderer.
// It uses canonical source and emits the same public package, without compiling
// unrelated KetSuite deployments. Never copies a second component implementation.
import { cpSync, mkdirSync, readdirSync, rmSync, chmodSync } from 'node:fs'
import { dirname, extname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'
import { buildDesignSystemStyles } from './build-design-system-styles.mjs'
import { buildDesignSystemAtlasRuntime } from './build-design-system-atlas-runtime.mjs'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const stage = join(root, `.design-system-build-${process.pid}`)
const assets = new Set(['.css', '.json', '.mjs', '.woff2', '.svg', '.png', '.txt'])
/** @param {string} source @param {string} destination */
const copyAssets = (source, destination) => {
  for (const entry of readdirSync(source, { withFileTypes: true })) {
    const from = join(source, entry.name)
    const to = join(destination, entry.name)
    if (entry.isDirectory()) copyAssets(from, to)
    else if (assets.has(extname(entry.name))) {
      mkdirSync(dirname(to), { recursive: true })
      cpSync(from, to)
    }
  }
}
try {
  await buildDesignSystemAtlasRuntime()
  const result = spawnSync(
    join(root, 'node_modules/.bin/tsc'),
    ['-p', 'tsconfig.design-system.json', '--outDir', stage],
    { cwd: root, stdio: 'inherit' },
  )
  if (result.error) throw result.error
  if (result.status !== 0) throw new Error('Scoped design-system compilation failed')
  copyAssets(join(root, 'packages/design-system/src'), stage)
  await buildDesignSystemStyles(join(stage, 'styles.css'))
  for (const cli of ['atlas-cli.js', 'layout-audit-cli.js']) chmodSync(join(stage, cli), 0o755)
  const dist = join(root, 'packages/design-system/dist')
  rmSync(dist, { recursive: true, force: true })
  cpSync(stage, dist, { recursive: true })
  console.log('Built canonical public design-system only')
} finally {
  rmSync(stage, { recursive: true, force: true })
}
