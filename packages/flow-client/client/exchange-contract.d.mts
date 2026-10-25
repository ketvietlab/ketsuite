export const exchangeSchema: 'flow.task-exchange'
export const exchangeVersion: 1
export const exchangeFields: readonly string[]
export function encodeExchange(rows: Record<string, unknown>[], format?: 'json' | 'csv'): string
export function decodeExchange(text: string, format?: 'json' | 'csv'): Record<string, unknown>[]
export function csvCells(text: string): string[][]

export function exchangeBatch(
  rows: Record<string, unknown>[],
  offset: number,
  maximumBytes?: number,
): Record<string, unknown>[]
