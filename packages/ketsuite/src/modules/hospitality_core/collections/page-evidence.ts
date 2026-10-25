import { signal } from '@ketvietlab/ketjs-view'

/**
 * Another module's answer for the rows on screen (what a stay or a folio still owes): one read per page, asked after
 * the rows, the last known answers kept while the next arrives, so a payment taken on a record shows when the reader
 * comes back. A page left behind is aborted and its late answer ignored; a row the reply leaves out reads
 * `missing(id)`, a malformed one is dropped, and a failed read marks the page's rows `'failed'`.
 */
export function createPageEvidenceReader<T extends { id: string; known: boolean }>(options: {
  source: string
  fetch: typeof fetch
  missing: (id: string) => T
}) {
  const dues = signal<ReadonlyMap<string, T | 'failed'>>(new Map())
  let controller: AbortController | null = null
  const read = async (ids: string[]) => {
    controller?.abort()
    if (!ids.length) return
    const mine = new AbortController()
    controller = mine
    const settle = (answer: (id: string) => T | 'failed') => {
      const next = new Map(dues())
      for (const id of ids) next.set(id, answer(id))
      dues.set(next)
    }
    try {
      const response = await options.fetch(options.source, {
        method: 'POST',
        credentials: 'same-origin',
        signal: mine.signal,
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ ids }),
      })
      const reply = (await response.json().catch(() => null)) as {
        ok?: boolean
        value?: { rows?: unknown }
      } | null
      if (mine.signal.aborted) return
      if (!response.ok || !reply?.ok || !Array.isArray(reply.value?.rows))
        throw new Error('page evidence read failed')
      const byId = new Map(
        (reply.value.rows as T[])
          .filter((row) => row && typeof row.id === 'string' && typeof row.known === 'boolean')
          .map((row) => [row.id, row]),
      )
      settle((id) => byId.get(id) ?? options.missing(id))
    } catch {
      if (!mine.signal.aborted) settle(() => 'failed')
    }
  }
  return {
    dues,
    read,
    dispose: () => controller?.abort(),
  }
}
