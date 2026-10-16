import assert from 'node:assert/strict'
import { test } from 'node:test'
import { countingHost, mount, renderToString } from '@ketvietlab/ketjs-view'
import type { HostNode } from '@ketvietlab/ketjs-view'
import { createVariantAttributeForm } from '../packages/ketsuite/src/ui/client/variant-attribute-create.tsx'
import { relationSelectDemoConfig } from '../packages/design-system/src/interactions/relation-select/demo.ts'
import type { JSXChild, TemplateResult } from '@ketvietlab/ketjs-view'
import {
  createVariantEditorView,
  type VariantEditorSetup,
} from '../packages/ketsuite/src/ui/client/variant-editor-view.tsx'

// The attribute and variant editor island (ui/client/variant-editor-view.tsx), on its own.

const render = (child: JSXChild): string => renderToString(child as TemplateResult)

test('informational-only attributes explain the base SKU and retain older label contracts', () => {
  const setup = teeSetup()
  setup.lines = setup.lines.map((line) => ({ ...line, createVariant: 'no_variant' }))
  setup.variants = []
  const config = {
    id: 'info-editor',
    kind: 'product.template',
    setup,
    editable: true,
    saveFunction: 'product.saveVariantSetup',
    labels: {
      noExtraVariants: 'No additional variants',
      noExtraVariantsHint: 'The product keeps its own SKU',
    },
    relationLabels: relationSelectDemoConfig.labels,
    lightboxLabels: {
      open: 'Open {alt}',
      close: 'Close',
      previous: 'Previous',
      next: 'Next',
      zoomIn: 'Zoom in',
      zoomOut: 'Zoom out',
      counter: '{index} / {total}',
    },
    media: { upload: false, remove: false },
  }
  const html = renderToString(createVariantEditorView(config).view())
  assert.match(html, /No additional variants/)
  assert.match(html, /The product keeps its own SKU/)
  const old = renderToString(
    createVariantEditorView({
      ...config,
      labels: { variantsEmpty: 'Old empty title', noVariantHint: 'Informational only' },
    }).view(),
  )
  assert.match(old, /Old empty title/)
  assert.match(old, /Informational only/)
})

test('variant editor: quick creation preserves input on failure and reuses IDs on retry before selecting the new values', async (t) => {
  class Input {
    name: string
    value: string
    constructor(name: string, value: string) {
      this.name = name
      this.value = value
    }
  }
  class Target {
    closest() {
      return { name: 'createAttribute', disabled: false }
    }
  }
  let click: (event: { target: Target }) => void = () => {}
  const calls: Record<string, unknown>[] = []
  const added: unknown[] = []
  let fail = true
  t.mock.method(globalThis, 'fetch', async (_url: string, init?: RequestInit) => {
    calls.push(JSON.parse(String(init?.body)))
    if (fail) throw new Error('offline')
    return Response.json({ value: { ok: true } })
  })
  const globals = globalThis as unknown as Record<string, unknown>
  const replacements = {
    Element: Target,
    HTMLInputElement: Input,
    HTMLTextAreaElement: Input,
    document: { getElementById: () => null, dispatchEvent: () => true },
  }
  const previous = Object.fromEntries(Object.keys(replacements).map((key) => [key, globals[key]]))
  Object.assign(globals, replacements)
  const settle = async () => {
    for (let i = 0; i < 4; i++) await new Promise((resolve) => setImmediate(resolve))
  }
  const form = createVariantAttributeForm({
    id: 'quick',
    kind: 'product.template',
    enabled: true,
    disabled: () => false,
    t: (key) => key,
    added: (attribute) => added.push(attribute),
  })
  const host = countingHost()
  const root = host.root()
  const mounted = mount(host, root, () => <>{form.view()}</>)
  const lifetime = new AbortController()
  form.attach(
    {
      addEventListener: (_name: string, handler: typeof click) => {
        click = handler
      },
    } as unknown as HTMLElement,
    lifetime.signal,
  )
  const wrapper = (): HostNode => root.children!.find((node) => node.tag === 'div')!
  const type = (name: string, value: string) =>
    host.fire(wrapper(), 'input', { target: new Input(name, value) })
  const submit = async () => {
    host.fire(wrapper(), 'submit', { preventDefault() {}, stopPropagation() {} })
    await settle()
  }
  try {
    click({ target: new Target() })
    type('attributeName', ' Capacity ')
    type('attributeValues', '30 ml\n30 ml')
    await submit()
    assert.equal(calls.length, 0, 'duplicate values must not write anything')
    assert.match(render(form.view()), /attributeValuesDuplicate/)
    type('attributeValues', '30 ml\n50 ml')
    await submit()
    assert.match(render(form.view()), /attributeCreateFailed/)
    assert.match(render(form.view()), /Capacity/)
    assert.match(render(form.view()), /30 ml/)
    assert.equal(added.length, 0)
    fail = false
    await submit()
    assert.deepEqual(calls[1], calls[0], 'retry reuses IDs, avoiding duplicate shared attributes')
    assert.equal(added.length, 1)
    assert.equal(form.open(), false)
    assert.deepEqual(
      (added[0] as { values: Array<{ name: string }> }).values.map((value) => value.name),
      ['30 ml', '50 ml'],
    )
  } finally {
    lifetime.abort()
    mounted.dispose()
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete globals[key]
      else globals[key] = value
    }
  }
})

