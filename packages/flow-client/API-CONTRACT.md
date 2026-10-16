# Flow core client adapter contract

The MIT client is shared between an Atlas fixture server and a future KetSuite
production deployment. **The fixture API is not a completed production API.**
Reuse existing KetSuite `flow` domain functions, identity, permissions, storage and
LiveDoc; adapt the client deliberately where their input contracts differ. Never
expose the fixture's generic collection writer as a production endpoint.

## Transport and lifecycle

`createFnClient()` calls same-origin `POST /_ket/fn/<name>` with JSON and cookie
credentials. The outer envelope is `{ok, value}`. An unsuccessful command may
return `{ok: true, value: {ok: false, errors: [{code,message}], fields}}`; network,
HTTP and command errors become `FlowApiError`. Reads accept AbortSignal. Late reads
must not replace the current organization. A mutation's idempotency key is sent in
both its JSON input and the `Idempotency-Key` header. Retrying an uncertain write
reuses the key; changing its payload creates a new operation.

Hosts compress documents, fragments, function responses and assets according to
`Accept-Encoding` (`Vary: Accept-Encoding`). A document has one language: changing it
starts a new SSR document. Hosts may therefore serve each message catalog module
reduced to that locale; Atlas maps every `messages.mjs` (bare or relative) through the
import map to `messages.mjs?locale=<lang>`. With `serverShell`, the client keeps the
rendered language; a different saved preference without an explicit `lang` replaces
the document with `lang=<saved>`.

`createFlowWorkspace(props, {call, upload, navigatePage})` returns a KetJS View controller. Props
identify screen, organization/workspace/project, record, filters and base path.
With `serverShell: true`, the server renders `shellView(dataIsland)` once: sidebar,
header and routed project/workspace/organization tabs live outside the data island.
Only its primary data region starts with the deterministic loading view. Mount
hydrates those existing chrome regions to attach events; later reads update only
the data region, never replace the shell. Modal transitions remain in the current
document. Same-workspace menu/tab destinations use KetJS `fragment-v1`
navigation: the existing application frame/sidebar stay mounted, while the server
returns `flow.header`, `flow.tabs` and `flow.content` slots. `fragmentSlots(island)`
and `shellView(island)` use identical hydration markers. Render the data island
with a stable key such as `['companyId', 'workspaceId']`; its `update(props)` adopts
new authorized chrome and rebinds the new SSR header/tabs without rebuilding the
sidebar. `syncFlowShellNavigation` updates only owned frame/active-state attributes.
The host injects `navigatePage` from KetJS's browser behavior navigation context;
KetJS owns cancellation, keyed reconciliation, history and focus. Listen to its
navigation-complete/popstate events rather than installing another router.
Direct GET, refresh, modified-click/new-tab and hosts without the navigation adapter
retain native fallback. Company/Workspace switching and language changes still
start a new full SSR document, so old-context chrome cannot survive those boundaries. Pending document/task autosaves finish before leaving; failed saves prevent
navigation. Dirty business forms retain their discard confirmation.

A direct modal without a valid same-company background builds its fallback URL
with the authorized company, Workspace, project and filters before the initial
SSR/hydration render. Board move falls back to the board. Task records expose
the detailed status operation; opening a blocker and closing it returns to that
operation, and subsequent closes unwind the source record and board.

Bulk preview uses the same per-item transition policy as dispatch, reports eligible
and refused counts, and disables Apply when no item is eligible. Dispatch applies
eligible items only and retains refused rows in selection. Accepted Pro results
remain immutable; board cards show review/acceptance hints while retaining native
opening and permitted ordering within a column.
Already-target rows are not eligible for a new write. An unacknowledged identical
bulk intent remains retryable after authoritative reload even if the first write
already changed those rows; its replay key is retained until acknowledgment.

Epic writes require an active, stable project, a recognized owner, an outcome and
real ISO dates in start/end order. Partial updates preserve omitted dates; failures
return field errors and do not mutate the record. Atlas enforces this mock contract;
a production adapter must enforce the same rules on its server.

