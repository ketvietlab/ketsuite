// @ts-nocheck Shared browser/SSR chatter; domain requests remain effect-checked.
import { createRelationSelectView, Checkbox, TextArea } from '@ketvietlab/design-system'
const LABELS = {
  vi: {
    title: 'Thảo luận',
    followers: 'người theo dõi',
    follow: 'Theo dõi',
    unfollow: 'Bỏ theo dõi',
    comment: 'Gửi tin nhắn',
    note: 'Ghi chú nội bộ',
    placeholder: 'Viết cập nhật cho bản ghi này…',
    attachment: 'Tệp đính kèm',
    send: 'Gửi',
    sending: 'Đang gửi…',
    close: 'Đóng',
    loading: 'Đang tải trao đổi…',
    empty: 'Chưa có trao đổi nào.',
    loadMore: 'Tải thêm',
    retry: 'Thử lại',
    system: 'KetSuite',
    inbox: 'Hộp thư thông báo',
    mentions: '@Nhắc đến',
    externalConfirm: 'Tôi đồng ý gửi ghi chú nội bộ cho người ngoài được nhắc đến.',
    unavailable: 'Không tải được số thông báo',
    email: 'Email',
    deliveryStates: {
      queued: 'đang chờ',
      sending: 'đang gửi',
      retryable: 'chờ thử lại',
      sent: 'đã gửi',
      failed: 'gửi lỗi',
      cancelled: 'đã hủy',
    },
  },
  en: {
    title: 'Chatter',
    followers: 'followers',
    follow: 'Follow',
    unfollow: 'Unfollow',
    comment: 'Send message',
    note: 'Internal note',
    placeholder: 'Write an update for this record…',
    attachment: 'Attachment',
    send: 'Send',
    sending: 'Sending…',
    close: 'Close',
    loading: 'Loading conversation…',
    empty: 'No messages yet.',
    loadMore: 'Load more',
    retry: 'Retry',
    system: 'KetSuite',
    inbox: 'Notification inbox',
    mentions: '@Mention',
    externalConfirm: 'I agree to send this internal note to the mentioned external recipients.',
    unavailable: 'Notification count is unavailable',
    email: 'Email',
    deliveryStates: {
      queued: 'queued',
      sending: 'sending',
      retryable: 'retry pending',
      sent: 'sent',
      failed: 'failed',
      cancelled: 'cancelled',
    },
  },
}

const labelsOf = (props) => LABELS[String(props.lang).toLowerCase().startsWith('en') ? 'en' : 'vi']
const localeOf = (props) => (String(props.lang).toLowerCase().startsWith('en') ? 'en-US' : 'vi-VN')

const apiFor = (resModel) => {
  if (resModel === 'partner.Partner') return 'partner_mail_backend'
  if (resModel === 'product.Template') return 'product_mail_backend'
  if (resModel === 'product.Product') return 'product_variant_mail_backend'
  if (resModel === 'stock.Picking') return 'stock_mail_backend'
  if (resModel === 'stock.Lot') return 'stock_lot_mail_backend'
  if (resModel === 'sale.Order') return 'sale_mail_backend'
  if (resModel === 'account.Move') return 'account_mail_backend'
  return null
}

const errorText = (error) =>
  error && typeof error === 'object' && 'message' in error
    ? String(error.message)
    : 'The collaboration request failed'

const requestScope = () => {
  const pending = new Set()
  let disposed = false
  return {
    fetch: async (url, options = {}) => {
      if (disposed) throw new DOMException('Island disposed', 'AbortError')
      const controller = new AbortController()
      pending.add(controller)
      try {
        return await fetch(url, { ...options, signal: controller.signal })
      } finally {
        pending.delete(controller)
      }
    },
    disposed: () => disposed,
    dispose: () => {
      disposed = true
      for (const controller of pending) controller.abort()
      pending.clear()
    },
  }
}

const callApi = async (request, name, input) => {
  const response = await request(`/_ket/fn/${encodeURIComponent(name)}`, {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(input),
  })
  const payload = await response.json()
  if (!response.ok || payload.ok === false) {
    const error = new Error(String(payload.message ?? `HTTP ${response.status}`))
    error.code = payload.code
    throw error
  }
  return payload.value
}

