---
title: Manufacturing
description: Public manufacturing domain, stock integration, lifecycle, and extension boundary.
---

The public Manufacturing modules provide the smallest complete production workflow that can be used
without deployment-specific code. They cover bills of materials, work centers, operations,
manufacturing orders, component reservations, work orders, component consumption, and finished or
byproduct receipts.

## Module boundary

`manufacturing` owns domain models and functions. It has no dependency on backend routes or screens.
`manufacturing_backend` owns the trusted staff interface and depends on `manufacturing`. This follows
the same domain/backend boundary as Stock and Product; it is not a free-versus-paid split.

Both modules are public. Deployments that only need APIs, workers, or a custom interface can compose
`manufacturing` alone. Deployments that want the standard admin pages compose both modules.

Advanced policies remain deployment extensions. Examples include controlled BOM approval and
effectivity, count-to-weight conversion revisions, skill-based operator assignment, exclusive
operator claims, offline command replay, evidence ledgers, and enhanced lot genealogy. Such an
extension should depend on the public module instead of replacing its models or copying its stock
logic.

## Core records

| Record | Responsibility |
| --- | --- |
| `Bom`, `BomLine`, `Byproduct` | Define the expected inputs and outputs for a reference quantity. |
| `WorkCenter`, `Operation` | Define the ordered work and where it is performed. |
| `Production` | Own the manufacturing-order lifecycle and stock picking references. |
| `ProductionMove` | Classify linked stock moves as component, finished, or byproduct. |
| `WorkOrder` | Track operation execution independently from inventory completion. |

Quantities on BOM lines, operations, and byproducts are copied or scaled into the production order
at confirmation. Later edits to a BOM do not mutate an already confirmed order.

## Lifecycle and stock contract

A production order moves through `draft`, `confirmed`, `in_progress`, `to_close`, and `done`.
Cancellation is available before completion. Confirmation creates the raw-material and output
pickings, creates their moves, and attempts to reserve components. A shortage is reported explicitly;
completion fails closed until every component is allocated.

Work orders must be complete before the production order can close. Completion transfers component
stock into the production location and finished or byproduct stock into the destination location.
Tracked products require valid lot or serial output commands. Multiple output lots are supported for
one finished move.

Stock is the authority for locations, lots, moves, reservations, quants, routing, and transfer
completion. Manufacturing calls the exported Stock function specifications so a deployment extension
keeps the same transaction and effect contracts.

## Public extension surface

The package entry point exports `manufacturingFunctionSpecs` and `stockFunctionSpecs`. An extension
can wrap a public function to add approval, evidence, assignment, or compliance checks, then delegate
the inventory mutation to the public handler. The wrapper must include the delegated function's
effects in its own declared effects.

Stock's named handlers and descriptors are organized under `modules/stock/functions/` by products,
warehouses, locations, picking types, lots, pickings, moves, inventory, and availability. The registry
rejects duplicate keys; `stock/functions.ts` remains a compatibility export. Quant mutation and
reservation invariants live in `stock/stock-ledger.ts`, and batched transfer projections live in
`stock/queries/picking-views.ts`. Stock's own picking commands use the same exported reservation and
completion specs for transactional composition. Consumers must include the current effects: quant
writers also write the Product template revision to serialize against tracking and cost edits.

Prefer additive models and optional fields on public records. Keep the standard lifecycle valid when
the extension is absent, and add integration tests that compose the public and extension modules
together. This preserves a usable public application while allowing private deployments to enforce
stricter policies.

## Standard backend

The public backend contributes Manufacturing navigation and pages for orders, BOMs, and work centers.
Its user-facing labels and validation messages are available in Vietnamese and English. The backend
uses public functions only, so replacing the interface does not require replacing the domain module.

### Work centers

Work centers are configuration, so their screen sits behind the settings gear (`admin.manufacturing`)
rather than on the sidebar. A work center has an upper-case code of at most ten letters, digits or
dashes, unique in the company; an optional `skill`, a free key a deployment names (`weigh`, `cook`,
`cut`, `pack`); a capacity above zero; and a whole, non-negative cost per hour. Refusals name the
field: `manufacturing.error.codeInvalid`, `codeTaken`, `capacityInvalid` and `moneyInvalid`.

