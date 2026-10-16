// A server-authorized chrome projection, not a second workspace bootstrap.
// Only identity, navigation and access metadata crosses into the enhancement
// runtime. Tasks, document bodies and paid feature data stay in the CSR read.
import { flowExtensions } from './extensions.mjs'
const pick = (record, keys) =>
  Object.fromEntries(keys.filter((key) => record[key] !== undefined).map((key) => [key, record[key]]))
export function flowShellData(data) {
  if (!data?.company || !Array.isArray(data.projects)) return null
  const user = data.user ?? {}
  const metadata = {
    company: pick(data.company, ['id', 'name']),
    companies: (data.companies ?? []).map((x) => pick(x, ['id', 'name'])),
    user: pick(user, ['id', 'name', 'avatarUrl']),
    members: (data.members ?? [])
      .filter((x) => x.id === user.id)
      .map((x) => pick(x, ['id', 'role', 'status'])),
    capabilities: data.capabilities,
    context: data.context,
    problem: data.problem,
    workspaces: data.workspaces?.map((x) => pick(x, ['id', 'companyId', 'title', 'archived'])),
    projects: data.projects.map((x) =>
      pick(x, [
        'id',
        'companyId',
        'workspaceId',
        'title',
        'code',
        'defaultView',
        'archived',
        'sprintCadence',
        'accessInfo',
      ]),
    ),
    views: (data.views ?? []).map((x) =>
      pick(x, ['id', 'projectId', 'title', 'query', 'status', 'archived']),
    ),
    inbox: (data.inbox ?? []).map((x) => ({ read: x.read })),
    pages: (data.pages ?? []).map((x) => pick(x, ['id', 'projectId'])),
    grants: (data.grants ?? []).map((x) =>
      pick(x, ['scope', 'targetId', 'role', 'subjectType', 'subjectId']),
    ),
    teams: (data.teams ?? [])
      .filter((x) => x.memberIds.includes(user.id))
      .map((x) => ({ id: x.id, memberIds: [user.id] })),
    tasks: [],
    columns: [],
    tags: [],
    fields: [],
    files: [],
    sprints: [],
    epics: [],
  }
  for (const extension of flowExtensions()) {
    for (const [key, value] of Object.entries(extension.shellData?.(data) ?? {})) {
      if (Object.hasOwn(metadata, key)) throw new Error(`Shell metadata field already owned: ${key}`)
      metadata[key] = value
    }
  }
  return metadata
}
