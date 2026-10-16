// An explicit record never falls back to another project's or the first record.
export function projectRecord(records, projectId, id, explicit, fallback = () => true) {
  return (
    records.find(
      (record) =>
        !record.archived &&
        record.projectId === projectId &&
        (explicit ? record.id === id : fallback(record)),
    ) ?? null
  )
}

// Retain legacy title links for display, but prefer canonical identity within the owner.
export function taskEpic(records, task) {
  return (
    records.find((epic) => epic.projectId === task.projectId && epic.id === task.epic) ??
    records.find((epic) => epic.projectId === task.projectId && epic.title === task.epic) ??
    null
  )
}
