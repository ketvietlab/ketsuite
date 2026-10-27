// The people list of KetSuite's own deployment (`/admin/users`, user_backend): a throwaway SQLite
// file seeded with two companies, a full administrator, 34 staff (so the list has two pages), a
// customer account, someone who has left and a role held by one person; served over it as the
// workspace does. Nothing here is real data.
import { spawn } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { callFn, compose, migrateOne, registerFunctions, sqliteAdapter } from '@ketvietlab/ketjs'
import { ketsuite } from '../../../.build/apps/ketsuite/deployment.js'

const root = resolve(fileURLToPath(new URL('../../..', import.meta.url)))
const runtime = mkdtempSync(join(tmpdir(), 'ketjs-user-list-e2e-'))
const database = join(runtime, 'users.sqlite')
const modules = [...ketsuite.modules, ...(ketsuite.theme ? [ketsuite.theme] : [])]
const manifest = compose(modules)
const adapter = sqliteAdapter(database)
const scope = {
  company: 'default',
  companies: ['default'],
  branch: 'root:default',
  branches: ['root:default'],
}

const call = async (name, input) => {
  const result = await callFn(name, input, { adapter, manifest, scope })
  if (result.value?.ok === false) throw new Error(`${name}: ${JSON.stringify(result.value.errors)}`)
  return result.value
}

const company = async (id, code, name) => {
  await call('partner.savePartner', { id: `${id}-party`, kind: 'company', name, ref: code })
  await call('company.saveCompany', { id, code, partnerId: `${id}-party`, currency: 'VND' })
}

const seed = async () => {
  await adapter.open()
  await migrateOne(adapter, manifest)
  registerFunctions(modules)
  await company('default', 'KET', 'Két Việt')
  await company('north', 'KBAC', 'Két Bắc')
  await call('user.createUser', {
    id: 'admin',
    login: 'admin',
    password: 'user-list-demo',
    name: 'Quản trị viên',
    defaultCompanyId: 'default',
    defaultBranchId: 'root:default',
    superuser: true,
  })
  await call('user.grantCompany', { id: 'admin:default', userId: 'admin', companyId: 'default' })
  await call('user.grantBranch', { id: 'admin:root:default', userId: 'admin', branchId: 'root:default' })
  for (let index = 1; index <= 34; index += 1) {
    const n = String(index).padStart(2, '0')
    await call('user.createUser', {
      id: `staff-${n}`,
      login: `nv${n}`,
      name: `Nhân viên ${n}`,
      email: `nv${n}@example.test`,
    })
    // The first five work at the second company only.
    const at = index <= 5 ? 'north' : 'default'
    await call('user.grantCompany', { id: `staff-${n}:${at}`, userId: `staff-${n}`, companyId: at })
  }
  await call('user.createUser', { id: 'guest', login: 'khach', name: 'Khách Cổng', accessKind: 'portal' })
  await call('user.createUser', { id: 'left', login: 'danghi', name: 'Người Đã Nghỉ' })
  await call('user.archiveUser', { id: 'left', active: false })
  await call('user.saveRole', { id: 'cashier', name: 'Thu ngân' })
  await call('user.assignRole', { id: 'cashier:staff-02', userId: 'staff-02', roleId: 'cashier' })
  await adapter.close()
}

await seed()
const child = spawn(
  process.execPath,
  [
    'node_modules/@ketvietlab/ketjs/dist/cli.js',
    'serve',
    '--workspace',
    '.build/ket.workspace.js',
    '--port',
    '4173',
  ],
  {
    cwd: root,
    stdio: 'inherit',
    env: {
      ...process.env,
      KET_SQLITE: database,
      KET_SECRET: 'user-list-e2e-secret',
      KET_LOCALE: 'vi',
      KET_FALLBACK_LOCALE: 'vi',
    },
  },
)

let stopping = false
const stop = (signal) => {
  if (stopping) return
  stopping = true
  child.kill(signal)
}

process.on('SIGINT', () => stop('SIGINT'))
process.on('SIGTERM', () => stop('SIGTERM'))
child.on('exit', (code) => {
  rmSync(runtime, { recursive: true, force: true })
  process.exit(code ?? 0)
})
