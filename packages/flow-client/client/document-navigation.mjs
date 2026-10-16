import { documentRoutes } from './documents.mjs'
import { flowShellData } from './shell-model.mjs'

const workspaceRoute = (route) => documentRoutes.has(route) && route !== 'all-pages'
const accessIdentity = (chrome) =>
  JSON.stringify(
    [
      chrome.user?.id,
      chrome.members,
      chrome.capabilities,
      chrome.projects.map((project) => [project.id, project.accessInfo]),
      chrome.grants,
      chrome.teams,
    ],
    (_, value) =>
      value && typeof value === 'object' && !Array.isArray(value)
        ? Object.fromEntries(
            Object.keys(value)
              .sort()
              .map((key) => [key, value[key]]),
          )
        : value,
  )

// A document selection revalidates data without unmounting the reading workspace.
// Never carry the snapshot across an owner or authorization change. The new SSR
// projection also removes records that are no longer visible before the CSR read.
export function retainedDocumentSnapshot(data, current, next) {
  const chrome = next.chrome
  if (
    !current.ready ||
    !data ||
    !chrome ||
    chrome.problem ||
    !workspaceRoute(current.screen) ||
    !workspaceRoute(next.screen) ||
    data.company.id !== next.companyId ||
    current.workspaceId !== next.workspaceId ||
    current.project !== (next.scope === 'workspace' ? '' : (next.project ?? '')) ||
    accessIdentity(flowShellData(data)) !== accessIdentity(chrome)
  )
    return null
  const visible = new Set(chrome.pages.map((page) => page.id))
  return { ...data, context: chrome.context, pages: data.pages.filter((page) => visible.has(page.id)) }
}
