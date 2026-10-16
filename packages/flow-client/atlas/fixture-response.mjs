const lostBulkResults = new WeakSet()

/** Fault injection belongs after every command/replay cache, at the wire boundary. */
export function fixtureResponse(session, name, result) {
  if (
    session.scenario === 'bulk-unknown' &&
    name === 'flow.issue.bulk' &&
    result.ok === true &&
    result.value?.ok === true &&
    !lostBulkResults.has(session)
  ) {
    lostBulkResults.add(session)
    return { ok: true, value: { ok: true } }
  }
  return result
}
