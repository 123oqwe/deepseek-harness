import type { TaskItem, ScheduledTask } from './types.ts'

export class TaskQueue {
  private items: TaskItem[] = []

  enqueue(task: TaskItem): void {
    this.items.push(task)
    // Sort by priority (higher first), then by enqueue order (FIFO for same priority)
    this.items.sort((a, b) => {
      if (b.priority !== a.priority) return b.priority - a.priority
      return 0 // stable sort preserves insertion order
    })
  }

  dequeue(): TaskItem | undefined {
    return this.items.shift()
  }

  peek(): TaskItem | undefined {
    return this.items[0]
  }

  get length(): number {
    return this.items.length
  }

  remove(taskId: string): boolean {
    const idx = this.items.findIndex(t => t.id === taskId)
    if (idx >= 0) {
      this.items.splice(idx, 1)
      return true
    }
    return false
  }

  toScheduledTasks(): ScheduledTask[] {
    return this.items.map((task, i) => ({
      task,
      scheduledAt: Date.now(),
      queuePosition: i,
    }))
  }
}