`manufacturing.getWorkCenter` returns the center with its queue: open work orders, running and paused
first, then ready, then waiting, each by the order's scheduled start. `archiveWorkCenter` and
`restoreWorkCenter` need the `configure` bundle and are audited; an archived center keeps the
operations that name it but is not offered for new ones. A reader without `listWorkCenters` gets a
403 lock page; a reader without `saveWorkCenter` sees the list and queues without create or archive.

Workers hold the `work` bundle, which starts, pauses and finishes work orders without planning
authority (`operate`) or configuration.

### Bill of materials versions

Each version of a bill of materials is its own `Bom` row: `draft` → `review` → `active` → `archived`,
linked by `familyId` (the first version's id) and numbered by `version`. A BOM saved before versions
has no state and reads as active, so existing callers of `saveBom` keep working; `saveBom` with
`draft: true` starts a version that makes nothing until approved. Only a draft changes.

- `submitBom` needs a component and a reason; `approveBom` refuses whoever submitted
  (`manufacturing.error.sameReviewer`) and archives the version in use, which hands over the family
  code. `rejectBom` returns it to draft with a reason. `newBomVersion` copies a version into the next
  draft, or answers the draft already open. `archiveBom` takes any version but one in review.
- Orders confirmed on an older version keep the demand they were confirmed with: the moves are
  written at confirmation. New orders are offered active versions only.
- A component's demand is `productQty × (1 + lossPercent / 100) × order ÷ batch`, rounded to six
  decimals; `lossPercent` is 0–50. An operation with `timeMode: 'quantity'` scales its minutes by the
  order; `fixed`, and null as before, keeps them per order.
- `consumption` (`flexible`, `warning`, `strict`) is stored for the consumption policy of execution.
- Row refusals carry `params.line` (from 1). The backend page saves its settings and both KetGrids in
  one `saveBom` and words such a refusal as "grid, row N: reason".

`kit` stays a valid `type` for API callers, but the page creates normal BOMs only; exploding kits on
sale or delivery is not implemented.

### Production queue

`manufacturing.productionQueue` lists orders as the floor works them: in progress (and to close),
confirmed, drafts, then done and cancelled; within a state by `priority` (higher first, null is 0),
then scheduled start. Each open order carries `material`:

- `ready`: on-hand stock in internal locations covers what it still needs;
- `waiting`: it does not, but open receipts into stock from outside it cover the rest;
- `short`: neither does.

Confirmed and in-progress orders take stock (then receipts) in queue order, so a later order sees
what an earlier one left. A draft reads what the confirmed orders left and takes nothing, so two
drafts never compete for the same stock. `shortages` lists each short component with its need,
what is available and what is incoming, as exact decimal strings.

`saveProduction` may name a `productId` instead of a `bomId`; it then takes the product's version
in use and refuses a product without one (`manufacturing.error.noBom`). `cancelProduction` stores an
optional `reason` (the backend requires one) and refuses an order with output already booked.

### Recorded use

`manufacturing.consumeProduction` takes `components` as totals per product. Only the increase over
what is recorded moves: the order releases what it holds, the increase leaves the source location
(and the locations below it) for the production location in one done transfer
(`<order>:consume:<n>`), oldest-expiring lots first, the order's component demand shrinks by as
much, and the order holds again for what it still needs. The first record puts a confirmed order in
progress. Refusals, each naming the product: `consumeDecrease` (a total below what is recorded;
returning the excess is its own command), `consumeStrict` (a `strict` BOM used past its need) and
`consumeShort` (with what is `available`); any refusal moves nothing. `flexible` and `warning` BOMs
record past the need and answer `overused`.

`getConsumption` reads `need` (the demand recorded at confirmation, kept on the component link as
`demand`), `consumed` and `remaining` per component. Completion takes only what remains, so a
component used up early takes nothing more. Like completion, a record is not one transaction: the
stock commands open their own, and the availability check runs before any of them.

**Pieces on the use grid (#1880).** `manufacturingBackendWith({ countPieces })` names a function with
the stock count's contract (`{lines: [{id, productId, counted}]}` to `[{id, enabled, pieces}]`). The
order page then adds a **Pieces** column after **Needed**: the recorded use read back in pieces,
editable only on a component that counts in pieces. Typed pieces are posted as `pieces` beside the
component, and the deployment's `consumeProduction` converts them into the total on the server; a
deployment without such a wrapper never shows the column. Pieces are a way of entering use, never a
figure the order stores: the stock move keeps its own piece count.

Accounting entries for the use follow the stock valuation: an issue to the production location is a
`consumption` layer at the running average. With the company's stock accounting set it posts debit
`productionAccountId` (154) and credit the valuation account (156) in the stock journal. A batch of
output is a `production` layer that posts the reverse at its provisional cost (see below). Splitting
152/155 and the period cost close stay with P10.

### Output in batches and closing

`manufacturing.recordOutput` takes `quantity` and an optional `lotName` and books one batch: a done
transfer (`<order>:output:<n>`) from the production location to the destination, and for a
lot-tracked product a lot whose `ref` is the order name. An unnamed lot is named after the day
(`YYMMDD`), then `-2`, `-3` when that name is taken for the product; a serial-tracked product is
refused. The planned output shrinks by the batch, `quantityProduced` grows and the first batch puts
a confirmed order in progress.

`completeProduction` with `rest` closes an order whose output was recorded:

- `nothingMade` when no output is recorded; `workLeft` (with the open `operations` named) while a
  work order is neither done nor cancelled.
- Components whose recorded use is below `need × made / planned` are taken up to it (backflush)
  through `consumeProduction`, so the same refusals apply.
- The order's remaining component and output transfers are cancelled. By-products stay with the
  P8 scrap and by-product work.
- `backorder` with output short of the plan saves and confirms `<name>-01` (then `-02`…) for the
  rest, with `backorderOfId` pointing back; `close` marks the order `closedShort`. Reaching the plan
  closes plainly either way.

Without `rest`, completion keeps booking the whole plan at once, and refuses (field `rest`) once any
output is recorded, which would book it twice. The order page records batches in its finished goods
section, which also closes the order and asks what happens to the rest; the header's one-step
completion is offered only while nothing is recorded.

### Operations and assignment by skill

`manufacturing.OperatorSkill` records how well a person (`userId`, with the `name` the floor reads)
does a work-center `skill`, from 1 to 5. A `lead` is a floor lead. Level 2 (`OPERATOR_LEVEL`) is
enough to be given the work. `saveOperatorSkill` writes one row; level 0 keeps the person without the
skill. A work center without a skill can be given to anyone.

**Operator skills screen (#1931).** `/admin/manufacturing/skills`, behind the settings gear beside the
work centers, edits every row in one KetGrid: person, skill, level 0–5 and lead. The people offered
come from `listOperatorCandidates`: active members of the company who may run operations
(`manufacturing.startWorkOrder` among their effective grants; every member without a permission
catalogue). The skills offered are those the active work centers name. `saveOperatorSkills` saves
the whole grid in one transaction, with `removed` for saved rows to delete. The name always comes
from the user, never from the form. A person or skill no longer offered keeps the rows already
saved, but gets no new one. Any refused row (an unknown person or skill, a level outside 0–5, or a
second row for the same person and skill) saves nothing and is named by its row number. A saved row
keeps its person and skill; changing either means a new row. The screen and `saveOperatorSkills`
need `configure`; `listOperatorSkills` stays in `view`.

Confirming an order gives each operation of a skilled center a `WorkOrder.operatorId`, chosen in this
order:

1. The person whose level is closest to the one needed.
2. Then the person with the least open work. Work given out in the same pass counts, so one
   confirmation spreads its operations.
3. Then workers before leads.
4. Then by id.

When nobody is skilled enough the operation stays unassigned; the system does not guess.

- `assignWorkOrder {id, version, operatorId}` gives an open operation to someone skilled enough, or
  takes it back with `null`. Someone below the level is refused with `operatorSkill`.
- `startWorkOrder` makes whoever starts an unassigned operation its operator.
- `finishWorkOrder` takes `actualMinutes` (a whole number from 1 to 100,000; otherwise
  `minutesInvalid`) and a `note`. Typed minutes replace the clocked time; the page always asks for
  them. Finishing still readies the next pending operation.

`listWorkOrders` (filters: `state`, `workCenterId`, `operatorId`) orders the floor's operations:

- by state: in progress, paused, ready, pending, done;
- then by order priority, start, order name and sequence.

It leaves out draft orders and the open work of cancelled ones. `getWorkOrder` adds the people who
may be given the operation.

The backend lists operations at `/admin/manufacturing/work` ("Công đoạn"). Each operation's page:

- runs it by state: start, pause, resume, then finish with the minutes and a note;
- assigns it, for the holders of `assignWorkOrder` (the `operate` bundle), choosing only among
  people skilled enough.

A worker holding `view` and `work` runs operations but does not see the assignment form. Kiosk
screens per work center and multi-shift time logs are not part of this.

### Provisional and actual cost

Every batch `recordOutput` books enters stock at the order's provisional cost per unit, which is set
as the output move's `priceUnit`. One-step completion prices the finished move the same way.

The provisional cost is the sum, over components, of each component's demand kept at confirmation
times its running average now. A component with nothing held is priced at its catalogue cost. The sum
is divided by the order's quantity and rounded half up to the currency's minor unit.

`getProductionCost {id}` reads:

- `provisional`;
- `issued`, the value of the order's component and use transfers when they left;
- `produced`;
- `actual`, which is `(issued + labour) / produced` and is given only once the order is done;
- `labour`, `varianceHeld` and `varianceSold`, from settlement (below).

It sits in the `cost` bundle (`sensitive`, policy `manufacturing.sensitive-data`), apart from running
the floor. The order page shows the cost facts only to its holders. Commerce gives the bundle to the
production manager, the accountant and the tenant auditor; workers do not see prices.

### Overuse, returns, scrap, weighing and by-products

- **Overuse.** A `warning` BOM refuses a record past a component's need with `consumeWarning` until
  `consumeProduction` is called with `confirmOveruse: true`. Who confirmed is kept on the record
  (`ProductionMove.confirmedBy`). `flexible` records and says so; `strict` refuses.
- **Returns.** `returnComponents {id, components: [{productId, quantity}]}` brings unused components
  back from the production location to the order's source, at what the order was charged per unit
  (its issue lines' value over their quantity). It posts debit stock and credit work in progress.
  More than is in use is refused with `returnTooMuch` (with `held`). `getConsumption` reports
  `consumed` net of `returned`, plus `scrapped`. The actual cost counts issues less returns.
- **Scrap.** `scrapProduction {id, productId, quantity, reason}` takes the order's product (from its
  destination) or a component (from its source) to the company's production scrap location
  (`<company>:manufacturing:scrap`, made on first use). It is valued at the average cost and posts to
  cost of goods (632) like any stock scrap. A missing reason is `reasonRequired`, and another product
  is `scrapProduct`. Scrap stays out of the order's actual cost.
- **Weighing.** A BOM with `unitWeight` (kg per unit) and `weightTolerance` (%) has each
  `recordOutput` carry a `weight` within `quantity × unitWeight × (1 ± tolerance)`. Otherwise the
  record is refused with `weightOutOfRange` (`min`, `max`). The weight is kept on the output record.
- **By-products.** Closing an order with `rest` brings its by-products in at no cost: each planned
  quantity times the share of the plan made, in one done transfer, with a lot named after the order
  for a lot-tracked product.

The order page carries the confirmation box for a `warning` BOM, a "Đã trả" column in the use grid,
and a "Trả dư và phế phẩm" section for the holders of `operate`. It also asks for the batch weight
when the BOM weighs output. The BOM page edits the unit weight and tolerance.

### Runs, hand-over and the work-center list

- **Runs.** Each start of an operation opens a `WorkTimeLog` run for its operator.
  - Pausing, handing over and finishing close the run with the minutes typed (1–100,000, otherwise
    `minutesInvalid`), or the clock when none are given through the API. The page always asks.
  - An operation's `durationActual` is the sum of its runs, and `getWorkOrder` lists them.
- **Hand-over.** `takeWorkOrder {id, version, minutes?}` (bundle `work`) lets a skilled worker take an
  operation for themselves. `assignWorkOrder` (bundle `operate`) gives it to someone else, so a worker
  handing work to another is refused. Both close the running run and open the new operator's.
- **Loss.** `finishWorkOrder` takes a `loss` for the step, in the order's unit.
- **Last operation.** The order's last operation books finished goods from its own page through
  `recordOutput`, weighed when the BOM asks.
- **Work-center link.** `/admin/manufacturing/work?workcenter=<id>` redirects to the list with its own
  filter on that work center. The filter bar counts it ("Lọc 1") and clears it like any other, and
  the list reads at 390 px.

**Kiosk.** No separate kiosk screen. On a shared device the floor opens the work-center link and works
from the operation's page, which fits a phone. A quick-login kiosk would need a board pattern in the
design system and a PIN sign-in that the identity layer does not offer yet. It is tracked as its own
issue (#1943).

### Settlement at close and use against the BOM

Closing a recorded order (`completeProduction` with `rest`) settles its cost once:

1. **Labour.** When `saveCostSetting {labourAccountId}` names an account, each operation's actual
   minutes times its work center's `costPerHour` (rounded half up per operation) are posted to
   work in progress (`productionAccountId`) against that account, entry `manufacturing-labour:<id>`.
   With no labour account, nothing is charged.
2. **Difference.** Issued value plus labour, less what the output batches entered stock at, is what
   is still in work in progress.
3. **Share still held.** Of the produced quantity, the part still in internal or transit locations
   (never more than produced) takes its share of the difference, rounded half up. It revalues the
   last output receipt through the stock revaluation (`revaluationId` `manufacturing-settle:<id>`,
   account `production`), so the layer and the 156/154 entry follow the stock contract. A refused
   revaluation leaves the whole difference to the next step.
4. **The rest** goes to cost of goods sold (`cogsAccountId`) against work in progress, entry
   `manufacturing-variance:<id>`, reversed when the difference is negative.

Work in progress for the order ends at zero. The order keeps `labourCost`, `varianceHeld` and
`varianceSold`; the order page shows them with the other cost facts.

Splitting work in progress between raw-material and finished-goods accounts (152/155) waits on the
chief accountant's decision (#1860); until then settlement uses the single production account.

`consumptionVariance {productionId?}` lists, for every order running, waiting to close or done, each
component's expected use, actual use, difference and percentage. Expected use is the BOM demand, or
its produced share when the order closed short. Rows are sorted by percentage, largest overuse
first. It is a `read` function in the `view` bundle.

The **Use against BOM** screen (`/admin/manufacturing/consumption`, menu *Tiêu hao so định mức*)
shows that list with search, filters by order, component, difference and standing (over, on,
under), grouping, and rows that open their order. On a phone each row is a card with the order,
component and difference.


### Quality check, quarantine and production trace

A BOM may carry a pH range (`phMin`, `phMax`, both on the 0–14 scale, lower first; both or
neither). For a lot-tracked product with a range, every batch `recordOutput` books creates its lot
**quarantined** (lot history reason `qualityPending`) together with a pending
`manufacturing.QualityCheck`. A quarantined lot cannot be reserved, so the next order or delivery
takes another lot. Output that is not lot-tracked, or one-step completion, has no check.

**Quality templates (#1947).** A finished product may have one active `QualityTemplate`: criteria in
order, each a `range` (`min`/`max`, at least one, with an optional `unit`) or a `passFail`, and
`required` by default. `saveQualityTemplate` saves it whole, with a version check; a second active
template for the same product is refused (`qualityTemplateProduct`). A batch of a product with a
template opens its check with `templateId`; a product without one keeps the default check below,
pH within the BOM's range and sensory. Existing checks need no migration: a check with no
`templateId` is the default. `checkQuality` takes `results: [{criterionId, value}]` for a template
check. Every required criterion needs a reading (`qualityMissing`, `qualityValue`), and the lot
passes only when every required one passes. An optional criterion out of range is recorded and
listed in `failed` but holds nothing. Each result copies its criterion into `QualityResult`, so
editing the template later leaves checks already made as they were; a pending check reads the
template as it is now. The order page enters a template check on a KetGrid per lot: a reading for
a range, a verdict for a pass/fail. The checks table lists each result and marks the ones that
failed. Templates are set up at `/admin/manufacturing/quality-templates`, behind the settings gear,
on their own record page with the criteria in one grid. Sampling plans (every lot, every Nth lot)
remain open.

`checkQuality {id, ph, sensory, note?}` records one check, once:

- `ph` must read from 0 to 14 (a comma decimal is accepted), else `manufacturing.error.phReading`;
- `sensory` is `pass` or `fail`;
- pH within the range and a sensory pass **release** the lot (`stock.saveLot`, reason
  `qualityPassed`); anything else marks the check `failed` and the lot stays in quarantine, to be
  scrapped from its page (K37);
- a check already recorded refuses with `manufacturing.error.qualityChecked`.

It sits in the `approve` bundle: the foreman checks, a worker who records output does not.
`listQualityChecks {productionId?, lotId?}` is a `view` read. The order page shows a **Quality
check** section with a warning while lots wait, the checks and, for a foreman, one form per waiting
lot.

`traceLot {lotId}` (`view`) gives the lot's production trace:

- `checks`, its quality checks;
- `madeBy`, the orders whose finished lines carry the lot, with the lots they used;
- `usedIn`, the orders whose recorded use took the lot, with the lots they made;
- `received`, the done lines of the lot, of lots made from it, and of lots made from those (two
  levels of production), that went to a customer location, with the transfer and its partner.
  Issues to production are not receipts and never appear here.

The lot page (stock) adds **Production and traceability** when the reader may call `traceLot`:
the quality check, a recall count of customers, and one row per relation, each order, lot and
transfer a link. A reader without production (a seller) gets no block; a deployment without
manufacturing is unchanged.

**Decision: one check per lot, two criteria.** A check records pH and a sensory verdict, as the
mock does. Multi-criteria check templates (several measured parameters per product, sampling plans)
are deferred to their own task; the `QualityCheck` record is per lot so a template can later add its
lines without changing the quarantine flow.

### Orders drafted from sales and reorder rules

An order may be drafted from demand. It records `orderSource` (`sale`, `rule`, or null for one
made by hand) with `saleOrderId`/`saleLineId`, `orderpointId` and a `deadline`. A drafted order is
named `<warehouse code>/SX/0001` after the highest number taken, and is made from the warehouse's
stock location into the rule's location or the warehouse's stock, at the company's first production
location. It stays a draft: nothing is confirmed on anyone's behalf.

- **Make to order.** A BOM may set `toOrder`. `withSaleProductions` wraps every function of a module
  that writes `sale.Order` or `sale.OrderLine` (Sale itself, and in Commerce the sales channel). When
  a call confirms an order, by `confirmOrder`, an adapter or a channel, it drafts one order per
  product line whose product's BOM in use makes to order: the line's quantity in the product's unit,
  `origin` the sale's name, the deadline its commitment date. A line that already has an order other
  than a cancelled one gets none; a line added to a confirmed sale gets its own.
- **Following the sale (#1949).** After any such call, the sale's drafts are reconciled. A sale
  cancelled or back to a quotation cancels its drafts. A changed line quantity resizes its draft; a
  line removed or brought to zero cancels it. An order someone already confirmed is never changed on
  the sale's behalf: it records `saleNotice` (`cancelled` or `changed`), which the order page shows
  as a warning until the quantities agree again. The orders a call touched are the ones its writes
  name (including writes inside its own transaction) plus its `id`/`orderId`. The reconciliation runs
  after the call returns, in the same request, not in its transaction: draft orders hold no stock, and
  the stock commands an order's cancellation calls open transactions of their own. A refused call
  changes nothing.
- **Reorder rules.** `stockWithProductSuppliers({ make: manufactureReplenishment })` lets a rule
  take the source `manufacture` (refused with `stock.error.replenishment.make` for a product with no
  BOM in use). Running it drafts an order for what the rule asks, with a deadline of its lead days;
  the same run (`moveId`) answers the same order (`method: 'existing'`). Draft orders count as on
  order, so the next run has nothing left to order. The run returns `productionId` and `href`, and
  the rule's page opens the order.
- **Forecast.** With `make`, the forecast lists each draft order among the drafts not yet counted,
  as kind `make`, opening the order. A confirmed order already counts through its stock moves:
  finished goods still to make come in, components still needed go out.

Commerce composes both. The order page shows an **Order source** section (source, the sale or rule
as a link for a reader who may open it, the deadline). The order list filters by **Order source**
rather than adding a column, which would overflow at 1440 px; `?orderSource=sale|rule|manual` is a
link that becomes that filter.

**Decision: a BOM flag, not a product route.** Stock has no manufacture rule action for routes to
pull through, and a route would make every warehouse's sale of the product make to order. The flag
belongs to the BOM in use, so a new version can stop making to order without touching the product.

**Review follow-up (#1949, #1931, #1947).** Reconfirming a cancelled sale drafts a new production
attempt for each eligible line, preserving cancelled production history. Replaying confirmation
keeps the existing live attempt. The operator skills workspace owns its only page heading and
its VI/EN Help drawer; the shared compatibility topbar is omitted on that screen.

Quality template edits compare the submitted revision inside the save transaction before
replacing criteria. A concurrent stale edit leaves both the winning template and its criteria intact.
