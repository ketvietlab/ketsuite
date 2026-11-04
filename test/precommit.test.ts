import assert from 'node:assert/strict'
import { test } from 'node:test'
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { hookEnvironment, INVENTORY_INPUTS, planChecks } from '../tools/precommit.mjs'

const every = ['formatting', 'lint', 'terminology', 'design-system inventory', 'design-system governance']
const names = (checks: ReturnType<typeof planChecks>) => checks.map((check) => check.name)
const present = () => true

test('a design-system change runs every check, and Biome sees only files that still exist', () => {
  const kept = 'packages/design-system/src/primitives/button/index.tsx'
  const removed = 'packages/design-system/src/primitives/button/legacy.css'
  const checks = planChecks([kept, removed], { exists: (path) => path === kept })
  assert.deepEqual(names(checks), every)
  assert.deepEqual(checks[0]?.args, ['format', '--no-errors-on-unmatched', kept])
  assert.deepEqual(checks[1]?.args, ['lint', '--no-errors-on-unmatched', kept])
})

test('a source change outside the inventory inputs skips the inventory', () => {
  assert.deepEqual(names(planChecks(['apps/admin/serve.ts'], { exists: present })), [
    'formatting',
    'lint',
    'terminology',
    'design-system governance',
  ])
})

test('documentation reaches formatting, lint and terminology only', () => {
  assert.deepEqual(names(planChecks(['docs/src/content/docs/ketsuite/crm.md'], { exists: present })), [
    'formatting',
    'lint',
    'terminology',
  ])
})

test('module and test changes reach the inventory, which counts their consumers and evidence', () => {
  for (const path of ['packages/ketsuite/src/modules/crm/models.ts', 'test/crm-pipeline.test.ts'])
    assert.ok(names(planChecks([path], { exists: present })).includes('design-system inventory'), path)
})

test('a deletion still runs the audits that read the deleted path', () => {
  assert.deepEqual(names(planChecks(['test/retired.test.ts'], { exists: () => false })), [
    'terminology',
    'design-system inventory',
    'design-system governance',
  ])
})

test('--all checks the whole tree, and no change checks nothing', () => {
  const all = planChecks([], { all: true })
  assert.deepEqual(names(all), every)
  assert.deepEqual(all[0]?.args, ['format'])
  assert.deepEqual(all[1]?.args, ['lint'])
  assert.deepEqual(planChecks([]), [])
})

test('every inventory input is a path in this tree', () => {
  for (const input of INVENTORY_INPUTS) assert.ok(existsSync(input), input)
})

test('the public hook runs this file, the same one the Két Việt hook runs', () => {
  assert.match(readFileSync('.githooks/pre-commit', 'utf8'), /^exec node tools\/precommit\.mjs --staged$/mu)
})

test('a hook environment drops the inherited repository and keeps an absolute index', () => {
  const env = hookEnvironment(
    {
      PATH: '/bin',
      GIT_DIR: '/repo/.git/worktrees/side',
      GIT_WORK_TREE: '/repo',
      GIT_PREFIX: '',
      GIT_INDEX_FILE: '.git/next-index.lock',
    },
    '/repo',
  )
  assert.deepEqual(env, { PATH: '/bin', GIT_INDEX_FILE: '/repo/.git/next-index.lock' })
})

test('in a linked worktree, staged paths come back relative to this tree', () => {
  const root = mkdtempSync(join(tmpdir(), 'ketsuite-precommit-'))
  try {
    const clean = hookEnvironment(process.env, root)
    delete clean.GIT_INDEX_FILE
    const git = (cwd: string, ...args: string[]) =>
      execFileSync('git', args, { cwd, encoding: 'utf8', env: clean }).trim()
    const main = join(root, 'main')
    const linked = join(root, 'linked')
    git(root, 'init', '-q', main)
    git(
      main,
      '-c',
      'user.name=fixture',
      '-c',
      'user.email=fixture@example.invalid',
      '-c',
      'core.hooksPath=/dev/null',
      'commit',
      '-q',
      '--allow-empty',
      '-m',
      'start',
    )
    git(main, 'worktree', 'add', '-q', '-b', 'side', linked)
    mkdirSync(join(linked, 'tree'))
    writeFileSync(join(linked, 'tree', 'staged.ts'), 'export {}\n')
    git(linked, 'add', 'tree/staged.ts')
    // What Git hands a pre-commit hook in a linked worktree.
    const gitDir = git(linked, 'rev-parse', '--absolute-git-dir')
    const inherited = { ...clean, GIT_DIR: gitDir, GIT_INDEX_FILE: join(gitDir, 'index') }
    const staged = (env: NodeJS.ProcessEnv) =>
      execFileSync('git', ['diff', '--cached', '--name-only', '--relative'], {
        cwd: join(linked, 'tree'),
        encoding: 'utf8',
        env,
      }).trim()
    assert.equal(staged(inherited), 'tree/staged.ts', 'the inherited environment misreads the prefix')
    assert.equal(staged(hookEnvironment(inherited, linked)), 'staged.ts')
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})
