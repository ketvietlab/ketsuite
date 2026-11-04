/**
 * An amount written out, as a voucher's "Tổng số tiền (viết bằng chữ)" line reads it.
 *
 * Works on the decimal text the books keep, never a JavaScript Number, so a large
 * amount reads exactly. Vietnamese follows the spoken forms a voucher uses: "linh"
 * for an empty tens place, "mốt", "tư" and "lăm" after a tens digit, and every
 * place inside a larger number ("một nghìn không trăm linh năm").
 */
const viDigits = ['không', 'một', 'hai', 'ba', 'bốn', 'năm', 'sáu', 'bảy', 'tám', 'chín']

const viTriple = (value: number, inner: boolean): string => {
  const hundreds = Math.floor(value / 100)
  const tens = Math.floor(value / 10) % 10
  const units = value % 10
  const words: string[] = []
  if (hundreds || inner) words.push(viDigits[hundreds]!, 'trăm')
  if (tens === 0) {
    if (units && (hundreds || inner)) words.push('linh')
  } else words.push(...(tens === 1 ? ['mười'] : [viDigits[tens]!, 'mươi']))
  if (units)
    words.push(
      units === 1 && tens > 1
        ? 'mốt'
        : units === 5 && tens
          ? 'lăm'
          : units === 4 && tens > 1
            ? 'tư'
            : viDigits[units]!,
    )
  return words.join(' ')
}

const enSmall =
  'zero one two three four five six seven eight nine ten eleven twelve thirteen fourteen fifteen sixteen seventeen eighteen nineteen'.split(
    ' ',
  )
const enTens = ['', '', 'twenty', 'thirty', 'forty', 'fifty', 'sixty', 'seventy', 'eighty', 'ninety']
const enTriple = (value: number): string => {
  const hundreds = Math.floor(value / 100)
  const rest = value % 100
  const words = hundreds ? [enSmall[hundreds]!, 'hundred'] : []
  if (rest)
    words.push(
      rest < 20
        ? enSmall[rest]!
        : `${enTens[Math.floor(rest / 10)]}${rest % 10 ? `-${enSmall[rest % 10]}` : ''}`,
    )
  return words.join(' ')
}

/** The whole part of a decimal text in words; the sign and fraction are not read. */
export const numberWords = (value: unknown, locale = 'vi'): string => {
  const digits = String(value ?? '0')
    .trim()
    .replace(/^-/, '')
    .split('.')[0]
  let rest = /^\d+$/.test(digits ?? '') ? BigInt(digits!) : 0n
  if (rest === 0n) return locale === 'en' ? 'zero' : 'không'
  const groups: number[] = []
  while (rest > 0n) {
    groups.push(Number(rest % 1000n))
    rest /= 1000n
  }
  const scales =
    locale === 'en'
      ? ['', 'thousand', 'million', 'billion', 'trillion', 'quadrillion']
      : ['', 'nghìn', 'triệu', 'tỷ', 'nghìn tỷ', 'triệu tỷ', 'tỷ tỷ']
  const words: string[] = []
  for (let index = groups.length - 1; index >= 0; index--) {
    if (!groups[index]) continue
    const inner = index < groups.length - 1
    words.push(
      locale === 'en' ? enTriple(groups[index]!) : viTriple(groups[index]!, inner),
      scales[index] ?? '',
    )
  }
  return words.filter(Boolean).join(' ')
}

const currencyWords: Record<string, [string, string]> = {
  VND: ['đồng', 'dong'],
  USD: ['đô la Mỹ', 'US dollars'],
}

/** "Một triệu hai trăm nghìn đồng"; a currency without words reads by its code. */
export const amountWords = (value: unknown, locale = 'vi', currency = 'VND'): string => {
  const [whole = '0', fraction = ''] = String(value ?? '0')
    .trim()
    .replace(/^-/, '')
    .split('.')
  const [vi, en] = currencyWords[currency] ?? [currency, currency]
  const cents = fraction ? Number(fraction.padEnd(2, '0').slice(0, 2)) : 0
  const text = `${numberWords(whole, locale)} ${locale === 'en' ? en : vi}${
    cents
      ? locale === 'en'
        ? ` and ${numberWords(cents, 'en')} cents`
        : ` ${numberWords(cents, 'vi')} xu`
      : ''
  }`
  return `${text[0]!.toUpperCase()}${text.slice(1)}`
}
