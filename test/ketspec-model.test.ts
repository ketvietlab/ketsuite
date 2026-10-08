import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { SPEC_LOCALES, SPEC_MESSAGES, specTranslator } from '../packages/ketspec/src/messages.ts'
import {
  findOperation,
  readSpec,
  schemesAreAlternatives,
  searchOperations,
  type SpecModel,
} from '../packages/ketspec/src/model.ts'
import {
  buildRequest,
  curlOf,
  errorEnvelope,
  initialValues,
  MASK,
  MAX_BODY_CHARS,
  readResponse,
  tryParameters,
} from '../packages/ketspec/src/request.ts'
import { exampleOf, MAX_SCHEMA_ROWS, schemaRows } from '../packages/ketspec/src/schema.ts'

const document = {
  openapi: '3.1.0',
  info: { title: 'Orders API', version: '2.0.0' },
  servers: [{ url: 'https://{region}.api.example.test/v1', variables: { region: { default: 'eu' } } }],
  components: {
    securitySchemes: {
      bearer: { type: 'http', scheme: 'bearer' },
      key: { type: 'apiKey', in: 'query', name: 'api_key' },
      session: { type: 'apiKey', in: 'cookie', name: 'session' },
    },
    parameters: { orderId: { name: 'id', in: 'path', required: true, schema: { type: 'string' } } },
    schemas: {
      Order: {
        type: 'object',
        required: ['id'],
        properties: {
          id: { type: 'string', readOnly: true },
          note: { type: 'string', example: 'Leave at the door' },
          lines: { type: 'array', items: { $ref: '#/components/schemas/Line' } },
          parent: { $ref: '#/components/schemas/Order' },
        },
      },
      Line: {
        type: 'object',
        properties: { sku: { type: 'string', format: 'uuid' }, qty: { type: 'integer', minimum: 1 } },
      },
    },
  },
  security: [{ bearer: [] }],
  paths: {
    '/orders': {
      get: {
        operationId: 'listOrders',
        summary: 'List orders',
        'x-ket-capability': 'sales.read',
        responses: { 200: { description: 'OK' } },
      },
      post: {
        operationId: 'createOrder',
        'x-ket-idempotent': true,
        requestBody: {
          required: true,
          content: { 'application/json': { schema: { $ref: '#/components/schemas/Order' } } },
        },
        responses: { 201: { description: 'Created' } },
      },
    },
    '/orders/{id}': {
      parameters: [{ $ref: '#/components/parameters/orderId' }],
      get: { operationId: 'getOrder', security: [{ key: [] }], responses: { 200: { description: 'OK' } } },
      delete: {
        operationId: 'getOrder',
        security: [{ session: [] }],
        responses: { 204: { description: 'Gone' } },
      },
    },
    '/health': { get: { security: [{}], responses: { 200: { description: 'OK' } } } },
    '/broken': { get: { parameters: [{ $ref: '#/components/parameters/missing' }], responses: {} } },
  },
}

const model = (): SpecModel => {
  const result = readSpec(document)
  assert.equal(result.ok, true)
  return (result as { ok: true; model: SpecModel }).model
}

test('ketspec model: rejects what is not an OpenAPI 3 document, with a reason', () => {
  assert.deepEqual(readSpec([]), {
    ok: false,
    problem: { code: 'not-object', detail: 'The document is not a JSON object.' },
  })
  const swagger = readSpec({ swagger: '2.0', paths: {} })
  assert.equal(swagger.ok, false)
  const old = readSpec({ openapi: '2.0.0', info: { title: 't', version: '1' }, paths: {} })
  assert.equal(old.ok, false)
  assert.equal((old as { problem: { code: string } }).problem.code, 'unsupported-version')
})

test('ketspec model: groups by path segment in name order, merges path parameters and keeps ids unique', () => {
  const spec = model()
  assert.equal(spec.title, 'Orders API')
  assert.equal(spec.servers[0]?.url, 'https://eu.api.example.test/v1')
  assert.deepEqual(
    spec.groups.map((group) => group.id),
    ['broken', 'health', 'orders'],
  )
  const ids = spec.operations.map((operation) => operation.id)
  assert.equal(new Set(ids).size, ids.length)
  const get = findOperation(spec, 'getOrder')
  assert.deepEqual(
    get?.parameters.map((parameter) => `${parameter.in}.${parameter.name}`),
    ['path.id'],
  )
  assert.ok(spec.issues.some((issue) => issue.code === 'duplicate-operation-id'))
  assert.ok(spec.issues.some((issue) => issue.code === 'unresolved-ref'))
  assert.equal(findOperation(spec, 'createOrder')?.idempotent, true)
})

