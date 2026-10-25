export const IMPORT_LIMITS = {
  bytes: 10 * 1024 * 1024,
  rows: 20_000,
  columns: 64,
  cell: 8_000,
  tags: 10,
  newTags: 20,
}
export const importFields = [
  'name',
  'phone',
  'email',
  'contactName',
  'description',
  'source',
  'medium',
  'campaign',
  'recordTags',
  'customerLabels',
  'ignore',
] as const
export type ImportField = (typeof importFields)[number]
export type ImportMapping = ImportField[]
export type ImportRules = {
  kind: 'lead' | 'opportunity'
  source: string
  medium: string
  campaign: string
  assignment: 'rules' | 'team' | 'person' | 'unassigned'
  teamId: string
  assigneeUserId: string
  duplicate: 'merge' | 'skip' | 'create'
  tags: string[]
  firstTask: boolean
  due: 'two-hours' | 'today' | 'tomorrow'
  tagValues: Record<string, string>
  customerLabelValues: Record<string, string>
}
export const defaultImportRules = (): ImportRules => ({
  kind: 'lead',
  source: '',
  medium: '',
  campaign: '',
  assignment: 'unassigned',
  teamId: '',
  assigneeUserId: '',
  duplicate: 'merge',
  tags: [],
  firstTask: false,
  due: 'tomorrow',
  tagValues: {},
  customerLabelValues: {},
})
export type ImportContact = {
  name: string
  contactName: string
  phone: string
  email: string
  description: string
  source: string
  medium: string
  campaign: string
  recordTags: string[]
  customerLabels: string[]
}
export class ImportFormatError extends Error {
  readonly code: string
  constructor(code: string) {
    super(code)
    this.code = code
  }
}
export const importNameKey = (value: unknown) =>
  String(value ?? '')
    .trim()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/gu, '')
    .replace(/đ/giu, 'd')
    .toLowerCase()
    .replace(/\s+/gu, ' ')
export const tagNames = (value: unknown) => [
  ...new Set(
    String(value ?? '')
      .split(/[,;|\r\n]/u)
      .map((s) => s.trim())
      .filter(Boolean),
  ),
]
const aliases: Record<string, ImportField> = {
  name: 'name',
  ten: 'name',
  'ho ten': 'name',
  'ho va ten': 'name',
  full_name: 'name',
  'full name': 'name',
  'ten khach hang': 'name',
  phone: 'phone',
  phone_number: 'phone',
  'so dien thoai': 'phone',
  'dien thoai': 'phone',
  sdt: 'phone',
  email: 'email',
  'e mail': 'email',
  'nguoi lien he': 'contactName',
  contactname: 'contactName',
  'ghi chu': 'description',
  description: 'description',
  note: 'description',
  'nhu cau': 'description',
  source: 'source',
  nguon: 'source',
  utm_source: 'source',
  campaign: 'campaign',
  'chien dich': 'campaign',
  campaign_name: 'campaign',
  utm_campaign: 'campaign',
  medium: 'medium',
  utm_medium: 'medium',
  tags: 'recordTags',
  nhan: 'recordTags',
  'quan tam': 'recordTags',
  'nhan ho so': 'recordTags',
  'nhan khach hang': 'customerLabels',
  'loai da': 'customerLabels',
}
export const guessImportMapping = (headers: string[]): ImportMapping => {
  const used = new Set<string>()
  return headers.map((header) => {
    const field = aliases[importNameKey(header)] ?? 'ignore'
    if (used.has(field) && field !== 'ignore') return 'ignore'
    used.add(field)
    return field
  })
}
