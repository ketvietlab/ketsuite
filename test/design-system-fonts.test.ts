import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { buildDesignSystemStyles } from '../tools/build-design-system-styles.mjs'

// KÉT Sans first (Medium registered for 500 and 600), then the Inter faces that fill
// in the characters it does not draw. esbuild writes É as the CSS escape \c9.
const FACES = [
  { file: 'KETSansOptical-Light.woff2', family: 'K\\c9T Sans', weight: '300', style: 'normal' },
  { file: 'KETSansOptical-Regular.woff2', family: 'K\\c9T Sans', weight: '400', style: 'normal' },
  { file: 'KETSansOptical-Medium.woff2', family: 'K\\c9T Sans', weight: '500 600', style: 'normal' },
  { file: 'KETSansOptical-Bold.woff2', family: 'K\\c9T Sans', weight: '700', style: 'normal' },
  { file: 'InterVariable.woff2', family: 'Inter', weight: '100 900', style: 'normal' },
  { file: 'InterVariable-Italic.woff2', family: 'Inter', weight: '100 900', style: 'italic' },
]

test('public stylesheet embeds every KÉT Sans and Inter face when served at a relocated CSS URL', async () => {
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
      const source = await readFile(`packages/design-system/src/foundations/fonts/${file}`)
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
