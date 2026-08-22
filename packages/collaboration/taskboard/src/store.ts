import { randomUUID } from 'node:crypto'
import type { Task, TaskState, MailboxMessage, BlackboardEntry } from './types.ts'

const tasks = new Map<string, Task>()
const mailboxes = new Map<string, MailboxMessage[]>()
const blackboards = new Map<string, Map<string, BlackboardEntry>>()

export function createTask(runId: string, title: string, dependencies: string[] = []): Task {
  const task: Task = { id: randomUUID(), runId, title, state: 'queued', dependencies, createdAt: new Date().toISOString() }
  tasks.set(task.id, task)
  return task
}

export function claimTask(taskId: string, workerId: string): Task {
  const task = tasks.get(taskId)
  if (!task) throw new Error(`Task not found: ${taskId}`)
  if (task.state !== 'queued') throw new Error(`Task ${taskId} is ${task.state}, cannot claim`)
  for (const dep of task.dependencies) {
    const depTask = tasks.get(dep)
    if (depTask && depTask.state !== 'completed') {
      throw new Error(`Dependency ${dep} not completed`)
    }
  }
  const claimed: Task = { ...task, state: 'claimed', claimedBy: workerId, claimedAt: new Date().toISOString() }
  tasks.set(taskId, claimed)
  return claimed
}

export function completeTask(taskId: string, result: unknown): Task {
  const task = tasks.get(taskId)
  if (!task) throw new Error(`Task not found: ${taskId}`)
  const completed: Task = { ...task, state: 'completed', completedAt: new Date().toISOString(), result }
  tasks.set(taskId, completed)
  return completed
}

export function getTask(id: string): Task | undefined { return tasks.get(id) }
export function getTasksByRun(runId: string): Task[] { return Array.from(tasks.values()).filter(t => t.runId === runId) }

export function sendMessage(to: string, from: string, runId: string, subject: string, body: unknown): MailboxMessage {
  const msg: MailboxMessage = { id: randomUUID(), runId, from, to, subject, body, sentAt: new Date().toISOString() }
  const box = mailboxes.get(to) ?? []
  box.push(msg)
  mailboxes.set(to, box)
  return msg
}

export function readMessages(recipient: string): MailboxMessage[] {
  const box = mailboxes.get(recipient) ?? []
  const unread = box.filter(m => !m.readAt)
  for (const msg of unread) {
    msg.readAt = new Date().toISOString()
  }
  return box
}

export function getUnreadCount(recipient: string): number {
  return (mailboxes.get(recipient) ?? []).filter(m => !m.readAt).length
}

export function writeBlackboard(runId: string, key: string, value: unknown, writer: string): BlackboardEntry {
  const board = blackboards.get(runId) ?? new Map()
  const existing = board.get(key)
  const entry: BlackboardEntry = { key, runId, value, writtenBy: writer, writtenAt: new Date().toISOString(), version: (existing?.version ?? 0) + 1 }
  board.set(key, entry)
  blackboards.set(runId, board)
  return entry
}

export function readBlackboard(runId: string, key: string): BlackboardEntry | undefined {
  return blackboards.get(runId)?.get(key)
}

export function getBlackboardVersion(runId: string, key: string): number {
  return blackboards.get(runId)?.get(key)?.version ?? 0
}

export function clearAll(): void {
  tasks.clear()
  mailboxes.clear()
  blackboards.clear()
}
