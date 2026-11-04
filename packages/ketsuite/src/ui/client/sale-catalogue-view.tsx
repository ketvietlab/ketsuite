import { signal } from '@ketvietlab/ketjs-view'
import type { IslandController, IslandProps, JSXChild } from '@ketvietlab/ketjs-view'
import {
  Button,
  ContentCard,
  EmptyState,
  Grid,
  Icon,
  IconButton,
  Inline,
  LinkButton,
  Notice,
  Stack,
  Text,
  TextField,
} from '@ketvietlab/design-system'
import { callRecordFunction } from './record-modal.tsx'
import { addDecimals, compareDecimals, subtractDecimals } from '../../modules/account/money.ts'

type Row = Record<string, unknown>
export type SaleCatalogueData = {
  ok: boolean
  order: Row
  rows: Row[]
  total: number
  page: number
  pageSize: number
  categories: Row[]
  attributes: Row[]
}
export type SaleCatalogueProps = {
  id: string
  data: SaleCatalogueData
  editable: boolean
  filters: Row
  labels: Record<string, string>
  lang: string
  href: string
}

export function SaleCatalogueFilters(props: {
  action: string
  hidden: Record<string, string>
  search: string
  labels: Record<string, string>
  facets: JSXChild[]
}) {
  return (
    <form method="get" action={props.action}>
      {Object.entries(props.hidden).map(([name, value]) => (
        <input type="hidden" name={name} value={value} autocomplete="off" />
      ))}
      <Stack
        gap="compact"
        items={[
          <Grid
            columns={3}
            minimum="wide"
            items={[
              <TextField
                id="catalogue-search"
                name="search"
                label={props.labels.search!}
                value={props.search}
              />,
              ...props.facets,
            ]}
          />,
          <Inline items={[<Button type="submit" label={props.labels.filter!} variant="secondary" />]} />,
        ]}
      />
    </form>
  )
}

