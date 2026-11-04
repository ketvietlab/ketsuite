---
title: Sales promotion transactions
description: Atomic Commerce sales and loyalty lifecycle.
---

Commerce composes `saleWithLoyalty()` together with `loyalty` and `loyaltySale`.
Other deployments retain the ordinary Sale module unless they explicitly opt in.
Both the native `sale.confirmOrder` / `sale.cancelOrder` functions and the
compatibility `loyalty_sale` endpoints use one transaction for the quotation,
stock transfers, lifecycle facts and loyalty ledger. A returned domain refusal
aborts that transaction; stock cannot commit before a failed loyalty write.

Native record commands retain the existing `sale.confirm` and `sale.cancel`
grants. The submitted quotation revision, including zero, reaches the domain
command. The adapter's public function keys remain compatible; code, reward and
removal commands accept an optional expected revision and reject locked,
confirmed, cancelled or externally managed quotations. Their application,
reservation, reward row and quotation revision commit together.

Confirmation rechecks applied benefits against the quotation date, customer,
pricelist and current program/reward configuration. Used programs are locked
while their eligibility and usage counters are checked. A refusal leaves the
quotation, applications and stock unchanged. A successful retry returns the
existing result without earning again. Cancelling reverses the ledger in the
same transaction. Resetting a cancelled order to draft and confirming again
uses a separate ledger posting key and a new delivery, retaining cancelled
transfers and reversed entries as history.

The shared loyalty snapshot accepts productless commercial and discount rows.
Structural rows are excluded. Combo parents carry quantity with zero amount;
Sales program conditions count the parent once and exclude child quantities.
Legacy loyalty conditions retain their existing child-line semantics.

## Sales program contract

`loyalty_sale.saveProgram` saves one program, rule, reward and their typed product,
category, Product-tag and pricelist links in one transaction. Programs use the
existing loyalty tables with `salePolicyVersion: 1`; there is no second wallet
or ledger. Existing programs keep their semantics and cannot be silently edited
through this contract. Low-level legacy writers and the legacy configuration
workspace cannot overwrite a Sales profile.

The six types are promotion, promo code, buy-X-get-Y, coupons, next-order coupons
and loyalty. Names are NFC-normalized and unique in the company, including
archived programs. Promo codes use 3–30 uppercase letters, digits, hyphens or
underscores. Configuration and archive/restore require an expected revision.
Programs with cards cannot change type. Namespace and program locks serialize
competing edits and confirmation. References are checked against the current
company; pricelists must use the program currency.

Sales discounts use untaxed merchandise amounts. Cheapest means one unit;
specific-product rewards use the selected products. Percentage rewards support
a cap, and fixed amounts cannot exceed the eligible base. Productless discount
rows allocate exact minor units across source tax groups, with the remainder in
the final group. They retain their application identity independently of manual
order discounts. Gift products use list price and 100% discount, follow ordinary
stock fulfilment, and cannot be combos. Buy-X-get-Y multiplies gift quantity by
the whole number of qualifying purchases.

`generateCoupons` creates 1–100 CP cards and initial ledger entries atomically,
with an optional partner and civil expiry date. Loyalty creates a TT card on
first earning. Money-based earning uses the floor of the final tax-inclusive
amount divided by the configured step; order and unit modes are also available.
Points earned in the current quotation cannot fund its own redemption.
Next-order programs issue one DS card on a qualifying confirmation. Cancellation
reverses earning, restores redeemed coupon balances/availability and cancels
unused DS issuance. Only confirmed applications count toward Sales usage limits.

Program readers use `loyalty_sale.view`. Applying/removing quotation benefits uses
`loyalty_sale.operate`; configuring programs, generating coupons and backfill use
`loyalty_sale.configure`. Native confirm/cancel grants remain unchanged.

## Existing databases

`Reward.lineProductId` becomes optional so monetary rewards need no placeholder
product. Existing databases require the explicit operator-owned
`migrateSalePromotionPrograms(adapter, manifest)` helper from
`loyalty_sale/program-migration.ts`. It permits only this nullability relaxation,
the nullable Sales profile fields and three new link/namespace tables. It checks
physical drift, preserves records and indexes, refuses unrelated changes and
records the verified schema in the same transaction. SQLite inbound physical
foreign keys require a separate operator plan. The helper is never invoked by
an application request or module load; fresh databases use ordinary migrations.

## Quotation recalculation

