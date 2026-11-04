---
title: Stock replenishment
---

Commerce composes Stock with `stockWithProductSuppliers()` from Purchase. Other deployments keep
the route-based Stock module unless they explicitly install this provider. Supplier selection
uses the same ordered, date-aware, variant-aware selection service as Purchase.

## Where the Inventory screens live

The Inventory sidebar keeps daily work (K6): **Inventory overview**, **Stock**, **Lots**, then three
queues over the one transfer list, **Receipts** (`/admin/stock/transfers?preset=receipts`),
**Deliveries** (`preset=deliveries`) and **Internal transfers** (`preset=internal`), and **All
transfers** without the filter (K21); then replenishment, counts, scrap, forecast, stock value, move
analysis and stock aging. A queue's entry is lit, and heads the list, whenever its preset is in the
address, with any other filter beside it (`queryEntryActive`). The kind is the operation type's code;
the operation types the stock module creates for counts, adjustments and scrap (`…:count`,
`…:adjustment`, `…:scrap`) are not internal transfers and appear only under **All transfers**.

Configuration is behind the gear (K53), as the settings page's **Inventory** block (`admin.stock`):
warehouses, locations, operation types, routes and stock accounting, each primary for whoever saves
it (`for`). Lots are read daily and stay in the sidebar (K32). In the Commerce deployment, carrier
and shipping configuration (`/admin/delivery/settings`) is its own block on the settings page too;
the Delivery sidebar keeps the overview, dispatch, shipments and settlements.

## Warehouse locations

Every warehouse owns its locations (K10), as `saveWarehouse` creates them: its view and stock locations,
the input, quality, output, pick and pack steps, and its own vendor (`…:supplier`), customer
(`…:customer`), scrap (`…:scrap`) and inventory adjustment (`…:adjustment`) locations. No location
outside the warehouses is shared by the company: the warehouse's receipts come from its vendor location,
its deliveries go to its customer location, its counts post against its adjustment location and its scrap
orders go to its scrap location. Reports per warehouse read these locations directly and access by
warehouse covers them; the **Locations** screen tells same-named rows apart by its **Warehouse** column.

These records keep their English seed names in the database. `localizeGeneratedRecords`
(`stock_backend/generated-names.ts`) shows them in the reader's language wherever they are listed: the
Locations and Operation types lists, the record modal (its title and name field) and its pickers, a lot's
trace and the reports. A name someone typed is kept as it is, even when it reads like a seed name. The
**Locations** list and its record modal carry the screen guide (`LocationHelp`).

## Supplier rules

At `/admin/stock/replenishment`, create or open a rule for an active storable product, warehouse
and internal/transit destination. Supplier rules additionally require a purchasable non-combo
product. Select a supplier present on that product, or **Follow product**. The automatic choice
uses the replenishment quantity: the first eligible row meeting its minimum wins; otherwise the
first eligible row wins. An explicit supplier restricts selection to that supplier.

Lead days accept whole numbers from 0 through 365. A supplier rule may leave them blank when an
eligible supplier exists: use the chosen supplier's first eligible row, or the product's first
eligible supplier. Explicit days take precedence. The summary displays saved values; save before
running replenishment. Legacy route rules with no lead-day value retain their unbounded horizon.
New explicit route settings require a lead-day value.

## Stock forecast

`/admin/stock/forecast` lists one row per product in each warehouse that holds it, expects it, sends
it, has it on order or keeps a replenishment rule for it (`stock.getForecastCollection`). Usable stock
is what the warehouse's internal and transit locations hold, less expired or quarantined lots, which
the product page shows apart as not usable. Confirmed operations not yet done count on their
scheduled day, an overdue one from today; the stock after each is the running balance, and the first
day it falls below zero is when the product runs short, named with the operation that causes it.
Draft receipts and transfers into the warehouse are on order and stay out of the forecast; a draft
leaving it promises nothing. Rows sort short first (soonest first), then below the rule's minimum,
then enough; the list is an island read through `/admin/stock/forecast/data`.

`/admin/stock/forecast/{warehouseId}/{productId}` (`stock.getForecastDetail`) shows the shortage, each
coming operation with the stock after it and an overdue label, the drafts not yet counted, and the
totals and the rule beside them. The forecast reads with the stock (`report`); minimums, the
below-minimum status and the rule appear only to readers of `stock.getOrderpointCollection`.

## Forecast and requests for quotation

The forecast includes usable internal stock and confirmed incoming/outgoing demand due within
the lead horizon. Outbound demand is not reduced by reserved stock. All draft receipts already
on order reduce the remaining need, and so do requests for quotation not yet confirmed (draft,
sent or awaiting approval) for the product delivering to the rule's location, whether a rule or
a buyer drafted them (`SupplierReplenishment.onOrder`).
Below the minimum, procure towards the maximum and round up in the replenishment unit.

