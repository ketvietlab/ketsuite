import type { IslandController, TemplateResult, Markup } from '@ketvietlab/ketjs-view'
export type FlowWorkspaceProps = Record<string, unknown>
export type FlowWorkspaceController = IslandController<FlowWorkspaceProps> & {
  shellView(content: TemplateResult | Markup): TemplateResult
  fragmentSlots(content: TemplateResult | Markup): Record<string, () => TemplateResult>
  dispose(): void
}
/** Typed host boundary; the retained JavaScript application is runtime tested. */
export function createFlowWorkspace(
  props?: FlowWorkspaceProps,
  dependencies?: Record<string, unknown>,
): FlowWorkspaceController
export const routes: Record<string, { title: string; group: string; pattern: string }>
