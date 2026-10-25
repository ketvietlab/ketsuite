import { defineDeployment, sqliteStore } from '@ketvietlab/ketjs'
import type { OpenStore } from '@ketvietlab/ketjs'
import * as suite from '../index.ts'
import { officeRoleTemplates } from '../role-templates.ts'
import { suiteMail } from './mail-targets.ts'
import {
  commonBusinessModules,
  commonMailTargets,
  productDefaults,
  productPermissions,
  productQueues,
  productServe,
} from './common.ts'

const modules = [
  // Office adds CRM cases and Flow issues to what the inbox shows.
  ...commonBusinessModules.map((m) =>
    m.name === 'mail' ? suiteMail([...commonMailTargets, 'crm.Case', 'flow.Issue']) : m,
  ),
  suite.pricing,
  suite.account,
  suite.purchase,
  suite.crm,
  suite.crmSale,
  suite.crmBackend,
  suite.purchaseBackend,
  // LiveDoc is already composed by commonBusinessModules for Website and Flow.
  suite.flow,
  suite.flowBackend,
  suite.accountBackend,
]

/** Office: the back office of a services business — CRM, projects, purchasing and accounting. */
export const createOfficeDeployment = (openStore: OpenStore = sqliteStore) =>
  defineDeployment({
    name: 'office',
    // Every KetSuite row belongs to a company; KetJS scopes by company only on request.
    companies: true,
    datastore: 'office',
    modules,
    permissions: productPermissions(modules, officeRoleTemplates),
    theme: suite.paperTheme,
    worker: { queues: productQueues },
    serve: { ...productServe(openStore), defaults: productDefaults('office') },
  })
