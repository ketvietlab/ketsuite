/**
 * Turns an OpenAPI 3.x document into the read model the views render. It never
 * throws on bad input: a document that cannot be read becomes a `problem`, and
 * parts it cannot follow (external references, cycles, unknown keywords) stay
 * visible as issues instead of disappearing.
 */

export const HTTP_METHODS = ['get', 'put', 'post', 'delete', 'options', 'head', 'patch', 'trace'] as const
export type HttpMethod = (typeof HTTP_METHODS)[number]

export type JsonObject = { readonly [key: string]: unknown }

export type SpecProblem = {
  code: 'not-object' | 'not-openapi' | 'unsupported-version' | 'no-paths'
  detail: string
}

export type SpecIssue = {
  code: 'duplicate-operation-id' | 'unresolved-ref' | 'invalid-operation' | 'invalid-parameter'
  pointer: string
  detail: string
}

export type ParameterLocation = 'path' | 'query' | 'header' | 'cookie'

export type SpecParameter = {
  name: string
  in: ParameterLocation
  required: boolean
  description: string | null
  deprecated: boolean
  schema: JsonObject | null
}

export type SpecResponse = {
  status: string
  description: string
  mediaType: string | null
  schema: JsonObject | null
  headers: readonly { name: string; description: string | null; schema: JsonObject | null }[]
}

export type SecurityScheme = {
  id: string
  type: string
  /** For `http`: bearer, basic. For `apiKey`: the location. */
  scheme: string | null
  in: 'header' | 'query' | 'cookie' | null
  name: string | null
  description: string | null
}

export type SpecOperation = {
  /** Stable, URL-safe identity: the operationId when it is unique, otherwise derived. */
  id: string
  operationId: string | null
  method: HttpMethod
  path: string
  group: string
  summary: string | null
  description: string | null
  deprecated: boolean
  parameters: readonly SpecParameter[]
  requestBody: { required: boolean; mediaType: string; schema: JsonObject | null } | null
  responses: readonly SpecResponse[]
  /** Each entry is one way to authenticate; an empty list means public. Null means unspecified. */
  security: readonly (readonly string[])[] | null
  idempotent: boolean
  /** `x-ket-capability`: the permission a caller needs, as `{ key, action }` or a bare key. */
  capability: SpecCapability | null
  /** Other `x-` extensions, shown as written. */
  extensions: readonly { name: string; value: unknown }[]
}

export type SpecCapability = { key: string; action: string | null }

/** Extensions the reference reads into their own fields rather than listing them raw. */
const READ_EXTENSIONS = new Set(['x-ket-capability', 'x-ket-idempotent'])

const capabilityOf = (value: unknown): SpecCapability | null => {
  if (typeof value === 'string' && value) return { key: value, action: null }
  const object = isObject(value) ? value : null
  const key = object?.['key']
  if (typeof key !== 'string' || !key) return null
  const action = object?.['action']
  return { key, action: typeof action === 'string' && action ? action : null }
}

export type SpecGroup = { id: string; label: string; operations: readonly SpecOperation[] }

export type SpecModel = {
  openapi: string
  title: string
  version: string
  description: string | null
  servers: readonly { url: string; description: string | null }[]
  securitySchemes: readonly SecurityScheme[]
  groups: readonly SpecGroup[]
  operations: readonly SpecOperation[]
  issues: readonly SpecIssue[]
  /** The document, kept so schemas can resolve their references lazily. */
  document: JsonObject
}

export type SpecResult = { ok: true; model: SpecModel } | { ok: false; problem: SpecProblem }

const isObject = (value: unknown): value is JsonObject =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const text = (value: unknown): string | null =>
  typeof value === 'string' && value.trim() !== '' ? value : null

const escapePointer = (segment: string): string => segment.replaceAll('~', '~0').replaceAll('/', '~1')

/** Resolves a local JSON pointer (`#/components/...`). External references return null. */
export const resolvePointer = (document: JsonObject, ref: string): unknown => {
  if (ref === '#') return document
  if (!ref.startsWith('#/')) return null
  let current: unknown = document
  for (const raw of ref.slice(2).split('/')) {
    const segment = decodeURIComponent(raw).replaceAll('~1', '/').replaceAll('~0', '~')
    if (Array.isArray(current)) current = current[Number(segment)]
    else if (isObject(current)) current = current[segment]
    else return null
  }
  return current ?? null
}