const upload = async (request, file, messageId) => {
  const form = new FormData()
  form.set('file', file)
  form.set('resModel', 'mail.Message')
  form.set('resId', messageId)
  const response = await request('/files', { method: 'POST', credentials: 'same-origin', body: form })
  const payload = await response.json()
  if (!response.ok) throw new Error(String(payload.message ?? `HTTP ${response.status}`))
  return String(payload.id)
}

export function createChatterView(runtime, props, seed = {}) {
  const { each, html, signal } = runtime
  const labels = labelsOf(props)
  const messageDateFormatter = new Intl.DateTimeFormat(localeOf(props))
  const status = signal(seed.status ?? 'loading')
  const busy = signal(false)
  const composerKind = signal(seed.composerKind ?? null)
  const error = signal(seed.error ?? '')
  const page = signal(
    seed.page ?? {
      threadId: null,
      displayName: '',
      total: 0,
      messages: [],
      followers: [],
      following: false,
    },
  )
  const bridge = apiFor(String(props.resModel))
  const requests = requestScope()
  let pollTimer = null
  const en = String(props.lang).toLowerCase().startsWith('en')
  const pickerLabels = en
    ? {
        choose: '@Mention',
        empty: 'No contacts',
        search: 'Find a contact',
        loading: 'Loading…',
        loadError: 'Cannot load contacts',
        dialogTitle: 'Mention contacts',
        close: 'Close',
        select: 'Select',
        create: 'Create',
        edit: 'Edit',
        save: 'Save',
        cancel: 'Cancel',
        remove: 'Remove',
        confirmRemove: 'Remove?',
        retry: 'Retry',
        clear: 'Clear',
        chosen: 'Chosen',
      }
    : {
        choose: '@Nhắc đến',
        empty: 'Không có liên hệ',
        search: 'Tìm liên hệ',
        loading: 'Đang tải…',
        loadError: 'Không tải được liên hệ',
        dialogTitle: 'Nhắc đến liên hệ',
        close: 'Đóng',
        select: 'Chọn',
        create: 'Tạo',
        edit: 'Sửa',
        save: 'Lưu',
        cancel: 'Hủy',
        remove: 'Bỏ',
        confirmRemove: 'Bỏ?',
        retry: 'Thử lại',
        clear: 'Xóa chọn',
        chosen: 'Đã chọn',
      }
  const mentions = createRelationSelectView(
    {
      id: `chatter-${props.resModel}-${props.resId}-mentions`,
      config: {
        name: 'mentionPartnerIds',
        ariaLabel: labels.mentions,
        multiple: true,
        options: [],
        labels: pickerLabels,
        manager: {
          listFunction: `${bridge}.mentionCandidates`,
          listInput: { targetId: props.resId },
          searchInDropdown: true,
          idField: 'id',
          labelField: 'name',
          limit: 20,
        },
      },
    },
    { disabled: () => busy() },
  )

  const load = async ({ append = false, quiet = false } = {}) => {
    if (!bridge) {
      status.set('error')
      error.set(`Unsupported collaboration target: ${String(props.resModel)}`)
      return
    }
    if (!quiet) status.set('loading')
    try {
      const current = page()
      const result = await callApi(requests.fetch, `${bridge}.timeline`, {
        targetId: props.resId,
        limit: append ? 20 : Math.max(20, current.messages.length),
        offset: append ? current.messages.length : 0,
      })
      page.set(append ? { ...result, messages: [...current.messages, ...result.messages] } : result)
      error.set('')
      status.set('ready')
    } catch (cause) {
      if (requests.disposed()) return
      error.set(errorText(cause))
      status.set('error')
    }
  }

  const post = async (event) => {
    event.preventDefault()
    if (!bridge || busy()) return
    const form = event.target
    const values = new FormData(form)
    const body = String(values.get('body') ?? '').trim()
    if (!body) return
    busy.set(true)
    error.set('')
    try {
      const id = crypto.randomUUID()
      const selected = values.get('attachment')
      const attachmentIds =
        selected instanceof File && selected.size > 0 ? [await upload(requests.fetch, selected, id)] : []
      await callApi(requests.fetch, `${bridge}.post`, {
        id,
        targetId: props.resId,
        kind: String(values.get('kind') ?? 'comment'),
        body,
        attachmentIds,
        mentionPartnerIds: mentions.getSelectedValues(),
        confirmExternalMentions: values.get('confirmExternalMentions') === 'true',
      })
      form.reset()
      await load()
      composerKind.set(null)
    } catch (cause) {
      if (requests.disposed()) return
      error.set(errorText(cause))
      status.set('error')
    } finally {
      busy.set(false)
    }
  }

  const toggleFollow = async () => {
    if (!bridge || busy()) return
    busy.set(true)
    try {
      await callApi(requests.fetch, `${bridge}.${page().following ? 'unfollow' : 'follow'}`, {
        targetId: props.resId,
      })
      await load({ quiet: true })
    } catch (cause) {
      if (requests.disposed()) return
      error.set(errorText(cause))
      status.set('error')
    } finally {
      busy.set(false)
    }
  }

  const schedulePoll = () => {
    if (requests.disposed()) return
    pollTimer = setTimeout(async () => {
      if (requests.disposed()) return
      if (document.visibilityState === 'visible' && !busy()) await load({ quiet: true })
      schedulePoll()
    }, 15_000)
  }

  const mount = (context) => {
    mentions.mount?.(context)
    void (async () => {
      if (requests.disposed()) return
      await load()
      schedulePoll()
    })()
  }

  const view = () => {
    const data = page()
    return html`<section data-kv-design-system data-ui="chatter" data-state=${status()} aria-label=${labels.title}>
      <div data-ui="chatter-kinds" role="toolbar" aria-label=${labels.title}>
        <button data-ui="chatter-kind" data-kind="comment" data-active=${composerKind() === 'comment'} data-control="action" data-variant="secondary" data-size="compact" type="button" aria-pressed=${composerKind() === 'comment'} on:click=${() => composerKind.set(composerKind() === 'comment' ? null : 'comment')} disabled=${busy() || data.canFollow === false}>${labels.comment}</button>
        <button data-ui="chatter-kind" data-kind="note" data-active=${composerKind() === 'note'} data-control="action" data-variant="secondary" data-size="compact" type="button" aria-pressed=${composerKind() === 'note'} on:click=${() => composerKind.set(composerKind() === 'note' ? null : 'note')} disabled=${busy() || data.canFollow === false}>${labels.note}</button>
      </div>
      <header data-ui="chatter-head">
        <div data-ui="chatter-heading">
          <h2 data-ui="chatter-title">${labels.title}</h2>
          <span data-ui="chatter-followers">${data.followers.length} ${labels.followers}</span>
        </div>
        <button data-ui="chatter-follow" data-control="action" data-variant="secondary" data-size="compact" type="button" on:click=${toggleFollow} disabled=${busy() || data.canFollow === false}>
          ${data.following ? labels.unfollow : labels.follow}
        </button>
      </header>
      ${
        composerKind()
          ? html`<form data-ui="chatter-composer" on:submit=${post}>
        <input type="hidden" name="kind" value=${composerKind()} autocomplete="off">
        ${TextArea({ id: `chatter-${props.resId}-body`, name: 'body', label: labels.comment, placeholder: labels.placeholder, required: true, disabled: busy(), rows: 4 })}
        ${mentions.view()}
        ${composerKind() === 'note' ? Checkbox({ id: `chatter-${props.resId}-external`, name: 'confirmExternalMentions', label: labels.externalConfirm, value: 'true', submitValue: 'true' }) : ''}
        <div data-ui="chatter-compose-actions">
          <label data-ui="chatter-attachment">${labels.attachment}<input data-ui="form-control" type="file" name="attachment" autocomplete="off" disabled=${busy()}></label>
          <div>
            <button data-ui="chatter-compose-close" data-control="action" data-variant="tertiary" data-size="compact" type="button" on:click=${() => composerKind.set(null)} disabled=${busy()}>${labels.close}</button>
            <button data-ui="chatter-send" data-control="action" data-variant="primary" data-size="compact" type="submit" disabled=${busy()}>${busy() ? labels.sending : labels.send}</button>
          </div>
        </div>
      </form>`
          : ''
      }
      ${error() ? html`<div data-ui="chatter-error" role="alert">${error()} <button data-ui="action" data-variant="secondary" data-size="compact" type="button" on:click=${() => load()}>${labels.retry}</button></div>` : ''}
      <div data-ui="chatter-timeline" aria-live="polite">
        ${status() === 'loading' ? html`<p data-ui="chatter-loading">${labels.loading}</p>` : ''}
        ${status() === 'ready' && data.messages.length === 0 ? html`<p data-ui="chatter-empty">${labels.empty}</p>` : ''}
        ${each(
          data.messages,
          (message) => message.id,
          (message) => html`<article data-ui="chatter-message" data-kind=${message.kind}>
            <header data-ui="chatter-message-head">
              <strong data-ui="chatter-author">${message.authorName || labels.system}</strong>
              <time data-ui="chatter-time" datetime=${message.createdAt}>${messageDateFormatter.format(new Date(message.createdAt))}</time>
            </header>
            <p data-ui="chatter-message-body">${message.body}</p>
            ${
              message.deliveries?.length
                ? html`<ul data-ui="chatter-deliveries">${each(
                    message.deliveries,
                    (delivery) => delivery.id,
                    (delivery) => html`<li data-ui="chatter-delivery" data-state=${delivery.state}>
                      ${labels.email}: ${labels.deliveryStates[delivery.state] ?? delivery.state}
                      ${delivery.state === 'failed' && delivery.lastError ? html`<span>${delivery.lastError}</span>` : ''}
                    </li>`,
                  )}</ul>`
                : ''
            }
            ${
              message.attachments?.length
                ? html`<ul data-ui="chatter-attachments">${each(
                    message.attachments,
                    (attachment) => attachment.id,
                    (attachment) => html`<li><a href=${attachment.href}>${attachment.name}</a></li>`,
                  )}</ul>`
                : ''
            }
          </article>`,
        )}
      </div>
      ${
        data.messages.length < data.total
          ? html`<button data-ui="chatter-more" data-control="action" data-variant="secondary" data-size="compact" type="button" on:click=${() => load({ append: true })} disabled=${busy()}>${labels.loadMore}</button>`
          : ''
      }
    </section>`
  }
  return {
    view,
    mount,
    dispose: () => {
      if (pollTimer !== null) clearTimeout(pollTimer)
      mentions.dispose?.()
      requests.dispose()
    },
  }
}

