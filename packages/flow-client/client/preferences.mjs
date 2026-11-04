// Personal appearance belongs to the client, never to the presentation kit.
// Storage can be unavailable; pending identity never inherits another account's settings.
export const FLOW_APPEARANCE_DEFAULTS = Object.freeze({ theme: 'light', density: 'compact' })
const allowed = { theme: ['light', 'dark'], density: ['compact', 'comfortable'] }

export function flowPreferenceKey(key, scope) {
  if (!['theme', 'density', 'language'].includes(key)) return null
  if (scope === undefined) return `flow.${key}` // Existing standalone consumers.
  if (
    !scope ||
    ![scope.companyId, scope.userId].every(
      (value) => typeof value === 'string' && value.length > 0 && value.length <= 200,
    )
  )
    return null
  return `flow.personal:${JSON.stringify([scope.companyId, scope.userId, key])}`
}

export function readFlowAppearance(storage, scope) {
  const values = { ...FLOW_APPEARANCE_DEFAULTS }
  for (const key of Object.keys(values)) {
    try {
      const storageKey = flowPreferenceKey(key, scope)
      const value = storageKey ? storage?.getItem(storageKey) : null
      if (allowed[key].includes(value)) values[key] = value
    } catch {}
  }
  return values
}

export function writeFlowAppearance(storage, key, value, scope) {
  if (!Object.hasOwn(allowed, key) || !allowed[key].includes(value)) return false
  try {
    const storageKey = flowPreferenceKey(key, scope)
    if (storageKey) storage?.setItem(storageKey, value)
  } catch {}
  return true
}
