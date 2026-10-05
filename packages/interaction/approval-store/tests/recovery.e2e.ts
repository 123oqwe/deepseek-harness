/**
 * A crash inside an approval write (Epic P2-07 validation[0], acceptance[0]
 * at the store): for each transition, a child process kills itself at the
 * fault point inside the write's transaction, after its INSERT or UPDATE and
 * before COMMIT, and the file a restart reopens holds the approval exactly as
 * it stood before that transition.
 */

import { spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { brandString } from '@deepseek-ai/dsh-brand'
import { afterEach, describe, expect, it } from 'vitest'
import { openApprovalStore } from '../src/sqlite.ts'
import type { ApprovalRequestId, ApprovalViewer, PrincipalId, TenantId } from '../src/index.ts'

const MODULE = fileURLToPath(new URL('../src/sqlite.ts', import.meta.url))
const dirs: string[] = []
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

const viewer: ApprovalViewer = { tenant: brandString<TenantId>('tenant-a'), principal: brandString<PrincipalId>('user-1') }
const REQUEST = 'store.request({ id: "a-1", tenant: "tenant-a", actor: "agent-1", scope: { kind: "turn", sessionId: "session-1" }, toolName: "bash", requestDigest: "sha256:a-1", deadlineMs: 1e12 }, 100)'
const VIEWER = '{ tenant: "tenant-a", principal: "user-1" }'

/** One transition a crash interrupts: what runs before it, the transition itself, its fault point, and the state a restart must find. */
interface CrashCase {
  readonly name: string
  readonly setup: readonly string[]
  readonly act: string
  readonly point: 'after-insert' | 'after-update'
  readonly before: { readonly state: string; readonly revision: number } | undefined
}

const CASES: readonly CrashCase[] = [
  { name: 'request', setup: [], act: REQUEST, point: 'after-insert', before: undefined },
  { name: 'approve', setup: [REQUEST], act: `store.decide("a-1", 0, "approved", ${VIEWER}, 200)`, point: 'after-update', before: { state: 'requested', revision: 0 } },
  { name: 'deny', setup: [REQUEST], act: `store.decide("a-1", 0, "denied", ${VIEWER}, 200)`, point: 'after-update', before: { state: 'requested', revision: 0 } },
  { name: 'revoke', setup: [REQUEST], act: `store.revoke("a-1", 0, ${VIEWER}, 200)`, point: 'after-update', before: { state: 'requested', revision: 0 } },
  {
    name: 'consume',
    setup: [REQUEST, `store.decide("a-1", 0, "approved", ${VIEWER}, 200)`],
    act: `store.consume("a-1", 1, ${VIEWER}, 300)`,
    point: 'after-update',
    before: { state: 'approved', revision: 1 },
  },
]

describe('P2-07 acceptance[0] at the store: a crash inside a write leaves the approval as it was', () => {
  for (const crash of CASES) {
    it(`${crash.name}: killed at ${crash.point}, the restart finds the state before it`, () => {
      const dir = mkdtempSync(join(tmpdir(), 'dsh-approval-recovery-'))
      dirs.push(dir)
      const child = spawnSync(process.execPath, ['--import', 'tsx', '-e', [
        `const { openApprovalStore } = await import(${JSON.stringify(MODULE)})`,
        `let store = openApprovalStore(${JSON.stringify(dir)}, { busyTimeoutMs: 1000 })`,
        ...crash.setup,
        'store.close()',
        `store = openApprovalStore(${JSON.stringify(dir)}, { busyTimeoutMs: 1000, fault: (point) => {`,
        `  if (point === ${JSON.stringify(crash.point)}) process.kill(process.pid, 'SIGKILL')`,
        '} })',
        crash.act,
        'console.log("the fault point was not reached")',
      ].join('\n')], { encoding: 'utf8', timeout: 30_000 })
      expect([child.signal, child.stdout]).toEqual(['SIGKILL', ''])
      const store = openApprovalStore(dir, { busyTimeoutMs: 1000 })
      try {
        const read = store.get(brandString<ApprovalRequestId>('a-1'), viewer, 400)
        if (crash.before === undefined) expect(read).toBeUndefined()
        else expect(read).toMatchObject(crash.before)
      } finally {
        store.close()
      }
    }, 60_000)
  }
})
