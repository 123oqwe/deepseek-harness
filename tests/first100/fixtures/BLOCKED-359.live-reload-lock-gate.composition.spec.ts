/**
 * BLOCKED-359:live-reload 热重载绕过锁门。经真实 `runProfile` 启动一个
 * `patchReload:'live'`、带已提交 `plugins.lock.json` 的 profile,再编辑其
 * `cordis.patch.yml` 触发**真实 HMR watcher** 热重载,黑盒观测「锁门是否在重组合时
 * 同样执行」。只经 shipped `ctx`(`ctx.loader.entries()` 的 loader entry +
 * `hmr/config-update-failed` 事件)观测,不直接调任何内部锁/准入函数,不用 marker 文件
 * (照 358 教训:源码模式 paths 映射使「本地代码执行」marker 空过)。
 *
 * `./loader/blocked-359-live-reload-lock-gate/driver.ts` 为每个场景各起一次独立
 * `runProfile`(各自 temp home/profile),启动后编辑该 profile 的 `cordis.patch.yml`
 * 触发热重载,打一行 `BLOCKED-359-RELOAD-LOCK <json>`:每场景的 unlockedMounted /
 * lockedMounted / loggerPreserved / failureEventSeen / reloadSettled。锁策略由 profile
 * 已提交的 lock 携带,本 spec 不向子进程传任何锁策略。
 *
 * 两条意图:
 *  MAIN_RED  live profile 启动后,一条编辑 { disable logger-stderr + insert 未入锁、带
 *            有效 Manifest v2 的本地包 } → 整代重组合应被原子性拒绝:该包无 loader entry、
 *            logger-stderr 仍 ACTIVE(上一代保留)、收到 hmr/config-update-failed。
 *            今日(reload 只跑准入、不跑锁门)→ 该包被挂上 + logger-stderr 被卸 + 无事件 → RED。
 *            修后 → GREEN。
 *  CONTROL   同形编辑但 insert 的是**已入锁**、同样有效 Manifest v2 的本地包 → 照常挂上
 *            (有 entry、无失败事件)。今日与修后都 GREEN。
 *
 * 出厂现状(reload 不锁)下预测:CONTROL GREEN,MAIN_RED 三条断言全 RED;修复后两场景全 GREEN。
 * §21.4 盲写先红:未读 composeLive / watchUserPatches / enforceProfileLock 的 reload 实现、
 * 未读任何 359 修复。
 * @module tests/first100/fixtures/BLOCKED-359.live-reload-lock-gate.composition
 */

import { fileURLToPath } from 'node:url'
import { LOADER_SMOKE_TEST_TIMEOUT_MS, runLoaderSmoke } from '@deepseek-ai/dsh-loader-smoke'
import { beforeAll, describe, expect, it } from 'vitest'
import { CONTROL, MAIN_RED, REPORT_TAG } from './loader/blocked-359-live-reload-lock-gate/shared.ts'

const driver = fileURLToPath(new URL('./loader/blocked-359-live-reload-lock-gate/driver.ts', import.meta.url))
const tsconfigPath = fileURLToPath(new URL('../../../tsconfig.json', import.meta.url))

/** 一个场景的一次独立 live 启动 + 一次热重载的观测终态。 */
interface ScenarioResult {
  /** 场景 id(见 shared.ts)。 */
  readonly scenario: string
  /** 该场景 subject 包(未入锁;仅 MAIN_RED 有意义)在重载后是否有 ACTIVE loader entry。 */
  readonly unlockedMounted: boolean
  /** 该场景 subject 包(已入锁;仅 CONTROL 有意义)在重载后是否有 ACTIVE loader entry。 */
  readonly lockedMounted: boolean
  /** 原子性探针:同一条编辑 disable 的 base 行 logger-stderr,重载后是否仍 ACTIVE(上一代保留)。 */
  readonly loggerPreserved: boolean
  /** 重载过程中是否收到针对该 profile patch 文件的 hmr/config-update-failed 事件。 */
  readonly failureEventSeen: boolean
  /** 任一通道显示这一代 reload 被处理(落定);false 表示在上限内无任何可见重载,供诊断。 */
  readonly reloadSettled: boolean
}

