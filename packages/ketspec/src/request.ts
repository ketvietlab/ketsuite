/**
 * Pure try-it logic: turning form values into an HTTP request, and an HTTP
 * response into something a person can read. The browser runtime only moves
 * values in and out; everything decidable without a network lives here.
 */
import {
  isIdempotencyHeader,
  type SecurityScheme,
  type SpecModel,
  type SpecOperation,
  type SpecParameter,
} from './model.ts'
import { exampleOf } from './schema.ts'

/** Form field names. Kept in one place so the view and the runtime agree. */
export const fieldName = {
  server: 'server',
  credential: 'credential',
  body: 'body',
  parameter: (parameter: Pick<SpecParameter, 'in' | 'name'>) => `${parameter.in}.${parameter.name}`,
}

export type TryValues = Readonly<Record<string, string>>

export type FieldProblem = 'required' | 'json' | 'header' | 'server'

export type BuiltRequest = {
  method: string
  url: string
  headers: readonly (readonly [string, string])[]
  body: string | null
  /** Header names whose values are secrets; the curl preview masks them. */
  secretHeaders: readonly string[]
  /** Query keys whose values are secrets. */
  secretQuery: readonly string[]
}

export type BuildResult =
  | { ok: true; request: BuiltRequest }
  | { ok: false; problems: Record<string, FieldProblem> }

/** The ways to authenticate an operation, each with the schemes it combines. Empty means public. */
export const credentialOptions = (
  model: SpecModel,
  operation: SpecOperation,
): readonly { id: string; schemes: readonly SecurityScheme[] }[] => {
  const requirements = operation.security ?? []
  return requirements
    .filter((names) => names.length > 0)
    .map((names) => ({
      id: names.join('+'),
      schemes: names.flatMap((name) => model.securitySchemes.filter((scheme) => scheme.id === name)),
    }))
}

export const isPublic = (operation: SpecOperation): boolean =>
  operation.security?.some((names) => names.length === 0) === true

/** A scheme the browser can supply from a typed value. Cookies come from the browser itself. */
export const schemeTakesValue = (scheme: SecurityScheme): boolean =>
  (scheme.type === 'http' && (scheme.scheme === 'bearer' || scheme.scheme === 'basic')) ||
  (scheme.type === 'apiKey' && (scheme.in === 'header' || scheme.in === 'query'))

export const schemeField = (scheme: SecurityScheme): string => `auth.${scheme.id}`

/** RFC 9110 token characters; a header name outside them cannot be sent. */
const TOKEN = /^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/
/** Field values: visible ASCII and spaces, no control characters (fetch rejects them). */
const HEADER_VALUE = /^[\t\x20-\x7e\x80-\xff]*$/

const resolveServer = (server: string, origin: string): string | null => {
  try {
    const url = new URL(server, origin)
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null
    return url.href.replace(/\/+$/, '')
  } catch {
    return null
  }
}

/** Basic credentials are typed as `user:password` and sent base64-encoded. */
const basic = (value: string): string => {
  const bytes = new TextEncoder().encode(value)
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary)
}

