// @ts-nocheck Shared by the server render and the browser; its tests exercise it.
// Business wording for CRM values, shared by the server shell and the browser island.
// Every date in the demo is local to Asia/Ho_Chi_Minh, so the calendar day is the ISO prefix
// and "today" is the demo clock's day: relative labels never depend on the reader's machine.
const DAY = 86_400_000
const dayNumber = (iso) => Math.round(Date.parse(`${String(iso).slice(0, 10)}T00:00:00Z`) / DAY)

export const createSalesFormat = (lang = 'vi', clock = '2026-09-14T09:40:00+07:00') => {
  const en = lang === 'en'
  const t = (vi, english) => (en ? english : vi)
  const today = dayNumber(clock)
  const number = new Intl.NumberFormat(en ? 'en-US' : 'vi-VN', { maximumFractionDigits: 0 })
  const decimal = new Intl.NumberFormat(en ? 'en-US' : 'vi-VN', { maximumFractionDigits: 1 })
  const weekday = (iso) =>
    (en ? ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] : ['CN', 'T2', 'T3', 'T4', 'T5', 'T6', 'T7'])[
      new Date(`${iso.slice(0, 10)}T00:00:00Z`).getUTCDay()
    ]
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
  const dayMonth = (iso) => {
    const [y, m, d] = iso.slice(0, 10).split('-')
    const year = y === clock.slice(0, 4) ? '' : en ? `, ${y}` : `/${y}`
    return en ? `${months[Number(m) - 1]} ${Number(d)}${year}` : `${d}/${m}${year}`
  }
  const time = (iso) => (iso.length > 11 ? iso.slice(11, 16) : '')
  const days = (n) => (en ? `${n} day${n === 1 ? '' : 's'}` : `${n} ngày`)
  const fmt = {
    lang,
    en,
    t,
    clock,
    days,
    /** Calendar days from the demo day to `iso`: negative in the past. */
    offset: (iso) => dayNumber(iso) - today,
    since: (iso) => today - dayNumber(iso),
    number: (value) => number.format(value),
    percent: (value) => (value === null || value === undefined ? '—' : `${Math.round(value * 100)}%`),
    money: (value) => (en ? `₫${number.format(Math.round(value))}` : `${number.format(Math.round(value))} ₫`),
    /** Abbreviated for metrics and cards; the full figure belongs in the detail. */
    short: (value) => {
      const v = Math.round(value),
        abs = Math.abs(v)
      if (abs >= 1e9) return en ? `₫${decimal.format(v / 1e9)}B` : `${decimal.format(v / 1e9)} tỷ ₫`
      if (abs >= 1e6) return en ? `₫${decimal.format(v / 1e6)}M` : `${decimal.format(v / 1e6)} tr ₫`
      if (abs >= 1e3) return en ? `₫${decimal.format(v / 1e3)}K` : `${decimal.format(v / 1e3)} N ₫`
      return fmt.money(v)
    },
    date: (iso) => (iso ? dayMonth(iso) : '—'),
    fullDate: (iso) => {
      if (!iso) return '—'
      const [y, m, d] = iso.slice(0, 10).split('-')
      return en ? `${months[Number(m) - 1]} ${Number(d)}, ${y}` : `${d}/${m}/${y}`
    },
    month: (key) => {
      const [y, m] = key.split('-')
      return en ? `${months[Number(m) - 1]} ${y}` : `Th${Number(m)}/${y}`
    },
    monthShort: (key) => (en ? months[Number(key.slice(5, 7)) - 1] : `Th${Number(key.slice(5, 7))}`),
    weekday,
    /** "Today, 08:24", "Yesterday", "3 days ago", "Thu, Sep 17", "Sep 22". */
    relative: (iso) => {
      if (!iso) return '—'
      const delta = dayNumber(iso) - today,
        at = time(iso)
      if (delta === 0) return at ? `${t('Hôm nay', 'Today')}, ${at}` : t('Hôm nay', 'Today')
      if (delta === -1) return at ? `${t('Hôm qua', 'Yesterday')}, ${at}` : t('Hôm qua', 'Yesterday')
      if (delta === 1) return at ? `${t('Ngày mai', 'Tomorrow')}, ${at}` : t('Ngày mai', 'Tomorrow')
      if (delta < 0 && delta >= -6) return t(`${-delta} ngày trước`, `${-delta} days ago`)
      if (delta > 0 && delta <= 6) return `${weekday(iso)}, ${dayMonth(iso)}${at ? ` · ${at}` : ''}`
      return dayMonth(iso)
    },
    /** The time a planned activity is due, with its urgency. */
    due: (iso) => {
      const delta = dayNumber(iso) - today,
        at = time(iso)
      if (delta < 0) return { label: t(`Quá hạn ${days(-delta)}`, `${days(-delta)} overdue`), tone: 'danger' }
      if (delta === 0) {
        const late = iso.length > 11 && iso.slice(11, 16) < clock.slice(11, 16)
        return {
          label: late
            ? t(`Quá hạn · ${at}`, `Overdue · ${at}`)
            : `${t('Hôm nay', 'Today')}${at ? ` · ${at}` : ''}`,
          tone: late ? 'danger' : 'warning',
        }
      }
      return { label: fmt.relative(iso), tone: 'neutral' }
    },
    /** Expected close date: overdue, closing within a week, later or missing. */
    closing: (iso, open = true) => {
      if (!iso) return { label: t('Chưa có ngày chốt', 'No close date'), tone: 'warning', state: 'missing' }
      const delta = dayNumber(iso) - today
      if (!open) return { label: fmt.date(iso), tone: 'neutral', state: 'closed' }
      if (delta < 0)
        return { label: t(`Trễ ${days(-delta)}`, `${days(-delta)} late`), tone: 'danger', state: 'overdue' }
      if (delta <= 7)
        return {
          label:
            delta === 0 ? t('Chốt hôm nay', 'Closes today') : t(`Còn ${days(delta)}`, `${days(delta)} left`),
          tone: 'warning',
          state: 'soon',
        }
      return { label: fmt.date(iso), tone: 'neutral', state: 'later' }
    },
    /** A change against the previous period, signed and rounded. */
    delta: (current, previous) => {
      if (!previous)
        return current ? t('Mới trong kỳ', 'New this period') : t('Như kỳ trước', 'Same as last period')
      const change = (current - previous) / Math.abs(previous)
      if (Math.abs(change) < 0.005) return t('Như kỳ trước', 'Same as last period')
      return `${change > 0 ? '▲' : '▼'} ${Math.abs(Math.round(change * 100))}% ${t('so với kỳ trước', 'vs last period')}`
    },
    deltaTone: (current, previous, higherIsBetter = true) =>
      !previous || current === previous
        ? 'neutral'
        : current > previous === higherIsBetter
          ? 'positive'
          : 'danger',
  }
  return fmt
}

