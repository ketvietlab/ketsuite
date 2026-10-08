/**
 * Spec's render-pure views. They read the model, the route and the try-it
 * state, and return markup; they never touch the document, history or the
 * network. The browser runtime (`./client.ts`) owns those.
 */
import {
  ActionGroup,
  AppBrand,
  AppNavigation,
  AppShell,
  AppTopbar,
  Badge,
  Button,
  Code,
  CodeBlock,
  DataTable,
  DescriptionList,
  Disclosure,
  EmptyState,
  Icon,
  Inline,
  LinkButton,
  LoadingState,
  ModalSheet,
  NavigationToggle,
  Notice,
  Section,
  Select,
  Stack,
  Surface,
  Text,
  TextArea,
  TextField,
  TreeGrid,
  WorkspacePage,
} from '@ketvietlab/design-system'
import type { NavigationItemData, Tone } from '@ketvietlab/design-system'
import type { JSXChild, TemplateResult } from '@ketvietlab/ketjs-view'
import type { MessageKey, Translate } from './messages.ts'
import {
  findOperation,
  type HttpMethod,
  isIdempotencyHeader,
  isMutating,
  type JsonObject,
  type ParameterLocation,
  type SecurityScheme,
  searchOperations,
  type SpecModel,
  type SpecOperation,
  type SpecParameter,
  type SpecProblem,
  type SpecResponse,
  type SpecResult,
  schemesAreAlternatives,
} from './model.ts'
import {
  credentialOptions,
  type FieldProblem,
  fieldName,
  isPublic,
  MAX_BODY_CHARS,
  type ReadResponse,
  schemeField,
  schemeTakesValue,
  tryParameters,
} from './request.ts'
import { MAX_SCHEMA_ROWS, type SchemaRow, schemaRows, typeLabel } from './schema.ts'

export type SpecRoute = { operation: string | null; group: string | null; q: string | null }

export type LoadFailure = { reason: 'fetch'; status: number } | { reason: 'network' } | { reason: 'json' }

export type SpecState =
  | { kind: 'loading' }
  | { kind: 'failed'; failure: LoadFailure }
  | { kind: 'ready'; result: SpecResult }

export type TryPhase =
  | 'idle'
  | 'invalid'
  | 'sending'
  | 'done'
  | 'network'
  | 'offline'
  | 'timeout'
  | 'cancelled'

export type TryState = {
  values: Readonly<Record<string, string>>
  problems: Readonly<Record<string, FieldProblem>>
  phase: TryPhase
  response: ReadResponse | null
  /** The curl command for the current values, or null while they are invalid. */
  preview: string | null
}

export type SpecBrand = { href: string; image: string; darkImage: string }

export type SpecViewProps = {
  state: SpecState
  route: SpecRoute
  t: Translate
  /** Builds a link for a route; the runtime and the server must agree on it. */
  href: (route: SpecRoute) => string
  brand: SpecBrand
  /** The try-it state of an operation; views never create it. */
  tryState: (operation: SpecOperation) => TryState
  /** Seconds before an unanswered request is abandoned; shown in the timeout notice. */
  timeoutSeconds: number
}

/** The search result list is bounded; the page says how many were left out. */
export const MAX_SEARCH_RESULTS = 200

export const NAVIGATION_ID = 'spec-navigation'
export const TRY_FORM_ID = 'spec-try'
export const TRY_CANCEL_ID = 'spec-try-cancel'
export const TRY_RESET_ID = 'spec-try-reset-body'
/** Generate buttons carry this suffix on the id of the field they fill. */
export const GENERATE_SUFFIX = '-generate'
/** The topbar command that opens the sign-in dialog, and the try form's own way to it. */
export const SIGN_IN_ID = 'spec-sign-in'
export const TRY_SIGN_IN_ID = 'spec-try-sign-in'
export const SIGN_IN_DIALOG_ID = 'spec-sign-in-dialog'
export const SIGN_IN_FORM_ID = 'spec-sign-in-form'
export const SIGN_OUT_ID = 'spec-sign-out'
export const SIGN_IN_CANCEL_ID = 'spec-sign-in-cancel'

/** Schemes a reader can supply by typing a value; cookies come from the browser. */
export const typedSchemes = (model: SpecModel): readonly SecurityScheme[] =>
  model.securitySchemes.filter(schemeTakesValue)

/** Whether any credential has been entered in this tab. */
export const isSignedIn = (credentials: Readonly<Record<string, string>>): boolean =>
  Object.values(credentials).some((value) => value !== '')

export const emptyRoute: SpecRoute = { operation: null, group: null, q: null }

/** `?operation=` wins over `?group=`, which wins over `?q=`; blank values count as absent. */
export const routeFrom = (search: string | URLSearchParams): SpecRoute => {
  const params = typeof search === 'string' ? new URLSearchParams(search) : search
  const read = (name: string) => {
    const value = params.get(name)?.trim()
    return value ? value : null
  }
  return { operation: read('operation'), group: read('group'), q: read('q') }
}

/** Writes a route into a query string, keeping unrelated parameters such as `lang`. */
export const routeSearch = (route: SpecRoute, base: string | URLSearchParams = ''): string => {
  const params = new URLSearchParams(base)
  for (const key of ['operation', 'group', 'q'] as const) {
    params.delete(key)
    const value = route[key]
    if (value) params.set(key, value)
  }
  const text = params.toString()
  return text ? `?${text}` : '?'
}

const METHOD_TONE: Record<HttpMethod, Tone> = {
  get: 'info',
  head: 'info',
  options: 'neutral',
  trace: 'neutral',
  post: 'positive',
  put: 'warning',
  patch: 'warning',
  delete: 'danger',
}

const methodKey = (method: HttpMethod): MessageKey => `spec.method.${method}`

