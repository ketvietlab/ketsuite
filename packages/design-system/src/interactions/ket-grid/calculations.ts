import type { KetGridRow } from './columns.ts'
import type { KetGridValue } from './values.ts'

export type GridProduct = {
  multiply: readonly string[]
  percentOff?: string
  less?: readonly string[]
  as?: 'percent'
  solve?: { field: string; digits?: number }
}
export type GridCompute = GridProduct | { difference: readonly [string, string] }
type Ratio = { n: bigint; d: bigint }
const one: Ratio = { n: 1n, d: 1n }
const zero: Ratio = { n: 0n, d: 1n }
const multiply = (a: Ratio, b: Ratio): Ratio => ({ n: a.n * b.n, d: a.d * b.d })
const add = (a: Ratio, b: Ratio): Ratio => ({ n: a.n * b.d + b.n * a.d, d: a.d * b.d })
const negate = (a: Ratio): Ratio => ({ n: -a.n, d: a.d })
const divide = (a: Ratio, b: Ratio): Ratio | null =>
  b.n === 0n ? null : { n: a.n * b.d * (b.n < 0n ? -1n : 1n), d: a.d * (b.n < 0n ? -b.n : b.n) }
const decimal = (value: unknown): Ratio | null => {
  if (typeof value !== 'string' && typeof value !== 'number') return null
  const text = String(value).trim()
  const match = /^([+-]?)(\d+)(?:\.(\d*))?(?:e([+-]?\d+))?$/iu.exec(text)
  if (!match || text.length > 90) return null
  const exponent = Number(match[4] ?? 0) - (match[3]?.length ?? 0)
  if (!Number.isInteger(exponent) || Math.abs(exponent) > 40) return null
  const n = BigInt(match[2]! + (match[3] ?? '')) * (match[1] === '-' ? -1n : 1n)
  return exponent >= 0 ? { n: n * 10n ** BigInt(exponent), d: 1n } : { n, d: 10n ** BigInt(-exponent) }
}
const product = (fields: readonly string[], row: KetGridRow): Ratio | null => {
  let result = one
  for (const field of fields) {
    const value = decimal(row[field])
    if (!value) return null
    result = multiply(result, value)
  }
  return result
}
const factor = (compute: GridProduct, row: KetGridRow): Ratio | null => {
  const off = decimal(compute.percentOff ? (row[compute.percentOff] ?? 0) : 0)
  if (!off || off.n < 0n || off.n > 100n * off.d) return null
  return add(one, negate(multiply(off, { n: 1n, d: 100n })))
}
const number = (value: Ratio | null): number | null => {
  if (!value) return null
  const result = Number(value.n) / Number(value.d)
  return Number.isFinite(result) && Math.abs(result) <= Number.MAX_SAFE_INTEGER
    ? Math.round(result * 1e6) / 1e6
    : null
}

/** Derived values never overwrite row data; optional products subtract their exact decimal cost. */
export const computedGridValue = (compute: GridCompute, row: KetGridRow): number | null => {
  if ('difference' in compute) {
    const [from, less] = compute.difference.map((field) => row[field])
    const a = from === null || from === undefined || from === '' ? Number.NaN : Number(from)
    const b = less === null || less === undefined || less === '' ? Number.NaN : Number(less)
    return Number.isFinite(a) && Number.isFinite(b) ? Math.round((a - b) * 1e6) / 1e6 : null
  }
  if (!compute.less && !compute.as && !compute.solve) {
    let value = 1
    for (const field of compute.multiply) {
      const amount = Number(row[field] ?? 0)
      value *= Number.isFinite(amount) ? amount : 0
    }
    const off = compute.percentOff ? Number(row[compute.percentOff] ?? 0) : 0
    return Math.round(value * (1 - (Number.isFinite(off) ? off : 0) / 100) * 1e6) / 1e6
  }
  const gross = product(compute.multiply, row),
    discount = factor(compute, row)
  const less = compute.less ? product(compute.less, row) : zero
  if (!gross || !discount || !less) return null
  const revenue = multiply(gross, discount),
    result = add(revenue, negate(less))
  return number(compute.as === 'percent' ? divide(multiply(result, { n: 100n, d: 1n }), revenue) : result)
}

export const canSolveGridValue = (compute: GridCompute, row: KetGridRow): boolean => {
  if (
    !('multiply' in compute) ||
    !compute.solve ||
    compute.multiply.filter((key) => key === compute.solve!.field).length !== 1
  )
    return false
  const multiplier = product(
    compute.multiply.filter((key) => key !== compute.solve!.field),
    row,
  )
  const discount = factor(compute, row),
    less = compute.less ? product(compute.less, row) : zero
  return !!multiplier && multiplier.n > 0n && !!discount && discount.n > 0n && !!less && less.n >= 0n
}

/** Solve a linear product using rational arithmetic, then round once to the target's decimal scale. */
export const solveGridValue = (
  compute: GridCompute,
  row: KetGridRow,
  value: KetGridValue,
  text: boolean,
): KetGridRow => {
  if (!('multiply' in compute) || !compute.solve || !canSolveGridValue(compute, row)) return row
  const wanted = decimal(value),
    less = compute.less ? product(compute.less, row)! : zero
  if (!wanted) return row
  let revenue: Ratio | null = add(wanted, less)
  if (compute.as === 'percent') {
    if (wanted.n >= 100n * wanted.d) return row
    revenue = divide(less, add(one, negate(multiply(wanted, { n: 1n, d: 100n }))))
    if (!revenue || revenue.n === 0n) return row
  }
  if (!revenue || revenue.n < 0n) return row
  const multiplier = product(
    compute.multiply.filter((key) => key !== compute.solve!.field),
    row,
  )!
  const solved = divide(revenue, multiply(multiplier, factor(compute, row)!))!
  const digits = compute.solve.digits ?? 6
  if (!Number.isInteger(digits) || digits < 0 || digits > 6) return row
  const scale = 10n ** BigInt(digits),
    numerator = solved.n * scale
  const rounded = numerator / solved.d + ((numerator % solved.d) * 2n >= solved.d ? 1n : 0n)
  if (rounded > BigInt(Number.MAX_SAFE_INTEGER)) return row
  const padded = rounded.toString().padStart(digits + 1, '0')
  const result = digits ? `${padded.slice(0, -digits)}.${padded.slice(-digits)}` : padded
  return { ...row, [compute.solve.field]: text ? result : Number(result) }
}
