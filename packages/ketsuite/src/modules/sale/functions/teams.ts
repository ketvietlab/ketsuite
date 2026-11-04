import { defineFn, type Ctx, type FnSpec, type Row } from '@ketvietlab/ketjs'
import {
  getOrderSales,
  listTeams,
  saveTeam,
  setOrderSalesperson,
  setTeamActive,
  teamChoices,
} from '../teams.ts'
import { saleRecordResult } from '../record-result.ts'

const PEOPLE_EFFECTS = ['read:user.Membership', 'read:user.User'] as const
const READ_EFFECTS = [
  'read:sale.Team',
  'read:sale.TeamMember',
  'read:company.Company',
  ...PEOPLE_EFFECTS,
] as const
const TEAM_EFFECTS = [...READ_EFFECTS, 'write:sale.Team', 'write:sale.TeamMember'] as const

export const saveTeamHandler = async (ctx: Ctx, args: Row) => saleRecordResult(await saveTeam(ctx, args))
export const setTeamActiveHandler = async (ctx: Ctx, args: Row) =>
  saleRecordResult(await setTeamActive(ctx, args))
export const listTeamsHandler = (ctx: Ctx, args: Row) => listTeams(ctx, args)
export const getTeamChoicesHandler = (ctx: Ctx) => teamChoices(ctx)
export const getOrderSalesHandler = (ctx: Ctx, args: Row) => getOrderSales(ctx, args)
export const setOrderSalespersonHandler = async (ctx: Ctx, args: Row) =>
  saleRecordResult(await setOrderSalesperson(ctx, args))

export const teamFunctions: Record<string, FnSpec> = {
  saveTeam: defineFn({
    input: {
      id: 'id',
      name: 'text',
      leaderId: 'id',
      memberIds: 'json',
      monthlyTarget: 'text?',
      expectedRevisionId: 'text?',
    },
    output: { ok: 'bool', id: 'id?', revisionId: 'text?', errors: 'json?' },
    effects: [...TEAM_EFFECTS],
    idempotent: true,
    agent: true,
    handler: saveTeamHandler,
  }),
  setTeamActive: defineFn({
    input: { id: 'id', active: 'bool', expectedRevisionId: 'text' },
    output: { ok: 'bool', id: 'id?', revisionId: 'text?', errors: 'json?' },
    effects: [...TEAM_EFFECTS],
    idempotent: true,
    agent: true,
    handler: setTeamActiveHandler,
  }),
  listTeams: defineFn({
    input: { includeArchived: 'bool?', ids: 'json?' },
    effects: [...READ_EFFECTS],
    agent: true,
    handler: listTeamsHandler,
  }),
  getTeamChoices: defineFn({
    input: {},
    effects: [...PEOPLE_EFFECTS],
    agent: true,
    handler: getTeamChoicesHandler,
  }),
  getOrderSales: defineFn({
    input: { id: 'id' },
    effects: ['read:sale.Order', 'read:sale.Team', 'read:user.User'],
    agent: true,
    handler: getOrderSalesHandler,
  }),
  setOrderSalesperson: defineFn({
    input: { id: 'id', userId: 'id?', teamId: 'id?' },
    output: { ok: 'bool', id: 'id?', userId: 'id?', teamId: 'id?', errors: 'json?' },
    effects: [...READ_EFFECTS, 'read:sale.Order', 'write:sale.Order'],
    idempotent: true,
    agent: true,
    handler: setOrderSalespersonHandler,
  }),
}
