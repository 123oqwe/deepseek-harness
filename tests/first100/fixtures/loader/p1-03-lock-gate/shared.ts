/**
 * A-550 P1-03 锁门组合层(lock-gate boot)在 driver 与 spec 间共享的名字:
 * 六个场景 id、各场景主语插件包名、主语插件注册的 tool 名、以及对照1里
 * 「安装自带、免锁」的 bundle 名(C17 方案 2′ 的范围对照)。
 * 这些仅为名字常量,不含任何锁实现形状。
 * @module tests/first100/fixtures/loader/p1-03-lock-gate/shared
 */

/** driver 打到 stdout 的单行前缀,spec 用它抓 JSON。 */
export const LOCK_GATE_MARKER = 'P1-03-LOCK-GATE'

// —— 六个场景 id —— //
/** 对照:锁中已批准且匹配的 profile 目录插件 → 启动 + ACTIVE。 */
export const CONTROL_LOCKED = 'control-locked'
/** 对照:锁中还记了一个普通依赖 → 照常启动 + ACTIVE。 */
export const CONTROL_ORDINARY_DEP = 'control-ordinary-dep'
/** must[2]:profile 目录装了、锁里没有的插件 → 启动被拒。 */
export const INSTALLED_NOT_IN_LOCK = 'installed-not-in-lock'
/** must[2]:锁写好后 manifest 改了(digest 漂移)→ 启动被拒。 */
export const MANIFEST_DRIFTED = 'manifest-drifted'
/** acceptance[0]:本地 cache 的 integrity 与锁不同 → 启动被拒。 */
export const INTEGRITY_MISMATCH = 'integrity-mismatch'
/** must[2]:无锁、已装插件的 profile → 按出厂 bundle 声明的策略(取最严)处置。 */
export const NO_LOCK_POLICY = 'no-lock-policy'

// —— 各场景主语插件包名(安装在各自 profile 目录的 node_modules)—— //
export const LOCKED_PLUGIN = 'dsh-p1-03-locked'
export const ORDINARY_DEP_PLUGIN = 'dsh-p1-03-ordinary-dep'
export const UNLOCKED_PLUGIN = 'dsh-p1-03-unlocked'
export const DRIFTED_PLUGIN = 'dsh-p1-03-drifted'
export const INTEGRITY_PLUGIN = 'dsh-p1-03-integrity'
export const NOLOCK_PLUGIN = 'dsh-p1-03-nolock'

/** 对照1里「随安装自带、按 C17 2′ 免锁」的 bundle(不在 profile 目录,启动不得因其无锁项而失败)。 */
export const SHIPPED_EXEMPT_BUNDLE = 'dsh-p1-03-shipped-exempt'

/** 每个主语插件 entry 注册(可观测)的 tool 名。 */
export const LOCK_GATE_TOOL = 'p1-03-lock-tool'
