---
title: Sales reporting
description: The sales overview by month, the sales analysis by period and group, and the order list filters they open.
---

Sales figures count **confirmed orders** (`state = 'sale'`) in the company's currency, by their untaxed amount, dated by `dateOrder` in the company's calendar (`company.Company.accountingTimezone`, else `Asia/Ho_Chi_Minh`). Quotations and cancelled orders never count. A period key is a month (`2026-10`), a quarter (`2026-Q4`) or a year (`2026`), the same keys as the list grouping's date buckets; it runs from its first local midnight to the next period's, and is compared with the period of the same length just before. Any other key is refused with `sale.error.analysis.period` on the `period` field.

## Functions

`sale.analyzeSales({ period?, groupBy? })` groups a period (the current year by default) by `month`, `user` (salesperson), `team`, `partner` (customer) or `product` (template). Each group has `key`, `label`, `revenue` and `orders`; an order without a salesperson or team is the group `''`. By product, a group adds its lines' amounts and counts the orders with such a line, so product groups can count more orders than the total. Groups are sorted by month, else by revenue then name. It returns the period's `totals` and the previous period's `previousTotals`.

`sale.analyzeSalesMargin` takes the same arguments and returns the gross profit of the same lines: untaxed amount less `sale.OrderLineCost.unitCost` × quantity. A line without a product costs nothing; a line whose cost is unknown adds nothing and is counted in `unknownLines`, per group and in total. It is a cost read: bundle `sale.sensitive-data` (like `sale.getLineCosts`), which the sales representative and manager hold and the accountant does not.

`sale.getSalesOverview({ period? })` reads one month (the current one by default): `revenue`, `orders` and `previousRevenue`; `invoiced` and `previousInvoiced`, the posted customer invoices dated in the month that are neither reversed nor reversals, mapped to their sales order through the invoice lines' `saleLineId` (a customer refund would count negative); `openQuotations` and `toInvoice` (count and amount); every active team with its `monthlyTarget` and what its orders invoiced in the month; sales per salesperson; and up to 20 sent quotations whose `validityDate` falls within the next 7 days or has passed (`expired`).

`sale.getOrderFilterChoices({ quotations? })` lists what the order list's filter bar offers: every salesperson and team (archived teams last), and the customers and products on the company's orders (up to 500 each).

## Order list filters

The quotation and sales order lists filter by `userId`, `teamId` and `partnerId` (equals, not equals, any of, set, not set) and the orders list also by `templateId` (equals, any of): the orders with a line for any variant of the product. The choices are named in the bar; an archived team reads "(Archived)". A team that is not set is the orders outside every team. The overview's "To invoice" tile opens the `to invoice` preset.

## Screens

The overview at `/admin/sales` keeps its four tiles and adds, for readers of `sale.getSalesOverview`, the month's section: tabs for the last six months, Sales / Invoiced / Gross profit (with cost readers) against the month before, team targets with a progress bar, sales per salesperson and the quotations about to expire. The analysis at `/admin/sales/analysis` (menu **Sales → Analysis**, `sale.analyzeSales`) chooses a year or quarter, a grouping and a measure (sales, orders, gross profit for cost readers) through links that keep the choice in the address; a year or quarter by month draws every month as a column, other groupings a bar per group. With `templateId` the same path is still the one-product view (P32).

Every figure and group opens the sales order list with the list's own filters (`dateOrder` between the period's first local midnight and the next period's, half-open like the analysis, plus `userId`/`teamId`/`partnerId`/`templateId`, or "not set" for the groups without a salesperson or team), so the reader sees them as chips and can lift any. Both screens have VI/EN Help with a diagram of what counts.
