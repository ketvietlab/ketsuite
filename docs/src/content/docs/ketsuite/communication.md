---
title: Mail, notifications and activities
description: Recipient isolation, trusted links, delivery and activity authority.
---

# Communication contracts

Compose `mailWithTargets(policies)` for an application inbox. Each `InboxTargetPolicy`
declares its model, required read function, effects, current record-access query and optional
destination. Every inbox list/count rechecks the actor's live grants and the owner's record
policy. An unconfigured `mail` module returns an empty inbox. Internal, private or unknown
record types must receive an explicit policy; notification history alone grants no access.

Inbox count/list default to unread notifications. `searchInbox`, `searchOutbox` and
`activity.searchMine` return normalized page metadata and bounded result pages. Staff
notification read mutations advertise the `update` capability. Partner and product-template
destinations are supported alongside sales, warehouse and CRM destinations.

New chatter threads include the company in their deterministic IDs. Target lookup reuses
existing company-scoped threads, preserving message/follower/activity references and inbound
replies; no destructive ID migration is required. Invited users without a partner can read
chatter. Following and posting still require a partner. Mention selection uses active contact
records and internal-note external mentions require explicit confirmation. Native form reset
also resets the shared relation picker.

## Delivery and trusted links

The deployment supplies `serve.openTransport`; the public modules do not own provider SDKs
or credentials. Delivery snapshots remain private storage. Both `listOutbox` and public
`queueTemplate` results omit rendered subject/text/HTML, BCC, headers and raw provider errors.
Do not use these staff APIs to retrieve message bodies.

Email notifications are dispatched by the bounded `mail_transport.notificationSweep` and
`dispatchNotification` jobs. Configure an active template named `mail.notification`, with
context keys `recipientName`, `targetName`, `subject` and `body`. A recipient receives one
bound delivery. Missing templates/addresses produce a failed notification with a diagnostic
code; `retryNotification` retries an unbound notification after configuration is repaired.
Inactive staff identities never fall back to external email. Internal notes are not sent out.

Retry and cancel use transactions and compare-and-set on state/version. Neither may overwrite
a delivery being sent. Cancelling also cancels its bound notifications. Explicit retry creates
a new job generation while preserving the provider idempotency key; automatic retries and
accepted-receipt replay retain the immutable snapshot. Provider deduplication remains a
transport capability, not a guarantee made by SMTP.

Website password-reset links use the site's persisted primary domain and a matching,
unexpired reset-token digest and active realm/site binding. Incoming Host/forwarded headers
cannot choose the destination. Calendar invitations use the saved template's `publicOrigin`
(HTTPS, or HTTP on loopback). Legacy client `baseUrl` must agree with that origin. Editing
a template without supplying `publicOrigin` preserves its existing value.

Inbound replies use the delivery's provider Message-ID in References/In-Reply-To to recover
the original message/thread. Compose `mail_inbound` and configure the authenticated relay
webhook; direct provider payloads still need an adapter to its normalized signed contract.

## Activity authority and clock

New work requires an active type. Existing work can finish after its type is archived;
archived next types do not create chained work. The assignee may change their own work.
Managers need the explicit `activity.manage-company` bundle, or a trusted domain service
must verify record authority in the same transaction. CRM completion/cancellation use current
case edit authority and bind it to that case's thread. `activity.reassign` validates an active
user's current company membership before transferring ownership.

Default activity dates and due-state counts use `company.Company.accountingTimezone`, falling
back to `Asia/Ho_Chi_Minh`. The browser consumes the server date instead of supplying its own
local date. Explicit date parameters remain available for deterministic contract callers.

The inbox, outbox and activity worklist use one shared client store across controls/results/
footer islands. The pager island occupies the collection chrome before results. They provide
paged reads, abort/disposal, URL/history ownership, selection,
permission/empty/error states, retained command drafts and a contextual Help drawer. Supply
the host Markdown lexer through the backend module constructors for full Markdown support.

Operational inbound logs expose metadata only; subjects, references and raw diagnostics stay
private. Confirmation dialogs follow the same full-screen phone contract as other modals.
