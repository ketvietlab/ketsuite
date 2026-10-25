# Flow core client adapter contract

## Native irreversible project deletion

`flow.project.deletion.preview({id})` requires project management and returns
`{ok, projectId, version, title, impact, impactDigest}`. Counts cover the entire
Company/project scope, including archived tasks and documents. They are SQL
aggregates, not counts of the client collection window.
The digest includes a durable project mutation epoch, so replacing/transferring
work while keeping the same counts still invalidates a preview. Replays do not
advance that epoch.

`flow.project.delete({id, expectedVersion, confirmName, impactDigest,
idempotencyKey, reason?})` additionally requires the separately granted
`flow.project-delete` bundle. No ordinary role includes this bundle. The exact
current title, CAS version and preview digest must match. A durable deletion
receipt and a tombstone commit together with the maintenance job. Tombstoned
projects immediately deny read/write/file/LiveDoc access, including existing
sessions, before background cleanup starts. Replays remain scoped and never
create a second request.

`flow.project.deletion.list({cursor?, limit?})` and
`flow.project.deletion.retry({id, idempotencyKey})` require organization management
and the separate deletion capability. The list is bounded and excludes content.
Its `id` is a deletion receipt ID, not a project ID.

Cleanup uses bounded, restartable transactions and durable blob candidates.
Shared objects still referenced by another attachment are retained. Unreferenced
exclusive Flow objects are removed only after the upload grace period; storage failures preserve
the pending candidate for retry. Uploads and LiveDoc snapshots use immutable,
owner-specific keys under `blobs/<company>/flow/`. Re-uploading the same bytes
creates another key; generic attachment commands cannot claim this namespace.
Legacy content-addressed/public/rendition keys without a remaining reference are
retained with state `retained_legacy`. Their receipt ends in `retained_blobs`,
never `done`: the storage interface has no conditional delete/fencing primitive
with which to prove concurrent writers safe. `waiting_blobs` is not `done`. No job may accept
an arbitrary project or blob key without its Company-scoped deletion receipt.
Extension-owned records are cleaned through the server's `purge` hook; Core never
imports a private package. This contract adds no fixture writer or auth flow.

Task history, sprint reports, form responses and command receipts remain
append-only in normal mutations and extension callbacks. Attempting another
transaction inside an active mutation returns `nested_transaction` (the runtime
does not support nested transactions). Their storage models permit the authorized purge job to delete them;
the Core mutation context rejects update, CAS, update changesets and deletion
with `immutable_ledger`. The deletion audit survives. The current Goals extension
refuses deletion with `projectId: goal_links_in_use` while live goal/epic links
remain. Unlink them before requesting deletion. Immutable goal link events
(identifiers only) remain as goal history. Core jobs never inherit Pro projection
effects or write private tables; automatic cross-module cleanup remains unaccepted.

Native LiveDoc commits carry server-derived block metadata from the exact snapshot
being written. The editor bytes, plain-text preview, content title and outline must
describe the same revision, including after reload. Transport retries keep the
original version for identical snapshot bytes. The first non-empty content line
supplies the title; later paragraphs remain body content.
For native durable owners, `/content` and `/live` expose committed snapshots only.
The SSE connection sends an initial checkpoint and polls the immutable snapshot
pointer at approximately one-second intervals (rotating after 30 seconds), with
owner authorization checked while idle and again after snapshot I/O. Workers may
share the database/blob store without sharing an in-memory CRDT; failed pushes
are discarded locally, and the client retains unacknowledged updates for retry.
Native page/task presence uses Company-scoped server leases (90-second TTL,
30-second client heartbeat), shared across workers. The actor/name come from the
session. Each snapshot filters senders through current owner permission; revoked
recipients end their SSE, and leave/expiry/revocation emits `gone`. Heartbeats use
server CAS in a transaction without advancing business collection cursors, run
extension guards first, and schedule scoped expiry. These are ephemeral leases,
not replayable business commands. Their internal functions reject direct Fn HTTP
calls. Large-scale connection load is not yet accepted.


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
An authorized chrome projection may carry `problem: {code: 'forbidden'}` when the
requested project/workspace cannot be read. Render the canonical access-denied
content immediately, without a loading flash, business form or duplicate toast.
The host may recover chrome through a separate authorized, shell-only `my-work`
read; this must not fetch the denied record or grant access. Preserve the requested
scope for retry; recovery to My tasks clears that scope. Direct documents retain
HTTP 403, while a valid `fragment-v1` representation carries only the safe error
content with HTTP 200 so navigation preserves the mounted application frame.
Function/detail/file authorization still rejects the denied scope independently.
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
Workspace access is `internal` or `restricted`; project access is `workspace` or
`private`. The canonical form sends exactly these values and Atlas refuses others.
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

### Native project options and staff resource v2

`flow.project.statusOptions({companyId?, projectId})` reads the active task status
choices for one authorized project. It returns `{items: [{id,label,kind,color,projectId}]}`
in override order, or company sequence/id order when inherited. It excludes
other projects and archived definitions; more than200 choices refuses `limit`.
Task row/detail menus read this when opened, with loading, error/retry and
Company/close cancellation. They do not trust the truncated bootstrap catalog as
the complete set of choices. The mutation still checks current access and catalog
membership. Atlas implements the same endpoint; no production-only UI branch.
Task summaries/details may include `statusDefinition: {id,label,kind,color}` for
their current status so a loaded row remains readable when its definition is
outside the bootstrap catalog window. This is a display snapshot, not a complete
choice set or authorization grant.
Global task-list bootstrap (`my-work`, `all-issues`, without `projectId`) selects
company statuses plus project statuses activated by a visible scoped project's
`taskStatusIds` override before applying its catalog window. Unused project-owned
definitions cannot displace inherited statuses or create unrelated empty groups.
Catalog management routes retain their own definition reads.
List/board display groups and status filters also include states referenced by the
loaded authorized task summaries, even when the bootstrap catalog window omits
them. A snapshot is used only when its ID matches the task's current state; missing
metadata falls back to the state ID. Sprint groups likewise retain loaded tasks'
sprint labels outside the sprint window. These display fallbacks never expand
project mutation choices; those continue to use the guarded remote options read.