export const MethodBadge = (props: { method: HttpMethod; t: Translate; size?: 'small' | 'default' }) => (
  <Badge
    label={props.t(methodKey(props.method))}
    tone={METHOD_TONE[props.method]}
    size={props.size ?? 'default'}
  />
)

const statusTone = (status: string | number): Tone => {
  const first = String(status)[0]
  if (first === '2') return 'positive'
  if (first === '3') return 'info'
  if (first === '4') return 'warning'
  if (first === '5') return 'danger'
  return 'neutral'
}

const operationTitle = (operation: SpecOperation): string =>
  operation.summary ?? operation.operationId ?? `${operation.method.toUpperCase()} ${operation.path}`

const domId = (value: string): string => value.replace(/[^A-Za-z0-9_-]/g, '_')

/** Bytes in the reader's locale, e.g. `1.2 kB`. */
const bytes = (count: number, locale: string): string => {
  const format = (value: number, unit: string) =>
    `${new Intl.NumberFormat(locale, { maximumFractionDigits: 1 }).format(value)} ${unit}`
  if (count < 1000) return format(count, 'B')
  if (count < 1_000_000) return format(count / 1000, 'kB')
  return format(count / 1_000_000, 'MB')
}

const ready = (state: SpecState): SpecModel | null =>
  state.kind === 'ready' && state.result.ok ? state.result.model : null

// ---------------------------------------------------------------------------
// Shell regions

export const SpecTopbar = (
  props: Pick<SpecViewProps, 'state' | 't' | 'href'> & { query: string | null; signedIn: boolean },
) => {
  const model = ready(props.state)
  return (
    <AppTopbar
      tools={
        model && typedSchemes(model).length > 0 ? (
          <Button
            id={SIGN_IN_ID}
            label={props.signedIn ? props.t('spec.signIn.signedIn') : props.t('spec.signIn.open')}
            variant={props.signedIn ? 'secondary' : 'primary'}
            controls={SIGN_IN_DIALOG_ID}
          />
        ) : undefined
      }
      navigation={
        <NavigationToggle controls={`${NAVIGATION_ID}-drawer`} label={props.t('spec.navigation.open')} />
      }
      location={
        model ? (
          <Inline
            blockAlign="center"
            items={[
              <Text as="span" fontWeight="semibold" truncate>
                {model.title}
              </Text>,
              ...(model.version ? [<Badge label={model.version} size="small" />] : []),
            ]}
          />
        ) : (
          <Text as="span" fontWeight="semibold">
            {props.t('spec.brand')}
          </Text>
        )
      }
      search={{
        id: 'spec-search',
        action: props.href(emptyRoute).split('?')[0] || './',
        label: props.t('spec.search.label'),
        triggerLabel: props.t('spec.search.trigger'),
        closeLabel: props.t('spec.search.close'),
        placeholder: props.t('spec.search.placeholder'),
        submitLabel: props.t('spec.search.submit'),
        query: props.query ?? '',
        locale: props.t.locale,
      }}
    />
  )
}

const operationItem = (operation: SpecOperation, props: SpecViewProps): NavigationItemData => ({
  id: domId(operation.id),
  // The path is the short, stable name a reader scans for; summaries are often sentences.
  // The leading slot is icon-sized, so the method is the description rather than a badge.
  label: operation.path,
  description: operation.deprecated
    ? `${operation.method.toUpperCase()} · ${props.t('spec.operation.deprecated')}`
    : operation.method.toUpperCase(),
  href: props.href({ ...emptyRoute, operation: operation.id }),
  active: props.route.operation === operation.id,
})

export const SpecNavigation = (props: SpecViewProps): TemplateResult => {
  const model = ready(props.state)
  const overview: NavigationItemData = {
    id: 'overview',
    label: props.t('spec.navigation.overview'),
    // Shares the leading column with the groups' carets, so every top-level label aligns.
    leading: <Icon name="info" size="small" />,
    href: props.href(emptyRoute),
    active: model !== null && !props.route.operation && !props.route.group && !props.route.q,
  }
  return (
    <AppNavigation
      id={NAVIGATION_ID}
      label={props.t('spec.navigation.label')}
      menuLabel={props.t('spec.navigation.open')}
      closeLabel={props.t('spec.navigation.close')}
      externalTrigger
      identity={
        <AppBrand
          label={props.t('spec.brand')}
          href={props.brand.href}
          image={props.brand.image}
          darkImage={props.brand.darkImage}
        />
      }
      groups={[
        { id: 'start', items: [overview] },
        ...(model && model.groups.length > 0
          ? [
              {
                id: 'operations',
                label: props.t('spec.navigation.operations'),
                exclusive: false,
                caret: true,
                items: model.groups.map((group) => ({
                  id: `group-${group.id}`,
                  label: group.label,
                  count: group.operations.length,
                  children: group.operations.map((operation) => operationItem(operation, props)),
                })),
              },
            ]
          : []),
      ]}
    />
  )
}

export const SpecMain = (props: SpecViewProps): TemplateResult => {
  const { state, t } = props
  if (state.kind === 'loading')
    return (
      <WorkspacePage title={t('spec.loading')} body={<LoadingState label={t('spec.loading')} lines={6} />} />
    )
  if (state.kind === 'failed') return <LoadFailurePage failure={state.failure} t={t} />
  if (!state.result.ok) return <ProblemPage problem={state.result.problem} t={t} />
  const model = state.result.model
  const { route } = props
  if (route.operation) {
    const operation = findOperation(model, route.operation)
    return operation ? (
      <OperationPage {...props} model={model} operation={operation} />
    ) : (
      <NotFoundPage {...props} id={route.operation} />
    )
  }
  if (route.group) {
    const group = model.groups.find((candidate) => candidate.id === route.group)
    if (group)
      return (
        <WorkspacePage
          eyebrow={t('spec.group.eyebrow')}
          title={group.label}
          meta={<Text tone="muted">{t('spec.group.operations', { count: group.operations.length })}</Text>}
          body={<OperationTable {...props} operations={group.operations} />}
        />
      )
    return <NotFoundPage {...props} id={route.group} />
  }
  if (route.q) return <SearchPage {...props} model={model} query={route.q} />
  return <OverviewPage {...props} model={model} />
}