test('ketspec model: search matches path, summary and the KetJS capability; every term must match', () => {
  const spec = model()
  assert.deepEqual(
    searchOperations(spec, 'sales.read').map((operation) => operation.id),
    ['listOrders'],
  )
  assert.deepEqual(
    searchOperations(spec, 'orders list').map((operation) => operation.id),
    ['listOrders'],
  )
  assert.deepEqual(searchOperations(spec, '   '), [])
  const objectCapability = readSpec({
    openapi: '3.1.0',
    info: { title: 't', version: '1' },
    paths: {
      '/c': {
        post: {
          operationId: 'create',
          'x-ket-capability': { key: 'sales.customers', action: 'create' },
          responses: {},
        },
      },
    },
  })
  assert.ok(objectCapability.ok)
  assert.deepEqual(
    searchOperations(objectCapability.model, 'sales.customers create').map((operation) => operation.id),
    ['create'],
  )
  // Ket extensions become typed facts instead of raw extension rows.
  const created = objectCapability.model.operations[0]
  assert.deepEqual(created?.capability, { key: 'sales.customers', action: 'create' })
  assert.ok(!created?.extensions.some((extension) => extension.name.startsWith('x-ket-')))
  assert.deepEqual(findOperation(spec, 'listOrders')?.capability, { key: 'sales.read', action: null })
  assert.equal(findOperation(spec, 'createOrder')?.capability, null)
})

test('ketspec model: schemes are alternatives unless one requirement combines them', () => {
  assert.equal(schemesAreAlternatives(model()), true)
  const combined = readSpec({
    openapi: '3.1.0',
    info: { title: 't', version: '1' },
    components: {
      securitySchemes: {
        bearer: { type: 'http', scheme: 'bearer' },
        key: { type: 'apiKey', in: 'header', name: 'x-key' },
      },
    },
    paths: { '/c': { get: { security: [{ bearer: [], key: [] }], responses: {} } } },
  })
  assert.ok(combined.ok)
  assert.equal(schemesAreAlternatives(combined.model), false)
})

test('ketspec schema: expands nested schemas, marks cycles and stays bounded', () => {
  const spec = model()
  const order = findOperation(spec, 'createOrder')?.requestBody?.schema ?? null
  const { rows, truncated } = schemaRows(spec.document, order)
  assert.equal(truncated, false)
  const byName = new Map(rows.map((row) => [row.name, row]))
  assert.equal(byName.get('id')?.required, true)
  assert.equal(byName.get('id')?.readOnly, true)
  assert.ok(rows.some((row) => row.name === 'sku' && row.constraints.some((word) => word.includes('uuid'))))
  assert.equal(byName.get('parent')?.unresolved, 'circular')

  const wide = {
    type: 'object',
    properties: Object.fromEntries(
      Array.from({ length: MAX_SCHEMA_ROWS + 50 }, (_, index) => [`p${index}`, { type: 'string' }]),
    ),
  }
  const bounded = schemaRows(spec.document, wide)
  assert.equal(bounded.truncated, true)
  assert.equal(bounded.rows.length, MAX_SCHEMA_ROWS)

  const example = exampleOf(spec.document, order) as Record<string, unknown>
  assert.equal(example['id'], undefined, 'read-only properties are not part of a request example')
  assert.equal(example['note'], 'Leave at the door')
})

test('ketspec request: required values, JSON and header values are refused on their fields', () => {
  const spec = model()
  const create = findOperation(spec, 'createOrder')
  assert.ok(create)
  const refused = buildRequest(spec, create, { body: '{nope' }, 'http://localhost')
  assert.deepEqual(refused, { ok: false, problems: { body: 'json', 'auth.bearer': 'required' } })
  const header = buildRequest(spec, create, { body: '{}', 'auth.bearer': 'a\nb' }, 'http://localhost')
  assert.deepEqual(header, { ok: false, problems: { 'auth.bearer': 'header' } })
  const path = buildRequest(spec, findOperation(spec, 'getOrder') as never, {}, 'http://localhost')
  assert.equal(path.ok, false)
  assert.equal((path as { problems: Record<string, string> }).problems['path.id'], 'required')
})

