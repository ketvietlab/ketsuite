import { type JsonObject, resolvePointer } from './model.ts'

/** One row of a schema tree. `level` starts at 1 for the top-level properties. */
export type SchemaRow = {
  id: string
  name: string
  level: number
  hasChildren: boolean
  type: string
  required: boolean
  nullable: boolean
  deprecated: boolean
  readOnly: boolean
  writeOnly: boolean
  /** Constraint words, in a stable order: format, enum, ranges, pattern, const, default. */
  constraints: readonly string[]
  description: string | null
  /** Set when the row stands for a reference the reader could not follow. */
  unresolved: 'external' | 'circular' | 'depth' | null
}

const isObject = (value: unknown): value is JsonObject =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

/** Deep enough for real contracts; a deeper tree is almost always a recursive type. */
export const MAX_SCHEMA_DEPTH = 12
/** Bounds the work and the DOM for one schema; the view says when rows were left out. */
export const MAX_SCHEMA_ROWS = 2000

type Resolved = { schema: JsonObject; refs: readonly string[]; unresolved: SchemaRow['unresolved'] }

/** Follows `$ref`, keeping sibling keywords (OpenAPI 3.1 allows them beside a reference). */
const resolve = (document: JsonObject, schema: JsonObject, trail: readonly string[]): Resolved => {
  let current = schema
  const refs: string[] = []
  while (typeof current['$ref'] === 'string') {
    const ref = current['$ref']
    if (trail.includes(ref) || refs.includes(ref)) return { schema: current, refs, unresolved: 'circular' }
    const target = resolvePointer(document, ref)
    if (!isObject(target)) return { schema: current, refs, unresolved: 'external' }
    refs.push(ref)
    const { $ref: _ref, ...siblings } = current
    current = { ...target, ...siblings }
  }
  return { schema: current, refs, unresolved: null }
}

const refName = (ref: string): string => ref.slice(ref.lastIndexOf('/') + 1)

const types = (schema: JsonObject): string[] => {
  const raw = schema['type']
  if (Array.isArray(raw)) return raw.filter((type): type is string => typeof type === 'string')
  if (typeof raw === 'string') return [raw]
  if (isObject(schema['properties'])) return ['object']
  if (schema['items'] !== undefined) return ['array']
  return []
}

const COMPOSITIONS = ['allOf', 'oneOf', 'anyOf'] as const

const variants = (
  schema: JsonObject,
): { keyword: (typeof COMPOSITIONS)[number]; items: JsonObject[] } | null => {
  for (const keyword of COMPOSITIONS) {
    const list = schema[keyword]
    if (Array.isArray(list) && list.length > 0) return { keyword, items: list.filter(isObject) }
  }
  return null
}

const literal = (value: unknown): string => (typeof value === 'string' ? `"${value}"` : JSON.stringify(value))

/** A short type label: `string`, `array<object>`, `Order`, `string | null`, `one of`. */
export const typeLabel = (document: JsonObject, raw: unknown): string => {
  if (raw === true || raw === undefined) return 'any'
  if (raw === false) return 'never'
  if (!isObject(raw)) return 'any'
  const { schema, refs, unresolved } = resolve(document, raw, [])
  if (unresolved === 'external' && typeof schema['$ref'] === 'string') return refName(schema['$ref'])
  const own = types(schema).filter((type) => type !== 'null')
  const named = refs.length > 0 ? refName(refs[refs.length - 1] as string) : null
  if (own.length === 1 && own[0] === 'array') return `array<${typeLabel(document, schema['items'])}>`
  if (named && (own.length === 0 || own[0] === 'object')) return named
  if (own.length > 0) return own.join(' | ')
  const composed = variants(schema)
  if (composed) return { allOf: 'all of', oneOf: 'one of', anyOf: 'any of' }[composed.keyword]
  if (schema['const'] !== undefined) return typeof schema['const']
  if (Array.isArray(schema['enum'])) return 'enum'
  return 'any'
}