/**
 * Where credentials are entered once for every operation. Values stay in the runtime's
 * memory; the dialog only shows them, masked, so a reader can replace or clear them.
 */
export const SignInDialog = (props: {
  model: SpecModel
  t: Translate
  credentials: Readonly<Record<string, string>>
}): TemplateResult => {
  const { t } = props
  return (
    <ModalSheet
      id={SIGN_IN_DIALOG_ID}
      mode="client"
      presentation="dialog"
      size="small"
      title={t('spec.signIn.title')}
      description={t('spec.signIn.description')}
      closeLabel={t('spec.signIn.close')}
      body={
        <form id={SIGN_IN_FORM_ID} method="get" action="#" novalidate>
          <Stack
            items={typedSchemes(props.model).map((scheme) => {
              const name = schemeField(scheme)
              const key: MessageKey =
                scheme.type === 'http'
                  ? scheme.scheme === 'basic'
                    ? 'spec.try.basic'
                    : 'spec.try.bearer'
                  : 'spec.try.apiKey'
              return (
                <TextField
                  id={`${SIGN_IN_FORM_ID}-${domId(scheme.id)}`}
                  name={name}
                  label={t(key, { scheme: scheme.id })}
                  type="password"
                  autocomplete="off"
                  value={props.credentials[name] ?? ''}
                  help={t('spec.signIn.help', { where: schemeLocation(scheme, t) })}
                />
              )
            })}
          />
        </form>
      }
      actions={
        <ActionGroup
          actions={[
            <Button label={t('spec.signIn.save')} variant="primary" type="submit" form={SIGN_IN_FORM_ID} />,
            ...(isSignedIn(props.credentials)
              ? [<Button id={SIGN_OUT_ID} label={t('spec.signIn.signOut')} tone="danger" />]
              : []),
            <Button id={SIGN_IN_CANCEL_ID} label={t('spec.signIn.cancel')} />,
          ]}
        />
      }
    />
  )
}

/** The dialog region: empty until the runtime opens Sign in. */
export const SpecDialogs = (props: {
  signInOpen: boolean
  model: SpecModel | null
  t: Translate
  credentials: Readonly<Record<string, string>>
}): TemplateResult => (
  <>
    {props.signInOpen && props.model
      ? SignInDialog({ model: props.model, t: props.t, credentials: props.credentials })
      : null}
  </>
)

/** The complete application. The runtime mounts the regions separately. */
export const SpecApp = (props: SpecViewProps): TemplateResult => (
  <>
    {/* First in the root, so the dialog runtime finds it and makes the shell beside it inert. */}
    <div data-spec-region="dialog" />
    {SpecShell(props)}
  </>
)

const SpecShell = (props: SpecViewProps): TemplateResult => (
  <AppShell
    location={
      <div data-spec-region="topbar">
        <SpecTopbar
          state={props.state}
          t={props.t}
          href={props.href}
          query={props.route.q}
          signedIn={false}
        />
      </div>
    }
    sidebar={
      <div data-spec-region="navigation">
        <SpecNavigation {...props} />
      </div>
    }
    main={
      <div data-spec-region="main">
        <SpecMain {...props} />
      </div>
    }
  />
)

// ---------------------------------------------------------------------------
// Pages

const LoadFailurePage = (props: { failure: LoadFailure; t: Translate }) => {
  const { t, failure } = props
  const message =
    failure.reason === 'fetch'
      ? t('spec.problem.fetch', { status: String(failure.status) })
      : failure.reason === 'json'
        ? t('spec.problem.json')
        : t('spec.problem.network')
  return (
    <WorkspacePage
      title={t('spec.problem.title')}
      body={
        <Notice
          tone="danger"
          title={t('spec.problem.title')}
          message={message}
          actions={<Button label={t('spec.problem.retry')} variant="primary" id="spec-retry" />}
        />
      }
    />
  )
}

const ProblemPage = (props: { problem: SpecProblem; t: Translate }) => (
  <WorkspacePage
    title={props.t('spec.problem.title')}
    body={<Notice tone="danger" title={props.t('spec.problem.title')} message={props.problem.detail} />}
  />
)

const NotFoundPage = (props: SpecViewProps & { id: string }) => (
  <WorkspacePage
    title={props.t('spec.operation.notFoundTitle')}
    body={
      <Surface
        body={
          <EmptyState
            icon="search"
            title={props.t('spec.operation.notFoundTitle')}
            message={props.t('spec.operation.notFoundMessage', { id: props.id })}
            actions={
              <LinkButton label={props.t('spec.operation.backToOverview')} href={props.href(emptyRoute)} />
            }
          />
        }
      />
    }
  />
)

/** A component that may render nothing, as the items of a Stack. */
const optional = (child: JSXChild | null): JSXChild[] => (child === null ? [] : [child])

const IssuesNotice = (props: { model: SpecModel; t: Translate }) =>
  props.model.issues.length === 0 ? null : (
    <Stack
      gap="compact"
      items={[
        <Notice
          tone="warning"
          announcement="off"
          title={props.t('spec.issues.title')}
          message={props.t('spec.issues.message', { count: props.model.issues.length })}
        />,
        <Disclosure
          summary={props.t('spec.issues.details')}
          body={
            <Stack
              gap="tight"
              items={props.model.issues.map((issue) => (
                <Inline
                  wrap
                  items={[<Code value={issue.pointer} />, <Text tone="muted">{issue.detail}</Text>]}
                />
              ))}
            />
          }
        />,
      ]}
    />
  )

