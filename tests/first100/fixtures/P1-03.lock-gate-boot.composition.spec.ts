/**
 * A-550: P1-03 生产 boot 锁门,经 shipped `runProfile` 真实启动的组合层黑盒观测
 * (must[2]、acceptance[0]、acceptance[1];BLOCKED-3393 解锁条件)。断言只落
 * 「启动成功/被拒」(bootSucceeded)与「主语插件是否 ACTIVE」(subjectActive),
 * 不直接调任何内部锁函数。范围按 C17 方案 2′:锁门只管 profile 目录解析出来的包,
 * 安装自带 bundle 不要求锁项。
 *
 * `./loader/p1-03-lock-gate/driver.ts` 为每个场景各起一次独立 `runProfile`
 * (锁门对 mismatched lock 是整启动被拒,不能把被拒场景与对照场景塞进同一次启动),
 * 打一行 `P1-03-LOCK-GATE <json>`:每场景的 bootSucceeded / bootError /
 * subjectActive。deployment 的锁策略由 bundle row 携带,本 spec 不向子进程传任何
 * 锁策略(解锁条件要求「policy read from a bundle row rather than passed by a test」)。
 *
 * 出厂现状(未验锁)下预测:两条对照 GREEN,四条门禁场景 RED;修复后六条全 GREEN。
 * @module tests/first100/fixtures/P1-03.lock-gate-boot.composition
 */

import { fileURLToPath } from 'node:url'
import { LOADER_SMOKE_TEST_TIMEOUT_MS, runLoaderSmoke } from '@deepseek-ai/dsh-loader-smoke'
import { beforeAll, describe, expect, it } from 'vitest'
import {
  CONTROL_LOCKED,
  CONTROL_ORDINARY_DEP,
  INSTALLED_NOT_IN_LOCK,
  INTEGRITY_MISMATCH,
  LOCK_GATE_MARKER,
  MANIFEST_DRIFTED,
  NO_LOCK_POLICY,
} from './loader/p1-03-lock-gate/shared.ts'

const driver = fileURLToPath(new URL('./loader/p1-03-lock-gate/driver.ts', import.meta.url))
const tsconfigPath = fileURLToPath(new URL('../../../tsconfig.json', import.meta.url))

/** 一个场景的一次独立启动结果。 */
interface ScenarioResult {
  /** 场景 id(见 shared.ts)。 */
  readonly scenario: string
  /** runProfile 正常返回 ctx 为 true;抛出/reject(被 catch)为 false。 */
  readonly bootSucceeded: boolean
  /** 启动被拒时的错误信息,正常启动为 null。 */
  readonly bootError: string | null
  /** 该场景主语插件在 ctx.loader.entries() 中存在且 fiber 为 ACTIVE。 */
  readonly subjectActive: boolean
}

/** driver 汇报的全部场景。 */
interface Report {
  readonly scenarios: readonly ScenarioResult[]
}

describe('A-550 P1-03 生产 boot 锁门:经真实 runProfile 的组合层黑盒观测', () => {
  let report: Report
  beforeAll(async () => {
    const smoke = await runLoaderSmoke({
      label: 'P1-03 lock-gate boot',
      tempDirPrefix: 'p1-03-lock-gate-',
      binScript: driver,
      configPath: driver,
      tsconfigPath,
    })
    const json = new RegExp(`${LOCK_GATE_MARKER} (?<json>.+)`, 'u').exec(smoke.stdout)?.groups?.json
    if (json === undefined) throw new Error(`driver 未产出可用 JSON;stderr 尾部:\n${smoke.stderr.slice(-1200)}`)
    report = JSON.parse(json) as Report
  }, LOADER_SMOKE_TEST_TIMEOUT_MS)

  /** 取某场景结果;缺失即报错(driver 契约要求六场景齐全)。 */
  function scenarioOf(id: string): ScenarioResult {
    const found = report.scenarios.find(s => s.scenario === id)
    if (found === undefined) throw new Error(`driver 未汇报场景 ${id};实到:${JSON.stringify(report.scenarios.map(s => s.scenario))}`)
    return found
  }

  // —— 对照(control):锁门不得误伤合法锁定插件,出厂设计应保持 GREEN ——

  it('对照1:锁里记了已装插件的 profile 正常启动并跑该插件;安装自带 bundle 无锁项也不拦(must[2] 正向 + C17 2′)', () => {
    const s = scenarioOf(CONTROL_LOCKED)
    expect(s.bootSucceeded, `启动应成功:${s.bootError ?? 'unknown'}`).toBe(true)
    expect(s.subjectActive, '锁中已批准且匹配的 profile 目录插件应被加载并 ACTIVE').toBe(true)
  })

  it('对照2:锁里还记了一个普通依赖,profile 照常启动并跑该插件(must[2] 正向)', () => {
    const s = scenarioOf(CONTROL_ORDINARY_DEP)
    expect(s.bootSucceeded, `启动应成功:${s.bootError ?? 'unknown'}`).toBe(true)
    expect(s.subjectActive, '锁中记录的普通依赖不改变合法插件的加载').toBe(true)
  })

  // —— 门禁(must[2] / acceptance[0]):mismatched lock → 整启动被拒,主语插件不加载 ——

  it('门禁3:profile 目录装了、锁里没有的插件 → 启动被拒,该插件不加载(must[2];出厂今天不验锁 → RED)', () => {
    const s = scenarioOf(INSTALLED_NOT_IN_LOCK)
    expect(s.bootSucceeded, '对未在 lock 中批准的 profile 目录插件,生产 boot 应拒绝启动').toBe(false)
    expect(s.subjectActive, '被拒启动不得加载该插件').toBe(false)
  })

  it('门禁4:锁写好之后 manifest 改了(digest 不匹配)的插件 → 启动被拒,该插件不加载(must[2];出厂今天不验 digest → RED)', () => {
    const s = scenarioOf(MANIFEST_DRIFTED)
    expect(s.bootSucceeded, 'digest 与 lock 不匹配时,生产 boot 应拒绝启动').toBe(false)
    expect(s.subjectActive, '被拒启动不得加载该插件').toBe(false)
  })

  it('门禁5:安装记录的 integrity 与锁里不同 → 启动被拒,该插件不加载(acceptance[0] 按 lock 验证本地 cache;出厂今天不验 integrity → RED)', () => {
    const s = scenarioOf(INTEGRITY_MISMATCH)
    expect(s.bootSucceeded, '本地 cache 的 integrity 与 lock 不符时,生产 boot 应拒绝启动').toBe(false)
    expect(s.subjectActive, '被拒启动不得加载该插件').toBe(false)
  })

  // —— 无锁 profile:按出厂 bundle 声明的策略走(取最严)。断言政策无关 ——

  it('门禁6:没有锁、装了插件的 profile 按出厂 bundle 声明的策略(取最严)处置;今天静默加载 → RED,政策无关', () => {
    const s = scenarioOf(NO_LOCK_POLICY)
    // 政策无关:不写死 refuse/warn。出厂今天(§2)是「启动成功 + 插件 ACTIVE」的静默放行。
    // 任一有门禁效果的最严策略都会偏离该静默态:要么整启动被拒(bootSucceeded=false),
    // 要么该无锁插件被扣住不激活(subjectActive=false)。故断言「非静默放行」:
    const silentlyAdmitted = s.bootSucceeded && s.subjectActive
    expect(silentlyAdmitted, '无锁 profile 的已装插件不得像今天那样被静默加载;应被最严出厂策略门禁(拒启动或扣住插件)').toBe(false)
  })
})
