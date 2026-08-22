import { ResourceStore } from './resource-store.ts'
import type { ResourceSummary } from '@deepseek-ai/dsh-sdk-protocol/src/resources.ts'

export function createArtifactStore(): ResourceStore<ResourceSummary> {
  return new ResourceStore<ResourceSummary>()
}
