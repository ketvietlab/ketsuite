import assert from 'node:assert/strict'
import test from 'node:test'
import {
  createMermaidTheme,
  hasMermaidOverrides,
} from '../packages/design-system/src/runtime/mermaid-theme.js'

const palette = {
  background: '#ffffff',
  surface: '#f7f5f5',
  text: '#24262a',
  muted: '#5a5c63',
  line: '#74767b',
  accent: '#5145cd',
  accentSoft: '#efedfc',
  positive: '#1d5d3b',
  positiveSoft: '#ecf5ef',
  warning: '#8b5c12',
  warningSoft: '#fbf3e6',
  danger: '#b42318',
  dangerSoft: '#fef3f2',
  fontFamily: 'Inter, sans-serif',
  dark: false,
}

test('shared Mermaid gives process and outcome roles the same meaning on both themes', () => {
  for (const p of [
    palette,
    {
      ...palette,
      dark: true,
      background: '#191919',
      text: '#eeeeee',
      accentSoft: '#282743',
      warningSoft: '#413622',
      positiveSoft: '#203b2e',
      dangerSoft: '#442723',
    },
  ]) {
    const theme = createMermaidTheme(p)
    assert.equal(theme.themeVariables.darkMode, p.dark)
    assert.equal(theme.themeVariables.nodeBkg, p.accentSoft)
    assert.equal(theme.themeVariables.nodeTextColor, p.text)
    assert.equal(theme.themeVariables.actorBkg, p.accentSoft)
    assert.equal(theme.themeVariables.noteBkgColor, p.warningSoft)
    for (const role of /** @type {const} */ (['accent', 'positive', 'warning', 'danger'])) {
      // Stadiums and newer Mermaid shapes render paths, not just rectangles.
      assert.ok(theme.themeCSS.includes(`.node.kv-${role} path`))
      assert.ok(theme.themeCSS.includes(`fill: ${p[`${role}Soft`]}`))
    }
    assert.match(theme.themeCSS, /kv-decision[^}]+stroke-dasharray:/)
    assert.match(theme.themeCSS, /edgeLabel rect[^}]+rx:/)
  }
})

test('shared Mermaid keeps compact geometry and rounded connectors without HTML or content overrides', () => {
  const theme = createMermaidTheme(palette)
  assert.equal(theme.flowchart.curve, 'rounded')
  assert.ok(theme.flowchart.nodeSpacing >= 20 && theme.flowchart.nodeSpacing <= 28)
  assert.ok(theme.flowchart.rankSpacing >= 28 && theme.flowchart.rankSpacing <= 36)
  assert.equal(theme.securityLevel, 'strict')
  assert.equal(theme.htmlLabels, false)
  assert.equal(theme.flowchart.htmlLabels, false)
  for (const key of ['secure', 'theme', 'themeCSS', 'flowchart', 'layout'])
    assert.ok(theme.secure.includes(key))
  assert.equal(
    hasMermaidOverrides('flowchart TD\n A("Ready?"):::kv-decision -->|Yes| B(["Done"]):::kv-positive'),
    false,
  )
  for (const source of [
    '---\nconfig: {}\n---',
    '%%{init: {}}%%',
    'flowchart TD\nclassDef x fill:red',
    'flowchart TD\nclick A callback',
  ])
    assert.equal(hasMermaidOverrides(source), true)
})
