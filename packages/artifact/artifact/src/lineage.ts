import type { ArtifactLineageNode, ArtifactRecord } from './types.ts'

export class LineageGraph {
  private nodes = new Map<string, ArtifactLineageNode>()

  add(artifact: ArtifactRecord): void {
    const existing = this.nodes.get(artifact.id)
    const children = existing?.children ?? []
    this.nodes.set(artifact.id, {
      artifactId: artifact.id,
      parentId: artifact.parentArtifactId,
      children,
    })
    if (artifact.parentArtifactId) {
      const parent = this.nodes.get(artifact.parentArtifactId)
      if (parent) {
        this.nodes.set(artifact.parentArtifactId, {
          ...parent,
          children: [...parent.children, artifact.id],
        })
      }
    }
  }

  getLineage(artifactId: string): readonly ArtifactLineageNode[] {
    const result: ArtifactLineageNode[] = []
    const visited = new Set<string>()
    const traverse = (id: string) => {
      if (visited.has(id)) return
      visited.add(id)
      const node = this.nodes.get(id)
      if (node) {
        result.push(node)
        if (node.parentId) traverse(node.parentId)
      }
    }
    traverse(artifactId)
    return result.reverse()
  }

  getChildren(artifactId: string): readonly string[] {
    return this.nodes.get(artifactId)?.children ?? []
  }

  getParent(artifactId: string): string | undefined {
    return this.nodes.get(artifactId)?.parentId
  }

  isDescendant(artifactId: string, ancestorId: string): boolean {
    const lineage = this.getLineage(artifactId)
    return lineage.some(n => n.artifactId === ancestorId)
  }
}
