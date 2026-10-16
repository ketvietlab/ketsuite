import { defineIsland } from '@ketvietlab/ketjs-view'
import { ImportBatch } from './screens/import-batch.tsx'
import { ImportBatches } from './screens/import-batches.tsx'
import { ImportRecords } from './screens/import-records.tsx'
import { ImportTags } from './screens/import-tags.tsx'
import { ImportWizard } from './screens/import-wizard.tsx'
import type { ImportVm } from './screens/import-ui.tsx'

/** Pure native presenters; forms keep their server-owned DOM and draft values. */
export function importPresentation(vm: ImportVm) {
  switch (vm.screen) {
    case 'wizard':
      return ImportWizard(vm)
    case 'batch':
      return ImportBatch(vm)
    case 'tags':
      return ImportTags(vm)
    case 'records':
      return ImportRecords(vm)
    default:
      return ImportBatches(vm)
  }
}

/** A disposable progressive-enhancement island, never a second copy of a form. */
export const importScreen = (props: { model: ImportVm }) => {
  const model = props.model
  return {
    view: () => <></>,
    mount({ root, lifetime }: { root: unknown; lifetime: AbortSignal }) {
      const element = (root as HTMLElement).closest<HTMLElement>('[data-crm-import-root]')!
      if (!element) return
      const toggle = (selector: string, visible: boolean) => {
        const group = element.querySelector<HTMLElement>(selector)
        if (!group) return
        group.hidden = !visible
        group.querySelectorAll<HTMLInputElement | HTMLSelectElement>('input,select').forEach((control) => {
          control.disabled = !visible
        })
      }
      element.addEventListener(
        'change',
        (event) => {
          const control = event.target as HTMLInputElement
          if (control.name === 'assignment') {
            toggle('[data-import-reveal="team"]', control.value === 'team')
            toggle('[data-import-reveal="person"]', control.value === 'person')
          }
          if (control.name === 'firstTask') toggle('[data-import-reveal="due"]', control.checked)
        },
        { signal: lifetime },
      )
      element.addEventListener(
        'submit',
        (event) => {
          const form = event.target as HTMLFormElement
          if (form.id !== 'record-tags-bulk') return
          const query = form.elements.namedItem('query') as HTMLInputElement | null
          if (query) query.value = new URL(location.href).searchParams.toString()
        },
        { signal: lifetime },
      )
      let timer = 0
      const poll = async () => {
        const vm = model
        if (
          lifetime.aborted ||
          vm.screen !== 'batch' ||
          (vm.data.batch as { state?: string } | undefined)?.state !== 'running'
        )
          return
        try {
          const response = await fetch(`${vm.base}/status?lang=${vm.lang}`, {
            signal: lifetime,
            credentials: 'same-origin',
            headers: { accept: 'application/json' },
          })
          if (response.ok) {
            const data = (await response.json()) as { batch: ImportVm['data']['batch']; clock: number }
            const batch = data.batch as { version?: number; state?: string }
            const current = vm.data.batch as { version?: number }
            // Server-rendered native controls retain user edits until navigation.
            // Never refresh while someone is editing a filter or form control.
            if (
              batch?.version !== current.version &&
              !element.contains(document.activeElement?.closest('input,select,textarea') || null)
            ) {
              location.reload()
              return
            }
          }
        } catch {
          /* Keep the last confirmed progress. Resume remains a native command. */
        }
        if (!lifetime.aborted) timer = window.setTimeout(poll, 2500)
      }
      timer = window.setTimeout(poll, 2500)
      lifetime.addEventListener('abort', () => window.clearTimeout(timer), { once: true })
    },
  }
}

export const importIsland = defineIsland<{ model: ImportVm }>()({
  props: { model: 'json' },
  client: 'crm-import.mjs',
  export: 'importScreen',
  view: importScreen,
})

export { collectionPart } from './import-collection.tsx'
