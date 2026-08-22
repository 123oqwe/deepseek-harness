export interface ArtifactRecord {
  readonly id: string
  readonly contentDigest: string
  readonly mimeType: string
  readonly size: number
  readonly tenantId: string
  readonly runId: string
  readonly createdAt: number
  readonly tags: readonly string[]
  readonly version: number
  readonly parentArtifactId?: string | undefined
}

export interface ArtifactLineageNode {
  readonly artifactId: string
  readonly parentId?: string | undefined
  readonly children: readonly string[]
}

export interface ArtifactVersion {
  readonly version: number
  readonly digest: string
  readonly createdAt: number
  readonly createdBy: string
}
