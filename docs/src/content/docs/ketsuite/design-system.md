---
title: Design system
description: Use and govern KetSuite's public components, catalogue, inventory, CSS, and browser behavior.
---

The KetSuite design system is a public, server-rendered package and a documentation application. The
package owns reusable markup, tokens, component styles, and `data-ui` contracts. KetSuite modules own
business data, translated copy, routes, permissions, and workflow behavior.

Design guidance is maintained only in [Két Design System](https://github.com/ketvietlab/ketjs/tree/develop/skills/ket-design-system).
Install it with `npx @ketvietlab/ket-design-system-skill@latest`. This page documents
APIs and runtime delivery; it does not define a competing visual rulebook.

The interface typeface is KÉT Sans (Light 300, Regular 400, Medium 500, Bold 700),
Két Việt's own font: free to use and embed, but not open source and not MIT; the
KÉT Sans Font License forbids modifying or redistributing the font files. Medium is
registered for `500 600`, so text set at 600 uses Medium rather than falling through
to Bold. KÉT Sans has no italic yet; the browser slants the upright faces. The package
also includes Inter 4.1 variable fonts (normal and italic, weights 100–900) under the
SIL Open Font License, and `--kv-font-sans` names Inter after KÉT Sans for the
characters KÉT Sans does not draw. The font files and licenses live in
`packages/design-system/src/foundations/fonts/`; their sources are pinned in that
directory's README. `tokens.css` registers these fonts, so consumers do not depend
on fonts installed on the user's operating system.
The built `styles.css` embeds WOFF2 data URLs, keeping the stylesheet relocatable
when KetJS serves it at a content-addressed URL, with no third-party font request.
Consumers with a Content Security Policy must permit `data:` in `font-src`.
Consumers serving unbundled `tokens.css` must also serve its sibling `fonts/` directory.

Run `npm run design:system` from the repository root to open the documentation application in
`apps/design-system`. It has three review surfaces:

- **Components** renders the state specimens exported by the public package.
- **Page patterns** exercises the only three full-page contracts: `ListPage`, `RecordPage`, and
  `WorkspacePage`.
- **Inventory** is the Wave 0 governance registry. It shows public exports, KetSuite compatibility
  exports, planned components, ownership, maturity, promotion decisions, evidence posture, and CSS
  ownership.

## Route-local screen help

Website Studio consumes the canonical public `HelpDrawer` and `MarkdownContent`
contracts described under screen guidance below. The native drawer owns its
header, scrolling and responsive behavior: modeless desktop, modal mobile.
Render one drawer with the current screen content. Use a public Button/IconButton with `name="screen-help"`, its
drawer id as `value` and `controls`, and `expanded={false}`. The shared runtime also
accepts `ket:screen-help-request`; disposing a frame closes its drawer and removes
the listeners. Do not put fixed screen help in the application shell.

Studio supplies its translated labels and a bounded heading/paragraph lexer
returning public `MarkdownToken` values. Its guides do not require GFM or Mermaid;
the same public renderer can consume the richer host lexer used by the catalogue.
`headingOffset` keeps the authored headings below the drawer title. Text remains escaped.

## Relation selectors

`Field` accepts `control` with `layout="inline"` for enhanced asset controls.
Its public frame owns the label/control columns at narrow widths; a logo recipe
owns only its thumbnail limit. Use the real picker ID for label association.

`createRelationSelectView` also accepts optional client-only `RelationSelectCallbacks`. A composing
island can supply reactive `options` and `disabled` readers, handle `onSelect`, and enable an
`onCreate(query)` action in the dropdown. `resetAfterSelect` returns an add-to-list picker to its
placeholder after selecting an option. Local callback-backed options are searchable in full, with no
empty remote-manager dialog. These callbacks do not go into serialized island configuration; existing
form fields and server-managed relation selectors retain their contracts.

## Disclosure actions

`Button` and `IconButton` accept optional `expanded` and `controls` props for an action that shows or
hides a region, such as a row's inline editor. They render `aria-expanded` and `aria-controls`; the
application still owns the open state and the region's id. Omitting both keeps the previous markup.

## Inventory contract

The inventory is derived from the public and compatibility entry points and is not committed:
`npm run build` and `npm run check` write it to
`packages/design-system/src/catalogue/inventory.generated.{ts,json}` (ignored by Git), and the package
publishes it as `@ketvietlab/design-system/catalogue/inventory.json`. It counts tests, consumers and CSS
lines, so a committed copy changed on almost every branch and made them conflict.
`npm run design:inventory` writes it on its own; `npm run design:inventory:check` fails when a public or
compatibility export has no policy entry. The commit hook and the verification pipeline run that check.

Classification policy lives in
`packages/design-system/src/catalogue/inventory-policy.json`. A source module must have an owner,
decision, target, wave, and gap task before its exports can enter the registry. Planned components use
the same vocabulary before implementation starts.

The decisions mean:

- **Keep** preserves a public contract as-is.
- **Refactor** changes source ownership while preserving the public contract.
- **Promote** moves a generic compatibility capability into the public package after evidence and tests.
- **Build** introduces a missing domain-neutral component.
- **Recipe** documents a composition without creating another full-page pattern.
- **Domain** stays in KetSuite or an optional domain kit.
- **Defer** requires more consumer or performance evidence before a package boundary is chosen.

The inventory is evidence, not an automatic promotion mechanism. A compatibility capability still needs
independent consumers or a canonical dependency reason, domain-neutral props, an SSR fallback, states,
accessibility behavior, specimens, and tests.

## Source and catalogue governance

Wave 1 gives every public component family a directory entry point. The root package remains the only
application import path; the former source files are temporary internal forwards so repository code can
migrate mechanically without changing the published API or `data-ui` markup.

The catalogue has three separate responsibilities:

- `catalogue/registry.ts` maps every public component to its owner, directory, maturity, states, group,
  and specimen.
- `catalogue/groups.ts` adds owner, maturity, and state coverage to documentation groups.
- `catalogue/specimens.tsx` contains rendered examples, separate from the page renderer and navigation.

Run `npm run design:governance:check` to enforce public-export coverage, unique registrations, valid
component directories, specimen references, unique hook declarations, selector ownership, and the ban
on unsupported package deep imports. This check is part of `npm run verify`.

## CSS delivery

Component source owns its selectors. The package continues to publish one ordered production stylesheet
so applications do not have to reconstruct cascade order. As components move into per-component
directories, their CSS moves with them and the aggregate entry remains compatible.

The public cascade is `ket.reset`, `ket.theme`, `ket.app`, then `ket.user`.
Visual and compatibility ownership rules live in the skill.

### SearchFilter and KetTable

SearchFilter owns its popup geometry. The panel anchors to the search bar, fits its container, and
switches from stacked sections to three columns using the component's container query. Consumers
must not compensate with sidebar-width calculations or raise the entire application main layer.
`size: 'compact'` changes the bar density. `maxGroupBy` optionally limits grouping depth while leaving
removal and reordering available. The added grouping labels are optional for existing consumers.

KetTable supports two delivery modes through the same public `createKetTableView` contract:

- **RPC:** supply `manager` for client-driven sorting, paging and group loading.
- **URL-driven:** supply server-rendered rows and groups, column `sortHref`, and group `href`/`open`.
  Nested group expansion is explicit at every depth. Group `pager` accepts `label`, `prev` and `next`.
  `page` and `sort` seed the current state. `pager: false` leaves paging to the existing page toolbar;
  otherwise `pager: { prev, next }` renders native links (page size comes from `manager.pageSize`,
  default 50). Native navigation preserves bookmarks, server permissions and record-modal links.

Both modes share row selection and external bulk forms. The primary `kt-row-link` has
`data-primary="true"`; its hit area spans the row while checkboxes and cell controls remain separate.
An empty grouped result uses the same empty-state contract as a flat result.

`ListChrome.filterMenus` accepts native `Menu` choices and `DateRangePicker` with
`variant="filter"`. Its group fits the available width and wraps inside the opened
phone disclosure. Use `FormGrid` for a sized Section form rather than this toolbar
slot. Measure each label and control as well as document/table overflow: a collapsed
input can remain inside a page that has no horizontal overflow.
CSR updates to saved DateRangePicker boundary attributes synchronize the read-only
display, including Back/Forward, without emitting another filtering decision. The
shared runtime disconnects its attribute observer on removal or disposal.

All `ListPage` consumers preserve navigation context for same-path GET controls. SearchFilter's
`{ href }` apply result uses the backend shell's shared fragment navigation: filtering, grouping,
clearing and selecting favorites no longer reload the document. The shell updates the results,
toolbar and URL together, then focuses the search input (desktop) or filter trigger (mobile).
Back/Forward re-renders the corresponding server state. This covers native/static `KetTable`
adapters and island-backed tables without duplicating domain queries in the browser.

Full-page collections are client islands over one paged read (see "Collections are client islands"
in `@ketvietlab/design-system`): the server renders the frame and a loading state from the URL, and the
browser reads one page of one query, with its facet counts, through the function transport. The
fragment navigation above is the compatibility path for server-rendered lists that have not moved yet;
a new list does not use it, and an existing one moves when it is next changed. Permissions stay in the
read function. Inside a list island, KetTable is used in its server form (`columns[].cell`, `sortHref`)
rendered by the island; the RPC `manager` mode keeps its fixed-input client loading for embedded tables.

#### Shared row-list islands

A list whose route reads its whole authorised collection and narrows it on the server (a `RowListSpec`
from `backend/row-list.ts`, or a small pure answer function) uses KetSuite's shared collection islands
instead of writing its own: `backend.row-list-controls`, `backend.row-list` and `backend.row-list-footer`
(`ui/client/row-list-island.tsx`). People (`/admin/users`), roles (`/admin/roles`), access rules
(`/admin/access-policies`) and the identity deployment's people list (`/admin/users/directory`) use them.

- **Page.** The route renders the title, header actions and guide, and places
  `rowListIslands(props)` in `ListPage` `controls`, `body` and `footer`. Props name the `read` path, the
  list `href`, a `marker`, the `columns` (`sortKey` for a sortable one), the words (`rowListLabels`), the
  controls (`{ kind: 'bar', config }` from `rowListBar`, or `{ kind: 'search', facets }`), what a row
  opens (`{ kind: 'record', record, tab? }` for a record modal, `{ kind: 'page', path: '…/{id}…',
  returnPath? }` for a page whose `returnTo` names the row as `#row=<id>`), `createHref`, `chooseColumns`
  (`?columns=` through a `Menu`) and `pin`, the parameters another list on the same path differs by.
  `selection: { formId }` checks rows into a bulk form the page renders on the server (`ListPage`
  `selection`, `collectionSelection`); it posts natively. The check marks live in the list's store
  (KetTable `selectionState`), so a re-render keeps them, a new read clears them, the bar's "Clear
  selection" clears them, and the form's `returnTo` follows the list's URL.
- **Read.** `rowListReadRoute(read)` at `<list path>/read` takes a same-origin `POST { href }` (at most
  16KB) and answers `{ ok, value }` with `cache-control: no-store`; `read` returns `null` for a viewer who
  may not list (403, shown as denied) and `undefined` for a URL that is not the list (400). It checks the
  list's own function (`ctx.allows('user.listRoles')`) and calls it, so the list needs no `/_ket/fn`
  function or grant of its own. `rowListAnswer` applies the spec to the URL and answers
  `RowListAnswer`: the query as applied, the clamped page, rows as the table draws them, groups, the count
  behind each preset (ignoring its own group), every link the list shows (sort headers, pager, groups),
  `clear` (the URL less its query, keeping language, columns and anything else it carries) and the bar
  for the applied query. A list whose own read narrows by a parameter outside the spec (people by
  `company` or `role`, through `user.listUsers`) names it in `filters`: clearing drops it, and rows it
  leaves empty read as "nothing matches", not "nothing yet". `rowListMenu(target, param, label, options)`
  answers such a choice in `menus`; the controls draw each as a single-choice `Menu` whose items are
  links followed in place, and choosing the chosen item again drops it.
- **Navigation.** Fragment navigation mounts a page's islands before it writes the new URL, so an island
  adopts `location` only when it is the list (same path, no `record`, pinned parameters equal) and
  otherwise starts from its `href` prop. The search field shows the query in force after a link (clear
  filters) or Back. A row anchor survives Back; a trail link back to the list is a new visit, read
  again, and lands at the top.

The server form owns initial loading rows through `loading: { rows, lines? }` (1–100):
decorative skeletons, the normal columns and selection gutter, disabled checkboxes,
and no record or sort links. Use `busy` for a delayed refresh with retained rows.
Client presenters may supply `selectionState: { ids, anchor?, onChange }` so a pure
table render preserves page-local selection and Shift selection. The callback stays
in the client. Clear selection uses the associated native form reset; collections
also reset that selection when a new read replaces the page.
Use `bulkPresentation="replace"` to show page-selection commands in place of the query
toolbar; `selectedCount` controls the switch and cleared selection restores the query.
Filter menus in `ListChrome` wrap within the available canvas at desktop and mobile
widths; each control stays intact.
Danger badges own `--kv-badge-danger-text`, a theme-aware foreground from the Két
palette that meets small-text AA contrast over their tinted table and record surfaces.

Use `rowAnchorHref` / `rememberRowAnchor` / `takeRowAnchor` / `restoreRowAnchor` with
`KetTable.currentRow` when a collection opens a record page. On a plain click the
runtime remembers the row's viewport top and table horizontal scroll in history,
and adds measured `top` / `left` coordinates to the native link's `returnTo` fragment.
Back and the record header restore the same row position and focus after the CSR
read renders the rows. Unmeasured shared links centre the row. Missing rows are
announced; changed queries clear the anchor. Position travels on the URL, without storage.

For a custom shell, listen for `ket:search-filter-navigate` on `document`. Its exported
`SearchFilterNavigateDetail` contains the filter `id`, `href`, cancellation `signal` and
`respondWith(promise)` callback. Supply the navigation promise synchronously. A failed navigation
rolls back chips to the displayed list; retryable failures retain the exact attempted draft. Without
a handler the component retains native navigation, and the legacy `{ html, href }` response remains
supported. A new filter attempt aborts its preceding navigation request.

`locale` controls formatted cells. Currency cells and `FormattedMoney` accept decimal strings without
coercing them through a floating-point number, preserving database precision.

Custom cells register through `KetTableExtensions` in one shared SSR/client adapter, not through
callbacks serialized in island props. KetSuite's `thumbnail-label` renderer intentionally reuses the
existing backend thumbnail compatibility primitive pending that primitive's public promotion.

The public `KetTable<Row>` server component renders through this same grid engine. Use it when a
URL-owned collection has semantic cell callbacks, record links or inline command forms. Its
`KetTableServerProps<Row>` accepts `columns[].cell`, rows, recursive groups, sort state, caption,
responsive mode and external-form selection. These callbacks execute only on the server; they never
cross an island JSON boundary. Native checkboxes submit `fieldName.id=1` to the supplied form.
`rowLink: false` retains keyboard row navigation when the first cell already contains a link.
KetSuite's `collectionTable` adapts its existing column/selection metadata to that public component;
the legacy column visibility menu remains an explicit compatibility slot until its own promotion.

The `listChrome`/`pagerBar` adapter accepts `Pager.totalLabel` for a localized or
capped display count such as `10,000+`; `total` remains numeric and `prev`/`next`
come from the query result. `headerActions` replaces the automatic create link;
`headerActions={null}` suppresses it. `search.id` and `sort.id` associate controls
when several toolbars share a document. `searchCollectionRows` searches a complete
authorized catalogue through its explicit reader-visible-field callback; paged
collections retain their server-side query implementation.

Native `Field.readOnly` text/date/number values remain selectable and submitted;
disabled controls do not submit. Selects and choice controls have no native read-only
state, so an application can pair a disabled control with a hidden submitted value.
`min`/`max` preserve numeric/date bounds, and checkbox-group requirements belong to
group validation rather than making every option required.

For an existing RecordWorkspace integration, `RecordForm.submitPlacement="external"`
omits the local submit row; a controller button associated through its native `form`
attribute submits and validates that form. `ModalSheet mode="embedded"` renders a
specimen, while active route modals require the shared focus/history runtime.

The collection adapter exposes `frame.chrome.create`, `headerActions`, `actions`
and `controls`; the [skill](https://github.com/ketvietlab/ketjs/tree/develop/skills/ket-design-system)
defines their composition. Example:

```tsx
// File: packages/ketsuite/src/modules/product_backend/screens/list.tsx
<ListPage
  variant="operational"
  frame={frame} // chrome.create contains the authorized { label, path }, if any
  title={title}
  controls={collectionControls(_, title, frame)}
  actions={collectionActions(_, frame)}
  body={collectionTable(_, table)}
/>
```

### Record and workspace composition

Wave 5 adds description lists, people, avatar groups, status, formatted values, record summaries,
actions, neutral rails, activity, audit, attachments, and media. Applications provide already-
authorized and already-redacted results; storage URLs, uploads, deletions, queries, and permission
decisions stay outside the renderers. Activity and media families cover loading, empty, error, and
redacted outcomes without inventing domain behavior.

`EmptyState` is the single empty outcome for lists, record tables, activity, media and dashboard
blocks. It owns its frame and size (a dashed placeholder panel with a minimum height of 15rem and a
decorative illustration), so every region shows the same state; consumers neither wrap nor resize
it. Pass `visual` to say why the region is empty: `start` for first use, `search` when filters match
nothing, `done` for a cleared queue, `locked` for a region the reader may not see, or the default
`empty`. See the `empty-visuals` catalogue specimen and the README section "Empty states and long
content".

The catalogue documents worklist, analytical list, settings, master-detail, board, schedule, and
timeline recipes by composing `ListPage`, `RecordPage`, or `WorkspacePage`. These are slot recipes,
not additional page-pattern exports. Canvas recipes are reserved for spatial work and keep their own
horizontal overflow contract on narrow screens.

`Stack({ divided: true })` owns the 1px `--kv-panel-border` boundary between
peer groups and its gap on both sides. Flattening a child Disclosure or Surface
preserves that parent boundary, including in flat presentation. See specimen
`peer-section-dividers` and `test/design-system-peer-sections.test.tsx`.

## JavaScript delivery

Public renderers are pure SSR. Native links, forms, disclosure elements, and URL-owned state must remain
useful without JavaScript.

Browser behavior has two explicit delivery paths:

- Document-wide behavior owns shared dismissal, focus restoration, table selection synchronization, and
  other behavior that applies to existing server-rendered markup.
- Typed islands own stateful widgets such as autocomplete, anchored positioning, charts, and future
  virtualization. An island receives serializable props and has an explicit mount and cleanup lifetime.

The documentation and design-system roots are not hydrated as one client application. A component may
not create a private runtime merely to support its catalogue specimen.

### Interaction runtime

Wave 2 adds `Menu`, `ActionMenu`, `Popover`, `Tooltip`, `Dialog`, `ConfirmDialog`, `ToastRegion`,
`Toast`, `Spinner`, and `Skeleton`. Their state stays explicit in renderer props and URLs. Menus use
native disclosure, actions remain links or native form submissions, tooltip content is text-only, and
dialogs always have an accessible name and close path.

`attachDesignSystemInteractions(root)` is the optional document adapter. It owns Escape handling,
modal focus containment and restoration, background inertness, menu focus restoration, and collision-
aware popover positioning. It returns cleanup and does not own business state. The catalogue loads the
same adapter from `runtime/auto.js`, so specimens exercise the production behavior rather than a private
documentation runtime.

Without JavaScript, menu disclosure still works, action links navigate, form commands submit, and
controlled overlay close/open URLs remain usable. Applications decide when an overlay exists and own
unsaved-change policy; the adapter only enforces browser mechanics around the rendered state.

### Typed forms and pickers

Wave 3 keeps `Field` compatibility while separating its native control renderer and adding typed scalar,
selection, combobox, civil date/time, upload, and relation-picker APIs. A visual error can be supplied
directly or resolved from a `{ path, message }` issue list; validation remains an application concern and
rejected submissions can render the original text unchanged.

Combobox query, open state, result set, and selected values are controlled. `RelationPicker` receives
permission-filtered records and mapping functions; it never queries data or decides permissions. Date
values stay as civil `YYYY-MM-DD` text, and local date-time values are not implicitly converted through
UTC. File controls use the native input for submission while the application owns transport, storage,
limits, and authorization. Every control keeps the left-label/right-control form layout at narrow widths.

### Data operations

Wave 4 adds composable search, filters, applied filters, sorting, saved views, view settings, resource
lists, bounded data grids, trees, tree grids, and inline editing. `withQueryState` updates named URL keys
while preserving unrelated search state. Saved-view renderers carry version tokens but do not read or
write persistence, and inline edit keeps the rejected input and a native form submission path.

`ResourceList` gives each row one keyboard destination. `DataGrid` supports explicit column order,
visibility, pinning, and density, and caps rendered rows (500 by default) instead of rendering an
unbounded dataset. Use `Tree` for navigation hierarchy; use `TreeGrid` only when the hierarchy has
independently useful tabular columns. Every large or spatial surface owns its local overflow on narrow
screens.

## Maturity and compatibility

The registry uses `planned`, `stable`, `compatibility`, and `deprecated` maturity states. Planned
components are not package exports. Stable components are available through the root package entry.
Compatibility and deprecated entries remain visible until their replacement has shipped and downstream
consumers have migrated.

Do not add category subpaths while root exports remain manageable. The current public subpaths are for
the contract, catalogue, and styles. Source directories are ownership boundaries, not consumer import
paths.

## Release readiness

`npm run design:release:check` requires a current zero-planned inventory, aligned workspace/package
versions, deprecation metadata, migration notes, rollback instructions, and an explicit classification
for optional/deferred capabilities. On feature branches it also rejects newly added `FormPage`,
`DashboardPage`, or `BoardPage` consumers outside the compatibility layer.

This check establishes release readiness; it does not publish. Publication must run from a commit
reachable from `master`. Private Két Việt pinning, cohort migrations, zero-consumer deletion, and rollback
evidence follow the released exact SHA.

Public operational `ListPage.actionsPlacement="header"` places `actions` in the `list-page-tools` subgroup beside `headerActions`, without a separate action row. The KétSuite wrapper selects this placement for every operational list. `actionsHidden` hides only the tools subgroup in this mode, preserving the primary action and external form associations. Bulk-only tools initially stay hidden, including when extensions render empty fragments. The client follows each form's enabled row checkboxes and KetTable island persisted selection inputs. Clearing selection closes that form's menu and hides its tools when no other commands remain. The public component retains its default body placement for compatibility. Complete inline creation/configuration forms belong in the body above the table, not in the header tools.

`ReorderList` owns ordered editable row layout, drag handles, add/remove and accessible move controls. It emits the ordered stable ids as JSON through its hidden native field and a bubbling `change` event; its controlled parent supplies updated row content. The record-modal runtime captures textual drafts before consuming this field into view state. `RecordModalForm.body` composes the editor inside the single submission form; `dirty` keeps structural and retained edits subject to the existing close guard.

`SearchFilterConfig.capabilities` can disable `groupBy`, `favorites`, or `customFilters` for a consumer
that does not support those operations. Omitted flags enable sections that have usable content: grouping
requires options; favorites require existing entries, a save function, or `favoriteHref`. Explicit
`false` always hides the section. The component owns `search-filter-columns[data-columns]` and fits the
panel to its supported sections. Product attributes reuse this compact SearchFilter island via
`frame.chrome.searchContent`, with URL-backed display-type and variant-policy facets; there is no legacy
search-menu fallback.

`SearchFilterConfig.applyOnInput` applies typed text after a short pause (Enter applies at once) instead
of waiting for a suggestion; the text stays in the field and no query chip is created. Collections that
sort through their table headers and apply filters as they change set it so no step waits for an apply
button. See the design-system README, section "Expanded SearchFilter".

A GET filter form outside SearchFilter (a record page's line filter, a forecast's product and warehouse
pickers) uses `RecordForm({ method: 'get', applyOnInput: true })`: the shared runtime submits a chosen
option at once and typed text after a 400 ms pause, Enter still submits at once through a hidden default
button, and the typed field keeps focus whether the submit reloads the page or an island redraws the form. Such a form has no visible
submit button; a cancel link, when given, remains.

SearchFilter uses separate Filters, Group by, and Favorites triggers by default for every consumer.
`search-filter-toggle` remains the single filters trigger; nested options keep `disclosure-summary` and
`menu-item`. Applied `search-filter-facet` chips live in a separate row, including ordered groups. Their
existing `data-type` distinguishes `filter`, `field`, `favorite`, and `groupBy`; count tests should
select the kinds they mean. `search-filter-section-toggle[data-section]` opens a desktop section;
`search-filter-columns[data-panel]` selects that section. Triggers and panels have names matching their
section. Below 641px, only the filters trigger is visible and opens a native modal dialog
(`search-filter-sheet`) containing the shared client `ModalSheet` with `dialogSemantics="parent"` so the
native ancestor owns the single accessible dialog role. Opening focuses the visible close button; the
client backdrop is hidden from the accessibility tree and tab order. Native modal focus containment,
backdrop/close buttons and focus return are owned by the island. Escape closes the nearest open nested
disclosure and focuses its summary, then closes an open favorite form and focuses its toggle, before
a subsequent Escape closes the panel or sheet. Closing the menu resets the inline favorite form.
`search-filter-empty` owns the sentence-case saved-search empty message; `search-filter-icon` and
`search-filter-clear` also belong to this component. Consumers must not override their descendants.

Clear filters preserves the keyword and grouping, removing filter rules/presets and the active favorite.
The shared apply handler removes the `favorite` query parameter; an explicit empty `q` prevents a
cleared list from automatically reloading its default favorite. Other navigation parameters remain
screen-owned. `SearchFilterLabels.operatorLabels`, `clearFilters`, `close`, `favoriteCancel`,
`favoriteError`, `valueFrom`, and `valueTo` are optional translated labels with English defaults.
KétSuite supplies Vietnamese and English; downstream consumers that construct labels directly must
translate the new labels during their release-pin update. `CustomFilterField.choices` supplies
value/label pairs for selection and reference editors. KétSuite maps declared spec choices and can
supply permission-checked `fieldChoices`; product uses its existing category/unit API results.
Number/date/datetime use typed controls, ranges have two inputs, and valueless operators have none.

`favoriteHref` links to an existing screen-owned form; product keeps that route modal inside
`backend.content` so fragment navigation can open and close it. Without it, the local save form is
created below `favorite-save-toggle` only after the reader requests it. This trigger is not a menu
selection and keeps the desktop panel open. Opening focuses the name; cancellation and successful saving
return focus to the trigger while the component remains mounted. API errors in favorite operations use
`favoriteError`, independently of filter-application errors, and never expose raw server diagnostics.

Migration: no module opt-in is required; existing capability flags, hooks and apply payloads are
retained. Rollback the SearchFilter change as a unit (component, labels, shared URL handler, inventory
and tests) if a downstream consumer fails its interaction checks. The product-only density/header branch
is independent.


### Application topbar and compact lists

Agent integration guidance lives in `skills/ket-design-system/references/shell.md`:
shell ownership, SSR/fragment lifetime, app rail, Search/Collapse, settings layering,
screen guidance and deployment-scoped verification.

KétSuite uses compact density by default: 40px desktop rows, sentence-case column headings, and
smaller operational list headers. Mobile selection targets remain at least 44px. Tables retain all
columns and scroll horizontally; the scroll region is keyboard focusable. Classifications use plain
`Text`, with `tone="muted"` for secondary values; reserve `Badge` for lifecycle states and exceptions.
`MediaLabel` renders a 24px thumbnail only when present or explicitly reserved. Product lists reserve
image space across a page only when at least one visible record has an image.

`AppShell` requires an `applications` configuration: translated navigation and
new-tab labels, optional `helpLabel` and `settings: { id, label, items }`, `activeId`, and items with `id`, `label`, Lucide `icon` and optional `href`. Without a destination, supply `unavailableLabel`; the icon exposes its status with `aria-disabled` and has no navigation action.
Its `AppSwitcher` is a 48px graphite rail to the left of the primary navigation,
with hover/focus names and an active indicator. Every enabled app link opens a new tab, except an item with `sameTab: true`: an app served inside this same shell, which reloads the current tab (`data-ket-reload`). When `helpLabel` is supplied, a question-mark footer button emits
`ket:screen-help-request` with `detail.trigger`; guide drawers and their content
are screen-owned through the public `HelpDrawer` contract below. Below it, the settings
gear opens a shared `Menu` on click/touch or keyboard, never hover. The menu opens
to the right, grows upwards and stays inside the viewport/drawer. Escape closes
the settings menu before closing mobile navigation. Hosts own its translated
entries and destinations; the demo uses placeholder entries.
On mobile it appears only when the application menu opens, inside the drawer's
focus boundary. The shell and rail remain SSR chrome during menu navigation.
KetSuite owns destination URLs. Backend frames and Website Studio use `suiteApplications` with the deployment's permission-filtered menu: Kinh doanh/Sales and Website open permitted routes; Phone opens the first permitted entry of the `phone` menu root in the same tab when a module supplies one, and its screens call `adminPage`/`frameOf` with `app: 'phone'` (the frame sets `Frame.app`, the rail and the menu) so the rail, sidebar name and sidebar menu follow it, rather than assembling a frame of their own; Accounting, Flow and Chat are coming soon without URLs. Accounting and the duplicate Website destination are hidden from the main menu; Website remains in the app rail. Administration links move into the rail's settings menu, and help is hidden until guides are ready. `placeholderApplications` remains a catalogue sample. Hosts can override actual entries through `Frame.applications`; browser consumers import the pure adapter from `@ketvietlab/ketsuite/ui/application-switcher`.

Consumer contract checks should load only the current deployment's composition and permitted menu, covering app availability, backend frames and Website bootstrap/shell integration. Use the same shared registry for every deployment without changing its Website preset; keep consumer-specific runners and module resolution in the consumer repository. Verify menu navigation on authenticated application routes with the KetJS document runtime and every placed island client available. A static shell fixture cannot prove fragment navigation: it has placeholder content and follows native links as full document loads. Navigation responses carry replaceable slots and omit `AppShell`; the outer SSR chrome remains mounted.

`AppShell.location` places `AppTopbar` with its `location` prop inside the main column: organisation context
on the left, compact search and all account/indicator/theme tools on the right. `AppBrand` lives in
the graphite app rail as a mark. The fixed 44px sidebar header names the current app,
with menu Search and desktop Collapse; root icon guides are centred on their icon slots.
The location strip is 48px high; no global bar spans both columns.
The optional `AppShell.topbar` remains available to other consumers. The launcher opens a native modal dialog
containing the existing GET search form; local list search remains visible beside its results. `NavigationToggle` can control `AppNavigation` with `externalTrigger`;
its `controls` names the rendered navigation ID plus `-drawer`. Navigation groups
with `exclusive: false` allow each branch to close independently, including Enter
activation; the default named accordion retains its open branch until another is chosen.
the shared runtime owns its mobile drawer, focus return and inert background. Ctrl/Cmd+K opens global search and focuses its input when no other dialog is open.
Escape, the close button and backdrop close search and return focus to its launcher without clearing
the draft. The modal frame stays in an inert template until opened; its search form remains
inside the closed native dialog so fragment navigation can preserve its draft. Mobile uses an icon launcher the height of the other topbar controls and a full-screen dialog. The optional
`search.triggerLabel`, `search.closeLabel` and `search.id` localize the launcher and close action and
distinguish multiple catalogue shells. A native link and noscript form preserve search without JavaScript. KétSuite retains the `backend.global-topbar` fragment slot for navigation compatibility, now inside
the main column. KétSuite no longer displays breadcrumbs. A shell with `location` hides
the nested page identity context; standalone pages keep their context. The sidebar footer tools
move into this strip, including extension items and the account menu. Account menus open downward.

`/admin/search` requires a session and searches permitted menus, products and partners. Optional record
providers call the same permission-checked, company-scoped functions as their lists, with eight results
per provider and native detail links. Empty queries never enumerate records. Search terms are bounded
to 200 characters. Search is server rendered and works without JavaScript.

`searchFilterRuleLabel` is shared by server and island labels. Group intervals are localized, including
Day/Week/Month/Quarter/Year. KetTable errors use the consumer's localized `loadError`, never raw server
exception messages. Legacy sidebar search hooks are retired; global search uses AppTopbar.
Current menu filtering is the separate AppNavigation.tools Search contract.

LiveDoc's [presentation and formatting contract](./livedoc.md) defines its native
top/floating toolbar and framed/plain surface. Flow document pages opt into
floating/plain through their public adapter; other consumers keep the defaults.

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

### Exact values in adaptive metric cards

`CardGrid` with `minimum="wide"` adapts currency cards to the available canvas width, including the sidebar. `Metric` wraps long labels and exact values inside its text column. Do not truncate amounts or add consumer CSS. See `metric-exact-long-value` and the focused Account producer contracts.

### Sidebar island slot height

AppShell gives its sidebar's only child the available block size, including a disposable island wrapper. Navigation keeps its viewport geometry and internal scrolling; consumers do not patch sidebar descendants. Producer CSS check/mutation and Account browser geometry cover this contract. Account's breadcrumb-free canvas is an explicit user choice and still exposes a separate list-return link.

## Shared screen guidance and Mermaid theme

Render one `HelpDrawer` in the screen content slot, with translated `label`,
`title`, `closeLabel` and body. It is a 512px modeless right panel on desktop,
fullscreen native modal on mobile. The shell question-mark button opens it and
shows its active state. Navigation closes before mobile help opens; closing
restores focus and scrolling. The fixed header owns the title and close button;
the body owns its scrolling and 24px desktop/16px mobile inset. New screen fragments
own their own guide; keep the shell and app rail outside those fragments.

Compose its body with `MarkdownContent`: a source string, a GFM-compatible lexer,
localized diagram/source/loading/error/table labels and appropriate heading offset.
The SSR renderer escapes raw HTML, validates links/images, supports tables and
code, and keeps Mermaid source as progressive fallback. Wide tables and diagrams
scroll locally, preserving legible diagram text instead of shrinking it to fit.

All ecosystem Mermaid diagrams use the DS runtime's `createMermaidTheme` with
`readMermaidPalette`, plus the shared `configureMermaidLoader`/interaction lifetime.
The host supplies a pinned, lazy Mermaid bundle; DS owns theme and rendering policy.
The interface font (`--kv-font-sans`, KÉT Sans) at 13px, 1.25px connectors, 6px node corners and resolved semantic DS colors form
the common style in both themes. Use `kv-accent`, `kv-positive`, `kv-warning` and
`kv-danger` classes to convey state. Notes use the warning surface; diagram families
share explicit text, surface, border, connector and chart colors. Theme changes
rerender SVGs. Configuration/style directives in content cannot override this
standard. Rendering uses Mermaid's base theme with strict security and disabled
HTML labels; see [Mermaid's official theme API](https://mermaid.js.org/config/theming).

The DS remains dependent only on `ketjs-view`; apps provide parser/renderer adapters.
The catalogue pins marked 18.1.0 and Mermaid 12.1.0, served locally. Inspect the
connected drawer at `/demo2` and flowchart, sequence, state, ER and pie specimens
plus invalid source at `/help-theme`. See the package README for the loader example.
