---
title: Sales deposits
description: Collecting a deposit on a quotation or order as a customer receipt, and setting it off against the order's invoice.
---

A deposit secures a sale before the goods are delivered. For goods the invoice is made when ownership passes, paid or not (Vietnam, Decree 123/2020, article 9), so a deposit is **not invoiced**: it is a posted customer receipt in Accounting against the customer's receivable account, linked to the order (`sale.OrderDeposit`, one row per `account.Payment`). Once the order's invoice is posted, the receipt is set off against it, and the invoice then owes only what is left.

## Functions

`sale.collectDeposit({ id, orderId, amount? | percent?, journalId, receivableAccountId, date?, memo? })` takes a deposit on a sent quotation or a confirmed order of the company that is not owned by an external channel. Exactly one of `amount` (positive) or `percent` (more than 0, at most 100, of the order's `amountTotal`) is given. It registers an inbound customer payment (`account.registerPayment`) named and keyed `id`, into the bank or cash journal `journalId`, crediting `receivableAccountId`, with the order's name as its payment reference, and posts it. The order's deposits that are not reversed never add up to more than its total. Retrying with the same `id` returns the same receipt; an `id` already used by another order's deposit is refused. Errors: `sale.error.deposit.{missing, reused, state, amountOrPercent, percent, amount, exceeds}`.

`sale.applyDeposit({ orderId, paymentId, invoiceId })` sets a deposit of the order off against one of the order's posted customer invoices (an `out_invoice` with a line billing a line of the order): a partial reconcile `<paymentId>:apply:<invoiceId>` between the invoice's receivable line and the receipt's, for the smaller of what the invoice still owes and what the receipt has not yet set off. Both must use the same receivable account. Retrying changes nothing. Errors: `sale.error.deposit.{missing, invoice, invoicePosted, account, nothing}`.

Both functions are idempotent and agent-enabled, and belong to the accountant's bundles (`approve`, `invoice`, `sale.domain-policy`), not to sellers. `sale.getOrder` returns `deposits`: each receipt's `id`, `name` (its posted entry number, e.g. `BNK/2026/00001`), `moveId`, `amount`, `unapplied`, `date`, `journalId`, `journalName`, `receivableAccountId`, `state` and `currency`. A reversed receipt (`account.reverseMove` on its entry) shows `state: 'reversed'` and nothing unapplied, and no longer counts toward the order's total.

## Screen

The order page has a **Deposits** card beside **Invoices** once the order has a deposit or the reader may collect one. It lists each receipt (linked to its accounting entry for readers of invoices), the date, the journal, the amount and what is not yet set off. **Collect deposit** (sent quotation or confirmed order) asks for a percent of the total or an amount, a bank or cash journal, the receivable account, the date and a note, with a notice that no invoice is made. **Set off against invoice** appears while a receipt still holds something and a posted invoice exists. Sellers see the card without its actions. The order Help (VI/EN) has a **Deposits** section.
