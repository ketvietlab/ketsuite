import assert from 'node:assert/strict'
import { test } from 'node:test'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

// The rules in lint/rules run inside Biome (editor, pre-commit hook, `npm run lint`).
// Each is checked here on its own, against the source it must flag and the source
// it must leave alone, so a Biome upgrade that changes GritQL cannot pass silently.

const rules = resolve('lint/rules')
const biome = resolve('node_modules/.bin/biome')

type Diagnostic = { category: string; message: string; location: { start: { line: number } } }

/** `rule:line` for every diagnostic one rule reports on one file. */
const findings = (rule: string, file: string, source: string): string[] => {
  const root = mkdtempSync(join(tmpdir(), 'ketsuite-lint-'))
  try {
    writeFileSync(
      join(root, 'biome.json'),
      JSON.stringify({
        root: true,
        linter: { enabled: true, rules: { preset: 'none' } },
        plugins: [join(rules, `${rule}.grit`)],
      }),
    )
    writeFileSync(join(root, file), source)
    const run = spawnSync(biome, ['lint', '--reporter=json', '--max-diagnostics=none', file], {
      cwd: root,
      encoding: 'utf8',
    })
    const report = JSON.parse(run.stdout) as { diagnostics: Diagnostic[] }
    return report.diagnostics.map((diagnostic) => {
      assert.ok(diagnostic.message.startsWith(`[ketsuite/${rule}] `), diagnostic.message)
      return `${rule}:${diagnostic.location.start.line}`
    })
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
}

test('no-raw-jsx-tag flags JSX elements, not a tag written inside a string', () => {
  const source = [
    "const help = 'mở<br>đóng'",
    'export const A = () => <div>{help}</div>',
    'export const B = () => <Section><br /></Section>',
    "const value = signal<string>('')",
  ].join('\n')
  assert.deepEqual(findings('no-raw-jsx-tag', 'screen.tsx', source), ['no-raw-jsx-tag:2', 'no-raw-jsx-tag:3'])
})

test('kit-component-as-jsx flags a kit component called as a function', () => {
  const source = [
    "export const A = () => section({ title: 'x' })",
    "export const B = () => <Section title='x' />",
    'export const C = () => ui.framedPage({})',
    'export const D = () => sectionTitle({})',
  ].join('\n')
  assert.deepEqual(findings('kit-component-as-jsx', 'screen.tsx', source), [
    'kit-component-as-jsx:1',
    'kit-component-as-jsx:3',
  ])
})

test('no-markup-in-html reads only the literal parts of an html template', () => {
  const source = `export const A = (x: string) => html\`<p>\${x}</p>\`
export const B = (x: string) => html\`\${x}\`
export const C = () => html\` data-ui="list" \`
export const D = (x: number) => html\`\${x} < 3\`
export const E = (x: string) => html\`\${x.length > 0 ? x : "<none>"}\`
export const F = () => css\`<p>\``
  assert.deepEqual(findings('no-markup-in-html', 'view.ts', source), [
    'no-markup-in-html:1',
    'no-markup-in-html:3',
  ])
})

test('no-shell-internals flags the shell joints and the navigation header', () => {
  const source = [
    "export const A = (ctx: Ctx) => ctx.joint('backend:nav.items')",
    "export const B = (ctx: Ctx) => ctx.joint('sales:list')",
    "export const C = () => document.querySelector('x-ket-navigation')",
    "export const D = (ctx: Ctx) => joint(ctx, 'backend:topbar.end')",
    "export const E = { fills: { 'backend:sidebar.foot': () => null } }",
  ].join('\n')
  assert.deepEqual(findings('no-shell-internals', 'screen.ts', source), [
    'no-shell-internals:1',
    'no-shell-internals:3',
    'no-shell-internals:4',
  ])
})

test('admin-route-uses-shell flags page() in a file that answers an /admin path', () => {
  const admin = [
    'export const routes = {',
    "  '/admin/sales': () => page({ body: '' }),",
    "  '/shop': () => page({ body: '' }),",
    '}',
  ].join('\n')
  assert.deepEqual(findings('admin-route-uses-shell', 'routes.ts', admin), [
    'admin-route-uses-shell:2',
    'admin-route-uses-shell:3',
  ])
  const storefront = ["export const routes = { '/administration': () => page({ body: '' }) }"].join('\n')
  assert.deepEqual(findings('admin-route-uses-shell', 'routes.ts', storefront), [])
})

test('every rule is wired into biome.json and reports under its own name', () => {
  const config = readFileSync('biome.json', 'utf8')
  for (const file of readdirSync(rules)) {
    const rule = file.replace(/\.grit$/u, '')
    assert.ok(config.includes(`"./lint/rules/${file}"`), `${file} is not in biome.json`)
    assert.ok(readFileSync(join(rules, file), 'utf8').includes(`message="[ketsuite/${rule}] `), file)
  }
})

test('the files that still write their own markup only shrink', () => {
  // Each was on tools/ui-audit.ts's pending list and says why with a
  // `biome-ignore-all lint/plugin/...` comment. Each is a job, not an exception:
  // empty this list, do not extend it.
  const listed = spawnSync('git', ['grep', '-l', 'biome-ignore-all lint/plugin/', '--', 'packages', 'apps'], {
    encoding: 'utf8',
  })
  const files = listed.stdout.split('\n').filter(Boolean)
  assert.ok(files.length <= 21, `${files.length} files suppress a kit rule:\n${files.join('\n')}`)
})
