import type { ModulePermissionsDef } from '@ketvietlab/ketjs'
import { permissions as account } from './permission-catalogue/account.ts'
import { permissions as account_backend } from './permission-catalogue/account_backend.ts'
import { permissions as account_staff_channel } from './permission-catalogue/account_staff_channel.ts'
import { permissions as activity } from './permission-catalogue/activity.ts'
import { permissions as address } from './permission-catalogue/address.ts'
import { permissions as address_backend } from './permission-catalogue/address_backend.ts'
import { permissions as attendance } from './permission-catalogue/attendance.ts'
import { permissions as backend } from './permission-catalogue/backend.ts'
import { permissions as business_report_staff_channel } from './permission-catalogue/business_report_staff_channel.ts'
import { permissions as calendar } from './permission-catalogue/calendar.ts'
import { permissions as channel_api } from './permission-catalogue/channel_api.ts'
import { permissions as company } from './permission-catalogue/company.ts'
import { permissions as company_backend } from './permission-catalogue/company_backend.ts'
import { permissions as crm } from './permission-catalogue/crm.ts'
import { permissions as crm_backend } from './permission-catalogue/crm_backend.ts'
import { permissions as crm_sale } from './permission-catalogue/crm_sale.ts'
import { permissions as crm_staff_channel } from './permission-catalogue/crm_staff_channel.ts'
import { permissions as crm_website } from './permission-catalogue/crm_website.ts'
import { permissions as flow } from './permission-catalogue/flow.ts'
import { permissions as flow_staff_channel } from './permission-catalogue/flow_staff_channel.ts'
import { permissions as flow_backend } from './permission-catalogue/flow_backend.ts'
import { permissions as hospitality_billing } from './permission-catalogue/hospitality_billing.ts'
import { permissions as hospitality_core } from './permission-catalogue/hospitality_core.ts'
import { permissions as hospitality_staff_channel } from './permission-catalogue/hospitality_staff_channel.ts'
import { permissions as hr } from './permission-catalogue/hr.ts'
import { permissions as hr_backend } from './permission-catalogue/hr_backend.ts'
import { permissions as inventory_staff_channel } from './permission-catalogue/inventory_staff_channel.ts'
import { permissions as livedoc } from './permission-catalogue/livedoc.ts'
import { permissions as loyalty } from './permission-catalogue/loyalty.ts'
import { permissions as loyalty_backend } from './permission-catalogue/loyalty_backend.ts'
import { permissions as loyalty_pos } from './permission-catalogue/loyalty_pos.ts'
import { permissions as loyalty_sale } from './permission-catalogue/loyalty_sale.ts'
import { permissions as mail } from './permission-catalogue/mail.ts'
import { permissions as mail_backend } from './permission-catalogue/mail_backend.ts'
import { permissions as mail_staff_channel } from './permission-catalogue/mail_staff_channel.ts'
import { permissions as mail_transport } from './permission-catalogue/mail_transport.ts'
import { permissions as manufacturing } from './permission-catalogue/manufacturing.ts'
import { permissions as manufacturing_backend } from './permission-catalogue/manufacturing_backend.ts'
import { permissions as oauth } from './permission-catalogue/oauth.ts'
import { permissions as oauth_backend } from './permission-catalogue/oauth_backend.ts'
import { permissions as partner } from './permission-catalogue/partner.ts'
import { permissions as partner_backend } from './permission-catalogue/partner_backend.ts'
import { permissions as partner_mail_backend } from './permission-catalogue/partner_mail_backend.ts'
import { permissions as pos } from './permission-catalogue/pos.ts'
import { permissions as pos_backend } from './permission-catalogue/pos_backend.ts'
import { permissions as pos_channel } from './permission-catalogue/pos_channel.ts'
import { permissions as pricing_backend } from './permission-catalogue/pricing_backend.ts'
import { permissions as pricing } from './permission-catalogue/pricing.ts'
import { permissions as product } from './permission-catalogue/product.ts'
import { permissions as product_backend } from './permission-catalogue/product_backend.ts'
import { permissions as product_mail_backend } from './permission-catalogue/product_mail_backend.ts'
import { permissions as product_media } from './permission-catalogue/product_media.ts'
import { permissions as purchase } from './permission-catalogue/purchase.ts'
import { permissions as purchase_backend } from './permission-catalogue/purchase_backend.ts'
import { permissions as purchase_staff_channel } from './permission-catalogue/purchase_staff_channel.ts'
import { permissions as quality } from './permission-catalogue/quality.ts'
import { permissions as quality_staff_channel } from './permission-catalogue/quality_staff_channel.ts'
import { permissions as sale } from './permission-catalogue/sale.ts'
import { permissions as sale_backend } from './permission-catalogue/sale_backend.ts'
import { permissions as sale_staff_channel } from './permission-catalogue/sale_staff_channel.ts'
import { permissions as stock } from './permission-catalogue/stock.ts'
import { permissions as stock_backend } from './permission-catalogue/stock_backend.ts'
import { permissions as stock_mail_backend } from './permission-catalogue/stock_mail_backend.ts'
import { permissions as stock_staff_channel } from './permission-catalogue/stock_staff_channel.ts'
import { permissions as storage } from './permission-catalogue/storage.ts'
import { permissions as uom } from './permission-catalogue/uom.ts'
import { permissions as user } from './permission-catalogue/user.ts'
import { permissions as user_backend } from './permission-catalogue/user_backend.ts'
import { permissions as website_catalog } from './permission-catalogue/website_catalog.ts'
import { permissions as website_backend } from './permission-catalogue/website_backend.ts'
import { permissions as website_form } from './permission-catalogue/website_form.ts'
import { permissions as website_customer_mail } from './permission-catalogue/website_customer_mail.ts'
import { permissions as website_form_mail } from './permission-catalogue/website_form_mail.ts'
import { permissions as website_menu } from './permission-catalogue/website_menu.ts'
import { permissions as website_search } from './permission-catalogue/website_search.ts'
import { permissions as website_seo } from './permission-catalogue/website_seo.ts'
import { permissions as website_theme } from './permission-catalogue/website_theme.ts'
import { permissions as website } from './permission-catalogue/website.ts'
import { capabilityLabels } from './permission-catalogue/capability-labels.ts'
import type { CatalogueSource } from './permission-catalogue/source.ts'

