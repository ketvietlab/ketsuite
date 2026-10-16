// A stale or mistyped Flow link lands on a page that says so and leads back to work,
// not on a raw JSON error. Atlas only: a deployment serves its own not-found page.
import { html, renderToStaticString } from '@ketvietlab/ketjs-view'
import { FlowEmpty } from '@ketvietlab/flow-ui'
import { setFlowLocale, tr } from '@ketvietlab/flow-client/i18n.mjs'

const LOCALES = ['en', 'vi', 'ja']

/**
 * @param {{ company?: string | null, lang?: string | null, head?: string }} p
 * @returns {string} a complete HTML document
 */
export function notFoundPage({ company, lang, head = '' }) {
  const locale = lang && LOCALES.includes(lang) ? lang : 'en'
  setFlowLocale(locale)
  const query = new URLSearchParams({ company: company || 'demo' })
  if (locale !== 'en') query.set('lang', locale)
  const body = renderToStaticString(
    html`<main data-flow-ui lang=${locale} style="min-height:100dvh;display:grid;place-items:center">
      ${FlowEmpty({
        titleLevel: 1,
        title: tr('flow.notFound.title'),
        description: tr('flow.notFound.help'),
        action: html`<a data-flow="button" data-variant="primary" data-size="md" href=${`/flow/my-work?${query}`}
          >${tr('flow.notFound.action')}</a
        >`,
      })}
    </main>`,
  )
  return `<!doctype html><html lang="${locale}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${tr('flow.notFound.title')} · Flow</title>${head}</head><body style="margin:0">${body}</body></html>`
}
