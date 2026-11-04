---
title: Sales delivery promises
---

Commerce quotations and sales orders calculate an expected civil date from goods lines and the
current product customer lead time. Services and combo parents do not ship; combo goods items do.
`direct` (Deliver available items) chooses the earliest date; `one` (Deliver once) chooses the latest.
There is no expected date for an order containing only services.

Quotations start from their order date. Confirmation records `confirmedAt` without changing the
historic order date; confirmation retries retain that anchor. Legacy confirmed orders with no
confirmation timestamp fall back to their order date. Calendar days use the company's civil
timezone (`accountingTimezone`, default Asia/Ho_Chi_Minh), including midnight and DST boundaries.
Date-only input names a local day; stored dispatch instants represent midnight in that timezone.

The native record shows the expected date below Committed delivery date and in the page aside.
Quotation operators may save policy or commitment on unlocked local draft, sent or confirmed
orders through `sale.saveDeliveryPromise`, with `expectedRevision`. Commitments cannot precede
the order's civil day. A blank commitment clears it. There is no per-line lead override and no
warning for a commitment earlier than the expected date. Warehouse-only operators and auditors
cannot change the plan; externally owned orders are refused by the domain handler.

Confirmation and plan edits schedule open outgoing transfers to the commitment when present,
otherwise to the expected date. Completed, cancelled, incoming and external-authority transfers
are preserved. Supplemental combo deliveries use the same policy. A catalogue lead change is
visible on the next order read; saving its plan explicitly applies that expectation to open
transfers. Reads do not rewrite dispatch history. The native form retains refused input and
points to the invalid field. Concurrent edits use the order revision and refuse stale changes.

The four nullable schema additions preserve existing records and are safe to migrate again.
Local schema tests are not a production migration or release authorization.
