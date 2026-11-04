import assert from 'node:assert/strict'
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { buildDesignSystemStyles } from '../tools/build-design-system-styles.mjs'

const FONTS = 'packages/design-system/src/foundations/fonts'
// Inter is the only bundled family. KÉT Sans stays first in --kv-font-sans for Két Việt
// products that register it themselves; esbuild writes É as the CSS escape \c9.
const FACES = [
  { file: 'InterVariable.woff2', family: 'Inter', weight: '100 900', style: 'normal' },
  { file: 'InterVariable-Italic.woff2', family: 'Inter', weight: '100 900', style: 'italic' },
]

test('public stylesheet embeds every Inter face when served at a relocated CSS URL', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'ket-font-styles-'))
  try {
    const output = join(dir, 'content-hash', 'styles.css')
    await buildDesignSystemStyles(output)
    const css = await readFile(output, 'utf8')
    const faces = css.match(/@font-face\{[^}]+\}/gu) ?? []
    assert.equal(faces.length, FACES.length)
    for (const [index, { file, family, weight, style }] of FACES.entries()) {
      const face: string = faces[index]
      assert.ok(face.includes(`font-family:${family};`), `${file} is registered as ${family}`)
      assert.match(face, new RegExp(`font-weight:${weight};`, 'u'))
      assert.match(face, /font-display:swap;/u)
      assert.match(face, new RegExp(`font-style:${style};`, 'u'))
      assert.doesNotMatch(face, /local\(/u)
      const embedded: RegExpMatchArray | null = face.match(/url\(data:font\/woff2;base64,([A-Za-z\d+/=]+)\)/u)
      assert.ok(embedded, 'font must not resolve relative to the runtime stylesheet URL')
      const source = await readFile(`${FONTS}/${file}`)
      assert.equal(source.subarray(0, 4).toString(), 'wOF2')
      assert.deepEqual(Buffer.from(embedded[1], 'base64'), source)
    }
    assert.match(css, /--kv-font-sans: "K\\c9T Sans", "Inter", /u)
    assert.match(css, /font-optical-sizing:auto/u)
    const backend = await readFile('packages/ketsuite/src/modules/backend/index.ts', 'utf8')
    assert.match(backend, /import\.meta\.resolve\('@ketvietlab\/design-system\/styles\.css'\)/u)
    assert.match(backend, /styles:\s*\[\s*designSystemStyles,/u)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

// KÉT Sans may not be redistributed, so the public package must not carry it in any form.
test('design system ships Inter under OFL-1.1 and no KÉT Sans', async () => {
  assert.deepEqual((await readdir(FONTS)).sort(), [
    'InterVariable-Italic.woff2',
    'InterVariable.woff2',
    'LICENSE.txt',
    'README.md',
  ])
  const tokens = await readFile('packages/design-system/src/foundations/tokens.css', 'utf8')
  const families = [...tokens.matchAll(/@font-face\s*\{[^}]*font-family:\s*"([^"]+)"/gu)].map(
    (face) => face[1],
  )
  assert.deepEqual([...new Set(families)], ['Inter'])
  const manifest = JSON.parse(await readFile('packages/design-system/package.json', 'utf8'))
  assert.equal(manifest.license, 'MIT AND ISC AND OFL-1.1')
  const notice = await readFile('packages/design-system/LICENSE', 'utf8')
  assert.match(notice, /SIL Open Font License, Version 1\.1/u)
  assert.doesNotMatch(notice, /KÉT Sans/u)
})
