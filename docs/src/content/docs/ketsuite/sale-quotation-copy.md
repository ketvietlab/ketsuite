---
title: Duplicate a quotation
---

`sale.copyOrder({ id, sourceId, expectedRevision })` creates a fresh draft from a
locally managed quotation or order. It requires `sale.operate` or
`sale.quote-operate`; native record visibility is not the authorization boundary.
The destination ID is a caller-generated retry key, not an editable form field.

The company Sales configuration lock precedes the source revision lock. Commerce
claims the loyalty program namespace before either lock. The caller owns one
transaction for all order, line, benefit and receipt writes. A returned refusal
must abort that transaction. `createOrder`'s internal `requireNew` mode rejects a
concurrent winner instead of appending copied lines to an unrelated order.

The new number, date, unlocked draft state and empty fulfilment facts belong to
the copy. Retain customer, warehouse, price list, payment terms, commercial notes
and shipping policy. Shift a finite validity period by at least one day; a missing
period stays unset. Reset customer reference, commitment and confirmation time.
Keep section/note ordering, optional quantities and selected combo products while
regenerating all parent/child IDs. Automatic lines reprice for the new date;
negotiated unit prices stay fixed. Rebuild manual order discounts from their exact
untaxed amount over the new tax groups. Refuse an excessive discount or unavailable
product rather than silently dropping commercial content.

Commerce also retains the optional template extension's signature/payment/deposit
preferences. This is not copied signature or payment evidence, and does not imply
a completed customer portal. The extension's own helper owns its field whitelist.

Exclude generated loyalty rows. Re-evaluate automatic promotions and reusable
`promo_code` applications under current eligibility. Expired or otherwise
ineligible reusable codes are dropped. Do not carry coupon/next-order cards,
member redemptions, reservations or posted ledger entries. Confirmation of the
copy earns independently under current policy. The source remains unchanged.

The company-scoped `sale.OrderCopy` receipt stores the destination/source IDs,
source revision and copy timestamp. An identical retry returns the existing copy;
a different source/revision for the same destination is refused. The ordinary
schema migration must add this table and its typed order references before the
new command is enabled on an existing database. No backfill or tenant migration
is performed by the request, and local fixture migration is not production rollout.

The native More action uses a small `RecordModalForm`, blocks pending parent
changes and navigates to the new quotation while retaining only language/company/
branch context. VI/EN Help explains repricing and history. Full refund, partial
credit notes, portal signing/payment and renderer release are separate acceptance
items; this command does not complete them.