Task summaries/details may also carry `typeDefinition: {id,code,title,icon}` and
`tagDefinitions: [{id,title,color,archived}]` for their referenced values. These
snapshots are Company/project-fenced and bounded by the loaded task window;
they do not turn a workspace catalog window into a complete choice list.
`flow.issue.detail` (including mutation `record`) includes optional `task.catalogs`:
`{projectId, columns, types, tags, fields}`. Each collection reads only company
and that project's definitions, with at most200 per scope and explicit `limit`
on overflow (custom fields are limited to200 applicable fields in total, matching
the write validator). Archived selected labels remain display snapshots only.
The shared client retains these definitions with the task detail and uses the
task's exact field set for editing/validation. Atlas supplies the same shape.

`flow.project.taskOptions({companyId?, projectId})` reads the exact active
`{projectId, columns, types, tags, fields, project, sprints}` options used by task creation.
`project` includes its title/code/workspace, `sprintCadence` and a live `canWrite`
hint (commands still recheck permission); `sprints` contains
up to200 non-archived planned/active sprint identities for that project (overflow
refuses `limit`). Project search uses paged `flow.project.options`, and dependency
search uses paged `flow.issue.list` with the selected project. Neither picker
filters only the bootstrap window. It uses
`project.read` and the same scoped limits and override ordering as task detail's
`catalogs`; no task is required. A project change cancels the preceding read and
clears the old choices. The shared composer waits for this read, offers retry on
failure, retains its draft, and includes typed `customFields` in the save command.
Permission refusal clears choices. Atlas implements the same read and limits.
A global `issue-new` bootstrap includes only inherited company catalogs; project
choices are read on selection, not by loading every visible project catalog.

`flow.project.options({query?, workspaceId?, access?, manage?, cursor?, limit?})` returns
`{items, cursor, total}`. Items carry only `id`, `code`, `title` and `workspaceId`; the
server applies the current Company and Core grants before filtering/counting.
`access:'workspace'|'private'` keeps projects with that access (the Workspace form counts
inheriting projects with `limit:1`), and `manage` keeps those whose access the actor may
change, as `access.grant` checks (organization managers, or an admin role on the project).
Pages contain at most 50 records. Cursors bind the actor, visible scope, query, filters and
organization revision; changed access or catalog ownership refuses the old cursor with
`conflict`.

Productivity exposes the explicit native resource version at
`/api/staff/v1/flow/v2/`: `GET projects`, `GET issues`, `GET issues/{id}` and
`POST issues/{id}/{move,assign,comment}`. The transport remains staff profile v1;
Flow resource v2 replaces legacy single-assignee records with `assigneeIds`.
Mutations require the staff bootstrap CSRF token, same-origin request and
`Idempotency-Key`. Move/assign require `expectedVersion`; comment is an append.
Every request forwards its real identity and request to the same typed native
function used by the workspace. No direct store write or separate authorization
rule exists in the channel. Refusals preserve field errors; 403/404/409/422 are
distinguished. Version 2 detail deliberately excludes rich document snapshots,
attachment URLs and extension-private records.

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
Every route is a client screen the reader may open. A project opens on its
default view (`board` or `project-issues`); a sprint opens `sprints` with
`{project}`; a saved view opens `project-issues` with `{project, view, q, status}`,
as the saved views screen does. Saved views are those of a project the reader can
read, owned by the reader or shared with the project, and the reader's own views
without a project. A guest receives no workspace, form, person or team result.

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

The `inbox`/`notifications` and `personal-settings` reads retain authorized shell,
personal preferences and inbox data, but do not load task collections, task catalogs,
sprints or epics. These arrays are empty rather than a partial choice list. Opening
a task or a create/edit form performs its own route/detail read; extensions receive
an empty task collection on those standalone routes. Atlas projects the same shape.

