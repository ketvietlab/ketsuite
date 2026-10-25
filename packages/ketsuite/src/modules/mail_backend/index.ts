import { communicationMessages } from './communication-messages.ts'
import { defineModule } from '@ketvietlab/ketjs'
import { collectionProps, islands } from './islands.ts'
import { routesWithHelp } from './routes.ts'
import type { CommunicationHelpOptions } from '../../ui/communication-screen.tsx'

export function mailBackendWith(options: CommunicationHelpOptions = {}) {
  return defineModule({
    name: 'mail_backend',
    version: '0.1.0',
    depends: ['mail', 'backend'],
    title: 'Thảo luận trong quản trị',
    summary: 'Chatter trên bản ghi và hộp thư thông báo.',
    category: 'Năng suất',
    assets: new URL('../../ui/client/', import.meta.url),
    styles: ['mail.css'],
    islands,
    joints: Object.fromEntries(
      ['controls', 'results', 'footer'].map((part) => [`collection.${part}`, { props: collectionProps }]),
    ),
    menus: {
      mail: { label: 'mail_backend.menu.app', icon: 'mail', sequence: 70 },
      // What reached me, what I have to do, then what went out.
      'mail.inbox': {
        parent: 'mail',
        label: 'mail_backend.inbox.title',
        path: '/admin/inbox',
        sequence: 10,
        needs: 'mail.searchInbox',
      },
    },
    routes: routesWithHelp(options),
    fills: {
      'mail_backend:collection.controls': '{% island "communication.controls" %}',
      'mail_backend:collection.results': '{% island "communication.results" %}',
      'mail_backend:collection.footer': '{% island "communication.footer" %}',
      // Only for whoever may read their inbox: the count would be refused, and the link with it.
      'backend:sidebar.foot': `{% if may.mail.countUnread %}{% island "mail.inbox-indicator" %}{% endif %}`,
    },
    messages: {
      vi: {
        ...communicationMessages.vi,
        'app.title': 'Thảo luận trong quản trị',
        'app.summary': 'Chatter trên bản ghi và hộp thư thông báo.',
        'app.category': 'Năng suất',
        'menu.app': 'Thông báo',
        'inbox.title': 'Hộp thư thông báo',
        'inbox.empty': 'Không có thông báo chưa đọc.',
        'inbox.emptyHint': 'Tin nhắn mới từ các bản ghi bạn theo dõi sẽ xuất hiện tại đây.',
        'inbox.message': 'Tin nhắn',
        'inbox.markRead': 'Đánh dấu đã đọc',
      },
      en: {
        ...communicationMessages.en,
        'app.title': 'Discuss in admin',
        'app.summary': 'Record chatter and the notification inbox.',
        'app.category': 'Productivity',
        'menu.app': 'Notifications',
        'inbox.title': 'Notification inbox',
        'inbox.empty': 'No unread notifications.',
        'inbox.emptyHint': 'New messages from records you follow will appear here.',
        'inbox.message': 'Message',
        'inbox.markRead': 'Mark as read',
      },
    },
  })
}
export default mailBackendWith()

export { islands } from './islands.ts'
export { inboxScreen } from './screens/index.ts'
