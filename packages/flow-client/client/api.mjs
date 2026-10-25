import { tr } from './i18n.mjs'
import { extensionErrors } from './extensions.mjs'
import { resolveFlowCommand } from './command-contract.mjs'
export class FlowApiError extends Error {
  constructor(message, code = 'request', fields = {}) {
    super(message)
    this.name = 'FlowApiError'
    this.code = code
    this.fields = fields
  }
}
const fieldErrorMessages = {
  required: 'flow.validation.required',
  invalid: 'flow.validation.invalid',
  duplicate: 'flow.validation.duplicate',
  too_long: 'flow.validation.tooLong',
  scope: 'flow.validation.scope',
  scope_changed: 'flow.validation.scopeChanged',
  upload_expired: 'flow.validation.uploadExpired',
  catalog_owner_locked: 'flow.catalog.ownerImmutable',
  catalog_owner_invalid: 'flow.catalog.ownerInvalid',
  incompatible_values: 'flow.catalog.incompatibleExistingValues',
  catalog_duplicate_title: 'flow.catalog.duplicateTitle',
  catalog_required_group: 'flow.catalog.requiredStatusGroup',
  catalog_invalid_kind: 'flow.catalog.invalidKind',
  catalog_invalid_icon: 'flow.catalog.invalidIcon',
  catalog_status_in_use: 'flow.catalog.statusReferenced',
}
const fieldErrorMessage = (message) =>
  typeof message === 'string' && Object.hasOwn(fieldErrorMessages, message)
    ? tr(fieldErrorMessages[message])
    : null
export async function selectFlowCompany(companyId, fromCompany, { fetch: send = globalThis.fetch } = {}) {
  const response = await send('/flow/context', {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ companyId, fromCompany }),
  })
  if (!response.ok)
    throw new FlowApiError(
      tr(
        response.status === 401
          ? 'flow.ui.session.expired'
          : response.status === 403
            ? 'flow.ui.access.denied'
            : 'flow.ui.unable.to.process.the.request',
      ),
      response.status === 401
        ? 'unauthenticated'
        : response.status === 403
          ? 'forbidden'
          : response.status === 409
            ? 'conflict'
            : 'request',
    )
  const value = await response.json()
  if (value?.ok !== true) throw new FlowApiError(tr('flow.ui.invalid.response.please.try.again'), 'response')
}
// The product and Atlas use this exact HTTP transport and response normalization.
export function createFnClient({ fetch: send = globalThis.fetch, headers = {} } = {}) {
  return async (name, input = {}, options = {}) => {
    const resolved = resolveFlowCommand(name, input)
    name = resolved.name
    input = resolved.input
    const response = await send(`/_ket/fn/${encodeURIComponent(name)}`, {
      method: 'POST',
      credentials: 'same-origin',
      headers: {
        'content-type': 'application/json',
        ...headers,
        ...(options.key ? { 'idempotency-key': options.key } : {}),
      },
      body: JSON.stringify(input),
      signal: options.signal,
    })
    if (response.status === 401 || response.status === 403)
      throw new FlowApiError(
        tr(response.status === 401 ? 'flow.ui.session.expired' : 'flow.ui.access.denied'),
        response.status === 401 ? 'unauthenticated' : 'forbidden',
      )
    let payload
    try {
      payload = await response.json()
    } catch {
      throw new FlowApiError(tr('flow.ui.invalid.response.please.try.again'), 'response')
    }
    const value = payload.value
    if (!response.ok || payload.ok === false || value?.ok === false) {
      const first = value?.errors?.[0]
      const messageKey = extensionErrors[first?.code]
      const fields = Object.fromEntries(
        Object.entries(value?.fields ?? {}).map(([name, message]) => [
          name,
          fieldErrorMessage(message) ?? message,
        ]),
      )
      const nativeFieldMessage = Object.values(value?.fields ?? {})
        .map(fieldErrorMessage)
        .find(Boolean)
      throw new FlowApiError(
        (messageKey ? tr(messageKey) : null) ??
          first?.message ??
          payload.message ??
          nativeFieldMessage ??
          tr('flow.ui.unable.to.process.the.request'),
        first?.code ?? payload.code ?? `http.${response.status}`,
        fields,
      )
    }
    return value
  }
}
// File bytes go up first; the returned uploadId is then referenced by `flow.entity.save`.
export function createFileUploader({ fetch: send = globalThis.fetch, headers = {} } = {}) {
  return async (file, options = {}) => {
    const body = new FormData()
    body.append('file', file, file.name)
    const owner = options.taskId
      ? `task=${encodeURIComponent(options.taskId)}`
      : `project=${encodeURIComponent(options.projectId ?? '')}`
    const response = await send(`/flow/uploads?${owner}`, {
      method: 'POST',
      credentials: 'same-origin',
      headers: {
        ...headers,
      },
      body,
      signal: options.signal,
    })
    let payload
    try {
      payload = await response.json()
    } catch {
      throw new FlowApiError(tr('flow.ui.invalid.response.please.try.again'), 'response')
    }
    if (!response.ok || payload.ok === false || typeof payload.uploadId !== 'string')
      throw new FlowApiError(
        payload.message ?? tr('flow.ui.unable.to.process.the.request'),
        payload.code ?? `http.${response.status}`,
      )
    return payload
  }
}
