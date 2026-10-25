import assert from 'node:assert/strict'
import { test } from 'node:test'
import { callFn, compose, migrateOne, registerFunctions, tableNameFor } from '@ketvietlab/ketjs'
import type { Adapter, Row } from '@ketvietlab/ketjs'
import { postgresAdapter } from '@ketvietlab/ketjs-postgres'
import {
  account,
  address,
  channelApi,
  company,
  partner,
  pos,
  posChannel,
  pricing,
  product,
  stock,
  uom,
  user,
  website,
} from '@ketvietlab/ketsuite'
import { adminUrl, live } from './postgres-live.ts'

const modules = [
  address,
  partner,
  company,
  user,
  website,
  channelApi,
  uom,
  product,
  pricing,
  stock,
  account,
  pos,
  posChannel,
]
const manifest = compose(modules, { headless: true, companies: true })
const scope = { company: 'acme', branches: null }
const call = (adapter: Adapter, name: string, input: Record<string, unknown>) =>
  callFn(name, input, { adapter, manifest, scope })

test('pos sync PostgreSQL: concurrent duplicate claims keep one durable command', live, async () => {
  const database = `ket_pos_sync_${process.pid}_${Date.now()}`
  const databaseUrl = new URL(adminUrl)
  databaseUrl.pathname = `/${database}`
  const admin = postgresAdapter(adminUrl.toString(), { max: 1 })
  const first = postgresAdapter(databaseUrl.toString(), { max: 2 })
  const second = postgresAdapter(databaseUrl.toString(), { max: 2 })
  await admin.open()
  try {
    await admin.exec(`CREATE DATABASE "${database}"`)
    await Promise.all([first.open(), second.open()])
    await migrateOne(first, manifest)
    registerFunctions(modules)
    const request = {
      id: 'sync-command-1',
      commandId: 'sync-command-1',
      deviceId: 'device-1',
      configId: 'shop',
      operatorId: 'cashier',
      sequence: 1,
      operation: 'pos.orders.create',
      aggregateType: 'order',
      aggregateId: 'local-order-1',
      aggregateRevision: 0,
      dependencyIds: [],
      capturedAt: new Date().toISOString(),
      idempotencyKey: 'sync-command-1',
      requestHash: 'same-request-hash',
      request: { aggregateId: 'local-order-1' },
    }
    // Force the winner to insert after the other connection read "no command",
    // but before that connection checks the device sequence. This interleaving
    // used to misclassify an identical claim as a sequence conflict.
    const missed = Promise.withResolvers<void>()
    const inserted = Promise.withResolvers<void>()
    let firstInvocation = true
    const definition = posChannel.functions!.claimSyncCommand!
    // KetJS binds handlers when it composes a manifest, so the paused claim is composed in.
    const pausedChannel: typeof posChannel = {
      ...posChannel,
      functions: {
        ...posChannel.functions,
        claimSyncCommand: {
          ...definition,
          handler: async (ctx, args) => {
            const hold = firstInvocation
            firstInvocation = false
            let paused = false
            const db = new Proxy(ctx.db, {
              get(target, property) {
                if (property !== 'select') return Reflect.get(target, property)
                return async (...input: Parameters<typeof target.select>) => {
                  const rows = await target.select(...input)
                  if (hold && !paused && input[0] === 'pos_channel.SyncCommand') {
                    paused = true
                    missed.resolve()
                    await inserted.promise
                  }
                  return rows
                }
              },
            })
            return definition.handler!({ ...ctx, db }, args)
          },
        },
      },
    }
    const held = compose(
      modules.map((module) => (module === posChannel ? pausedChannel : module)),
      { headless: true, companies: true },
    )
    const claim = (adapter: Adapter) =>
      callFn('pos_channel.claimSyncCommand', request, { adapter, manifest: held, scope })
    const follower = claim(second)
    await missed.promise
    const winner = await claim(first).finally(() => {
      inserted.resolve()
    })
    const results = [winner, await follower]
    const values = results.map((result) => result.value as Row)
    assert.equal(
      values.filter((value) => value.ok && value.replayed === false).length,
      1,
      JSON.stringify(values),
    )
    assert.equal(
      values.filter((value) => value.reason === 'command_in_flight').length,
      1,
      JSON.stringify(values),
    )
    const table = first.quoteIdent(tableNameFor('pos_channel.SyncCommand'))
    const commands = await first.all(
      `SELECT "commandId", state, attempts FROM ${table} WHERE "commandId" = $1`,
      ['sync-command-1'],
    )
    assert.deepEqual(
      commands.map((row) => ({ ...row, attempts: Number(row.attempts) })),
      [{ commandId: 'sync-command-1', state: 'processing', attempts: 1 }],
    )
    for (const [sequence, reason] of [
      [1, 'sequence_conflict'],
      [2, 'idempotency_conflict'],
    ] as const) {
      const conflict = await call(first, 'pos_channel.claimSyncCommand', {
        ...request,
        id: 'other-command',
        commandId: 'other-command',
        sequence,
      })
      assert.deepEqual(conflict.value, { ok: false, reason })
    }
  } finally {
    await Promise.all([first.close().catch(() => {}), second.close().catch(() => {})])
    await admin.exec(`DROP DATABASE IF EXISTS "${database}" WITH (FORCE)`).catch(() => {})
    await admin.close()
  }
})
