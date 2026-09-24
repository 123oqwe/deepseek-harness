# Agent Note: 分层与 seam 检查扫描声明的 workspace，其例外只认确切的边与用法

Status: implemented

[English](2026-09-24-layer-checks-scan-the-declared-workspace.md) | 中文

## 问题

`pnpm run architecture:layers`（Epic P0-04）与 `pnpm run architecture:seams`（Epic P0-03）各自用写死的 glob 选包。分层检查器读 `packages/*/*` 与 `apps/*`，seam 检查器只读 `packages/*/*`；`pnpm-workspace.yaml` 声明的 `vendor/*`、`native/system`、`native/system/packages/*`、`benchmarks`、`website` 与 `python/sdk-runtime` 都没有被读到。`vendor/*` 在未读之列，所以 vendored Cordis 的对等依赖（peer dependency）环从未进入分层检查器搜索的图。该检查器报告的内容还有四处缺口：

- 它只问全局最短的那个环是否被豁免，于是一个被豁免的短环会遮住所有更长的未豁免环；
- 环豁免按包集合匹配，不绑定图中的任何边，也不会变为陈旧；
- kernel 规则只看命名了绑定的顶层 import 与 export 声明，因此 `export *`、副作用 import、动态 `import()`、`require()`、模块增补、三斜线引用与 manifest（元数据清单）声明都看不见，外部模型 SDK 不论以何种形式出现都看不见；
- 未过期的 `kernelEdgeAllowlist` 条目可以压住任何 kernel 违规，包括 acceptance[1] 规定无条件失败的那些。

`main()` 会打印耗时，却只按违规数决定退出码，而 `docs/architecture/layering.md` 把 10 秒预算列为失败条件。

## 决策

**两个检查器都按 `pnpm-workspace.yaml` 枚举。** 各自用 `js-yaml` 读 `packages:` 模式，再对 `<pattern>/package.json` 做 glob；文件若没有声明任何模式就抛错，所以两个门禁都不可能靠什么也不扫而通过。分层检查器把 `vendor/` 下的包从六层分类中取出，放进单独的 `vendored` 映射；[`tests/first100/layer-package-map.json`](../../../../tests/first100/layer-package-map.json) 为新扫到、又没有目录规则覆盖的九个包指定层级：`@deepseek-ai/node-addon-system` 原生扩展及其 workspace 包与各平台二进制包、`benchmarks`、`website` 与 `python/sdk-runtime`。

**环图包含 vendored 包。** 它由生产包图加上所有从 vendored 包出发或指向 vendored 包的 `dependencies`/`peerDependencies` 边组成。vendored 的强连通分量 {`@deepseek-ai/cordis`、`@deepseek-ai/cordis-plugin-include`、`@deepseek-ai/cordis-plugin-loader`} 恰好含三个简单环，[`tests/first100/layer-cycle-exemptions.json`](../../../../tests/first100/layer-cycle-exemptions.json) 为每个环各写一条记录，`adrNote` 都指向本文。

**一条记录只豁免它的边所确定的那个环。** 记录按边序列出包，因此记录确定了自己的边；找到的环只在旋转意义下与记录相同时才算匹配。[`scripts/architecture/check-layer-deps.mjs`](../../../../scripts/architecture/check-layer-deps.mjs) 中的 `findUnexemptedCycles` 用两次搜索报出每一个未豁免环：对每条没有被任何记录列出的边，从该边的终点做广度优先搜索回到起点，得到经过这条边的最短环；在由已记录的边构成的子图上，找出所有没有对应记录的简单环。每个环都旋转到以最小的包名开头，最短的排在最前。记录列出了图中不存在的边，报 `stale-exempted-cycle` 违规；记录的 `adrNote` 不指向任何文件，或与更早的记录列出同一个环，按存储格式错误报出。

