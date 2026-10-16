# Flow compatibility

Flow UI is an existing compact work-management kit, scoped under data-flow-ui.
Flow owns its UI kit and inherits Két's design DNA. User decision (2026-10-08):
changes inside flow-ui are not limited by its current dimensions or Suite page/form
patterns. Evolve Flow components, layout and interactions in their owning package;
document and measure each changed contract. The dimensions below are the current
baseline, not an immutable limit on Flow UI development.
Keep its JavaScript/JSDoc and public dependency constraints in the package AGENTS.md.

- Render through `@ketvietlab/ketjs-view` and share primitives only through supported exports.

- Load `@ketvietlab/design-system/tokens.css`. Colors, typography, spacing, radius, shadow, focus and motion MUST use `--kv-*` tokens, directly or through `--flow-*` aliases. Do not create a Flow palette, font stack, type scale or alternate dark palette. Only explicitly documented density dimensions may differ.

- All component exports start with `Flow`. All owned hooks use `data-flow`, product aliases use `--flow-`, and all CSS selectors live under `[data-flow-ui]`. No global resets or automatic document-wide runtime.

- Components own their markup and styling. Consumers compose exports and pass state/callbacks; they do not recreate component DOM or override private descendants.

- Hard-to-undo questions use `FlowConfirmDialog`: a small centred native alertdialog at every width, with associated title/explanation and safe Cancel/Escape behavior. The runtime restores focus when native or route-owned dialogs close; direct links fall back to the background page heading. Product controllers own unsaved-form baselines and mutations, never the UI package.

- Density is a Flow contract: 28px small control, 32px normal control, 36px compact row; touch contexts use at least 44px controls. Do not shrink Suite components using external CSS.

- Follow the Flow atlas reading hierarchy: main task text and navigation use `--kv-text-md` (14px), controls use `--kv-text-sm` (13px), metadata uses `--kv-text-xs` (12px). Compact spacing must not mean tiny text.

- Use `FlowShell`: 240px sidebar, 44px header, roughly 38px toolbar, responsive, centered work content with its own scroll area and a content-specific maximum width. Keep workspace titles in the header; do not add a large hero or project banner above work lists. Library/editorial pages may use a restrained introduction.

- Settings rows: a settings page is `FlowStack({ divided: true })` of nested `FlowSection({ inset: "none", title, description, actions })` rows, control and save on the right; actions wrap under the heading when it would get less than 16rem. Extensions add rows through `settingsSection(key, scope)`.
- Identity colour: `FlowAvatar` derives one of five chart hues from the name; never use status colours for people.
- Layout inset ownership: page-level FlowSection/FlowToolbar/FlowMetrics own the page gutter; pass `inset: "none"` when nesting them inside an already padded section or dialog. FlowSection supplies sibling gaps; do not stack page padding to separate groups.

- Shared gutter: `--flow-page-gutter` references `--kv-layout-gap` (12px desktop,
  8px below 768px). Standalone table groups use that same inset once; nested groups
  have no additional inset. Mobile shell widths up to 760px use 44px control targets
  even with a fine pointer; editable form values below 768px use the shared mobile
  input size (16px) to preserve readability and avoid browser focus zoom.
  Standalone checkboxes use `FlowCheckbox.target: 'standalone'`: a native label
  owns the 24px desktop / 44px mobile hit area around the smaller visible box.
  `FlowCheckboxField` owns a clickable form row; do not nest two labels. Task-table
  select columns reserve the hit area plus cell padding, and label gestures are
  excluded from drag initiation.
- All native dialogs keep header/footer visible and scroll only their body. Long
  headings wrap without pushing the close action out of the viewport. Form decision
  actions use the same normal size; desktop toolbar commands may stay compact.
- Task-table geometry is opt-in through `FlowTable.layout: 'tasks'`. Named Flow
  dimensions reserve columns for status, priority, assignee and due-date controls;
  generic six-column collections do not inherit task sizing. The table scroll region
  has a label and keyboard focus so narrow viewports can reach off-screen columns.
  An ungrouped collection uses `FlowStack.inset: 'page'` as its single horizontal
  gutter owner; its pagination toolbar uses `inset: 'none'`. A grouped collection
  keeps the group's gutter and uses the default flush Stack inside it.

