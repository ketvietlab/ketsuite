import { Menu } from '@ketvietlab/design-system'
import { recordModalHref } from '../../../ui/record-modal.tsx'
import { filterWords } from './words.ts'
import type { SavedFilter } from './state.ts'
export function savedFilterMenu(href: string, rows: SavedFilter[], language: string) {
  const lang = language === 'en' ? 'en' : 'vi',
    w = filterWords[lang]
  const active = rows.find((row) => row.active && row.owned) ?? rows.find((row) => row.active)
  const modal = (id: string) => recordModalHref(href, { kind: 'product.savedFilter', id })
  const current = new URL(href, 'http://ket.local')
  const localized = (target: string) => {
    const url = new URL(target, 'http://ket.local')
    for (const key of ['company', 'branch', 'timezone', 'view']) {
      const value = current.searchParams.get(key)
      if (value) url.searchParams.set(key, value)
    }
    url.searchParams.set('lang', lang)
    return url.pathname + url.search
  }
  return Menu({
    id: 'product-saved-filters',
    label: active ? `${w.saved}: ${active.name}` : w.saved,
    size: 'compact',
    items: [
      ...rows.map((row) => ({
        id: row.id,
        label: `${row.name}${row.shared ? ` · ${w.sharedLabel}` : ''}`,
        href: localized(row.href),
        checked: row.active,
      })),
      { id: 'save-current', label: w.saveCurrent, href: modal('new') },
      // Offered while the list matches one of the viewer's own filters, under that filter's name (P56).
      ...(active?.owned
        ? [{ id: 'edit-filter', label: w.editNamed.replace('{name}', active.name), href: modal(active.id) }]
        : []),
    ],
  })
}
