// Compatibility exports for transactional consumers that still import this module path.
// The registry and every handler live in functions/; keep both import paths identical.
export { functions, saveTemplateFunction, describeVariants, attributeLinesOf } from './functions/index.ts'