export const buildRequest = (
  model: SpecModel,
  operation: SpecOperation,
  values: TryValues,
  origin: string,
): BuildResult => {
  const problems: Record<string, FieldProblem> = {}
  const value = (name: string) => values[name] ?? ''

  const server = resolveServer(value(fieldName.server) || model.servers[0]?.url || '/', origin)
  if (server === null) problems[fieldName.server] = 'server'

  let path = operation.path
  const query = new URLSearchParams()
  const headers: [string, string][] = []
  const secretHeaders: string[] = []
  const secretQuery: string[] = []

  // The console's parameters, so a key typed into the synthetic Idempotency-Key is sent too.
  for (const parameter of tryParameters(operation)) {
    const name = fieldName.parameter(parameter)
    const raw = value(name)
    if (raw === '') {
      if (parameter.required) problems[name] = 'required'
      continue
    }
    if (parameter.in === 'path') path = path.replaceAll(`{${parameter.name}}`, encodeURIComponent(raw))
    else if (parameter.in === 'query') query.append(parameter.name, raw)
    else if (parameter.in === 'header') {
      if (!TOKEN.test(parameter.name) || !HEADER_VALUE.test(raw)) problems[name] = 'header'
      else headers.push([parameter.name, raw])
    }
    // Cookie parameters cannot be set from a page; the browser sends its own cookies.
  }

  const options = credentialOptions(model, operation)
  const chosen = options.find((option) => option.id === value(fieldName.credential)) ?? options[0]
  if (chosen && !isPublic(operation))
    for (const scheme of chosen.schemes) {
      if (!schemeTakesValue(scheme)) continue
      const name = schemeField(scheme)
      const raw = value(name).trim()
      if (raw === '') {
        problems[name] = 'required'
        continue
      }
      if (!HEADER_VALUE.test(raw)) {
        problems[name] = 'header'
        continue
      }
      if (scheme.type === 'http') {
        headers.push([
          'Authorization',
          `${scheme.scheme === 'basic' ? 'Basic' : 'Bearer'} ${scheme.scheme === 'basic' ? basic(raw) : raw}`,
        ])
        secretHeaders.push('authorization')
      } else if (scheme.in === 'header' && scheme.name) {
        headers.push([scheme.name, raw])
        secretHeaders.push(scheme.name.toLowerCase())
      } else if (scheme.in === 'query' && scheme.name) {
        query.append(scheme.name, raw)
        secretQuery.push(scheme.name)
      }
    }

  let body: string | null = null
  if (operation.requestBody) {
    const raw = value(fieldName.body).trim()
    if (raw === '') {
      if (operation.requestBody.required) problems[fieldName.body] = 'required'
    } else if (/json/i.test(operation.requestBody.mediaType)) {
      try {
        body = JSON.stringify(JSON.parse(raw))
      } catch {
        problems[fieldName.body] = 'json'
      }
    } else body = raw
    if (body !== null) headers.push(['Content-Type', operation.requestBody.mediaType])
  }
  if (!headers.some(([name]) => name.toLowerCase() === 'accept')) headers.push(['Accept', 'application/json'])

  if (Object.keys(problems).length > 0 || server === null) return { ok: false, problems }
  const search = query.toString()
  return {
    ok: true,
    request: {
      method: operation.method.toUpperCase(),
      url: `${server}${path}${search ? `?${search}` : ''}`,
      headers,
      body,
      secretHeaders,
      secretQuery,
    },
  }
}

