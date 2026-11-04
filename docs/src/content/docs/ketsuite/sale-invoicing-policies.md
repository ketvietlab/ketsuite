---
title: Invoicing policies
description: Which products are invoiced by ordered or delivered quantities, who sets it and when it applies.
---

A goods product keeps its own invoicing policy in `product.Template.invoicePolicy` (`order` or `delivery`); null means it follows the company default for goods in the sales settings (`goodsInvoicePolicy`, see [Sales settings](./sale-configuration.md)). A service is always invoiced by ordered quantities, whatever its row says: a value saved before D21 is ignored. Combos have no policy; their items carry it.

`sale.listInvoicePolicies` lists the company's active templates that can be sold, combos left out, ordered by code: `defaultCode` (the active variants' codes), `name`, `categoryName` (full path), `type`, `invoicePolicy` (the goods product's own policy or null), `policy` (what its next sold line takes), `setting` (`default`, `own` or `service`) and `revisionId`. `ids` narrows it to some templates. `sale.getProductInvoicePolicy` returns the same `policy` for one template, archived ones included, for the product workspace.

`sale.setInvoicePolicy` (idempotent) sets `order` or `delivery` on a goods product, or clears it with null or an empty value. It refuses other values (`sale.error.invoicePolicy.value`), services (`.service`), combos (`.combo`), unknown products (`.missing`) and a stale `expectedRevisionId` (`.changed`). A change bumps the template's `revisionId`, so an open product page must reload before saving; saving the value already set writes nothing. Bundle `sale.invoice-policies` grants it with the list to the sales manager, the company administrator and the accountant; anyone who reads Sales lists the policies.

Confirming a quotation and adding a line to a confirmed order fix the policy on the line (`sale.OrderLine.invoicePolicy`), so a later change of a product's policy or of the company default never moves a sold line.

The screen lives behind the rail's gear at `/admin/sales/invoicing-policies`: an island list (search code, name or category without accents; facets by setting; sort by code) whose rows open the `sale.invoicePolicy` record modal. For goods it offers **Sales settings (current default)**, **Ordered quantities** and **Delivered quantities**; a service shows a sentence and no field; a reader sees the field locked. VI/EN screen Help explains when a change applies.
