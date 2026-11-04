import type { Ctx, Row } from '@ketvietlab/ketjs'
import { effectiveFunctionKeys, AUTHORIZATION_READ_EFFECTS } from '../user/authorization.ts'
import { ours } from '../sale/scope.ts'
export const accessEffects = [...AUTHORIZATION_READ_EFFECTS, 'read:crm.Team', 'read:crm.TeamMember']
export async function templateAudience(ctx: Ctx) {
  if (!ctx.actor) return { manager: false, teams: [] as string[] }
  const allowed = await effectiveFunctionKeys(ctx, ctx.actor)
  const teams = await ours(ctx, 'crm.Team', { active: true })
  const memberships = await ours(ctx, 'crm.TeamMember', { userId: ctx.actor, active: true })
  return {
    manager:
      allowed === null ||
      allowed.includes('sale_template.saveTemplate') ||
      allowed.includes('sale_template.setTemplateActive'),
    teams: teams
      .filter(
        (team) => team.leaderUserId === ctx.actor || memberships.some((member) => member.teamId === team.id),
      )
      .map((team) => String(team.id)),
  }
}
export async function canUseTemplate(ctx: Ctx, template: Row) {
  if (!template.active) return false
  const audience = await templateAudience(ctx)
  if (audience.manager) return true
  const assigned = await ours(ctx, 'sale_template.Team', { templateId: template.id })
  return !assigned.length || assigned.some((team) => audience.teams.includes(String(team.teamId)))
}

export async function hasTemplateGrant(ctx: Ctx, fn: 'saveTemplate' | 'setTemplateActive') {
  if (!ctx.actor) return false
  const allowed = await effectiveFunctionKeys(ctx, ctx.actor)
  return allowed === null || allowed.includes('sale_template.' + fn)
}
