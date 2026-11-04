---
title: Sales overdelivery
---

Customer deliveries (`outgoing`, internal/transit source and customer destination)
may complete above demand. Receipts, internal transfers and supplier/customer
returns remain capped. Completion remains atomic and idempotent; it releases only
the current line's reservation and debits the actual completed quantity. Quant CAS
refuses a negative physical balance or consuming stock reserved by another move.
Lot/serial validation still applies. Native picked-line edits reserve their full
quantity before completion, while explicit completion quantities may draw from
unreserved stock. Backorders contain only positive unfulfilled demand.

Sales keeps the original ordered quantity. Use the existing Sync deliveries command
to refresh delivered quantities from completed moves, converted to the order unit.
There is no new automatic Stock-to-Sales sync in this change. Delivery-based invoices
include all remaining delivered quantities, including the excess. Order-based lines
become `upselling` only once no billable line remains and delivered exceeds ordered.
An invoice above ordered for a delivery-based line is fully invoiced, not upselling.
Status checks each line independently; overbilling one line never cancels another
line's invoiceable balance.

`invoiceQuantities` supplies exact decimal remaining, total excess and unbilled excess
facts to both the invoice writer and order projection. The native invoice dialog
shows the excess still included in this invoice, not the total already invoiced.
Account/journal fields use native relation pickers with no implicit selection;
revenue and receivable choices are filtered by account type. Server validation
remains authoritative.

Keeping or increasing the existing ordered quantity after excess delivery is valid
for the catalogue/combo demand service. Reductions still respect settled delivery
and invoice history. Demand resizing subtracts completed movements and reuses pending
moves, so additional demand is never delivered twice. Confirmed-order grid editing
is a separate pending Sales parity item; this slice does not unlock that grid.

Stock detail and native modal content use working Surfaces; only page headers sit
directly on canvas. Saved picked quantities and draft native picked-line edits show
an advisory overdelivery notice. VI/EN Help describes the stock limit and invoice
consequence.

No schema migration is introduced. Automatic invoicing after online full payment,
signature/payment event ordering and portal integration remain separate D33/D17
work. No client-supplied payment flag is accepted as financial evidence.
