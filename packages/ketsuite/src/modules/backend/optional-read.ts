import type { Route, ServeContext } from '@ketvietlab/ketjs'

/**
 * Optional enrichment must not turn a permitted collection into a denied request. A function the
 * deployment does not compose reads as the fallback too: a superuser is allowed every name, so
 * `allows` alone would call a module that is not there.
 */
export async function optionalRead<T>(
  ctx: ServeContext,
  fn: string,
  input: Record<string, unknown>,
  url: URL,
  req: Parameters<Route>[1],
  fallback: T,
): Promise<T> {
  if (!ctx.manifest.functions?.[fn] || !(await ctx.allows(fn, url, req))) return fallback
  return ctx.call(fn, input, url, req) as Promise<T>
}
