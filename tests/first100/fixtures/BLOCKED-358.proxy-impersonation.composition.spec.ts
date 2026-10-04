/**
 * BLOCKED-358:P1-01 准入 —— module-proxy 同名包冒充绕过。经真实 runProfile 启动、
 * enforce 下观测「一个 profile-本地的同名『自称 proxy』包能否借出厂包身份过准入」
 * (不直接调 userPatchRowPackage / 准入 / isInstallationPackage)。
 *
 * `./loader/blocked-358-proxy-impersonation/driver.ts` 做两次独立真实 profile 启动
 * (各自 temp home/profile),各铺一个与出厂工具 @deepseek-ai/dsh-tool-ask-user 同名、
 * 经补丁 insert、已入锁的候选,入口被加载时真写一个该候选独有的 marker 文件,
 * 打印一行 `BLOCKED-358-PROXY <json>`:每候选(按 key)是否过准入+ACTIVE、其 marker
 * 是否被写出;准入拒绝到达 stderr。
 *
 * 两条意图:
 *  IMPERSONATOR 带 dsh.moduleFallback 的同名「自称 proxy」→ 必须被拒、入口不被加载、
 *    marker 不存在(RED today:今天冒充得逞 → 被加载 → marker 被写)。
 *  CONTROL 同名但不带 moduleFallback → 按自声明判(无自身 Manifest v2 → 被拒)、
 *    marker 不存在(GREEN today + 修后:行为不因修复改变)。
 * 写修复的 lane 应 delegate 要求另加第三次启动 LEGIT_PROXY(过度拒绝对照):安装在共享回退
 * 位置写的真 proxy → 应过准入并 ACTIVE(GREEN today + 修后)。
 *
 * §21.4 盲写先红:未读 userPatchRowPackage / 准入 / isInstallationPackage 实现、
 * 未读任何 358 修复。
 * @module tests/first100/fixtures/BLOCKED-358.proxy-impersonation.composition
 */

import { fileURLToPath } from 'node:url'
import { LOADER_SMOKE_TEST_TIMEOUT_MS, runLoaderSmoke } from '@deepseek-ai/dsh-loader-smoke'
import { beforeAll, describe, expect, it } from 'vitest'
import { CONTROL, IMPERSONATOR, LEGIT_PROXY, REPORT_TAG } from './loader/blocked-358-proxy-impersonation/shared.ts'

const driver = fileURLToPath(new URL('./loader/blocked-358-proxy-impersonation/driver.ts', import.meta.url))
const tsconfigPath = fileURLToPath(new URL('../../../tsconfig.json', import.meta.url))

/** 单个候选的观测。 */
interface Candidate {
  /** shared.ts 的稳定候选 key(非包名 —— 两候选包名故意相同)。 */
  readonly key: string
  /** 该候选经补丁 insert 的那一行是否过准入且 fiber ACTIVE。 */
  readonly active: boolean
  /** 该候选的入口 apply 是否真被执行(写出了它独有的 marker 文件)。 */
  readonly markerWritten: boolean
  /** 启动之后，共享回退位置上这个包是不是 module proxy(LEGIT_PROXY 的前提，写修复的 lane 加)。 */
  readonly sharedProxy: boolean
}

/** driver 上报的内容(两次启动聚合)。 */
interface Report {
  readonly bootSucceeded: boolean
  readonly bootError: string | null
  readonly candidates: readonly Candidate[]
}

/** 取某候选;缺失即先红失败(宁红勿漏)。 */
function candidateOf(report: Report, key: string): Candidate {
  const c = report.candidates.find(entry => entry.key === key)
  expect(c, `driver 必须上报候选 ${key};实到:${JSON.stringify(report.candidates)}`).toBeDefined()
  return c!
}

