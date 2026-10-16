# Flow extension contracts

Global search stays in core. An extension may supply `searchLabels()` for its
localized result-group labels; its server read adapter contributes only records
from the tenant's authorized projection. In Atlas this is the `searchGroups`
hook, invoked after the shared bootstrap permission projection (including Pro
scope hooks). Preserve native route parameters, including repository/branch/path
for an Atlas result. Core never imports the private search provider. No extension
may add another content-search field to a page header or collection.

Core is MIT. The application entry registers client extensions before creating the
first workspace. Registration order is render/guard order; names, routes, forms and
API error codes have one owner. Invalid registration changes no shared registry.
The registry is process-local: an entry must choose its edition once, not register
features conditionally per HTTP request. Tenant entitlements and authorization stay
on the server, not in route visibility.

`shellData(authorizedBootstrap)` may return the minimal metadata needed by an
extension's SSR navigation. It must omit primary feature records and values such
as scores, work-hour notes and document bodies. It cannot replace any field owned
by Core's `flowShellData` whitelist; duplicate field ownership is rejected. Pro's
quality projection supplies only authorized `visibleUserIds` for its personal
performance destination. Use the same registry and projection on server and client
so enhancement attaches events to matching SSR markup. The shell's routed tabs
stay outside the primary CSR data island.

Each island gets a fresh `create(ctx)` instance. `view`/`modal`, `topAction`,
`navigation`, `taskSection`, `taskLinks`, `taskEstimate`, `taskStatusHint`,
`taskPoints`, `settingsSection` and `sprintSummary` compose public Flow UI components.
`settingsSection(key, scope)` is called with `organization-settings`, `project-settings` and
`workspace-settings` (the Workspace record as `scope`); return one settings row
(`FlowSection({ inset: 'none', title, description, actions })`) or `null`. The host lays the rows
out in a divided stack, so a row brings no outer padding or border of its own.
`transition` may refuse or redirect client actions, but never replaces server checks.
`mutationError` can claim a failed operation; `ownsFeedback` suppresses the outer toast
while a feature dialog renders the same feedback. Failing writes must show one toast.

`ctx.requestLeave(action)` protects unsaved native business forms before an extension
closes its own dialog or switches an inline editor. The action runs after discard
confirmation, or immediately when the form is unchanged; it does not run on Cancel.
Task-creation drafts that already persist in the session and immediate appearance
preferences keep their existing behavior. The core owns draft baselines and the
centred `FlowConfirmDialog`; extensions do not rebuild that UI.

`ctx.confirmAction({ title, message, label, action })` asks before a consequential
write using that same core-owned dialog. `action` runs only after confirmation and
returns `true` when complete; `false` keeps the question open for recovery. Cancel
does not run it. Capture the record ID/version and submitted values in the request;
the core retains the native submission boundary for draft acceptance. Route changes
cancel a pending question. Busy, read-only and overlapping requests are refused.

Use `ctx.history` for extension-owned same-document push/replace/back operations.
Its indexed entries allow the core to restore a dirty form's URL before asking about
Back/Forward. Do not bypass it with global history mutations. `ctx.formError()`
exposes the current server field errors for the owning public input/select/textarea
components; failed writes retain their native draft. Production permission, CAS and
idempotency checks remain server responsibilities.

An extension can provide `modalRecord(key): { body, footer }` for the shared
dialog's persistent footer. The core uses that body and footer together; `modal`
remains the compatible fallback. Render both in one pure composition pass.
Give the primary native form an explicit ID and associate its external submit
button with `form="<id>"`. Independent secondary forms keep their own actions;
do not infer the primary form by DOM order or move every submit into the footer.
The shared dialog owns footer geometry, scrolling and focus behavior.

`readUrl` restores Back/Forward state; `urlParams` contributes route state before
explicit navigation parameters override it. `beforeNavigate` runs before changing
route. `sync` runs after reads/navigation; `afterRender` attaches an external viewer.
These asynchronous hooks own their cancellation/error handling. `reset` discards
context-specific state on organization/workspace switches, including browser history.
`dispose` releases viewers and requests. Product source must never import Atlas.

## Server boundary

An extension may expose `modalTitle(key)` to identify the authorized record in
the shared dialog header. Return nothing to retain the registered route title;
never resolve an unscoped record solely to populate its title.

Import `createFlowServerExtensions` explicitly from `server-extensions.mjs`. It is
an independently composed registry, not a global registration side effect. Command
names and capability requirements are explicit. Missing commands return
`{ handled: false }`; a core-only host has no private commands or guards.

`mutate(context, {name, input, capability}, write)` calls the host's
`requireCapability(capability, input)` before opening its transaction. The host must
throw on refusal and must resolve tenant, actor and record scope from authenticated
server state. Inside `transaction(callback)`, all `beforeMutation(scoped, mutation)`
guards run in registration order before `write(scoped)`. A guard throws to refuse;
the transaction must roll back any failure. `dispatch` uses that same path for an
extension-owned command. Cleanup is idempotent and attempts every extension in
reverse registration order, reporting failures together.

The host remains responsible for input validation, capability and tenant resolution,
CAS/locks, idempotency/replay and durable outbox work. No external effect belongs
inside a retryable transaction. All write paths (HTTP, staff, import, bulk, automation)
must eventually invoke this boundary or its equivalent inside the same authoritative
transaction. This commit supplies and tests the contract; it does not claim that the
existing KetSuite production endpoints have been migrated. That adapter is tracked
by D05/G03 in the implementation matrix.

## Atlas adapters

`atlas/extensions.mjs` is a synchronous fixture hook runner used only by the mock.
It is deliberately separate from the transactional server contract. Core fixtures
contain no pro data. The private Atlas entry supplies additional seeds, reads,
commands, guards, scoped fields and cleanup to the public fixture creators. Its
`scope` hook adds fields to a screen read and `routeProjection({result, args})` trims
them to what `args.route` shows, keeping the full record for `args.recordId`.
`detail({view, result, args})` adds the opened task's own records from the
unprojected `view` to `flow.issue.detail`, because a summary may omit them. On the
client, `recordDetail(data, detail)` folds those records into the workspace data
and returns the new data, or `data` itself when the detail carries none. The same
fold applies a write's `record` to an opened task, so a write that changes the
extension's records for the task must leave them in its detail. An
extension form opened with an `id` waits for that record before `modalRecord` or
`modal` composes it, and `taskSection` is not called over a summary. Never
use an Atlas session or generic fixture writer as a production command handler.
