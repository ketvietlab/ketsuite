import { defineIsland, html, signal } from '@ketvietlab/ketjs-view'
import { createProductEditorStatusView } from './client/editor-view.mjs'
import { createProductMediaUploadView } from './client/media-upload-view.mjs'
import { defineRecordModalIsland, defineRecordPageIsland } from '../../ui/record-modal.tsx'
import { createVariantEditorView, type VariantEditorProps } from '../../ui/client/variant-editor-view.tsx'
import {
  PRODUCT_LIST_KEY,
  productList,
  productListControls,
  productListFooter,
  type ProductListProps,
} from './list/island.tsx'
import { UNIT_LIST_KEY, unitList } from './units/island.tsx'
import type { UnitListProps } from './units/island.tsx'

const runtime = { html, signal }

const PRODUCT_LIST_PROPS = {
  read: 'text',
  href: 'text',
  timezone: 'text',
  lang: 'text',
  pageSize: 'int',
  labels: 'json',
  search: 'json',
  createHref: 'text?',
  bulk: 'json?',
  images: 'bool?',
} as const

type ProductEditorProps = { identity: string; templateId?: string; productId?: string; lang?: string }
type MediaUploadProps = { identity: string; action: string; label: string }

export const islands = {
  'product.editor': defineIsland<ProductEditorProps>()({
    props: { identity: 'text', templateId: 'id?', productId: 'id?', lang: 'text?' },
    key: ['identity'],
    view: (props) => createProductEditorStatusView(runtime, props),
  }),
  'product.media-upload': defineIsland<MediaUploadProps>()({
    props: { identity: 'text', action: 'text', label: 'text' },
    key: ['identity'],
    client: 'product.mjs',
    export: 'mediaUpload',
    view: (props) => createProductMediaUploadView(runtime, props),
  }),
  // A template's own page (`/admin/product/templates/{id}`, `new` to create):
  // the server renders the RecordPage in its loading state and the client
  // renders the record — General and Variants tabs only; Media stays on the
  // server-rendered `?tab=media` page for now (see modal/product-modal-view.tsx).
  'product.template-page': defineRecordPageIsland({
    kind: 'product.template',
    client: 'product-modal.mjs',
    export: 'templatePage',
  }),
  // The catalogue (`/admin/product/templates`): three islands over one paged read and one
  // store, which the server renders in its loading state (list/island.tsx, list/read.ts).
  'product.template-list-controls': defineIsland<ProductListProps>()({
    props: PRODUCT_LIST_PROPS,
    key: PRODUCT_LIST_KEY,
    client: 'product-list.mjs',
    export: 'productListControls',
    view: productListControls,
  }),
  'product.template-list': defineIsland<ProductListProps>()({
    props: PRODUCT_LIST_PROPS,
    // A new URL from the shell is a new list; the same one keeps the island and its rows.
    key: PRODUCT_LIST_KEY,
    client: 'product-list.mjs',
    export: 'productList',
    view: productList,
  }),
  'product.template-list-footer': defineIsland<ProductListProps>()({
    props: PRODUCT_LIST_PROPS,
    key: PRODUCT_LIST_KEY,
    client: 'product-list.mjs',
    export: 'productListFooter',
    view: productListFooter,
  }),
  'product.attribute-modal': defineRecordModalIsland({
    kind: 'product.attribute',
    client: 'attribute-modal.mjs',
    export: 'attributeModal',
  }),
  // The Units of measure list (`/admin/product/uoms`) — see units/island.tsx.
  'product.uom-list': defineIsland<UnitListProps>()({
    props: { href: 'text', lang: 'text', pageSize: 'int', labels: 'json', createHref: 'text?' },
    // A new URL from the shell is a new list; the same one keeps the island and its rows.
    key: UNIT_LIST_KEY,
    client: 'uom-list.mjs',
    export: 'unitList',
    view: unitList,
  }),
  'product.uom-modal': defineRecordModalIsland({
    kind: 'product.uom',
    client: 'uom-modal.mjs',
    export: 'uomModal',
  }),
  // The template modal's "Attributes & variants" tab — see ui/client/variant-editor-view.tsx.
  'product.variant-editor': defineIsland<VariantEditorProps>()({
    props: {
      id: 'id',
      kind: 'text',
      setup: 'json',
      editable: 'bool',
      createAttribute: 'bool?',
      saveFunction: 'text',
      labels: 'json',
      relationLabels: 'json',
      lightboxLabels: 'json',
      media: 'json',
    },
    key: ['id'],
    client: 'variant-editor.mjs',
    export: 'variantEditor',
    view: (props) => createVariantEditorView(props),
  }),
}
