import type { Row } from '@ketvietlab/ketjs'

// JSON columns accept structured values. Keep text/number/boolean answers inside
// an object so a text answer is never interpreted as pre-serialized JSON.
export function encodeCustomFieldValue(value: unknown): Row {
  return { schemaVersion: 1, value: value ?? null }
}

export function decodeCustomFieldValue(stored: unknown): unknown {
  if (stored && typeof stored === 'object' && !Array.isArray(stored) && (stored as Row).schemaVersion === 1)
    return (stored as Row).value
  return stored
}