Run replenishment confirms the action. A supplier rule (Purchase composed through
`stockWithProductSuppliers()`, Commerce) asks the vendor instead of drafting a receipt (#1737): the quantity
becomes a line of a draft `purchase.Order`, in the rule's unit and priced from the vendor price
list like any line (`SupplierReplenishment.request`). New quantities join a draft request only
when company, warehouse, destination, operation type and supplier match (`Order.replenishmentGroup`);
once it is sent, the next run drafts another. The request delivers to the rule's location
(`Order.locationDestId`), and confirming it drafts the receipt there, so the quantity stays on
order exactly once. The run answers `orderId` and `method: 'purchase'` and stays on the rule,
which shows it on order: a warehouse operator may not open Purchase. Purchasing finds open
requests from rules under **Stock replenishment demands** on the purchase overview. A replenished
scrap keeps its request in `Scrap.replenishmentOrderId`, linked for readers of `purchase.getOrder`.

Zero remaining need returns to the rule. Concurrent runs serialize at the warehouse and product;
retries with the same move ID reuse the original result and replenishment quantity, whether it
was a receipt move or a request line (`SupplierReplenishment.requested`). Receipts and their
backorders retain the supplier, and this feature does not change stock cost or valuation rules.
The stock forecast at `/admin/stock/forecast` still counts only draft receipts and transfers as on
order (#1866).

Nullable schema additions preserve existing orderpoints, receipts and moves. No backfill rewrites
historical records. Archived destinations, foreign scope, inactive/nonstorable products and
suppliers outside the product refuse before procurement.

## Transfers bound to an order

A sales order's delivery and its backorders follow the order, and a return follows its delivery (any move
with `saleLineId` or `originReturnedMoveId`; `getPicking.bound`). `savePicking` refuses to change their
operation type or locations and `addMoves` refuses new products, both with `stock.error.pickingBound`;
the reference, scheduled date and priority still change, and what was done is recorded on the picked
lines. The transfer page leaves those fields out of **Edit** and shows the products read only. `addMove`
stays open to the modules that build their own transfers (POS, manufacturing, the staff channel).
Receipts hold no stock, so their page offers no **Reserve**.

A sales delivery takes the order's `shippingPolicy` as its `moveType` (K2). A transfer with `moveType: 'one'`
(ship at once when complete) is `assigned` (Ready) only when every live move is `assigned`; with `direct` it is
ready as soon as one move holds anything. `sale.saveDeliveryPromise` rewrites the open delivery's
`moveType` and recomputes its state in the same transaction.

## Warehouse staff and the warehouse a document starts in

`stock.WarehouseUser` records who works at a warehouse (K15, #1428). The warehouse's modal behind the settings
gear picks them among the company's active people (`stock.listWarehousePeople`) and `stock.saveWarehouse`
replaces them with its `userIds` list; leaving `userIds` out keeps them, and anyone outside the company is
refused (`stock.error.warehouseUser`). `stock.listWarehouses` returns each warehouse's `userIds` and whether
the caller is `assigned`.

A new quotation (backend and staff app), count or scrap starts in `defaultWarehouseId` of the caller's
warehouses: the one warehouse they are assigned to, or the company's only warehouse when they are assigned to
none. Anyone who may work in several warehouses starts with none chosen and picks one, so nothing is booked
into the wrong warehouse. A scrap opened from a transfer keeps that transfer's warehouse. Assignment chooses
only; it does not limit which warehouses someone may work in.

## Lot condition

The lots list (`/admin/stock/lots`) shows each lot's **Expiry** and a **Status** worked out when it is read,
never stored (K28; `lotCondition` in `stock_backend/screens/lots-list.tsx`): `archived`, then
`quarantined`, then `depleted` (nothing in an internal or transit location), then `expired`
(`expirationDate` has come), `expiring` (`alertDate` has come, or 90 days before expiry without one),
`valid`, or `noExpiry`. Dates compare as instants, as `stock.listLots({ status })` does. The list filter
offers each condition as a preset in its own group. The list mounts the lot guide (`stock-lots-help`).

The on-hand screen (`/admin/stock/inventory`, K13) shows each lot row's **Expiry**. A row whose lot fails
`lotAvailable` (expired, past its removal date, quarantined or archived) keeps its on-hand quantity but shows
**Available** 0, the rule reservation follows. Availability presets: `available`, `reserved`,
`fullyReserved` (stock left, all of it held), `outOfStock` and `blocked` (such lots).

Each row also shows its **In date** (K58): the quant's `inDate`, the day its goods first came into that
place, kept when more of the same lot arrives later, as a short date in the viewer's language. The last
column (**Open**) carries two links for whoever may read their target. **History** opens
`/admin/stock/moves?q=<lot, else product reference or name>` (`stock.listMoveHistory`). **Replenishment**
opens the product's active rule at that location, `/admin/stock/replenishment/<id>`, or, with no rule
there, the rules searched for the product (`stock.listOrderpoints`). Without either function the column
shows `—`.

## Lot page

A lot's page (K32, `stock.lot` record, `modal/configuration-view.tsx`) heads a quarantined, expired or
expiring lot (`lotCondition`) with a notice carrying the quarantine reason or the expiry day. **Lot
traceability** lists the lot's finished lines, newest first, from `stock.listMoveHistory({ lotId })`:
done day, transfer (opens it), from and to as `<warehouse code>/<location>`, quantity and unit, type,
partner and source document. A source document that names a sales order links to it only when
`sale.listOrders` answers the reader; a return names the delivery it brings back, and a direct on-hand
adjustment (`origin: 'inventory'`) names none. The page rail (**Lot figures**) adds received (from supplier
and inventory locations into owned ones), on hand and reserved (its internal and transit quants), delivered
(to customers less returns from them) and the number of distinct partners delivered to. A reader without
`stock.listMoveHistory` gets neither table nor rail.

## Stock overview

`/admin/stock` (K51; `overviewFigures` in `stock_backend/overview-data.ts`) shows one figure per tile, each
equal to the rows of the list it opens: receipts to receive (confirmed, not done; a receipt holds nothing, so
it is never "ready"), deliveries ready, deliveries waiting (with how many are past their scheduled date),
products to replenish, lots expiring (with expired lots still on hand), counts waiting for approval and stock
value. A tile at 0 has no link. A tile reads its list only when the reader may call that list's function,
and is left out otherwise; stock value needs `stock.listValuation`.

`?warehouse=<id>` narrows every figure to one warehouse; an unknown id reads as all of them. Transfer tiles
open Transfers on the kind and state presets with a `warehouse` filter by name, the lots tile filters the lots
list's `warehouses` column (the names of the warehouses holding the lot), the counts and value tiles pass
`?warehouse=`, and **By warehouse** rows open `/admin/stock/inventory?warehouse=<id>`, which keeps the
internal and transit locations of that warehouse. **To do** lists confirmed transfers past or within seven
days of their scheduled date, the most overdue first; drafts never count as late.

## Goods not kept in stock

A product whose tracking is "No inventory tracking" (`isStorable` off) still moves on transfers.
Reserving holds the whole remaining demand on one line at the move's
source location, and completing, unreserving or cancelling the transfer changes no quant and records no
stock value. Sales and purchases deliver and receive these goods like any other. Counts, inventory
adjustments and scraps still refuse them.

## UI and permissions

The collection uses three native islands and one bounded paged read. Compound filters, groups,
sort, favorites and return URLs survive navigation. Search debounces through the shared native
filter; late reads cannot replace a newer result. Permission denial clears retained rows.

`stock.view` includes supplier names and days, without Purchase price access. `stock.operate`
controls save/run; viewers have no editing controls. Supplier and unit pickers use native controls
and dependent-field resets. Native record pages and modals share the same definition. Refused
writes preserve raw form input and show field feedback, including the legacy create POST route.
Run is a separate command and does not validate unsaved edit fields. Screen Help is available in
Vietnamese and English for the collection, rule and receipt.

## Direct transfer links

`/admin/stock/transfers/{id}` uses `RecordPage` and the signed-in company scope.
Reading the picking is required; optional product and configuration lookups must not deny a
permitted reader. Confirm, reserve, validate, cancel, add-move and done-quantity controls each
require their own Stock function permission, in addition to an editable state. POST requests
still enforce these permissions independently of the screen.

The collaboration joint resolves the functions named by its fills through `jointFor`.
The Stock mail fill requires `stock_mail_backend.timeline`; an unavailable discussion must
not mount a client that immediately requests a forbidden timeline. A comment-only empty fill
does not reserve a sidebar. Commerce does not currently compose the Stock activity bridge.
The page retains the named header/body fragment slots and supplies the existing transfer Help
in both languages, including a header button usable on mobile. This scoped repair does not
complete the remaining Stock editor, confirmation and workflow acceptance.

## Valuation and the stock journal

Stock keeps one perpetual weighted average per product and company across every warehouse
(`stock.ProductValuation`), and records every valued movement as a signed
`stock.ValuationLayer`. Only storable products are valued; internal and transit locations hold
value, so transfers between them move none.

- **In** (supplier, production, customer return, count surplus): the line's `unitCost`, else the
  move's `priceUnit` (Purchase writes the discounted price per stock unit on confirmation, when the
  order is in company currency), else the running average, else the catalogue cost. Every valued
  inbound line (a receipt, a return, a count surplus) then writes the rounded average to
  `product.Cost`, so new sales lines price from it. Quantity left for a
  backorder carries the first unreceived line's `unitCost` as the backorder move's `priceUnit`.
- **Out** (delivery, vendor return, consumption, count shortage): the proportional share
  `value × quantity ÷ held`, rounded once at currency scale; issuing the last units takes all the
  value left, so the goods account keeps no remainder.
- A product with stock but no valuation row opens lazily at its catalogue cost before the first
  operation that touches it moves any quantity.
- **Customer returns** (K19): `stock.createReturn({ id, returnId })` turns a completed delivery to a
  customer into a confirmed receipt of the warehouse's incoming type, from the customer location back
  to the delivery's source, with the same partner and lines (moves keep extension fields such as
  `saleLineId` and set `originReturnedMoveId`). Each line takes what was delivered less what returns
  not cancelled already claim; the delivery row is compare-and-set first so concurrent returns
  serialise, and a replay with the same `returnId` answers the same return. A completed return comes
  back at the delivered value (`value × quantity ÷ delivered`), not the current average, and
  `sale.syncDeliveries` subtracts it from the line's delivered quantity. `getPicking` reports
  `returnable` for the record's **Return** command.