`flow.issue.activity` reads one authorized task's activity: `{ companyId?,
workspaceId?, projectId?, id, kind, cursor?, limit? }`, where kind is `comments`
or `history`, limit defaults to50 and is at most100. Navigation context never
grants access; current task ownership and `project.read` are checked each time.
The response is `{ items, total, cursor }`, newest first by `(createdAt,id)`;
comments are displayed oldest first within the loaded window. Task detail,
including mutation `record`, includes the first windows plus
`task.activityPages[kind] = { total, cursor }`. Older pages remain accessible.
Cursor fences actor, Company, task, kind, current project and collection epoch;
stale cursor returns `conflict`. Former private project identity is redacted from
all history pages just as from detail. More/retry ignores late reads after writes,
navigation or Company changes and preserves the unsent comment draft.

`flow.catalog.list` reads the organization library: `{ companyId, kind, cursor?,
limit? }`, with `kind` one of `column`, `type`, `tag`, `field`; optional `workspaceId` is
client navigation context, not a filter on the company library. Limit defaults to50
and is at most100. Active company members may read; guests cannot. Project-owned
records are excluded before count/window selection. The result is `{ items, total,
cursor, labelUsage? }`, ordered by `(sequence,id)`. Items are list metadata
(id, owner, title, order, version, archived and visual kind/color/icon); descriptions
and custom-field options belong only to the pinned edit record. Tags include archived records
and usage counts in the reader's visible projects. Cursor fences Company, actor,
kind and collection epoch; a committed mutation invalidates it with `conflict`.

`organization-settings` bootstraps the first company column/type/field windows;
`tags` bootstraps the label window. `catalogPages[collection]` contains total,
cursor and loadedIds. More/retry retains loaded records and ignores late responses
after route/Company changes or writes. A catalog edit route pins its exact authorized
record (company or visible project), including outside the first window; an unavailable record never opens a
blank create form. Project catalog editors retain their existing scoped reads.

For a production project-scoped bootstrap, catalog reads include company definitions and
that project only. Other visible projects must not consume its catalog window.
Company and project windows are bounded independently to 200 definitions per
kind; overflow returns `limit`, never a silently incomplete catalog. Workspace
catalog pagination and cross-project option hydration remain separate reads.

Native scope resolution applies actor grants and workspace inheritance before
its bounded project window. Unreadable projects cannot evict readable projects
from navigation, totals or collection reads. The existing operational scope
bound is500 readable projects/workspaces; a501st eligible row returns `limit`
instead of a successful partial scope. This refusal is not pagination or an
increase of the supported scope; larger-scope directory work remains separate.

Overview receives `blockedCounts: {total, projects}` for the full authorized
workspace/project scope, before task preview filters. `projects` is sparse: an
omitted project has zero blocked tasks. Count each active unfinished
target once when at least one active unfinished source blocks it in the same
project. Done/cancelled sources, Done/cancelled targets, archived records and
out-of-scope projects do not contribute. Dependency edits and task status/archive
changes maintain a relation read mirror atomically; pending historical mirrors
refuse with `unavailable` until the explicit Company backfill. The target's normal
record/version and capability checks remain the source of write authority.

Label library reads (`tags` / `tag-edit`) return `labelUsage`, keyed by each
returned label ID with `{tasks, projects}`. Counts cover unarchived tasks and
projects in the actor's complete authorized Company scope, before presentation
windows. Task usage comes from the Company/project-fenced label read index;
project usage comes from the authorized project catalog. Missing read-index scope
refuses the read as unavailable until the explicit operator backfill completes.
Assignment, transfer, archive/restore and bulk commands update this projection in
the same transaction as the task. Archive retains the task/label relation; restore
makes its usage visible again. No private project or other Company contributes.

`counts.projects` is the number of active, authorized projects in the selected
workspace, independent of the navigation window. Overview table totals and the
workspace archive confirmation use this count; the server still rechecks all
archive preconditions in the command transaction.

Workspace Overview receives `gettingStartedState: {workspaceId, project, task,
invite, page}` as booleans from the full authorized scope, before presentation
windows or task filters. Project/task/page steps refer to active projects and
unarchived records in the selected workspace. A page counts only when readable
by the actor; a private or guest-inaccessible document never completes the step.
The invite step follows the Company directory: another active platform/Flow
member or a pending invitation visible to the actor.
Guests cannot inspect the directory or invitations. This projection contains no
record bodies or private identities. Clients apply it only to its workspace;
older/bootstrap-free fixtures may derive the steps from their complete arrays.
Pro goal/GitHub steps remain owned by their extensions.

Workspace Overview additionally receives `deadlineCounts: {today, overdue, dueSoon,
days}`. `days` contains the fourteen ISO business dates beginning at `today`,
including zeros; `dueSoon` covers today through day6. Counts exclude semantic Done
and archived tasks and apply the same authorized workspace/project scope before
any task cursor. The Company timezone defines `today`.

Overview also returns `peopleMetrics`, at most six active people with open work,
ranked by overdue count, then open count, then stable user ID. Each entry is
`{member: {id, name}, open, overdue}`. Counts come from the complete authorized
workspace/project assignment index, independent of the task preview or directory
page and of a task search/presentation filter. One task contributes once per
assignee; archived and semantic Done tasks are excluded. Names are resolved by
the server, including members outside the initial directory. Pending assignment
backfill refuses the read rather than supplying incomplete overdue counts.

The workspace risk drilldown uses `flow.risk.list` with `workspaceId`, optional
`projectId`, `risk: all|blocked|overdue|review` (default all), `limit` (1..100,
default10), and an opaque cursor. It returns task summaries, `total`, `cursor`,
`today`, full-scope `metrics`, `projectTotal`, up to ten projects with the most
matching tasks (`id`, `title`, `end`, `count`), and sparse `projectCounts` in the same authorized active scope. All is
the distinct union of unfinished blocked and overdue tasks; review is independent.
Results use stable internal task-ID order and fence cursor by actor, Company,
authorized projects, risk mode, Company-local day and collection epoch. Counts and
filters precede paging. Dependency due mirrors require an explicit historical
backfill; pending mirrors refuse unavailable rather than omit tasks. Client clears
risk windows on scope/route/data changes, pages10 and retries stale cursors from
the beginning. Atlas implements the same read, not a separate dashboard tree.

The selected deadline preview reads `flow.issue.list` with `workspaceId`,
`unfinishedOnly: true`, `sort: 'due'`, `limit: 8`, and either paired `dueFrom`/`dueTo`
for a single day or exclusive `dueBefore` for the overdue bucket. `dueBefore` is a
valid ISO date, cannot combine with date-window/undated arguments, and is part of
the cursor fence. `unfinishedOnly` is also valid for a workspace collection without
a planning/project filter. Eight preview records are not the bucket total. Scope,
primary-read replacement and disposal invalidate pending previews; failure/retry
must not display another day's records or misreport an empty bucket.

### Native production composition (approved A02/A04, 2026-10-11)

Collection reads return `metrics: {total, progress, review, done, overdue}` for
the complete authorized, filtered collection before its cursor. Calendar reads
on both `flow.workspace.bootstrap` and `flow.issue.list` accept paired inclusive
`dueFrom`/`dueTo` ISO business dates (at most 42 days) and `includeUndated`.
The date predicate is applied before count/order/cursor; the cursor is fenced to
the range and undated flag. Calendar sends the displayed grid's first/last day,
sorts by due date and pages the matching collection, including undated tasks at
the end. Changing week/month/period issues a new read. An incomplete page is
labelled with loaded/total and offers Show more; it must not claim that an empty
undated section is the complete collection while a cursor remains.
The calendar initially mounts three task cards per day and ten undated rows.
Show more mounts additional loaded records in steps of ten; Collapse restores
the initial window. Changing period resets these presentation windows.

Bootstrap exposes collection metrics as `counts.metrics`. List metric cards must use these counts rather than
the number of loaded rows. Business dates use the Company's accounting timezone.
Workspace overview also carries `projectMetrics` keyed by authorized project ID,
with full-scope `total/todo/progress/review/done/overdue` SQL aggregates; project
progress/risk rows use these totals independently of the loaded task window.

On `sprints`, `sprint-close` and `workspace-overview`, each returned sprint carries
`taskTotals: {total, done, points, pending, pendingPoints}`.
These are aggregates of all unarchived tasks in that sprint and its authorized
project, independent of the task page, search, or presentation filter. `done`
uses the task status's semantic kind, including project overrides. Sprint list
and close confirmation use these totals; a task preview is not the total scope
of the close command. Closed reports retain their immutable historical totals.
Core points are stored task points; an extension that changes their meaning must
provide its own full-scope projection rather than sum a loaded page.

Planning previews page through `flow.issue.list` with an explicit `projectId`
and `sprintId`, `backlog: true`, or `epicId`; `milestonesOnly: true` selects
semantic milestone task types within an Epic. Epic tasks and milestones use
independent ten-row windows, never a filtered slice of the bootstrap tasks.
`unfinishedOnly: true` excludes semantic
Done states. These filters are applied before count/cursor and fenced into the
cursor. They cannot be combined with personal reads. The active sprint and close
preview load their own ten-row window; other sprint/backlog previews load on
demand. Collection replacement, scope changes and disposal invalidate late reads.

Bootstrap sprint records contain metadata, not `closeReport`/`report` task bodies.
Explicit sprint/epic record routes pin their authorized target outside the initial
100-record window; sprint entry also pins the active sprint for its project.
`flow.sprint.report({id, projectId?, cursor?, limit?})` reads a closed sprint's
immutable report with shared Company/project authorization. It returns
`{report, tasks, total, cursor}`: `report` excludes `tasks`/`taskIds`, and `tasks`
pages the saved historical snapshots (default10, maximum50). The cursor is fenced
to actor, Company, project and report version. Closed-report UI loads pages on
demand, never overwrites live task records with historical snapshots, and must
not present an unloaded report as the current progress of an open sprint.

Task summaries include authoritative `blocked` and `blockerCount`; `blockedBy`
contains at most three active blocker keys. Detail contains the complete authorized
dependency list. A missing blocker in the loaded task window must not turn a
blocked task into an unblocked one. Dependencies/parent keys whose ownership
changed to another project during the read are omitted.

Project navigation includes at most 50 projects plus the explicitly selected
project and owners of the loaded task window. `flow.project.list` separately
pages the authorized Workspace directory with `{workspaceId?, cursor?, limit?}`
and `{items, total, cursor}`. Bootstrap carries `projectPage` on the `projects`
route. Directory totals are authoritative; unloaded projects
remain reachable through global search and the directory's next page.

The browser entry `workspace.browser.mjs` is built from the same Core source for
Atlas and native delivery. The View runtime, UI/client locale registries and
extension registry remain singletons; LiveDoc stays a dynamic dependency.
This bundle changes delivery only, without a production-only renderer or writer.

Company selection uses `POST /flow/context` with `{companyId, fromCompany}`.
It updates the existing KetSuite session through `user.contextOptions` and
`user.prepareContext`, checks live membership, same-origin requests and session
CAS, and returns 409 for a stale source context. An already-selected target is
idempotent. The client flushes drafts before selection and loads a fresh SSR
document afterwards, discarding the previous tenant's data and read cache.
Atlas simulates this HTTP response; it uses the same client selection path.

Company selection uses the shared KetSuite session, not a Flow authentication
store. `POST /flow/context` takes `{companyId, fromCompany}` and returns `{ok}`.
The server validates the live session, same-origin browser intent and platform
Company/branch membership through `user.contextOptions`/`user.prepareContext`,
then CAS-updates that session. An already-selected target is an idempotent success;
a different concurrent context refuses with `conflict`. The canonical client
flushes edits before selection, then establishes fresh SSR chrome and clears its
old context by unloading the previous island. Atlas changes only this response.

#### Task relocation (D07, native command slice)

`flow.issue.relocation.preview({id, targetProjectId, mode, columnId?, typeId?,
fieldMap?})` prepares `copy` or `transfer` and returns `sourceVersion`,
`sourceProjectId`, `impact`, and `impactDigest`. `flow.issue.copyTo` and `flow.issue.transfer`
accept the same mapping plus mandatory `sourceProjectId`, `expectedVersion`, `impactDigest`, and
`idempotencyKey`; copy additionally accepts an optional title. They return a
fresh authorized task `record`. Canonical `issue-copy` / `issue-transfer` dialogs
read destination options, then obtain a preview before enabling confirmation.
Changing destination, status, type or field mapping invalidates the preview.
A refused/stale preview is retryable without losing the choices; success opens
the returned record in its destination Workspace/project.

`flow.issue.relocation.options({id, mode, cursor?, query?, targetProjectId?})`
returns at most 50 writable active destination projects in an ID-ordered scan
window of 100 authorized Company projects, plus `nextCursor` for the next window. Private
projects never appear. A selected destination also returns its active allowed
columns/types/fields; these bounded catalogs refuse overflow rather than truncate.
Source read is required for copy, source write for transfer. Destination grants
are rechecked on options, preview, command and replay. The source project is
excluded for transfer. Cursor is the last scanned authorized project ID; authorization is applied
before the scan so a cursor cannot expose a private project ID. A concurrent
revocation may produce an empty window with `nextCursor`. No fixture-only header or facade is used.

Copy requires source read and destination write; transfer requires write on
both. Both grants are checked inside the transaction, including replay.
Neither accepts a foreign Company or an archived source/destination. Ordinary
`issue.save` cannot change a task's project. Transfer preserves the task's ID,
key, rich content, checklist, comments and finalized files; storage and LiveDoc
access follow the new owner. Copy starts a new identity with no conversation,
rich content, checklist, files, history or followers, consistent with FLW-020.
Task-detail history projects the current owner and omits the former project's
private ID; original ownership remains in the server's audit rows.
Requests that captured an old task/file owner before acquiring the mutation
lock are refused. Detail and summary projections recheck ownership after their
joins; a detail retries instead of mixing source and destination data. LiveDoc
streams reauthorize each outgoing frame and terminate when read access is lost.

The default landing status is the destination's first active `todo` status.
An explicitly selected status/type must be allowed there. A shared type keeps
its ID; a project type maps only by a nonempty stable code, never by its title.
Shared custom-field IDs keep their values when applicable. `fieldMap` is an
object of source field IDs to destination field IDs or null; project fields
without an explicit mapping are dropped. Values must pass the destination's
kind/options/required rules. Shared labels survive only when allowed there.
Assignees/followers who cannot read the destination are removed. The preview
reports these losses; its digest is rechecked before any write so that a stale
preview cannot silently discard data.

Transfer clears parent, epic, sprint and dependency links; source sprint
snapshots remain historical. Tasks with children (including archived children)
or an internal-form response are refused until their grouped-move policy is
implemented. Pro guards run before changes. No external side effect is emitted
inside the transaction. All related writes, history, order revision and replay
receipt commit atomically. Bounded planning refuses oversized related sets
instead of silently cutting them.

The productivity deployment uses a fresh Core domain schema and the same
`flow.workspace` presenter/island as Atlas. It does not compose the legacy
`flow_backend` screens or import Atlas stores. Login, Company and identity remain
KetSuite-owned. Existing Flow data is retained without automatically importing
legacy grants into the new domain.

Bootstrap is bounded and carries `collectionPage` and authoritative `counts`.
`flow.project.save` preserves the shared project form (owner, dates, outcome,
state, labels, members, teams and optional catalog overrides). `defaultView` is
`board` or `project-issues`, matching the canonical route registry. Shell/sidebar,
project directory and selected-project projections all retain that value.
After a successful read/navigation, the hydrated sidebar reconciles authorized
metadata in place so renamed projects/default destinations update without
replacing the SSR sidebar or keeping a stale click callback. Older
native read values `list` normalize to `project-issues`; unsupported legacy
`calendar` defaults read as `board`. New explicit writes reject either alias.
An unrelated edit may normalize the prior value; no startup data rewrite occurs.
Optional project, sprint and epic `start`/`end` dates use `null` to clear. The
shared command preparer converts empty form strings to `null`; omitted fields
remain omitted and malformed nonempty dates are refused by the typed server.
Catalog edits and
access grants commit with the project under its version and organization revision;
Individual project catalog edits also advance the project version, preventing an
older aggregate form from overwriting a newer definition. IDs belonging to another
project are rejected. A cloned override carries a unique
`sourceId` from the project's current catalog. The server remaps this project's
tasks (including archived tasks), labels and saved-view status atomically, bumps
affected record versions and runs extension guards before changing each task.
Each changed task records its committed version and only the changed status/label
before-after values in history; replay adds no second history entry.
Cloning cannot change an occupied status's semantic kind. Removing a used
status/label without a replacement is refused. Native override provenance permits
`null` to restore the active company definitions only when every used definition
has a compatible source; ambiguous or archived sources are refused. Replays do
not remap records twice. `flow.search({query, recent})` returns bounded, permission-filtered groups;
no result, count or recent item may disclose an inaccessible document or project.

### Core task exchange, version 1

`flow.issue.export({projectId, cursor?, limit?})` returns permission-checked pages
of portable task records, a cursor and the project mutation revision. Subsequent
pages pass `expectedRevision`; concurrent changes refuse the continuation instead
of mixing snapshots. Records contain source key, title, plain description, priority,
points, dates, catalog/assignee IDs, custom-field values and checklist. Binary files,
LiveDoc collaboration history, parent/dependency links, epic/sprint membership,
comments and audit ledgers are outside this portable format and never overwritten.

`flow.issue.importPreview` and `flow.issue.importApply` accept a schema version,
project, import-session ID, `mode: create|update`, up to 100 portable rows and explicit
ID mappings for statuses, types, labels, assignees and fields. Update requires the
exported task key and expected version; create always makes a new task. Preview
exercises the same task validation and extension guards in a transaction that is
always rolled back. Apply requires its preview digest and repeats authorization,
validation and CAS in an atomic batch. Stable `(actor, project, importId, sourceId)`
receipts deduplicate rows across retries and batch boundaries; changed content
under an existing row identity is refused. Oversized/invalid batches have explicit
errors and commit no records. No generic collection writer is exposed.

JSON uses `{schema:"flow.task-exchange",version:1,rows:[...]}`. CSV has the same
schema/version columns; array/object cells contain JSON. Every string cell is
escaped for spreadsheet formulas and leading apostrophes, then decoded once when
importing this declared format. CSV quoting preserves commas, quotes and newlines.
The shared client previews all batches before applying them and retains the import
session and operation keys when retrying an uncertain batch.
### Invitations and delivery

Productivity grants technical Core function access, including document authoring
endpoints, to its managed staff roles; this grants no document ownership.
Core's active membership and Company/workspace/project/document capabilities still
authorize every read and mutation. This grants no Core membership or scoped role.
First Company initialization additionally requires the `flow.initialize` bundle
(`flow.workspace.initialize`, the same authorized/replay-safe workspace command),
assigned to the platform Project Administrator. It cannot be claimed through the
ordinary staff baseline. Permanent deletion retains its separate sensitive bundle.
Thus an invited Employee can accept and use the exact Core role granted by the
invitation without receiving general KetSuite administrator rights. Acceptance is
rendered before the normal first-use screen for a user without Core membership.

Native invitations store their authenticated issuer. Offers, acceptance and queued
dispatch recheck that issuer's current active Company and scoped authority; legacy
invitations without an issuer require reissue. Guest acceptance adds a distinct
user grant for the invitation's target project. Wrong identity, Company, expired,
consumed, revoked and obsolete resend tokens disclose no offer metadata.

`createFlowModule({invitationMail:{origin,templateId}})` binds shared `mail_transport`
delivery. Origin is configured and validated, never derived from the request Host.
Creation/resend enqueue a durable dispatch in the command transaction; workers
snapshot the template and use the existing retry/idempotent provider transport
after commit. Revoke/resend cancel messages awaiting delivery; already accepted
mail cannot be recalled, and its token remains invalid. Dispatched bearer tokens
are erased from Flow outbox payloads. The acceptance page uses shared KetSuite
login and requires existing platform Company membership; Flow does not create a
parallel account or implicitly grant platform access.

Productivity composes the mail module/queue and reads `FLOW_INVITATION_ORIGIN` and
`FLOW_INVITATION_TEMPLATE` together. Configure the active Company template and shared
outbound transport before enabling mail. With no configuration, native bootstrap
reports `invitationDelivery:"unconfigured"` and the shared UI exposes configuration
guidance instead of a simulated send action. Atlas retains its fixture indication.
After configuration, resend previously pending invitations to enqueue fresh tokens.

Additional pages use `flow.issue.list({projectId?, workspaceId?, cursor?, limit?, sort?})`;
`sort` is `manual`, `due`, or `priority`. The server orders the full authorized
collection before cutting a page. Due dates sort ascending with undated tasks last;
priority accepts and sorts urgent, high, normal (the canonical Atlas vocabulary);
ties use the other dimension, manual sequence
and ID. My work uses the same order without duplicating multi-assignee tasks.
Cursors bind the sort, filters, actor, scope and mutation revision. A changed
ordering/filter or intervening write refuses a stale cursor instead of skipping data.
Native My work uses the indexed assignment projection. Its `due`/`priority` mirror
is maintained in the task transaction, including copy/transfer. Existing native
databases need the explicit post-schema `backfillNativeFlowAssignmentOrder` for each
Company while writers are stopped. Nullable physical columns make schema addition
non-destructive; a pending backfill refuses the read as unavailable. The backfill
is idempotent, Company fenced, and refuses orphan/unsupported-priority repair. It
never imports legacy grants or creates membership. Fresh installations need no data
backfill. See `tasks/flow/PRODUCTIVITY-DEV.md` for the deployment rehearsal.
People use `flow.member.list({query?,internal?,active?,ids?,cursor?,limit?})` for the
Company directory and `flow.member.options({projectId,query?,internal?,roles?,ids?,exclude?,
cursor?,limit?})` for assignment. Both return `{items,total,cursor}` with a stable name/ID
position and scoped revision. Options contain only active platform/Flow members whose live
Core grants allow reading the project; team and Workspace inheritance use the same server
grant engine. `internal` keeps active non-guests, `active` (directory) every active person
including guests, `ids` (at most 100) rechecks or names a selection, and on options
`exclude` (at most 100) leaves people out and `roles` keeps only those project roles (a
handover reviewer must be `editor`, `admin` or `owner`). Search, filters, eligibility and
counts happen before pagination, and the cursor binds every filter. A bounded bootstrap's
people list is never an exhaustive assignment source. Writers recheck eligibility at
commit.
Organization managers read pending invitations with
`flow.invitation.list({cursor?,limit?})`, newest first by `(createdAt,id)`, as
`{items,total,cursor}`; a cursor from before any committed command is refused as
`conflict`. Accepted, revoked and expired invitations need no action and are not
listed. The bootstrap carries the first 50 with `invitationPage:{total,cursor,
loadedIds}`; counts use `total`. Members without that right, and guests, receive none.
Who can open a project or Workspace is computed by the server:
`flow.access.list({scope:'project'|'workspace',targetId,memberId?,query?,cursor?,limit?})`
returns `{items,total,without,cursor}` ordered by `(name,id)`; `query` searches the people
with access by name or email before paging and `total` counts the matches. Each item carries the
person, their organization role, active Teams and `access:{role,sources}`; a source is
`{role,scope:'project'|'workspace'|'internal',grantId,teamId,teamTitle,teamMemberCount}`,
project sources first. It reads only the target's grants and the Teams they name, applies
the same Core engine as `flow.member.options`, and refuses as `limit` past its bounds
rather than answer from part of the graph. `total` counts active people with access and
`without` those without; `memberId` returns that one person even without access. Any
internal person who can read the target may list it; guests and others are refused. A
cursor from before any committed command is refused as `conflict`. The
`project-members` and `workspace-members` bootstraps carry the first 50 as
`accessPage:{scope,targetId,items,total,without,cursor,loadedIds}`; the member access
modal reads its one person. A bootstrap for a modal route carries no list page, so when
such a modal opens over a members list (a reload or a shared link) the client reads the
list's first page with `flow.access.list` itself; a failure shows on the list with Try
again instead of loading forever. Atlas implements the same read.
Organization managers preview an access setting before saving it with
`flow.access.preview({change:'project-access',projectId,access}|{change:'workspace-access',
workspaceId,access},cursor?,limit?)`. It returns `{items,total,counts,cursor}` with only
people whose role would change (per project for a Workspace), losses first, in the same
row shape as the move preview. The preview needs the administration scope the change
needs; a cursor from before any committed command is refused as `conflict`.
`{change:'project-create',workspaceId,access,ownerId?,memberIds?,teamIds?}` previews a
project not yet created: the grants creation writes (creator and owner admin, selected
people and Teams member, at most 100 each) plus its Workspace, every row a gain with
`projectId:null`. It needs Workspace management. The project form shows its `total`;
an existing project's form shows `flow.access.list` `total`.
Teams are read by the server, never assembled from shipped membership. Team rows carry
`{id,title,description,version,archived:false,memberCount,grantCount}` and no
`memberIds`; `grantCount` counts only grants on targets the reader can see.
`flow.team.list({query?,cursor?,limit?})` returns active Teams by `(title,id)` as
`{items,total,cursor}`, and `flow.team.read({id})` returns `{team,grants}` with each
visible grant's `{id,teamId,scope,targetId,targetTitle,role,version}`; archived Teams
are `not_found`. Any internal person may read them; guests are refused. People rows from
`flow.member.list` carry their active `teamIds`, and `user.teamIds` names the actor's,
so client access checks never need a Team's membership. `flow.member.list` also takes
`teamId` (that Team's members) or `candidateForTeamId` (active internal people not yet
in it). The bootstrap carries the first 100 Teams with `teamPage:{total,cursor,
loadedIds}`, plus the actor's Teams and the Team a `team`/`team-edit` route opens.
The bootstrap's `grants` are only the actor's: their own user grants and their active
Teams' grants, enough for the actor's own access checks. Anyone else's access is read on
demand. `flow.grant.list({scope,targetId}|{subjectType:'user'|'team',subjectId,scope?},
cursor?,limit?)` reads one target's grants (any internal person who can open the target)
or one person's or Team's (organization managers, or people about themselves), by grant
id with a fenced cursor (`conflict` after any committed command). Exactly one mode is
accepted. Items are `{id,scope,targetId,targetTitle,targetArchived,subjectType,subjectId,
subjectTitle,subjectEmail,subjectRole,subjectStatus,memberCount,role,version}`; a Team row
carries its size. The project form lists a Workspace's inherited grants from it, and a
guest's granted projects come from it by subject. `flow.member.impact({memberId})`
(organization managers) returns `{projects,tasks:{total,items}}`: the non-archived
projects the person's grants and active Teams reach, counted as if they were active, and
their unfinished assigned tasks with the first 20 as `{id,title,projectId}` (task keys).
`member-edit` and `member-access` bootstraps pin the person they open beyond the people
window; an unknown person is `not_found` for the edit form and explained by the access
page. Each document's `readerIds` say only whether the actor is a reader, except the
open document the actor owns, which carries every reader (at most 100) and
`readers:{id,name}[]` so its sharing editor never drops a reader it did not load.
`access.grant` takes `subjectId` or `subjectIds` (at most 100, unique): every subject is
validated before any grant is written, a batch updates an existing grant's role under the
organization revision, and the reply carries `ids`.
Opening a task absent from the loaded collection (including a newly created task
beyond its first page) still reads `flow.issue.detail` and displays loading/retry.
Absence from a bounded page never means that the task does not exist.
Uploads use `POST /flow/uploads?task=<key>` with one multipart file. The server
streams the bytes through shared storage, binds the lease to actor, Company and
task, derives size/checksum from the bytes and sanitizes the declared MIME type.
Only safe preview types are served inline with nosniff. `flow.attachment.save` may
finalize only that actor's unexpired lease for the same task. Generic storage
reads also apply the Flow owner policy; generic writes cannot replace Flow files.
Task creation stages bytes with `POST /flow/uploads?project=<id>` before sending
`flow.issue.save`. Its `attachments` are upload references, never filenames alone.
The command finalizes the actor's ready leases for that project in the same
transaction as the task, checklist and subtasks. Failed/uncertain submissions reuse
the staged references and idempotency key; they never create replacement tasks.
`limit` is 1–100 and cursors carry the complete ordered position. Document bodies,
comments and history are detail reads. Chrome reads set `shellOnly: true` and
never load task bodies. Reads require an active platform account and Company
membership, and Core rechecks its own scoped grants on every read and command.

Production registers named domain commands, never an arbitrary collection
writer. The shared HTTP adapter resolves the existing editing vocabulary to
these commands in both Atlas and production: `flow.workspace.create/update`,
`flow.project.save/archive/restore`, `flow.page.save/archive/restore`, and the
corresponding catalog, sprint, epic, organization and operations commands.
Every write validates its declared schema, checks capability inside a transaction,
requires a durable actor/Company-scoped replay key, and checks the expected record
or scope revision before writing. A task write returning `record` reads it after
commit with the caller's current permissions.
Personal commands change only the actor's own records: `flow.project.favorite`,
`flow.preferences.save` and `flow.inbox.read` take no `expectedRevision` (one sent by
an older client is ignored), move no organization or operations revision and return
no `revision`. A race between the same person's writes is settled on the record's own
version, so one person's favourite, preferences or read notification never makes
another person's pending command stale.

Task history for direct move, applied bulk status changes, archive/restore and
sprint carry-over records committed before/after values and resulting task version
inside the same transaction. Refused/stale commands leave no history; replay does
not append a second event. Equal values do not create a misleading change event.
This supplements save history; it does not expose follower identities.
Task archive requires a nonblank string `reason`, matching the canonical Atlas
form and store. Missing/blank reasons refuse atomically with `fields.reason`.

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

Production `flow.issue.reorder` accepts `id`, optional `ids` and `expectedVersions`,
`expectedVersion`, `expectedOrderRevision`, optional `targetId`, `position`
(`before`/`after`), `groupBy` (`none`/`status`/`priority`/`assignee`/`sprint`) and
`groupValue`. Assignee groups use `user:<id>`, `users:<sorted JSON IDs>` or `""`;
sprint groups use the current client title (or `Backlog`), resolved independently
inside each project and rejected when ambiguous. Every selected task is authorized,
version-checked and extension-guarded; the whole reorder rolls back on refusal.
Ordering uses indexed ranks and bounded local rebalance, never a company-wide task
read. Bootstrap returns the persisted order revision. The success response includes
`ids` and `taskOrderRevision`; a repeated key returns the same committed outcome.

`flow.epic.save` uses `ownerId`, `outcome`, `start` and `end` alongside the scoped
record/version fields. A new epic requires valid ISO dates, an ordered range, a
nonempty outcome and an active non-guest owner who can read its project. Existing
epics keep omitted fields; explicit empty dates/owners/outcomes are rejected.
Project ownership is immutable. The shared compatibility adapter resolves the
current name-based form to one stable owner ID and rejects ambiguous names; Atlas
maps that ID back to its fixture display name. Bootstrap carries both `ownerId`
and `owner` (display name). Sprint dates are required; Kanban has no sprint writes.

The shared task form's `customFields` patch maps to typed `fieldValues`. Native
task DTOs keep the `customFields` alias used by the canonical presenter; Atlas maps
the typed write back to that fixture field. Numeric strings from native form inputs
are validated and normalized to numbers, while `false`, `0` and explicit null keep
their meaning. The canonical boolean field kind is `boolean` (`checkbox` remains
an accepted compatibility alias).

Summary reads defer custom-field values; `flow.issue.detail` supplies them before
the task becomes editable. Collection pages include extension-owned projections
for their task IDs. The controller folds those projections through `recordDetail`
when appending a cursor page, using the same ownership boundary as detail reads.

Within a controller lifetime, each unacknowledged mutation retains a replay key
scoped to company, actor, command and payload. An unrelated acknowledged command
must not replace that key. A confirmed result releases it, so a later deliberate
identical action is a new intent. This is in-memory retry state, not a durable
offline queue; production must reconcile authoritative state after a refresh.

Production exposes the finite organization commands `flow.project.move.preview`,
`flow.project.move`, `flow.project.access`, `flow.project.favorite`, and
`flow.invitation.resend`. Move preview returns
`{revision,people,total,summary,cursor}` for everyone with access before or after the
move, people who lose it first, then gains, then unchanged, each by name; `summary`
counts all outcomes and `cursor` pages 50 at a time. Rows use the access shape of
`flow.access.list`, from the same engine as the move; with `preserve`, a loss becomes
unchanged with a `retained` direct project source at the old role. The move
rechecks that revision, project version, both workspace administration scopes,
and any preserved grants inside one transaction. Explicit grants never grant a
recipient more than their previous effective role. Favorites are personal and
require read access. Resending rotates the token and queues one invitation event.

Remote LiveDoc writes are acknowledged only after durable snapshot commit. Failed
requests retain their exact CRDT updates until acknowledgement. Native owners merge
the latest durable snapshot before flattening and commit its pointer with the
version read for that snapshot. A stale worker must retry, never replace newer
content; receipt replay returns current metadata rather than an older version.
The owner receives `record` metadata with the committed version. The local embedding remains available
for drafts and Atlas. Pending remote edits participate in save/leave guards; no
second page save races the live snapshot writer.

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
The common command adapter converts catalog form `required` strings to booleans
and newline-separated field options to string arrays before the typed HTTP call.
The Atlas reverse adapter restores its form vocabulary; there is no production-only
form. Catalog descriptions are persisted. Custom-field `appliesTo` is `all`/null
or an authorized project ID; omitted updates retain it. A project-owned field cannot
target another project. Reads and server task validation apply the same filter,
including required-at-completion rules. Definition compatibility examines answers
in the proposed scope; narrowing a shared field does not rewrite historical answers.
The Atlas fixture verifies update identity and missing-ID refusal; production
typed adapters, concurrency/version handling and durable storage remain unverified.
Catalog updates preserve an omitted owner and reject owner changes or unknown
projects/colors. The shared catalog vocabulary is `neutral`, `blue`, `green`,
`yellow`, and `red`, matching the canonical Flow color picker and rendered chip
tones. A project-owned custom field only applies inside that project. Changing
its kind or selectable options is refused when existing nonempty task values
would become invalid, including values on archived tasks. Compatible option
additions and metadata-only edits remain allowed; optional missing values are
checked for requiredness at completion. Numeric values must be finite scalar
numbers or nonblank numeric strings; dates must be real `YYYY-MM-DD` calendar
dates. The native catalog writer validates definition changes in its scoped write
transaction, reading stored field answers in bounded windows, including archived
tasks. Metadata-only edits skip the compatibility scan. Catalog ownership comes
from the existing record for permission checks; a supplied `projectId` cannot
turn a shared catalog write into a project-only capability. Owner changes are
refused after checking the current owner's capability. Native field-error tokens
`catalog_owner_locked` and `incompatible_values` are localized by the common HTTP
transport; existing human-readable fixture errors keep their current behavior.
Production migration/upgrade and release-scale performance remain unverified.
Shared label archive preserves existing task links and removes new selections.
The library exposes archived labels for restoration; restoration rejects a duplicate
active name in the same owner/domain. Only organization managers can create,
archive or restore shared labels; members retain inspection access.
Both the label library and its editor read retain archived label metadata, so a
save-and-close does not erase the background library's restoration controls.
Status rename preserves omitted `kind`; task type rename preserves omitted `icon`.
Changing a status group refuses existing task references, including archived tasks,
and cannot remove the last status from any required workflow group. An unused
status may be reclassified when all groups remain represented. Active catalog
names are unique inside their owner/domain, rather than across unrelated projects.
The native writer enforces these rules under the same write lock/CAS as catalog
updates. Unicode title comparison and supported status/type-icon vocabulary use
the common pure `catalog-contract` module. Restore checks active-name collisions;
archive cannot remove the last active status in a required group.
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

### Native private commands

The installed private module owns the namespace `flow_pro.*`. Client extension
adapters map the fixture vocabulary to these finite typed commands; production
does not expose `flow.quality.command`, `flow.hours.command`, or generic writers.
Every command retains scoped Core authorization, replay, transaction and guards.

- `quality.estimate`, `quality.scope`, `quality.submit`, `quality.review`,
  `quality.reassign`, `quality.close`, `quality.bug`, `quality.report`,
  `quality.report.resolve`: task `id`, handover `expectedVersion` and the fields
  of that action. A manual estimate requires explicit points and context; external
  estimation controls appear only when the response declares an available provider.
- `quality.acceptance` and `quality.rules`: policy version, Company or Workspace
  scope. Existing handovers retain their policy snapshot; new policies have an
  effective date and never rewrite historical acceptance.
- `hours.plan`, `hours.log`, `hours.schedule`, `hours.pattern`, `hours.holiday`,
  `hours.absence`, `hours.absenceRemove`: `expectedRevision` and explicit resource
  fields. A remaining estimate may be null. Calendar writes and staff privacy use
  their own capability checks; an absence can only be reported by its subject.
- `goal.save`, `goal.update`, `goal.link`: scoped Workspace/owner, stable epic IDs,
  optimistic version and operation revision. Check-ins and links are durable.
- `flow_pro.goal.list({workspaceId, recordId?, cursor?, limit?})` returns bounded
  `goals`, `goalCollectionPage`, private `goalEpicLinks` and `goalEpicStats`. List
  records defer their description and carry their latest check-in metadata; an opened goal includes up to 50 immutable
  check-ins and 50 immutable link/unlink events. Unlinking removes the current
  association and retains that audit trail. Epic totals are authorized database aggregates, independent of the
  task cursor. A client extension resolves the finite goal vocabulary and captures
  the version from its current goal before sending a write.
- Goal reads include `goalLinkedEpics`, a bounded authorized projection of the
  linked epics (with their project titles), even if those epics are outside the
  Core epic page. `flow_pro.goal.epics({workspaceId, cursor?, limit?})` scans a
  bounded, stable epic window and returns `goalEligibleEpics` and
  `goalEpicOptionsPage`. Eligibility excludes archived projects/epics, projects
  without write access and links to any goal, including goals outside the loaded
  goal page. An empty options window with a cursor is not an empty collection.
  The client offers the next window without fetching every epic or goal.
- Goals and epic options append through their separate cursors. Duplicate IDs are
  folded once; reads that started before a write, navigation or disposal cannot
  overwrite the new state. A failed next-page read retains the existing records
  and has an explicit retry. Pace metrics describe the currently loaded goals
  until authoritative full-scope metrics are available; total collection count is
  separate. This limitation remains a release gate.
- `automation.save`, `automation.toggle`, `automation.run`: scoped project/rule,
  explicit trigger/condition/action inputs. Effects execute through Core task
  services with the rule owner's current rights; durable events deduplicate work.

Responses declare integration availability. A missing GitHub/AI/email credential
never produces a simulated success in production. The private module may add
`goalId` to the typed epic save through the public `inputFields` extension contract.

### Operations and native form recovery

`flow.inbox.list({filter?, cursor?, limit?})` pages the caller's Inbox; filter is
`unread` (default), `all`, `mentions`, or `action`. Filters and counts are applied
before the cursor, in the same currently authorized project scope. The response
is `{items, cursor, total, unreadCount, filter}`, at most 50 items. A cursor binds
the recipient, Company, visible scope and filter and orders by created time/id.
Bootstrap carries the first page and `inboxPage`; changing tabs uses this read.

Native task commands create recipient-scoped durable Inbox records and an outbox
in the same transaction. Assignment, mention and dependency notifications retain
an independent `actionNeeded` state: marking read never resolves an action.
Current assignment/status/dependencies determine whether an action is still valid.
Inbox reads, search, acknowledgement and mail retries recheck current project access.
Revoked recipients receive neither old task metadata nor a cached email body.
The notification preference controls additional related updates and email:
`mentions` includes mentions/assignments, `all` includes followed-task updates,
`none` disables extra updates/email while retaining actionable Inbox events.
Queued followed-task update emails also require a current follower relationship,
both when building the envelope and before every provider attempt. Unfollowing
cancels those pending emails without deleting historical Inbox events or suppressing
independent mentions and assignments.
Before every provider attempt, a task notification's stored envelope must target
only the recipient's current active-account email. Changing or removing that
address cancels the stale envelope; restoring the old address does not revive it.
Email is optional and requires a trusted origin, template and real deployment
transport; no configuration means in-app delivery only. Mail jobs invoke domain
authorization immediately before every provider attempt, outside write transactions.

Atlas operations validate the complete form definition and response before changing
records. `flow.form.save` names its recipient by `assigneeId`, never by name; the
client searches recipients with `flow.member.options({projectId, internal: true})`
and defaults to the actor when the actor may be assigned. Recipient membership must
be active and internal with project access; a missing, inactive or guest person, or
one who cannot open the project, is `validation {assignee: 'invalid'}`, not the
actor's `forbidden`. Publish/required/archive flags are booleans. Refused form submissions bind errors
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


### Screen help loading

Core exposes the shared DS Help trigger for authored route guides. The initial
screen contains no hidden help body or guide payload. An explicit Help request
loads the precompiled VI/EN content module; DS HelpDrawer/MarkdownContent and the
DS runtime retain rendering, keyboard, mobile and focus ownership. Navigation,
scope change or disposal before completion prevents a late drawer from opening.
A failed load reports one error and the next explicit request retries. No
Markdown parser or diagram engine is eagerly added to list startup.
