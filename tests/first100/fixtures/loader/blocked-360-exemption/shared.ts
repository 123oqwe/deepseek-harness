/**
 * BLOCKED-360 合并先红(安装自带 manifest 豁免 + 身份门)在 driver 与 spec 间
 * 共享的名字。五条候选经真实 runProfile 启动、enforce 下观测补丁 insert 的
 * 无-manifest 候选是否过准入(产品可见代理:其插件是否过准入并 ACTIVE)。
 *
 * 身份门(授予与豁免共用一个函数):包名在安装的依赖闭包里,且该行解析到的包
 * 目录与闭包条目 realpath 相同。覆盖传递/hoist/嵌套依赖;排除闭包之外的名字
 * (弱点①)、realpath 落外的 symlink(弱点②)、profile 本地同名副本
 * (弱点③,判安装解析结果而非补丁行自解析)。
 *
 * stable key 字符串值复用 Q1 先红(blind-Q1-wildcard-redfirst.md 的 shared.ts,
 * 其横幅明示 shared.ts/keys 可复用);key 只是 driver↔spec 的不透明配对标识,
 * 复用避免漂移。A/C/D 共用同一无-manifest 包名,各自一次启动;B 用闭包之外的
 * 名字。不能用包名做 key。
 *
 * §21.4 盲写:未读 installationWildcardGrants / 准入 / 豁免实现、未读任何修复。
 * @module tests/first100/fixtures/loader/blocked-360-exemption/shared
 */

/** A(真安装自带,无 manifest):安装依赖闭包里的包(经 headless bundle 传递进来),realpath 对齐 → 应放行。 */
export const INSTALL_BASE = 'q1-install-base'
/** B(祖先-only 控制):闭包之外的名字,无 manifest,只在 profile 之上的祖先 node_modules 里 → 应拒。 */
export const ANCESTOR_ONLY = 'q1-ancestor-only'
/** C(symlink 控制):路径串相等但 realpath 落在安装根之外 → 应拒。 */
export const SYMLINK_REALPATH_OUT = 'q1-symlink-realpath-out'
/** D(profile 同名控制):profile 本地的同名副本(profile-first 解到它)→ 应拒(判安装解析结果)。 */
export const PROFILE_SAME_NAME = 'q1-profile-same-name'
/** F(授予对照):dsh-base 风格的既有 bundle-层通配授予,照常 ACTIVE → 不得回归。 */
export const BASE_WILDCARD_GRANT = 'blocked-360-base-wildcard-grant'

/** 本先红观测的全部候选 key,保证 driver 五个全上报、spec 不漏断言。 */
export const CANDIDATE_KEYS = [
  INSTALL_BASE,
  ANCESTOR_ONLY,
  SYMLINK_REALPATH_OUT,
  PROFILE_SAME_NAME,
  BASE_WILDCARD_GRANT,
] as const

/** driver 打印的标签行前缀;spec 用它取出 JSON。 */
export const REPORT_TAG = 'BLOCKED-360-EXEMPTION'