/**
 * Each module's declarations live in `permission-catalogue/<module>.ts`, so a
 * branch that changes one module's functions edits that module's file and no
 * other: this one only changes when a module joins or leaves the catalogue.
 * The order below is the order of `ketsuitePermissionModuleNames`.
 */
const sources = {
  account,
  account_backend,
  account_staff_channel,
  activity,
  address,
  address_backend,
  attendance,
  backend,
  business_report_staff_channel,
  calendar,
  channel_api,
  company,
  company_backend,
  crm,
  crm_backend,
  crm_sale,
  crm_staff_channel,
  crm_website,
  flow,
  flow_staff_channel,
  flow_backend,
  hospitality_billing,
  hospitality_core,
  hospitality_staff_channel,
  hr,
  hr_backend,
  inventory_staff_channel,
  livedoc,
  loyalty,
  loyalty_backend,
  loyalty_pos,
  loyalty_sale,
  mail,
  mail_backend,
  mail_staff_channel,
  mail_transport,
  manufacturing,
  manufacturing_backend,
  oauth,
  oauth_backend,
  partner,
  partner_backend,
  partner_mail_backend,
  pos,
  pos_backend,
  pos_channel,
  pricing_backend,
  pricing,
  product,
  product_backend,
  product_mail_backend,
  product_media,
  purchase,
  purchase_backend,
  purchase_staff_channel,
  quality,
  quality_staff_channel,
  sale,
  sale_backend,
  sale_staff_channel,
  stock,
  stock_backend,
  stock_mail_backend,
  stock_staff_channel,
  storage,
  uom,
  user,
  user_backend,
  website_catalog,
  website_backend,
  website_form,
  website_customer_mail,
  website_form_mail,
  website_menu,
  website_search,
  website_seo,
  website_theme,
  website,
} satisfies Record<string, CatalogueSource>

/** Exact Wave 2 declarations for public KetSuite modules in production product deployments. */
export const ketsuitePermissionModules = Object.fromEntries(
  (Object.entries(sources) as [string, CatalogueSource][]).map(([module, source]) => [
    module,
    {
      posture: source.posture,
      owner: module,
      bundles: Object.fromEntries(
        source.bundles.map((capability) => {
          const labels = capabilityLabels[capability]
          if (!labels) throw new Error(`missing labels for permission capability "${capability}"`)
          return [
            `${module}.${capability}`,
            {
              labels: {
                en: `${labels.en} · ${module.replaceAll('_', ' ')}`,
                vi: `${labels.vi} · ${module.replaceAll('_', ' ')}`,
              },
            },
          ]
        }),
      ),
      functions: Object.fromEntries(
        Object.entries(source.functions).map(([action, [risk, capabilities, policy]]) => [
          `${module}.${action}`,
          {
            risk,
            bundles: (Array.isArray(capabilities) ? capabilities : [capabilities]).map(
              (capability) => `${module}.${capability}`,
            ),
            owner: module,
            ...(policy ? { policy } : {}),
          },
        ]),
      ),
      exemptions: Object.fromEntries(
        Object.entries(source.exemptions).map(([action, [reason, authority]]) => [
          `${module}.${action}`,
          { reason, authority },
        ]),
      ),
    },
  ]),
) as Record<string, ModulePermissionsDef>

export const ketsuitePermissionModuleNames = Object.freeze(Object.keys(sources))
