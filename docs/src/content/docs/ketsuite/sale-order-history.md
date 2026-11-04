---
title: Sales order history
description: Who changed a quotation or sales order, how and when, and where the order page shows it.
---

`sale.OrderEvent` is an append-only, company-scoped record of one command that changed an order: `orderId`, `action`, `actorId` (the caller, null for the system), `relatedId` (the invoice, deposit receipt, source quotation or template the command touched), `reason`, `details` (for example the source quotation's or template's name) and `occurredAt`. The index `(companyId, orderId, occurredAt)` serves the order page.

Events are written in two ways (`modules/sale/order-history.ts`):

- `sale.confirmOrder`, `sale.cancelOrder` and `sale.createInvoice` call `recordOrderEvent` inside the transaction that changes the order. The invoice event is keyed by order and invoice, so it is written once.
- Every other order command is wrapped by `withOrderHistory`, by function name (`ORDER_COMMANDS`). The wrapper takes a digest of the order, its lines, tags and deposits before and after the command, and records one event only if the digest changed. Refused commands, no-op repeats and calls answered from their idempotency key add nothing. Setting a deposit off against an invoice changes no order row, so it is recorded on success under a key of its payment and invoice.

The wrapper covers Sale, Loyalty for sales (`applyCode`, `applyReward`, `removeReward`, `confirmOrder`, `cancelOrder`) and Quotation templates (`createQuotation`, `addSection`, `applyQuotation`), including the Commerce compositions `saleWithLoyalty()` and `saleTemplatesWithLoyalty()`. A command that runs another one records a single event, as the outer command. Each wrapped function declares `write:sale.OrderEvent` plus the reads its digest needs.

Changes that are a consequence of another document are not order commands and are not recorded here: completing or validating a delivery, cancelling or reversing an invoice, refunds and backfills in Loyalty, and saving or archiving a template. A test in `sale-order-history-http` lists every Commerce function that writes an order and fails when one is neither recorded nor in that list.

`sale.listOrderEvents({ id })` (bundle `sale.view`, the same as `sale.getOrder`) returns an order's 30 newest events with the actor's name. On `/admin/sales/orders/{id}`, **Lịch sử thay đổi / Change history** is the last card of the page, with columns Time (company time zone), By, Action and Details. Details links an invoice or deposit only when the viewer may read accounting entries, and links a copy's source quotation. Viewers without `sale.listOrderEvents` do not see the card. VI/EN screen Help covers it.
