import { ResourceStore } from './resource-store.ts'
import type { ResourceSummary } from '@deepseek-ai/dsh-sdk-protocol/src/resources.ts'

export function createActionStore(): ResourceStore<ResourceSummary> {
  return new ResourceStore<ResourceSummary>()
}