/** Follows `$ref` chains on non-schema objects (parameters, responses, bodies). */
const deref = (
  document: JsonObject,
  value: unknown,
  pointer: string,
  issues: SpecIssue[],
): JsonObject | null => {
  const seen = new Set<string>()
  let current = value
  while (isObject(current) && typeof current['$ref'] === 'string') {
    const ref = current['$ref']
    if (seen.has(ref)) {
      issues.push({ code: 'unresolved-ref', pointer, detail: `circular reference ${ref}` })
      return null
    }
    seen.add(ref)
    const next = resolvePointer(document, ref)
    if (next === null) {
      issues.push({ code: 'unresolved-ref', pointer, detail: `cannot resolve ${ref}` })
      return null
    }
    current = next
  }
  return isObject(current) ? current : null
}

const LOCATIONS: readonly ParameterLocation[] = ['path', 'query', 'header', 'cookie']

const parameterList = (
  document: JsonObject,
  raw: unknown,
  pointer: string,
  issues: SpecIssue[],
): SpecParameter[] => {
  if (!Array.isArray(raw)) return []
  const out: SpecParameter[] = []
  raw.forEach((entry, index) => {
    const at = `${pointer}/${index}`
    const parameter = deref(document, entry, at, issues)
    if (!parameter) return
    const name = text(parameter['name'])
    const location = parameter['in']
    if (!name || !LOCATIONS.includes(location as ParameterLocation)) {
      issues.push({
        code: 'invalid-parameter',
        pointer: at,
        detail: 'a parameter needs a name and a location',
      })
      return
    }
    out.push({
      name,
      in: location as ParameterLocation,
      // Path parameters are always required (OpenAPI 3.1 §4.8.12.1).
      required: location === 'path' || parameter['required'] === true,
      description: text(parameter['description']),
      deprecated: parameter['deprecated'] === true,
      schema: isObject(parameter['schema']) ? parameter['schema'] : null,
    })
  })
  return out
}

/** Operation parameters override path-level ones with the same name and location. */
const mergeParameters = (shared: SpecParameter[], own: SpecParameter[]): SpecParameter[] => {
  const key = (parameter: SpecParameter) => `${parameter.in}:${parameter.name.toLowerCase()}`
  const owned = new Set(own.map(key))
  return [...shared.filter((parameter) => !owned.has(key(parameter))), ...own]
}

const JSON_MEDIA = /^application\/(?:[\w.+-]+\+)?json(?:;|$)/i

/** Prefers a JSON media type; otherwise the first one listed. */
const pickContent = (content: unknown): { mediaType: string; schema: JsonObject | null } | null => {
  if (!isObject(content)) return null
  const types = Object.keys(content)
  const mediaType = types.find((type) => JSON_MEDIA.test(type)) ?? types[0]
  if (mediaType === undefined) return null
  const media = content[mediaType]
  return { mediaType, schema: isObject(media) && isObject(media['schema']) ? media['schema'] : null }
}

const statusRank = (status: string): number => {
  if (/^\d{3}$/.test(status)) return Number(status)
  if (/^\dXX$/i.test(status)) return Number(status[0]) * 100 + 99
  return 1000
}

const responseList = (
  document: JsonObject,
  raw: unknown,
  pointer: string,
  issues: SpecIssue[],
): SpecResponse[] => {
  if (!isObject(raw)) return []
  return Object.keys(raw)
    .sort((a, b) => statusRank(a) - statusRank(b) || a.localeCompare(b))
    .flatMap((status) => {
      const at = `${pointer}/${escapePointer(status)}`
      const response = deref(document, raw[status], at, issues)
      if (!response) return []
      const content = pickContent(response['content'])
      const headers = isObject(response['headers'])
        ? Object.entries(response['headers']).flatMap(([name, header]) => {
            const resolved = deref(document, header, `${at}/headers/${escapePointer(name)}`, issues)
            return resolved
              ? [
                  {
                    name,
                    description: text(resolved['description']),
                    schema: isObject(resolved['schema']) ? resolved['schema'] : null,
                  },
                ]
              : []
          })
        : []
      return [
        {
          status,
          description: text(response['description']) ?? '',
          mediaType: content?.mediaType ?? null,
          schema: content?.schema ?? null,
          headers,
        },
      ]
    })
}