interface Report {
  readonly scenarios: readonly ScenarioResult[]
}

describe('BLOCKED-359 live-reload 热重载锁门:经真实 runProfile + HMR 的组合层黑盒观测', () => {
  let report: Report
  beforeAll(async () => {
    const smoke = await runLoaderSmoke({
      label: 'BLOCKED-359 live-reload lock-gate',
      tempDirPrefix: 'blocked-359-live-reload-',
      binScript: driver,
      configPath: driver,
      tsconfigPath,
    })
    const json = new RegExp(`${REPORT_TAG} (?<json>.+)`, 'u').exec(smoke.stdout)?.groups?.json
    if (json === undefined) throw new Error(`driver 未产出可用 JSON;stderr 尾部:\n${smoke.stderr.slice(-1200)}`)
    report = JSON.parse(json) as Report
  }, LOADER_SMOKE_TEST_TIMEOUT_MS)

  /** 取某场景结果;缺失即报错(driver 契约要求两场景齐全)。 */
  function scenarioOf(id: string): ScenarioResult {
    const found = report.scenarios.find(s => s.scenario === id)
    if (found === undefined) throw new Error(`driver 未汇报场景 ${id};实到:${JSON.stringify(report.scenarios.map(s => s.scenario))}`)
    return found
  }

  // —— 主红:未入锁、带有效 Manifest v2 的本地包,经 live 编辑 insert → 整代重组合应被原子性拒绝 ——

  it('主红:live profile 热重载一个未入锁(有效 Manifest v2)的本地包 → 不得挂上、上一代保留、收到失败事件(今日 reload 不锁 → RED)', () => {
    const s = scenarioOf(MAIN_RED)
    // 落定前置:在上限内这一代重载确被处理(任一通道)。否则下方断言读的是空重载,需诊断。
    expect(s.reloadSettled, '上限内未观测到任何重载落定(事件/挂载/卸载三通道皆空),无法判定').toBe(true)
    // ① 未入锁包不得被挂上:今日准入放行 → 有 ACTIVE entry → RED;修后锁门拒 → 无 entry → GREEN。
    expect(s.unlockedMounted, '未入锁包不得在热重载中被挂上(今日 reload 只跑准入、不跑锁门 → 被挂上 → RED)').toBe(false)
    // ② 上一代组合原子性保留:整条编辑被拒 → 其同条里的 logger-stderr disable 也不应生效。
    //    今日整代被应用 → logger-stderr 被卸 → loggerPreserved=false → RED;修后整代被拒 → 仍 ACTIVE → GREEN。
    expect(s.loggerPreserved, '被拒的重载不得部分生效:同条编辑里的 logger-stderr disable 不应被应用(今日整代应用 → RED)').toBe(true)
    // ③ 收到热重载配置更新失败事件(锁门拒绝这一代的正信号)。今日无事件 → RED;修后有 → GREEN。
    expect(s.failureEventSeen, '锁门拒绝这一代重组合应广播 hmr/config-update-failed(今日无锁门 → 无事件 → RED)').toBe(true)
  })

  // —— 对照:已入锁、同样有效 Manifest v2 的本地包,经同形 live 编辑 insert → 照常挂上 ——

  it('对照:live profile 热重载一个已入锁(有效 Manifest v2)的本地包 → 照常挂上、无失败事件(今日与修后都 GREEN)', () => {
    const s = scenarioOf(CONTROL)
    expect(s.reloadSettled, '上限内未观测到对照场景重载落定').toBe(true)
    expect(s.lockedMounted, '锁中已批准、匹配的本地包应在热重载中被正常挂上').toBe(true)
    expect(s.failureEventSeen, '合法已入锁包的重载不得触发配置更新失败事件').toBe(false)
  })
})
