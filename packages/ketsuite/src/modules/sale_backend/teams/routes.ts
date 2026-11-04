import { text } from '@ketvietlab/ketjs'
import type { Route, ServeContext } from '@ketvietlab/ketjs'
import { adminPage } from '../../backend/screen.ts'
import { saleTeamsScreen } from './screens.tsx'
import { teamContext, teamRead } from './read.ts'
import { TEAM_PATH } from './shared.ts'

const teamList =
  (ctx: ServeContext): Route =>
  async (url, req) => {
    if (req.method !== 'GET') return text('GET', { status: 405 })
    if (!(await ctx.allows('sale.listTeams', url, req))) return text('Forbidden', { status: 403 })
    const create = await ctx.allows('sale.saveTeam', url, req)
    return adminPage(ctx, url, req, {
      title: 'sale_backend.team.title',
      body: (_, frame) => saleTeamsScreen(_, frame, url, create),
    })
  }

export const teamRoutes = {
  [TEAM_PATH]: teamList,
  [`${TEAM_PATH}/read`]: teamRead,
  [`${TEAM_PATH}/{id}/context`]: teamContext,
}