const securityList = (raw: unknown): (readonly string[])[] | null =>
  Array.isArray(raw) ? raw.filter(isObject).map((requirement) => Object.keys(requirement)) : null

/** The first path segment that is not a parameter, so `/orders/{id}` groups under `orders`. */
const groupOf = (path: string, tags: unknown): string => {
  if (Array.isArray(tags) && typeof tags[0] === 'string' && tags[0].trim() !== '') return tags[0]
  const segment = path.split('/').find((part) => part !== '' && !part.startsWith('{'))
  return segment ?? '/'
}

const slug = (value: string): string =>
  value
    .toLowerCase()
    .replace(/[{}]/g, '')
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '')

const derivedId = (method: string, path: string): string => slug(`${method}-${path}`) || method

const IDEMPOTENCY_HEADER = 'idempotency-key'

export const isIdempotencyHeader = (parameter: SpecParameter): boolean =>
  parameter.in === 'header' && parameter.name.toLowerCase() === IDEMPOTENCY_HEADER

/** Methods that change state; the try-it console asks for care with these. */
export const isMutating = (method: HttpMethod): boolean =>
  method === 'post' || method === 'put' || method === 'patch' || method === 'delete'

const schemes = (document: JsonObject, issues: SpecIssue[]): SecurityScheme[] => {
  const components = isObject(document['components']) ? document['components'] : {}
  const raw = isObject(components['securitySchemes']) ? components['securitySchemes'] : {}
  return Object.keys(raw)
    .sort()
    .flatMap((id) => {
      const scheme = deref(document, raw[id], `#/components/securitySchemes/${escapePointer(id)}`, issues)
      if (!scheme) return []
      const location = scheme['in']
      return [
        {
          id,
          type: text(scheme['type']) ?? 'unknown',
          scheme: text(scheme['scheme'])?.toLowerCase() ?? null,
          in: location === 'header' || location === 'query' || location === 'cookie' ? location : null,
          name: text(scheme['name']),
          description: text(scheme['description']),
        },
      ]
    })
}

/** Server variables take their declared defaults (OpenAPI 3.1 §4.8.6). */
const serverUrl = (server: JsonObject): string => {
  const variables = isObject(server['variables']) ? server['variables'] : {}
  return String(server['url']).replace(/\{([^}]+)\}/g, (whole, name: string) => {
    const variable = variables[name]
    return isObject(variable) && typeof variable['default'] === 'string' ? variable['default'] : whole
  })
}

