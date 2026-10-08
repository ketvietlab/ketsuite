import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { buildDesignSystemStyles } from '../tools/build-design-system-styles.mjs'

test('public stylesheet embeds both Inter faces when served at a relocated CSS URL', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'ket-inter-styles-'))
  try {
    const output = join(dir, 'content-hash', 'styles.css')
    await buildDesignSystemStyles(output)
    const css = await readFile(output, 'utf8')
    const faces = css.match(/@font-face\{[^}]+\}/gu) ?? []
    assert.equal(faces.length, 2)
    for (const [index, file] of ['InterVariable.woff2', 'InterVariable-Italic.woff2'].entries()) {
      const face: string = faces[index]
      assert.match(face, /font-family:Inter;/u)
      assert.match(face, /font-weight:100 900;/u)
      assert.match(face, /font-display:swap;/u)
      assert.match(face, new RegExp(`font-style:${index === 0 ? 'normal' : 'italic'};`, 'u'))
      assert.doesNotMatch(face, /local\(/u)
      const embedded: RegExpMatchArray | null = face.match(/url\(data:font\/woff2;base64,([A-Za-z\d+/=]+)\)/u)
      assert.ok(embedded, 'font must not resolve relative to the runtime stylesheet URL')
      const source = await readFile(`packages/design-system/src/foundations/fonts/${file}`)
      assert.equal(source.subarray(0, 4).toString(), 'wOF2')
      assert.deepEqual(Buffer.from(embedded[1], 'base64'), source)
    }
    const backend = await readFile('packages/ketsuite/src/modules/backend/index.ts', 'utf8')
    assert.match(backend, /import\.meta\.resolve\('@ketvietlab\/design-system\/styles\.css'\)/u)
    assert.match(backend, /styles:\s*\[\s*designSystemStyles,/u)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})
