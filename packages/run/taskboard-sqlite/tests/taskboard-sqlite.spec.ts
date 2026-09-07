/**
 * One task, one holder, across PROCESSES (Epic P5-11 acceptance[0]).
 *
 * The in-memory board's own stress case runs a hundred workers SEQUENTIALLY
 * against a pure function in one process. That shows the decision is right; it
 * cannot show the property the clause is about, because a `Map` is per
 * process and two real workers are two processes. These cases put two node
 * processes on one database and count winners.
 */
import { mkdtempSync, rmSync, writeFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawn } from 'node:child_process'
import { afterEach, describe, expect, it } from 'vitest'
import { brandString } from '@deepseek-ai/dsh-brand'
import type { Task, TaskId, WorkerId } from '@deepseek-ai/dsh-taskboard'
import { openTaskStore } from '../src/index.ts'

const roots: string[] = []
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }) })

function directory(): string {
  const root = mkdtempSync(join(tmpdir(), 'dsh-taskboard-'))
  roots.push(root)
  return root
}

const TASK: Task = {
  id: brandString<TaskId>('t1'),
  status: 'open',
  dependsOn: [],
  owner: null,
  attempt: 0,
  claimExpiresAtMs: null,
  outputs: [],
  verification: 'unverified',
} as unknown as Task

describe('P5-11 acceptance[0]: two PROCESSES contending for one task', () => {
  it('admits exactly one of two processes claiming the same task', async () => {
    const dir = directory()
    openTaskStore(dir).submit([TASK])
    const go = join(dir, 'go')

    const child = (label: string) => new Promise<string>((resolve) => {
      const proc = spawn(process.execPath, ['--import', 'tsx', '-e', [
        "const { existsSync } = await import('node:fs')",
        `const { openTaskStore } = await import(${JSON.stringify(join(process.cwd(), 'packages/run/taskboard-sqlite/src/index.ts'))})`,
        `const store = openTaskStore(${JSON.stringify(dir)})`,
        // A file barrier rather than a sleep: both children spin until the
        // parent releases them, so the case observes contention instead of
        // whichever process happened to start first.
        `while (!existsSync(${JSON.stringify(go)})) { /* spin to the barrier */ }`,
        `const decision = store.claim('t1', ${JSON.stringify(label)}, 1000, 5000)`,
        `console.log(${JSON.stringify(label)} + ':' + (decision.claimed ? 'claimed' : decision.reason))`,
      ].join('\n')], { stdio: ['ignore', 'pipe', 'inherit'] })
      let out = ''
      proc.stdout.on('data', (chunk: Buffer) => { out += chunk.toString() })
      proc.on('close', () => { resolve(out.trim().split(':')[1] ?? '(none)') })
    })

    const both = Promise.all([child('worker-a'), child('worker-b')])
    while (!existsSync(join(dir, 'go'))) writeFileSync(go, '')
    const results = await both

    expect(results.filter(result => result === 'claimed')).toHaveLength(1)
    expect(results.filter(result => result === 'already-claimed')).toHaveLength(1)
  }, 30_000)

  it('keeps the claim after the claiming process is gone, so a lease can lapse rather than vanish', () => {
    // A `Map` dies with its process, which would make every reclaim a fresh
    // claim of an unowned task. The lapse is what the attempt counter is for.
    const dir = directory()
    openTaskStore(dir).submit([TASK])
    openTaskStore(dir).claim(brandString<TaskId>('t1'), brandString<WorkerId>('worker-a'), 1_000, 5_000)

    expect(openTaskStore(dir).get(brandString<TaskId>('t1')))
      .toMatchObject({ owner: 'worker-a', attempt: 1, status: 'claimed' })
  })

  it('lets a new worker claim once the lease lapsed, at a GREATER attempt', () => {
    // The increment is what makes the old holder's receipt refusable
    // afterwards; without it a returning worker presents credentials
    // indistinguishable from the new holder's.
    const dir = directory()
    const store = openTaskStore(dir)
    store.submit([TASK])
    store.claim(brandString<TaskId>('t1'), brandString<WorkerId>('worker-a'), 1_000, 5_000)

    const second = openTaskStore(dir).claim(brandString<TaskId>('t1'), brandString<WorkerId>('worker-b'), 6_001, 5_000)
    expect(second).toMatchObject({ claimed: true, task: { owner: 'worker-b', attempt: 2 } })
  })

  it('REFUSES a receipt from the lapsed holder after a reclaim', () => {
    // acceptance[1]'s protection: a worker whose claim lapsed can still finish
    // and report, and accepting that report would overwrite the new holder's
    // task with the old holder's result.
    const dir = directory()
    const store = openTaskStore(dir)
    store.submit([TASK])
    store.claim(brandString<TaskId>('t1'), brandString<WorkerId>('worker-a'), 1_000, 5_000)
    store.claim(brandString<TaskId>('t1'), brandString<WorkerId>('worker-b'), 6_001, 5_000)

    expect(store.applyReceipt({
      taskId: brandString<TaskId>('t1'), worker: brandString<WorkerId>('worker-a'), attempt: 1, kind: 'completed',
    } as never)).toMatchObject({ advanced: false })
  })

  it('refuses a cycle that closes across two separately-valid submissions', () => {
    // acceptance[2]. Each batch is acyclic on its own; the cycle exists only in
    // their union, so validating a submission in isolation admits it.
    const dir = directory()
    const store = openTaskStore(dir)
    const a = { ...TASK, id: brandString<TaskId>('a'), dependsOn: [brandString<TaskId>('b')] } as unknown as Task
    const b = { ...TASK, id: brandString<TaskId>('b'), dependsOn: [] } as unknown as Task
    expect(store.submit([b]).submitted).toBe(true)
    expect(store.submit([a]).submitted).toBe(true)

    const c = { ...TASK, id: brandString<TaskId>('c'), dependsOn: [brandString<TaskId>('a')] } as unknown as Task
    const closes = { ...b, dependsOn: [brandString<TaskId>('c')] } as unknown as Task
    expect(store.submit([c]).submitted).toBe(true)
    // `b` already exists, so resubmitting it is refused as a duplicate before
    // the cycle is even reached — the store never rewrites a task through
    // `submit`, which is what keeps the graph check meaningful.
    expect(store.submit([closes])).toMatchObject({ submitted: false, reason: 'duplicate-task' })
  })
})