const schemeLocation = (scheme: SecurityScheme, t: Translate): string => {
  if (scheme.type === 'http' && scheme.scheme === 'bearer') return t('spec.auth.bearer')
  if (scheme.type === 'http' && scheme.scheme === 'basic') return t('spec.auth.basic')
  if (scheme.type === 'apiKey' && scheme.in && scheme.name)
    return t(`spec.auth.${scheme.in}` as MessageKey, { name: scheme.name })
  return scheme.scheme ?? scheme.type
}

const OverviewPage = (props: SpecViewProps & { model: SpecModel }) => {
  const { model, t } = props
  return (
    <WorkspacePage
      eyebrow={t('spec.overview.eyebrow', { version: model.openapi })}
      title={model.title}
      body={
        <Stack
          items={[
            ...optional(IssuesNotice({ model, t })),
            <Surface
              title={t('spec.overview.about')}
              body={
                <Stack
                  items={[
                    ...(model.description ? [<Paragraphs text={model.description} />] : []),
                    <DescriptionList
                      label={t('spec.overview.facts')}
                      columns={3}
                      items={[
                        { id: 'version', label: t('spec.overview.version'), value: model.version || '—' },
                        {
                          id: 'operations',
                          label: t('spec.overview.operations'),
                          value: new Intl.NumberFormat(t.locale).format(model.operations.length),
                        },
                        {
                          id: 'servers',
                          label: t('spec.overview.servers'),
                          value:
                            model.servers.length === 0 ? (
                              <Text tone="muted">{t('spec.overview.noServers')}</Text>
                            ) : (
                              <Stack
                                gap="tight"
                                items={model.servers.map((server) => <Code value={server.url} />)}
                              />
                            ),
                        },
                      ]}
                    />,
                  ]}
                />
              }
            />,
            model.securitySchemes.length === 0 ? (
              <Surface title={t('spec.auth.title')} body={<Text tone="muted">{t('spec.auth.none')}</Text>} />
            ) : (
              <DataTable
                title={t('spec.auth.title')}
                description={
                  model.securitySchemes.length > 1
                    ? t(schemesAreAlternatives(model) ? 'spec.auth.anyOne' : 'spec.auth.perOperation')
                    : null
                }
                gutter="compact"
                responsive="stack"
                rows={model.securitySchemes}
                id={(scheme) => scheme.id}
                columns={[
                  {
                    key: 'scheme',
                    label: t('spec.auth.scheme'),
                    kind: 'identifier',
                    priority: 'primary',
                    cell: (s) => <Code value={s.id} />,
                  },
                  { key: 'type', label: t('spec.auth.type'), cell: (s) => s.type },
                  {
                    key: 'where',
                    label: t('spec.auth.where'),
                    cell: (s) => <Code value={schemeLocation(s, t)} />,
                  },
                ]}
              />
            ),
            model.groups.length === 0 ? (
              <Surface
                title={t('spec.overview.groups')}
                body={
                  <EmptyState
                    title={t('spec.overview.emptyTitle')}
                    message={t('spec.overview.emptyMessage')}
                  />
                }
              />
            ) : (
              <DataTable
                title={t('spec.overview.groups')}
                gutter="compact"
                responsive="stack"
                rows={model.groups}
                id={(group) => group.id}
                rowHref={(group) => props.href({ ...emptyRoute, group: group.id })}
                columns={[
                  {
                    key: 'group',
                    label: t('spec.overview.group'),
                    priority: 'primary',
                    cell: (group) => group.label,
                  },
                  {
                    key: 'methods',
                    label: t('spec.overview.methods'),
                    cell: (group) => (
                      <Inline
                        gap="tight"
                        items={[...new Set(group.operations.map((operation) => operation.method))].map(
                          (method) => <MethodBadge method={method} t={t} size="small" />,
                        )}
                      />
                    ),
                  },
                  {
                    key: 'count',
                    label: t('spec.overview.count'),
                    kind: 'number',
                    align: 'end',
                    cell: (group) => new Intl.NumberFormat(t.locale).format(group.operations.length),
                  },
                ]}
              />
            ),
          ]}
        />
      }
    />
  )
}

/** Description text from the document is shown as plain paragraphs, never as markup. */
const Paragraphs = (props: { text: string }) => (
  <Stack
    gap="compact"
    items={props.text
      .split(/\n\s*\n/)
      .map((paragraph) => paragraph.trim())
      .filter(Boolean)
      .map((paragraph) => (
        <Text as="p" breakWord>
          {paragraph}
        </Text>
      ))}
  />
)

const OperationTable = (props: SpecViewProps & { operations: readonly SpecOperation[] }) => (
  <DataTable
    title={props.t('spec.navigation.operations')}
    gutter="compact"
    responsive="stack"
    rows={props.operations}
    id={(operation) => operation.id}
    rowHref={(operation) => props.href({ ...emptyRoute, operation: operation.id })}
    columns={[
      {
        key: 'method',
        label: props.t('spec.operation.method'),
        width: 'narrow',
        cell: (operation) => <MethodBadge method={operation.method} t={props.t} size="small" />,
      },
      {
        key: 'path',
        label: props.t('spec.operation.path'),
        kind: 'identifier',
        priority: 'primary',
        cell: (operation) => <Code value={operation.path} />,
      },
      {
        key: 'summary',
        label: props.t('spec.operation.summary'),
        cell: (operation) => operationTitle(operation),
      },
      {
        key: 'group',
        label: props.t('spec.overview.group'),
        priority: 'secondary',
        cell: (operation) => operation.group,
      },
    ]}
  />
)

