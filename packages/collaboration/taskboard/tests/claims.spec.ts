import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import {
  createTask, claimTask, completeTask, getTask, getTasksByRun,
  sendMessage, readMessages, getUnreadCount,
  writeBlackboard, readBlackboard, getBlackboardVersion,
  clearAll,
} from '../src/index.ts'

describe('P5-11 Taskboard/Mailbox/Blackboard', () => {
  beforeEach(() => clearAll())
  afterEach(() => clearAll())

  describe('Taskboard', () => {
    it('creates a task', () => {
      const task = createTask('run-1', 'Write tests')
      expect(task.state).toBe('queued')
      expect(task.title).toBe('Write tests')
    })

    it('claims a task', () => {
      const task = createTask('run-1', 'Task A')
      const claimed = claimTask(task.id, 'worker-1')
      expect(claimed.state).toBe('claimed')
      expect(claimed.claimedBy).toBe('worker-1')
    })

    it('rejects claim when dependency not completed', () => {
      const dep = createTask('run-1', 'Dep')
      const task = createTask('run-1', 'Main', [dep.id])
      expect(() => claimTask(task.id, 'worker')).toThrow('Dependency')
    })

    it('completes a task', () => {
      const task = createTask('run-1', 'Task')
      claimTask(task.id, 'w')
      const completed = completeTask(task.id, { result: 'done' })
      expect(completed.state).toBe('completed')
      expect(completed.result).toEqual({ result: 'done' })
    })
  })

  describe('Mailbox', () => {
    it('sends and reads messages', () => {
      sendMessage('agent-2', 'agent-1', 'run-1', 'Hello', { text: 'hi' })
      expect(getUnreadCount('agent-2')).toBe(1)
      const msgs = readMessages('agent-2')
      expect(msgs).toHaveLength(1)
      expect(msgs[0]!.subject).toBe('Hello')
      expect(getUnreadCount('agent-2')).toBe(0)
    })
  })

  describe('Blackboard', () => {
    it('writes and reads entries', () => {
      writeBlackboard('run-1', 'plan', { steps: 3 }, 'agent-1')
      const entry = readBlackboard('run-1', 'plan')
      expect(entry).toBeDefined()
      expect(entry!.value).toEqual({ steps: 3 })
    })

    it('increments version on overwrite', () => {
      writeBlackboard('run-1', 'plan', { v: 1 }, 'agent-1')
      writeBlackboard('run-1', 'plan', { v: 2 }, 'agent-2')
      expect(getBlackboardVersion('run-1', 'plan')).toBe(2)
    })
  })
})
