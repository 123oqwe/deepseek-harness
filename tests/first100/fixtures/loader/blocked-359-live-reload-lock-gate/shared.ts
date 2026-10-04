/**
 * BLOCKED-359 先红(live-reload 热重载锁门)在 driver 与 spec 间共享的名字:
 * 报告前缀、两个场景 id、两个 subject 本地包名、原子性探针用的 base 行 id。
 * 这些仅为名字常量,不含任何锁/重载实现形状。
 * @module tests/first100/fixtures/loader/blocked-359-live-reload-lock-gate/shared
 */

/** driver 打到 stdout 的单行前缀,spec 用它抓 JSON。 */
export const REPORT_TAG = 'BLOCKED-359-RELOAD-LOCK'
/** 场景:未入锁、带有效 Manifest v2 的本地包,经 live 编辑 insert → 应被原子性拒绝。 */
export const MAIN_RED = 'main-red-unlocked-manifest-v2'
/** 场景:已入锁、同样有效 Manifest v2 的本地包,经同形 live 编辑 insert → 照常挂上。 */
export const CONTROL = 'control-locked-manifest-v2'
/** 两场景各自 subject 本地包名(均安装在各自 profile 的 node_modules)。 */
export const UNLOCKED_PKG = 'dsh-blocked-359-unlocked'
/** 已入锁的 subject 本地包名。 */
export const LOCKED_PKG = 'dsh-blocked-359-locked'
/** 原子性探针用的已有 base 行 id(dsh-base 挂的无包可观测行)。 */
export const PROBE_BASE_ROW = 'logger-stderr'
