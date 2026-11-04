---
title: Sales discounts
description: Revisioned quotation discounts, tax grouping and contra-line invoices.
---

`sale.applyDiscount` is a Sales quotation operation. It requires the current order revision, a locally owned unlocked draft/sent order and no stock/invoice history. It accepts an order percentage, a fixed untaxed amount or a percentage for each ordinary line. Negative values and percentages over 100 are refused. Labels are bounded to 500 characters.

Order adjustments replace prior order-discount rows, never ordinary lines or rewards. Eligible commercial subtotals exclude structural rows, rewards and combo parents; combo items carry amounts once. Allocate integer currency minor units in proportion to each tax group's untaxed merchandise; the last group receives the remainder. A discount cannot exceed the untaxed merchandise. Zero removes the order discount. The mutation and revision claim share one transaction, including refusal after a later tax group.

Discounts reduce the untaxed base even when a percentage tax is price-inclusive. Fixed per-unit levies are unchanged. Account owns the shared tax calculation. Generated lines have no placeholder product or unit, quantity one, a non-positive price and `lineKind: discount`. The nullable classification moves to core Sales so it is available without the loyalty bridge; existing loyalty deployments retain the same field. Accounting journal lines also retain nullable classification, including reversals. Existing rows require no inferred backfill.

A percentage on ordinary lines sets their discount and fixes their negotiated price. Combo parents own the change and regenerate item amounts; child controls remain protected. Rule-generated discount/reward cells cannot be edited through either the grid or individual line writer. The grid can retain, reorder or remove them and never trusts posted lock flags. Server-owned scope fields are re-stamped when preserving a row.

Sales invoices require at least one ordinary billable line and a non-negative total. Discount journal rows preserve their classification and post the opposite revenue/tax sign. Direct Accounting invoices reject negative ordinary prices, positive discount prices and discount-only/negative documents. The normal draft journal path also enforces commercial line signs; journal entries retain their existing debit/credit semantics. Changes to merchandise quantities do not silently resize a previously negotiated fixed order discount; review it before invoicing.

The native quotation dialog uses the existing record command, `sale.quote-operate`, translated labels, exact decimal text and the same order revision. Pending parent changes must save first. VI/EN screen Help documents the action and refusals. This slice does not implement automatic promotion programs, coupon issuance/redemption, buy-X-get-Y or loyalty point lifecycle; those remain D31b.
