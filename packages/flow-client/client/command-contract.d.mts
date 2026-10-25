// Typed host boundary for the existing JavaScript compatibility adapter.
export type FlowCommandInput = Record<string, unknown>
export type FlowResolvedCommand = { name: string; input: FlowCommandInput }
export function prepareFlowCommand(
  name: string,
  input: FlowCommandInput,
  data: FlowCommandInput,
): FlowCommandInput
export function resolveFlowCommand(name: string, input?: FlowCommandInput): FlowResolvedCommand
export function atlasFlowCommand(
  name: string,
  input: FlowCommandInput,
  data?: FlowCommandInput,
): FlowResolvedCommand