/** Shared revision for all cards. Server writes stay serialized and failed drafts remain editable. */
export function createSaleCatalogueView(props: SaleCatalogueProps): IslandController {
  const data = signal(props.data),
    busy = signal(false),
    problem = signal(''),
    needsReload = signal(false)
  const drafts = new Map<string, string>()
  const t = (key: string) => props.labels[key] ?? key
  let host: HTMLElement | undefined
  const showQuantity = (id: string, value: string) => {
    const input = host?.querySelector<HTMLInputElement>(`[id="${CSS.escape('quantity-' + id)}"]`)
    if (input) input.value = value
  }
  let stepForm: HTMLFormElement | null = null
  let lifetime: AbortSignal | undefined
  let active: AbortController | undefined
  const quantity = (row: Row) => drafts.get(String(row.id)) ?? String(row.quantity ?? '0')
  const editable = () =>
    props.editable &&
    !data().order.locked &&
    ['draft', 'sent', 'sale'].includes(String(data().order.state)) &&
    (!data().order.orderAuthority || data().order.orderAuthority === 'local')
  const save = async (id: string, value: string) => {
    if (!editable() || busy() || needsReload()) return
    const row = data().rows.find((row) => row.id === id)
    if (!row) return
    drafts.set(id, value)
    try {
      if (compareDecimals(value, '0') < 0) throw new Error('negative')
      if (compareDecimals(value, row.quantity ?? '0') === 0) return
    } catch {
      problem.set(t('invalidQuantity'))
      return
    }
    showQuantity(id, value)
    busy.set(true)
    problem.set('')
    active = new AbortController()
    try {
      const written = await callRecordFunction<{ revision: number }>(
        'sale.setCatalogueQuantity',
        {
          id: props.id,
          productId: id,
          quantity: value,
          expectedRevision: data().order.revision,
        },
        { signal: active.signal, idempotencyKey: crypto.randomUUID() },
      )
      if (lifetime?.aborted) return
      if (!written.ok) {
        problem.set(t('refused'))
        const fresh = await callRecordFunction<SaleCatalogueData>(
          'sale.getCatalogue',
          { id: props.id, ...props.filters },
          { signal: active.signal },
        )
        if (fresh.ok && fresh.value?.ok) data.set(fresh.value)
        return
      }
      const fresh = await callRecordFunction<SaleCatalogueData>(
        'sale.getCatalogue',
        { id: props.id, ...props.filters },
        { signal: active.signal },
      )
      if (!fresh.ok || !fresh.value?.ok) {
        problem.set(t('savedReload'))
        needsReload.set(true)
        return
      }
      drafts.delete(id)
      showQuantity(id, String(fresh.value.rows.find((row) => row.id === id)?.quantity ?? '0'))
      data.set(fresh.value)
    } catch {
      if (!lifetime?.aborted) {
        problem.set(t('connection'))
        needsReload.set(true)
      }
    } finally {
      if (!lifetime?.aborted) busy.set(false)
    }
  }
  const onInput = (event: Event) => {
    const input = event.target
    if (input instanceof HTMLInputElement && input.name === 'quantity') {
      const id = input.form?.dataset.sku
      if (id) drafts.set(id, input.value)
    }
  }
  const onSubmit = async (event: Event) => {
    const form = event.target
    if (!(form instanceof HTMLFormElement) || !form.dataset.sku) return
    event.preventDefault()
    if (busy() || needsReload()) return
    const button = (event as SubmitEvent).submitter
    const operation = button instanceof HTMLButtonElement ? button.value : ''
    let value = String(new FormData(form).get('quantity') ?? '0')
    try {
      if (operation === 'add') value = '1'
      if (operation === 'plus') value = addDecimals(value, '1')
      if (operation === 'minus') value = compareDecimals(value, '1') < 0 ? '0' : subtractDecimals(value, '1')
    } catch {
      problem.set(t('invalidQuantity'))
      return
    }
    // Moving directly to another card must save the previous draft before its command.
    for (const [id, pending] of [...drafts]) {
      if (id === form.dataset.sku) continue
      await save(id, pending)
      if (problem() || needsReload() || lifetime?.aborted) return
    }
    await save(form.dataset.sku, value)
  }
  const onKeyDown = (event: KeyboardEvent) => {
    const input = event.target
    if (
      !['Enter', 'Tab'].includes(event.key) ||
      !(input instanceof HTMLInputElement) ||
      input.name !== 'quantity' ||
      !input.form?.dataset.sku
    )
      return
    if (event.key === 'Enter') event.preventDefault()
    void save(input.form.dataset.sku, input.value)
  }
  const onPointerDown = (event: Event) => {
    const target = event.target
    stepForm =
      target instanceof Element
        ? (target.closest<HTMLButtonElement>('button[name="step"]')?.form ?? null)
        : null
  }
  const onBlur = (event: FocusEvent) => {
    const input = event.target
    if (!(input instanceof HTMLInputElement) || input.name !== 'quantity' || !input.form?.dataset.sku) return
    const next = event.relatedTarget
    const stepping =
      stepForm !== null ||
      (next instanceof HTMLButtonElement && next.name === 'step' && !!next.form?.dataset.sku)
    stepForm = null
    if (stepping) return
    void save(input.form.dataset.sku, input.value)
  }
  return {
    view: () => (
      <div aria-busy={busy() ? 'true' : null}>
        <Stack
          items={[
            !editable() ? <Notice title={t('readonly')} message="" /> : null,
            problem() ? <Notice title={problem()} message="" tone="danger" /> : null,
            needsReload() ? <LinkButton href={props.href} label={t('reload')} /> : null,
            data().rows.length ? (
              <Grid
                columns={3}
                minimum="wide"
                items={data().rows.map((row) => (
                  <ContentCard
                    title={String(row.name)}
                    eyebrow={String(row.code || '')}
                    selected={compareDecimals(row.quantity ?? '0', '0') > 0}
                    meta={
                      <Text variant="bodyMd">
                        {row.price == null
                          ? t('unavailable')
                          : new Intl.NumberFormat(props.lang === 'en' ? 'en-US' : 'vi-VN', {
                              style: 'currency',
                              currency: String(row.currency),
                            }).format(Number(row.price))}{' '}
                        / {String(row.unit)}
                      </Text>
                    }
                    actions={
                      editable() && compareDecimals(row.quantity ?? '0', '0') === 0 ? (
                        <Button
                          type="submit"
                          form={'catalogue-quantity-' + String(row.id)}
                          name="step"
                          value="add"
                          label={t('add')}
                          disabled={busy() || needsReload()}
                        />
                      ) : null
                    }
                    body={
                      editable() ? (
                        <form id={'catalogue-quantity-' + String(row.id)} data-sku={String(row.id)}>
                          <Inline
                            align="between"
                            wrap={false}
                            items={[
                              <IconButton
                                type="submit"
                                name="step"
                                value="minus"
                                label={t('minus') + ' · ' + String(row.name)}
                                icon={<Icon name="minus" />}
                                disabled={busy() || needsReload()}
                              />,
                              <TextField
                                id={'quantity-' + String(row.id)}
                                name="quantity"
                                label={t('quantity') + ' · ' + String(row.name)}
                                labelHidden
                                value={quantity(row)}
                                inputMode="decimal"
                                disabled={busy() || needsReload()}
                              />,
                              <IconButton
                                type="submit"
                                name="step"
                                value="plus"
                                label={t('plus') + ' · ' + String(row.name)}
                                icon={<Icon name="plus" />}
                                disabled={busy() || needsReload()}
                              />,
                            ]}
                          />
                        </form>
                      ) : (
                        <Text variant="bodyMd">
                          {t('quantity')}: {String(row.quantity)} {String(row.unit)}
                        </Text>
                      )
                    }
                  />
                ))}
              />
            ) : (
              <EmptyState title={t('empty')} message={t('emptyHelp')} />
            ),
          ]}
        />
      </div>
    ),
    mount: ({ root, lifetime: signal }) => {
      host = root as unknown as HTMLElement
      host.addEventListener('input', onInput, { signal })
      host.addEventListener('submit', onSubmit, { signal })
      host.addEventListener('focusout', onBlur, { signal })
      host.addEventListener('keydown', onKeyDown, { signal })
      host.addEventListener('pointerdown', onPointerDown, { signal, capture: true })
      lifetime = signal
      signal.addEventListener('abort', () => {
        active?.abort()
        host = undefined
      })
    },
  }
}
export const saleCatalogue = (props: IslandProps): IslandController =>
  createSaleCatalogueView(props as unknown as SaleCatalogueProps)
