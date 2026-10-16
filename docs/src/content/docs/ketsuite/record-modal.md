---
title: Record modals
description: The KetSuite contract for opening a collection's records in a client-side modal island.
---

The design system decides *where* a record opens: on its own page when it is a workspace (several
tabs, money or line items, an activity log, a URL people share), in a `ModalSheet` over its collection
when it is short and read in the flow of a queue, and in a non-modal `Peek` docked beside a dense spatial
view only as a first step towards its page (see "Opening a record from a collection" and "Peek beside a
spatial view" in `@ketvietlab/design-system`). This page
is *how* a KetSuite module builds either one on the same client runtime, so a care task, a sales case
and a partner behave identically once their presentation is chosen.

A record that opens on its page uses the same definition, rendered by the same client runtime in its
page presentation (see [Record pages](#record-pages)). Administration profiles — a user, a role, an
access policy — have their own page shape on that runtime with route-provided context. See
[Administration profiles](#record-pages-for-administration-profiles) below.

## URL

One shape for every module:

```
# File: URL shape of every KetSuite record modal
/admin/<collection>?<list state>&record=<kind>:<id>&tab=<tab>
```

- `kind` is `<module>.<name>` (for example `customer_care.followup`) and never contains a colon; the
  id may.
- Build links with `recordModalHref(url, { kind, id, tab })`. It keeps the collection's own query, so
  filters, sort and page survive opening and closing.
- `record` and `tab` are reserved for the record modal. A collection that has its own tabs (for example
  configuration sections) names them with another parameter, such as `section`; otherwise opening or
  closing a record would overwrite the collection's tab.
- The server always renders the collection with a **closed** host. A deep link opens the record after
  hydration; server and first client render stay identical.

## Server side

1. Rows and cards link with `recordModalHref`; create actions with `recordModalCreateHref`.
2. The module declares one island per record kind with `defineRecordModalIsland({ kind, client, export })`
   and places it through `backend:runtime`. Its props are empty. `backendPage` renders that joint
   once with every full backend document, beside the shell and outside the slots fragment navigation
   swaps, so a screen's frame never carries it: a screen that assembles its own frame still leaves the
   modals mounted for the screens reached from it.
3. The module exposes one permission-checked read, `<module>.<kind>.modalContext({ id })`, returning
   `{ data, messages }`. `data` is everything the views need in one round trip, including the viewer's
   `permissions`; `messages` are the translated strings the views and the runtime use, including the
   `recordModal.*` labels below.
4. Writes are the module's existing domain functions. The modal adds no form routes; the server stays
   authoritative for permissions and validation.

## Client side

`createRecordModal(definition)` returns the island factory the module exports.

```tsx
// File: modules/customer_care/assets/followup-modal-view.tsx
export const followupModal = createRecordModal<FollowupContext>({
  kind: 'customer_care.followup',
  size: 'large',
  context: { fn: 'customer_care.followup.modalContext' },
  title: (c) => c.data.task.title,
  header: (c) => <CustomerStrip context={c} />,
  tabs: [
    { id: 'call', label: (c) => c.t('customer_care.modal.call'), view: CallTab },
    { id: 'result', label: (c) => c.t('customer_care.modal.result'), visible: (c) => c.data.permissions.work, view: ResultTab },
  ],
  dialogs: { reassign: { title: (c) => c.t('customer_care.action.reassign'), view: ReassignDialog } },
  commands: {
    complete: { fn: 'customer_care.followup.complete', input: completeInput, after: 'close' },
    claim: { fn: 'customer_care.followup.claim', input: versioned, after: 'reload' },
  },
})
```

The runtime owns, for every module:

| Concern | Behaviour |
| --- | --- |
| Opening | A click on a link naming this kind opens it (`pushState`); a link to the open record switches tab (`replaceState`). `record=<kind>:new` opens the create form (see below). |
| History | Back and forward over modal entries open or close the modal only. The navigation layer asks through the cancelable `ket:popstate` event and does not re-fetch the page. |
| Accessibility | `ModalSheet mode="client"`: close controls are buttons, focus moves in and is trapped, Escape closes the top layer, the rest of the page is inert, focus returns to the opener. |
| Height | A definition with more than one tab renders `ModalSheet height="fixed"`, and the runtime owns that height: it measures each tab it renders and holds the tallest as a min-height, so the dialog opens at the size of its content and never shrinks as the reader moves between tabs — and a record whose tabs are all short never gets a dialog the height of the screen. The floor belongs to the record and starts again with the next one. `TabbedView` keeps the bar fixed and only its `TabPanel` scrolls; the panel adds no horizontal padding. A single view and dialog layers size to their content. |
| States | Loading, load failure with retry, not found, and refused. A read the server refuses (403) is titled `recordModal.deniedTitle` in a warning notice that says `recordModal.denied` unless the server sent its own words, with no retry: reading again would only be refused again. The modal and both page modes use the same title. |
| Cache | Each island keeps the last 30 contexts it read (including the create form's). Reopening one renders it at once and reads it again quietly behind it. A successful command drops the record it changed, and `ket:records-changed` for the kind drops the named ids (all when none are named). A definition sets `cache: false` when its context must never be shown before a fresh read. |
| Follow | A record page reads its record again when `ket:records-changed` names it; a modal keeps the context it opened with, so a draft is never replaced. A record that changes without the reader (a background job's status) sets `follow: true`: its open modal reads again on that event too, unless a command is running or the reader typed into it. The job's own island dispatches the event when the job finishes. |
| Commands | A form inside the modal names its command with a `__command` field (or a submit button with `name="__command"`). The runtime maps `FormData` through `command.input`, calls `/_ket/fn` with an idempotency key, and applies `after`: `close`, `reload`, `refresh`, `stay`, `{ tab }` or `{ dialog }`. Every call except a preview carries that key, so the function behind a command, and behind each of its `also` steps, declares `idempotent: true`: KetJS refuses a key on any other function (`E_NOT_IDEMPOTENT`) and the save fails before it writes. `test/record-command-idempotency.test.tsx` holds every KetSuite record command to this. A step's `when(context, form)` also reads the submitted form, so a step whose field was left unchanged (a cost typed as it was) is skipped rather than called. The runtime owns a form when its nearest island host is its own island — a `ket-island` element or a `div[data-ket-island]` (`RECORD_ISLAND_HOST`); a form inside a nested island on either host is left to that island. |
| Asking first | A command's `confirm(context)` returns a question, or `null` to run at once. The runtime asks it in the shared small `ConfirmDialog` before anything is uploaded or called, never in the browser's `confirm()`: the title and the confirm button repeat the label of the button that submitted (`recordModal.confirm` when it has none), the message is the question, and the cancel button reads `recordModal.back`. The confirm button is destructive only when that submitter was. Cancel has focus when the dialog opens; Escape, the backdrop and Cancel decline, and a decline returns focus to the submitter with the record and its draft untouched. While the question is open the layers under it are inert, another close or command does nothing, and an answer applies only if the same record is still open and nothing is running. |
| Previews | A command marked `preview: true` asks what would happen instead of making it happen. Its function writes nothing, so the record is not re-read, the collection is not told and what was typed stays on screen. The answer reaches the view as `context.outcome<T>('<command>')`, beside the form that asked for it, and is cleared as soon as anything moves — another record, tab or dialog, a refusal, or the write itself. This is how a change with consequences is confirmed: one form, two submit buttons, and the commit offered only once the consequence has been read. |
| Answers | `context.outcome` also carries what a command with `after: 'stay'` returned, which is how something the server can say only once — a one-time credential — reaches the reader. Every other `after` replaces the layer, and the answer goes with it. |
| Refusals | Issues with a `field` are read back by the view through `context.fieldError(name)`; the rest render as a danger notice at the top of the layer. A code that neither `messages` nor `labels` translate reads as `recordModal.saveFailed`, never as the code itself. Text/select values survive through `context.draft(name, fallback)` and checkbox/radio state through `context.draftChecked(name, value, fallback)`. A child workflow can explicitly seed a field from the captured parent with `context.recordDraft?.(name, fallback)`; child drafts remain isolated until its command succeeds. If that command consumes parent fields, declare `clearRecordDrafts: [name]` on the command; only those drafts clear after successful completion, while refusal/cancel preserves them. |
| Feedback | An untabbed record's header, its notice (saved or refused) and its body are one `Stack` with fixed positions, as are a record dialog's notice and view: the notice keeps the layout gap from what follows, and an empty slot renders nothing, so a notice appearing never rebuilds the form under it. A dialog opens without the last command's notice, whether a button or a link (`?dialog=`) opens it. A context may name a command's answer through `messages` (`recordModal.savedTitle`, `recordModal.saved`) when the record has one command whose outcome a generic "Saved" would misname (cancelling an import). |
| Moved since read | A command sets `refreshOnRefusal: true` when a refusal may mean the record, or something it depends on, changed after it was read (a revision stamp, an availability slice). After the refusal the runtime reads the context again quietly, without a loading state: typed text, select, checkbox and radio drafts and the refusal's guidance stay, while hidden fields — never drafts — take the new stamps, so the retry is checked against what the reader now sees. |
| Ancillary dialog mutation | A command with `after: 'refresh'` can set optional `retainDialogDraft: true` to keep current dialog values, checkboxes, baselines and view state while reading the updated context. Use it for a fresh shipping quote within an unfinished booking form. It never resubmits the main command, and it shows no saved notice: nothing the reader entered was saved. The default remains false: successful commands consume the dialog input as before. |
| Success | A command that leaves the modal open says so where a refusal would have appeared: a positive notice at the top of the layer (`recordModal.savedTitle` / `recordModal.saved`). It clears on the next submit and when another record opens. A command that closes the modal says it by closing. |
| Unsaved input | Switching tabs preserves text, select, checkbox and radio drafts without prompting. Closing asks only for the top layer being discarded, in the same `ConfirmDialog` as a command's question: `recordModal.unsaved` as its title, `recordModal.unsavedDetail` as its message, `recordModal.keepEditing` (focused) and a destructive `recordModal.discard`. Keeping returns focus to the control that asked to close; discarding closes only the dialog or record it was asked about. |
| Dialogs | An element with `data-record-dialog="<name>"` opens a dialog layer of the same record; `data-record-param-*` attributes become its params. Closing it returns to the record without reloading. A link to the open record whose address names `dialog=<name>` (an overflow `ActionMenu` command) opens that dialog the same way: one history entry Back closes, focus inside the dialog, then back on the link — or on the menu's summary when the link sat in a disclosure that has closed since. `recordDialogHref(context, dialog, id?)` writes that link, with `dialogId=<id>` naming the item; the runtime reads the id from the link pressed, not from the address it is leaving. When a row's editor is a dialog, give the table `rowHref: (row) => recordDialogHref(c, 'editLine', row.id)` (only for a reader who may edit) instead of an edit button in a column: the whole row opens it. |
| Uploads | A command's `upload` names file fields; each file is stored through `/files` with the metadata the command gives, and the attachment ids reach `input` as its third argument. A `data-record-submit` file input submits on choice, and a `data-record-dropzone` form takes a dropped file. A file input that waits for its form's button keeps the choice in view state: `state('file:<name>')` is an object URL of a chosen image (empty for any other file) and `state('file:<name>:name')` its file name. Pass them to `DropZone` as `preview` and `status`, so the picture shows before it is sent. The runtime revokes the URL when the choice changes and when it is disposed. |
| View state | `context.state(key)` reads what a `data-record-state` control set: a button or link with `data-record-value` on click, an input or select on change. It resets when another record opens. |
| Islands | `recordIsland(name, props)` places an island inside a view; the runtime asks the page's island manager to start it (`ket:islands-attach`) and to dispose it when its host leaves (`ket:islands-detach`). A joint filled with islands renders in a record modal this way. |
| Collection | After a successful command the runtime dispatches `ket:records-changed` (cancelable); the backend shell re-fetches the content slot as a fragment. The modal lives outside that slot and is untouched. A collection that is a client island reads itself again and calls `preventDefault()` on the event: the shell then leaves the slot alone. It decides after every listener has run, so an island that listens after the shell is still heard. Re-fetching anyway would be a second, stale read: a modal that closes announces before it leaves the address bar, so the fetch would put the record back in the URL and open it again. |

Views are render-pure. They read the context and return design-system markup (`RecordForm`, `Field`,
`DataTable`, `Notice`…); they never fetch, never touch history and never query the document. The runtime
builds `TabbedView` and `TabPanel`; a module supplies the tab's label and view and must not create its own
tab-body wrapper, padding, or scrolling contract.

`RecordModalForm` accepts a `body` after its standard fields for composed controls such as an ordered
value editor. Pass `dirty` when a structural edit changes the draft without leaving a changed visible
input. The runtime combines that flag with native field checks when deciding whether closing needs a
discard confirmation. A public `ReorderList` emits its ordered IDs through a native hidden input change;
the record runtime captures all current fields before applying that view state.

`recordStateSelectControl` is the control of a select whose choice changes what the rest of the form offers. Pass it as a public `Field`'s `control` with the field's `id`, `invalid` and `describedBy`: the control points `aria-describedby` at the help and error the Field draws (`<id>-help`, `<id>-error`), only those shown, so a reader hears why the choice is refused.

A command may supply `issueField(path, submittedForm, context)` to map server validation paths to stable
native control names. Ordered editors map indexed paths using the submitted order snapshot, so an error
stays with its row if the reader later changes the order. Matched native names display inline once;
unmatched and general failures remain in the layer notice.

## Tabs other modules add

A module that owns a record cannot know the tabs a module composed later wants on it. Such a record takes
`extensionTabs(context)` beside its declared `tabs`: they follow the declared ones, pass the same `visible`
filter and render through the same `TabbedView`. A definition that takes extension tabs keeps the fixed
height, because it may gain a tab at any time.

The record's context function supplies them from a joint. A client modal cannot render a joint, so only island
fills cross: the context lists each fill's island, and the view places it with `recordIsland`. The product
template modal reads `product_backend:template.recordTabs` — a module fills it with one island placement, the
island renders the panel with `{ templateId, locale }`, the tab is labelled by the module's
`<module>.productTemplateTab` message and addressed as `tab=<module>`.

A fill is one template for every viewer, so one whose island would only show a refusal names what it needs
in its condition: `{% if may.<module>.<function> %}{% island "…" %}{% endif %}`. A server page renders such a
joint with `jointFor(ctx, url, req, joint, props)` from `backend/screen.ts`, which adds a `may` prop answering
each named function for the viewer (the joint declares `may: 'json?'`); a context function passes its
permission check to `recordIslandsFor`, which leaves out a fill naming a function the viewer may not call.
Both read the names with `ui/fill-needs.ts`. The shell's `backend:sidebar.foot` works the same way, so the
inbox and activity counts are placed only for whoever may read them.

## Creating a record

A collection's create action opens the **same** record modal as its rows, with no record yet. There is
no create page and no separate create modal.

```
# File: URL shape of a create action
/admin/<collection>?<list state>&record=<kind>:new&tab=<tab>
```

- Build the link with `recordModalCreateHref(url, { kind, tab })`. `new` (`RECORD_NEW_ID`) is reserved:
  a kind whose ids could literally be `new` must not use this contract.
- The runtime calls the context read **without an id** (`{}`) and sets `context.creating = true`.
  `<module>.<kind>.modalContext` then returns the empty record's defaults, the choices its form needs
  and the viewer's `permissions` (a viewer who may not create gets a refusal, not an empty form).
  A definition that needs another input shape uses `context.input(id, creating)`.
- Views branch on `context.creating`: hide tabs that need an existing record (members, history…),
  title the modal for creation, and name the create command in the form.
- The create command is the module's existing save function. Give it `after: 'open'`: on success the
  runtime reads the new id (`created(value)`, else the value's `id`), replaces the `:new` history
  entry with the created record and opens it on `openTab` (or the first tab). Without an id it closes.
  `ket:records-changed` carries the created id, so the collection behind refreshes.
- A child that only exists once the record does (a team's members, a programme's milestones) is added
  after the switch, inside the created record's modal.

## Runtime labels

The runtime shows these labels before a record's context has loaded, so a module passes them in the
page's language through `labels` (an object or a function returning one). The context's `messages`
override them once loaded, the last record's messages carry over while the next one loads, and the
runtime keeps English defaults (`RECORD_MODAL_LABELS`) so a reader never sees a key. Contexts should
still ship the same keys in `messages`:

| Key | Use |
| --- | --- |
| `recordModal.close` | Close control label |
| `recordModal.loading` | Loading state and provisional title |
| `recordModal.loadFailed` | The record could not be read |
| `recordModal.notFound` | The record is gone or not visible |
| `recordModal.retry` | Retry after a load failure |
| `recordModal.errorTitle` | Title of the refusal notice |
| `recordModal.saveFailed` | A command failed without issues, or with a code nothing translates |
| `recordModal.savedTitle` | Title of the notice a succeeded command leaves |
| `recordModal.saved` | A command succeeded and the modal stayed open |
| `recordModal.unsaved` | Title of the question before discarding typed input |
| `recordModal.unsavedDetail` | Message of that question |
| `recordModal.discard` | Confirms discarding typed input |
| `recordModal.keepEditing` | Declines discarding and keeps the layer open |
| `recordModal.confirm` | Title and confirm label of a command's question when its button has no label |
| `recordModal.back` | Declines a command's question |
| `recordModal.deniedTitle` | Title of a read the server refused |
| `recordModal.denied` | A refused read, when the server sent no words of its own |
| `recordModal.uploadFailed` | A file could not be stored |

## Building the island

Author the definition in TSX and bundle it with esbuild into the module's asset root. Keep
`@ketvietlab/ketjs-view` external (it is served at `/_ket/view/`) and bundle
`@ketvietlab/design-system` and `@ketvietlab/ketsuite/ui` in, so the island shares the page's single
renderer and renders the same markup the design-system CSS expects.


### Inline photo cells

Use `RecordModalForm` with `dropzone: true`, an upload command, and a public `DropZone` in `body`.
Selecting a file and dropping a file both submit that form through the record runtime. The runtime
owns uploads, errors, busy state, and the subsequent context refresh. Keep each cell a separate form;
placing the photo matrix inside a note or completion form creates invalid nested forms. File controls
need no module-specific event handler or private design-system attributes.


### Pending actions and inline editors

`recordModalHref(url, { kind, id, tab, dialog })` optionally names an entry dialog with the
`recordDialog` query parameter. The runtime reads the record first and opens only a dialog declared
by that record definition. Opening the dialog performs no mutation: its command still validates
permissions, current version, and fields. This is appropriate for kanban drop confirmation. A normal
record link clears the entry dialog; closing clears it with the record cursor. Do not implement a
second overlay or write on drop.

`RecordStateTrigger({ name, value, children })` wraps a public button to select a record-local view
state, such as the active milestone note editor. The runtime retains form drafts before changing
state. Give editors for different records distinct field names so switching editors never reuses the
wrong draft. For an inline Cancel action, pass `resetFields: [name]` to discard only that
editor's draft while preserving other fields and tabs. State triggers do not save a record.

For a paged checkbox chooser, `context.draftCheckedValues?.(name)` returns the captured
checked values of that field in the current layer, including unmounted pages. Submit
hidden inputs only for selections outside the visible page, once per value; continue
using `draftChecked(name, value, fallback)` for visible boxes. The optional API preserves
compatibility with older contexts and never selects unseen rows. `resetFields: [name]`
and successful command `clearRecordDrafts: [name]` clear all checkbox/radio values of
that exact field, keeping similarly named fields and parent/child layers independent.
The server must still validate every selected record and enforce permissions.

Desktop `fixedHeight` is carried by `--kv-modal-fixed-height`; it never overrides the mobile full-screen height. Avoid inline `height: … !important` on a ModalSheet.

## Record pages

Product templates, for example, open on their own page: `/admin/product/templates/{id}`, and
`/admin/product/templates/new` for the create action. The record is still rendered client side. General and Attributes & variants are peer Surface cards,
shown together without page tabs; each form keeps its own save action.

```
# File: URL shape of a record page
/admin/<collection>/<id>?tab=<tab>
/admin/<collection>/new
```

- The module declares the island with `defineRecordPageIsland({ kind, client, export })` and its client
  exports `createRecordPage(definition, { path: (id) => '/admin/<collection>/' + id })`. The definition
  is the one a modal would use: context read, tabs, commands, dialogs and drafts are unchanged.
- The page route renders the shell without a top bar or title and places the island through a joint
  with `{ id, tab, title, loading, back, width }`. The island's server view is `recordPageLoading(props)`:
  a `RecordPage` holding a `LoadingState`. The first client render is the same markup, so hydration
  adopts it, then the runtime reads the context and renders the record. The route answers 404 for an
  unknown id before rendering anything.
- `context.presentation` is `'page'`. Views use it to place controls: a page's actions sit in its header,
  so a menu opens downward, and its close trigger reads as the way back to the collection.
- `pageActions` supplies the page header commands (falling back to `actions` for existing definitions).
  `pageAside` and `pageAsideLabel` place supporting record facts in the native `RecordPage` rail.
  `pageAsideWhenStacked` chooses where that rail sits in reading and keyboard order, and on narrow
  screens: `before` (the runtime's default, kept for existing pages) leads with a rail of things to act
  on — a queue's next step, an approval — and `after` lets reference facts (totals, the counterparty,
  history) follow the fields. `recordPageFrame` takes the same choice as `asideWhenStacked`. These
  options apply to both page modes and do not alter modal presentation. Long workspaces use titled `Surface` blocks rather than tabs.
- A write form has one primary submit. When temporary persistence is needed, give it an explicit
  secondary “Save draft” action beside the primary, backed by actual draft semantics. A workspace
  must not repeat the same editable/save surface in its body and in its action dialog.
- Draft capture treats a compound DateTimePicker as its single named wall-time value. The unnamed
  date/time helpers cannot create competing drafts. Opening a populated dialog is clean; changing
  only its date or time still participates in the discard guard and survives validation rendering.
- Client page dialog/tab changes preserve the route's validated `back` as `returnTo`, so closing a
  short action dialog and refreshing the page keeps the original collection filters and row anchor.
- Closing (the close trigger, or a command with `after: 'close'`) navigates to `back` through the shell's
  own link handling. Switching tabs replaces the address in place; back and forward belong to the shell.
- A command with `after: 'open'` on the create page replaces `new` in the address with the created id.
- Nothing outside the page turns inert, and Escape and Tab are trapped only while a nested dialog is
  open.
- Anchored returns use the framework's `[data-ket-reload]` path when the installed fragment navigator
  discards URL hashes from response URLs. The shipping consumer opts its row/back links into this
  native navigation; list filters still update in place. Close/delete returns also preserve a row hash.
- A successful command announces `ket:records-changed` with `page: true`. The page reads its own
  context again, so the shell does not re-fetch the route behind it.
- Links from the modal era (`?record=<kind>:<id>`) on the collection redirect to the page.

## Record forms embedded in an SSR page

Use `createRecordPanel(definition)(props)` when a record form belongs inside an existing
page or route tab. Its server view is `recordPanelLoading(props)`. The first client
render adopts that frame; the ready panel reuses record commands, validation, drafts,
permissions and dialogs without rendering another RecordPage, title or navigation.
The enclosing page owns its SSR tabs and content width. `pageActions` supplies the
panel's action row; a submit button targets the single `RecordModalForm` by form ID.
`pageAside` becomes supporting content below the form. Persistent tab hosts may hide
the panel when another tab is selected, preserving the form draft until it is saved
or the enclosing page is left. Parent route tabs are never intercepted as record tabs.

## Record pages for administration profiles

A profile the reader studies, links to and returns to lives at `/admin/<things>/{id}` as a
`RecordPage` (56rem, no tabs). It reuses the record runtime, so dialogs, commands, drafts and
refusals behave exactly as in the modal.

1. Declare the island with `defineRecordPageIsland({ kind, client, export })`. Its props are
   `{ id, title, loadingLabel, trail?, trailLabel?, envelope? }`, keyed by `id`.
2. The detail route calls the module's `modalContext` itself and passes the result as `envelope`,
   with the collection's `returnTo` as the last trail link. The server writes `recordPageShell`,
   the client adopts the same markup and then shows the record without another request.
3. The client exports `createRecordPage(definition)`: the modal definition without `header` and
   `tabs`, with `body` for the blocks — one titled `Surface` each, returned as siblings so the page
   owns the gap between them — and `pageActions` for the header's commands. A block's groups are
   `Section`s in `Stack({ divided: true })`; block title and group titles are both 14/20/600, the
   hairline before each group carrying the tier.
4. Rows link to the page with the collection's state in `returnTo`. Creating stays a modal over the
   collection; its command `navigate`s to the new page. `?record=<kind>:<id>` redirects to the page.
5. The way back keeps the reader's place. `returnTo` names the row (`rowAnchorHref(listUrl, id)`,
   `#row=<id>`), and the page follows only a `returnTo` that points at its own collection. The
   collection calls `rememberRowAnchor(link)` on a plain row click, `takeRowAnchor()` on arrival,
   passes the id as `KetTable`'s `currentRow`, and calls `restoreRowAnchor(rows, anchor)` once its
   rows render: Back puts the row where it stood, the page's way back centres it, focus goes to
   its link, and a row no longer in the results is announced rather than guessed at.
6. A step on the record (change the stay, move room, cancel) is a dialog nested in the page and
   owned by its address (`dialog=<step>`), not a page of its own. A step with several decisions
   reviews its result in a second step dialog before it saves; asking before a hard-to-undo
   change is a `ConfirmDialog`. A step the record's state does not allow opens nothing and the
   page says why. A rejected submit returns to the same dialog with the reader's values and
   `aria-invalid` on the field, and the runtime focuses that field. The page header drops its
   commands below the title once the page is narrower than 48rem.

`close`, `reload`, `open` and tab afters only close the top dialog; the page itself never closes,
and `ket:records-changed` for its id reloads it in place.

### CSR accounting consumers

`AppTopbar.search.mode="link"` leads directly to a search workspace and emits no
native dialog/template/noscript subtree; `dialog` remains the default. `ListPage`
accepts `busy` and `dimmed`: an island owns delay, stale reads and disposal; the
pattern owns `aria-busy` and `--kv-opacity-pending`. `Peek.closeControl` accepts a
public client trigger while keeping the summary non-modal. `ConfirmDialog` accepts
`mode="client"`; its cancel command is handled by the client modal owner.

Client-read record pages own `tab`, `dialog` and `dialogId` in browser history and
retain their list trail. Record commands retain an idempotency intent across an
uncertain response; changed input receives another intent, and success clears it.
`recordChanged` exposes captured parent edits to a child decision; a posting
confirmation must require saving those edits first. Runtime effects remain in the
island. Static SSR shell props never carry business data, rights or field options.
Peer Sections inside one Surface or modal use `Stack({ divided: true })`; its
existing token hairline is mandatory, including in CSR presenters.

Record runtime exposes `draftScope` (`record` / `dialog`) to namespace input IDs by owning layer. Route dialog metadata is present on both layers and must not determine control IDs. A refused submit focuses the first invalid control after rendering the retained draft.