/** @param {unknown} runtime @param {Record<string, unknown>} props @param {number|null} initialCount */
export function createInboxIndicatorView(runtime, props, initialCount = null) {
  const { html, signal } = runtime
  const labels = labelsOf(props)
  const count = signal(initialCount)
  const failed = signal(false)
  const requests = requestScope()
  let timer = null
  const load = async () => {
    try {
      const result = await callApi(requests.fetch, 'mail.countUnread', {})
      count.set(Number(result.count ?? 0))
      failed.set(false)
    } catch {
      if (!requests.disposed()) {
        count.set(null)
        failed.set(true)
      }
    }
  }
  const refresh = () => void load()
  const poll = () => {
    if (requests.disposed()) return
    timer = setTimeout(async () => {
      if (document.visibilityState === 'visible') await load()
      poll()
    }, 15_000)
  }
  return {
    view: () => html`<a data-ui="mail-indicator" data-state=${failed() ? 'error' : count() === null ? 'loading' : 'ready'} href=${String(props.lang).startsWith('en') ? '/admin/inbox?lang=en' : '/admin/inbox'} title=${failed() ? labels.unavailable : labels.inbox} aria-label=${failed() ? labels.unavailable : labels.inbox}>
      <svg data-ui="mail-indicator-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M21 15a4 4 0 0 1-4 4H8l-5 3v-3.8A4 4 0 0 1 1 15V7a4 4 0 0 1 4-4h12a4 4 0 0 1 4 4Z" /></svg>
      ${failed() ? html`<span data-ui="mail-indicator-count">!</span>` : count() > 0 ? html`<span data-ui="mail-indicator-count">${count()}</span>` : ''}
    </a>`,
    mount: () => {
      refresh()
      poll()
      window.addEventListener('online', refresh)
      window.addEventListener('ket:mail-changed', refresh)
    },
    dispose: () => {
      if (timer !== null) clearTimeout(timer)
      if (typeof window !== 'undefined') {
        window.removeEventListener('online', refresh)
        window.removeEventListener('ket:mail-changed', refresh)
      }
      requests.dispose()
    },
  }
}
