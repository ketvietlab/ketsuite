import { text } from '@ketvietlab/ketjs'
import type { Route, ServeContext } from '@ketvietlab/ketjs'
import type { JSXChild } from '@ketvietlab/ketjs-view'
import { defineIsland, renderIsland, html, trustedMarkup } from '@ketvietlab/ketjs-view'
import { Field, Inline, LinkButton, ListPage, Text } from '@ketvietlab/design-system'
import { pageTrailFromFrame, shell } from '../../../ui/index.ts'
import { createSaleCatalogueView, SaleCatalogueFilters } from '../../../ui/client/sale-catalogue-view.tsx'
import type { SaleCatalogueData, SaleCatalogueProps } from '../../../ui/client/sale-catalogue-view.tsx'
import { adminPage } from '../../backend/screen.ts'
import { relationControl, relationLabels } from '../../backend/relation-select.ts'
import { HELP } from '../../product_backend/screens/help-words.ts'
import { catalogueMessages } from '../catalogue-messages.ts'
import { SaleCatalogueHelp } from './catalogue-help.tsx'
import { salesOrderPath } from '../order-path.ts'

export const saleCatalogueIsland = defineIsland<SaleCatalogueProps>()({
  props: {
    id: 'id',
    data: 'json',
    editable: 'bool',
    filters: 'json',
    labels: 'json',
    lang: 'text',
    href: 'text',
  },
  key: ['id'],
  client: 'sale-catalogue.mjs',
  export: 'saleCatalogue',
  view: createSaleCatalogueView,
})
export const renderSaleCatalogue =
  (ctx: ServeContext): Route =>
  async (url, req, params) => {
    if (req.method !== 'GET') return text('GET', { status: 405 })
    if (!(await ctx.allows('sale.getCatalogue', url, req))) return text('Forbidden', { status: 403 })
    const filters = {
      search: url.searchParams.get('search') || undefined,
      categoryId: url.searchParams.get('categoryId') || undefined,
      valueIds: url.searchParams.getAll('valueIds').filter(Boolean),
      page: Math.max(1, Number(url.searchParams.get('page')) || 1),
    }
    const data = (await ctx.call(
      'sale.getCatalogue',
      { id: params.id, ...filters },
      url,
      req,
    )) as SaleCatalogueData | null
    if (!data) return text('Not found', { status: 404 })
    if (!data.ok) return text('Invalid filters', { status: 422 })
    const lang = ctx.localeOf(url, req) === 'en' ? 'en' : 'vi',
      labels = catalogueMessages[lang],
      translate = ctx.translate(lang)
    const hidden = Object.fromEntries(
      ['lang', 'company', 'branch']
        .filter((key) => url.searchParams.has(key))
        .map((key) => [key, url.searchParams.get(key)!]),
    )
    const facets: JSXChild[] = []
    const categoryId = 'catalogue-category'
    facets.push(
      <Field
        name="categoryId"
        id={categoryId}
        label={labels.category}
        control={
          await relationControl(ctx, url, req, categoryId, {
            name: 'categoryId',
            triggerId: categoryId,
            ariaLabel: labels.category,
            value: filters.categoryId ?? '',
            labels: relationLabels(translate, labels.category),
            options: [
              { value: '', label: labels.all },
              ...data.categories.map((row) => ({
                value: String(row.id),
                label: String(row.name) + ' (' + String(row.count) + ')',
              })),
            ],
          })
        }
      />,
    )
    for (const attribute of data.attributes) {
      const id = 'catalogue-attribute-' + String(attribute.id)
      const values = attribute.values as Record<string, unknown>[]
      facets.push(
        <Field
          name="valueIds"
          id={id}
          label={String(attribute.name)}
          control={
            await relationControl(ctx, url, req, id, {
              name: 'valueIds',
              triggerId: id,
              ariaLabel: String(attribute.name),
              value: filters.valueIds.find((value) => values.some((row) => row.id === value)) ?? '',
              labels: relationLabels(translate, String(attribute.name)),
              options: [
                { value: '', label: labels.all },
                ...values.map((row) => ({
                  value: String(row.id),
                  label: String(row.name) + ' (' + String(row.count) + ')',
                })),
              ],
            })
          }
        />,
      )
    }
    const editable =
      (await ctx.allows('sale.setCatalogueQuantity', url, req)) &&
      !data.order.locked &&
      ['draft', 'sent', 'sale'].includes(String(data.order.state)) &&
      (!data.order.orderAuthority || data.order.orderAuthority === 'local')
    const back = new URL(url)
    back.pathname = salesOrderPath(data.order.state, params.id)
    back.search = new URLSearchParams(hidden).toString()
    const pageHref = (page: number) => {
      const target = new URL(url)
      target.searchParams.set('page', String(page))
      return target.pathname + target.search
    }
    const title = labels.title + ' · ' + String(data.order.name)
    return adminPage(ctx, url, req, {
      title: 'sale_backend.catalogue.title',
      active: ['draft', 'sent'].includes(String(data.order.state))
        ? '/admin/sales/quotations'
        : '/admin/sales/orders',
      body: (_, frame) =>
        shell(
          _,
          title,
          <>
            <ListPage
              variant="operational"
              context={pageTrailFromFrame(title, frame)}
              title={title}
              headerActions={<LinkButton label={labels.back} href={back.pathname + back.search} />}
              controls={
                <SaleCatalogueFilters
                  action={url.pathname}
                  hidden={hidden}
                  search={filters.search ?? ''}
                  labels={labels}
                  facets={facets}
                />
              }
              status={
                <Text variant="bodySm">
                  {data.total} {labels.results}
                </Text>
              }
              body={html`${trustedMarkup(renderIsland('sale.catalogue', (props) => saleCatalogueIsland.view!(props as unknown as SaleCatalogueProps), { id: params.id!, data, editable, filters, labels, lang, href: url.pathname + url.search }))}`}
              footer={
                <Inline
                  items={[
                    <Text variant="bodySm">
                      {data.total} {labels.results}
                    </Text>,
                    data.page > 1 ? (
                      <LinkButton label={labels.previous} href={pageHref(data.page - 1)} />
                    ) : null,
                    data.page * data.pageSize < data.total ? (
                      <LinkButton label={labels.next} href={pageHref(data.page + 1)} />
                    ) : null,
                  ]}
                />
              }
            />
            <SaleCatalogueHelp lang={lang} />
          </>,
          {
            ...frame,
            topbar: false,
            titled: false,
            ...(frame.applications
              ? { applications: { ...frame.applications, helpLabel: HELP[lang].trigger } }
              : {}),
          },
        ),
    })
  }