export const salesWords = (lang = 'vi') => {
  const en = lang === 'en'
  const t = (vi, english) => (en ? english : vi)
  return {
    kind: { lead: t('Lead', 'Lead'), opportunity: t('Cơ hội', 'Opportunity') },
    terminal: { open: t('Đang mở', 'Open'), won: t('Thành công', 'Won'), lost: t('Thất bại', 'Lost') },
    terminalTone: { open: 'info', won: 'positive', lost: 'danger' },
    activityType: {
      call: t('Cuộc gọi', 'Call'),
      email: 'Email',
      meeting: t('Cuộc hẹn', 'Meeting'),
      task: t('Công việc', 'Task'),
    },
    quoteState: {
      draft: t('Nháp', 'Draft'),
      sent: t('Đã gửi', 'Sent'),
      accepted: t('Khách đã nhận', 'Accepted'),
      cancelled: t('Đã huỷ', 'Cancelled'),
    },
    quoteTone: { draft: 'neutral', sent: 'info', accepted: 'positive' },
    // How a quotation reached the customer; `hand` is handed over, nobody contacted.
    sendChannel: { email: 'Email', zalo: 'Zalo', hand: t('Trao tận tay', 'Handed over') },
    orderState: {
      confirmed: t('Đã xác nhận', 'Confirmed'),
      shipped: t('Đang giao', 'Shipping'),
      delivered: t('Đã giao', 'Delivered'),
    },
    orderTone: { confirmed: 'info', shipped: 'warning', delivered: 'positive' },
    quotePolicy: {
      off: t('Chỉ báo giá lập từ cơ hội', 'Only quotes written from the opportunity'),
      attach: t('Cho gắn báo giá lập ở Bán hàng', 'Quotes written in Sales may be attached'),
    },
    payment: {
      paid: t('Đã thanh toán', 'Paid'),
      unpaid: t('Chưa thanh toán', 'Unpaid'),
      invoiced: t('Đã xuất hoá đơn', 'Invoiced'),
    },
    messageState: {
      sent: t('Đã gửi', 'Sent'),
      queued: t('Đang gửi', 'Sending'),
      cancelled: t('Đã huỷ gửi', 'Not sent'),
      received: t('Đã nhận', 'Received'),
      failed: t('Gửi lỗi', 'Delivery failed'),
      internal: t('Nội bộ', 'Internal'),
      logged: t('Đã ghi', 'Logged'),
    },
    channel: { phone: t('Điện thoại', 'Phone'), email: 'Email', chat: t('Nhắn tin', 'Chat') },
    assignmentMode: {
      manual: t('Thủ công', 'Manual'),
      round_robin: t('Xoay vòng', 'Round robin'),
      capacity: t('Theo sức chứa', 'By capacity'),
    },
    attention: {
      'overdue-close': t('Trễ ngày chốt', 'Close date passed'),
      'no-close': t('Chưa có ngày chốt', 'No close date'),
      'no-next': t('Chưa có bước tiếp theo', 'No next step'),
      'overdue-activity': t('Việc quá hạn', 'Overdue activity'),
      stale: t('Đứng yên quá lâu', 'Idle too long'),
      unassigned: t('Chưa có người phụ trách', 'Unassigned'),
    },
  }
}
