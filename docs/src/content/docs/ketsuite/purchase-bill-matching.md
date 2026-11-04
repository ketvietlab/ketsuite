---
title: Vendor bill matching
description: How a vendor bill drafted from purchase orders is compared with them before it is posted, the price tolerance, and holding a bill.
---

A vendor bill line drafted by `purchase.createVendorBill` carries its purchase line (`account.MoveLine.purchaseLineId`). In Commerce, `account.postMove` is composed with `moduleWithPurchaseBillMatching` (`purchase/bill-matching.ts`): before a draft `in_invoice` is posted, each of its product lines with a purchase line is compared with that line.

- **Quantity.** Everything billed for the purchase line may not exceed what it allows: what was received, or what was ordered for a product billed on ordered quantities (`product.Template.purchaseMethod`). Everything billed is this bill's lines for the purchase line, together, plus other **posted** bills, less posted credit notes. A bill line in another unit is converted to the purchase line's unit.
- **Unit price.** When the company sets `purchase.Configuration.priceTolerance` (a percentage from 0 to 100), the bill line's net unit price (price less its discount, per purchase line unit) may not differ from the purchase line's by more than that, up or down. Empty means prices are not compared. The comparison is exact decimal arithmetic; a purchase line priced at zero matches only a zero price.

A bill that does not match is refused with `purchase.error.bill.quantity` (params `line`, `order`, `billed`, `allowed`) or `purchase.error.bill.price` (params `line`, `order`, `tolerance`), on field `lines`, and stays a draft. Bills without purchase lines, credit notes and lines added by hand (no `purchaseLineId`) are not compared. Other deployments that compose Purchase keep posting unchanged.

The check reads the ledger before `account.postMove` runs and does not lock the purchase line, so two bills for the same line posted at the same instant can both pass.

## Holding a bill

`purchase.holdBill` (`id`, `reason`, at most 500 characters) records a `purchase.BillHold` for a draft vendor bill: why it waits for the vendor. Holding again with another reason replaces it. `purchase.releaseBill` removes it, and a successful post lifts it. A hold does not by itself stop posting; a bill that matches can be posted from hold, as in the mock. Both functions are in the bundle that drafts vendor bills (`purchase.configure`).

## Reading the matching

`purchase.getBillMatch` (`id`) answers `status` (`none` for a bill not compared, `ok` or `mismatch`), the company `tolerance`, the `hold`, and per bill line: the purchase order, ordered, received and allowed quantities, `billedBefore`, this line's `quantity`, the order's and the bill's net unit prices, the `drift` in percent and which check fails. `purchase.listBillMatches` (`ids`, at most 200) answers `status` and `held` per vendor bill. Both need Purchase view or configure.

The accounting vendor bill page shows a **Purchase order matching** section when Purchase is composed and the reader may call `purchase.getBillMatch`, with **Hold Bill** (reason required) or **Release Hold** for a draft when the reader may call `purchase.holdBill`. The vendor bill list adds a **Matching** column (Matches, Does not match, On hold) for the shown page. The purchasing settings page (`/admin/purchase/configuration`) sets the tolerance in its own form, which saves only the tolerance.

## Not yet

Draft vendor bill lines cannot be edited yet: a bill drafted from an order bills its received or ordered quantity at the order's price, so it matches when drafted. The check is what keeps posting honest once bill lines can be edited to the vendor's figures (tracked separately).
