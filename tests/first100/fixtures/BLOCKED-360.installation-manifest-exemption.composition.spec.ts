/**
 * BLOCKED-360(合并):安装自带 manifest 豁免 + 身份门,经真实 runProfile 启动、
 * enforce 下观测「无-manifest 补丁 insert 候选是否过准入/ACTIVE」(不直接调内部
 * 授予/豁免/身份函数)。
 *
 * `./loader/blocked-360-exemption/driver.ts` 铺五种 node_modules / symlink /
 * 安装锚布局(A/C/D 共用同一无-manifest 包名、各自一次启动,B 用闭包之外的名字;F 是
 * dsh-base 风格既有通配授予对照),启动一个真实 profile,打印一行
 * `BLOCKED-360-EXEMPTION <json>`:每个候选(按 key)是否过准入且其插件 ACTIVE
 * —— 即是否拿到安装自带豁免的产品可见代理;准入拒绝到达 stderr。
 *
 * 五条意图:
 *  A 真安装自带 base(无 manifest)→ 应放行(RED today:今天无豁免,一律被拒)
 *  B 祖先-only(安装根之外的 node_modules)→ 应拒(GREEN today + 修后)
 *  C symlink 路径相等但 realpath 落外 → 应拒(GREEN today + 修后)
 *  D profile 本地同名副本 → 应拒,判安装解析结果(GREEN today + 修后)
 *  F dsh-base 既有 bundle-层通配授予不回归、照常 ACTIVE(GREEN today + 修后)
 *
 * §21.4 盲写先红:未读 installationWildcardGrants / 准入 / 豁免实现、未读任何修复。
 * @module tests/first100/fixtures/BLOCKED-360.installation-manifest-exemption.composition
 */

import { fileURLToPath } from 'node:url'
import { LOADER_SMOKE_TEST_TIMEOUT_MS, runLoaderSmoke } from '@deepseek-ai/dsh-loader-smoke'
import { beforeAll, describe, expect, it } from 'vitest'
import {
  ANCESTOR_ONLY,
  BASE_WILDCARD_GRANT,
  INSTALL_BASE,
  PROFILE_SAME_NAME,
  REPORT_TAG,
  SYMLINK_REALPATH_OUT,
} from './loader/blocked-360-exemption/shared.ts'

const driver = fileURLToPath(new URL('./loader/blocked-360-exemption/driver.ts', import.meta.url))
const tsconfigPath = fileURLToPath(new URL('../../../tsconfig.json', import.meta.url))

/** 单个候选包的观测:其插件是否过准入并 ACTIVE(= 是否拿到安装自带豁免的代理)。 */
interface Candidate {
  /** shared.ts 的稳定候选 key。 */
  readonly key: string
  /** 该候选的插件是否过准入且 fiber ACTIVE —— true ⟺ 拿到安装自带豁免、过准入。 */
  readonly active: boolean
}

/** driver 上报的内容。 */
interface Report {
  readonly bootSucceeded: boolean
  readonly bootError: string | null
  readonly candidates: readonly Candidate[]
}

/** 取某候选的 active 态;缺失即先红失败(宁红勿漏)。 */
function activeOf(report: Report, key: string): boolean {
  const c = report.candidates.find(entry => entry.key === key)
  expect(c, `driver 必须上报候选 ${key};实到:${JSON.stringify(report.candidates)}`).toBeDefined()
  return c!.active
}

describe('BLOCKED-360:安装自带 manifest 豁免 + 身份门(真实 runProfile 启动,enforce)', () => {
  let report: Report
  beforeAll(async () => {
    const smoke = await runLoaderSmoke({
      label: 'BLOCKED-360 installation-manifest exemption + identity gate',
      tempDirPrefix: 'blocked-360-exemption-',
      binScript: driver,
      configPath: driver,
      tsconfigPath,
    })
    const json = new RegExp(`${REPORT_TAG} (?<json>.+)`, 'u').exec(smoke.stdout)?.groups?.json
    if (json === undefined) throw new Error(`driver 没打印可用内容;stderr 尾:\n${smoke.stderr.slice(-1200)}`)
    report = JSON.parse(json) as Report
  }, LOADER_SMOKE_TEST_TIMEOUT_MS)

  it('profile 能在豁免 + 身份门下正常启动(拒绝一个冒充层不应使 boot 失败 —— 今天与修后都绿)', () => {
    expect(report.bootSucceeded, `boot 失败:${report.bootError ?? 'unknown'}`).toBe(true)
  })

  // A 真安装自带(无 manifest):安装依赖闭包里的包(经 headless bundle 传递)、realpath 对齐。
  //    意图:应被豁免放行 → 过准入 active===true。
  //    今天:无豁免,enforce 下无-manifest 一律被拒 → active===false → 本断言红。
  it('A 真安装自带的无-manifest base 应被豁免放行、过准入并 ACTIVE(RED today —— 今天无豁免,无-manifest 一律被拒)', () => {
    expect(activeOf(report, INSTALL_BASE), `真安装自带的 ${INSTALL_BASE} 应被豁免而过准入`).toBe(true)
  })

  // B 祖先-only:闭包之外的名字,无 manifest,只在 profile 之上的祖先 node_modules 里。
  //    意图:非安装身份 → 不得豁免 → 被拒 active===false。
  //    今天:无豁免,它本就被拒 → active===false → 绿;修后身份门必须仍拒(否则豁免过松)。
  it('B 祖先-only 的无-manifest 包不得被当安装自带豁免、必被拒(GREEN today + 修后仍拒)', () => {
    expect(activeOf(report, ANCESTOR_ONLY), `安装根之外祖先层的 ${ANCESTOR_ONLY} 不得被豁免`).toBe(false)
  })

  // C symlink:路径串相等但 realpath 落在安装根之外。
  //    意图:两边取 realpath 比 → 不得豁免 → active===false。今天本就被拒 → 绿;修后仍拒。
  it('C realpath 落在安装根之外的 symlink 冒充包不得被豁免、必被拒(GREEN today + 修后仍拒)', () => {
    expect(activeOf(report, SYMLINK_REALPATH_OUT), `realpath 落外的 ${SYMLINK_REALPATH_OUT} 不得被豁免`).toBe(false)
  })

  // D profile 同名副本:profile 的 node_modules 里放一个与安装包同名的副本(profile-first 解到它)。
  //    意图:判「安装解析结果」而非「补丁行自解析」→ 这份 profile 本地副本不得借同名拿豁免 → active===false。
  //    今天本就被拒 → 绿;修后身份门必须仍拒。
  it('D profile 本地同名副本不得借同名被当安装自带豁免、必被拒:判安装解析结果而非补丁行自解析(GREEN today + 修后仍拒)', () => {
    expect(activeOf(report, PROFILE_SAME_NAME), `profile 本地同名的 ${PROFILE_SAME_NAME} 不得借同名被豁免`).toBe(false)
  })

  // F 授予对照:dsh-base 风格的既有 bundle-层通配授予,照常过准入并 ACTIVE。
  //    合并门把豁免与授予共用一个身份函数,F 守住授予侧不回归。今天绿,修后也必须绿。
  it('F dsh-base 既有 bundle-层通配授予照常过准入并 ACTIVE、不回归(GREEN —— 今天与修后都绿)', () => {
    expect(activeOf(report, BASE_WILDCARD_GRANT), `既有授予的 ${BASE_WILDCARD_GRANT} 必须照常 ACTIVE`).toBe(true)
  })
})
