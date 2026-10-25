// @ts-nocheck Shared by the server render and the browser; its tests exercise it.
// Where the CRM sales screens live in the admin. The presenter speaks in abstract addresses
// (`screen=lead-detail&id=…`); these turn them into admin paths and back. A record or a team is a path
// segment; everything else stays in the query.

const BASE = '/admin/crm'
// No overview here: a deployment's CRM overview is its own dashboard, read from the metrics it keeps, so the
// admin carries one set of KPI figures. The presenter's overview screen draws the design mock only.
const paths = {
  pipeline: `${BASE}/pipeline`,
  cases: `${BASE}/cases`,
  'lead-new': `${BASE}/cases/new`,
  'activity-planner': `${BASE}/activities`,
  'crm-settings': `${BASE}/configuration`,
}
const screens = Object.fromEntries(Object.entries(paths).map(([screen, path]) => [path, screen]))
// Paths under the record and team segments that are not records or teams.
const reserved = new Set(['new', 'export'])
const segment = (value) => encodeURIComponent(String(value ?? ''))

const href = (query) => {
  const params = new URLSearchParams(query)
  const screen = params.get('screen') || 'pipeline'
  params.delete('screen')
  let path = paths[screen]
  if (screen === 'lead-detail') {
    path = `${BASE}/cases/${segment(params.get('id'))}`
    params.delete('id')
  } else if (screen === 'crm-team') {
    path = `${BASE}/configuration/teams/${segment(params.get('team'))}`
    params.delete('team')
  }
  const search = params.toString()
  return `${path ?? paths.pipeline}${search ? `?${search}` : ''}`
}

const parse = (url) => {
  const path = url.pathname.replace(/\/+$/, '')
  let screen = screens[path],
    named = null
  if (!screen) {
    const record = path.match(/^\/admin\/crm\/cases\/([^/]+)$/)
    const team = path.match(/^\/admin\/crm\/configuration\/teams\/([^/]+)$/)
    const value = record?.[1] ?? team?.[1]
    if (!value || reserved.has(value)) return null
    screen = record ? 'lead-detail' : 'crm-team'
    named = [record ? 'id' : 'team', decodeURIComponent(value)]
  }
  const params = new URLSearchParams([['screen', screen]])
  if (named) params.set(...named)
  for (const [key, value] of url.searchParams)
    if (key !== 'screen' && key !== named?.[0]) params.append(key, value)
  return params
}

export const adminSalesRoutes = {
  href,
  parse,
  read: () => `${BASE}/sales/read`,
  // The list's language rides on the address; the identity is the session's, whatever a persona says.
  search: (persona = '') => {
    const lang = new URLSearchParams(persona).get('lang')
    return `${BASE}/sales/search${lang === 'en' ? '?lang=en' : ''}`
  },
  command: `${BASE}/sales/command`,
  exportHref: (query) => {
    const params = new URLSearchParams(query)
    params.delete('screen')
    const search = params.toString()
    return `${BASE}/cases/export${search ? `?${search}` : ''}`
  },
}

/** The admin path of each screen that has one of its own (records and teams are under cases and configuration). */
export const salesScreenPaths = paths