describe('BLOCKED-358:P1-01 准入 —— module-proxy 同名包冒充绕过(真实 runProfile 启动,enforce)', () => {
  let report: Report
  beforeAll(async () => {
    const smoke = await runLoaderSmoke({
      label: 'BLOCKED-358 module-proxy same-name impersonation',
      tempDirPrefix: 'blocked-358-proxy-',
      binScript: driver,
      configPath: driver,
      tsconfigPath,
    })
    const json = new RegExp(`${REPORT_TAG} (?<json>.+)`, 'u').exec(smoke.stdout)?.groups?.json
    if (json === undefined) throw new Error(`driver 没打印可用内容;stderr 尾:\n${smoke.stderr.slice(-1200)}`)
    report = JSON.parse(json) as Report
  }, LOADER_SMOKE_TEST_TIMEOUT_MS)

  it('两次 profile 启动都成功:拒绝一个冒充层不应使 boot 失败(今天与修后都绿)', () => {
    expect(report.bootSucceeded, `boot 失败:${report.bootError ?? 'unknown'}`).toBe(true)
  })

  // IMPERSONATOR:profile-本地、带 dsh.moduleFallback、取出厂包 @deepseek-ai/dsh-tool-ask-user 同名,
  //   入口被加载时写 marker。意图:冒充不成立 → 被拒 → 入口不被加载 → marker 不存在。
  //   今天:冒充得逞 → 借出厂 manifest 过准入 → 入口被加载 → marker 被写 → 本断言红。
  it('IMPERSONATOR 的同名「自称 proxy」包不得借出厂包身份过准入:其入口不得被加载、marker 不得存在(RED today —— 今天冒充得逞、入口被加载写出 marker)', () => {
    expect(candidateOf(report, IMPERSONATOR).markerWritten, `冒充者 ${IMPERSONATOR} 的入口不得被加载(marker 不得存在)`).toBe(false)
  })

  it('IMPERSONATOR 的补丁行不得过准入、不得 ACTIVE(RED today —— 今天借出厂 manifest 过准入并 ACTIVE)', () => {
    expect(candidateOf(report, IMPERSONATOR).active, `冒充者 ${IMPERSONATOR} 的行不得过准入/ACTIVE`).toBe(false)
  })

  // CONTROL:同名但不带 moduleFallback → 按它自己的声明判(无自身 Manifest v2 → legacy-untrusted → 被拒)。
  //   今天本就被拒 → marker 不存在、不 ACTIVE → 绿;修后仍拒 → 仍绿(行为不因修复改变)。
  //   与 IMPERSONATOR 仅差 moduleFallback 一处 —— 守住「被利用的向量正是 moduleFallback 声明,而非包名本身」。
  it('CONTROL 同名但不带 moduleFallback,按自声明被拒:入口不被加载、marker 不存在(GREEN today + 修后)', () => {
    expect(candidateOf(report, CONTROL).markerWritten, `对照 ${CONTROL} 应按自声明被拒(marker 不存在)`).toBe(false)
  })

  it('CONTROL 的补丁行不过准入、不 ACTIVE(GREEN today + 修后)', () => {
    expect(candidateOf(report, CONTROL).active, `对照 ${CONTROL} 的行不应过准入/ACTIVE`).toBe(false)
  })

  // LEGIT_PROXY(写修复的 lane 应 delegate 要求加的过度拒绝对照):安装在共享回退位置写的真 proxy,
  //   profile 本地不放同名包 → 按它转发到的安装包判 → 过准入、ACTIVE。修前修后都绿;修复若把真 proxy 也拒了，这条红。
  it('LEGIT_PROXY 安装在共享回退位置写的真 module proxy 照常过准入并 ACTIVE(GREEN today + 修后)', () => {
    const legit = candidateOf(report, LEGIT_PROXY)
    expect(legit.sharedProxy, `${LEGIT_PROXY} 的前提：共享回退位置上是安装写的 module proxy`).toBe(true)
    expect(legit.active, `真 proxy ${LEGIT_PROXY} 的行应过准入并 ACTIVE`).toBe(true)
  })

  // PROBE — never merge: fails on purpose so the report carries what each child loaded.
  it('PROBE: which module each candidate row loaded', () => {
    // The payload rides in the custom message: an assertion's own rendering of a long string is truncated.
    expect(false, `PROBE ${JSON.stringify(report.candidates)}`).toBe(true)
  })
})
