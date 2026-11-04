import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { renderToStaticString } from '@ketvietlab/ketjs-view'
import { Grid, SignatureBlock } from '@ketvietlab/design-system'

const sheet = readFileSync('packages/design-system/src/data-display/signature-block/styles.css', 'utf8')
const rule = (selector: string) => {
  const at = sheet.indexOf(`${selector} {`)
  assert.notEqual(at, -1, `missing rule ${selector}`)
  return sheet.slice(at, sheet.indexOf('}', at))
}

test('a signature block names who signs and how, then the known name', () => {
  const html = renderToStaticString(
    <SignatureBlock label="Storekeeper" hint="(Signature, full name)" name="Minh Tam Pham" />,
  )
  assert.match(html, /^<div data-ui="signature-block">/)
  assert.match(html, /<p data-ui="signature-block-label">Storekeeper<\/p>/)
  assert.match(html, /<p data-ui="signature-block-hint">\(Signature, full name\)<\/p>/)
  assert.match(html, /<p data-ui="signature-block-name">Minh Tam Pham<\/p>/)
  assert.doesNotMatch(html, /data-empty/)
})

test('without a name it leaves a line to write it on, and a hint only when given', () => {
  const html = renderToStaticString(<SignatureBlock label="Received by" />)
  assert.match(html, /<p data-ui="signature-block-name" data-empty="true"><\/p>/)
  assert.doesNotMatch(html, /signature-block-hint/)
  const row = renderToStaticString(
    <Grid
      columns={4}
      mobileColumns={2}
      items={[<SignatureBlock label="Prepared by" />, <SignatureBlock label="Storekeeper" />]}
    />,
  )
  assert.equal([...row.matchAll(/data-ui="signature-block"/g)].length, 2)
})

test('the room to sign and the line are the component’s, and a block keeps together in print', () => {
  assert.match(
    rule(':where([data-kv-design-system]) [data-ui="signature-block"]'),
    /--kv-signature-block-room: var\(--kv-space-16\)/,
  )
  assert.match(
    rule(':where([data-kv-design-system]) [data-ui="signature-block-name"]'),
    /margin: var\(--kv-signature-block-room\) 0 0;/,
  )
  assert.match(
    rule(':where([data-kv-design-system]) [data-ui="signature-block-name"][data-empty="true"]'),
    /border-block-end: 1px dotted var\(--kv-border-strong\)/,
  )
  assert.match(
    sheet,
    /@media print \{\s*:where\(\[data-kv-design-system\]\) \[data-ui="signature-block"\] \{\s*break-inside: avoid;/,
  )
})