An accepted command releases the busy guard after its revalidation and before
completion callbacks close a form or navigate. A refusal keeps the form and draft.
A write that changed one existing task alone (`flow.issue.save` with an `id`,
`flow.issue.move`, `flow.issue.follow`, `flow.issue.assignSprint`) returns
`record`, that task's `flow.issue.detail` read after the write. The client patches
the task in place instead of reading the screen first; a summary stays a summary,
and an opened task also takes its discussion, history and extension records. The
screen is read again once writes have paused for 300 ms, unless a read began after
the last write. A write without `record`, creating a task for example, is
revalidated before it completes, as before. A read that began before a write is
dropped when it returns, so it cannot undo that write.

Navigation shows a screen read again, without asking, for 30 seconds; the eight
latest reads are kept. Any write, and any read that is not navigation (retry,
revalidation, a Workspace switch), drops them all, so only browsing reuses a read.
A production adapter that wants fresher reuse needs a change signal, not a longer
window.
If revalidation archives the mounted Workspace and selects a fallback, the next
page establishes fresh SSR chrome; its new keyed island cannot hydrate the old
Workspace's retained sidebar. Ordinary same-Workspace menu navigation stays in place.

Organization mutation URLs pin the Workspace record before adopting authorized
shell context, including legacy `workspace-edit`/`workspace-archive` URLs without
`id`. An archived record can use fallback chrome while keeping its original ID;
it shows recovery rather than an editable replacement. The Atlas organization
adapter rejects missing/archived explicit Team or Workspace IDs and malformed
metadata before mutation. Omitted description/access are preserved on rename.
No-ID creation and idempotent replay remain supported. These fixture checks do not
certify production persistence or authorization.

Organization modals associate their primary footer submit with one native form.
Guest project grants and Pro work-week settings keep separate forms. Owner role
changes are disabled. Workspace archive uses `FlowConfirmDialog`: active projects
disable its destructive command, with a link to review blockers and safe cancel.

Invitation/member/direct-grant revocation and Team removal ask before their write.
Cancel does not mutate; refusal retains confirmation and retries the same operation.
`member.update` preserves membership status when `revoke` is omitted; explicit
boolean `true` revokes, explicit `false` restores. Role save omits this flag, so it
cannot silently reactivate revoked access. Restore is a separate confirmation that
names the person and actual role. Existing task assignments are retained.

Archived Teams cannot contribute project read or scoped administration through
the shared access model. They and archived grant destinations are excluded from
pickers and refused by the Atlas adapter. Removing inactive existing Team members
is supported; adding requires an active internal member. Invalid boolean flags are
refused before mutation. Revoking one source keeps independent sources effective.
Native role, guest grant and Pro work-week forms keep separate drafts/submissions.

`project-profile` is a durable page, not a modal route. It uses the project's
SSR shell and tabs with `contentMode: 'form'`; only the authorized project data
is CSR. `FlowSetupForm.layout: 'page'` owns the scrolling fields, inline feedback
and persistent native actions. Editing requires project administration; a missing
project renders recovery, never a blank creation form. Accepted save and cancel
return to that project's settings. Dirty cancel/tab/history navigation retains
the shared discard guard; adopting another project's props resets the old draft.

Within one authorized document owner, selecting another page keeps the reading
workspace and its tree/inspector mounted while the CSR read revalidates. The SSR
projection filters revoked page IDs immediately. Tenant, owner or access changes
discard the cached snapshot; access comparison is independent of JSON key order.
An unknown page loads inside the reading region. Read failures retain the frame
with Retry; denied reads remove cached content. Direct GET and refresh still SSR
the shell and tabs. Archive requires confirmation and a successful draft save;
accepted restore opens the document. Move changes only the parent within the same
owner/visibility and excludes descendants, archived and read-only targets.