test('variant editor: quick creation is absent without its separate permission', () => {
  const form = createVariantAttributeForm({
    id: 'quick',
    kind: 'product.template',
    enabled: false,
    disabled: () => false,
    t: (key) => key,
    added: () => assert.fail('readers cannot create attributes'),
  })
  assert.equal(form.view(), null)
})

const teeSetup = (): VariantEditorSetup => ({
  templateId: 'tpl-1',
  listPrice: '200000',
  lines: [
    {
      attributeId: 'color',
      name: 'Màu',
      createVariant: 'always',
      displayType: 'select',
      values: [
        { valueId: 'red', name: 'Đỏ', priceExtra: '0' },
        { valueId: 'black', name: 'Đen', priceExtra: '0' },
      ],
    },
    {
      attributeId: 'size',
      name: 'Size',
      createVariant: 'always',
      displayType: 'select',
      values: [
        { valueId: 's', name: 'S', priceExtra: '0' },
        { valueId: 'l', name: 'L', priceExtra: '20000' },
      ],
    },
  ],
  catalogue: [],
  variants: [
    {
      id: 'v1',
      valueIds: { color: 'red', size: 'l' },
      defaultCode: 'TEE-RL',
      barcode: null,
      weight: '0',
      volume: '0',
      active: true,
      images: [],
    },
    {
      id: 'v2',
      valueIds: { color: 'red', size: 'l' },
      defaultCode: null,
      barcode: null,
      weight: '0',
      volume: '0',
      active: true,
      images: [],
    },
  ],
})

