import type { Row } from '@ketvietlab/ketjs'

/** One policy for interactive routing and bulk import previews/workers. */
export function selectAssignmentMember(team: Row, candidates: Row[]): Row | null {
  const members = candidates
    .filter((member) => member.active !== false)
    .sort((a, b) => Number(a.sequence) - Number(b.sequence) || String(a.id).localeCompare(String(b.id)))
  if (!members.length) return null
  if (team.assignmentMode === 'capacity')
    return members.sort(
      (a, b) =>
        Number(a.assignedCount || 0) / Math.max(1, Number(a.capacity || 0)) -
          Number(b.assignedCount || 0) / Math.max(1, Number(b.capacity || 0)) ||
        String(a.lastAssignedAt || '').localeCompare(String(b.lastAssignedAt || '')) ||
        String(a.id).localeCompare(String(b.id)),
    )[0]
  return members[Number(team.assignmentCursor || 0) % members.length]
}
