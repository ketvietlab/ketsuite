import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

// The commit-time checks for this tree, and the one place that says when each runs.
//
// Two hooks commit this source: the public repository's own `.githooks/pre-commit`
// and the Két Việt root hook, which owns `ketsuite/` while it is developed there.
// They used to be two scripts, and the Két Việt one ran a subset, so a tree it
// accepted could fail the public hook after export. Both now call this file, so
// whatever one accepts the other accepts too.
//
// A check runs when a changed path is one of its inputs. The design-system
// inventory takes most of the time and reads only the paths below, so a commit
// elsewhere does not pay for it. Biome reads the working tree, not the index:
// stage whole files. Anything that needs a build, a database or the test suite
// stays with CI and the release gates.

/** @typedef {'biome' | 'node'} Program */
/** @typedef {{ name: string, program: Program, args: string[] }} Check */

const SOURCE = /\.(?:[cm]?[jt]sx?)$/u

/** Every path `tools/design-system-inventory.mjs` reads. */
export const INVENTORY_INPUTS = [
  'packages/design-system/',
  'packages/ketsuite/src/ui/',
  'packages/ketsuite/src/modules/',
  'test/',
  'tools/design-system-inventory.mjs',
]

/**
 * Governance reads the design-system source and every source file outside it,
 * because a deep `@ketvietlab/design-system/...` import can appear anywhere.
 *
 * @param {string} path
 */
const governanceInput = (path) =>
  path.startsWith('packages/design-system/') ||
  SOURCE.test(path) ||
  path === 'tools/design-system-governance.mjs'

/**
 * The checks a set of changes needs, in the order they run.
 *
 * @param {readonly string[]} changes paths relative to this tree, deleted ones included
 * @param {{ all?: boolean, exists?: (path: string) => boolean }} [options]
 *   `all` checks the whole tree regardless of the changes, as the hook once did.
 * @returns {Check[]}
 */
export function planChecks(changes, { all = false, exists = existsSync } = {}) {
  const present = changes.filter((path) => exists(path))
  /** @type {Check[]} */
  const checks = []
  if (all || present.length) {
    const files = all ? [] : ['--no-errors-on-unmatched', ...present]
    checks.push({ name: 'formatting', program: 'biome', args: ['format', ...files] })
    checks.push({ name: 'lint', program: 'biome', args: ['lint', ...files] })
  }
  if (all || changes.length)
    checks.push({ name: 'terminology', program: 'node', args: ['tools/terminology-audit.mjs'] })
  if (all || changes.some((path) => INVENTORY_INPUTS.some((input) => path.startsWith(input))))
    checks.push({
      name: 'design-system inventory',
      program: 'node',
      args: ['tools/design-system-inventory.mjs', '--check'],
    })
  if (all || changes.some(governanceInput))
    checks.push({
      name: 'design-system governance',
      program: 'node',
      args: ['tools/design-system-governance.mjs'],
    })
  return checks
}

/**
 * The environment the checks run with, from the one Git gives a hook.
 *
 * A hook in a linked worktree inherits `GIT_DIR` without `GIT_WORK_TREE`, and Git
 * then takes the working directory for the top of the tree: from this
 * subdirectory every staged path would come back with the wrong prefix and every
 * audit that lists files would see the wrong tree. Git finds the repository from
 * the working directory instead; the index the commit is being built from is kept,
 * resolved first because it may be relative to where the hook started.
 *
 * @param {NodeJS.ProcessEnv} env
 * @param {string} cwd where the hook started
 * @returns {NodeJS.ProcessEnv}
 */
export function hookEnvironment(env, cwd) {
  const { GIT_DIR, GIT_WORK_TREE, GIT_PREFIX, ...rest } = env
  if (rest.GIT_INDEX_FILE) rest.GIT_INDEX_FILE = resolve(cwd, rest.GIT_INDEX_FILE)
  return rest
}

/** Staged paths under the working directory, relative to it, deletions and both sides of a rename included. */
export function stagedChanges() {
  const listed = spawnSync(
    'git',
    ['diff', '--cached', '--name-only', '--relative', '--no-renames', '--diff-filter=ACMRD', '-z'],
    { encoding: 'utf8' },
  )
  if (listed.error) throw listed.error
  if (listed.status !== 0) throw new Error(listed.stderr)
  return listed.stdout.split('\0').filter(Boolean)
}

/**
 * Runs every check, so one commit attempt reports every failure, and returns
 * whether all of them passed.
 *
 * @param {readonly Check[]} checks
 */
export function runChecks(checks) {
  const biome = 'node_modules/.bin/biome'
  if (checks.some((check) => check.program === 'biome') && !existsSync(biome)) {
    console.error(`pre-commit: ${biome} is missing; run \`npm ci\` in this tree first`)
    return false
  }
  let passed = true
  for (const check of checks) {
    console.log(`pre-commit: ${check.name}`)
    const program = check.program === 'biome' ? biome : process.execPath
    const result = spawnSync(program, check.args, { stdio: 'inherit' })
    if (result.error) throw result.error
    if (result.status !== 0) passed = false
  }
  if (!passed)
    console.error(
      'pre-commit: fix the failures above (`npm run format` rewrites formatting), then stage again',
    )
  return passed
}

if (process.argv[1]?.endsWith('precommit.mjs')) {
  const [mode, ...files] = process.argv.slice(2)
  if (mode !== '--staged' && mode !== '--all' && mode !== '--files') {
    console.error(
      'usage: node tools/precommit.mjs --staged | --all | --files <path relative to this tree>...',
    )
    process.exit(2)
  }
  // Every path above is relative to this tree, wherever the calling hook runs from;
  // the checks below inherit this environment.
  process.env = hookEnvironment(process.env, process.cwd())
  process.chdir(fileURLToPath(new URL('..', import.meta.url)))
  const changes = mode === '--staged' ? stagedChanges() : files
  if (!runChecks(planChecks(changes, { all: mode === '--all' }))) process.exitCode = 1
}
