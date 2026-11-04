import { dateTimeFormatter } from '@ketvietlab/ketjs'
export { formatMoney } from './money-format.ts'

const localeCode = (value: string): string => (value === 'qps' ? 'en' : value || 'vi')

/** Format one instant through the shared ECMA-402 formatter cache. */
export const formatDateTime = (
  locale: string,
  value: Date | number,
  options: Intl.DateTimeFormatOptions = {},
): string => dateTimeFormatter(localeCode(locale), options).format(value)
