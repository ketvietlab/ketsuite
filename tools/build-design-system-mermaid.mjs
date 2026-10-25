import { build } from 'esbuild'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
export async function buildDesignSystemMermaid() {
  await build({
    entryPoints: { mermaid: join(root, 'apps/design-system/mermaid-vendor.ts') },
    outdir: join(root, '.build/apps/design-system/vendor'),
    bundle: true,
    splitting: true,
    format: 'esm',
    platform: 'browser',
    target: 'es2022',
    outExtension: { '.js': '.mjs' },
    minify: true,
    logLevel: 'warning',
  })
}
if (import.meta.url === `file://${process.argv[1]}`) {
  await buildDesignSystemMermaid()
  console.log('Built the catalogue Mermaid adapter and lazy diagram chunks.')
}