const shellQuote = (value: string): string => `'${value.replaceAll("'", `'\\''`)}'`

export const MASK = '••••••'

/** A copyable curl command. Secrets are masked unless explicitly revealed. */
export const curlOf = (request: BuiltRequest, reveal = false): string => {
  let url = request.url
  if (!reveal && request.secretQuery.length > 0) {
    const parsed = new URL(url)
    for (const key of request.secretQuery)
      if (parsed.searchParams.has(key)) parsed.searchParams.set(key, MASK)
    url = parsed.href
  }
  const lines = [`curl -X ${request.method} ${shellQuote(url)}`]
  for (const [name, raw] of request.headers) {
    const secret = !reveal && request.secretHeaders.includes(name.toLowerCase())
    const shown = secret
      ? name.toLowerCase() === 'authorization'
        ? `${raw.split(' ')[0]} ${MASK}`
        : MASK
      : raw
    lines.push(`  -H ${shellQuote(`${name}: ${shown}`)}`)
  }
  if (request.body !== null) lines.push(`  --data-raw ${shellQuote(request.body)}`)
  return lines.join(' \\\n')
}

export type FieldIssueSummary = { field: string; codes: readonly string[] }

export type ErrorEnvelope = {
  code: string | null
  message: string | null
  requestId: string | null
  fields: readonly FieldIssueSummary[]
}

export type ReadResponse = {
  status: number
  statusText: string
  ok: boolean
  durationMs: number
  headers: readonly (readonly [string, string])[]
  requestId: string | null
  contentType: string | null
  /** Pretty JSON when the body parses, the raw text otherwise. */
  body: string
  bytes: number
  json: boolean
  /** True when the body was longer than MAX_BODY_CHARS and was cut. */
  truncated: boolean
  envelope: ErrorEnvelope | null
}

/** The response body shown in the console is bounded; larger bodies are cut with a note. */
export const MAX_BODY_CHARS = 200_000

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

/** Reads the KetJS envelope `{ error: { code, message, requestId, fields? } }`. */
export const errorEnvelope = (body: unknown): ErrorEnvelope | null => {
  if (!isRecord(body) || !isRecord(body['error'])) return null
  const error = body['error']
  const fields = isRecord(error['fields'])
    ? Object.entries(error['fields']).map(([field, issues]) => ({
        field,
        codes: Array.isArray(issues)
          ? issues.map((issue) =>
              isRecord(issue) ? String(issue['messageKey'] ?? issue['code'] ?? '') : String(issue),
            )
          : [String(issues)],
      }))
    : []
  return {
    code: typeof error['code'] === 'string' ? error['code'] : null,
    message: typeof error['message'] === 'string' ? error['message'] : null,
    requestId: typeof error['requestId'] === 'string' ? error['requestId'] : null,
    fields,
  }
}

export const readResponse = (input: {
  status: number
  statusText: string
  headers: readonly (readonly [string, string])[]
  text: string
  durationMs: number
}): ReadResponse => {
  const header = (name: string) => input.headers.find(([key]) => key.toLowerCase() === name)?.[1] ?? null
  let parsed: unknown
  let json = false
  if (input.text !== '')
    try {
      parsed = JSON.parse(input.text)
      json = true
    } catch {
      json = false
    }
  const pretty = json ? JSON.stringify(parsed, null, 2) : input.text
  const envelope = json ? errorEnvelope(parsed) : null
  return {
    status: input.status,
    statusText: input.statusText,
    ok: input.status >= 200 && input.status < 300,
    durationMs: Math.round(input.durationMs),
    headers: [...input.headers].sort(([a], [b]) => a.localeCompare(b)),
    requestId: header('x-request-id') ?? envelope?.requestId ?? null,
    contentType: header('content-type'),
    body: pretty.length > MAX_BODY_CHARS ? pretty.slice(0, MAX_BODY_CHARS) : pretty,
    bytes: new TextEncoder().encode(input.text).length,
    json,
    truncated: pretty.length > MAX_BODY_CHARS,
    envelope: input.status >= 400 ? envelope : null,
  }
}

/** A random Idempotency-Key: 1–255 visible ASCII characters, as KetJS requires. */
export const newIdempotencyKey = (): string => crypto.randomUUID()

/** The parameters the console asks for: declared ones, plus Idempotency-Key when only `x-ket-idempotent` says so. */
export const tryParameters = (operation: SpecOperation): readonly SpecParameter[] =>
  operation.idempotent && !operation.parameters.some(isIdempotencyHeader)
    ? [
        ...operation.parameters,
        {
          name: 'Idempotency-Key',
          in: 'header',
          required: false,
          description: null,
          deprecated: false,
          schema: { type: 'string', minLength: 1, maxLength: 255 },
        },
      ]
    : operation.parameters

/**
 * The values a fresh console starts with: the first server, declared parameter
 * examples, a body example, and a key for a required Idempotency-Key. `key`
 * supplies that key; a server render passes `() => ''` to stay deterministic.
 */
export const initialValues = (
  model: SpecModel,
  operation: SpecOperation,
  key: () => string,
): Record<string, string> => {
  const values: Record<string, string> = {}
  if (model.servers[0]) values[fieldName.server] = model.servers[0].url
  for (const parameter of tryParameters(operation)) {
    const name = fieldName.parameter(parameter)
    if (isIdempotencyHeader(parameter)) {
      values[name] = parameter.required ? key() : ''
      continue
    }
    const schema = parameter.schema
    if (schema && (schema['example'] !== undefined || schema['default'] !== undefined)) {
      const example = exampleOf(model.document, schema)
      values[name] = typeof example === 'string' ? example : JSON.stringify(example)
    }
  }
  if (operation.requestBody && /json/i.test(operation.requestBody.mediaType))
    values[fieldName.body] = JSON.stringify(
      exampleOf(model.document, operation.requestBody.schema) ?? {},
      null,
      2,
    )
  return values
}
