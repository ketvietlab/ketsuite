// Personal appearance belongs to the client, never to the presentation kit.
// Storage can be unavailable (privacy mode/embedded preview); the UI still works.
export const FLOW_APPEARANCE_DEFAULTS = Object.freeze({ theme: 'light', density: 'compact' })
const allowed = { theme: ['light', 'dark'], density: ['compact', 'comfortable'] }

export function readFlowAppearance(storage) {
  const values = { ...FLOW_APPEARANCE_DEFAULTS }
  for (const key of Object.keys(values)) {
    try {
      const value = storage?.getItem(`flow.${key}`)
      if (allowed[key].includes(value)) values[key] = value
    } catch {}
  }
  return values
}

export function writeFlowAppearance(storage, key, value) {
  if (!Object.hasOwn(allowed, key) || !allowed[key].includes(value)) return false
  try {
    storage?.setItem(`flow.${key}`, value)
  } catch {}
  return true
}