Modal URLs carry a validated same-organization relative `background` URL so a
server reload can render the same background frame and routed tabs. This is route
state, not authorization; foreign origins, other organizations and modal-as-background
values are rejected. The server still scopes both navigation metadata and all reads.

The server supplies `chrome: flowShellData(authorizedBootstrap)` through the public
`./shell-model.mjs` export. This whitelist contains identity, access and navigation
metadata, not task rows, document bodies or paid feature records. Extensions may
declare a minimal `shellData` projection for their navigation. Register them before
constructing either the server shell or client controller; see [EXTENSIONS.md](EXTENSIONS.md).
The Atlas server exercises this contract using in-memory fixtures and a per-port,
HttpOnly, SameSite=Strict session cookie so fragment navigation and native reload preserve edits.
Production still needs its authenticated, typed read adapter; the fixture cookie
is not a production session implementation. Without `serverShell`, the legacy
whole-workspace island is retained for compatibility. Dispose releases hydrated
chrome bindings, reads, observers and UI runtimes. The framework owns the island
lifecycle; BFCache eviction/revalidation has not been verified. Flow indexes KetJS
history entries without pushing duplicates. Dirty form history traversals restore
the draft entry before confirmation; pending note/task writes finish before retrying
a traversal, and the guard waits for the restored entry before proceeding.

## Proposed core reads and commands

`flow.search({companyId, query, recent?})` is the single organization-wide read
for the sole Flow Spotlight combobox, opened from the sidebar or Meta/Ctrl+K.
The topbar has no content-search input. It returns `{groups:[{id,label,items}]}`;
each item has a stable ID, title, safe description, icon, native route and route
parameters. Queries are at most 200 characters, results at most 60 items and six
per group. Matching includes task descriptions/comments, document text, projects,
workspaces, epics, sprints, people, teams, forms, saved views, notification/history
text, assignees, labels and attachment metadata. Organization catalog edit
destinations are returned only to managers; an ordinary member cannot acquire
edit access by searching. Matching extension records include goal update reasons,
handover evidence, work-hour notes and branch-qualified Atlas metadata.
Registered extensions add their authorized records and destinations. No search
keywords/raw document body need to be sent back with the results.

Every read must authenticate the tenant and reapply project, guest, document
privacy and extension permissions; recent IDs never grant access. Production
must provide an indexed, bounded read over authorized records rather than export
the full bootstrap or build a global index in the browser. Atlas exercises this
contract through its current scoped fixture projection. The typed production
search adapter and real-data scale are not implemented or verified by this mock.

The client cancels superseded requests and rejects late responses after query or
tenant changes. Errors retain the query and expose retry. The sidebar owns the
global search launcher; the topbar has no search field. It opens one centered,
fixed-height Spotlight dialog with the only editable global search input.
`cmdk` is a compatible entry URL for this same dialog. Meta/Ctrl+K and dismissal
preserve focus; loading/results/empty/error do not move its frame. Legacy list/view
query parameters remain readable, while new
search input always uses this global read.

`flow.workspace.bootstrap` supplies the authorized user/company/workspace/project
context, capabilities, task catalogs, tasks, sprints, epics, pages, forms, inbox and
related collections. Atlas returns a bounded synthetic scenario. Production needs
separate bounded collection/detail/options reads before the accepted large-tenant
benchmark; never fetch the entire organization because the fixture does.

A screen read carries what the screen shows. The client sends `route` and, for
a route that opens a record, `recordId`. That record keeps its body, comments and
history; every other task is a summary (`summary: true`) without `description`,
`descriptionDoc`, comments or history, and names in `assignees` only the people
the reader cannot find in `members` (a guest sees only themselves there). The
Workspace overview also receives the six latest history entries of each Workspace.
`flow.issue.detail({companyId, id})` returns `{task, comments, history}` for one
task under the same project, guest and recipient checks as the bootstrap and
records no change; `not_found` and `forbidden` are distinct. Opening a summary
reads it: the detail shows a loading notice in place of the description editor and
discussion, then the record, or an error with retry. A detail older than the task
in the current read is read again; a newer open cancels it and a company change
discards it.
Search still matches bodies and comments, because it reads the authorized records
before this projection.