- List spacing ownership: default `FlowListItem` uses `variant: "auto"`. A standalone item stays flush with its parent; a direct `FlowList` child receives list padding and separators from the list. Do not use inset rows as generic notices. Use `FlowSection.description` for subtitle/context attached to the heading, and put a collection's create action in that section's header.

- Content width has exactly two presets: `standard` 1200px and `wide` 1600px. Keep neighboring tabs in a navigation family on the same preset; do not introduce route-specific caps. User-requested exception: Board, Calendar, Timeline and document reading/editing surfaces use `full` (no maximum width). Board and scheduling views preserve normal page gutters; document shells span the work area while retaining their inner reading column. Dialog and inner reading-column dimensions are separate from the page container.

- Reuse a public design-system primitive when it fits Flow. Flow-specific component
  mechanics and geometry may evolve in flow-ui; sharing a primitive is a design
  choice, not a requirement to force Flow into an ERP composition.

Preserve existing product behavior and verify each changed contract. FlowClient
composes Flow UI; product consumers do not recreate these component internals or
override their CSS.

Task cards may receive `statusHint` for workflow constraints before a move. The
public card owns metadata type and internal spacing; the product owns the reason
and transition policy. Keep within-column ordering available when only the status
transition is locked, and retain native task opening as the recovery path.

## Existing form and toolbar roles

Form hierarchy: field labels use the existing 12px metadata token, muted text and medium weight; input/select/textarea values use the 14px body token, primary text and normal weight. Placeholder text is muted and inherits normal weight. The field wrapper never supplies bold type to editable values.

Filter/action toolbars separate content with spacing, without a full-width bottom rule. Page toolbars use 8px vertical padding; nested `inset:"none"` toolbars rely on their section/stack gap. Metrics and task-card metadata also avoid decorative horizontal rules. Keep selected navigation-tab underlines and structural boundaries for tables, modal headers, editor tools and distinct panels.

## Global search entry (user decision, 2026-10-09)

FlowNavigation owns the sidebar search launcher; the topbar has no product search field.
The launcher opens one viewport-centered native FlowSpotlight dialog with the only
editable global search input. Keep Meta/Ctrl+K, Escape/backdrop and focus return,
loading, empty and retryable error states. Search preserves the server's tenant and
permission boundaries; Core and Pro compose this same public contract.

Spotlight owns `--flow-spotlight-height: 34rem` (544px), clamped by viewport clearance.
Keep that geometry through loading/results/empty/error; only its internal viewport
scrolls. Result rendering must not recenter the dialog. Escape closes a nonempty
search immediately, Retry returns focus to the input, and dismissal returns focus
to the sidebar launcher.

Flow's sidebar, topbar and routed page tabs are SSR chrome outside the primary
data island. Enhance existing DOM with event bindings; do not replace chrome after
a data read. Same-workspace menu/tab navigation preserves the frame/sidebar and
reconciles server-rendered header/tab fragments through KetJS's published runtime.
Only primary data renders through CSR. Direct GET/refresh and context/language
boundaries retain full SSR navigation. Frame geometry/current-link state may be
synchronized through the public UI runtime without recreating chrome markup.
Record dialogs and data-widget interactions remain disposable client runtimes.
Server field errors use `attachFlowUI(root).focusInvalid(form)` after the error
render and pending state settle. The runtime reveals ancestor disclosures and
compact record properties before focusing; consumers do not reconstruct panels
or dispatch synthetic native validation events.
Project profiles are durable page forms, not record dialogs (user decision,
2026-10-09). Use `FlowShell.contentMode: 'form'` with `FlowSetupForm.layout: 'page'`:
only fields scroll, inline feedback owns a reserved row above native associated
actions. SSR shell and project tabs keep their layout; consumers own authorization,
draft guards and return destinations. See flow-ui README for the public API.
An authorized chrome DTO contains navigation/access metadata, never primary rows
or document content. FlowDocsShell.bodyOnly composes its data workspace into that
same frame instead of adding another sidebar/header/project tab bar.
Within one authorized document owner, selection retains the reading workspace,
tree disclosure/scroll and inspector while CSR data revalidates. Load an unknown
record inside the reading panel, not by replacing the whole document workspace.
Tenant/owner/access boundaries clear cached data; SSR authorization may remove
revoked document IDs immediately. Compare access metadata independently of JSON
key order. A failed read needs Retry; a denied read cannot retain private content.
