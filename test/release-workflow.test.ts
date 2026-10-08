import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { test } from 'node:test'

const workflow = readFileSync(join(process.cwd(), '.github/workflows/verify.yml'), 'utf8')
const match = workflow.match(/node --input-type=module <<'JS'\n([\s\S]*?)\n\s+JS/u)
assert.ok(match, 'the verification gate must have an executable result check')
const code = match[1]!

function gate(overrides: Record<string, string> = {}, groups = true, base = 'master') {
  const jobs = {
    plan: { result: 'success', outputs: { has_groups: String(groups), permissions: 'true' } },
    quality: { result: 'success' },
    tests: { result: 'success' },
    postgres: { result: 'success' },
    'permission-coverage': { result: 'success' },
  }
  for (const [name, result] of Object.entries(overrides)) jobs[name as keyof typeof jobs].result = result
  return spawnSync(process.execPath, ['--input-type=module', '--eval', code], {
    encoding: 'utf8',
    env: { ...process.env, JOB_RESULTS: JSON.stringify(jobs), BASE_BRANCH: base },
  })
}

test('release gate accepts successful jobs and legitimately unselected test groups', () => {
  assert.equal(gate().status, 0)
  assert.equal(gate({ tests: 'skipped', postgres: 'skipped' }, false).status, 0)
})

test('release gate refuses failed, cancelled or disabled selected tests', () => {
  for (const result of ['failure', 'cancelled', 'skipped']) {
    assert.notEqual(gate({ tests: result }).status, 0)
    assert.notEqual(gate({ postgres: result }).status, 0)
  }
})

test('release gate requires its planner, quality and applicable permission check', () => {
  assert.notEqual(gate({ plan: 'failure' }).status, 0)
  assert.notEqual(gate({ quality: 'failure' }).status, 0)
  assert.notEqual(gate({ 'permission-coverage': 'skipped' }).status, 0)
  // Develop owns a separate permission-coverage workflow and required check.
  assert.equal(gate({ 'permission-coverage': 'skipped' }, true, 'develop').status, 0)
})
