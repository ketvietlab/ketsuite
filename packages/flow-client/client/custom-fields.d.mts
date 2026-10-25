export type FlowCustomField = {
  id: string
  title: string
  kind?: string
  projectId?: string | null
  appliesTo?: string
  archived?: boolean
  required?: boolean
  options?: string[]
}
/** Shared validation used by the client, fixture and typed server boundary. */
export function validateCustomFields(
  fields: FlowCustomField[],
  values: Record<string, unknown> | null | undefined,
  projectId: string,
  requireAll?: boolean,
): string | null