export const readSpec = (input: unknown): SpecResult => {
  if (!isObject(input))
    return { ok: false, problem: { code: 'not-object', detail: 'The document is not a JSON object.' } }
  const version = input['openapi']
  if (typeof version !== 'string')
    return {
      ok: false,
      problem: {
        code: 'not-openapi',
        detail:
          typeof input['swagger'] === 'string'
            ? `Swagger ${input['swagger']} documents are not supported. Convert the document to OpenAPI 3.`
            : 'The document has no "openapi" version field.',
      },
    }
  if (!/^3\.[01]\.\d+$/.test(version))
    return {
      ok: false,
      problem: {
        code: 'unsupported-version',
        detail: `OpenAPI ${version} is not supported; use 3.0 or 3.1.`,
      },
    }
  const paths = input['paths']
  if (paths !== undefined && !isObject(paths))
    return { ok: false, problem: { code: 'no-paths', detail: 'The "paths" field must be an object.' } }

  const issues: SpecIssue[] = []
  const info = isObject(input['info']) ? input['info'] : {}
  const rootSecurity = securityList(input['security'])
  const operations: SpecOperation[] = []
  const seen = new Map<string, number>()

  for (const path of Object.keys(paths ?? {}).sort()) {
    const itemPointer = `#/paths/${escapePointer(path)}`
    const item = deref(input, (paths as JsonObject)[path], itemPointer, issues)
    if (!item) continue
    const shared = parameterList(input, item['parameters'], `${itemPointer}/parameters`, issues)
    for (const method of HTTP_METHODS) {
      const raw = item[method]
      if (raw === undefined) continue
      const pointer = `${itemPointer}/${method}`
      if (!isObject(raw)) {
        issues.push({ code: 'invalid-operation', pointer, detail: 'an operation must be an object' })
        continue
      }
      const operationId = text(raw['operationId'])
      let id = operationId ?? derivedId(method, path)
      const count = seen.get(id) ?? 0
      if (count > 0) {
        if (operationId)
          issues.push({
            code: 'duplicate-operation-id',
            pointer,
            detail: `operationId "${operationId}" is used more than once`,
          })
        id = `${id}~${count + 1}`
      }
      seen.set(operationId ?? derivedId(method, path), count + 1)
      const body = deref(input, raw['requestBody'], `${pointer}/requestBody`, issues)
      const content = body ? pickContent(body['content']) : null
      const parameters = mergeParameters(
        shared,
        parameterList(input, raw['parameters'], `${pointer}/parameters`, issues),
      )
      operations.push({
        id,
        operationId,
        method,
        path,
        group: groupOf(path, raw['tags']),
        summary: text(raw['summary']),
        description: text(raw['description']),
        deprecated: raw['deprecated'] === true,
        parameters,
        requestBody: content ? { required: body?.['required'] === true, ...content } : null,
        responses: responseList(input, raw['responses'], `${pointer}/responses`, issues),
        security: securityList(raw['security']) ?? rootSecurity,
        idempotent: raw['x-ket-idempotent'] === true || parameters.some(isIdempotencyHeader),
        capability: capabilityOf(raw['x-ket-capability']),
        extensions: Object.keys(raw)
          .filter((key) => key.startsWith('x-') && !READ_EXTENSIONS.has(key))
          .sort()
          .map((name) => ({ name, value: raw[name] })),
      })
    }
  }

  const byGroup = new Map<string, SpecOperation[]>()
  for (const operation of operations) {
    const list = byGroup.get(operation.group) ?? []
    list.push(operation)
    byGroup.set(operation.group, list)
  }
  const groups = [...byGroup.keys()]
    .sort((a, b) => a.localeCompare(b))
    .map((label) => ({ id: slug(label) || 'root', label, operations: byGroup.get(label) ?? [] }))

  return {
    ok: true,
    model: {
      openapi: version,
      title: text(info['title']) ?? 'API',
      version: text(info['version']) ?? '',
      description: text(info['description']),
      servers: Array.isArray(input['servers'])
        ? input['servers']
            .filter(isObject)
            .flatMap((server) =>
              text(server['url'])
                ? [{ url: serverUrl(server), description: text(server['description']) }]
                : [],
            )
        : [],
      securitySchemes: schemes(input, issues),
      groups,
      // Navigation order: group, then path, then method.
      operations: groups.flatMap((group) => group.operations),
      issues,
      document: input,
    },
  }
}

export const findOperation = (model: SpecModel, id: string | null): SpecOperation | null =>
  id === null ? null : (model.operations.find((operation) => operation.id === id) ?? null)

/** Case-insensitive match over method, path, operationId, summary and group. */
/**
 * Whether the declared schemes are alternatives: every security requirement in the
 * document names at most one scheme, so a request presents any one of them.
 */
export const schemesAreAlternatives = (model: SpecModel): boolean =>
  model.operations.every((operation) => (operation.security ?? []).every((names) => names.length <= 1))

export const searchOperations = (model: SpecModel, query: string): SpecOperation[] => {
  const terms = query.toLowerCase().split(/\s+/).filter(Boolean)
  if (terms.length === 0) return []
  return model.operations.filter((operation) => {
    const haystack = [
      operation.method,
      operation.path,
      operation.operationId ?? '',
      operation.summary ?? '',
      operation.group,
      // Readers search by the permission an operation requires.
      operation.capability?.key ?? '',
      operation.capability?.action ?? '',
    ]
      .join(' ')
      .toLowerCase()
    return terms.every((term) => haystack.includes(term))
  })
}
