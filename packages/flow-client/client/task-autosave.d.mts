export function createTaskAutosave(options: {
  save: (id: string, patch: Record<string, unknown>, expectedVersion?: number) => Promise<unknown>
  version?: (id: string) => number | undefined
  onChange?: () => void
}): {
  edit(id: string, patch: Record<string, unknown>, options?: { delay?: number }): void
  draft(id: string): Record<string, unknown>
  state(id: string): 'error' | 'saving' | 'pending' | 'saved'
  flush(id: string): Promise<void>
  retry(id: string): Promise<void>
  flushAll(): Promise<void>
  dispose(): void
}
