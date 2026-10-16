export const sameDocumentOwner = (a, b) =>
  (a.projectId ?? null) === (b.projectId ?? null) &&
  (!!a.projectId || (a.workspaceId ?? null) === (b.workspaceId ?? null))
export const sameDocumentLevel = (a, b) =>
  (a.parentId ?? null) === (b.parentId ?? null) &&
  sameDocumentOwner(a, b) &&
  (a.visibility ?? 'shared') === (b.visibility ?? 'shared')
export const documentSiblings = (pages, page) =>
  pages.filter((p) => !p.archived && sameDocumentLevel(p, page))
export function documentMoveCandidates(pages, page) {
  const children = new Map()
  for (const item of pages) {
    if (!children.has(item.parentId)) children.set(item.parentId, [])
    children.get(item.parentId).push(item.id)
  }
  const descendants = new Set()
  const pending = [page.id]
  while (pending.length) {
    const id = pending.pop()
    if (descendants.has(id)) continue
    descendants.add(id)
    pending.push(...(children.get(id) ?? []))
  }
  return pages.filter(
    (p) =>
      !descendants.has(p.id) &&
      !p.archived &&
      p.access?.write !== false &&
      sameDocumentOwner(p, page) &&
      (p.visibility ?? 'shared') === (page.visibility ?? 'shared'),
  )
}
// Keep matching pages attached to their ancestors; filtering never flattens the tree.
export function filterDocumentTree(pages, matches) {
  const byId = new Map(pages.map((p) => [p.id, p]))
  const keep = new Set()
  for (const page of pages.filter(matches)) {
    let current = page
    const visited = new Set()
    while (current && !visited.has(current.id)) {
      visited.add(current.id)
      keep.add(current.id)
      current = byId.get(current.parentId)
    }
  }
  return pages.filter((p) => keep.has(p.id))
}
