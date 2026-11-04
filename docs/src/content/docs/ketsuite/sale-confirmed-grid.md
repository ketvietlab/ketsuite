# Confirmed Sales line grid

Unlocked, locally owned confirmed orders use the native line grid with the existing
`sale.applyLineGrid` permission and order revision. The confirmed branch updates
existing line IDs in one transaction. A failed line rolls back all earlier updates;
concurrent saves have one revision winner. Each changed line advances the revision,
while an equivalent patch is a no-op. Quotation replacement remains separate.

Ordinary lines can edit quantity, description, unit price, discount and tax. The
grid also adds product lines, sections and notes, removes lines and reorders them,
as a quotation's grid does. A line with no delivered move, no invoice line (a
cancelled or refunded one included) and no delivered or invoiced count may also be
removed or take another product or unit: its pending demand is cancelled and the
cancelled moves are detached from it. A line changing product keeps its ID and
takes the new product's name and pricelist price. New goods join the order's open
outgoing delivery; one this save closed reopens, and with none open the order gets
a new delivery. A line partly picked on its delivery is refused by name. Section/note
headings can be renamed. Free lines remain productless and create no stock demand.
Confirmed benefits stay frozen. Combo parents edit quantity only, or go with their
items while none is delivered; children and allocated historical prices stay fixed.
This does not claim arbitrary confirmed combo repricing.

Refusals that concern one line name it (`params.name`); a reduction below what was
settled also gives the least quantity (`params.minimum`).

Keep original ordered quantities after overdelivery and permit increases. Only a
reduction is checked against settled quantities: source stock moves and source
invoices, converted to line units, protect history before cached facts sync. Draft
invoices count, cancelled invoices do not, refunds subtract. Existing delivery and
invoice records are never rewritten. Increase demand by the remaining undelivered
quantity, reusing pending moves rather than creating duplicates.

Automatic prices preserve historical values; explicit price edits affect the order
and future invoiceable quantities only. Source invoice references are also checked
when reducing combo demand through the existing line-edit service.

The native grid replaces margin columns with read-only Delivered/Invoiced columns
on confirmed orders. Identity, combo and benefit locks are server-owned; posted
hidden metadata cannot bypass the domain checks. The grid stays in the existing
working Surface, with native save/refusal/draft behavior and bilingual screen Help.

No schema migration. Deployment scope for consumer verification is Commerce.
