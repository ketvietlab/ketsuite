import { json } from '@ketvietlab/ketjs'
import type { RouteEntry, SessionContext } from '@ketvietlab/ketjs'

/** A session boundary, not a Flow authentication system. */
export const selectFlowContext: RouteEntry = {
  handler: (ctx) => async (url, req) => {
    if (req.method !== 'POST') return json({ ok: false }, { status: 405 })
    if (
      req.headers['sec-fetch-site'] === 'cross-site' ||
      (req.headers.origin && req.headers.origin !== url.origin)
    )
      return json({ ok: false }, { status: 403 })
    await ctx.scopeOf(url, req)
    const sessions = await ctx.sessionsOf(url, req)
    const record = await sessions?.of(req)
    if (!sessions || !record) return json({ ok: false }, { status: 401 })
    if (!req.headers['content-type']?.startsWith('application/json'))
      return json({ ok: false }, { status: 415 })
    const chunks: Uint8Array[] = []
    let size = 0
    for await (const chunk of req) {
      size += chunk.byteLength
      if (size > 4096) return json({ ok: false }, { status: 413 })
      chunks.push(chunk)
    }
    let input: unknown
    try {
      input = JSON.parse(Buffer.concat(chunks).toString('utf8'))
    } catch {
      return json({ ok: false }, { status: 400 })
    }
    if (!input || typeof input !== 'object' || Array.isArray(input))
      return json({ ok: false }, { status: 400 })
    const value = input as Record<string, unknown>
    if (
      Object.keys(value).some((key) => !['companyId', 'fromCompany'].includes(key)) ||
      typeof value.companyId !== 'string' ||
      !value.companyId ||
      typeof value.fromCompany !== 'string' ||
      !value.fromCompany
    )
      return json({ ok: false }, { status: 400 })
    if (record.company !== value.fromCompany && record.company !== value.companyId)
      return json({ ok: false, code: 'conflict' }, { status: 409 })
    const choices = (await ctx.call('user.contextOptions', { userId: record.userId }, url, req)) as {
      ok?: boolean
      companies?: Array<{ id: string }>
      branches?: Array<{ id: string; companyId: string; isRoot?: boolean }>
    }
    if (!choices.ok || !choices.companies?.some((c) => c.id === value.companyId))
      return json({ ok: false }, { status: 403 })
    if (record.company === value.companyId) return json({ ok: true })
    const branches = choices.branches ?? []
    const target =
      branches.find((b) => b.companyId === value.companyId && b.isRoot) ??
      branches.find((b) => b.companyId === value.companyId)
    if (!target) return json({ ok: false }, { status: 403 })
    const allowedCompanies = new Set(choices.companies.map((c) => c.id))
    const prepared = (await ctx.call(
      'user.prepareContext',
      {
        userId: record.userId,
        companyId: value.companyId,
        branchId: target.id,
        companies: [...new Set([...(record.companies ?? []), value.companyId])].filter((id) =>
          allowedCompanies.has(id),
        ),
        branches: [...new Set([...(record.branches ?? []), target.id])].filter((id) =>
          branches.some((b) => b.id === id),
        ),
        securityVersion: record.securityVersion,
      },
      url,
      req,
    )) as { ok?: boolean; context?: SessionContext }
    if (!prepared.ok || !prepared.context) return json({ ok: false }, { status: 403 })
    if (!(await sessions.update(record, prepared.context)))
      return json({ ok: false, code: 'conflict' }, { status: 409 })
    return json({ ok: true })
  },
}
