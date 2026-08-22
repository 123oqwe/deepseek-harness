import type { ContextNode, ContextEdge } from './types.ts'

export type { ContextNode, ContextEdge } from './types.ts'

export class ContextGraph {
  private nodes = new Map<string, ContextNode>()
  private edges: ContextEdge[] = []

  addNode(node: ContextNode): void {
    this.nodes.set(node.id, node)
    for (const parentId of node.parentIds) {
      this.edges.push({ from: parentId, to: node.id, relation: 'replies-to' })
    }
  }

  addEdge(edge: ContextEdge): void {
    this.edges.push(edge)
  }

  getNode(id: string): ContextNode | undefined {
    return this.nodes.get(id)
  }

  getAncestors(id: string): readonly ContextNode[] {
    const result: ContextNode[] = []
    const visited = new Set<string>()
    const traverse = (nodeId: string) => {
      if (visited.has(nodeId)) return
      visited.add(nodeId)
      const node = this.nodes.get(nodeId)
      if (node) {
        for (const parentId of node.parentIds) {
          const parent = this.nodes.get(parentId)
          if (parent) {
            result.push(parent)
            traverse(parentId)
          }
        }
      }
    }
    traverse(id)
    return result
  }

  getDescendants(id: string): readonly string[] {
    const result: string[] = []
    for (const edge of this.edges) {
      if (edge.from === id) {
        result.push(edge.to)
        result.push(...this.getDescendants(edge.to))
      }
    }
    return [...new Set(result)]
  }

  getByRun(runId: string): readonly ContextNode[] {
    return Array.from(this.nodes.values()).filter(n => n.runId === runId)
  }

  getByType(type: ContextNode['type']): readonly ContextNode[] {
    return Array.from(this.nodes.values()).filter(n => n.type === type)
  }

  getNodes(): readonly ContextNode[] {
    return Array.from(this.nodes.values())
  }

  size(): number {
    return this.nodes.size
  }
}
