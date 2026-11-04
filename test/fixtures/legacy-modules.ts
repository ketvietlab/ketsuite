import type { KetModule } from '@ketvietlab/ketjs'

type Effects = { effects?: string[] }

/**
 * Modules as an older release declared them, for a migration test: today's functions and jobs keep their
 * effects but for reads and writes of a model of an included module that the old release did not have yet,
 * which KetJS refuses to compose.
 */
export const legacyModules = <M extends KetModule | string>(modules: M[]): M[] => {
  const declared = modules.filter((module): module is Exclude<M, string> => typeof module !== 'string')
  const owners = new Set(declared.map((module) => module.name))
  const models = new Set(
    declared.flatMap((module) => Object.keys(module.models ?? {}).map((model) => `${module.name}.${model}`)),
  )
  const kept = (effect: string) => {
    const target = /^(?:read|write):(.+)$/.exec(effect)?.[1]
    return !target || models.has(target) || !owners.has(target.slice(0, target.indexOf('.')))
  }
  const trim = <D extends Effects>(definitions: Record<string, D> | undefined) =>
    definitions &&
    Object.fromEntries(
      Object.entries(definitions).map(([key, definition]) => [
        key,
        definition.effects ? { ...definition, effects: definition.effects.filter(kept) } : definition,
      ]),
    )
  return modules.map((module) => {
    if (typeof module === 'string') return module
    const declaredModule = module as KetModule
    return {
      ...declaredModule,
      functions: trim(declaredModule.functions as Record<string, Effects>),
      jobs: trim(declaredModule.jobs as Record<string, Effects>),
    }
  }) as M[]
}
