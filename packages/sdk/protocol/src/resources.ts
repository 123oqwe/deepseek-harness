export type ResourceType = 'run' | 'agent' | 'action' | 'approval' | 'artifact' | 'verification' | 'world'

export interface ResourceSummary {
  readonly id: string
  readonly type: ResourceType
  readonly tenantId: string
  readonly classification: string
  readonly revision: number
  readonly createdAt: string
  readonly updatedAt: string
  readonly provenance: string
  readonly allowedActions: readonly string[]
}

export interface ResourceDetail extends ResourceSummary {
  readonly data: unknown
}

export interface PaginationParams {
  readonly cursor?: string | undefined
  readonly limit?: number | undefined
  readonly filter?: Record<string, string> | undefined
}

export interface PaginatedResult<T extends ResourceSummary> {
  readonly items: readonly T[]
  readonly nextCursor: string | undefined
  readonly total: number
}

export interface ConcurrencyToken {
  readonly expectedRevision: number
}

export type WatchEvent<T extends ResourceSummary> =
  | { type: 'created'; resource: T }
  | { type: 'updated'; resource: T }
  | { type: 'deleted'; id: string }
