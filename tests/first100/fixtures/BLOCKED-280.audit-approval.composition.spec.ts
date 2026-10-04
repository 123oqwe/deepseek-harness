/**
 * BLOCKED-280 acceptance[2] evidence (P2-06 acceptance[2] 「批准事件与最终 action
 * 形成一一引用」, validation[2] 「审计查询能从 action 反查唯一 approval」): on the
 * SHIPPED headless profile, one real session asks twice about the same tool
 * under two action ids, and the public `dsh audit ... approval <session-id>
 * <action-id>` finds, for each id, exactly the one approval bound to it, and
 * exits 3 for an id no call has.
 *
 * The assertions are the blind evidence contract
 * (`artifacts/delegate/blind-280-audit-evidence-redfirst.md`, §21.4: written
 * without reading `apps/cli/src/audit.ts`), translated line for line; they
 * read only the verb's exit code and its one stdout JSON line. The driver and
 * the shared names are lane B's.
 * @module tests/first100/fixtures/BLOCKED-280.audit-approval.composition
 */

import { fileURLToPath } from 'node:url'
import { runLoaderSmoke } from '@deepseek-ai/dsh-loader-smoke'
import { beforeAll, describe, expect, it } from 'vitest'
import { type AuditQueryResult, REPORT_TAG, type Report } from './loader/blocked-280-audit-approval/shared.ts'

const driver = fileURLToPath(new URL('./loader/blocked-280-audit-approval/driver.ts', import.meta.url))
const overlay = fileURLToPath(new URL('./loader/p2-05-originators/base.patch.yml', import.meta.url))
const tsconfigPath = fileURLToPath(new URL('../../../tsconfig.json', import.meta.url))

/** The driver boots headless once for the session and once per `dsh audit` run. */
const PROCESS_TIMEOUT_MS = 240_000

describe('BLOCKED-280 acceptance[2]: dsh audit approval finds, from an action, its unique approval (shipped headless profile)', () => {
  let report: Report
  beforeAll(async () => {
    const { stdout, stderr } = await runLoaderSmoke({
      label: 'BLOCKED-280 audit approval',
      tempDirPrefix: 'blocked-280-audit-approval-',
      binScript: driver,
      libBinScript: driver,
      configPath: overlay,
      binArgs: [overlay],
      tsconfigPath,
      processTimeoutMs: PROCESS_TIMEOUT_MS,
    })
    const json = new RegExp(`${REPORT_TAG} (?<json>.+)`, 'u').exec(stdout)?.groups?.json
    if (json === undefined) throw new Error(`the driver reported nothing usable; stderr tail:\n${stderr.slice(-1200)}`)
    report = JSON.parse(json) as Report
  }, PROCESS_TIMEOUT_MS + 15_000)

  /**
   * One `dsh audit` run from the report.
   * @param label - which query.
   * @returns the run.
   */
  const q = (label: AuditQueryResult['label']): AuditQueryResult => {
    const run = report.queries.find(entry => entry.label === label)
    if (run === undefined) throw new Error(`the driver reported no ${label} query`)
    return run
  }

  it('真会话对同一工具产生了两次审批,两个不同 actionId', () => {
    expect(report.actionId1).not.toBe(report.actionId2)
    const mine = report.boundApprovals.filter(bound => bound.action === report.toolName)
    expect(mine.map(bound => bound.actionId).sort()).toEqual([report.actionId1, report.actionId2].sort())
  })

  it('approval <sid> <actionId_1>:退 0,approvals 恰一条,且就是 actionId_1(一一引用)', () => {
    const r = q('id1')
    expect(r.exitCode, r.stderr).toBe(0)
    expect(r.json, r.stdoutRaw).not.toBeNull()
    expect(r.json?.sessionId).toBe(report.sessionId)
    expect(r.json?.actionId).toBe(report.actionId1)
    expect(r.json?.approvals).toHaveLength(1)
    expect(r.json?.approvals[0]?.actionId).toBe(report.actionId1)
    expect(r.json?.approvals[0]?.action).toBe(report.toolName)
  })

  it('approval <sid> <actionId_2>:退 0,approvals 恰一条,且就是 actionId_2', () => {
    const r = q('id2')
    expect(r.exitCode, r.stderr).toBe(0)
    expect(r.json, r.stdoutRaw).not.toBeNull()
    expect(r.json?.sessionId).toBe(report.sessionId)
    expect(r.json?.actionId).toBe(report.actionId2)
    expect(r.json?.approvals).toHaveLength(1)
    expect(r.json?.approvals[0]?.actionId).toBe(report.actionId2)
    expect(r.json?.approvals[0]?.action).toBe(report.toolName)
  })

  it('approval <sid> <不存在的 actionId>:退 3(没有)', () => {
    const r = q('absent')
    expect(r.exitCode, r.stderr).toBe(3)
  })
})