test('variant editor: rows price from list price plus value extras, and a shared combination is flagged on both rows', () => {
  const view = createVariantEditorView({
    id: 'editor',
    kind: 'product.template',
    setup: teeSetup(),
    editable: true,
    saveFunction: 'product.saveVariantSetup',
    labels: { duplicate: 'dup #{row}', missing: '{count} missing' },
    relationLabels: relationSelectDemoConfig.labels,
    lightboxLabels: {
      open: 'Open {alt}',
      close: 'Close',
      previous: 'Previous',
      next: 'Next',
      zoomIn: 'Zoom in',
      zoomOut: 'Zoom out',
      counter: '{index} / {total}',
    },
    media: { upload: true, remove: true },
  })
  const html = renderToString(view.view())
  assert.match(html, /220\.000/, 'L adds 20.000 to the 200.000 list price')
  assert.match(html, /dup #2/)
  assert.match(html, /dup #1/)
  assert.match(html, /3 missing/, 'red·S, black·S and black·L have no variant yet')
  assert.match(html, /data-ui="relation-select"/, 'attributes use the shared searchable relation selector')
  assert.doesNotMatch(html, /data-ui="variant-editor-add-attribute"/, 'no parallel native attribute picker')
  // Step 1 ticks values in a design-system checkbox group; step 2 rows open with a disclosure button.
  assert.match(html, /stepAttributes/)
  assert.match(html, /stepVariants/)
  assert.match(html, /data-kind="checkbox-group"/)
  assert.match(html, /name="values\|color\[\]" value="red" checked/)
  assert.match(html, /name="variantAction" value="toggleRow\|v1"[^>]*aria-expanded="false"/)
  assert.match(html, /name="variantAction" value="generate"/, 'the missing notice offers to create them')
  assert.match(html, /Đỏ \/ L/, 'a row reads as its combination')
  assert.doesNotMatch(html, /name="combo\|/, 'a collapsed row shows its combination as text, not selects')
})

test('variant editor: ticking values, generating the missing combinations and fixing extras keep one draft', async () => {
  class FakeElement {
    button: unknown
    constructor(button: unknown = null) {
      this.button = button
    }
    closest() {
      return this.button
    }
  }
  class FakeInput extends FakeElement {
    name: string
    value: string
    type: string
    checked: boolean
    constructor(name: string, value: string, type = 'text', checked = false) {
      super()
      this.name = name
      this.value = value
      this.type = type
      this.checked = checked
    }
  }
  class FakeSelect extends FakeElement {}
  const globals = globalThis as unknown as Record<string, unknown>
  const replacements = {
    Element: FakeElement,
    HTMLInputElement: FakeInput,
    HTMLSelectElement: FakeSelect,
  }
  const previous = Object.fromEntries(Object.keys(replacements).map((key) => [key, globals[key]]))
  Object.assign(globals, replacements)
  const setup = teeSetup()
  setup.catalogue = [
    {
      attributeId: 'color',
      name: 'Màu',
      createVariant: 'always',
      values: [
        { valueId: 'red', name: 'Đỏ' },
        { valueId: 'black', name: 'Đen' },
        { valueId: 'white', name: 'Trắng' },
      ],
    },
    {
      attributeId: 'size',
      name: 'Size',
      createVariant: 'always',
      values: [
        { valueId: 's', name: 'S' },
        { valueId: 'l', name: 'L' },
      ],
    },
  ]
  // One row per combination already exists except the duplicate, so only new values are missing.
  setup.variants = [
    ['red', 's'],
    ['red', 'l'],
    ['black', 's'],
    ['black', 'l'],
  ].map(([color, size]) => ({
    id: `${color}-${size}`,
    valueIds: { color: color!, size: size! },
    defaultCode: null,
    barcode: null,
    weight: '0',
    volume: '0',
    active: true,
    images: [],
  }))
  const view = createVariantEditorView({
    id: 'editor',
    kind: 'product.template',
    setup,
    editable: true,
    saveFunction: 'product.saveVariantSetup',
    labels: {
      missing: '{count} missing',
      generate: 'Create {count}',
      valuesSelected: '{count}/{total} selected',
      invalidNumber: 'bad number',
      rowInvalid: 'row bad',
      incomplete: 'incomplete',
      new: 'new',
      summaryInvalid: 'fix numbers',
    },
    relationLabels: relationSelectDemoConfig.labels,
    lightboxLabels: {
      open: 'Open {alt}',
      close: 'Close',
      previous: 'Previous',
      next: 'Next',
      zoomIn: 'Zoom in',
      zoomOut: 'Zoom out',
      counter: '{index} / {total}',
    },
    media: { upload: true, remove: true },
  })
  const host = countingHost()
  const root = host.root()
  const mounted = mount(host, root, () => view.view())
  const editor = (): HostNode => root.children!.find((node) => node.tag === 'div')!
  const html = () => render(view.view())
  const tick = (attributeId: string, valueId: string, checked: boolean) =>
    host.fire(editor(), 'change', {
      target: new FakeInput(`values|${attributeId}[]`, valueId, 'checkbox', checked),
    })
  const press = (value: string) =>
    host.fire(editor(), 'click', {
      target: new FakeElement({ name: 'variantAction', value, disabled: false }),
    })
  try {
    assert.match(html(), /2\/3 selected/)
    assert.doesNotMatch(html(), /missing/, 'every ticked combination has a row')

    tick('color', 'white', true)
    assert.match(html(), /name="values\|color\[\]" value="white" checked/)
    assert.match(html(), /3\/3 selected/)
    assert.match(html(), /2 missing/, 'white·S and white·L')
    assert.match(html(), /Create 2/)

    press('generate')
    assert.doesNotMatch(html(), /missing/)
    assert.equal((html().match(/data-ui="variant-editor-row"/g) ?? []).length, 6)
    assert.match(html(), /Trắng \/ S/)
    assert.match(html(), /Trắng \/ L/)
    assert.equal((html().match(/>new</g) ?? []).length, 2)

    // Unticking a value in use leaves its rows without a combination instead of deleting them.
    tick('color', 'white', false)
    assert.equal((html().match(/>incomplete</g) ?? []).length, 2)
    tick('color', 'white', true)
    assert.doesNotMatch(html(), />incomplete</)

    // Price extras keep typed text, flag it, and put it back on Reset.
    host.fire(editor(), 'input', { target: new FakeInput('extra|size|l', 'abc') })
    assert.match(html(), /bad number/)
    assert.match(html(), /fix numbers/)
    host.fire(editor(), 'input', { target: new FakeInput('extra|size|l', '25000') })
    assert.match(html(), /225\.000/, 'L now adds 25.000 to the 200.000 list price')

    press('reset')
    assert.match(html(), /2\/3 selected/)
    assert.equal((html().match(/data-ui="variant-editor-row"/g) ?? []).length, 4)
    assert.match(html(), /220\.000/)

    // A row opens to edit its combination and fields, announced on its toggle.
    press('toggleRow|red-s')
    assert.match(html(), /value="toggleRow\|red-s"[^>]*aria-expanded="true" aria-controls="editor-row-red-s"/)
    assert.match(html(), /name="combo\|red-s\|color"/)
    assert.match(html(), /name="field\|red-s\|defaultCode"/)
    // Every row's Sửa/Lưu trữ repeat the same words, so each is described by its combination.
    assert.match(html(), /<strong id="editor-row-red-s-title"[^>]*>(?:<!--k\[-->)*Đỏ \/ S</)
    assert.equal((html().match(/aria-describedby="editor-row-red-s-title"/g) ?? []).length, 2)

    // A bad weight stays flagged on the row after it is closed, not only inside it.
    host.fire(editor(), 'input', { target: new FakeInput('field|red-s|weight', '1,5') })
    press('toggleRow|red-s')
    assert.doesNotMatch(html(), /name="field\|red-s\|weight"/)
    assert.match(html(), />row bad</)
    assert.match(html(), /fix numbers/)

    // A saved row takes its image through the design-system drop zone, with the drop hint inside it.
    press('toggleRow|black-l')
    assert.match(html(), /data-ui="image-drop-zone"/)
    assert.match(html(), /data-ui="image-drop-picker" title="dropImage"/)
    assert.doesNotMatch(html(), /data-ui="file-upload"|data-ui="lightbox-empty" data-size="large"/)
    assert.match(html(), /id="editor-row-black-l-image" type="file"[^>]*name="image\|black-l"/)
    const descendants = (node: HostNode): HostNode[] => [node, ...(node.children ?? []).flatMap(descendants)]
    const target = () => descendants(root).find((node) => node.attrs?.['data-ui'] === 'variant-editor-image')!
    let requests = 0
    const originalFetch = globalThis.fetch
    let finish!: (response: Response) => void
    globalThis.fetch = (() => {
      requests++
      return new Promise<Response>((resolve) => {
        finish = resolve
      })
    }) as typeof fetch
    try {
      let prevented = 0
      const drop = (file: File) =>
        host.fire(target(), 'drop', {
          preventDefault: () => {
            prevented++
          },
          dataTransfer: { files: [file] },
        })
      drop(new File(['text'], 'notes.txt', { type: 'text/plain' }))
      assert.equal(requests, 0, 'non-image drops do not upload')
      host.fire(target(), 'dragover', { preventDefault() {} })
      assert.match(html(), /data-ui="image-drop-zone"[^>]*data-drag="true"/)
      const photo = new File(['image'], 'photo.png', { type: 'image/png' })
      drop(photo)
      assert.equal(requests, 1, 'dropping on the image frame starts upload')
      assert.match(html(), /data-ui="image-drop-zone"[^>]*aria-busy="true"/)
      drop(photo)
      assert.equal(requests, 1, 'a second drop is ignored while uploading')
      assert.equal(prevented, 3, 'drop never navigates away from the form')
      finish(new Response('{}', { status: 400 }))
      await new Promise((resolve) => setTimeout(resolve, 0))
      assert.match(html(), /imageFailed/)
      assert.doesNotMatch(html(), /data-ui="image-drop-zone"[^>]*aria-busy="true"/)
    } finally {
      globalThis.fetch = originalFetch
    }
  } finally {
    mounted.dispose()
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete globals[key]
      else globals[key] = value
    }
  }
})

test('variant editor: a viewer without the save permission reads the setup but cannot change it', () => {
  const view = createVariantEditorView({
    id: 'editor',
    kind: 'product.template',
    setup: teeSetup(),
    editable: false,
    saveFunction: 'product.saveVariantSetup',
    labels: {},
    relationLabels: relationSelectDemoConfig.labels,
    lightboxLabels: {
      open: 'Open {alt}',
      close: 'Close',
      previous: 'Previous',
      next: 'Next',
      zoomIn: 'Zoom in',
      zoomOut: 'Zoom out',
      counter: '{index} / {total}',
    },
    media: { upload: true, remove: true },
  })
  const html = renderToString(view.view())
  assert.match(html, /readOnly/)
  assert.doesNotMatch(html, /data-ui="relation-select"/, 'no attribute picker')
  assert.doesNotMatch(html, /value="(generate|addRow|reset|selectAll\||removeLine\||removeRow\|)/)
  assert.match(html, /name="values\|color\[\]" value="red" checked="true" disabled/)
  assert.match(html, /value="toggleRow\|v1"/, 'rows can still be opened to read')
})
