/**
 * Server rendering of a complete Spec page. The markup is the same view the
 * browser runtime renders, so a page is readable before (and without) the
 * script, and links work as ordinary navigation.
 */
import { escapeHtml, renderToStaticString } from '@ketvietlab/ketjs-view'
import { specTranslator } from './messages.ts'
import { findOperation, readSpec } from './model.ts'
import { initialValues } from './request.ts'
import { routeFrom, routeSearch, SpecApp, type SpecRoute, type SpecState, type TryState } from './views.tsx'

export type SpecAssets = {
  /** The browser runtime, `dist/browser/ketspec.mjs` of this package. */
  script: string
  /** `@ketvietlab/design-system/styles.css`. */
  designSystemStyles: string
  /** `@ketvietlab/ketspec/styles.css`: the document around the application. */
  styles: string
  logo: string
  logoDark: string
  favicon: string
}

export type SpecPageOptions = {
  /** The OpenAPI document. Without it the page loads `specUrl` in the browser. */
  document?: unknown
  specUrl?: string
  /** The address being rendered; its query selects the operation, group or search. */
  url?: string
  locale?: string
  assets: SpecAssets
  /** Forces a colour scheme; by default the reader's system setting applies. */
  theme?: 'light' | 'dark'
  /** Seconds before an unanswered try-it request is abandoned. Default 30. */
  timeoutSeconds?: number
}

/** JSON that is safe inside a `<script>` element: no `</script>`, no line separators. */
export const scriptJson = (value: unknown): string =>
  JSON.stringify(value)
    .replaceAll('<', '\\u003c')
    .replaceAll('>', '\\u003e')
    .replaceAll('&', '\\u0026')
    .replaceAll(' ', '\\u2028')
    .replaceAll(' ', '\\u2029')

export const renderSpecPage = (options: SpecPageOptions): string => {
  const t = specTranslator(options.locale)
  const timeoutSeconds = options.timeoutSeconds ?? 30
  if (!Number.isInteger(timeoutSeconds) || timeoutSeconds < 1)
    throw new RangeError('timeoutSeconds must be a positive whole number')
  const url = new URL(options.url ?? '/', 'http://spec.invalid')
  const route: SpecRoute = routeFrom(url.searchParams)
  // Without an address the page is a static file that may be hosted under any path, so
  // links carry only their query and resolve against wherever the page is served.
  const path = options.url === undefined ? '' : url.pathname
  const state: SpecState =
    options.document === undefined
      ? { kind: 'loading' }
      : { kind: 'ready', result: readSpec(options.document) }
  const model = state.kind === 'ready' && state.result.ok ? state.result.model : null
  const operation = model ? findOperation(model, route.operation) : null
  const tryState = (target: NonNullable<typeof operation>): TryState => ({
    // Deterministic: a required Idempotency-Key is generated in the browser, not here.
    values: model ? initialValues(model, target, () => '') : {},
    problems: {},
    phase: 'idle',
    response: null,
    preview: null,
  })
  const title = operation
    ? `${operation.summary ?? operation.operationId ?? operation.path} · ${model?.title} · ${t('spec.brand')}`
    : `${model?.title ?? t('spec.brand')} · ${t('spec.brand')}`
  const app = renderToStaticString(
    SpecApp({
      state,
      route,
      t,
      href: (target) => `${path}${routeSearch(target, url.searchParams)}`,
      brand: {
        href: `${path}${routeSearch({ operation: null, group: null, q: null }, url.searchParams)}`,
        image: options.assets.logo,
        darkImage: options.assets.logoDark,
      },
      tryState,
      timeoutSeconds,
    }),
  )
  const attribute = (name: string, value: string | undefined) =>
    value === undefined ? '' : ` ${name}="${escapeHtml(value)}"`
  return `<!doctype html>
<html lang="${t.locale}"${attribute('data-theme', options.theme)}>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="${options.theme ?? 'light dark'}">
<meta name="generator" content="Spec">
<title>${escapeHtml(title)}</title>
<link rel="icon" href="${escapeHtml(options.assets.favicon)}" type="image/svg+xml">
<link rel="stylesheet" href="${escapeHtml(options.assets.designSystemStyles)}">
<link rel="stylesheet" href="${escapeHtml(options.assets.styles)}">
</head>
<body>
<div id="spec" data-kv-design-system data-presentation="grouped" data-density="compact" data-ketspec${attribute('data-theme', options.theme)}${attribute('data-spec-url', options.document === undefined ? options.specUrl : undefined)}${attribute('data-brand-image', options.assets.logo)}${attribute('data-brand-dark-image', options.assets.logoDark)}${attribute('data-spec-timeout', options.timeoutSeconds === undefined ? undefined : String(timeoutSeconds))}>
${app}
</div>
${options.document === undefined ? '' : `<script type="application/json" id="spec-document">${scriptJson(options.document)}</script>\n`}<script type="module" src="${escapeHtml(options.assets.script)}"></script>
</body>
</html>
`
}
