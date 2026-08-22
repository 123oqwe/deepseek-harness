import type { ResourceLock } from './types.ts'

export class ResourceLockManager {
  private locks = new Map<string, ResourceLock>()
  private sharedCounts = new Map<string, number>()

  acquire(resource: string, taskId: string, exclusive: boolean, now: number): { acquired: boolean; reason: string } {
    const existing = this.locks.get(resource)
    if (existing) {
      if (existing.exclusive) {
        return { acquired: false, reason: `Resource ${resource} is exclusively locked by ${existing.heldBy}` }
      }
      if (exclusive) {
        return { acquired: false, reason: `Cannot acquire exclusive lock on shared resource ${resource}` }
      }
      // Shared lock on already-shared resource
      const count = this.sharedCounts.get(resource) ?? 0
      this.sharedCounts.set(resource, count + 1)
      this.locks.set(resource, { resource, heldBy: taskId, acquiredAt: now, exclusive: false })
      return { acquired: true, reason: 'shared lock acquired' }
    }
    // No existing lock
    this.locks.set(resource, { resource, heldBy: taskId, acquiredAt: now, exclusive })
    if (!exclusive) {
      this.sharedCounts.set(resource, 1)
    }
    return { acquired: true, reason: exclusive ? 'exclusive lock acquired' : 'shared lock acquired' }
  }

  release(resource: string, taskId: string): { released: boolean; reason: string } {
    const lock = this.locks.get(resource)
    if (!lock) return { released: false, reason: 'no lock found' }
    if (lock.heldBy !== taskId && lock.exclusive) {
      return { released: false, reason: 'not the lock holder' }
    }
    if (!lock.exclusive) {
      const count = this.sharedCounts.get(resource) ?? 0
      if (count > 1) {
        this.sharedCounts.set(resource, count - 1)
        return { released: true, reason: 'shared lock decremented' }
      }
      this.sharedCounts.delete(resource)
    }
    this.locks.delete(resource)
    return { released: true, reason: 'lock released' }
  }

  releaseAll(taskId: string): string[] {
    const released: string[] = []
    for (const [resource, lock] of this.locks) {
      if (lock.heldBy === taskId) {
        this.locks.delete(resource)
        this.sharedCounts.delete(resource)
        released.push(resource)
      }
    }
    return released
  }

  isLocked(resource: string): boolean {
    return this.locks.has(resource)
  }

  getHolders(resource: string): readonly string[] {
    const lock = this.locks.get(resource)
    return lock ? [lock.heldBy] : []
  }
}
