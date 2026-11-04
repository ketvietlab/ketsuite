---
title: Purchase approval
description: Approval thresholds per company, the two approval levels, and who may confirm and approve a purchase order.
---

A purchase order is approved by amount. `purchase.Configuration` holds one row per company (`<company>:purchase`) with two optional thresholds:

- `approvalAmount`: an order whose total, taxes included, reaches it needs a purchasing manager's approval (level `manager`).
- `finalApprovalAmount`: an order reaching it also needs a final approver (level `owner`). It needs `approvalAmount` and must exceed it.

Both are empty by default, so no order needs approval until a company sets them. Amounts are in the company currency, which is the currency every order is created in.

## Confirming

`purchase.confirmOrder` (bundle `purchase.operate`, so a purchasing operator can call it) confirms a draft or sent RFQ. The server reads the saved total and the company's thresholds:

- below every threshold the order becomes a purchase order and its receipt is created;
- from a threshold it moves to `to approve` and records `approvalLevels` (1 or 2) on the order;
- `requiresApproval: true` asks for one purchasing manager even below the thresholds.

The caller no longer decides whether approval is needed. Confirming an order that is already `to approve` answers its state and changes nothing, so a retry can never turn a pending approval into an order. Lines cannot change while an order waits for approval (`editableOrder` accepts only draft and sent RFQs).

An order keeps the level count it was submitted with: changing the thresholds affects later submissions, never an order already waiting. `purchase.resetToDraft` clears the order's approvals and its level count; confirming again uses the thresholds in force then. An order submitted before thresholds existed has no level count and waits for one approval.

## Approving

| Function | Bundle | Gives |
| --- | --- | --- |
| `purchase.approveOrder` | `purchase.approve` | level `manager`; refused with `purchase.error.approval.finalPending` when only the final level is left |
| `purchase.finalApproveOrder` | `purchase.final-approve` | every level still pending, so a final approver can approve a two-level order alone |

Each approval is a `purchase.OrderApproval` row (order, level, approver, time). When nothing is pending the order becomes a purchase order in the same transaction, receipt included. Both functions answer `pending` with the levels still missing.

Whoever drafted an order never approves it, at either level: `purchase.Order.createdBy` keeps the drafting actor and both functions refuse that actor with `purchase.error.approval.ownOrder`. Orders drafted before the creator was kept have none and are not checked.

The commerce purchasing manager template grants `purchase.approve`. No public template grants `purchase.final-approve`; a deployment gives it to whoever approves its largest orders.

## Settings and screens

`purchase.getConfiguration` needs Purchase view or configure; `purchase.saveConfiguration` (bundle `purchase.configure`) takes either threshold at `expectedRevision`. A threshold left out keeps its value, an empty one clears it, an unchanged save writes nothing, and a stale revision answers `purchase.error.configurationChanged`. Invalid amounts answer `purchase.error.configuration.amount`; a final threshold without, or not above, the first answers `purchase.error.configuration.finalAmount`.

The settings page lives behind the rail's gear at `/admin/purchase/configuration`, in Purchasing's own block. `purchase.getOrder` returns `approval`: the levels the order needs (for a draft, the levels it would need at its current total), the approvals given with the approver's name, the levels pending, and whether the reader drafted it. The order page shows these in its **Approval** block; from a threshold its only confirming command is **Request Approval**, and in `to approve` it offers **Approve** and **Final approval** to readers allowed to give a pending level who did not draft the order. VI/EN screen Help on both pages describes the thresholds.
