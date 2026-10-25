import { communicationCollection } from '../../ui/client/communication-collections.tsx'
import type { CommunicationProps } from '../../ui/client/communication-collections.tsx'
import { defineIsland, each, html, signal } from '@ketvietlab/ketjs-view'
import { createChatterView, createInboxIndicatorView } from '../../ui/client/mail-view.mjs'

const runtime = { each, html, signal }

type ChatterProps = { resModel: string; resId: string; lang?: string }
type InboxIndicatorProps = { lang?: string }

export const collectionProps = {
  id: 'id',
  kind: 'text',
  path: 'text',
  query: 'json',
  labels: 'json',
  canRead: 'bool',
  canWrite: 'bool',
  canApprove: 'bool',
  permissions: 'json',
  lang: 'text',
} as const
export const islands = {
  'communication.controls': defineIsland<CommunicationProps>()({
    props: collectionProps,
    key: ['id'],
    client: 'communication-collections-bundle.mjs',
    export: 'collectionControls',
    view: (props) => communicationCollection(props, 'controls'),
  }),
  'communication.results': defineIsland<CommunicationProps>()({
    props: collectionProps,
    key: ['id'],
    client: 'communication-collections-bundle.mjs',
    export: 'collectionResults',
    view: (props) => communicationCollection(props, 'results'),
  }),
  'communication.footer': defineIsland<CommunicationProps>()({
    props: collectionProps,
    key: ['id'],
    client: 'communication-collections-bundle.mjs',
    export: 'collectionFooter',
    view: (props) => communicationCollection(props, 'footer'),
  }),
  'mail.chatter': defineIsland<ChatterProps>()({
    props: { resModel: 'text', resId: 'id', lang: 'text?' },
    key: ['resModel', 'resId'],
    client: 'mail-bundle.mjs',
    export: 'chatter',
    view: (props) => createChatterView(runtime, props),
  }),
  'mail.inbox-indicator': defineIsland<InboxIndicatorProps>()({
    props: { lang: 'text?' },
    key: [],
    client: 'mail-bundle.mjs',
    export: 'inboxIndicator',
    view: (props) => createInboxIndicatorView(runtime, props),
  }),
}
