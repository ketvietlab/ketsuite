import type { TestClient, TestDeployment } from '@ketvietlab/ketjs/testing'
export function countFixture(port?: number): Promise<{
  app: TestDeployment
  clients: Map<string, TestClient>
  productId: string
  url: string
  close(): Promise<void>
}>