**kernel 依赖按构造找全，只有三种 Cordis 用法放行。** 对 `kernel` 层的包，检查器为它对排序 workspace 图之外的包的每一次使用打上标签，来源有三处：manifest 的 `dependencies`、`peerDependencies` 与 `optionalDependencies`；每一条顶层 import、再导出与 `declare module` 声明；以及 `ts.preProcessFile` 返回的其余所有模块引用，例如 `import()`、`require()`、`import x = require()`、import 类型或三斜线 types 引用。没有被任何声明对应上的引用标为 `*`，所以声明遍历没有列出的形式照样失败。acceptance[1] 按 2026-09-24 批准的收窄，只放行对 `@deepseek-ai/cordis` 的三种用法，而且只放行给收窄后的条文点名的 `@deepseek-ai/dsh-trust-kernel`：`Context` 导入绑定、该绑定所需的 `@deepseek-ai/cordis` 对等依赖声明，以及对 `Context` 接口的 `declare module` 增补。对 vendored 包的其他任何用法，以及其他 `kernel` 层包对 `@deepseek-ai/cordis` 的任何用法，都报 `kernel-forbidden-cordis-binding`；对既不是 workspace 包、也不是 Node 内置模块的包的任何依赖，都报 `kernel-external-dependency`。`devDependencies` 与测试文件不读。

**allowlist 放行不了 acceptance[1] 禁止的边。** `kernelEdgeAllowlist` 条目从不放行指向 vendored 包、外部包、`surfaces-apps` 包或 `providers` 包的 kernel 边。列出这样一条边仍算作用到了该条目，所以条目到期后报过期，而不是报陈旧。

**时间预算决定退出码。** `main()` 读取 `performance.now()`，它从检查器进程启动时开始计时，因而包括加载 tsx 与 TypeScript 的时间；运行超过 `--budget-ms`（默认 10 000）时，打印一行 `time-budget` 并以非零码退出。启动它的 pnpm 与 tsx 进程不在计时范围内。摘要行报出已分类包数、vendored 包数与 workspace 包总数。

## 考虑过的替代方案

**两个检查器共用一个枚举模块。** 否决：两个检查器属于不同的 epic，今天不共用任何模块；二者读同一个 `pnpm-workspace.yaml`，只有其中一个改动自己的读取方式时才会分叉。

**整个 Cordis 分量只写一条记录，按包集合匹配。** 否决：按包集合匹配只能豁免那个三包环，两个二包环仍未豁免；而且以后在同一组包上出现的、边序不同的环也会被一并豁免。

**删掉被豁免的边，再在剩下的图里找环。** 否决：与被豁免环共用一条边的环会随这条边一起消失。改为从每个包出发搜索，则经过该包的被豁免短环会遮住更长的环；枚举全部简单环在稠密图上呈阶乘级增长。

**把这三种用法给 `kernel` 层的每一个包。** 未采用：收窄后的条文点名的是 `@deepseek-ai/dsh-trust-kernel`，按层给出会把这三种用法扩到以后新增的 kernel 包，超出用户批准的范围。

**维护一份模型 SDK 名单。** 否决：名单只是对今天已有 SDK 的抽样；拒绝一切外部包则按构造就是完整的。

**在 vitest 套件里做墙钟断言。** 否决：在套件的并行负载下，整仓扫描测得超过 5 秒，这样的断言会取决于机器负载。套件用 `--budget-ms` 证明预算比较确实决定退出码；真实仓库对 10 秒默认预算的计时，由串行执行的 First-100 门禁运行负责。

## 后果

得到的：两个门禁都扫描 pnpm 安装的每一个包；vendored Cordis 环只能凭三条钉在各自边上的记录放行，环一变记录就失败。每一个未豁免环都会被报出；kernel 规则没有任何通道，能让某种导入形式、某条 manifest 声明或某条 allowlist 条目绕过它。

付出的：重新 vendor 时，若 `vendor/cordis`、`vendor/include` 或 `vendor/loader` 的对等依赖字段有变，必须在同一次改动里更新这些记录。kernel 规则看不见非字面量的 specifier、`import.meta.resolve()` 与 `require.resolve()`。只读 `src/**`，所以新扫到的四个代码不在 `src/` 下的包（`benchmarks`、`native/system`、`website`、`python/sdk-runtime`）只贡献 manifest 边；它们都没有入边，因此都不可能在环上。`optionalDependencies` 仍不在环图内；`pnpm-workspace.yaml` 里以 `!` 开头的模式不会被当作排除。
