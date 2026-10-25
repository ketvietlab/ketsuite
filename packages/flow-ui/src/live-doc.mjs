import { html } from '@ketvietlab/ketjs-view'
import { flowLocale } from './i18n.mjs'

/** What the editor reports on change: the whole Yjs state and its blocks.
 * @typedef {{snapshot:string,blocks:Array<{id?:string,type:string,checked?:boolean,align?:string,width?:number,src?:string,alt?:string,rows?:string[][],delta:Array<{insert:string,attributes?:Record<string, unknown>}>}>}} FlowLiveDocValue */

/** The live document editor belongs to the host, which names its module here.
 * KetSuite serves its own editor this way, so the Flow kit never imports the suite.
 * Until a host names one, a live document reports that it cannot open.
 * @type {string|null} */
let editorModule = null
/** @param {string|null} url Module URL whose `createLiveDocView` builds the editor. */
export const setFlowLiveDocEditor = (url) => {
  editorModule = url || null
}
const loadEditor = () =>
  editorModule
    ? import(editorModule)
    : Promise.reject(new Error('Flow live documents need the host to name an editor module'))
/** Convert legacy Flow blocks once; the Yjs snapshot becomes the rich source of truth.
 * @param {Array<{id?:string,type:string,text?:string,bold?:boolean,italic?:boolean,checked?:boolean,align?:string,rows?:string[][]}>} blocks */
export const FlowLiveDocBlocks = (blocks) =>
  blocks.map((b) => ({
    id: b.id,
    type: { paragraph: 'p', heading: 'h2', subheading: 'h3' }[b.type] ?? b.type,
    checked: b.checked,
    align: b.align,
    rows: b.rows,
    delta: b.text
      ? [
          {
            insert: b.text,
            attributes: { ...(b.bold ? { bold: true } : {}), ...(b.italic ? { italic: true } : {}) },
          },
        ]
      : [],
  }))
/** @param {FlowLiveDocValue} value */
export const FlowLiveDocText = (value) =>
  value.blocks
    .map((b) =>
      b.type === 'table'
        ? (b.rows?.map((r) => r.join(' | ')).join('\n') ?? '')
        : b.delta.map((d) => d.insert).join(''),
    )
    .join('\n\n')
/** @param {FlowLiveDocValue} value */
export const FlowLiveDocLegacyBlocks = (value) =>
  value.blocks.map((b, i) => ({
    id: b.id ?? `live-${i}`,
    type: { p: 'paragraph', h2: 'heading', h3: 'subheading' }[b.type] ?? b.type,
    text: b.delta.map((d) => d.insert).join(''),
    checked: b.checked,
    align: b.align,
    rows: b.rows,
  }))

/** Shared LiveDoc embedding; attachFlowUI owns mounting/disposal, never a second island.
 * The editor bundle is imported when the first editor mounts, so screens without
 * a document or task description never download it.
 * @param {{id:string,label:string,snapshot?:string,transport?:{base:string,docId:string},blocks?:Parameters<typeof FlowLiveDocBlocks>[0],text?:string,readOnly?:boolean,toolbar?:'top'|'floating',surface?:'framed'|'plain',hideLabel?:boolean,onChange:(value:FlowLiveDocValue)=>void,onBlur?:()=>void,onSync?:(state:{status:string,record?:object})=>void,onDispose?:()=>void,onReady?:(editor:{flush:()=>Promise<boolean>,isPending:()=>boolean})=>void}} p */
export const FlowLiveDoc = (p) => {
  const lang = flowLocale()
  return html`<section data-flow="live-doc-field">${p.hideLabel ? null : html`<span data-flow="field-label">${p.label}</span>`}<div data-flow="live-doc" data-live-key=${`${p.id}:${lang}:${!!p.readOnly}:${p.toolbar ?? 'top'}:${p.surface ?? 'framed'}${p.transport ? `:${p.transport.base}:${p.transport.docId}` : ''}`}
    on:flow-live-mount=${
      /** @param {CustomEvent} event */ (event) => {
        const target = /** @type {HTMLElement} */ (event.currentTarget)
        const editor = loadEditor().then(({ createLiveDocView }) =>
          createLiveDocView({
            docId: p.transport?.docId ?? p.id,
            base: p.transport?.base,
            lang,
            local: !p.transport,
            readOnly: p.readOnly,
            toolbar: p.toolbar,
            surface: p.surface,
            snapshot: p.snapshot,
            blocks: FlowLiveDocBlocks(p.blocks ?? [{ type: 'paragraph', text: p.text ?? '' }]),
            onChange: p.onChange,
            onSync: p.onSync,
          }),
        )
        const ready = editor.then((value) => {
          const dispose = value.dispose.bind(value)
          value.dispose = () => {
            p.onDispose?.()
            dispose()
          }
          p.onReady?.(value)
          return value
        })
        event.detail.mount(ready, target, p.label)
      }
    } on:focusout=${() => p.onBlur?.()}></div></section>`
}
