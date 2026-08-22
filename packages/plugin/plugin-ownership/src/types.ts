import type { Branded } from '@deepseek-ai/dsh-brand'

export type Namespace = Branded<'Namespace'>
export type OwnershipToken = Branded<'OwnershipToken'>

export interface PluginIdentity {
  readonly id: string
  readonly namespace: string
  readonly version: string
  readonly ownershipToken: OwnershipToken
}

export interface NamespaceRegistration {
  readonly namespace: string
  readonly pluginId: string
  readonly ownershipToken: OwnershipToken
  readonly isOfficial: boolean
  readonly capabilities: string[]
}

export interface OwnershipConflict {
  readonly type: 'namespace_collision' | 'capability_collision' | 'unauthorized_official' | 'unauthorized_replace'
  readonly namespace: string
  readonly existingPlugin: string
  readonly conflictingPlugin: string
  readonly message: string
}

export class NamespaceConflictError extends Error {
  readonly conflicts: OwnershipConflict[]
  constructor(conflicts: OwnershipConflict[]) {
    super(`Namespace conflicts detected:\n${conflicts.map(c => `  - ${c.message}`).join('\n')}`)
    this.name = 'NamespaceConflictError'
    this.conflicts = conflicts
  }
}
