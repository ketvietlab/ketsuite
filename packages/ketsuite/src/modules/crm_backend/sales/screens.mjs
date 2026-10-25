// @ts-nocheck Shared by the server render and the browser; its tests exercise it.
// Every CRM sales screen, drawn whole by the `crm.sales-screen` island: title, header commands, controls,
// body, aside and dialogs. `frame` is the page before its read lands (or when it cannot); `page` is the
// page from the read. Render-pure: the island owns the browser (history, drag, live quote totals).
import { createSalesKit, salesTitles } from './kit.mjs'
import { createSalesDialogs } from './dialogs.mjs'

/** A way back that stays inside the CRM screens of this host; anything else falls back to the list. */
export const safeReturn = (routes, value, fallback) => {
  if (typeof value !== 'string' || !value.startsWith('/') || value.startsWith('//')) return fallback
  const url = new URL(value, 'http://ket.local')
  return url.origin === 'http://ket.local' && routes.parse(url) ? value : fallback
}
export const salesTitle = (screen, lang) =>
  (salesTitles[screen] ?? salesTitles.overview)[lang === 'en' ? 1 : 0]

const addDays = (iso, n) =>
  new Date(Date.parse(`${iso}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10)
const digits = (value) => String(value ?? '').replace(/\D/g, '')

export const createSalesScreens = ({ view, ds, routes }) => {
  const { html, each } = view
  const {
    ActionGroup,
    ActionMenu,
    ActivityTimeline,
    BarChart,
    Button,
    DataMatrix,
    DescriptionList,
    EmptyState,
    Grid,
    Inline,
    KanbanCard,
    KanbanGrid,
    Link,
    LinkButton,
    ListPage,
    LoadingState,
    Menu,
    Metric,
    Notice,
    Peek,
    PeekLayout,
    Pipeline,
    StagePath,
    Progress,
    RecordPage,
    RecordRail,
    SearchBar,
    Section,
    Stack,
    Surface,
    Tabs,
    Text,
    WorkspacePage,
  } = ds
  const kitOf = createSalesKit({ view, ds, routes })
  const dialogs = createSalesDialogs({ view, ds })

  const group = (actions) => {
    const present = actions.filter(Boolean)
    return present.length ? ActionGroup({ actions: present }) : undefined
  }
  const toneOf = (tone) => (tone === 'neutral' ? undefined : tone)
  // A number is a `tel:` link: KétPhone's softphone places the call, a phone dials it, a desktop without
  // either asks the system's handler.
  const phoneLink = (number) =>
    number ? Link({ href: `tel:${String(number).replace(/[^\d+]/g, '')}`, label: number }) : '—'
  const recordHref = (k, id) => k.href('lead-detail', { id, returnTo: k.here({ id: null }) })
  // What other modules keep about the record (`crm_backend:record.related`): one island each, which
  // reads and draws its own part. The host lays out nothing itself, so an island with nothing about
  // this record takes no room in the tab.
  const related = (k, caseId) =>
    (k.model.related ?? []).map(
      (island) =>
        html`<ket-island
          data-island=${island}
          data-props=${JSON.stringify({ caseId, lang: k.lang })}
          data-crm-related
        ></ket-island>`,
    )
  /** A single-choice filter whose trigger names what is applied ("Đội: Tư vấn"). */
  const choice = (k, id, label, value, options, param = id) => {
    const chosen = options.find((o) => o.id === (value ?? '')) ?? options[0]
    return Menu({
      id: `crm-sales-${id}`,
      label: `${label}: ${chosen.label}`,
      selectionMode: 'single',
      trigger: html`<span>${chosen.label}</span>`,
      items: options.map((o) => ({
        id: `crm-sales-${id}-${o.id || 'all'}`,
        label: o.label,
        href: k.here({ [param]: o.id || null, peek: null, bucket: null }),
        checked: o.id === (value ?? ''),
      })),
    })
  }
  const people = (k, { none = false } = {}) => [
    { id: '', label: k.t('Mọi người', 'Everyone') },
    { id: 'me', label: k.t('Của tôi', 'Mine') },
    ...(none ? [{ id: 'none', label: k.t('Chưa phân công', 'Unassigned') }] : []),
    ...k.model.people.map((p) => ({ id: p.id, label: p.name })),
  ]
  const teams = (k) => [
    { id: '', label: k.t('Mọi đội', 'All teams') },
    ...k.model.teams.map((x) => ({ id: x.id, label: x.name })),
  ]
  const flagTone = { 'overdue-close': 'danger', 'overdue-activity': 'danger' }
  const flags = (k, row) =>
    row.flags?.length
      ? Inline({
          gap: 'compact',
          wrap: true,
          items: row.flags.map((f) => k.badge(k.words.attention[f] ?? f, flagTone[f] ?? 'warning')),
        })
      : null
  const closingCell = (k, row) => {
    if (row.kind === 'lead') return k.muted('—')
    const close = k.fmt.closing(row.closing, row.terminal === 'open')
    return row.closing
      ? k.lines(
          k.fmt.date(row.closing),
          close.state === 'later' || close.state === 'closed' ? null : close.label,
          close.tone,
        )
      : Text({ children: close.label, variant: 'bodySm', tone: 'warning' })
  }
  const quarterLabel = (k, key) => {
    const [year, q] = key.split('-q')
    return k.t(`Quý ${q}/${year}`, `Q${q} ${year}`)
  }

  /** The screen's pattern with what does not need the read: its title and its way back. */
  const shell = (
    k,
    { title, body, actions, status, meta, controls, path, navigation, aside, footer, headerActions, layout },
  ) => {
    const { t, screen } = k
    const back =
      screen === 'crm-team'
        ? k.back(t('Về cấu hình', 'Back to configuration'), k.href('crm-settings', { tab: 'people' }))
        : ['lead-detail', 'lead-new'].includes(screen)
          ? k.back(
              t('Về danh sách', 'Back to list'),
              safeReturn(routes, k.query.get('returnTo'), k.href('cases')),
            )
          : null
    if (['lead-detail', 'lead-new', 'crm-team'].includes(screen))
      return RecordPage({
        title,
        variant: 'operational',
        width: screen === 'lead-detail' ? 'wide' : 'default',
        status,
        meta,
        actions: actions ?? group([back]),
        path,
        navigation,
        body,
        aside,
        asideLabel: aside ? t('Bối cảnh hồ sơ', 'Record context') : null,
      })
    if (screen === 'cases')
      return ListPage({ title, variant: 'operational', headerActions, controls, body, footer })
    return WorkspacePage({
      title,
      variant: 'operational',
      layout: layout ?? (screen === 'pipeline' ? 'canvas' : 'flow'),
      status,
      meta,
      actions,
      controls,
      body,
    })
  }
  // Commands that never depend on the read stay put while it loads.
  const staticActions = (k) =>
    k.screen === 'overview'
      ? group([
          LinkButton({
            label: k.t('Mở pipeline', 'Open pipeline'),
            href: k.href('pipeline'),
            variant: 'secondary',
          }),
        ])
      : k.screen === 'pipeline'
        ? group([
            LinkButton({
              label: k.t('Danh sách', 'List'),
              href: k.href('cases', { view: 'open' }),
              variant: 'secondary',
            }),
          ])
        : undefined

  /** The page before (or instead of) its read: loading, denied, offline or failed. */
  const frame = (env, phase) => {
    const k = kitOf(null, env),
      { t } = k
    const retry = Button({
      id: 'crm-sales-retry',
      label: t('Thử lại', 'Retry'),
      type: 'button',
      variant: 'secondary',
    })
    const body =
      phase === 'denied'
        ? EmptyState({
            visual: 'locked',
            title: t('Không có quyền xem CRM', 'No access to CRM'),
            message: t(
              'Liên hệ quản lý để được cấp quyền xem dữ liệu bán hàng.',
              'Ask a manager to grant you access to sales data.',
            ),
          })
        : phase === 'offline'
          ? Notice({
              tone: 'warning',
              announcement: 'assertive',
              title: t('Mất kết nối', 'You are offline'),
              message: t(
                'Chưa tải được dữ liệu CRM. Trang tự tải lại khi có mạng.',
                'CRM data could not load. The page reloads once you are back online.',
              ),
              actions: retry,
            })
          : phase === 'error'
            ? Notice({
                tone: 'danger',
                announcement: 'assertive',
                title: t('Chưa tải được dữ liệu CRM', 'Unable to load CRM data'),
                message: t('Thử lại sau giây lát.', 'Try again in a moment.'),
                actions: retry,
              })
            : LoadingState({ label: t('Đang tải dữ liệu CRM', 'Loading CRM data'), lines: 6 })
    const loading = phase === 'loading'
    return shell(k, {
      title: salesTitle(env.screen, k.lang),
      body,
      actions: staticActions(k),
      aside:
        loading && env.screen === 'lead-detail'
          ? LoadingState({ label: t('Đang tải bối cảnh hồ sơ', 'Loading record context'), lines: 4 })
          : undefined,
      controls:
        env.screen === 'cases' && loading
          ? LoadingState({ label: t('Đang tải bộ lọc', 'Loading filters'), lines: 1 })
          : undefined,
    })
  }

  // ── Overview ──────────────────────────────────────────────────────────────────────────────
  const overview = (k) => {
    const { t, fmt, model } = k,
      ins = model.insights,
      kp = ins.kpis,
      period = ins.period
    const scope = { team: ins.filters.team || null, owner: ins.filters.owner || null }
    const cases = (extra) => k.href('cases', { ...scope, ...extra })
    const rateDelta = (now, before) => {
      if (now === null || before === null) return t('Chưa có kỳ trước để so', 'No prior period to compare')
      const change = Math.round((now - before) * 100)
      return change === 0
        ? t('Như kỳ trước', 'Same as last period')
        : `${change > 0 ? '▲' : '▼'} ${Math.abs(change)} ${t('điểm % so với kỳ trước', 'pts vs last period')}`
    }
    const metrics = Grid({
      columns: 3,
      mobileColumns: 2,
      items: [
        Metric({
          label: t('Doanh số thắng', 'Won revenue'),
          value: fmt.short(kp.won.value),
          detail: `${t(`${kp.won.count} thương vụ`, `${kp.won.count} deals`)} · ${fmt.delta(kp.won.value, kp.won.previous)}`,
          tone: toneOf(fmt.deltaTone(kp.won.value, kp.won.previous)),
          href: cases({ view: 'won', closed: period.key }),
        }),
        Metric({
          label: t('Tỷ lệ thắng', 'Win rate'),
          value: fmt.percent(kp.winRate.value),
          detail: `${kp.winRate.won} ${t('thắng', 'won')} / ${kp.winRate.lost} ${t('thua', 'lost')} · ${rateDelta(kp.winRate.value, kp.winRate.previous)}`,
          tone:
            kp.winRate.value === null || kp.winRate.previous === null
              ? undefined
              : toneOf(fmt.deltaTone(kp.winRate.value, kp.winRate.previous)),
          href: cases({ closed: period.key }),
        }),
        Metric({
          label: t('Pipeline có trọng số', 'Weighted pipeline'),
          value: fmt.short(kp.pipeline.weighted),
          detail: `${t('Tổng', 'Total')} ${fmt.short(kp.pipeline.gross)} · ${t(`${kp.pipeline.count} cơ hội mở`, `${kp.pipeline.count} open deals`)}`,
          href: k.href('pipeline', scope),
        }),
        Metric({
          label: t('Hồ sơ mới', 'New records'),
          value: fmt.number(kp.created.count),
          detail: fmt.delta(kp.created.count, kp.created.previous),
          tone: toneOf(fmt.deltaTone(kp.created.count, kp.created.previous)),
          href: cases({ created: period.key }),
        }),
        Metric({
          label: t('Giá trị thắng trung bình', 'Average won deal'),
          value: kp.avgDeal.value === null ? '—' : fmt.short(kp.avgDeal.value),
          detail:
            kp.avgDeal.value === null
              ? t('Chưa có thương vụ thắng trong kỳ', 'No won deals this period')
              : fmt.delta(kp.avgDeal.value, kp.avgDeal.previous),
          tone:
            kp.avgDeal.value === null
              ? undefined
              : toneOf(fmt.deltaTone(kp.avgDeal.value, kp.avgDeal.previous)),
        }),
        Metric({
          label: t('Chu kỳ bán hàng', 'Sales cycle'),
          value: kp.cycle.value === null ? '—' : fmt.days(kp.cycle.value),
          detail:
            kp.cycle.value === null
              ? t('Từ lúc tạo đến lúc thắng', 'From creation to win')
              : `${t('Tạo → thắng', 'Created → won')} · ${fmt.delta(kp.cycle.value, kp.cycle.previous)}`,
          tone:
            kp.cycle.value === null
              ? undefined
              : toneOf(fmt.deltaTone(kp.cycle.value, kp.cycle.previous, false)),
        }),
      ],
    })
    const forecast = Surface({
      title: t('Dự báo 4 tháng', 'Four-month forecast'),
      description: t(
        'Doanh số đã thắng cộng cơ hội mở theo tháng chốt dự kiến.',
        'Won revenue plus open deals by expected close month.',
      ),
      body: Stack({
        items: [
          BarChart({
            label: t('Dự báo doanh thu theo tháng chốt', 'Revenue forecast by close month'),
            bars: ins.forecast.map((m) => ({
              id: m.month,
              label: fmt.month(m.month),
              value: m.won + m.gross,
              caption: `${t(`${m.count} cơ hội`, `${m.count} deals`)} · ${t('trọng số', 'weighted')} ${fmt.short(m.weighted)}`,
              href: cases({ view: 'open', closing: m.month }),
              segments: [
                { series: 1, value: m.won },
                { series: 2, value: m.weighted },
                { series: 3, value: Math.max(0, m.gross - m.weighted) },
              ],
            })),
            value: (bar) => fmt.short(bar.value),
            keys: [
              { id: 'won', label: t('Đã thắng', 'Won'), series: 1 },
              { id: 'weighted', label: t('Có trọng số', 'Weighted'), series: 2 },
              { id: 'upside', label: t('Phần còn lại của pipeline', 'Rest of the pipeline'), series: 3 },
            ],
            empty: t('Chưa có cơ hội nào chốt trong 4 tháng tới.', 'No deals close in the next four months.'),
          }),
          ins.late.count || ins.undated.count
            ? Inline({
                gap: 'compact',
                wrap: true,
                items: [
                  ins.late.count
                    ? LinkButton({
                        label: `${t('Trễ ngày chốt', 'Past close date')}: ${ins.late.count} · ${fmt.short(ins.late.gross)}`,
                        href: cases({ view: 'open', closing: 'overdue' }),
                        variant: 'tertiary',
                      })
                    : null,
                  ins.undated.count
                    ? LinkButton({
                        label: `${t('Chưa có ngày chốt', 'No close date')}: ${ins.undated.count} · ${fmt.short(ins.undated.gross)}`,
                        href: cases({ view: 'open', closing: 'missing' }),
                        variant: 'tertiary',
                      })
                    : null,
                ].filter(Boolean),
              })
            : null,
        ].filter(Boolean),
      }),
    })
    const trend = Surface({
      title: t('Doanh số 6 tháng', 'Six-month revenue'),
      description: t(
        'Doanh số thắng theo tháng chốt, kèm số thương vụ thắng và thua.',
        'Won revenue by close month, with deals won and lost.',
      ),
      body: BarChart({
        label: t('Doanh số thắng 6 tháng gần nhất', 'Won revenue, last six months'),
        bars: ins.trend.map((m) => ({
          id: m.month,
          label: fmt.month(m.month),
          value: m.won,
          caption: `${m.wonCount} ${t('thắng', 'won')} · ${m.lostCount} ${t('thua', 'lost')}`,
          href: cases({ view: 'won', closed: m.month }),
        })),
        value: (bar) => fmt.short(bar.value),
        empty: t('Chưa có thương vụ thắng trong 6 tháng.', 'No won deals in six months.'),
      }),
    })
    const funnel = Surface({
      title: t('Phễu theo giai đoạn', 'Stage funnel'),
      description: t(
        'Hồ sơ đang mở ở từng giai đoạn; giá trị là tổng cơ hội.',
        'Open records in each stage; value totals the deals.',
      ),
      body: Pipeline({
        label: t('Phễu bán hàng', 'Sales funnel'),
        steps: ins.funnel.map((f) => ({
          id: f.stageId,
          label: k.stageName(f.stageId),
          value: `${fmt.number(f.count)} · ${fmt.short(f.gross)}`,
          href: cases({ view: 'open', stage: f.stageId }),
        })),
      }),
    })
    const risks = k.table({
      title: t('Cơ hội cần chú ý', 'Deals needing attention'),
      description: t(
        `${ins.riskCount} cơ hội mở có cảnh báo · hiện các cơ hội giá trị lớn nhất`,
        `${ins.riskCount} open deals have warnings · the largest are shown`,
      ),
      actions: ins.riskCount
        ? LinkButton({
            label: t('Xem tất cả', 'View all'),
            href: cases({ view: 'attention' }),
            variant: 'tertiary',
          })
        : undefined,
      rows: ins.risks,
      rowHref: (r) => recordHref(k, r.id),
      columns: [
        {
          key: 'name',
          label: t('Cơ hội', 'Deal'),
          priority: 'primary',
          wrap: true,
          cell: (r) => k.lines(r.name, `${r.id} · ${r.partner}`),
        },
        {
          key: 'revenue',
          label: t('Giá trị', 'Value'),
          align: 'end',
          kind: 'currency',
          cell: (r) => k.amount(r.revenue),
        },
        { key: 'closing', label: t('Ngày chốt', 'Close date'), cell: (r) => closingCell(k, r) },
        {
          key: 'owner',
          label: t('Phụ trách', 'Owner'),
          priority: 'secondary',
          cell: (r) => k.owner(r.assignee),
        },
        {
          key: 'flags',
          label: t('Cảnh báo', 'Warnings'),
          priority: 'secondary',
          wrap: true,
          cell: (r) => flags(k, r),
        },
      ],
      emptyTitle: t('Không có cơ hội cần chú ý', 'No deals need attention'),
      emptyMessage: t(
        'Mọi cơ hội mở đều có ngày chốt và bước tiếp theo.',
        'Every open deal has a close date and a next step.',
      ),
    })
    const losses = Surface({
      title: t('Lý do thất bại', 'Loss reasons'),
      description: t('Thương vụ thất bại trong kỳ theo lý do.', 'Deals lost this period by reason.'),
      body: BarChart({
        label: t('Thương vụ thất bại theo lý do', 'Lost deals by reason'),
        bars: ins.losses.map((l) => ({
          id: l.id,
          label: l.name,
          value: l.count,
          caption: fmt.short(l.value),
          href: cases({ view: 'lost', closed: period.key }),
        })),
        value: (bar) => t(`${bar.value} hồ sơ`, `${bar.value} records`),
        empty: t('Không có thương vụ thất bại trong kỳ.', 'No deals were lost this period.'),
      }),
    })
    const sources = k.table({
      title: t('Nguồn hồ sơ', 'Record sources'),
      description: t(
        'Toàn bộ hồ sơ trong phạm vi; tỷ lệ thắng tính trên hồ sơ đã đóng.',
        'All records in scope; win rate counts closed records.',
      ),
      rows: ins.sources.map((s) => ({ ...s, id: s.source })),
      rowHref: (s) => cases({ source: s.source }),
      columns: [
        { key: 'source', label: t('Nguồn', 'Source'), priority: 'primary', cell: (s) => s.source },
        {
          key: 'total',
          label: t('Hồ sơ', 'Records'),
          align: 'end',
          kind: 'number',
          cell: (s) => fmt.number(s.total),
        },
        {
          key: 'open',
          label: t('Đang mở', 'Open'),
          align: 'end',
          kind: 'number',
          cell: (s) => fmt.number(s.open),
        },
        {
          key: 'winRate',
          label: t('Tỷ lệ thắng', 'Win rate'),
          align: 'end',
          kind: 'number',
          cell: (s) => fmt.percent(s.winRate),
        },
        {
          key: 'wonValue',
          label: t('Doanh số thắng', 'Won revenue'),
          align: 'end',
          kind: 'currency',
          cell: (s) => fmt.short(s.wonValue),
        },
      ],
    })
    const leaders = k.table({
      title: t('Hiệu suất người phụ trách', 'Owner performance'),
      description: t(
        'Doanh số thắng trong kỳ và pipeline đang giữ.',
        'Revenue won this period and the pipeline each owner holds.',
      ),
      rows: ins.leaders.map((l) => ({ ...l, id: l.userId })),
      rowHref: (l) => cases({ view: 'open', owner: l.userId }),
      columns: [
        {
          key: 'person',
          label: t('Người phụ trách', 'Owner'),
          priority: 'primary',
          cell: (l) => k.owner(l.userId),
        },
        {
          key: 'won',
          label: t('Thắng', 'Won'),
          align: 'end',
          kind: 'currency',
          cell: (l) => k.lines(fmt.short(l.won), t(`${l.wonCount} thương vụ`, `${l.wonCount} deals`)),
        },
        {
          key: 'winRate',
          label: t('Tỷ lệ thắng', 'Win rate'),
          align: 'end',
          kind: 'number',
          cell: (l) => fmt.percent(l.winRate),
        },
        {
          key: 'open',
          label: t('Đang mở', 'Open'),
          align: 'end',
          kind: 'number',
          cell: (l) => fmt.number(l.open),
        },
        {
          key: 'weighted',
          label: t('Trọng số', 'Weighted'),
          align: 'end',
          kind: 'currency',
          priority: 'secondary',
          cell: (l) => fmt.short(l.weighted),
        },
        {
          key: 'overdue',
          label: t('Việc quá hạn', 'Overdue'),
          align: 'end',
          priority: 'secondary',
          cell: (l) => (l.overdue ? k.badge(fmt.number(l.overdue), 'danger') : k.muted('0')),
        },
      ],
    })
    const periodName = period.id === 'quarter' ? quarterLabel(k, period.key) : fmt.month(period.key)
    return {
      title: salesTitle('overview', k.lang),
      view: shell(k, {
        title: salesTitle('overview', k.lang),
        actions: group([
          LinkButton({
            label: t('Mở pipeline', 'Open pipeline'),
            href: k.href('pipeline', scope),
            variant: 'secondary',
          }),
          model.can.write
            ? LinkButton({
                label: t('Tạo lead', 'Create lead'),
                href: k.href('lead-new'),
                variant: 'primary',
                icon: 'plus',
              })
            : null,
        ]),
        controls: Inline({
          wrap: true,
          items: [
            choice(k, 'period', t('Kỳ', 'Period'), period.id, [
              { id: 'month', label: t('Tháng này', 'This month') },
              { id: 'quarter', label: t('Quý này', 'This quarter') },
              { id: 'previous', label: t('Tháng trước', 'Last month') },
            ]),
            choice(k, 'team', t('Đội', 'Team'), ins.filters.team, teams(k)),
            choice(k, 'owner', t('Người phụ trách', 'Owner'), ins.filters.owner, people(k)),
          ],
        }),
        meta: Text({
          children: `${periodName} · ${fmt.fullDate(period.start)} – ${fmt.fullDate(period.end)} · ${t('so với', 'vs')} ${fmt.fullDate(period.previous[0])} – ${fmt.fullDate(period.previous[1])}`,
          variant: 'bodySm',
          tone: 'muted',
        }),
        body: Stack({
          items: [
            k.notice(),
            metrics,
            Grid({ columns: 2, items: [forecast, trend] }),
            funnel,
            risks,
            Grid({ columns: 2, items: [losses, sources] }),
            leaders,
          ].filter(Boolean),
        }),
      }),
    }
  }

  // ── Pipeline ──────────────────────────────────────────────────────────────────────────────
  const pipeline = (k) => {
    const { t, fmt, words, model } = k,
      p = model.pipeline,
      f = p.filters,
      write = model.can.write
    const peekId = k.query.get('peek')
    const scope = { q: f.q || null, owner: f.owner || null, team: f.team || null }
    const lanes = p.lanes.map((lane) => ({ ...lane, stage: model.stages.find((s) => s.id === lane.stageId) }))
    const found = lanes
      .flatMap((lane) => lane.cards.map((card, i) => ({ card, lane, i })))
      .find((x) => x.card.id === peekId)
    const card = (row) => {
      const close = fmt.closing(row.closing, true),
        due = row.next ? fmt.due(row.next.dueAt) : null
      return KanbanCard({
        id: row.id,
        title: row.name,
        href: k.here({ peek: row.id }),
        selected: row.id === peekId,
        draggable: write && row.writable,
        meta: html`<span data-crm-card-line
          ><span>${row.partner}</span
          ><strong>${row.kind === 'opportunity' ? fmt.short(row.revenue) : words.kind.lead}</strong></span
        >`,
        note: Stack({
          gap: 'compact',
          items: [
            Inline({
              gap: 'compact',
              wrap: true,
              items: [
                row.kind === 'opportunity'
                  ? k.badge(
                      close.state === 'later' ? `${t('Chốt', 'Closes')} ${close.label}` : close.label,
                      close.tone,
                    )
                  : k.badge(`${t('Điểm', 'Score')} ${row.score}`, 'info'),
                row.flags.includes('stale')
                  ? k.badge(t(`Đứng yên ${row.idleDays} ngày`, `Idle ${row.idleDays} days`), 'warning')
                  : null,
              ].filter(Boolean),
            }),
            Text({
              children: row.next
                ? `${words.activityType[row.next.type] ?? row.next.type}: ${row.next.title} · ${due.label}`
                : words.attention['no-next'],
              variant: 'bodySm',
              tone: row.next ? (due.tone === 'neutral' ? 'muted' : due.tone) : 'warning',
            }),
            Text({ children: k.owner(row.assignee), variant: 'bodySm', tone: 'muted' }),
          ],
        }),
      })
    }
    const lane = (item) => {
      const name = item.stage?.name ?? item.stageId,
        folded = !!item.stage?.fold
      return html`<div data-crm-lane data-crm-stage=${item.stageId} data-folded=${folded ? 'true' : 'false'}>
        ${Section({
          id: `crm-sales-stage-${item.stageId}`,
          title: name,
          description: item.gross
            ? `${fmt.short(item.gross)} · ${t('trọng số', 'weighted')} ${fmt.short(item.weighted)}`
            : t('Chưa có giá trị', 'No value yet'),
          actions: k.badge(fmt.number(item.count)),
          body: folded
            ? LinkButton({
                label: t(`Xem ${item.count} hồ sơ`, `View ${item.count} records`),
                href: k.href('cases', { view: 'open', stage: item.stageId, ...scope }),
                variant: 'tertiary',
              })
            : KanbanGrid({
                rows: item.cards,
                id: (row) => row.id,
                card,
                dropTarget: item.stageId,
                dropLabel: t(`Hồ sơ ở giai đoạn ${name}`, `Records in ${name}`),
                emptyLabel: write
                  ? t('Kéo hồ sơ vào đây', 'Drop records here')
                  : t('Chưa có hồ sơ', 'No records'),
              }),
        })}
      </div>`
    }
    const outcome = (kind) => {
      const o = p.closed[kind]
      return html`<div data-crm-lane data-crm-stage=${kind} data-folded="true">
        ${Section({
          id: `crm-sales-stage-${kind}`,
          title: words.terminal[kind],
          description: `${fmt.month(p.closed.month)} · ${fmt.short(o.value)}`,
          actions: k.badge(fmt.number(o.count), words.terminalTone[kind]),
          body: LinkButton({
            label: t(`Xem ${o.count} hồ sơ`, `View ${o.count} records`),
            href: k.href('cases', { view: kind, closed: p.closed.month, ...scope }),
            variant: 'tertiary',
          }),
        })}
      </div>`
    }
    const board = html`<div
      data-crm-board
      role="region"
      aria-label=${t('Pipeline theo giai đoạn — cuộn ngang để xem thêm', 'Pipeline by stage — scroll sideways for more')}
      tabindex="0"
    >
      ${each(lanes, (item) => item.stageId, lane)}${outcome('won')}${outcome('lost')}
    </div>`
    let peek = null
    if (found) {
      const row = found.card,
        siblings = found.lane.cards,
        prev = siblings[found.i - 1],
        next = siblings[found.i + 1],
        close = fmt.closing(row.closing, true),
        editable = write && row.writable
      peek = Peek({
        id: 'crm-pipeline-card',
        eyebrow: `${row.id} · ${words.kind[row.kind]}`,
        title: row.name,
        status: k.badge(k.stageName(row.stageId), 'info'),
        body: Stack({
          items: [
            DescriptionList({
              label: t('Tóm tắt hồ sơ', 'Record summary'),
              columns: 1,
              items: [
                { id: 'partner', label: t('Khách hàng', 'Customer'), value: row.partner },
                {
                  id: 'contact',
                  label: t('Liên hệ', 'Contact'),
                  value: [row.contact, row.phone || row.email].filter(Boolean).join(' · ') || '—',
                },
                ...(row.kind === 'opportunity'
                  ? [
                      {
                        id: 'value',
                        label: t('Giá trị', 'Value'),
                        value: `${fmt.money(row.revenue)} · ${row.probability}%`,
                      },
                      { id: 'weighted', label: t('Trọng số', 'Weighted'), value: fmt.money(row.weighted) },
                      {
                        id: 'closing',
                        label: t('Ngày chốt', 'Close date'),
                        value: row.closing ? `${fmt.date(row.closing)} · ${close.label}` : close.label,
                      },
                    ]
                  : [{ id: 'score', label: t('Điểm', 'Score'), value: String(row.score) }]),
                {
                  id: 'owner',
                  label: t('Phụ trách', 'Owner'),
                  value: `${k.owner(row.assignee)} · ${k.teamName(row.teamId) || '—'}`,
                },
                { id: 'stage', label: t('Ở giai đoạn này', 'In this stage'), value: fmt.days(row.stageDays) },
                {
                  id: 'next',
                  label: t('Bước tiếp theo', 'Next step'),
                  value: row.next
                    ? `${row.next.title} · ${fmt.due(row.next.dueAt).label}`
                    : words.attention['no-next'],
                },
                { id: 'source', label: t('Nguồn', 'Source'), value: row.source },
              ],
            }),
            flags(k, row),
          ].filter(Boolean),
        }),
        actions: editable
          ? Inline({
              gap: 'compact',
              wrap: true,
              items: [
                row.kind === 'lead'
                  ? LinkButton({
                      label: t('Chuyển thành cơ hội', 'Convert'),
                      href: k.here({ dialog: 'convert', id: row.id }),
                      variant: 'primary',
                    })
                  : LinkButton({
                      label: t('Chốt kết quả', 'Close outcome'),
                      href: k.here({ dialog: 'close', id: row.id }),
                      variant: 'primary',
                    }),
                LinkButton({
                  label: t('Ghi tương tác', 'Log interaction'),
                  href: k.here({ dialog: 'interaction', id: row.id }),
                  variant: 'secondary',
                }),
                LinkButton({
                  label: t('Lên lịch', 'Schedule'),
                  href: k.here({ dialog: 'activity', id: row.id }),
                  variant: 'secondary',
                }),
                LinkButton({
                  label: t('Chuyển giai đoạn', 'Move stage'),
                  href: k.here({ dialog: 'move', id: row.id }),
                  variant: 'secondary',
                }),
              ],
            })
          : undefined,
        record: { label: t('Mở hồ sơ đầy đủ', 'Open full record'), href: recordHref(k, row.id) },
        closeLabel: t('Đóng xem nhanh', 'Close preview'),
        closeHref: k.here({ peek: null }),
        previous: prev ? { label: prev.name, href: k.here({ peek: prev.id }) } : null,
        next: next ? { label: next.name, href: k.here({ peek: next.id }) } : null,
      })
    }
    // A card dropped on another lane posts this form; the island fills the record, its version and the stage.
    const moveForm = write
      ? html`<form id="crm-sales-move" data-crm-command data-crm-drag-move action=${routes.command} method="post" hidden>
          <input autocomplete="off" type="hidden" name="command" value="move" />
          <input autocomplete="off" type="hidden" name="context" value=${k.query.toString()} />
          <input autocomplete="off" type="hidden" name="viewer" value=${model.actor.id} />
          <input autocomplete="off" type="hidden" name="role" value=${model.actor.role} />
          <input autocomplete="off" type="hidden" name="lang" value=${k.lang} />
          <input autocomplete="off" type="hidden" name="stay" value="1" />
          <input autocomplete="off" type="hidden" name="requestId" value="" />
          <input autocomplete="off" type="hidden" name="id" value="" />
          <input autocomplete="off" type="hidden" name="version" value="" />
          <input autocomplete="off" type="hidden" name="stageId" value="" />
        </form>`
      : null
    const search = k.formTarget('pipeline', { q: null, peek: null })
    return {
      title: salesTitle('pipeline', k.lang),
      view: shell(k, {
        title: salesTitle('pipeline', k.lang),
        actions: group([
          LinkButton({
            label: t('Danh sách', 'List'),
            href: k.href('cases', { view: 'open', ...scope }),
            variant: 'secondary',
          }),
          write
            ? LinkButton({
                label: t('Tạo lead', 'Create lead'),
                href: k.href('lead-new'),
                variant: 'primary',
                icon: 'plus',
              })
            : null,
        ]),
        controls: Inline({
          wrap: true,
          items: [
            SearchBar({
              id: 'crm-pipeline-search',
              action: search.action,
              name: 'q',
              value: f.q,
              label: t('Tìm trên pipeline', 'Search the pipeline'),
              placeholder: t('Tên, mã, khách hoặc điện thoại', 'Name, ID, customer or phone'),
              submitLabel: t('Tìm', 'Search'),
              hidden: search.hidden,
            }),
            choice(k, 'owner', t('Người phụ trách', 'Owner'), f.owner, people(k, { none: true })),
            choice(k, 'team', t('Đội', 'Team'), f.team, teams(k)),
          ],
        }),
        meta: Text({
          children: `${t(`${p.totals.count} hồ sơ mở`, `${p.totals.count} open records`)} · ${t('Tổng', 'Total')} ${fmt.short(p.totals.gross)} · ${t('Trọng số', 'Weighted')} ${fmt.short(p.totals.weighted)}`,
          variant: 'bodySm',
          tone: 'muted',
          numeric: true,
        }),
        body: Stack({
          items: [
            k.notice(),
            k.refusal(),
            PeekLayout({ peekId: 'crm-pipeline-peek', main: board, peek }),
            moveForm,
          ].filter(Boolean),
        }),
      }),
      dialog: k.query.get('dialog')
        ? dialogs.caseDialog(k, model.detail ?? null, k.here({ id: null }))
        : null,
    }
  }

  // ── Records list ──────────────────────────────────────────────────────────────────────────
  const cases = (k) => {
    const { t, model } = k,
      admin = model.can.admin
    const exportHref = routes.exportHref(k.query.toString())
    const bulk = model.notice?.bulk ?? []
    return {
      title: salesTitle('cases', k.lang),
      view: shell(k, {
        title: salesTitle('cases', k.lang),
        headerActions: group([
          model.can.write
            ? LinkButton({
                label: t('Tạo lead', 'Create lead'),
                href: k.href('lead-new'),
                variant: 'primary',
                icon: 'plus',
              })
            : null,
          admin
            ? ActionMenu({
                id: 'crm-sales-data',
                label: t('Dữ liệu', 'Data'),
                triggerLabel: t('Dữ liệu', 'Data'),
                items: [
                  {
                    id: 'import',
                    label: t('Nhập hồ sơ', 'Import records'),
                    href: k.here({ dialog: 'import' }),
                  },
                  {
                    id: 'intake',
                    label: t('Tiếp nhận lead từ nguồn', 'Lead intake'),
                    href: k.href('lead-new', { dialog: 'intake' }),
                  },
                  {
                    id: 'export',
                    label: t('Xuất JSON theo bộ lọc', 'Export filtered JSON'),
                    href: exportHref,
                  },
                  // A demo can fill itself with sample records; a workspace imports its own.
                  ...(routes.demo
                    ? [
                        { id: 'data-separator', kind: 'separator' },
                        {
                          id: 'samples',
                          label: t('Thêm 60 hồ sơ mẫu', 'Add 60 sample records'),
                          form: k.formFor('load-sample'),
                        },
                      ]
                    : []),
                ],
              })
            : LinkButton({ label: t('Xuất JSON', 'Export JSON'), href: exportHref, variant: 'secondary' }),
        ]),
        controls: html`<div data-crm-book="controls"></div>`,
        body: Stack({
          items: [
            k.notice(),
            k.refusal(['import-preview', 'import', 'bulk-assign']),
            bulk.length
              ? k.table({
                  title: t('Kết quả từng hồ sơ', 'Per-record results'),
                  rows: bulk,
                  columns: [
                    { key: 'id', label: t('Hồ sơ', 'Record'), priority: 'primary', cell: (r) => r.id },
                    {
                      key: 'state',
                      label: t('Kết quả', 'Outcome'),
                      cell: (r) =>
                        r.state === 'skipped'
                          ? k.badge(t('Bỏ qua', 'Skipped'), 'warning')
                          : k.badge(t('Đã phân công', 'Assigned'), 'positive'),
                    },
                    { key: 'message', label: t('Chi tiết', 'Detail'), wrap: true, cell: (r) => r.message },
                  ],
                })
              : null,
            admin
              ? html`<form hidden id="crm-sales-selection" action=${k.formTarget('cases').action} method="get"></form>`
              : null,
            html`<div data-crm-book="results"></div>`,
          ].filter(Boolean),
        }),
        footer: html`<div data-crm-book="footer"></div>`,
      }),
      dialog: dialogs.standaloneDialog(k, k.here({})),
    }
  }

  // ── Record ────────────────────────────────────────────────────────────────────────────────
  const eventAction = (k, e) => {
    const { t, words } = k
    if (e.title === 'move' && e.meta?.to)
      return `${t('Chuyển giai đoạn', 'Moved stage')} → ${k.stageName(e.meta.to)}`
    if (e.title === 'assign' && e.meta) return `${t('Phân công', 'Assigned')} → ${k.owner(e.meta.to)}`
    if (e.title === 'close')
      return `${t('Chốt kết quả', 'Closed')}: ${words.terminal[e.outcome ?? e.meta?.to] ?? ''}`
    if (e.title === 'quote-send' && e.meta?.channel)
      return e.meta.channel === 'hand'
        ? t('Trao báo giá tận tay', 'Handed over a quote')
        : `${t('Gửi báo giá qua', 'Sent a quote by')} ${words.sendChannel[e.meta.channel] ?? e.meta.channel}${e.meta.recipient ? ` → ${e.meta.recipient}` : ''}`
    return (
      {
        create: t('Tạo hồ sơ', 'Created the record'),
        save: t('Cập nhật hồ sơ', 'Updated the record'),
        convert: t('Chuyển thành cơ hội', 'Converted to opportunity'),
        close: t('Chốt kết quả', 'Closed'),
        reopen: t('Mở lại hồ sơ', 'Reopened the record'),
        move: t('Chuyển giai đoạn', 'Moved stage'),
        assign: t('Phân công', 'Assigned'),
        'bulk-assign': t('Phân công hàng loạt', 'Bulk assigned'),
        activity: t('Lên lịch công việc', 'Scheduled an activity'),
        plan: t('Áp dụng kế hoạch', 'Applied a plan'),
        reschedule: t('Dời lịch công việc', 'Rescheduled an activity'),
        'forecast-save': t('Cập nhật dự báo', 'Updated the forecast'),
        'quote-create': t('Tạo báo giá', 'Created a quote'),
        'quote-edit': t('Sửa báo giá', 'Edited a quote'),
        'quote-send': t('Gửi báo giá', 'Sent a quote'),
        'quote-accept': t('Khách chấp nhận báo giá · tạo đơn', 'Quote accepted · order created'),
        'quote-attach': t('Gắn báo giá lập ở Bán hàng', 'Attached a quote written in Sales'),
        'order-confirmed': t('Đơn được xác nhận', 'Order confirmed'),
        'order-shipped': t('Đơn đang giao', 'Order shipping'),
        'order-delivered': t('Đơn đã giao xong', 'Order delivered'),
        'order-cancelled': t('Đơn bị huỷ', 'Order cancelled'),
        merge: t('Gộp hồ sơ trùng', 'Merged a duplicate'),
      }[e.title] ?? e.title
    )
  }
  const feedItem = (k, e, editable, record) => {
    const { t, fmt, words } = k
    const actor =
      e.actor === 'system' || (!e.actor && !e.from)
        ? t('Hệ thống', 'System')
        : k.person(e.actor) || e.from || e.actor
    const base = { id: e.id, actor, datetime: e.at, timeLabel: fmt.relative(e.at) }
    if (e.kind === 'event') return { ...base, action: eventAction(k, e), detail: e.body || undefined }
    if (e.kind === 'activity')
      return {
        ...base,
        action: `${words.activityType[e.type] ?? e.type}: ${e.title} · ${e.state === 'done' ? t('hoàn tất', 'completed') : t('đã hủy', 'cancelled')}`,
        detail: e.body || undefined,
      }
    if (e.kind === 'note') return { ...base, action: t('Ghi chú nội bộ', 'Internal note'), detail: e.body }
    if (e.kind === 'interaction')
      return {
        ...base,
        action: `${t('Tương tác', 'Interaction')} · ${words.channel[e.channel] ?? e.channel ?? ''}`,
        detail: e.body,
      }
    const inbound = e.direction === 'inbound'
    return {
      ...base,
      actor: inbound ? e.from || actor : actor,
      action: html`${inbound ? t('Email đến', 'Email received') : t('Email đi', 'Email sent')}: ${e.subject || '—'}
      ${k.badge(words.messageState[e.state] ?? e.state, e.state === 'failed' ? 'danger' : 'neutral')}`,
      detail: Stack({
        gap: 'compact',
        items: [
          e.body ? Text({ children: e.body, variant: 'bodySm' }) : null,
          e.attachment ? k.muted(`${t('Tệp đính kèm', 'Attachment')}: ${e.attachment}`) : null,
          e.state === 'failed' && editable
            ? k.action('email-retry', t('Gửi lại', 'Retry delivery'), record, { messageId: e.id })
            : null,
        ].filter(Boolean),
      }),
    }
  }

  const record = (k) => {
    const { t, fmt, words, model } = k,
      detail = model.detail
    if (!detail)
      return {
        title: t('Không tìm thấy hồ sơ', 'Record unavailable'),
        view: shell(k, {
          title: t('Không tìm thấy hồ sơ', 'Record unavailable'),
          body: EmptyState({
            visual: 'locked',
            title: t('Không tìm thấy hồ sơ', 'Record unavailable'),
            message: t(
              'Hồ sơ không tồn tại hoặc ngoài phạm vi xem.',
              'The record is missing or outside your access scope.',
            ),
          }),
        }),
      }
    const r = detail.record,
      editable = detail.editable,
      writable = detail.writable,
      admin = model.can.admin,
      open = r.terminal === 'open'
    // A refused edit reopens on the tab holding its form, so its draft and the reason are in view.
    const tab = ['activity', 'detail', 'quotes'].includes(k.query.get('tab'))
      ? k.query.get('tab')
      : k.response && ['save', 'forecast-save'].includes(k.draft.command)
        ? 'detail'
        : 'activity'
    const dialogHref = (dialog, extra = {}) => k.here({ dialog, ...extra })
    const mergeable = detail.duplicates.some(
      (d) => d.partnerId === r.partnerId && d.kind === r.kind && d.terminal === 'open',
    )
    const openActivities = detail.activities
      .filter((a) => a.state === 'open')
      .sort((a, b) => a.dueAt.localeCompare(b.dueAt))
    const close = fmt.closing(r.closing, open)

    // Where this record stands, not how many records sit in each stage: a path, not a pipeline.
    // A closed record has passed every stage up to the one it closed from; the outcome is current.
    const reached = open
      ? detail.path.find((s) => s.id === r.stageId)
      : (detail.path.find((s) => s.id === r.closedFrom) ?? (r.terminal === 'won' ? detail.path.at(-1) : null))
    const path = StagePath({
      label: t('Tiến trình bán hàng', 'Sales path'),
      completeLabel: t('đã qua', 'completed'),
      steps: [
        ...detail.path.map((s) => ({
          id: s.id,
          label: s.name,
          state: !reached
            ? 'upcoming'
            : s.sequence < reached.sequence || (!open && s.id === reached.id)
              ? 'complete'
              : s.id === reached.id
                ? 'current'
                : 'upcoming',
          href: editable && s.id !== r.stageId ? dialogHref('move', { stage: s.id }) : null,
        })),
        r.kind === 'lead'
          ? {
              id: 'convert',
              label: t('Thành cơ hội', 'Opportunity'),
              state: 'upcoming',
              href: editable ? dialogHref('convert') : null,
            }
          : {
              id: 'outcome',
              label: open ? t('Chốt', 'Close') : words.terminal[r.terminal],
              state: open ? 'upcoming' : 'current',
              tone: open ? null : r.terminal === 'won' ? 'positive' : 'danger',
              href: editable ? dialogHref('close') : null,
            },
      ],
    })

    const more = writable
      ? [
          editable
            ? {
                id: 'activity',
                label: t('Lên lịch công việc', 'Schedule activity'),
                href: dialogHref('activity'),
              }
            : null,
          editable
            ? { id: 'plan', label: t('Áp dụng kế hoạch', 'Apply plan'), href: dialogHref('plan') }
            : null,
          editable
            ? { id: 'email', label: t('Soạn email', 'Compose email'), href: dialogHref('email') }
            : null,
          editable
            ? { id: 'move', label: t('Chuyển giai đoạn', 'Move stage'), href: dialogHref('move') }
            : null,
          editable && r.kind === 'opportunity'
            ? { id: 'quote', label: t('Tạo báo giá', 'Create quote'), href: dialogHref('quote-create') }
            : null,
          editable && admin
            ? { id: 'assign', label: t('Phân công', 'Assign'), href: dialogHref('assign') }
            : null,
          editable && admin && mergeable
            ? { id: 'merge', label: t('Gộp hồ sơ trùng', 'Merge duplicate'), href: dialogHref('merge') }
            : null,
        ].filter(Boolean)
      : []
    const actions = group([
      k.back(t('Về danh sách', 'Back to list'), safeReturn(routes, k.query.get('returnTo'), k.href('cases'))),
      editable
        ? LinkButton({
            label: t('Ghi tương tác', 'Log interaction'),
            href: dialogHref('interaction'),
            variant: 'secondary',
          })
        : null,
      editable && r.kind === 'lead'
        ? LinkButton({
            label: t('Chuyển thành cơ hội', 'Convert to opportunity'),
            href: dialogHref('convert'),
            variant: 'primary',
          })
        : editable
          ? LinkButton({
              label: t('Chốt kết quả', 'Close outcome'),
              href: dialogHref('close'),
              variant: 'primary',
            })
          : !open && admin
            ? LinkButton({ label: t('Mở lại', 'Reopen'), href: dialogHref('reopen'), variant: 'secondary' })
            : null,
      more.length
        ? ActionMenu({
            id: 'crm-record-more',
            label: t('Thao tác khác', 'More actions'),
            triggerLabel: t('Thêm', 'More'),
            items: more,
          })
        : null,
    ])

    const metrics = Grid({
      columns: 4,
      mobileColumns: 2,
      items:
        r.kind === 'opportunity'
          ? [
              Metric({
                label: t('Giá trị dự kiến', 'Expected value'),
                value: fmt.short(r.revenue),
                detail: fmt.money(r.revenue),
              }),
              Metric({
                label: t('Xác suất', 'Probability'),
                value: `${r.probability}%`,
                detail: `${t('Trọng số', 'Weighted')} ${fmt.short(r.weighted)}`,
              }),
              Metric({
                label: t('Ngày chốt', 'Close date'),
                value: r.closing ? fmt.date(r.closing) : '—',
                detail: open ? close.label : words.terminal[r.terminal],
                tone: open ? toneOf(close.tone) : undefined,
              }),
              Metric({
                label: t('Ở giai đoạn', 'In stage'),
                value: fmt.days(r.stageDays),
                detail: r.flags.includes('stale') ? words.attention.stale : r.stageName,
                tone: r.flags.includes('stale') ? 'warning' : undefined,
              }),
            ]
          : [
              Metric({
                label: t('Điểm', 'Score'),
                value: String(r.score),
                detail: t('Theo quy tắc chấm điểm', 'From the scoring rules'),
              }),
              Metric({
                label: t('Nguồn', 'Source'),
                value: r.source,
                detail: r.utmCampaign || r.utmMedium || '—',
              }),
              Metric({
                label: t('Tuổi lead', 'Lead age'),
                value: fmt.days(fmt.since(r.createdAt)),
                detail: `${t('Tạo', 'Created')} ${fmt.date(r.createdAt)}`,
              }),
              Metric({
                label: t('Bước tiếp theo', 'Next step'),
                value: r.next ? fmt.due(r.next.dueAt).label : '—',
                detail: r.next ? r.next.title : words.attention['no-next'],
                tone: r.next ? toneOf(fmt.due(r.next.dueAt).tone) : open ? 'warning' : undefined,
              }),
            ],
    })

    const activityTab = () =>
      Stack({
        items: [
          Surface({
            title: t('Việc cần làm', 'To do'),
            actions: editable
              ? Inline({
                  gap: 'compact',
                  items: [
                    LinkButton({
                      label: t('Lên lịch', 'Schedule'),
                      href: dialogHref('activity'),
                      variant: 'tertiary',
                      icon: 'plus',
                    }),
                    LinkButton({
                      label: t('Áp dụng kế hoạch', 'Apply plan'),
                      href: dialogHref('plan'),
                      variant: 'tertiary',
                    }),
                  ],
                })
              : undefined,
            body: k.table({
              label: t('Việc cần làm của hồ sơ', "The record's open activities"),
              rows: openActivities,
              rowHref: editable ? (a) => dialogHref('activity-complete', { activity: a.id }) : undefined,
              columns: [
                {
                  key: 'title',
                  label: t('Việc', 'Activity'),
                  priority: 'primary',
                  wrap: true,
                  cell: (a) => k.lines(a.title, words.activityType[a.type] ?? a.type),
                },
                {
                  key: 'due',
                  label: t('Hạn', 'Due'),
                  cell: (a) => {
                    const due = fmt.due(a.dueAt)
                    return Text({
                      children: due.label,
                      variant: 'bodyMd',
                      tone: due.tone === 'neutral' ? 'default' : due.tone,
                    })
                  },
                },
                {
                  key: 'owner',
                  label: t('Phụ trách', 'Owner'),
                  priority: 'secondary',
                  cell: (a) => k.owner(a.owner),
                },
              ],
              emptyTitle: open
                ? t('Chưa có bước tiếp theo', 'No next step')
                : t('Không còn việc mở', 'No open activities'),
              emptyMessage: open
                ? t(
                    'Lên lịch một việc có hạn để hồ sơ không bị bỏ quên.',
                    'Schedule a dated activity so the record is not forgotten.',
                  )
                : t('Hồ sơ đã đóng.', 'The record is closed.'),
              emptyActions: editable
                ? LinkButton({
                    label: t('Lên lịch', 'Schedule'),
                    href: dialogHref('activity'),
                    variant: 'secondary',
                  })
                : undefined,
            }),
          }),
          writable
            ? Surface({
                title: t('Ghi chú nội bộ', 'Internal note'),
                body: k.command(
                  'note',
                  t('Thêm ghi chú', 'Add note'),
                  [
                    k.field('message', t('Ghi chú', 'Note'), '', {
                      type: 'textarea',
                      required: true,
                      span: 'full',
                    }),
                  ],
                  r,
                  {},
                  { variant: 'secondary' },
                ),
              })
            : null,
          ...related(k, r.id),
          Surface({
            title: t('Lịch sử hoạt động', 'Activity history'),
            body: ActivityTimeline({
              label: t('Lịch sử hoạt động của hồ sơ', "The record's activity history"),
              items: detail.feed.map((e) => feedItem(k, e, editable, r)),
              emptyTitle: t('Chưa có hoạt động', 'No activity yet'),
              emptyMessage: t(
                'Tương tác, email và thay đổi sẽ xuất hiện ở đây.',
                'Interactions, emails and changes appear here.',
              ),
            }),
          }),
        ].filter(Boolean),
      })

    const priorities = [
      { id: '0', name: t('Bình thường', 'Normal') },
      { id: '1', name: t('Ưu tiên', 'Priority') },
      { id: '2', name: t('Cao', 'High') },
      { id: '3', name: t('Rất cao', 'Very high') },
    ]
    const detailTab = () =>
      Stack({
        items: [
          Surface({
            title: t('Thông tin hồ sơ', 'Record details'),
            body: editable
              ? k.command(
                  'save',
                  t('Lưu hồ sơ', 'Save record'),
                  [
                    k.field('name', t('Tiêu đề', 'Title'), r.name, { required: true, span: 'full' }),
                    k.field('contactName', t('Người liên hệ', 'Contact'), r.contact),
                    k.field('phone', t('Điện thoại', 'Phone'), r.phone, { type: 'tel' }),
                    k.field('email', 'Email', r.email, { type: 'email' }),
                    k.choose(
                      'priority',
                      t('Mức ưu tiên', 'Priority'),
                      String(Math.min(3, Math.max(0, r.priority ?? 0))),
                      priorities,
                    ),
                    k.field('tagIds', t('Nhãn', 'Tags'), '', {
                      type: 'checkbox-group',
                      span: 'full',
                      options: model.tags.map((tag) => ({
                        value: tag.id,
                        label: tag.name,
                        checked: r.tags.includes(tag.id),
                      })),
                    }),
                    k.check('consent', t('Khách đồng ý được liên hệ', 'Contact consent given'), r.consent),
                    k.field('description', t('Nhu cầu', 'Need'), r.description, {
                      type: 'textarea',
                      span: 'full',
                    }),
                  ],
                  r,
                )
              : DescriptionList({
                  label: t('Thông tin hồ sơ', 'Record details'),
                  items: [
                    { id: 'contact', label: t('Người liên hệ', 'Contact'), value: r.contact || '—' },
                    { id: 'phone', label: t('Điện thoại', 'Phone'), value: phoneLink(r.phone) },
                    { id: 'email', label: 'Email', value: r.email || '—' },
                    {
                      id: 'priority',
                      label: t('Mức ưu tiên', 'Priority'),
                      value: priorities[Math.min(3, Math.max(0, r.priority ?? 0))].name,
                    },
                    {
                      id: 'tags',
                      label: t('Nhãn', 'Tags'),
                      value:
                        r.tags.map((id) => model.tags.find((tag) => tag.id === id)?.name ?? id).join(', ') ||
                        '—',
                    },
                    {
                      id: 'consent',
                      label: t('Đồng ý liên hệ', 'Contact consent'),
                      value: r.consent ? t('Có', 'Yes') : t('Chưa có', 'Not given'),
                    },
                    { id: 'need', label: t('Nhu cầu', 'Need'), value: r.description || '—' },
                  ],
                }),
          }),
          r.kind === 'opportunity'
            ? Surface({
                title: t('Dự báo', 'Forecast'),
                description: t(
                  'Giá trị và xác suất quyết định trọng số trên pipeline.',
                  "Value and probability set the pipeline's weighted amount.",
                ),
                body: editable
                  ? k.command(
                      'forecast-save',
                      t('Lưu dự báo', 'Save forecast'),
                      [
                        k.field(
                          'expectedRevenue',
                          t('Doanh thu dự kiến (₫)', 'Expected revenue (₫)'),
                          String(r.revenue),
                          {
                            type: 'number',
                            min: 0,
                            step: 1000,
                            required: true,
                          },
                        ),
                        k.field('probability', t('Xác suất (%)', 'Probability (%)'), String(r.probability), {
                          type: 'number',
                          min: 0,
                          max: 100,
                          required: true,
                        }),
                        k.field('expectedClosing', t('Dự kiến chốt', 'Expected close'), r.closing, {
                          type: 'date',
                        }),
                      ],
                      r,
                      {},
                      { columns: 3, variant: 'secondary' },
                    )
                  : DescriptionList({
                      label: t('Dự báo', 'Forecast'),
                      items: [
                        {
                          id: 'revenue',
                          label: t('Doanh thu dự kiến', 'Expected revenue'),
                          value: fmt.money(r.revenue),
                        },
                        {
                          id: 'probability',
                          label: t('Xác suất', 'Probability'),
                          value: `${r.probability}%`,
                        },
                        { id: 'weighted', label: t('Trọng số', 'Weighted'), value: fmt.money(r.weighted) },
                        {
                          id: 'closing',
                          label: t('Dự kiến chốt', 'Expected close'),
                          value: r.closing ? fmt.fullDate(r.closing) : close.label,
                        },
                      ],
                    }),
              })
            : null,
        ].filter(Boolean),
      })

    const quotesTab = () => {
      const chosen = detail.quotes.find((q) => q.id === k.query.get('quote')) ?? detail.quotes[0] ?? null
      const quoteActions = (q) =>
        editable
          ? Inline({
              gap: 'compact',
              wrap: true,
              items: [
                q.state === 'draft' || q.state === 'sent'
                  ? LinkButton({
                      label:
                        q.state === 'draft' ? t('Gửi báo giá', 'Send quote') : t('Gửi lại', 'Send again'),
                      href: dialogHref('quote-send', { quote: q.id }),
                      variant: q.state === 'draft' ? 'primary' : 'secondary',
                    })
                  : null,
                q.state === 'sent'
                  ? k.action(
                      'quote-accept',
                      t('Khách chấp nhận · tạo đơn', 'Accepted · create order'),
                      r,
                      { quoteId: q.id, quoteVersion: String(q.revision ?? q.version) },
                      'primary',
                    )
                  : null,
                q.state !== 'accepted'
                  ? LinkButton({
                      label: t('Sửa báo giá', 'Edit quote'),
                      href: dialogHref('quote-edit', { quote: q.id }),
                      variant: 'secondary',
                    })
                  : null,
              ].filter(Boolean),
            })
          : undefined
      return Stack({
        items: [
          Surface({
            title: t('Báo giá', 'Quotes'),
            actions:
              editable && r.kind === 'opportunity'
                ? Inline({
                    gap: 'compact',
                    items: [
                      // Quotes the customer was given in Sales, when the company lets an opportunity hold them.
                      detail.quotePolicy === 'attach'
                        ? LinkButton({
                            label: t('Gắn báo giá có sẵn', 'Attach an existing quote'),
                            href: dialogHref('quote-attach'),
                            variant: 'tertiary',
                          })
                        : null,
                      LinkButton({
                        label: t('Tạo báo giá', 'Create quote'),
                        href: dialogHref('quote-create'),
                        variant: 'tertiary',
                        icon: 'plus',
                      }),
                    ].filter(Boolean),
                  })
                : undefined,
            body: k.table({
              label: t('Báo giá của hồ sơ', "The record's quotes"),
              rows: detail.quotes,
              rowHref: (q) => k.here({ quote: q.id }),
              currentRow: chosen?.id ?? null,
              columns: [
                {
                  key: 'id',
                  label: t('Báo giá', 'Quote'),
                  priority: 'primary',
                  cell: (q) => k.lines(q.id, `${t('Lần sửa', 'Revision')} ${q.version}`),
                },
                {
                  key: 'state',
                  label: t('Trạng thái', 'Status'),
                  cell: (q) =>
                    k.badge(words.quoteState[q.state] ?? q.state, words.quoteTone[q.state] ?? 'neutral'),
                },
                {
                  key: 'total',
                  label: t('Tổng cộng', 'Total'),
                  align: 'end',
                  kind: 'currency',
                  cell: (q) => k.amount(q.total),
                },
                {
                  key: 'expires',
                  label: t('Hiệu lực đến', 'Valid until'),
                  priority: 'secondary',
                  cell: (q) => fmt.date(q.expires),
                },
                {
                  key: 'sent',
                  label: t('Ngày gửi', 'Sent'),
                  priority: 'tertiary',
                  cell: (q) =>
                    q.sentAt
                      ? k.lines(
                          fmt.date(q.sentAt),
                          q.lastSend ? (words.sendChannel[q.lastSend.channel] ?? q.lastSend.channel) : null,
                        )
                      : '—',
                },
              ],
              emptyTitle: t('Chưa có báo giá', 'No quotes yet'),
              emptyMessage:
                r.kind === 'opportunity'
                  ? t(
                      'Tạo báo giá từ sản phẩm để gửi khách.',
                      'Create a quote from products to send the customer.',
                    )
                  : t('Chuyển lead thành cơ hội để báo giá.', 'Convert the lead to an opportunity to quote.'),
            }),
          }),
          chosen
            ? Surface({
                title: `${t('Chi tiết', 'Details')} ${chosen.id}`,
                description: [
                  chosen.orderId
                    ? ((order) =>
                        [
                          `${t('Đơn', 'Order')} ${chosen.orderId}`,
                          order ? (words.orderState[order.state] ?? order.state) : null,
                          order ? (words.payment[order.payment] ?? order.payment) : null,
                        ]
                          .filter(Boolean)
                          .join(' · '))(detail.orders.find((o) => o.id === chosen.orderId))
                    : `${words.quoteState[chosen.state] ?? chosen.state} · ${t('hiệu lực đến', 'valid until')} ${fmt.fullDate(chosen.expires)}`,
                  // Where it last went, so whoever opens it knows what the customer has.
                  chosen.lastSend
                    ? chosen.lastSend.channel === 'hand'
                      ? `${t('Trao tận tay', 'Handed over')} ${fmt.date(chosen.lastSend.at)}`
                      : `${t('Gửi qua', 'Sent by')} ${words.sendChannel[chosen.lastSend.channel] ?? chosen.lastSend.channel} ${t('tới', 'to')} ${chosen.lastSend.recipient} · ${fmt.date(chosen.lastSend.at)}`
                    : null,
                ]
                  .filter(Boolean)
                  .join(' · '),
                actions: quoteActions(chosen),
                body: Stack({
                  items: [
                    k.table({
                      label: t(`Dòng sản phẩm của ${chosen.id}`, `Product lines of ${chosen.id}`),
                      rows: chosen.lines.map((l, i) => ({ ...l, id: `${chosen.id}-${i}` })),
                      columns: [
                        {
                          key: 'name',
                          label: t('Sản phẩm', 'Product'),
                          priority: 'primary',
                          wrap: true,
                          cell: (l) => l.name,
                        },
                        {
                          key: 'quantity',
                          label: t('SL', 'Qty'),
                          align: 'end',
                          kind: 'number',
                          cell: (l) => fmt.number(l.quantity),
                        },
                        {
                          key: 'price',
                          label: t('Đơn giá', 'Unit price'),
                          align: 'end',
                          kind: 'currency',
                          cell: (l) => fmt.money(l.price),
                        },
                        {
                          key: 'discount',
                          label: t('CK', 'Disc.'),
                          align: 'end',
                          priority: 'secondary',
                          cell: (l) => `${l.discount ?? 0}%`,
                        },
                        {
                          key: 'tax',
                          label: t('Thuế', 'Tax'),
                          align: 'end',
                          priority: 'secondary',
                          cell: (l) => `${l.tax}%`,
                        },
                        {
                          key: 'net',
                          label: t('Thành tiền', 'Net'),
                          align: 'end',
                          kind: 'currency',
                          cell: (l) => k.amount(l.net),
                        },
                      ],
                    }),
                    DescriptionList({
                      label: t('Tổng báo giá', 'Quote totals'),
                      columns: 3,
                      items: [
                        {
                          id: 'subtotal',
                          label: t('Tạm tính', 'Subtotal'),
                          value: fmt.money(chosen.subtotal),
                        },
                        { id: 'tax', label: t('Thuế', 'Tax'), value: fmt.money(chosen.taxAmount) },
                        { id: 'total', label: t('Tổng cộng', 'Total'), value: fmt.money(chosen.total) },
                      ],
                    }),
                  ],
                }),
              })
            : null,
          Surface({
            title: t('Đơn hàng', 'Orders'),
            body: k.table({
              label: t('Đơn hàng của hồ sơ', "The record's orders"),
              rows: detail.orders,
              columns: [
                {
                  key: 'id',
                  label: t('Đơn', 'Order'),
                  priority: 'primary',
                  cell: (o) => k.lines(o.id, o.quoteId ? `${t('Từ', 'From')} ${o.quoteId}` : null),
                },
                {
                  key: 'total',
                  label: t('Giá trị', 'Value'),
                  align: 'end',
                  kind: 'currency',
                  cell: (o) => k.amount(o.total),
                },
                {
                  key: 'state',
                  label: t('Giao hàng', 'Delivery'),
                  cell: (o) =>
                    k.badge(words.orderState[o.state] ?? o.state, words.orderTone[o.state] ?? 'neutral'),
                },
                {
                  key: 'payment',
                  label: t('Thanh toán', 'Payment'),
                  cell: (o) =>
                    k.badge(
                      words.payment[o.payment] ?? o.payment,
                      o.payment === 'paid' ? 'positive' : 'warning',
                    ),
                },
              ],
              emptyTitle: t('Chưa có đơn hàng', 'No orders yet'),
              emptyMessage: t(
                'Đơn được tạo khi khách chấp nhận báo giá.',
                'An order is created when the customer accepts a quote.',
              ),
            }),
          }),
        ].filter(Boolean),
      })
    }

    const partner = detail.partner
    const preview = detail.assignment
    // What happens next leads the rail: the earliest open activity, or a warning that nothing is planned.
    const next = openActivities[0],
      nextDue = next ? fmt.due(next.dueAt) : null
    const rail = RecordRail({
      label: t('Bối cảnh hồ sơ', 'Record context'),
      sections: [
        open
          ? {
              id: 'next',
              title: t('Bước tiếp theo', 'Next step'),
              body: next
                ? Stack({
                    gap: 'compact',
                    items: [
                      k.lines(
                        next.title,
                        `${words.activityType[next.type] ?? next.type} · ${k.owner(next.owner)}`,
                      ),
                      Text({
                        children: nextDue.label,
                        variant: 'bodySm',
                        tone: nextDue.tone === 'neutral' ? 'default' : nextDue.tone,
                      }),
                    ],
                  })
                : Text({
                    children: t('Chưa có bước tiếp theo', 'No next step'),
                    variant: 'bodySm',
                    tone: 'warning',
                  }),
              actions: editable
                ? next
                  ? LinkButton({
                      label: t('Hoàn tất', 'Complete'),
                      href: dialogHref('activity-complete', { activity: next.id }),
                      variant: 'tertiary',
                    })
                  : LinkButton({
                      label: t('Lên lịch', 'Schedule'),
                      href: dialogHref('activity'),
                      variant: 'tertiary',
                    })
                : undefined,
            }
          : null,
        {
          id: 'customer',
          title: t('Khách hàng', 'Customer'),
          body: Stack({
            items: [
              DescriptionList({
                label: t('Khách hàng', 'Customer'),
                columns: 1,
                items: [
                  { id: 'name', label: t('Tên', 'Name'), value: partner?.name ?? r.partner },
                  {
                    id: 'contact',
                    label: t('Liên hệ', 'Contact'),
                    value: r.contact || partner?.contactName || '—',
                  },
                  {
                    id: 'phone',
                    label: t('Điện thoại', 'Phone'),
                    value: phoneLink(r.phone || partner?.phone),
                  },
                  { id: 'email', label: 'Email', value: r.email || partner?.email || '—' },
                  {
                    id: 'consent',
                    label: t('Đồng ý liên hệ', 'Contact consent'),
                    value: r.consent ? t('Có', 'Yes') : t('Chưa có', 'Not given'),
                  },
                ],
              }),
              detail.related.length
                ? Stack({
                    gap: 'compact',
                    items: [
                      k.muted(
                        t(
                          `${detail.related.length} nhu cầu khác của khách`,
                          `${detail.related.length} other needs of this customer`,
                        ),
                      ),
                      ...detail.related.slice(0, 5).map((rel) =>
                        LinkButton({
                          label: `${rel.name} · ${words.terminal[rel.terminal]}`,
                          href: k.href('lead-detail', { id: rel.id, returnTo: k.query.get('returnTo') }),
                          variant: 'tertiary',
                          truncateLabel: true,
                        }),
                      ),
                    ],
                  })
                : null,
            ].filter(Boolean),
          }),
        },
        {
          id: 'assignment',
          title: t('Phụ trách & phân công', 'Ownership'),
          body: DescriptionList({
            label: t('Phụ trách & phân công', 'Ownership'),
            columns: 1,
            items: [
              { id: 'owner', label: t('Người phụ trách', 'Owner'), value: k.owner(r.assignee) },
              { id: 'team', label: t('Đội', 'Team'), value: k.teamName(r.teamId) || '—' },
              {
                id: 'rule',
                label: t('Quy tắc sẽ áp dụng', 'Rule that would apply'),
                value: preview ? `${preview.rule} → ${k.owner(preview.owner)}` : '—',
              },
            ],
          }),
          actions:
            editable && admin
              ? LinkButton({
                  label: t('Phân công', 'Assign'),
                  href: dialogHref('assign'),
                  variant: 'tertiary',
                })
              : undefined,
        },
        {
          id: 'score',
          title: `${t('Điểm', 'Score')} · ${r.score}`,
          body: Stack({
            gap: 'compact',
            items: detail.score.length
              ? detail.score.map((s) =>
                  Text({
                    children: `${s.matched ? '✓' : '–'} ${s.name}${s.matched ? ` · +${s.points}` : ''}`,
                    variant: 'bodySm',
                    tone: s.matched ? 'default' : 'muted',
                  }),
                )
              : [k.muted(t('Chưa có quy tắc chấm điểm.', 'No scoring rules yet.'))],
          }),
        },
        ...(detail.duplicates.length
          ? [
              {
                id: 'duplicates',
                title: t('Có thể trùng', 'Possible duplicates'),
                body: Stack({
                  gap: 'compact',
                  items: [
                    k.muted(
                      t(
                        'Giữ các nhu cầu độc lập; chỉ gộp khi cùng khách, cùng nhu cầu và cả hai còn mở.',
                        'Keep independent needs. Merge only the same customer and need while both are open.',
                      ),
                    ),
                    ...detail.duplicates.slice(0, 4).map((d) =>
                      LinkButton({
                        label: `${d.name} · ${d.id}`,
                        href: k.href('lead-detail', { id: d.id, returnTo: k.query.get('returnTo') }),
                        variant: 'tertiary',
                        truncateLabel: true,
                      }),
                    ),
                  ],
                }),
                actions:
                  editable && admin && mergeable
                    ? LinkButton({
                        label: t('Xem tác động gộp', 'Review merge'),
                        href: dialogHref('merge'),
                        variant: 'tertiary',
                      })
                    : undefined,
              },
            ]
          : []),
      ].filter(Boolean),
    })

    return {
      title: r.name,
      view: shell(k, {
        title: r.name,
        status: Inline({
          gap: 'compact',
          wrap: true,
          items: [
            k.badge(words.kind[r.kind], 'neutral'),
            open
              ? k.badge(r.stageName, 'info')
              : k.badge(words.terminal[r.terminal], words.terminalTone[r.terminal]),
            ...(open
              ? (r.flags ?? []).map((f) => k.badge(words.attention[f] ?? f, flagTone[f] ?? 'warning'))
              : []),
          ],
        }),
        meta: Text({
          children: `${r.id} · ${r.partner} · ${t('Nguồn', 'Source')} ${r.source} · ${t('Cập nhật', 'Updated')} ${fmt.relative(r.updatedAt)}`,
          variant: 'bodySm',
          tone: 'muted',
        }),
        actions,
        path,
        navigation: Tabs({
          id: 'crm-record-tabs',
          label: t('Phần của hồ sơ', 'Record sections'),
          items: [
            {
              id: 'activity',
              label: t('Hoạt động', 'Activity'),
              href: k.here({ tab: null }),
              count: openActivities.length,
              active: tab === 'activity',
            },
            {
              id: 'detail',
              label: t('Thông tin', 'Details'),
              href: k.here({ tab: 'detail' }),
              active: tab === 'detail',
            },
            {
              id: 'quotes',
              label: t('Báo giá & đơn', 'Quotes & orders'),
              href: k.here({ tab: 'quotes' }),
              count: detail.quotes.length,
              active: tab === 'quotes',
            },
          ],
        }),
        body: Stack({
          items: [
            k.notice(),
            k.refusal(['note', 'save', 'forecast-save']),
            metrics,
            tab === 'detail' ? detailTab() : tab === 'quotes' ? quotesTab() : activityTab(),
          ].filter(Boolean),
        }),
        aside: rail,
      }),
      dialog: dialogs.caseDialog(k, detail, k.here({})),
    }
  }

  // ── Planner ───────────────────────────────────────────────────────────────────────────────
  const planner = (k) => {
    const { t, fmt, words, model } = k,
      pl = model.planner,
      today = model.clock.slice(0, 10),
      soon = addDays(today, 7)
    const day = (a) => a.dueAt.slice(0, 10)
    const overdue = pl.open.filter((a) => fmt.due(a.dueAt).tone === 'danger')
    const groups = {
      due: pl.open.filter((a) => day(a) <= today),
      week: pl.open.filter((a) => day(a) > today && day(a) <= soon),
      later: pl.open.filter((a) => day(a) > soon),
      all: pl.open,
    }
    const bucket = Object.hasOwn(groups, k.query.get('bucket')) ? k.query.get('bucket') : 'due'
    const rows = groups[bucket]
    const at = (b) => k.here({ bucket: b === 'due' ? null : b })
    const metrics = Grid({
      columns: 4,
      mobileColumns: 2,
      items: [
        Metric({
          label: t('Quá hạn', 'Overdue'),
          value: fmt.number(overdue.length),
          tone: overdue.length ? 'danger' : undefined,
          href: at('due'),
        }),
        Metric({
          label: t('Hôm nay', 'Today'),
          value: fmt.number(groups.due.length - overdue.length),
          detail: t('Chưa đến giờ hẹn', 'Not yet due'),
          href: at('due'),
        }),
        Metric({
          label: t('7 ngày tới', 'Next 7 days'),
          value: fmt.number(groups.week.length),
          href: at('week'),
        }),
        Metric({
          label: t('Hoàn tất hôm nay', 'Completed today'),
          value: fmt.number(pl.doneToday),
          tone: pl.doneToday ? 'positive' : undefined,
        }),
      ],
    })
    const queue = k.table({
      label: t('Hàng đợi công việc', 'Activity queue'),
      rows,
      rowHref: (a) =>
        a.record.writable && model.can.write
          ? k.here({ dialog: 'activity-complete', id: a.record.id, activity: a.id })
          : recordHref(k, a.record.id),
      columns: [
        {
          key: 'title',
          label: t('Việc', 'Activity'),
          priority: 'primary',
          wrap: true,
          cell: (a) => k.lines(a.title, words.activityType[a.type] ?? a.type),
        },
        {
          key: 'due',
          label: t('Hạn', 'Due'),
          cell: (a) => {
            const due = fmt.due(a.dueAt)
            return Text({
              children: due.label,
              variant: 'bodyMd',
              tone: due.tone === 'neutral' ? 'default' : due.tone,
            })
          },
        },
        {
          key: 'record',
          label: t('Hồ sơ', 'Record'),
          wrap: true,
          cell: (a) => k.lines(a.record.name, `${a.record.id} · ${a.record.partner}`),
        },
        {
          key: 'value',
          label: t('Giá trị', 'Value'),
          align: 'end',
          priority: 'secondary',
          cell: (a) =>
            a.record.kind === 'opportunity' ? k.amount(a.record.revenue, true) : k.muted(words.kind.lead),
        },
        {
          key: 'owner',
          label: t('Phụ trách', 'Owner'),
          priority: 'secondary',
          cell: (a) => k.owner(a.owner),
        },
      ],
      emptyTitle:
        bucket === 'due'
          ? t('Không còn việc đến hạn', 'Nothing due')
          : t('Không có việc trong nhóm này', 'No activities here'),
      emptyMessage:
        bucket === 'due'
          ? t('Mọi việc quá hạn và hôm nay đã xong.', 'Everything overdue or due today is done.')
          : t('Chọn nhóm khác hoặc đổi bộ lọc.', 'Pick another group or change the filters.'),
    })
    const owners = pl.owners.length ? pl.owners : [model.actor.id]
    const week = DataMatrix({
      title: t('Lịch tuần này', 'This week'),
      description: routes.demo
        ? t(
            'Lịch mô phỏng; chưa kết nối Google/Outlook.',
            'Simulated calendar; not connected to Google or Outlook.',
          )
        : t('Việc còn mở theo ngày đến hạn.', 'Open activities by due day.'),
      label: t('Số việc mở theo người và ngày', 'Open activities by owner and day'),
      rowLabel: t('Người phụ trách', 'Owner'),
      columns: pl.week.map((d) => ({ id: d, label: `${fmt.weekday(d)} ${fmt.date(d)}` })),
      rows: owners.map((owner) => ({
        id: owner,
        label: k.owner(owner),
        cells: Object.fromEntries(
          pl.week.map((d) => {
            const count = pl.open.filter((a) => a.owner === owner && day(a) === d).length
            return [
              d,
              count
                ? Text({
                    children: fmt.number(count),
                    variant: 'bodyMd',
                    numeric: true,
                    tone: d < today ? 'danger' : d === today ? 'warning' : 'default',
                  })
                : k.muted('—'),
            ]
          }),
        ),
      })),
    })
    return {
      title: salesTitle('activity-planner', k.lang),
      view: shell(k, {
        title: salesTitle('activity-planner', k.lang),
        actions: group([
          LinkButton({
            label: t('Mở pipeline', 'Open pipeline'),
            href: k.href('pipeline'),
            variant: 'secondary',
          }),
        ]),
        controls: Inline({
          wrap: true,
          items: [
            choice(k, 'owner', t('Người phụ trách', 'Owner'), pl.filters.owner, people(k)),
            choice(k, 'type', t('Loại việc', 'Type'), pl.filters.type, [
              { id: '', label: t('Mọi loại', 'All types') },
              ...Object.entries(words.activityType).map(([id, label]) => ({ id, label })),
            ]),
          ],
        }),
        body: Stack({
          items: [
            k.notice(),
            k.refusal(),
            metrics,
            Stack({
              gap: 'compact',
              items: [
                Tabs({
                  id: 'crm-planner-buckets',
                  label: t('Nhóm công việc', 'Activity groups'),
                  items: [
                    {
                      id: 'due',
                      label: t('Quá hạn & hôm nay', 'Overdue & today'),
                      href: at('due'),
                      count: groups.due.length,
                      active: bucket === 'due',
                    },
                    {
                      id: 'week',
                      label: t('7 ngày tới', 'Next 7 days'),
                      href: at('week'),
                      count: groups.week.length,
                      active: bucket === 'week',
                    },
                    {
                      id: 'later',
                      label: t('Sau đó', 'Later'),
                      href: at('later'),
                      count: groups.later.length,
                      active: bucket === 'later',
                    },
                    {
                      id: 'all',
                      label: t('Tất cả việc mở', 'All open'),
                      href: at('all'),
                      count: groups.all.length,
                      active: bucket === 'all',
                    },
                  ],
                }),
                queue,
              ],
            }),
            week,
          ].filter(Boolean),
        }),
      }),
      dialog: k.query.get('dialog')
        ? dialogs.caseDialog(k, model.detail ?? null, k.here({ id: null }))
        : null,
    }
  }

  // ── New record ────────────────────────────────────────────────────────────────────────────
  const leadNew = (k) => {
    const { t, model } = k,
      intake = k.query.get('dialog') === 'intake'
    const title = intake ? t('Tiếp nhận lead từ nguồn', 'Lead intake') : salesTitle('lead-new', k.lang)
    if (!model.can.write)
      return {
        title,
        view: shell(k, {
          title,
          body: EmptyState({
            visual: 'locked',
            title: t('Chỉ xem', 'Read only'),
            message: t('Vai trò hiện tại không được tạo hồ sơ.', 'Your role cannot create records.'),
          }),
        }),
      }
    const contacts = model.form.contacts,
      prefill = model.form.prefill ?? {},
      typed = k.env.leadDraft?.() ?? {},
      phone = digits(typed.phone),
      email = String(typed.email ?? '')
        .trim()
        .toLowerCase()
    const match =
      typed.partnerId === 'new'
        ? null
        : contacts.find(
            (c) =>
              (phone.length >= 6 && digits(c.phone) === phone) ||
              (email.includes('@') && c.email.toLowerCase() === email),
          )
    const duplicate = match
      ? Notice({
          tone: 'warning',
          announcement: 'polite',
          title: t('Đã có khách hàng trùng liên hệ', 'A customer with this contact exists'),
          message: t(
            `${match.name}${match.contactName ? ` · ${match.contactName}` : ''} đang có ${match.open.length} nhu cầu mở. Hồ sơ mới sẽ dùng chung khách hàng này nhưng giữ nhu cầu riêng; chọn "Tạo khách mới" nếu đây là người khác.`,
            `${match.name}${match.contactName ? ` · ${match.contactName}` : ''} has ${match.open.length} open needs. The new record shares this customer but keeps its own need; choose "Create a new customer" if this is someone else.`,
          ),
          actions: match.open.length
            ? Inline({
                gap: 'compact',
                wrap: true,
                items: match.open.slice(0, 3).map((o) =>
                  LinkButton({
                    label: `${o.name} · ${o.id}`,
                    href: k.href('lead-detail', { id: o.id }),
                    variant: 'tertiary',
                    truncateLabel: true,
                  }),
                ),
              })
            : undefined,
        })
      : null
    const activeTeams = model.teams.filter((x) => x.active)
    const sources = (intake ? model.intakeSources : model.form.sources) ?? []
    const f = {
      name: k.field('name', t('Tiêu đề nhu cầu', 'Need title'), '', {
        required: true,
        span: 'full',
        placeholder: t('Ví dụ: Tư vấn liệu trình cho da dầu', 'e.g. Treatment plan for oily skin'),
      }),
      kind: k.choose('kind', t('Loại hồ sơ', 'Record kind'), prefill.kind ?? 'lead', [
        { id: 'lead', name: t('Lead · cần đánh giá', 'Lead · to qualify') },
        { id: 'opportunity', name: t('Cơ hội · đã có nhu cầu rõ', 'Opportunity · qualified need') },
      ]),
      description: k.field('description', t('Nhu cầu', 'Need'), '', { type: 'textarea', span: 'full' }),
      partnerId: k.choose('partnerId', t('Khách hàng', 'Customer'), prefill.partnerId ?? '', [
        { id: '', name: t('Tự khớp theo điện thoại/email', 'Match by phone or email') },
        { id: 'new', name: t('Tạo khách mới · giữ định danh riêng', 'Create a new customer') },
        ...contacts.map((c) => ({ id: c.id, name: c.phone ? `${c.name} · ${c.phone}` : c.name })),
      ]),
      contactName: k.field('contactName', t('Người liên hệ', 'Contact'), prefill.contactName ?? ''),
      phone: k.field('phone', t('Điện thoại', 'Phone'), prefill.phone ?? '', {
        type: 'tel',
        inputMode: 'tel',
      }),
      email: k.field('email', 'Email', prefill.email ?? '', { type: 'email' }),
      source: k.choose(
        'source',
        t('Nguồn', 'Source'),
        sources[0],
        sources.map((s) => ({ id: s, name: s })),
      ),
      externalId: intake
        ? k.field('externalId', t('Mã sự kiện nguồn', 'Source event ID'), '', {
            required: true,
            help: t('Mã đã xử lý sẽ không tạo hồ sơ trùng.', 'A processed ID never creates a second record.'),
          })
        : null,
      consent: k.check('consent', t('Khách đồng ý được liên hệ', 'Contact consent given'), false),
      utm: {
        name: 'utm',
        label: t('Chiến dịch (UTM)', 'Campaign (UTM)'),
        span: 'full',
        fields: [
          k.field('utmSource', 'UTM source'),
          k.field('utmMedium', 'UTM medium'),
          k.field('utmCampaign', 'UTM campaign'),
        ],
      },
      teamId: k.choose(
        'teamId',
        t('Đội', 'Team'),
        activeTeams.find((x) => x.id === 'consulting')?.id ?? activeTeams[0]?.id ?? '',
        activeTeams,
      ),
      expectedRevenue: k.field('expectedRevenue', t('Doanh thu dự kiến (₫)', 'Expected revenue (₫)'), '0', {
        type: 'number',
        min: 0,
        step: 1000,
        help: t('Chỉ tính khi là cơ hội.', 'Counts only for an opportunity.'),
      }),
      probability: k.field('probability', t('Xác suất (%)', 'Probability (%)'), '10', {
        type: 'number',
        min: 0,
        max: 100,
      }),
      expectedClosing: k.field('expectedClosing', t('Dự kiến chốt', 'Expected close'), '', { type: 'date' }),
    }
    // The order a salesperson takes a call in: what is needed, who asks, where they came from, who takes it.
    const sections = [
      { id: 'need', title: t('Nhu cầu', 'Need'), fields: [f.name, f.kind, f.description] },
      {
        id: 'customer',
        title: t('Khách hàng và liên hệ', 'Customer and contact'),
        fields: [f.partnerId, f.contactName, f.phone, f.email],
      },
      {
        id: 'source',
        title: t('Nguồn và đồng ý', 'Source and consent'),
        fields: [f.source, f.externalId, f.consent, f.utm].filter(Boolean),
      },
      {
        id: 'assignment',
        title: t('Phân công và giá trị', 'Assignment and value'),
        description: t(
          'Quy tắc phân công của đội chọn người phụ trách khi tạo.',
          "The team's assignment rules pick the owner on creation.",
        ),
        fields: [f.teamId, f.expectedRevenue, f.probability, f.expectedClosing],
      },
    ]
    const fields = sections.flatMap((section) => section.fields)
    return {
      title,
      view: shell(k, {
        title,
        // Stack keys its items by position. The notices keep their places while empty, so the form stays the
        // same element and keeps what is typed when the duplicate warning appears above it.
        body: Stack({
          items: [
            k.refusal(['create', 'intake']),
            duplicate,
            html`<div data-crm-lead-form>
              ${k.command(
                intake ? 'intake' : 'create',
                t('Tạo hồ sơ', 'Create record'),
                fields,
                null,
                {},
                {
                  cancelHref: safeReturn(routes, k.query.get('returnTo'), k.href('cases')),
                  sections,
                },
              )}
            </div>`,
          ],
        }),
      }),
    }
  }

  // ── Configuration ─────────────────────────────────────────────────────────────────────────
  const settings = (k) => {
    const { t, fmt, words, model } = k,
      s = model.settings,
      g = s.groups,
      admin = model.can.admin
    // The address owns the tab: following a tab link redraws the same read without fetching it again.
    const tab = ['process', 'scoring'].includes(k.query.get('tab')) ? k.query.get('tab') : 'people'
    const edit = (groupName) =>
      admin ? (row) => k.here({ dialog: 'config', group: groupName, configId: row.id }) : undefined
    const add = (groupName, label) =>
      admin
        ? LinkButton({
            label,
            href: k.here({ dialog: 'config', group: groupName }),
            variant: 'tertiary',
            icon: 'plus',
          })
        : undefined
    const active = (row) =>
      row.active ? k.badge(t('Đang dùng', 'Active'), 'positive') : k.badge(t('Tắt', 'Off'))
    const kinds = (allowed) =>
      allowed.length === 2
        ? t('Lead & cơ hội', 'Leads & opportunities')
        : allowed[0] === 'lead'
          ? t('Chỉ lead', 'Leads only')
          : t('Chỉ cơ hội', 'Opportunities only')
    const teamsTab = () => [
      k.table({
        title: t('Đội bán hàng', 'Sales teams'),
        description: t(
          'Mở một đội để xem tải việc và thành viên.',
          'Open a team to see its members and load.',
        ),
        actions: add('teams', t('Thêm đội', 'Add team')),
        rows: g.teams,
        rowHref: (row) => k.href('crm-team', { team: row.id }),
        columns: [
          { key: 'name', label: t('Đội', 'Team'), priority: 'primary', cell: (row) => row.name },
          { key: 'leader', label: t('Trưởng nhóm', 'Leader'), cell: (row) => k.owner(row.leaderUserId) },
          {
            key: 'mode',
            label: t('Cách phân công', 'Assignment'),
            priority: 'secondary',
            cell: (row) => words.assignmentMode[row.assignmentMode] ?? row.assignmentMode,
          },
          {
            key: 'members',
            label: t('Thành viên', 'Members'),
            align: 'end',
            kind: 'number',
            cell: (row) => fmt.number(row.members),
          },
          {
            key: 'open',
            label: t('Hồ sơ mở', 'Open'),
            align: 'end',
            kind: 'number',
            cell: (row) => fmt.number(row.open),
          },
          { key: 'active', label: t('Trạng thái', 'Status'), cell: active },
        ],
      }),
      k.table({
        title: t('Quy tắc phân công', 'Assignment rules'),
        description: t(
          'Xét theo thứ tự ưu tiên; quy tắc đầu tiên khớp sẽ giao hồ sơ.',
          'Evaluated by priority; the first match assigns the record.',
        ),
        actions: add('assignmentRules', t('Thêm quy tắc', 'Add rule')),
        rows: [...g.assignmentRules].sort((a, b) => a.priority - b.priority),
        rowHref: edit('assignmentRules'),
        columns: [
          {
            key: 'name',
            label: t('Quy tắc', 'Rule'),
            priority: 'primary',
            wrap: true,
            cell: (row) => row.name,
          },
          {
            key: 'priority',
            label: t('Ưu tiên', 'Priority'),
            align: 'end',
            kind: 'number',
            cell: (row) => String(row.priority),
          },
          {
            key: 'when',
            label: t('Điều kiện', 'Condition'),
            wrap: true,
            cell: (row) =>
              [
                row.utmSource ? `${t('Nguồn', 'Source')} = ${row.utmSource}` : null,
                row.minimumScore !== null && row.minimumScore !== undefined && row.minimumScore !== ''
                  ? `${t('Điểm', 'Score')} ≥ ${row.minimumScore}`
                  : null,
              ]
                .filter(Boolean)
                .join(' · ') || t('Mọi hồ sơ', 'Every record'),
          },
          {
            key: 'team',
            label: t('Giao cho', 'Assign to'),
            cell: (row) =>
              k.lines(
                k.teamName(row.teamId) || '—',
                row.assigneeUserId
                  ? k.owner(row.assigneeUserId)
                  : t('Theo cách của đội', "By the team's mode"),
              ),
          },
          { key: 'active', label: t('Trạng thái', 'Status'), cell: active },
        ],
      }),
      k.table({
        title: t('Mô phỏng phân công', 'Assignment simulation'),
        description: t(
          'Hồ sơ mở đầu tiên chạy qua quy tắc hiện tại; không ghi dữ liệu.',
          'The first open records run through the current rules; nothing is written.',
        ),
        rows: s.simulation,
        rowHref: (row) => recordHref(k, row.id),
        columns: [
          {
            key: 'name',
            label: t('Hồ sơ', 'Record'),
            priority: 'primary',
            wrap: true,
            cell: (row) => k.lines(row.name, `${row.id} · ${row.source}`),
          },
          {
            key: 'score',
            label: t('Điểm', 'Score'),
            align: 'end',
            kind: 'number',
            cell: (row) => String(row.score),
          },
          {
            key: 'current',
            label: t('Đang phụ trách', 'Current owner'),
            priority: 'secondary',
            cell: (row) => k.owner(row.assignee),
          },
          {
            key: 'preview',
            label: t('Quy tắc sẽ giao', 'Rule would assign'),
            wrap: true,
            cell: (row) => k.lines(k.owner(row.preview.owner), row.preview.rule),
          },
        ],
      }),
    ]
    const processTab = () => [
      k.table({
        title: t('Giai đoạn bán hàng', 'Sales stages'),
        description: t(
          'Pipeline đọc từ trái sang phải theo thứ tự.',
          'The pipeline reads left to right in this order.',
        ),
        actions: add('stages', t('Thêm giai đoạn', 'Add stage')),
        rows: g.stages,
        rowHref: edit('stages'),
        columns: [
          { key: 'name', label: t('Giai đoạn', 'Stage'), priority: 'primary', cell: (row) => row.name },
          { key: 'sequence', label: '#', align: 'end', kind: 'number', cell: (row) => String(row.sequence) },
          {
            key: 'probability',
            label: t('Xác suất', 'Probability'),
            align: 'end',
            cell: (row) =>
              row.probability === null || row.probability === undefined ? '—' : `${row.probability}%`,
          },
          {
            key: 'stale',
            label: t('Cảnh báo đứng yên', 'Idle warning'),
            align: 'end',
            priority: 'secondary',
            cell: (row) => (row.staleDays ? fmt.days(row.staleDays) : '—'),
          },
          {
            key: 'kinds',
            label: t('Nhận', 'Accepts'),
            priority: 'secondary',
            cell: (row) => kinds(row.allowedKinds),
          },
          {
            key: 'type',
            label: t('Loại', 'Type'),
            cell: (row) => k.badge(words.terminal[row.terminalState], words.terminalTone[row.terminalState]),
          },
          {
            key: 'open',
            label: t('Hồ sơ', 'Records'),
            align: 'end',
            kind: 'number',
            cell: (row) => fmt.number(row.open),
          },
          { key: 'active', label: t('Trạng thái', 'Status'), priority: 'secondary', cell: active },
        ],
      }),
      k.table({
        title: t('Lý do thất bại', 'Loss reasons'),
        actions: add('lostReasons', t('Thêm lý do', 'Add reason')),
        rows: g.lostReasons,
        rowHref: edit('lostReasons'),
        columns: [
          { key: 'name', label: t('Lý do', 'Reason'), priority: 'primary', cell: (row) => row.name },
          {
            key: 'note',
            label: t('Ghi chú', 'Note'),
            cell: (row) => (row.requiresNote ? t('Bắt buộc', 'Required') : t('Không bắt buộc', 'Optional')),
          },
          {
            key: 'used',
            label: t('Đã dùng', 'Used'),
            align: 'end',
            kind: 'number',
            cell: (row) => fmt.number(row.used),
          },
          { key: 'active', label: t('Trạng thái', 'Status'), cell: active },
        ],
      }),
      k.table({
        title: t('Nhãn', 'Tags'),
        actions: add('tags', t('Thêm nhãn', 'Add tag')),
        rows: g.tags,
        rowHref: edit('tags'),
        columns: [
          { key: 'name', label: t('Nhãn', 'Tag'), priority: 'primary', cell: (row) => row.name },
          {
            key: 'used',
            label: t('Đang gắn', 'In use'),
            align: 'end',
            kind: 'number',
            cell: (row) => fmt.number(row.used),
          },
          { key: 'active', label: t('Trạng thái', 'Status'), cell: active },
        ],
      }),
      // Whether an opportunity may hold quotes written in Sales, not only the ones written from it.
      Surface({
        title: t('Báo giá từ Bán hàng', 'Quotes from Sales'),
        actions: admin
          ? LinkButton({
              label: t('Đổi cách gắn', 'Change'),
              href: k.here({ dialog: 'quote-policy' }),
              variant: 'tertiary',
            })
          : undefined,
        body: DescriptionList({
          label: t('Báo giá từ Bán hàng', 'Quotes from Sales'),
          items: [
            {
              id: 'saleQuotations',
              label: t('Cơ hội giữ', 'An opportunity holds'),
              value: words.quotePolicy[s.quotationPolicy?.saleQuotations ?? 'off'],
            },
          ],
        }),
      }),
    ]
    const operators = {
      present: t('có giá trị', 'is present'),
      eq: '=',
      contains: t('chứa', 'contains'),
      gte: '≥',
    }
    const scoringTab = () => [
      k.table({
        title: t('Quy tắc chấm điểm', 'Scoring rules'),
        description: t(
          'Điểm lead là tổng điểm các quy tắc khớp.',
          "A lead's score adds up the matching rules.",
        ),
        actions: add('scoreRules', t('Thêm quy tắc', 'Add rule')),
        rows: g.scoreRules,
        rowHref: edit('scoreRules'),
        columns: [
          { key: 'name', label: t('Quy tắc', 'Rule'), priority: 'primary', cell: (row) => row.name },
          {
            key: 'condition',
            label: t('Điều kiện', 'Condition'),
            wrap: true,
            cell: (row) =>
              `${row.field} ${operators[row.operator] ?? row.operator}${row.operator === 'present' ? '' : ` ${row.value}`}`,
          },
          {
            key: 'points',
            label: t('Điểm', 'Points'),
            align: 'end',
            kind: 'number',
            cell: (row) => `+${row.points}`,
          },
          { key: 'active', label: t('Trạng thái', 'Status'), cell: active },
        ],
      }),
      k.table({
        title: t('Điểm của hồ sơ đang mở', 'Scores of open records'),
        description: t(
          'Quy tắc nào đã cộng điểm cho từng hồ sơ.',
          'Which rules added points to each record.',
        ),
        rows: s.simulation,
        rowHref: (row) => recordHref(k, row.id),
        columns: [
          {
            key: 'name',
            label: t('Hồ sơ', 'Record'),
            priority: 'primary',
            wrap: true,
            cell: (row) => k.lines(row.name, row.id),
          },
          {
            key: 'score',
            label: t('Điểm', 'Score'),
            align: 'end',
            kind: 'number',
            cell: (row) => String(row.score),
          },
          {
            key: 'matched',
            label: t('Quy tắc khớp', 'Matching rules'),
            wrap: true,
            cell: (row) =>
              row.points
                .filter((p) => p.matched)
                .map((p) => `${p.name} +${p.points}`)
                .join(' · ') || t('Không khớp quy tắc nào', 'No rule matched'),
          },
        ],
      }),
    ]
    return {
      title: salesTitle('crm-settings', k.lang),
      view: shell(k, {
        title: salesTitle('crm-settings', k.lang),
        controls: Tabs({
          id: 'crm-settings-tabs',
          label: t('Nhóm cấu hình', 'Configuration groups'),
          items: [
            {
              id: 'people',
              label: t('Đội & phân công', 'Teams & assignment'),
              href: k.here({ tab: null }),
              active: tab === 'people',
            },
            {
              id: 'process',
              label: t('Quy trình bán hàng', 'Sales process'),
              href: k.here({ tab: 'process' }),
              active: tab === 'process',
            },
            {
              id: 'scoring',
              label: t('Chấm điểm lead', 'Lead scoring'),
              href: k.here({ tab: 'scoring' }),
              active: tab === 'scoring',
            },
          ],
        }),
        body: Stack({
          items: [
            k.notice(),
            k.refusal(['config-save']),
            admin
              ? null
              : Notice({
                  tone: 'info',
                  title: t('Chỉ xem cấu hình', 'Configuration is read only'),
                  message: t(
                    'Chỉ quản lý được sửa đội, quy trình và quy tắc.',
                    'Only managers can change teams, process and rules.',
                  ),
                }),
            ...(tab === 'process' ? processTab() : tab === 'scoring' ? scoringTab() : teamsTab()),
          ].filter(Boolean),
        }),
      }),
      dialog: dialogs.standaloneDialog(k, k.here({})),
    }
  }

  const team = (k) => {
    const { t, fmt, words, model } = k,
      admin = model.can.admin,
      x = model.team
    if (!x)
      return {
        title: t('Không tìm thấy đội', 'Team unavailable'),
        view: shell(k, {
          title: t('Không tìm thấy đội', 'Team unavailable'),
          body: EmptyState({
            visual: 'locked',
            title: t('Không tìm thấy đội', 'Team unavailable'),
            message: t('Đội không tồn tại hoặc đã bị xóa.', 'The team does not exist or was removed.'),
          }),
        }),
      }
    const month = model.clock.slice(0, 7)
    const busiest = Math.max(1, ...x.members.map((m) => m.open))
    return {
      title: x.name,
      view: shell(k, {
        title: x.name,
        status: x.active
          ? k.badge(t('Đang hoạt động', 'Active'), 'positive')
          : k.badge(t('Tạm dừng', 'Paused'), 'warning'),
        meta: Text({
          children: `${words.assignmentMode[x.assignmentMode] ?? x.assignmentMode} · ${t('Trưởng nhóm', 'Leader')} ${k.owner(x.leaderUserId)}`,
          variant: 'bodySm',
          tone: 'muted',
        }),
        actions: group([
          k.back(t('Về cấu hình', 'Back to configuration'), k.href('crm-settings')),
          admin
            ? LinkButton({
                label: t('Sửa đội', 'Edit team'),
                href: k.here({ dialog: 'config', group: 'teams', configId: x.id }),
                variant: 'secondary',
              })
            : null,
          admin
            ? LinkButton({
                label: t('Thêm thành viên', 'Add member'),
                href: k.here({ dialog: 'member' }),
                variant: 'primary',
                icon: 'plus',
              })
            : null,
        ]),
        body: Stack({
          items: [
            k.notice(),
            k.refusal(['member-save', 'config-save']),
            Grid({
              columns: 4,
              mobileColumns: 2,
              items: [
                Metric({
                  label: t('Hồ sơ mở', 'Open records'),
                  value: fmt.number(x.open),
                  href: k.href('cases', { view: 'open', team: x.id }),
                }),
                Metric({
                  label: t('Chưa phân công', 'Unassigned'),
                  value: fmt.number(x.unassigned),
                  tone: x.unassigned ? 'warning' : undefined,
                  href: k.href('cases', { view: 'open', team: x.id, owner: 'none' }),
                }),
                Metric({
                  label: t('Pipeline', 'Pipeline'),
                  value: fmt.short(x.gross),
                  detail: t('Tổng cơ hội mở', 'Open deals total'),
                }),
                Metric({
                  label: t('Thắng tháng này', 'Won this month'),
                  value: fmt.short(x.won),
                  href: k.href('cases', { view: 'won', team: x.id, closed: month }),
                }),
              ],
            }),
            k.table({
              title: t('Thành viên', 'Members'),
              description: t(
                'Tải việc tính trên hồ sơ mở của từng người trong phạm vi xem.',
                "Load counts each person's open records within your scope.",
              ),
              rows: x.members,
              rowHref: admin
                ? (m) => k.here({ dialog: 'member', memberId: m.id })
                : (m) => k.href('cases', { view: 'open', owner: m.userId }),
              columns: [
                {
                  key: 'name',
                  label: t('Thành viên', 'Member'),
                  priority: 'primary',
                  cell: (m) =>
                    k.lines(
                      k.owner(m.userId),
                      m.active ? null : t('Tạm dừng nhận hồ sơ', 'Not receiving records'),
                      'warning',
                    ),
                },
                {
                  key: 'capacity',
                  label: t('Trọng số nhận việc', 'Assignment weight'),
                  align: 'end',
                  kind: 'number',
                  priority: 'secondary',
                  cell: (m) => String(m.capacity),
                },
                {
                  key: 'load',
                  label: t('Tải việc', 'Load'),
                  cell: (m) =>
                    Progress({
                      value: Math.round((m.open / busiest) * 100),
                      label: t(
                        `${m.open} hồ sơ mở · ${m.inTeam} của đội`,
                        `${m.open} open · ${m.inTeam} in team`,
                      ),
                      tone: m.overdue ? 'warning' : 'primary',
                    }),
                },
                {
                  key: 'weighted',
                  label: t('Trọng số pipeline', 'Weighted'),
                  align: 'end',
                  kind: 'currency',
                  priority: 'secondary',
                  cell: (m) => fmt.short(m.weighted),
                },
                {
                  key: 'planned',
                  label: t('Việc', 'Activities'),
                  align: 'end',
                  cell: (m) =>
                    k.lines(
                      fmt.number(m.planned),
                      m.overdue ? t(`${m.overdue} quá hạn`, `${m.overdue} overdue`) : null,
                      'danger',
                    ),
                },
                {
                  key: 'won',
                  label: t('Thắng tháng này', 'Won this month'),
                  align: 'end',
                  kind: 'currency',
                  cell: (m) => fmt.short(m.won),
                },
              ],
              emptyTitle: t('Đội chưa có thành viên', 'No members yet'),
              emptyMessage: t(
                'Thêm thành viên để đội nhận hồ sơ.',
                'Add members so the team receives records.',
              ),
            }),
            k.table({
              title: t('Quy tắc phân công của đội', "The team's assignment rules"),
              rows: x.rules ?? model.rules ?? [],
              rowHref: admin
                ? (rule) => k.here({ dialog: 'config', group: 'assignmentRules', configId: rule.id })
                : undefined,
              columns: [
                { key: 'name', label: t('Quy tắc', 'Rule'), priority: 'primary', cell: (rule) => rule.name },
                {
                  key: 'priority',
                  label: t('Ưu tiên', 'Priority'),
                  align: 'end',
                  kind: 'number',
                  cell: (rule) => String(rule.priority),
                },
                {
                  key: 'active',
                  label: t('Trạng thái', 'Status'),
                  cell: (rule) =>
                    rule.active ? k.badge(t('Đang dùng', 'Active'), 'positive') : k.badge(t('Tắt', 'Off')),
                },
              ],
              emptyTitle: t('Chưa có quy tắc riêng', 'No rules of its own'),
              emptyMessage: t(
                'Hồ sơ của đội được giao theo cách phân công của đội.',
                "Records are assigned by the team's mode.",
              ),
            }),
          ].filter(Boolean),
        }),
      }),
      dialog: dialogs.standaloneDialog(k, k.here({})),
    }
  }

  const screens = {
    overview,
    pipeline,
    cases,
    'lead-detail': record,
    'lead-new': leadNew,
    'activity-planner': planner,
    'crm-settings': settings,
    'crm-team': team,
  }
  /** The screen from its read: the page, the hidden one-click forms and the dialog the address names. */
  const page = (model, env) => {
    const k = kitOf(model, env)
    const drawn = (screens[env.screen] ?? overview)(k)
    return {
      title: drawn.title,
      view: html`${drawn.view}${k.actionForms()}${drawn.dialog ? html`<div data-crm-form-dialog>${drawn.dialog}</div>` : null}`,
    }
  }
  return { frame, page }
}
