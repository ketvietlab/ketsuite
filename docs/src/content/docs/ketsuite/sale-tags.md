---
title: Sales tags
description: Company tags on quotations and sales orders, their configuration screen and search.
---

`sale.Tag` is a company-scoped name (at most 30 characters) with an archived flag and a revision id. Names are unique in the company without regard to case, archived tags included; the unique index `(companyId, nameKey)` backs the check. `sale.saveTag` creates or renames an active tag at its current revision id; `sale.setTagActive` archives or restores one. Both need bundle `sale.tags` (configure, configuration audit), which the sales manager and company administrator templates grant. `sale.listTags` returns the tags by name with the number of quotations and orders that carry each one; anyone who reads Sales may list them.

`sale.OrderTag` links an order to up to ten tags in a chosen order. `sale.setOrderTags` (bundle `sale.quote-operate`, idempotent) replaces the set on a quotation or order in any state, confirmed ones included, and leaves the order's revision alone: tags are not sales terms. An archived tag cannot be added, but an order that already carries it keeps it. Assigning and archiving lock the same tag rows, so neither slips past the other. `sale.getOrderTags` reads one order's tags; `sale.getOrder` is unchanged.

The configuration screen lives behind the rail's gear at `/admin/sales/tags`: an island list (search without accents, status facets, sort by name or usage) whose rows open the `sale.tag` record modal to rename, archive or restore. On the quotation and order page, **Edit tags** in the order information card opens a dialog with a multi-select relation picker. The quotation list searches tag names in memory with its other columns; the sales order list matches them in SQL, without accents. VI/EN screen Help covers the screen and the order page.
