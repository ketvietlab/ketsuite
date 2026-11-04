/** Quantities and civil days on the forecast screens, as the reader writes them. */
export const quantityText = (lang: string, value: number) =>
  new Intl.NumberFormat(lang === 'en' ? 'en-US' : 'vi-VN', { maximumFractionDigits: 3 }).format(value)

export const dayText = (lang: string, day: string) =>
  day
    ? new Intl.DateTimeFormat(lang === 'en' ? 'en-US' : 'vi-VN', {
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
        timeZone: 'UTC',
      }).format(new Date(`${day}T00:00:00Z`))
    : ''

/** A product in a warehouse has one forecast page: `/admin/stock/forecast/<warehouse>/<product>`. */
export const forecastPagePath = (warehouseId: string, productId: string) =>
  `/admin/stock/forecast/${encodeURIComponent(warehouseId)}/${encodeURIComponent(productId)}`