const SearchPage = (props: SpecViewProps & { model: SpecModel; query: string }) => {
  const { t, query, model } = props
  const matches = searchOperations(model, query)
  const shown = matches.slice(0, MAX_SEARCH_RESULTS)
  return (
    <WorkspacePage
      title={t('spec.search.title')}
      meta={
        <Text tone="muted" breakWord>
          {t('spec.search.count', { count: matches.length, total: model.operations.length, query })}
        </Text>
      }
      body={
        matches.length === 0 ? (
          <Surface
            body={
              <EmptyState
                icon="search"
                title={t('spec.search.emptyTitle')}
                message={t('spec.search.emptyMessage', { query })}
                actions={<LinkButton label={t('spec.search.clear')} href={props.href(emptyRoute)} />}
              />
            }
          />
        ) : (
          <Stack
            items={[
              ...(matches.length > shown.length
                ? [
                    <Notice
                      tone="info"
                      announcement="off"
                      title={t('spec.search.title')}
                      message={t('spec.search.capped', { shown: shown.length })}
                    />,
                  ]
                : []),
              <OperationTable {...props} operations={shown} />,
            ]}
          />
        )
      }
    />
  )
}

// ---------------------------------------------------------------------------
// Operation

const authSummary = (operation: SpecOperation, t: Translate): JSXChild => {
  if (operation.security === null) return <Text tone="muted">{t('spec.auth.unspecified')}</Text>
  if (isPublic(operation)) return <Badge label={t('spec.auth.public')} tone="positive" size="small" />
  // Requirements are alternatives (any one is accepted); the schemes inside one
  // requirement are all presented together.
  const joined = (parts: readonly JSXChild[][], word: string): JSXChild[] =>
    parts.flatMap((part, index) => (index === 0 ? part : [<Text tone="muted">{word}</Text>, ...part]))
  const requirements = operation.security.map((names) =>
    joined(
      names.map((name) => [<Code value={name} />]),
      t('spec.auth.and'),
    ),
  )
  return <Inline gap="tight" wrap blockAlign="baseline" items={joined(requirements, t('spec.auth.or'))} />
}

const extensionValue = (value: unknown): string => (typeof value === 'string' ? value : JSON.stringify(value))

const OperationPage = (props: SpecViewProps & { model: SpecModel; operation: SpecOperation }) => {
  const { operation, t } = props
  return (
    <WorkspacePage
      eyebrow={operation.group}
      title={operationTitle(operation)}
      status={
        <Inline
          gap="tight"
          blockAlign="center"
          wrap
          items={[
            <MethodBadge method={operation.method} t={t} />,
            <Code value={operation.path} />,
            ...(operation.deprecated
              ? [<Badge label={t('spec.operation.deprecated')} tone="warning" icon="triangle-alert" />]
              : []),
          ]}
        />
      }
      body={
        <Stack
          items={[
            <Surface
              body={
                <Stack
                  items={[
                    ...(operation.description ? [<Paragraphs text={operation.description} />] : []),
                    <DescriptionList
                      label={t('spec.operation.facts')}
                      columns={3}
                      items={[
                        {
                          id: 'operation-id',
                          label: t('spec.operation.id'),
                          value: operation.operationId ? <Code value={operation.operationId} /> : '—',
                        },
                        { id: 'auth', label: t('spec.operation.auth'), value: authSummary(operation, t) },
                        {
                          id: 'idempotency',
                          label: t('spec.operation.idempotency'),
                          value: operation.idempotent
                            ? t('spec.operation.idempotent')
                            : t('spec.operation.notIdempotent'),
                        },
                        ...(operation.capability
                          ? [
                              {
                                id: 'capability',
                                label: t('spec.operation.capability'),
                                value: (
                                  <>
                                    <Code value={operation.capability.key} />
                                    {operation.capability.action ? ` · ${operation.capability.action}` : null}
                                  </>
                                ),
                              },
                            ]
                          : []),
                        ...operation.extensions.map((extension) => ({
                          id: `extension-${extension.name}`,
                          label: extension.name,
                          value: <Code value={extensionValue(extension.value)} />,
                        })),
                      ]}
                    />,
                  ]}
                />
              }
            />,
            <RequestSurface {...props} />,
            <ResponsesSurface {...props} />,
            <TrySurface {...props} />,
          ]}
        />
      }
    />
  )
}

const LOCATION_ORDER: readonly ParameterLocation[] = ['path', 'query', 'header', 'cookie']

const ParameterTable = (props: {
  parameters: readonly SpecParameter[]
  document: JsonObject
  t: Translate
  label: string
}) => (
  <DataTable
    label={props.label}
    gutter="compact"
    responsive="stack"
    rows={props.parameters}
    id={(parameter) => `${parameter.in}:${parameter.name}`}
    columns={[
      {
        key: 'name',
        label: props.t('spec.parameter.name'),
        priority: 'primary',
        kind: 'identifier',
        cell: (parameter) => (
          <Inline
            gap="tight"
            wrap
            items={[
              <Code value={parameter.name} />,
              ...(parameter.required
                ? [<Badge label={props.t('spec.parameter.required')} size="small" />]
                : []),
              ...(parameter.deprecated
                ? [<Badge label={props.t('spec.schema.deprecated')} tone="warning" size="small" />]
                : []),
            ]}
          />
        ),
      },
      {
        key: 'type',
        label: props.t('spec.parameter.type'),
        cell: (parameter) => <Code value={typeLabel(props.document, parameter.schema ?? undefined)} />,
      },
      {
        key: 'details',
        label: props.t('spec.parameter.details'),
        cell: (parameter) => {
          const rows = parameter.schema ? schemaRows(props.document, parameter.schema).rows : []
          const constraints = rows[0]?.constraints ?? []
          return (
            <Stack
              gap="tight"
              items={[
                ...(parameter.description ? [<Text breakWord>{parameter.description}</Text>] : []),
                ...(constraints.length
                  ? [
                      <Text tone="muted" breakWord>
                        {constraints.join(' · ')}
                      </Text>,
                    ]
                  : []),
              ]}
            />
          )
        },
      },
    ]}
  />
)

const rowNote = (row: SchemaRow, t: Translate): string | null => {
  if (row.unresolved === 'circular') return t('spec.schema.circular')
  if (row.unresolved === 'external') return t('spec.schema.external')
  if (row.unresolved === 'depth') return t('spec.schema.depth')
  return null
}

