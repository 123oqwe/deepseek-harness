import { createHash } from 'node:crypto'

export interface WorktreeHandle {
  readonly id: string
  readonly path: string
  readonly branchName: string
  readonly agentId: string
  readonly createdAt: number
  readonly isolated: boolean
}

export class WorktreeProvider {
  private worktrees = new Map<string, WorktreeHandle>()

  create(agentId: string, basePath: string): WorktreeHandle {
    const id = `wt-${createHash('sha256').update(`${agentId}${Date.now()}`).digest('hex').slice(0, 12)}`
    const branchName = `agent-${agentId}-${id}`
    const handle: WorktreeHandle = {
      id, path: `${basePath}/${id}`, branchName, agentId,
      createdAt: Date.now(), isolated: true,
    }
    this.worktrees.set(id, handle)
    return handle
  }

  get(id: string): WorktreeHandle | undefined {
    return this.worktrees.get(id)
  }

  getByAgent(agentId: string): readonly WorktreeHandle[] {
    return Array.from(this.worktrees.values()).filter(w => w.agentId === agentId)
  }

  remove(id: string): { removed: boolean; reason: string } {
    const handle = this.worktrees.get(id)
    if (!handle) return { removed: false, reason: 'not found' }
    this.worktrees.delete(id)
    return { removed: true, reason: 'removed' }
  }

  checkConflict(path: string): { hasConflict: boolean; conflictingAgents: readonly string[] } {
    const conflicting = Array.from(this.worktrees.values())
      .filter(w => w.path === path)
      .map(w => w.agentId)
    return { hasConflict: conflicting.length > 1, conflictingAgents: conflicting }
  }

  list(): readonly WorktreeHandle[] {
    return Array.from(this.worktrees.values())
  }
}
