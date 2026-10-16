import type { Ctx } from '@ketvietlab/ketjs'
import { functionsNamedBy } from '../../ui/fill-needs.ts'

type Lang = 'vi' | 'en'

/**
 * Tabs other modules add to the template record modal, from the fills of
 * `product_backend:template.recordTabs`. A client modal cannot render a joint, so
 * it places the island itself; only an island fill can cross.
 */
export const recordTabsFor = (
  ctx: Pick<Ctx, 'manifest'>,
  lang: Lang,
): Array<{ id: string; label: string; island: string }> => {
  const catalog = ctx.manifest.messages?.[lang] ?? {}
  const message = (key: string): string | null => {
    const value = catalog[key]
    if (value === undefined) return null
    return typeof value === 'string' ? value : String(value.other ?? Object.values(value)[0] ?? key)
  }
  return ctx.manifest.fills
    .filter((fill) => fill.joint === 'product_backend:template.recordTabs')
    .flatMap((fill) => {
      const island = /\{%\s*island\s+"([^"]+)"\s*%\}/u.exec(fill.template)?.[1]
      if (!island) return []
      return [{ id: fill.by, label: message(`${fill.by}.productTemplateTab`) ?? fill.by, island }]
    })
}

/**
 * The islands filled into a joint the record page places itself (activity, chatter),
 * for this viewer: a fill naming a function they may not call in its condition
 * (`{% if may.product_mail_backend.timeline %}`) is left out, as the server page
 * leaves it out when it renders the joint (ui/fill-needs.ts).
 */
export const recordIslandsFor = (
  ctx: Pick<Ctx, 'manifest'>,
  joint: string,
  can: (fn: string) => boolean,
): Array<{ id: string; island: string }> =>
  ctx.manifest.fills
    .filter((fill) => fill.joint === joint && functionsNamedBy(fill.template).every(can))
    .flatMap((fill) => {
      const island = /\{%\s*island\s+"([^"]+)"\s*%\}/u.exec(fill.template)?.[1]
      return island ? [{ id: fill.by, island }] : []
    })
