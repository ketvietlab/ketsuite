import { defineModule } from '@ketvietlab/ketjs'
import { functions } from './functions/index.ts'
import { jobs } from './jobs.ts'
import { models } from './models.ts'
import { relations } from './relations.ts'

const mailTransport = defineModule({
  name: 'mail_transport',
  version: '0.1.0',
  depends: ['mail', 'partner', 'user'],
  title: 'Gửi email',
  summary: 'Template an toàn, transactional outbox và trạng thái gửi qua durable queue.',
  category: 'Năng suất',
  models,
  relations,
  functions,
  jobs,
  messages: {
    vi: {
      'app.title': 'Gửi email',
      'app.summary': 'Template an toàn, transactional outbox và trạng thái gửi qua durable queue.',
      'app.category': 'Năng suất',
    },
    en: {
      'app.title': 'Email delivery',
      'app.summary': 'Safe templates, a transactional outbox and durable delivery state.',
      'app.category': 'Productivity',
    },
  },
})

export default mailTransport
export type { MailDeliveryGuard } from './jobs.ts'

export { functions } from './functions/index.ts'
export { jobs, createMailTransportJobs } from './jobs.ts'
export { assertDeliveryState, deliveryEnvelope, queueTemplate, writeTemplate } from './delivery-service.ts'
export type { QueueTemplateInput, TemplateInput } from './delivery-service.ts'
export { jsonValue, renderTemplate, templateKeys } from './template.ts'
export { withDeliveryStatus } from './target.ts'
export { DELIVERY_STATES, PROVIDER_EVENT_TYPES } from './types.ts'
export type { DeliveryState, MailAddress, ProviderEventType } from './types.ts'
