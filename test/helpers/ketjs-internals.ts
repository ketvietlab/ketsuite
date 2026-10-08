// A few KetSuite tests pin behaviour to KetJS internals its package exports do
// not name. They load the published dist files by path from the installed
// framework, so the instance is the one every public import already uses.
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const dist = (path: string): string => new URL(`./${path}`, import.meta.resolve('@ketvietlab/ketjs')).href

export const { validateInput } = (await import(
  dist('server/fn.js')
)) as typeof import('../../node_modules/@ketvietlab/ketjs/dist/server/fn.js')
export const { createContext } = (await import(
  dist('server/ctx.js')
)) as typeof import('../../node_modules/@ketvietlab/ketjs/dist/server/ctx.js')
export const { notificationHub } = (await import(
  dist('server/notify.js')
)) as typeof import('../../node_modules/@ketvietlab/ketjs/dist/server/notify.js')
export const { createTenants } = (await import(
  dist('server/tenants.js')
)) as typeof import('../../node_modules/@ketvietlab/ketjs/dist/server/tenants.js')

/** The emitted HTTP server module, read as text by tests that assert on its inline client bootstrap. */
export const httpServerSource = (): string => readFileSync(fileURLToPath(dist('server/http.js')), 'utf8')
