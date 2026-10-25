// The inbox shows a notification only for a record whose owner says who may read
// it (`InboxTargetPolicy`); mail never guesses another domain's record policy. A
// deployment names the records its collaboration lands on, so each product here
// binds the ones its modules post to.

import { from, inArray } from '@ketvietlab/ketjs'
import type { Ctx, KetModule } from '@ketvietlab/ketjs'
import { canReadCase, ownsKind } from '../modules/crm/index.ts'
import { canReadProject } from '../modules/flow/membership.ts'
import { mailWithTargets } from '../modules/mail/index.ts'
import type { InboxTargetPolicy } from '../modules/mail/index.ts'

type Target = {
  /** The function a reader must hold to see the record at all. */
  read: string
  /** Where the record opens, when it has a page of its own. */
  path?: string
  /** Narrower than the tenant read, when the domain has its own record policy. */
  readable?: (ctx: Ctx, row: Record<string, unknown>) => Promise<boolean>
  /** Further effects that record policy reads. */
  effects?: string[]
}

const targets = {
  'partner.Partner': { read: 'partner.listPartners', path: '/admin/partner/partners' },
  'product.Template': { read: 'product.getTemplate', path: '/admin/product/templates' },
  'stock.Picking': { read: 'stock.getPicking', path: '/admin/stock/transfers' },
  'sale.Order': { read: 'sale.getOrder', path: '/admin/sales/quotations' },
  // An event's reminder reaches whoever reads the company calendar.
  'calendar.Event': { read: 'calendar.listAgenda' },
  'crm.Case': {
    read: 'crm.case.get',
    path: '/admin/crm/cases',
    readable: async (ctx, row) => ownsKind(row.kind) && (await canReadCase(ctx, row)),
    effects: ['read:crm.Team', 'read:crm.TeamMember'],
  },
  'flow.Issue': {
    read: 'flow.issue.get',
    path: '/admin/flow/issues',
    readable: (ctx, row) => canReadProject(ctx, row.projectId),
    effects: [
      'read:flow.Project',
      'read:flow.ProjectMember',
      'read:flow.ProjectAccessGrant',
      'read:user.User',
    ],
  },
} satisfies Record<string, Target>

export type MailTarget = keyof typeof targets

/** The mail module, with an inbox that shows notifications on the named records. */
export function suiteMail(models: readonly MailTarget[]): KetModule {
  const policies: InboxTargetPolicy[] = models.map((model) => {
    const target: Target = targets[model]
    return {
      resModel: model,
      readFunction: target.read,
      effects: [`read:${model}`, ...(target.effects ?? [])],
      ...(target.path ? { href: (id: string) => `${target.path}/${encodeURIComponent(id)}` } : {}),
      visible: async (ctx, ids) => {
        const T = ctx.table(model)
        const rows = await ctx.db.all(from(T).where(inArray(T.id, ids)))
        const kept = []
        for (const row of rows) if (!target.readable || (await target.readable(ctx, row))) kept.push(row)
        return new Set(kept.map((row) => String(row.id)))
      },
    }
  })
  return mailWithTargets(policies)
}
