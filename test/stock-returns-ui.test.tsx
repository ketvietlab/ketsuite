import assert from 'node:assert/strict'
import { test } from 'node:test'
import { renderToString, type TemplateResult } from '@ketvietlab/ketjs-view'
import { transferModalDefinition } from '../packages/ketsuite/src/modules/stock_backend/modal/transfer-view.tsx'

type Context = Parameters<NonNullable<typeof transferModalDefinition.actions>>[0]
const context = (record: Record<string, unknown>, permissions: Record<string, boolean>): Context =>
  ({
    kind: 'stock.transfer',
    id: 'delivery',
    creating: false,
    data: { record: { id: 'delivery', moves: [], ...record }, choices: {}, permissions },
    draft: (_key: string, fallback: string) => fallback,
    draftChecked: (_key: string, _unused: unknown, fallback: boolean) => fallback,
    fieldError: () => undefined,
    t: (key: string) => key,
    busy: false,
  }) as unknown as Context

const actions = (record: Record<string, unknown>, permissions: Record<string, boolean>) =>
  renderToString(transferModalDefinition.pageActions!(context(record, permissions)) as TemplateResult)

test('K19 a completed delivery with goods left offers Return to whoever may create transfers', () => {
  const offered = actions({ state: 'done', returnable: true }, { createReturn: true })
  assert.match(offered, /data-record-command="return"|name="__command" value="return"/)
  assert.match(offered, /stock_backend\.action\.return/)
  for (const html of [
    actions({ state: 'done', returnable: true }, { createReturn: false }),
    actions({ state: 'done', returnable: false }, { createReturn: true }),
  ])
    assert.doesNotMatch(html, /stock_backend\.action\.return/)
  const command = transferModalDefinition.commands!.return!
  const input = command.input(new FormData(), context({ state: 'done' }, {}), {} as never)
  assert.equal(input.id, 'delivery')
  assert.match(String(input.returnId), /^[0-9a-f-]{36}$/)
  assert.notEqual(
    command.input(new FormData(), context({ state: 'done' }, {}), {} as never).returnId,
    input.returnId,
  )
})