export const SchemaView = (props: {
  document: JsonObject
  schema: JsonObject | null
  t: Translate
  label: string
}) => {
  const { t } = props
  const { rows, truncated } = schemaRows(props.document, props.schema, {
    item: t('spec.schema.item'),
    value: t('spec.schema.value'),
    additional: t('spec.schema.additional'),
    variant: (index) => t('spec.schema.variant', { index }),
  })
  if (rows.length === 0) return <Text tone="muted">{t('spec.schema.empty')}</Text>
  return (
    <Stack
      gap="compact"
      items={[
        ...(truncated
          ? [
              <Notice
                tone="info"
                announcement="off"
                title={props.label}
                message={t('spec.schema.truncated', { count: MAX_SCHEMA_ROWS })}
              />,
            ]
          : []),
        <TreeGrid
          label={t('spec.schema.label', { name: props.label })}
          primaryLabel={t('spec.schema.field')}
          rows={rows.map((row) => ({ row, level: row.level, hasChildren: row.hasChildren, expanded: true }))}
          id={(row) => row.id}
          primary={(row) => <Code value={row.name} />}
          columns={[
            {
              key: 'type',
              label: t('spec.schema.type'),
              cell: (row) => (
                <Inline
                  gap="tight"
                  wrap
                  items={[
                    <Text>{row.type}</Text>,
                    ...(row.required ? [<Badge label={t('spec.schema.required')} size="small" />] : []),
                    ...(row.nullable ? [<Badge label={t('spec.schema.nullable')} size="small" />] : []),
                    ...(row.readOnly
                      ? [<Badge label={t('spec.schema.readOnly')} size="small" tone="info" />]
                      : []),
                    ...(row.writeOnly
                      ? [<Badge label={t('spec.schema.writeOnly')} size="small" tone="info" />]
                      : []),
                    ...(row.deprecated
                      ? [<Badge label={t('spec.schema.deprecated')} size="small" tone="warning" />]
                      : []),
                  ]}
                />
              ),
            },
            {
              key: 'details',
              label: t('spec.schema.details'),
              cell: (row) => {
                const note = rowNote(row, t)
                return (
                  <Stack
                    gap="tight"
                    items={[
                      ...(row.description ? [<Text breakWord>{row.description}</Text>] : []),
                      ...(row.constraints.length
                        ? [
                            <Text tone="muted" breakWord>
                              {row.constraints.join(' · ')}
                            </Text>,
                          ]
                        : []),
                      ...(note ? [<Text tone="muted">{note}</Text>] : []),
                    ]}
                  />
                )
              },
            },
          ]}
        />,
      ]}
    />
  )
}

const RequestSurface = (props: SpecViewProps & { model: SpecModel; operation: SpecOperation }) => {
  const { operation, t, model } = props
  const sections = LOCATION_ORDER.flatMap((location) => {
    const parameters = operation.parameters.filter((parameter) => parameter.in === location)
    if (parameters.length === 0) return []
    const title = t(`spec.request.${location}` as MessageKey)
    return [
      <Section
        title={title}
        body={<ParameterTable parameters={parameters} document={model.document} t={t} label={title} />}
      />,
    ]
  })
  const body = operation.requestBody
  if (body)
    sections.push(
      <Section
        title={body.required ? t('spec.request.bodyRequired') : t('spec.request.body')}
        actions={<Code value={body.mediaType} />}
        body={
          <SchemaView document={model.document} schema={body.schema} t={t} label={t('spec.request.body')} />
        }
      />,
    )
  return (
    <Surface
      title={t('spec.request.title')}
      body={
        sections.length === 0 ? (
          <Text tone="muted">{t('spec.request.none')}</Text>
        ) : (
          <Stack divided items={sections} />
        )
      }
    />
  )
}

const ResponseBody = (props: { response: SpecResponse; model: SpecModel; t: Translate }) => {
  const { response, t } = props
  return (
    <Stack
      gap="compact"
      items={[
        ...(response.mediaType ? [<Code value={response.mediaType} />] : []),
        response.mediaType ? (
          <SchemaView
            document={props.model.document}
            schema={response.schema}
            t={t}
            label={response.status}
          />
        ) : (
          <Text tone="muted">{t('spec.responses.noBody')}</Text>
        ),
        ...(response.headers.length
          ? [
              <DataTable
                caption={t('spec.responses.headers')}
                gutter="compact"
                rows={response.headers}
                id={(header) => header.name}
                columns={[
                  {
                    key: 'name',
                    label: t('spec.parameter.name'),
                    kind: 'identifier',
                    cell: (h) => <Code value={h.name} />,
                  },
                  {
                    key: 'type',
                    label: t('spec.parameter.type'),
                    cell: (h) => <Code value={typeLabel(props.model.document, h.schema ?? undefined)} />,
                  },
                  { key: 'details', label: t('spec.parameter.details'), cell: (h) => h.description ?? '' },
                ]}
              />,
            ]
          : []),
      ]}
    />
  )
}

const ResponsesSurface = (props: SpecViewProps & { model: SpecModel; operation: SpecOperation }) => {
  const { operation, t } = props
  const firstSuccess = operation.responses.find((response) => response.status.startsWith('2'))?.status
  return (
    <Surface
      title={t('spec.responses.title')}
      body={
        operation.responses.length === 0 ? (
          <Text tone="muted">{t('spec.responses.none')}</Text>
        ) : (
          <Stack
            divided
            items={operation.responses.map((response) => (
              <Disclosure
                summary={response.description || response.status}
                meta={<Badge label={response.status} tone={statusTone(response.status)} size="small" />}
                open={response.status === firstSuccess}
                body={<ResponseBody response={response} model={props.model} t={t} />}
              />
            ))}
          />
        )
      }
    />
  )
}

// ---------------------------------------------------------------------------
// Try it