const constraints = (schema: JsonObject): string[] => {
  const out: string[] = []
  if (typeof schema['format'] === 'string') out.push(`format: ${schema['format']}`)
  if (Array.isArray(schema['enum'])) out.push(`enum: ${schema['enum'].map(literal).join(', ')}`)
  if (schema['const'] !== undefined) out.push(`const: ${literal(schema['const'])}`)
  const range = (low: string, high: string, unit: string) => {
    const min = schema[low]
    const max = schema[high]
    if (typeof min === 'number' && typeof max === 'number') out.push(`${unit}: ${min}–${max}`)
    else if (typeof min === 'number') out.push(`${unit} ≥ ${min}`)
    else if (typeof max === 'number') out.push(`${unit} ≤ ${max}`)
  }
  range('minLength', 'maxLength', 'length')
  range('minItems', 'maxItems', 'items')
  range('minimum', 'maximum', 'value')
  if (typeof schema['exclusiveMinimum'] === 'number') out.push(`value > ${schema['exclusiveMinimum']}`)
  if (typeof schema['exclusiveMaximum'] === 'number') out.push(`value < ${schema['exclusiveMaximum']}`)
  if (typeof schema['multipleOf'] === 'number') out.push(`multiple of ${schema['multipleOf']}`)
  if (typeof schema['pattern'] === 'string') out.push(`pattern: ${schema['pattern']}`)
  if (schema['uniqueItems'] === true) out.push('unique items')
  if (schema['additionalProperties'] === false) out.push('no other properties')
  if (schema['default'] !== undefined) out.push(`default: ${literal(schema['default'])}`)
  return out
}

/**
 * Flattens a schema into tree rows: object properties, array items,
 * additional properties and composition variants each become child rows.
 * The root itself is not a row; a scalar root yields one `(value)` row.
 */
export const schemaRows = (
  document: JsonObject,
  root: JsonObject | null,
  labels: { item: string; value: string; additional: string; variant: (index: number) => string } = {
    item: '[item]',
    value: '(value)',
    additional: '[other properties]',
    variant: (index) => `variant ${index}`,
  },
): { rows: SchemaRow[]; truncated: boolean } => {
  const rows: SchemaRow[] = []
  let truncated = false

  const visit = (
    raw: unknown,
    name: string,
    id: string,
    level: number,
    required: boolean,
    trail: readonly string[],
  ): void => {
    if (rows.length >= MAX_SCHEMA_ROWS) {
      truncated = true
      return
    }
    const source = isObject(raw) ? raw : {}
    const { schema, refs, unresolved } = resolve(document, source, trail)
    const nextTrail = [...trail, ...refs]
    const row: SchemaRow = {
      id,
      name,
      level,
      hasChildren: false,
      type: typeLabel(document, source),
      required,
      nullable: types(schema).includes('null') || schema['nullable'] === true,
      deprecated: schema['deprecated'] === true,
      readOnly: schema['readOnly'] === true,
      writeOnly: schema['writeOnly'] === true,
      constraints: unresolved ? [] : constraints(schema),
      description: typeof schema['description'] === 'string' ? schema['description'] : null,
      unresolved: unresolved ?? (level > MAX_SCHEMA_DEPTH ? 'depth' : null),
    }
    rows.push(row)
    if (row.unresolved) return
    const before = rows.length
    children(schema, id, level + 1, nextTrail)
    row.hasChildren = rows.length > before
  }

  const children = (schema: JsonObject, id: string, level: number, trail: readonly string[]): void => {
    const properties = isObject(schema['properties']) ? schema['properties'] : null
    const requiredList = Array.isArray(schema['required']) ? schema['required'] : []
    if (properties)
      for (const key of Object.keys(properties))
        visit(properties[key], key, `${id}/${key}`, level, requiredList.includes(key), trail)
    if (isObject(schema['additionalProperties']))
      visit(schema['additionalProperties'], labels.additional, `${id}/*`, level, false, trail)
    if (types(schema).includes('array') && schema['items'] !== undefined && schema['items'] !== true) {
      const item = resolve(document, isObject(schema['items']) ? schema['items'] : {}, trail)
      // An array of scalars needs no extra row: the type label already says `array<string>`.
      if (
        item.unresolved ||
        types(item.schema).some((type) => type === 'object' || type === 'array') ||
        variants(item.schema)
      )
        visit(schema['items'], labels.item, `${id}/[]`, level, false, trail)
    }
    const composed = variants(schema)
    if (composed)
      composed.items.forEach((variant, index) => {
        // allOf merges into the parent; its members read best as plain property lists.
        if (composed.keyword === 'allOf') children(resolve(document, variant, trail).schema, id, level, trail)
        else
          visit(variant, labels.variant(index + 1), `${id}/${composed.keyword}/${index}`, level, false, trail)
      })
  }

  if (root === null) return { rows, truncated }
  const resolved = resolve(document, root, [])
  const rootTypes = types(resolved.schema)
  const container =
    rootTypes.includes('object') || rootTypes.includes('array') || variants(resolved.schema) !== null
  if (!container || resolved.unresolved) visit(root, labels.value, '#', 1, true, [])
  else if (rootTypes.includes('array')) visit(root, labels.value, '#', 1, true, [])
  else children(resolved.schema, '#', 1, resolved.refs)
  return { rows, truncated }
}

