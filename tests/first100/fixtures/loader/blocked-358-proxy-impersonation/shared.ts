/**
 * BLOCKED-358 先红(P1-01 准入:module-proxy 同名包冒充绕过)在 driver 与 spec
 * 间共享的名字。两条同名候选经真实 runProfile 启动、enforce 下、补丁 insert、
 * 已入锁,观测一个 profile-本地的同名「自称 proxy」包能否借出厂包身份过准入。
 *
 * 意图(简报 §1):enforce 下,profile-本地包若自称 module proxy
 * (package.json 带 `dsh.moduleFallback`)并取某出厂包同名,不得借那个出厂包的
 * manifest 过准入;必须按它自己的声明判(无自身 Manifest v2 → 被拒)。正当 proxy
 * 只出现在共享安装位置,profile-本地的「自称 proxy」是冒充,不算数。
 *
 * 两候选故意同名(@deepseek-ai/dsh-tool-ask-user,一个出厂工具,带 Manifest v2、
 * 无通配授予),仅差 package.json 是否带 `dsh.moduleFallback`:
 *  - IMPERSONATOR 带 moduleFallback → 今天被当出厂包、借出厂 manifest 过准入、
 *    其入口代码被加载并写 marker(冒充得逞 → RED);修后被拒、marker 不存在。
 *  - CONTROL 不带 moduleFallback → 按它自己的声明判(无自身 Manifest v2 → 被拒)、
 *    marker 不存在;今天与修后都 GREEN(行为不因修复改变)。
 * 两候选用 stable key(非包名)上报——包名相撞,靠 key + 各自独有 marker/insert
 * name 区分是哪一份。
 *
 * §21.4 盲写:未读 userPatchRowPackage / 准入 / isInstallationPackage 实现、
 * 未读任何 358 修复。
 * @module tests/first100/fixtures/loader/blocked-358-proxy-impersonation/shared
 */

/**
 * 被冒充的出厂工具包名(带 Manifest v2、无通配授予)。两候选都取此名放进各自
 * profile 的 node_modules;IMPERSONATOR 另带 dsh.moduleFallback 以自称 proxy。
 */
export const IMPERSONATED_PACKAGE = '@deepseek-ai/dsh-tool-ask-user'

/** IMPERSONATOR(主红):profile-本地同名包、带 moduleFallback、入口写 marker。 */
export const IMPERSONATOR = 'blocked-358-impersonator'
/** CONTROL(对照):同名副本但不带 moduleFallback,按自声明判。 */
export const CONTROL = 'blocked-358-control'
/**
 * LEGIT_PROXY(过度拒绝对照，写修复的 lane 应 delegate 要求加):安装在共享回退位置
 * `$DSH_HOME/profiles/node_modules` 写的真 module proxy,profile 本地不放同名包;
 * 修前修后都应过准入并 ACTIVE。
 */
export const LEGIT_PROXY = 'blocked-358-legit-proxy'

/** 本先红观测的候选 key,保证 driver 都上报、spec 不漏断言。 */
export const CANDIDATE_KEYS = [IMPERSONATOR, CONTROL, LEGIT_PROXY] as const

/** driver 打印的标签行前缀;spec 用它取出 JSON。 */
export const REPORT_TAG = 'BLOCKED-358-PROXY'