test('ketspec request: builds the request and masks every secret in the curl preview', () => {
  const spec = model()
  const create = findOperation(spec, 'createOrder')
  assert.ok(create)
  // The synthetic Idempotency-Key is asked for, and what is typed into it is sent.
  assert.ok(tryParameters(create).some((parameter) => parameter.name === 'Idempotency-Key'))
  const built = buildRequest(
    spec,
    create,
    { body: '{ "note": "x" }', 'auth.bearer': 'secret-token', 'header.Idempotency-Key': 'key-1' },
    'http://localhost',
  )
  assert.equal(built.ok, true)
  const request = (built as { ok: true; request: Parameters<typeof curlOf>[0] }).request
  assert.equal(request.url, 'https://eu.api.example.test/v1/orders')
  assert.equal(request.body, '{"note":"x"}')
  assert.deepEqual(
    request.headers.map(([name]) => name),
    ['Idempotency-Key', 'Authorization', 'Content-Type', 'Accept'],
  )
  const curl = curlOf(request)
  assert.ok(!curl.includes('secret-token'))
  assert.ok(curl.includes(`Authorization: Bearer ${MASK}`))
  assert.ok(curlOf(request, true).includes('secret-token'))

  const query = buildRequest(
    spec,
    findOperation(spec, 'getOrder') as never,
    { 'path.id': 'a/b', 'auth.key': 'k1' },
    'http://localhost',
  )
  const queryRequest = (query as { ok: true; request: Parameters<typeof curlOf>[0] }).request
  assert.equal(queryRequest.url, 'https://eu.api.example.test/v1/orders/a%2Fb?api_key=k1')
  assert.ok(!curlOf(queryRequest).includes('k1'))

  const health = spec.operations.find((operation) => operation.path === '/health')
  assert.ok(health)
  assert.equal(
    buildRequest(spec, health, {}, 'http://localhost').ok,
    true,
    'a public operation needs no credential',
  )
})

test('ketspec request: a fresh console is deterministic on the server', () => {
  const spec = model()
  const create = findOperation(spec, 'createOrder')
  assert.ok(create)
  const values = initialValues(spec, create, () => 'generated')
  assert.equal(values['server'], 'https://eu.api.example.test/v1')
  assert.equal(values['header.Idempotency-Key'], '', 'an optional key is left for the reader')
  assert.deepEqual(JSON.parse(values['body'] ?? ''), {
    note: 'Leave at the door',
    lines: [{ sku: '3f2a8c1e-5b7d-4e9a-8c6f-1d2e3f4a5b6c', qty: 1 }],
    // A recursive reference stops at null instead of expanding forever.
    parent: null,
  })
  assert.deepEqual(
    initialValues(spec, create, () => 'x'),
    initialValues(spec, create, () => 'y'),
  )
})

test('ketspec response: reads the KetJS error envelope and bounds the body', () => {
  const envelope = {
    error: {
      code: 'invalid_input',
      message: 'Some fields are invalid.',
      requestId: 'req-1',
      fields: { email: [{ field: 'email', code: 'format', messageKey: 'errors.email', params: {} }] },
    },
  }
  assert.deepEqual(errorEnvelope(envelope), {
    code: 'invalid_input',
    message: 'Some fields are invalid.',
    requestId: 'req-1',
    // The message key is more specific than the code, so it is what a reader sees.
    fields: [{ field: 'email', codes: ['errors.email'] }],
  })
  assert.equal(errorEnvelope({ data: 1 }), null)
  const response = readResponse({
    status: 422,
    statusText: 'Unprocessable',
    headers: [['X-Request-Id', 'req-header']],
    text: JSON.stringify(envelope),
    durationMs: 12.4,
  })
  assert.equal(response.requestId, 'req-header')
  assert.equal(response.envelope?.code, 'invalid_input')
  assert.equal(response.durationMs, 12)
  const ok = readResponse({
    status: 200,
    statusText: 'OK',
    headers: [],
    text: JSON.stringify(envelope),
    durationMs: 1,
  })
  assert.equal(ok.envelope, null, 'a success body is never read as an error')
  const huge = readResponse({
    status: 200,
    statusText: 'OK',
    headers: [],
    text: 'x'.repeat(MAX_BODY_CHARS + 1),
    durationMs: 1,
  })
  assert.equal(huge.truncated, true)
  assert.equal(huge.body.length, MAX_BODY_CHARS)
})

test('ketspec messages: every locale has every key, and the product is called Spec', () => {
  const keys = Object.keys(SPEC_MESSAGES.en).sort()
  for (const locale of SPEC_LOCALES) {
    assert.deepEqual(Object.keys(SPEC_MESSAGES[locale]).sort(), keys, locale)
    for (const [key, value] of Object.entries(SPEC_MESSAGES[locale]))
      assert.notEqual(value.trim(), '', `${locale} ${key}`)
    assert.equal(SPEC_MESSAGES[locale]['spec.brand'], 'Spec')
  }
  assert.equal(specTranslator('vi-VN').locale, 'vi')
  assert.equal(specTranslator('fr').locale, 'en')
  assert.match(specTranslator('en')('spec.try.timeout', { seconds: 30 }), /30 seconds/)
})

test('ketspec fixtures: the KetSuite contracts read without problems', () => {
  for (const name of ['customer-v1', 'staff-v1']) {
    const result = readSpec(JSON.parse(readFileSync(`docs/public/api/${name}.openapi.json`, 'utf8')))
    assert.equal(result.ok, true, name)
    const spec = (result as { ok: true; model: SpecModel }).model
    assert.deepEqual(spec.issues, [], name)
    assert.ok(spec.operations.length > 0)
    for (const operation of spec.operations)
      assert.ok(schemaRows(spec.document, operation.requestBody?.schema ?? null).rows.length >= 0)
  }
})
