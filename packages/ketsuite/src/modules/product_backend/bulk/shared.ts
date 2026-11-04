import type { FieldOption } from '@ketvietlab/design-system'
export type BulkModalData = {
  id: string
  lang: 'vi' | 'en'
  products: Array<{ id: string; revision: string; name: string }>
  fields: FieldOption[]
  choices: Record<string, FieldOption[]>
}