Extension fields follow the same rule. Pro sends a handover summary for every
task except the opened one (state, reviewer, shares, points, dates, attempts and
the estimate's state, points and question; no deliverable, criteria, context,
events, policy, review or closing reason, or acceptance receipt) and work hours
only to Workload. The
opened task brings the hours of its people across their week, because risk is
judged over that week. The detail read adds `quality.record` and `workHours` for
the task. Lists, status gates, points and performance read the same from a
summary as from the full record. An extension form opened for a task waits for
its record before composing, and extension task sections stay hidden over a
summary.

The task set itself is not yet cut per route: the command palette, label usage,
archive impact, sprint totals and getting-started count over it. Production
replaces it with bounded collection reads that return those counts.

The rendered DOM is bounded whatever the read returns. List groups show 10 rows
per page and board columns 20 cards per page; headers keep the full count and
"Show more" adds a page. A card dropped at the bottom of a cut column lands after
the last shown card and the page grows to keep it shown. Row status, priority,
assignee and due menus build their options only while open.

| Command | Client expectation | Production integration |
|---|---|---|
| `flow.workspace.bootstrap` | `{projectId?, route, recordId?}`: the opened record in full, every other task a summary; navigation may show a read again for 30 s | Bounded per-route collection and option reads that return the counts the screen shows; authorize before projecting; never read the whole organization |
| `flow.issue.detail` | `{companyId, id}` → `{task, comments, history}` plus extension `detail` records; records no change; `not_found` and `forbidden` are distinct | Same project, guest and recipient checks as the screen read; read-only |
| `flow.issue.save` | Create or partial patch, task version, idempotency; with an `id`, returns `record` | Adapt existing domain save; validate every supplied field and owner scope; `record` is the reader's detail after the commit |
| `flow.issue.move` / `flow.issue.reorder` | Atomic status/group/order change, expected task and order versions; `move` returns `record` | Recheck dependencies, required fields, rights and versions inside the transaction; `record` as for save |
| `flow.issue.bulk` | Per-task status moves: `{ids, action:"move", value, idempotencyKey}` → `{ok:true, applied, refused:[{id,code}]}`; fixture accepts legacy `status` | FLW-DEC-023: preserve refusals/selection, permission and Pro guard per task; replay returns the same outcome. Processing-time versions are not list snapshot CAS |
| `flow.issue.dependency` / `flow.issue.linkChild` | Scope/cycle checks, no partial mutation | Use authoritative dependency and hierarchy operations |
| `flow.issue.comment` | Append comment; refresh activity | Durable comment, scoped attachments and notification delivery |
| `flow.issue.archive/restore/follow/assignSprint` | Named actions with stable replay; `follow` and `assignSprint` return `record` | Bind the corresponding capability-specific functions; `record` as for save |
| `flow.entity.save/action` | Atlas editing for projects/pages/sprints/catalogs/files | Replace with typed domain functions; never trust arbitrary collection names |
| `flow.document.command` / `flow.page.reorder` | Scoped sharing/order, expected version and sibling sequence | Enforce read/write/manage rights, privacy and concurrent ordering server-side |
| `flow.organization.command` | Atlas workspace/member/team/grant editing | Use KetSuite identity and grants; client visibility never authorizes a write |
| `flow.operations.command` | Internal forms, response ledger, inbox, views, preferences | Authenticated submit; form schema version, task and response in one transaction |

Within a controller lifetime, each unacknowledged mutation retains a replay key
scoped to company, actor, command and payload. An unrelated acknowledged command
must not replace that key. A confirmed result releases it, so a later deliberate
identical action is a new intent. This is in-memory retry state, not a durable
offline queue; production must reconcile authoritative state after a refresh.