const FORMAT_EXAMPLES: Record<string, string> = {
  date: '2026-01-31',
  'date-time': '2026-01-31T09:30:00Z',
  time: '09:30:00',
  email: 'name@example.com',
  uuid: '3f2a8c1e-5b7d-4e9a-8c6f-1d2e3f4a5b6c',
  uri: 'https://example.com/',
  url: 'https://example.com/',
  hostname: 'example.com',
  ipv4: '192.0.2.1',
  ipv6: '2001:db8::1',
  password: '',
}

/**
 * A request example built from the schema: `example`, `default`, `const` and
 * the first `enum` value win; otherwise a neutral value of the declared type.
 * Read-only properties are left out, since a server ignores or refuses them.
 */
export const exampleOf = (
  document: JsonObject,
  raw: unknown,
  depth = 0,
  trail: readonly string[] = [],
): unknown => {
  if (!isObject(raw) || depth > 8) return null
  const { schema, refs, unresolved } = resolve(document, raw, trail)
  if (unresolved) return null
  const nextTrail = [...trail, ...refs]
  if (schema['example'] !== undefined) return schema['example']
  if (Array.isArray(schema['examples']) && schema['examples'].length > 0) return schema['examples'][0]
  if (schema['default'] !== undefined) return schema['default']
  if (schema['const'] !== undefined) return schema['const']
  if (Array.isArray(schema['enum']) && schema['enum'].length > 0) return schema['enum'][0]
  const composed = variants(schema)
  if (composed && composed.keyword !== 'allOf')
    return exampleOf(document, composed.items[0], depth + 1, nextTrail)
  if (composed?.keyword === 'allOf') {
    const merged: Record<string, unknown> = {}
    for (const part of composed.items) {
      const value = exampleOf(document, part, depth + 1, nextTrail)
      if (isObject(value)) Object.assign(merged, value)
    }
    return merged
  }
  const type = types(schema).find((candidate) => candidate !== 'null')
  switch (type) {
    case 'object': {
      const out: Record<string, unknown> = {}
      const properties = isObject(schema['properties']) ? schema['properties'] : {}
      for (const key of Object.keys(properties)) {
        const property = properties[key]
        if (isObject(property) && resolve(document, property, nextTrail).schema['readOnly'] === true) continue
        out[key] = exampleOf(document, property, depth + 1, nextTrail)
      }
      return out
    }
    case 'array': {
      const item = exampleOf(document, schema['items'], depth + 1, nextTrail)
      return item === null ? [] : [item]
    }
    case 'string': {
      const format = typeof schema['format'] === 'string' ? schema['format'] : ''
      if (format in FORMAT_EXAMPLES) return FORMAT_EXAMPLES[format]
      // KetJS publishes decimals as exact strings matching a plain-number pattern.
      if (typeof schema['pattern'] === 'string' && /\\d|\[0-9\]/.test(schema['pattern'])) return '0'
      return typeof schema['minLength'] === 'number' && schema['minLength'] > 0
        ? 'x'.repeat(schema['minLength'])
        : ''
    }
    case 'integer':
    case 'number':
      return typeof schema['minimum'] === 'number' ? schema['minimum'] : 0
    case 'boolean':
      return false
    default:
      return null
  }
}