const problemText = (problem: FieldProblem | undefined, t: Translate): string | null =>
  problem ? t(`spec.try.problem.${problem}` as MessageKey) : null

export const fieldId = (operation: SpecOperation, name: string): string =>
  `try-${domId(operation.id)}-${domId(name)}`

const TryFields = (
  props: Omit<SpecViewProps, 'state'> & { model: SpecModel; operation: SpecOperation; state: TryState },
) => {
  const { operation, t, model } = props
  const values = props.state.values
  const problems = props.state.problems
  const value = (name: string) => values[name] ?? ''
  const fields: JSXChild[] = []

  if (model.servers.length > 1)
    fields.push(
      <Select
        id={fieldId(operation, fieldName.server)}
        name={fieldName.server}
        label={t('spec.try.server')}
        value={value(fieldName.server) || model.servers[0]?.url}
        options={model.servers.map((server) => ({
          value: server.url,
          label: server.description ?? server.url,
        }))}
        error={problemText(problems[fieldName.server], t)}
      />,
    )
  else
    fields.push(
      <TextField
        id={fieldId(operation, fieldName.server)}
        name={fieldName.server}
        label={t('spec.try.server')}
        type="url"
        value={value(fieldName.server) || model.servers[0]?.url || ''}
        placeholder={model.servers[0]?.url ?? '/'}
        error={problemText(problems[fieldName.server], t)}
      />,
    )

  const options = credentialOptions(model, operation)
  if (isPublic(operation)) fields.push(<Text tone="muted">{t('spec.try.credentialPublic')}</Text>)
  else if (options.length > 0) {
    const chosen = options.find((option) => option.id === value(fieldName.credential)) ?? options[0]
    if (options.length > 1)
      fields.push(
        <Select
          id={fieldId(operation, fieldName.credential)}
          name={fieldName.credential}
          label={t('spec.try.credential')}
          value={chosen?.id ?? ''}
          options={options.map((option) => ({ value: option.id, label: option.id.replaceAll('+', ' + ') }))}
        />,
      )
    for (const scheme of chosen?.schemes ?? []) {
      if (!schemeTakesValue(scheme)) {
        if (scheme.type === 'apiKey' && scheme.in === 'cookie')
          fields.push(
            <Text tone="muted">{t('spec.try.cookie', { scheme: scheme.id, name: scheme.name ?? '' })}</Text>,
          )
        continue
      }
      const name = schemeField(scheme)
      const key: MessageKey =
        scheme.type === 'http'
          ? scheme.scheme === 'basic'
            ? 'spec.try.basic'
            : 'spec.try.bearer'
          : 'spec.try.apiKey'
      // Credentials are entered once, under Sign in; the form shows which one it will send.
      fields.push(
        <TextField
          id={fieldId(operation, name)}
          name={name}
          label={t(key, { scheme: scheme.id })}
          type="password"
          autocomplete="off"
          required
          readOnly
          value={value(name)}
          help={value(name) ? t('spec.try.signedInHelp') : null}
          error={problems[name] ? t('spec.try.signInRequired') : null}
        />,
      )
    }
  }

  for (const location of LOCATION_ORDER) {
    if (location === 'cookie') continue
    for (const parameter of tryParameters(operation).filter((candidate) => candidate.in === location)) {
      const name = fieldName.parameter(parameter)
      const id = fieldId(operation, name)
      if (isIdempotencyHeader(parameter)) {
        // Its "Generate key" command sits with the form's other commands, under the controls.
        fields.push(
          <TextField
            id={id}
            name={name}
            label={t('spec.try.idempotency')}
            required={parameter.required}
            value={value(name)}
            maxLength={255}
            help={t('spec.try.idempotencyHelp')}
            error={problemText(problems[name], t)}
          />,
        )
        continue
      }
      const rows = parameter.schema ? schemaRows(model.document, parameter.schema).rows : []
      const hint = [
        typeLabel(model.document, parameter.schema ?? undefined),
        ...(rows[0]?.constraints ?? []),
      ].join(' · ')
      fields.push(
        <TextField
          id={id}
          name={name}
          label={`${parameter.name} (${location})`}
          required={parameter.required}
          value={value(name)}
          help={parameter.description ? `${parameter.description} — ${hint}` : hint}
          error={problemText(problems[name], t)}
        />,
      )
    }
  }

  if (operation.requestBody)
    fields.push(
      <TextArea
        id={fieldId(operation, fieldName.body)}
        name={fieldName.body}
        label={t('spec.try.body', { mediaType: operation.requestBody.mediaType })}
        required={operation.requestBody.required}
        rows={12}
        value={value(fieldName.body)}
        help={t('spec.try.bodyHelp')}
        error={problemText(problems[fieldName.body], t)}
      />,
    )
  return fields
}

