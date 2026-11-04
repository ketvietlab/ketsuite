---
title: Sales settings
description: The company's sales settings, new-quotation defaults and the invoicing policy each confirmed line keeps.
---

`sale.Configuration` holds one row per company. Besides the sales warnings and the product requirement it keeps:

- `quotationValidityDays` (1–365, empty = none): a new quotation without an explicit validity date is valid for that many days from its order date.
- `onlineSignature`, `onlinePayment`, `prepaymentPercent` (greater than 0, at most 100, two decimals): a quotation created without a template through `sale_template.createQuotation` starts with these. The percent applies only while online payment is on; turning payment on without a percent is refused.
- `lockConfirmed`: confirming an order also locks it.
- `goodsInvoicePolicy` (`order` or `delivery`, default `order`): how goods without their own policy are invoiced.

`sale.saveConfiguration` (bundle `sale.configure`, which the sales manager and company administrator templates grant) takes any subset of the settings at `expectedRevision`; a setting left out keeps its value, an unchanged save writes nothing and a stale revision answers `sale.error.configurationChanged` on `expectedRevision`. `sale.getConfiguration` needs Sales view or configure.

Each sold line keeps its invoicing policy in `sale.OrderLine.invoicePolicy`. Confirming an order fixes it on every non-display line: for goods, the product's own policy, else the company default; `order` for services and lines without a product (see [Invoicing policies](./sale-invoicing-policies.md)). A line added to a confirmed order is fixed the same way. Invoicing, the invoice status and the order queries read the line's policy first, then the product's, then `order`, so changing the company default later never moves a confirmed line. A `delivery` line is not invoiced before it is delivered.

The screen lives behind the rail's gear at `/admin/sales/configuration`: three cards (**Sales warnings**, **New quotations**, **Confirmed orders**), each with its own form and Save. VI/EN screen Help explains which settings apply only to quotations created later.

## Where Sales screens live

The Sales sidebar keeps daily work only: Overview, Quotations, Sales Orders, **To invoice** (the orders list on its `to invoice` preset), Customers and Analysis (D6). Configuration opens from the rail's gear (the settings page). Its **Sales** block, beside Product and Stock, holds sales settings, quotation templates, promotions, tags, sales teams and invoicing policies. Pricelists (`/admin/pricing/pricelists`, shown to whoever may save a pricelist) belong to the pricing module, which Sales does not require, so they stay in the **System** block. A sidebar entry whose path carries a query, such as **To invoice**, is the lit entry whenever the address carries every parameter it names (`queryEntryActive` in `backend/screen.ts`); KetJS alone lights entries by path.

Deliveries belong to Stock (D2): an order lists its moves with their state and a link to the Stock transfer page for readers of `stock.getPicking`, and does no delivery work itself.