Related-task pickers offer active records in the current project and exclude an
existing relation. Empty results are explicit and a filtered empty result can
clear its query. A child-link command includes the selected parent's
`expectedVersion` and child's `expectedChildVersion`; the fixture checks both,
refuses ancestor cycles and increments the child version when its parent changes.
Production adapters must map this snapshot/transaction contract to authoritative
hierarchy functions. Fixture guards are not evidence of production authorization.

Task patches preserve omitted fields. Assignment uses stable member IDs; hierarchy,
dependencies, statuses, labels and custom fields belong to their permitted project.
Both list clear-filter actions reset query, status, selected view and selection.
My work also resets its personal Workspace filter. Presentation (group/sort), the
authorized company/Workspace context and frame history remain intact.

Catalog editor deep links resolve the existing `entityId` and hydrate title,
description, status kind, type icon, field kind/options/required/appliesTo and
label color from the authorized read. A bare editor route creates; an explicit
missing ID shows recovery and must never fall through to creation. Shared catalog
writes require organization management on the server and in the client affordance.
Field metadata is structured data, never inferred from a translated description.
The Atlas fixture verifies update identity and missing-ID refusal; production
typed adapters, concurrency/version handling and durable storage remain unverified.
Catalog updates preserve an omitted owner and reject owner changes or unknown
projects. A project-owned custom field only applies inside that project. Changing
its kind or selectable options is refused when existing nonempty task values
would become invalid, including values on archived tasks. Compatible option
additions and metadata-only edits remain allowed; optional missing values are
checked for requiredness at completion. Numeric values must be finite scalar
numbers or nonblank numeric strings; dates must be real `YYYY-MM-DD` calendar
dates. These guards are exercised in the fixture, not production migration or CAS.
Shared label archive preserves existing task links and removes new selections.
The library exposes archived labels for restoration; restoration rejects a duplicate
active name in the same owner/domain. Only organization managers can create,
archive or restore shared labels; members retain inspection access.
Status rename preserves omitted `kind`; task type rename preserves omitted `icon`.
Changing a status group refuses existing task references, including archived tasks,
and cannot remove the last status from any required workflow group. An unused
status may be reclassified when all groups remain represented. Active catalog
names are unique inside their owner/domain, rather than across unrelated projects.
Unsupported kind/icon and malformed title inputs return associated field errors.
Autosaves serialize per task and retain failed drafts for explicit recovery. Upload
bytes first with `createFileUploader`, then submit the upload reference; server-side
storage must verify ownership, type, size, access and attachment association.

Bulk previews are advisory: submit every selected ID, including locally blocked or
stale rows, and let the server return per-task refusals. An incomplete/malformed
success envelope does not prove completion. The client retains selection and the
operation's replay key, blocks another Apply until a fresh read succeeds, then
retries the same intent with that key. Changing the intent creates a new operation.
This recovery contract does not add list-snapshot CAS to the existing bulk API.

Sprint cadence is `null` for Kanban or `{weeks:1..4, weekday:0..6}`. Only one active
sprint is allowed per project. Closing records an immutable commitment/completion
snapshot and explicit carryover. The core report counts ordinary points and remains
available with no private extension installed.

Document visibility is owner/grant scoped. Parent moves cannot create cycles or
cross ownership unnoticed. LiveDoc persistence, token binding, concurrent editing,
attachment authorization and export must use the existing server facilities.
Document library URLs preserve owner, visibility and legacy `docq` filters. A local
`returnTo` is restricted to the library route, rendered in SSR chrome and restored
through framework navigation with draft guards. Empty/unavailable filters provide
recovery. Root creation receives explicit visibility from its entry; it never
inherits a stale private selection from another document.