const ResponseView = (props: { response: ReadResponse; t: Translate }) => {
  const { response, t } = props
  const envelope = response.envelope
  return (
    <Section
      title={t('spec.try.response')}
      actions={
        <Inline
          gap="tight"
          blockAlign="center"
          items={[
            <Badge
              label={`${response.status} ${response.statusText}`.trim()}
              tone={statusTone(response.status)}
            />,
            <Text tone="muted" numeric>
              {t('spec.try.duration', { ms: response.durationMs })}
            </Text>,
            <Text tone="muted" numeric>
              {bytes(response.bytes, t.locale)}
            </Text>,
          ]}
        />
      }
      body={
        <Stack
          items={[
            ...(envelope
              ? [
                  <Notice
                    tone="danger"
                    announcement="off"
                    title={envelope.code ?? String(response.status)}
                    message={envelope.message ?? response.statusText}
                  />,
                  ...(envelope.fields.length
                    ? [
                        <DataTable
                          caption={t('spec.try.errorFields')}
                          gutter="compact"
                          rows={envelope.fields}
                          id={(field) => field.field || '(request)'}
                          columns={[
                            {
                              key: 'field',
                              label: t('spec.try.errorField'),
                              kind: 'identifier',
                              cell: (field) => <Code value={field.field || t('spec.try.requestField')} />,
                            },
                            {
                              key: 'issue',
                              label: t('spec.try.errorIssue'),
                              cell: (field) => field.codes.join(', '),
                            },
                          ]}
                        />,
                      ]
                    : []),
                ]
              : []),
            <DescriptionList
              columns={2}
              items={[
                {
                  id: 'request-id',
                  label: t('spec.try.requestId'),
                  value: response.requestId ? <Code value={response.requestId} /> : '—',
                },
                { id: 'content-type', label: t('spec.try.contentType'), value: response.contentType ?? '—' },
              ]}
            />,
            response.body === '' ? (
              <Text tone="muted">{t('spec.try.emptyBody')}</Text>
            ) : (
              <Stack
                gap="tight"
                items={[
                  <CodeBlock
                    label={t('spec.try.responseBody')}
                    language={response.json ? 'json' : null}
                    value={response.body}
                  />,
                  ...(response.truncated
                    ? [<Text tone="muted">{t('spec.try.truncated', { count: MAX_BODY_CHARS })}</Text>]
                    : []),
                ]}
              />
            ),
            <Disclosure
              summary={t('spec.try.responseHeaders')}
              meta={
                <Text tone="muted" numeric>
                  {String(response.headers.length)}
                </Text>
              }
              body={
                <DataTable
                  label={t('spec.try.responseHeaders')}
                  gutter="compact"
                  rows={response.headers}
                  id={([name]) => name}
                  columns={[
                    {
                      key: 'name',
                      label: t('spec.try.header'),
                      kind: 'identifier',
                      cell: ([name]) => <Code value={name} />,
                    },
                    {
                      key: 'value',
                      label: t('spec.try.value'),
                      cell: ([, value]) => <Text breakWord>{value}</Text>,
                    },
                  ]}
                />
              }
            />,
          ]}
        />
      }
    />
  )
}

const TryOutcome = (props: { state: TryState; t: Translate; timeoutSeconds: number }) => {
  const { state, t } = props
  switch (state.phase) {
    case 'invalid':
      return <Notice tone="danger" title={t('spec.try.title')} message={t('spec.try.invalid')} />
    case 'sending':
      return <LoadingState label={t('spec.try.sending')} lines={3} />
    case 'offline':
      return <Notice tone="warning" title={t('spec.try.offlineTitle')} message={t('spec.try.offline')} />
    case 'network':
      return <Notice tone="danger" title={t('spec.try.networkTitle')} message={t('spec.try.network')} />
    case 'timeout':
      return (
        <Notice
          tone="danger"
          title={t('spec.try.timeoutTitle')}
          message={t('spec.try.timeout', { seconds: props.timeoutSeconds })}
        />
      )
    case 'cancelled':
      return <Notice tone="warning" title={t('spec.try.cancelledTitle')} message={t('spec.try.cancelled')} />
    case 'done':
      return state.response ? <ResponseView response={state.response} t={t} /> : null
    default:
      return null
  }
}

const TrySurface = (props: SpecViewProps & { model: SpecModel; operation: SpecOperation }) => {
  const { operation, t } = props
  const state = props.tryState(operation)
  const sending = state.phase === 'sending'
  const keyParameter = tryParameters(operation).find(isIdempotencyHeader)
  const options = credentialOptions(props.model, operation)
  const chosen = options.find((option) => option.id === state.values[fieldName.credential]) ?? options[0]
  const typed = isPublic(operation) ? [] : (chosen?.schemes.filter(schemeTakesValue) ?? [])
  const entered = typed.length > 0 && typed.every((scheme) => !!state.values[schemeField(scheme)])
  return (
    <Surface
      title={t('spec.try.title')}
      body={
        <form
          id={TRY_FORM_ID}
          data-spec-try={operation.id}
          method="get"
          action="#"
          novalidate
          aria-busy={sending ? 'true' : null}
        >
          <Stack
            items={[
              ...(isMutating(operation.method)
                ? [
                    <Notice
                      tone="warning"
                      announcement="off"
                      title={t('spec.try.mutatingTitle')}
                      message={t('spec.try.mutating')}
                    />,
                  ]
                : []),
              <Stack items={TryFields({ ...props, state }) as JSXChild[]} />,
              <ActionGroup
                actions={[
                  <Button label={t('spec.try.send')} variant="primary" type="submit" loading={sending} />,
                  ...(sending ? [<Button id={TRY_CANCEL_ID} label={t('spec.try.cancel')} />] : []),
                  ...(typed.length > 0
                    ? [
                        <Button
                          id={TRY_SIGN_IN_ID}
                          label={entered ? t('spec.try.changeCredentials') : t('spec.try.signIn')}
                          controls={SIGN_IN_DIALOG_ID}
                          disabled={sending}
                        />,
                      ]
                    : []),
                  ...(operation.requestBody
                    ? [<Button id={TRY_RESET_ID} label={t('spec.try.resetBody')} disabled={sending} />]
                    : []),
                  ...(keyParameter
                    ? [
                        <Button
                          id={`${fieldId(operation, fieldName.parameter(keyParameter))}${GENERATE_SUFFIX}`}
                          label={t('spec.try.generate')}
                          disabled={sending}
                        />,
                      ]
                    : []),
                ]}
              />,
              ...(state.preview
                ? [
                    <Disclosure
                      summary={t('spec.try.curl')}
                      body={
                        <CodeBlock
                          label={t('spec.try.curlLabel')}
                          language="shell"
                          wrap
                          value={state.preview}
                        />
                      }
                    />,
                  ]
                : []),
              <div data-spec-outcome aria-live="polite">
                {TryOutcome({ state, t, timeoutSeconds: props.timeoutSeconds })}
              </div>,
            ]}
          />
        </form>
      }
    />
  )
}
