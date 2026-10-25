/** Share URL parsing between SSR props and client history without importing server code. */
export function requestedPage(value: string | null): number {
  const page = Number(value)
  return Number.isSafeInteger(page) && page > 0 ? page : 1
}
