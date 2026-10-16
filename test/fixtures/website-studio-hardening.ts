import assert from 'node:assert/strict'
import type { Row } from '@ketvietlab/ketjs'
import { coreRoutes, buildHref } from '../../packages/website-client/client/routes.ts'
import { bootWebsiteStudio } from './website-studio.ts'

/** Native commerce modules, real HTTP transport and isolated SQLite/storage test fixtures. */
export async function bootStudioHardening(port?: number) {
  const context = await bootWebsiteStudio(port, {
    deployment: 'commerce',
    studio: { defaultPreset: 'retail' },
  })
  const { app, fixture, revision } = context
  try {
    await fixture('user.applyRoleTemplate', {
      roleId: 'hardening-customers',
      templateKey: 'website.customers',
      expectedRoleRevision: 0,
      expectedAuthorizationRevision: await revision(),
      idempotencyKey: 'hardening-customers',
    })
    await fixture('user.saveRole', { id: 'hardening-products', name: 'Product configuration fixture' })
    for (const fnKey of [
      'product.saveTemplate',
      'product.archiveTemplate',
      'product.getTemplate',
      'product.listCategories',
    ]) {
      await fixture('user.grantFunction', { id: `hardening-${fnKey}`, roleId: 'hardening-products', fnKey })
    }
    for (const roleId of ['studio-editor', 'studio-publisher', 'hardening-customers', 'hardening-products']) {
      await fixture('user.assignScopedRole', {
        id: `hardening-${roleId}`,
        userId: 'studio-designer',
        roleId,
        scopeKind: 'company',
        companyId: 'studio-a',
        expectedAuthorizationRevision: await revision(),
        idempotencyKey: `hardening-${roleId}`,
      })
    }
    await fixture('website.saveDomain', {
      id: 'domain-a',
      siteId: 'site-a',
      host: '127.0.0.1',
      primary: true,
    })
    await fixture('website.saveEntry', {
      id: 'post-a',
      siteId: 'site-a',
      type: 'website.post',
      title: 'Bài viết kiểm chứng',
      path: '/bai-viet',
      slug: 'bai-viet',
      fields: {},
      layout: [
        { id: 'post-text', type: 'website.rich_text', settings: { body: 'Nội dung kiểm chứng native.' } },
      ],
    })
    await fixture('product.saveTemplate', {
      id: 'product-a',
      name: 'Sản phẩm kiểm chứng',
      type: 'goods',
      description: 'Nội dung ERP',
    })
    const binding = await fixture('website_catalog.addProduct', { siteId: 'site-a', productId: 'product-a' })
    for (const kind of ['category', 'collection']) {
      await fixture('website_catalog.saveCategory', {
        siteId: 'site-a',
        id: `catalog-${kind}-a`,
        kind,
        title: kind === 'category' ? 'Danh mục kiểm chứng' : 'Bộ sưu tập kiểm chứng',
        slug: `kiem-chung-${kind}`,
        position: 0,
        visible: false,
        includeChildren: true,
        mode: 'manual',
        productIds: [],
        primarySort: 'manual',
        indexing: 'index',
      })
    }
    await fixture('website_form.saveForm', {
      id: 'form-a',
      siteId: 'site-a',
      name: 'Biểu mẫu kiểm chứng',
      schema: {
        fields: [
          {
            name: 'name',
            label: 'Họ tên',
            type: 'text',
            required: true,
            maxLength: 120,
            classification: 'public',
          },
        ],
      },
      successMessage: 'Đã nhận thông tin',
      active: true,
    })
    await fixture('partner.savePartner', {
      id: 'customer-a',
      kind: 'person',
      name: 'Khách kiểm chứng',
      phone: '0901000001',
    })
    await fixture('website.issueCustomerAccess', {
      siteId: 'site-a',
      partnerId: 'customer-a',
      phone: '0901000001',
    })
    const client = app.client.anonymous()
    await client.login({ login: 'studio-designer', password: 'studio-local' })
    const call = async (name: string, input: Row = {}) => {
      const response = await client.post(`/website/api/${name}`, JSON.stringify(input), {
        headers: { 'content-type': 'application/json' },
      })
      const result = (await response.json()) as { value: Row; message?: string }
      assert.equal(response.status, 200, `${name}: ${JSON.stringify(result)}`)
      return result.value
    }
    const formResponse = await app.client
      .anonymous()
      .post(
        '/website/forms/form-a/submit',
        JSON.stringify({ payload: { name: 'Khách kiểm chứng' }, _schemaVersion: 1 }),
        { headers: { 'content-type': 'application/json' } },
      )
    assert.equal(formResponse.status, 200, await formResponse.clone().text())
    const submissions = await call('website_form.listSubmissions', { siteId: 'site-a', formId: 'form-a' })
    const submissionId = String((submissions.rows as Row[])[0]!.id)
    const catalog = await call('website_catalog.listBindings', { siteId: 'site-a' })
    const catalogTemplate = String((catalog.templates as Row[])[0]!.id)
    const paths = Object.entries(coreRoutes).map(([key, route]) => {
      let id = 'new'
      if (key.startsWith('catalog-category-')) id = 'catalog-category-a'
      else if (key.startsWith('catalog-collection-')) id = 'catalog-collection-a'
      else if (key === 'catalog-template') id = catalogTemplate
      else if (key.startsWith('catalog-product-')) id = 'product-a'
      else if (['catalog-edit', 'catalog-remove', 'catalog-preview'].includes(key)) id = String(binding.id)
      else if (key.startsWith('post-') && key !== 'post-new') id = 'post-a'
      else if (['builder', 'entry-details', 'preview', 'seo-edit'].includes(key)) id = 'page-site-a'
      else if (['themes-edit', 'menus-edit'].includes(key)) id = 'site-a'
      else if (key === 'domains-edit') id = 'domain-a'
      else if (key === 'templates-edit') id = 'website-introduction'
      else if (['form-editor-edit', 'submissions', 'visitor-form'].includes(key)) id = 'form-a'
      else if (['submission-detail', 'visitor-receipt'].includes(key)) id = submissionId
      else if (key === 'customer') id = 'customer-a'
      return {
        key,
        url: buildHref(coreRoutes, '/website/', key, { id }, { site: 'site-a' }),
        workspace: route.frame === 'workspace',
        overlay: !!route.modal,
      }
    })
    return { ...context, client, call, paths }
  } catch (error) {
    await app.close()
    throw error
  }
}