Creating a document is a direct command, never a title/content dialog. `page-new`
and `page-child` are addressable creation entries; success replaces that entry with
the new `page?id=…` URL and focuses LiveDoc. Root creation preserves the selected
workspace/project; child creation inherits its parent's owner and visibility.
New records start with the exact title `Untitle` and `titleSource: "content"`.
Their first nonempty text line supplies the title (rich marks are ignored, Unicode
is preserved); clearing the text falls back to `Untitle`. Existing records without
this marker retain manual titles. The shared client debounces note edits for 600ms,
saves title/plain projection/blocks/LiveDoc snapshot together, retains edits made
during a write, and keeps a failed draft for the explicit Save action. Creation
blocks double activation and uses the transport's stable retry key. Leaving the
browser with unsaved document edits raises the native unload warning. In-app
navigation first flushes the latest note revision. A failed save keeps the draft
and asks whether to keep editing or discard it in the shared ConfirmDialog.
Editor identity (`data-live-key`) is observed so record navigation and browser
history dispose the previous editor and render the destination's own content.

The fixture retains `titleSource`; production must add this metadata to its typed
document writer/read model and implement atomic versioned persistence. This local
mock check does not verify production durability or multi-user LiveDoc sync.

## Sprint identity and closure recovery

Explicit sprint/epic links resolve only the requested, unarchived record in the
current project. A missing or foreign ID shows recovery to its list; it never
falls back to a different record. Implicit sprint-close entry selects the current
active sprint. Planned sprint closure shows recovery; closed/completed entry
offers its saved report without another closure form.

The Atlas command fixture checks authoritative sprint ownership for permissions,
even when the caller omits or spoofs projectId. Start accepts only planned,
unarchived sprints with no other active sprint. Close accepts an active sprint;
closed/completed retries retain the frozen report. Carry destination is Backlog
or a planned/active, unarchived sprint in the same project. Invalid destinations
return a carryTo field error before any mutation or Pro report hook.

Start/close exclude archived tasks from current work and carryover. An archived
task in the original commitment remains part of committed points and counts as
removed at closure. Completed work stays in the closed sprint; unfinished work
moves once. Core status points and Pro acceptance credits are frozen separately
through the public extension hooks. Closing uses a native form-associated footer
outside the scrolling body; a failed command retains its selected destination.

Task save/assign/reorder reject newly selected foreign, archived or closed sprint
destinations. Editing other fields can preserve an unchanged historical sprint;
the task property picker retains that current context. New Epic assignments must
resolve an unarchived record in the task's project. Existing archived context can
be retained, and UI display resolves canonical IDs or legacy title links to the
scoped Epic label. It does not expose a raw identifier as the visible Epic name.

These are in-memory fixture and client contracts. Production integration still
requires typed scoped operations, authorization and atomic closure/replay in the
durable store; the generic Atlas entity writer is not a production endpoint.

## Edition and persistence boundary

### Operations and native form recovery

Atlas operations validate the complete form definition and response before changing
records. Recipient membership must be active and internal with project access;
publish/required/archive flags are booleans. Refused form submissions bind errors
to `request-title` and `answer-<field-id>` and never count a response or create a
task. A failed task result is propagated; accepted replay creates one task/response.
Omitted form metadata and personal notification choices preserve their current value.

Saved-view updates stay in their project and enforce ownership. Invalid status,
visibility, query or archived targets are refused. Archive uses the shared centered
confirmation: cancel keeps the draft and writes nothing, refusal keeps retry, and
acceptance hides the view without changing its tasks. Archive feedback has no link
to a hidden filter. Inbox batches validate every recipient/target before updating
read flags. Revoked membership cannot write through an operations command.

Starting input in an operations form clears completed feedback so its overlay
cannot block the next command. Recoverable errors are independent and remain visible.
These contracts describe the native client and synthetic Atlas producer, not
production authorization, durable transactions or storage acceptance.

The public package has no private imports, store records or migrations. Server
extensions are explicitly composed; absent commands are unhandled. Core permission,
version, replay, dependency and tenant checks apply even with no extension installed.
Paid extensions own their additional schema/migrations and private adapter contracts.

Atlas is development-only, in-memory synthetic data. Authentication fixtures,
generic writers, upload memory and scenario clocks are not production services.
A successful fixture or browser test establishes client behavior, not durable storage,
security acceptance, concurrency capacity, recovery objectives or feature completeness.
