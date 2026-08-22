export interface FileDigest {
  readonly path: string
  readonly digest: string
}

export interface ProviderMetadata {
  readonly providerId: string
  readonly version: string
}

export interface SecretReference {
  readonly leaseId: string
  readonly secretName: string
}

export interface WorldSnapshot {
  readonly id: string
  readonly worldId: string
  readonly createdAt: number
  readonly consistent: boolean
  readonly fileDigests: readonly FileDigest[]
  readonly providers: readonly ProviderMetadata[]
  readonly secretRefs: readonly SecretReference[]
  readonly actionBoundary?: string | undefined
}

export interface RestoreResult {
  readonly newWorldId: string
  readonly verified: boolean
  readonly mismatches: readonly string[]
}

export interface RollbackEvent {
  readonly snapshotId: string
  readonly fromWorldId: string
  readonly toWorldId: string
  readonly at: number
}