Commerce also composes `saleTemplatesWithLoyalty()`. Ordinary line, grid, catalogue,
variant matrix, discount, optional-section, delivery-promise, draft and template
writers rebuild Sales-profile benefits inside their own transaction. Configuration
and quotation writers acquire the company program namespace before other locks.
A materialization refusal rolls back the original edit, reservations and revision.
Create retries preserve existing quotations. Confirmed benefits remain historical
facts even when a permitted fulfilment-related quantity edit changes the order.

The reusable `sale/quotation-mutations.ts` writers and
`sale_template/domain.ts` in-transaction services are domain contracts: callers
must own the transaction, retain the function descriptor's effects and permissions,
and abort returned refusals. Composition does not invoke private handlers or start
nested database transactions. Other deployments retain ordinary Sale/template
composition.

Automatic promotion and buy-X-get-Y programs rebuild after each successful edit.
Entered codes materialize immediately; selected coupon/member rewards are retained
only while eligible. Removing any generated tax-group row removes the entire
application and records `dismissed`, so a later edit does not silently reapply it.
Explicit code/reward application opts back in. Reward rows are rebuilt after the
ordinary lines; optional sections never edit their immutable quantities.

Manual discounts reduce each tax group's available untaxed basis first. Sales
programs then apply in configured sequence and ID order, each using the remaining
basis after earlier programs. Its own and later program rows do not reduce its
quote during revalidation. Exact minor-unit allocation preserves tax groups and
never allocates more than a source line's remaining basis. A fully discounted
basis produces no additional monetary reward. Cheapest-item rewards use one unit
of that remaining basis, including the effect of manual discounts.

Each program owns its reservations. Changing customer releases the old wallet;
member rewards reserve their entire spend without borrowing this order's future
earning. Earning is recomputed from the final discounted order before confirmation.
Even a no-op edit advances the quotation revision if benefit facts change. A newly
eligible automatic program discovered at confirmation requires the quotation to be
refreshed; refusal rolls back stock and lifecycle writes.

## Native program screens

Commerce composes `sale_promotion_backend`. Settings → Promotions opens a paged
collection; each program uses the native RecordPage and one save command for its
conditions, earning policy and reward. Field visibility follows the six program
types and reward modes. Existing cards lock the type selector. Selected references
are primed by ID; the shared relation picker searches the server with a 25-result
limit and current-company checks. It does not load the full catalogue into the browser.

Sales managers and company administrators may configure programs. Sellers,
accountants and auditors may inspect them. The server checks each read/write
independently; hiding controls is not authorization. Save, archive/restore and
coupon issuance support idempotency keys, so retries preserve the first result
without generating another program, card batch or revision.

Saved active coupon programs offer a native issuance dialog for 1–100 cards,
optionally restricted by customer and expiry date. Parent drafts block issuance
until saved. Card collections have search, state filters and pagination, including
expired, used and cancelled issuance. Archive uses the shared confirmation dialog
and preserves historical cards. Every screen carries Vietnamese/English Help
through the shared drawer and Mermaid runtime.

## Quotation benefits and cards

The native Sales record reads `loyalty_sale.getQuotationBenefits` only with its own
view grant. It projects current-company benefits, membership earning/spending and
related cards without issuing wallets. Unrelated customer coupons are excluded;
source-order DS cards and historical applied benefits remain visible. Reversed
issuance is distinguished from a redeemed card using the ledger.

Saved, local, unlocked quotations expose Enter code, Redeem reward and Remove
benefit according to separate operation grants. All three commands carry the order
revision, retain native idempotency and refresh stale context after a refusal.
Parent drafts block changes. Removal uses the shared confirmation dialog and
returns focus to its trigger. A reward's full description, amount and point cost
remain readable below the selector, including on narrow screens.

Code validation occurs inside the quotation transaction before changing benefits.
Missing, inactive, used, duplicate, wrong-customer, date/expiry, price-list, usage,
quantity, amount and point failures have translated field messages. Refusals retain
the entered code and roll back quotation revisions. Spending is labelled reserved
on quotations and historical on confirmed orders. Confirmed and externally owned
records omit benefit writes. VI/EN Help explains recalculation and card lifecycles.

Partial refunds and customer signing/payment flows remain under implementation.
These APIs, native screens and focused local checks do **not**
complete Commerce promotions acceptance. No release, deployment or tenant
migration is implied.
