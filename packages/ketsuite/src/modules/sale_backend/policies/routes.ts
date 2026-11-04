import { text } from '@ketvietlab/ketjs'
import type { Route, ServeContext } from '@ketvietlab/ketjs'
import { adminPage } from '../../backend/screen.ts'
import { salePoliciesScreen } from './screens.tsx'
import { policyContext, policyRead } from './read.ts'
import { POLICY_PATH } from './shared.ts'

const policyList =
  (ctx: ServeContext): Route =>
  async (url, req) => {
    if (req.method !== 'GET') return text('GET', { status: 405 })
    if (!(await ctx.allows('sale.listInvoicePolicies', url, req))) return text('Forbidden', { status: 403 })
    return adminPage(ctx, url, req, {
      title: 'sale_backend.policy.title',
      body: (_, frame) => salePoliciesScreen(_, frame, url),
    })
  }

export const policyRoutes = {
  [POLICY_PATH]: policyList,
  [`${POLICY_PATH}/read`]: policyRead,
  [`${POLICY_PATH}/{id}/context`]: policyContext,
}
