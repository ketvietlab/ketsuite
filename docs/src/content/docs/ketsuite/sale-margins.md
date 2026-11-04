---
title: Quotation margin input
description: Protected costs and inverse selling-price input in the Sales grid.
---

With cost access, quotation grids show live line margin and margin percentage.
They derive from quantity × unit price after discount, less quantity × unit cost.
Typing a margin solves unit price; typing a percentage solves the corresponding
rate. Prices round once to a whole currency unit and persist through the ordinary
revisioned grid writer. Taxes and saved accounting amounts remain server-owned.
The native summary shows saved order margin only when every commercial line has
a comparable cost fact. Unknown or mixed-currency costs never become a zero total.

`getLineCosts` reads saved line costs. A line captures the product cost when it is saved; once some of
its goods leave, the cost follows what they took out and the rest at today's average (stock K25,
see Stock). `listLinePricing` is a separate
cost-protected, company-bound reader for eligible unit options, exact converted
cost and the active order's pricelist price. It does not expose cost through public
product/order readers or customer reports. Parent SKU and quantity form the remote
option context. Missing costs differ from known zero costs; combo/free rows stay
locked. Cross-currency margins are unavailable.

KetGrid owns inverse arithmetic and trusted remote option setters. SKU/unit edits
clear dependent draft facts. Refused carry data cannot restore a remote cost cache.
The native form strips `unitCost` and `marginLocked` display metadata; direct domain
requests containing these fields are refused. The server independently captures
cost at save time; a draft never writes a cost snapshot. Saved totals and live grid
estimates are intentionally separate.

Zero quantity, a 100% discount, non-unique/impossible percentages, negative solved
prices or results beyond safe numeric precision preserve the old price. Confirmed
records retain delivered/invoiced columns and the permission-protected saved total.