- **Partners and related transfers** (K19, K20): a sales order's delivery carries the order's customer
  and a purchase order's receipt its vendor, so a return copies the customer. `getPicking` reports
  `partnerRole` (`customer` when either end is a customer location, `supplier` when one is a supplier
  location) so the page labels the partner **Customer** or **Vendor**, and `related` with
  `backorderOf`, `returnOf` (the delivery a return's moves came from), `backorders` and `returns`
  (`{ id, name }`), which the record lists as links. An open return explains that its done quantity is
  what came back.
- **Transfer numbers** (K17): every transfer takes its warehouse's next number of its kind,
  `<warehouse code>/NK|XK|CK/0001` for incoming, outgoing and internal, from `stock.PickingSequence`
  (one row per warehouse and kind, advanced by compare-and-set). `createPicking` numbers a transfer whose
  `name` is blank, and sales deliveries, purchase receipts, backorders, returns, replenishment and
  single-product adjustments are numbered the same way; a typed name stays and a replay keeps its number.
  Count sessions and scraps keep their own `KK` and `HH` sequences.
- **Who completes transfers** (K21): `confirmPicking`, `validatePicking`, `completePicking` and
  `cancelPicking` form the `stock.transfer` bundle, which Commerce grants the storekeeper as well as the
  stock manager. Approving counts, scraps and receipt unit costs stays in `stock.approve`.
- **Cancelling with a reason** (K18): `stock.cancelPicking({ id, reason? })` keeps a trimmed reason on
  `Picking.cancelReason` and refuses one given blank (`stock.error.cancelReason` on `reason`). Sales,
  channel, manufacturing and other flows that cancel a transfer with its document pass no reason. The
  transfer page cancels through a dialog that requires the reason and shows it on the cancelled transfer.
  A draft without lines keeps **Confirm** disabled with a notice; `confirmPicking` itself still accepts
  one, since automatic flows create and confirm transfers together.
- **Work order** (K18): the transfers list sorts by `queue` by default: reserved (`assigned`) first, then
  waiting or confirmed, then drafts, each by scheduled date; done and cancelled last, newest first.
- **Valuation adjustments** (K63): `stock.revaluePicking({ id, revaluationId, moveId, amount, account,
  reason })` raises or lowers what a line of a completed supplier or production receipt is worth, for
  example when the vendor corrects the price. Only moves whose receipt layers brought value in are
  offered (`getPickingValuation.revaluable`). The amount is signed, non-zero and has no more decimals
  than the company currency; `account` names the counterpart from the stock accounting settings
  (`supplier`, `cogs`, `gain`, `loss`); a reason is required. The company value held of the product
  moves by the amount (compare-and-set on `ProductValuation`), its catalogue cost follows the new
  average, and a `revaluation` layer with quantity 0 records it against the move with no `pickingId`,
  so the receipt's own value, print and entry keep what it was received at. When stock posts to the
  books, entry `stock-revaluation:<revaluationId>` dated today debits goods and credits the counterpart
  (the reverse when lowering); a locked period refuses it and nothing changes. Refused when the company
  holds none of the product or when lowering would take the value held below nought. A replay with the
  same `revaluationId` answers the same adjustment (`idempotent`). `stock.Revaluation` keeps each one;
  `getPickingValuation.revaluations` lists them for the receipt's **Valuation adjustments** table.
  Permission `approve`/`accounting`: the accountant template holds it, warehouse roles do not.
- **Scrap orders** (K37, K59): `stock.Scrap` is a document numbered per warehouse (`WH/HH/0001`)
  naming one product, its lot when tracked, a quantity and a reason from `SCRAP_REASONS`.
  `saveScrap` drafts it (an order opened from a transfer takes goods from where that transfer holds
  them; `getScrapSource` answers that location), `validateScrap` moves the goods on a done transfer
  to the warehouse's `scrap` location (created on first use for older warehouses), valued as an issue
  (kind `scrap`, Dr cost of goods / Cr goods), and `undoScrap` brings them back at the scrapped value
  (kind `scrap_return`) with a reason. Only unreserved stock can be scrapped. `replenish` runs the
  product's reorder rule in that warehouse for exactly the scrapped quantity after the goods leave
  (`orderpointRunner(provider)` with a fixed quantity, so Commerce uses the supplier provider).
  `scrapLot` scraps a lot from its page at once (empty quantity: all unreserved), suggests the reason
  from the lot's dates or quarantine and records it in the lot history.
- **Physical counts** (K33–K38): `stock.CountSession` counts a warehouse's main stock location,
  numbered per warehouse (`WH/KK/0001`). `startCountSession` takes every product and lot the
  location holds as `stock.CountLine` rows (products by code, lots soonest expiring first, at most
  200), or only those of the products in `productIds` for a partial count, and is blind by default: while counting, `getCountSession`
  and `listCountSessions` return no book quantity, difference or differing-line count.
  `saveCountLines` records each figure with who counted it and a reason, and drops the lines in
  `removed` in the same transaction; the count modal enters every figure and reason in one KetGrid
  and saves it with this call. `addCountLine` adds found goods (an existing lot for tracked
  products), `removeCountLine` drops a line and
  `submitCountSession` sends a fully counted session for approval. `approveCountSession`
  refuses whoever counted a line or submitted it, and refuses when the book changed since or a
  counted figure falls below what is reserved. It then books shortages and excesses at once on done
  transfers (`WH/KK/0001/XK`, `/NK`) against the warehouse's `adjustment` location at the average
  cost (kinds `loss`/`gain`) and writes a `countAdjustment` lot history row. `returnCountSession`
  (with a reason) reopens counting, takes the new book on changed lines and adds lots that came in;
  `cancelCountSession` (with a reason) changes no stock.
  Count and scrap moves are named after their product like every other move, and `getPicking`
  reports `pickingTypeName` because their operation types are inactive and absent from
  `listPickingTypes`.
- **Counting in pieces** (deployment option): `stockBackendWith({ countPieces: fn })` names a
  function that answers, per count line, whether its product counts in pieces and how many pieces
  its counted figure makes (`{lines: [{id, productId, counted}]}` → `[{id, enabled, pieces}]`).
  The count grid then shows a Pieces column before Counted, locked on other products.
  - Typed pieces post as `pieces` beside the line's previous figure. A counted figure typed in the
    same save wins.
  - The deployment's `stock.saveCountLines` converts posted pieces into the counted figure on the
    server, with its own rounding, or refuses with `stock_backend.count.piecesRefused`.
  - Pieces are never stored. Approval books the counted figure as for any other line.
  - Without the option, nothing changes, and posted pieces are ignored.
- **Partial and cycle counts** (K62): two open sessions of one warehouse are refused
  (`countOverlap`, naming the open one) unless both are partial and share no product.
  `getCountSession` and `listCountSessions` return `productIds` (null for a whole-warehouse
  count); a partial count's found goods and return keep to those products. `saveWarehouse` takes
  `countFrequencyDays` (0–365; 0 or empty is off the cycle, an omitted value keeps the stored one).
  `listCountCycles` reports per active warehouse the day the last whole-warehouse count was
  approved, the next due day (that plus the frequency, or today if never counted) and `countDue`
  when that day has come and no whole-warehouse count is open. Days fall in the company's
  `accountingTimezone`. Partial counts do not move the date. `/admin/stock` shows a due tile and
  the cycle table to readers of counts.
- **Reservation methods** (K60): `saveWarehouse` takes `reservationMethod` (`at_confirm`,
  `manual` or `by_date`; a warehouse that never chose reserves manually, as transfers always have)
  and `reservationDaysBefore` / `reservationDaysBeforePriority` (whole days 0–365; empty priority
  days share the others'). The method applies to the warehouse's delivery and internal transfers;
  receipts hold no stock. `getPicking` reports `reserves` and `reservation: { method, reserveFrom }`,
  the scheduled civil day in `accountingTimezone` less the days. Pickings take `priority`.
  `confirmPicking({ reserve: true })` (a person confirming, from the modal or the transfer page)
  reserves at once on confirmation, or by date once `reserveFrom` has come; without `reserve` it
  only confirms. Transfers that other modules confirm in their own flows (sale procurement, POS,
  manufacturing) keep the reservations those flows make. `reservePickings({ ids })` reserves open transfers priority first, then soonest
  scheduled, then by name; `reservePickings({ due: true })` takes every open transfer whose
  warehouse reserves by date and whose day has come. The `stock.reserveDueTransfers` job runs
  hourly across companies and enqueues one `stock.reserveDueCompanyTransfers` per company with a
  by-date warehouse (unique per company and hour). `unreservePicking` gives back unpicked lines
  (quant reservation and line) and keeps picked ones, refusing done or cancelled transfers
  (`pickingClosed`) and receipts (`pickingNotReserving`). `/admin/stock/transfers` badges priority
  transfers and, for holders of `reservePickings`, reserves checked rows through
  `/admin/stock/transfers/bulk`.
- **Transfer lines grid** (K24, K30): the transfer modal enters move lines in one KetGrid and
  saves them with `savePickingLines({ id, lines })`, all or nothing. Each entry names its line `id`
  (new lines take the grid's id) and `moveId`, both of this transfer (else `pickingLineMissing`).
  With `quantity` it saves the line as `saveMoveLine` does, or as `prepareReceiptLot` for a
  lot-tracked receipt (`name`, `expirationDate`, `expectedRevision`); with `unitCost` it prices the
  line as `setReceiptUnitCost` does. Each part needs the caller to hold that function
  (`E_FN_NOT_PERMITTED`), and lines that are not a list are refused with `pickingLinesInvalid`.
  The grid offers each line its product's lots, opens the receipt lot and expiry cells only on
  lot-tracked receipts, and the price cell only to holders of `setReceiptUnitCost`; completing
  waits for the grid to be saved.
- **Transfer products grid**: the transfer modal adds products in a second KetGrid and saves them
  with `addMoves({ pickingId, moves })`, all or nothing. Each entry is a move as `addMove` takes it
  (`id`, `name`, `productId`, `productUomId`, `productUomQty`) and joins the transfer at its
  locations, as draft on a draft transfer and confirmed otherwise. The caller must hold `addMove`
  (`E_FN_NOT_PERMITTED`). A move id another transfer already uses is refused with
  `pickingLineMissing`, a done or cancelled transfer with `pickingClosed`, and moves that are not a
  list with `pickingLinesInvalid`. Choosing a product fills in its own unit and offers only the
  units it converts into. Saved product lines are read-only in the grid. Confirming, reserving and
  completing wait for both grids to be saved.

`validatePicking` (the transfer page's **Validate**) counts only the lines ticked as picked when any
are; with none ticked it completes what is held, as the mock does, and with nothing held it
refuses with `stock.error.nothingDone` instead of a done transfer that moved nothing.

`completePicking` and `adjustInventory` value inside their own transaction. When Accounting is
composed and `stock.AccountingSetting.journalId` is set, the operation also posts one
`moveType: 'entry'` move with `sourceModule: 'stock'` (`postMoveById(..., { inTransaction: true })`,
since adapters do not nest transactions). A missing account, a refused draft or a locked period
refuses the whole completion; stock, value and entry roll back together. Accounting refuses to
reverse or cancel a move whose `sourceModule` is set, and its entry page offers neither. The entry
page names the transfer it came from (**From stock transfer**, linking `/admin/stock/transfers/{id}`)
to a viewer allowed `stock.getPicking`; the transfer links its entry back for `account.getMove`.

A sales line's cost follows what its goods took out (K25). Whenever the order's deliveries sync (a
delivery or a return completes, or **Sync deliveries** runs) and whenever a confirmed order's grid
saves, `sale.OrderLineCost` becomes, per unit of the line: (value its delivery moves took out −
value its returns brought back + quantity still to deliver × the product's average now) ÷ the larger
of ordered and delivered, from the moves' `stock.ValuationLayer` rows. A line none of whose goods left,
or one with a delivery done before valuation began, keeps the cost captured when it was saved.

`ketviet_account_vn` seeds the KHO journal and the TT99 accounts 156, 151, 1541, 632, 33811 and
13811. A receipt credits 151, and Purchase lets a vendor bill debit that account while posting is
on, so 151 clears whichever document comes first. Posting starts by itself only for a company with
no completed transfer; an existing company switches it on after recording its opening balance.

Values and prices are sensitive (`stock.valuation`): `getPicking` and the transfer views strip
`priceUnit`, `unitCost` and `value`, which travel only through `getPickingValuation`,
`listValuation` (the Stock value screen, `/admin/stock/valuation`) and `setReceiptUnitCost`
(`stock.approve`). The journal and accounts are the accountant's (`stock.accounting`,
`/admin/stock/accounting`).

## Landed costs

A **landed cost** (`stock.LandedCost`, K64, numbered `CPMT/YYYY/NNNN` by its day) adds freight, handling,
insurance or duty to the goods of one or more completed receipts and owes the whole to the vendor of the
service. Its list is `/admin/stock/landed-costs`, after Scrap orders; each cost is a page,
`/admin/stock/landed-costs/{id}` (`new` to create; `?picking=<receipt>` starts on that receipt).

- **Draft** (`saveLandedCost`, bundle `stock.cost`): a vendor (`listLandedCostVendors` offers any active
  partner but the company's own, through the cost's own grant), a day not after the company's today,
  receipts from `listLandableReceipts` (done, with `receipt` or `production` valuation layers, so not
  customer returns) and up to 20 costs (`stock.LandedCostLine`: name, split `quantity`, `value` or
  `equal`, an amount above 0 at the currency's scale). A save replaces the lines; the page enters them in
  one KetGrid and posts the whole list in the grid's order (`postedCostLines`).
- **Post** (`postLandedCost`, `approve`/`accounting`): each cost spreads over the valued lines of its
  receipts by the split, rounded to the currency, the last line taking the remainder. The share of a line
  is split again by what is left of it, first in, first out over the company's valued stock
  (transfers between its own locations use nothing up): the part still held raises the product's
  `ProductValuation` (compare-and-set) and its average cost through a `landed` layer of quantity 0 with no
  `pickingId`; the part already gone goes to cost of sales. `stock.LandedCostAllocation` keeps every
  share. When stock posts to the books, entry `stock-landed-cost:<id>` dated today debits goods and cost
  of sales and credits the supplier account with the vendor as partner. A replay answers the same post.
  The page's **Post** saves the draft and posts it in one action (`also`).
- **Cancel** (`cancelLandedCost`, bundle `stock.cost`) drops a draft with a reason; a posted cost is
  reversed in Accounting.
- Reading (`listLandedCosts`, `getLandedCost`) is stock value: bundle `stock.valuation`. The warehouse
  manager drafts and cancels, the accountant also posts, the auditor reads, a warehouse operator meets a
  locked page. A completed receipt offers **Add landed cost** to who may draft one while it can take one,
  and its rail lists the costs on it, cancelled ones aside, with what each posted one added to it.

## Shipping

Shipping is on the books (K7, K45–K49): the company deals with each carrier itself, keeps its rates, books
every parcel with it and posts what the carrier collects and charges. A carrier the hosting provider would
book for the company is a later phase: `stock.Carrier.management` takes only `tenant` now, `platform` is
reserved and refused (`carrierManagementUnavailable`). The private delivery adapters of a deployment are not
part of this flow.

- **Carriers** (`stock.Carrier`, `saveCarrier`, `archiveCarrier`, `activateCarrier`, bundle
  `stock.configure`): a code of 2–10 capitals or digits fixed once created, a unique name, the first
  kilogram's fee, the fee of each kilogram begun after it and the cash-on-delivery rate (0–10%, two
  decimals). Exactly one carrier is the default and it stays in use; the first one is. Creating a carrier
  creates its partner (`<id>:partner`, kind company) and renaming renames it: the cash it holds and the fees
  it is owed are its debts and claims. An archived carrier is not offered and takes no new parcel; changed
  rates apply to parcels booked after.
- **Parcels** (`stock.Shipment`, numbered `<warehouse code>/VD/NNNN`): one per open delivery to a customer
  (not a return) at a time (`openPickingId`, unique while not cancelled). `createShipment` (from a delivery)
  and `createShipments` (up to 100 ticked in the queue; skipped ones say `hasShipment` or `closed`) start a
  draft with the default carrier, 1 kg and, for a sales order whose payment term is due at once, what is left
  of the order after its other live parcels; otherwise 0. `saveShipment` keeps weight above 0 to 50 kg with
  two decimals and cash on delivery within that limit (100 000 000 without an order). A draft shows the
  fees its carrier's rates would charge.
- **Book** (`bookShipment`) while the delivery is open: the tracking code the carrier gave (4–40 letters,
  digits or dashes, once per carrier), or the next of the carrier's own (`GHN203000001`); the carrying and
  collecting fees are fixed from here. **Hand over** (`handOverShipment`, `handOverShipments`;
  `approve`/`transfer`) needs every good of the delivery held, completes the delivery whole (no backorder)
  and, in Commerce, counts it on the order at once. **Deliver** (`deliverShipment`) posts cash on delivery
  above 0 on the stock journal dated the company's today, entry `stock-shipment-cod:<id>`: debit the
  carrier's cash account with the carrier as partner, credit the customer receivable with the customer.
  **Fail** asks why; **retry** counts one attempt more; **return** opens a confirmed return of the delivery
  (`<id>:return`) and drops the collecting fee. **Cancel** (draft or booked) asks why, charges nothing and
  puts the delivery back in the queue.
- **Statements** (`stock.DeliveryStatement`, numbered `<carrier code>/DS/NNNN`; bundle `stock.accounting`
  to write, `stock.valuation` to read): a carrier up to a day not after today takes its parcels delivered
  or brought back by then and on no other open statement (`openShipmentId`); a parcel brought back
  collects nothing. Saving a draft again takes those that came since; the page counts them (`pending`).
  **Post** books fees above 0 dated the statement's day, entry `stock-delivery-fees:<id>`: debit the
  shipping cost account, credit the carrier payable account with the carrier. **Settle** on a day from the
  statement's to today, through an active bank or cash journal with a default account
  (`listSettlementJournals`), entry `stock-delivery-settlement:<id>`: the fees come off what the carrier
  collected (carrier payable against the carrier's cash account), the bank takes what is left, or pays
  what the fees exceed. **Cancel** drops a draft with a reason and frees its parcels.
- **Accounts.** `saveAccountingSetting` takes `deliveryFeeAccountId` (641), `carrierPayableAccountId`
  (331), `carrierCodAccountId` (1388) and `receivableAccountId` (131): the carrier's payable is its own
  account, since `supplierAccountId` is often goods in transit (151). They are optional for
  stock valuation and kept when a form leaves them out; a step that would post without them refuses
  `deliveryAccountMissing`. A locked period refuses delivering, posting and settling
  (`valuationPeriodLocked`) and nothing is written. Every step answers a replay with the same result.
- **Reading.** `listShipments`, `getShipment`, `listDispatchQueue` (open customer deliveries without a
  parcel or with a draft or booked one: `toHandOver`, `toBook`, `noShipment`, `waiting`) and
  `getDeliveryOverview` (per carrier: to hand over, on the way, failed, not on a statement, cash on the way,
  cash held) are `stock.view`; carriers are read the same way. The warehouse operator and manager work
  parcels; the accountant and the auditor read them and statements; the accountant writes statements.
- **Screens** (menu Stock, after Stock aging; Help VI/EN on each): **Delivery overview**
  (`/admin/stock/delivery`, per carrier); **Delivery operations** (`/admin/stock/delivery/dispatch`, the
  queue, ticking deliveries into draft parcels); **Shipments** (`/admin/stock/shipments`, ticking parcels
  to hand over; a parcel's page `/admin/stock/shipments/{id}` takes each step its state allows);
  **Carrier statements** (`/admin/stock/delivery-statements`, a statement's page with Save, Post, a Settle
  dialog and Cancel); **Carriers** behind the settings gear (`/admin/stock/carriers`, a record modal). A
  customer delivery's page offers **Create shipment** and links its parcel; the stock accounting settings
  take the four shipping accounts. Lists are islands read through `<path>/data`.

## Moves analysis and stock aging

Two read-only reports sit after Stock value (K63), for the same readers: `stock.listMoveAnalysis`
and `stock.listStockAging` are in bundle `stock.valuation`, and a role without it meets a locked page.

- What is left of each arrival is read first in, first out, location by location (`stockLayers` in
  `stock/analysis.ts`). Every done line bringing goods into an owned location (internal or transit) is a
  layer dated when its transfer finished; every done line taking goods out uses the oldest layers first;
  at the same instant arrivals count before departures. Stock no recorded line explains is an opening
  layer dated by its stock line's in-date, and a location that went short takes the shortfall from its
  next arrival, so the layers add up to what each location holds. Valuation itself stays the company
  average; the layers only say which arrivals are still there.
- **Moves analysis** (`/admin/stock/analysis`): a row a move of every transfer in any state: date
  (done, else scheduled, in the company time zone), transfer, product, move type (receipt, delivery,
  internal, return, count adjustment, scrap, scrap undone), status, demand, done (only once done), value
  (the move's signed valuation layers, blank when the move changed no value), remaining and remaining
  value (= value × remaining ÷ done) for moves that brought goods into an owned location. Filters by
  date, state presets and "still in stock"; groups by date (month, week, day), product, move type and
  status; the footer totals value and remaining value over every row the filter keeps. A transfer
  between warehouses belongs to both.
- **Stock aging** (`/admin/stock/aging`): a row a product a warehouse holds, split ≤ 30, 31–60, 61–90
  and > 90 days since its layers came in, with the oldest day still held and the value at the company
  average. Without a warehouse the values total what Stock value does (the largest holding takes the
  rounding difference); a warehouse shows its share, as Stock value does. `listStockAging` takes an
  optional `asOf` day.
- Both screens are paged lists on one shared island (`stock_backend/reports/`) with the search-filter
  bar, a warehouse menu and Help (VI/EN).

## Moves history

**Moves history** (`/admin/stock/moves`, K52) shares that island but reads as On hand does:
`stock.listMoveHistory` is in bundle `stock.view` and carries no value; a role without it meets a locked page. A row is a move line of a finished transfer with a quantity above 0, so a lot is a row and a
line closed at 0 is not; counts and scraps are finished transfers too. Columns: done day (company time
zone), document (opens the transfer), product, lot, from and to (`<warehouse code>/<location>`), quantity
in the line's unit, and type (`moveKindOf`, as Moves analysis). Newest first by done time. The warehouse
menu keeps lines whose source or destination is in the warehouse, so a transfer between two warehouses
belongs to both. Presets `thisMonth` and `lastMonth` (group `period`, the company's month) and one per
type; the sidebar opens `?preset=thisMonth`, and removing it lists every period. Search covers document,
code, name and lot. Nothing is stored: a location's opening stock plus what came in less what left equals
what it holds.

## Search in Stock

On any `/admin/stock/*` screen the topbar search opens **Search in Stock** (`/admin/stock/search`, K55)
instead of the system-wide dialog, as Products does with its own search; `frameOf` keeps the list of such
apps in `APP_SEARCHES`. The page and `stock_backend.searchStock` need that function (bundle `stock.view`);
without it the topbar searches the whole system. One query covers transfers (typed by `moveKindOf`),
lots, stock counts, replenishment rules and landed costs in every status, period and warehouse, so the page has no
period, status or warehouse filter. A type is searched only when the reader holds the reads its list makes
and its record opens with: `listPickings` and `getPicking`, `listLots`, `listCountSessions` and
`getCountSession`, `getOrderpointCollection` and `listOrderpoints`, `listLandedCosts` and `getLandedCost`. Matching ignores accents and case:
a transfer by its number, partner, source documents and products; a lot by its name, reference and
product; a count by its number and warehouse; a rule by its product and warehouse; a landed cost by its
number, vendor and receipts. Rows show number or
name, type, partner or product (a lot's product, a count's or rule's warehouse), source document (a lot's
reference) and status; they page by 25, transfers and counts newest first, lots and rules by name, and
open the record: transfer, lot and rule pages, a count over the counts list. Shipments and carrier
statements (K45–K49) are not searched yet.

## Printed vouchers

An operation prints as a page of its own, `/admin/stock/transfers/{id}/print`, printed with the
browser (K65). A receipt prints as form 01-VT, a delivery as 02-VT and an internal transfer as a
transfer note: the company, the partner and its default delivery address (no address when the
transfer names no partner, as a sales channel package does), the source documents, the warehouse,
then a row a lot with its expiry, what was asked, what is held before the transfer is done and what
was done, then four signature blocks. Dates print day first in the company's time zone.

- Each copy is read by its own function: `stock.getReceiptReport`, `getDeliveryReport` and
  `getInternalTransferReport` for the plain copy (bundle `stock.sensitive`, which the warehouse
  operator and manager templates hold), and `getValuedReceiptReport`, `getValuedDeliveryReport`
  and `getValuedInternalTransferReport` for the copy with values (bundle `stock.valuation`). A source
  answers `null` for a transfer of another kind, and the valued one also before the transfer is done.
- The copy with values prices each lot at what the books took for it (the magnitude of its valuation
  layers); the unit cost beside it is that amount per unit rounded to the currency, the amount stays
  authoritative, and the total is also written in words (`amountWords` in `ui/amount-words.ts`).
- The transfer modal and detail page offer **Print**, and **Print with values** once done, only to
  who may call the matching function; `?values=1` asks for the copy with values and answers 404
  otherwise. The same sources feed the `stock.receipt`, `delivery`, `internalTransfer` reports and
  their `…Valued` copies wherever the `report` module is composed; its template filters gain
  `words`.


### Inventory adjustments require independent approval

Inventory's adjustment command and the inventory staff channel open a blind,
single-product count through `stock.requestInventoryCount`. They return its ID;
opening or saving a count changes neither quants nor accounting entries. The
warehouse's main stock location and the existing partial-count overlap policy apply.
The staff response has `outcome: counting`, `sessionId` and `href`.

Submit requires a fixed `reasonCode` on every differing line: `previousCount`,
`naturalLoss`, `damaged`, `lost`, `missingDocuments` or `other`. `reason` remains
optional explanatory text, including historical notes. Blind counts are validated
on the server. A person who counted or submitted cannot approve the same session.
The low-level `adjustInventory` command belongs to `stock.approve`; opening-stock
fixtures can still call it through their privileged harness. Deployments must run
`user.syncRoleTemplates` after installing the changed catalogue.


### Settling approved count differences

`stock.settleCountDifference` belongs to `stock.accounting` and accepts a command `id`,
`sessionId`, `accountingDate` and selected `{lineId, method, partnerId?}` rows. Only done
sessions qualify. Shortages debit 632, 1388, 334 or 811 and credit 13811; surpluses debit
33811 and credit 711. Compensation requires an active person. Each selected line is
settled in full at its approved historical value, never at a later average cost.

The record uses one KetGrid for the batch and a RelationSelect for the person responsible
for its compensation lines. Separate people can be handled in separate batches. Blank
methods remain pending. `settlementState` is `pending`, `partial` or `done`; the counts
list has an `unsettled` preset. Monetary columns still require stock valuation access.

The command posts to journal KHO on the processing date and refuses locked periods.
A persisted command fingerprint and a session lock prevent repeated postings; reusing
an ID with different content is refused. A7 reads the count-origin 13811/33811 balances
as of the period end and links to affected counts. The warning is available only through
the valuation permission. After deploying catalogue changes, run `user.syncRoleTemplates`.


### Inventory minutes (05-VT)

While counting, `stock.saveCountDetails` saves up to 20 committee members (name,
job title and role) and a proposed resolution. The record modal uses KetGrid for
members and for `qualityGood`, `qualityPoor`, `qualityLost` on each counted line.
Nonnegative quality quantities must sum to the count; the grid marks the edited
cell, and save/submit validate the same invariant. Existing clients omitting all
three fields classify a newly saved count as good. Historical records without a
breakdown remain unknown until edited; the report prints a dash for unknowns.

Approval freezes book and physical values in company currency from the historical
valuation and the actual adjustment layers. Later valuation changes do not rewrite
those snapshots. Ordinary count reads strip these private amounts.

An approved count offers form 05-VT at
`/admin/stock/count-session/{id}/print`. `stock.getCountReport` requires the
`sensitive` bundle; `?values=1` calls `stock.getValuedCountReport`, requiring
`valuation`. A denied value request never falls back to a valued response. The
browser copy includes company details, count start time in the company's timezone,
committee, quantity and optional value comparisons, quality, proposed resolution
and signatures. Each product/lot has compact comparison and quality tables to
keep the copy usable at narrow paper widths. Legacy approved counts with no value
snapshot print unknown values as dashes rather than recomputing current cost.

After deployment, run `user.syncRoleTemplates` to provision the new grants.
