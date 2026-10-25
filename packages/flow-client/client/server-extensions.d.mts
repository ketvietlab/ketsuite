export type FlowServerMutation = {
  name: string
  capability: string
  input: Record<string, unknown>
}
export type FlowServerExtension<Context> = {
  name: string
  commands?: Record<
    string,
    { capability: string; run: (context: Context, input: Record<string, unknown>) => Promise<unknown> }
  >
  beforeMutation?: (context: Context, mutation: FlowServerMutation) => Promise<void>
  afterMutation?: (context: Context, mutation: FlowServerMutation, value: unknown) => Promise<void>
  dispose?: () => void | Promise<void>
}
export type FlowServerContext<Context> = {
  requireCapability: (capability: string, input: Record<string, unknown>) => Promise<unknown>
  transaction: <Result>(work: (context: Context) => Promise<Result>) => Promise<Result>
}
export function createFlowServerExtensions<Context>(extensions?: FlowServerExtension<Context>[]): {
  mutate<Result>(
    context: FlowServerContext<Context>,
    mutation: FlowServerMutation,
    write: (context: Context) => Promise<Result>,
  ): Promise<Result>
  dispatch(
    context: FlowServerContext<Context>,
    name: string,
    input: Record<string, unknown>,
  ): Promise<{ handled: boolean; value?: unknown }>
  dispose(): Promise<void>
}
