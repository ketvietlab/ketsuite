import { defineModule } from '@ketvietlab/ketjs'
import { functions } from './functions.ts'
import { islands } from './islands.ts'
import { messages } from './messages.ts'
import { models } from './models.ts'
import { routes } from './routes.ts'
import { salesRoutes } from './sales-routes.ts'
import { importRoutes } from './import-routes.ts'

export default defineModule({
  name: 'crm_backend',
  version: '0.1.0',
  // The backend renders leads that arrive from the website but never calls into
  // that module; the dependency was pulling a public-site concern into the admin
  // shell for nothing.
  depends: ['crm', 'crm_sale', 'backend', 'stock', 'activity', 'partner_backend', 'user', 'mail_transport'],
  title: 'CRM',
  summary: 'Lead, opportunity, pipeline and sales activities.',
  category: 'Sales',
  models,
  assets: new URL('./client/', import.meta.url),
  styles: ['crm.css'],
  islands,
  // Internal reads of the sales screens; their routes check the permission first.
  functions,
  fills: {
    'partner_backend:record.salesActions': `<a data-ui="action" data-variant="secondary" href="/admin/crm/cases/new?kind=lead&amp;partnerId={{ partnerId }}&amp;lang={{ lang }}"><span data-ui="action-label">{{ 'crm_backend.action.createLead' | _ }}</span></a>`,
  },
  menus: {
    crm: { label: 'menu.app', icon: 'contact-round', sequence: 18 },
    'crm.pipeline': {
      parent: 'crm',
      label: 'menu.pipeline',
      path: '/admin/crm/pipeline',
      sequence: 10,
      needs: 'crm.case.list',
    },
    'crm.cases': {
      parent: 'crm',
      label: 'menu.cases',
      path: '/admin/crm/cases',
      sequence: 20,
      needs: 'crm.case.list',
    },
    // The sales team's daily list of what is due.
    'crm.activities': {
      parent: 'crm',
      label: 'menu.activities',
      path: '/admin/crm/activities',
      sequence: 30,
      needs: 'crm.case.list',
    },
    // Configuration lives on the settings page (the rail's gear), under CRM's own heading,
    // one entry per configuration tab. The first keeps the bare path so the menu's
    // pathname matching still marks it active on every tab.
    'admin.crm': { parent: 'admin', label: 'menu.app', icon: 'contact-round', sequence: 10 },
    'crm.configuration': {
      parent: 'admin.crm',
      label: 'menu.settings.people',
      path: '/admin/crm/configuration',
      sequence: 10,
      needs: 'crm.configuration.get',
    },
    'crm.configuration.process': {
      parent: 'admin.crm',
      label: 'menu.settings.process',
      path: '/admin/crm/configuration?tab=process',
      sequence: 20,
      needs: 'crm.configuration.get',
    },
    'crm.configuration.scoring': {
      parent: 'admin.crm',
      label: 'menu.settings.scoring',
      path: '/admin/crm/configuration?tab=scoring',
      sequence: 30,
      needs: 'crm.configuration.get',
    },
    'crm.imports': {
      parent: 'crm',
      label: 'menu.imports',
      path: '/admin/crm/imports',
      sequence: 40,
      needs: 'crm.import.list',
    },
    'crm.tags': {
      parent: 'admin.crm',
      label: 'menu.tags',
      path: '/admin/crm/tags',
      sequence: 40,
      needs: 'crm.tag.catalogue',
    },
  },
  // The sales screens are drawn by one island each; they replace the older server screens at the same paths.
  routes: { ...routes, ...salesRoutes, ...importRoutes },
  messages,
})

export { islands } from './islands.ts'
