# Agent Note: 一个机械化的 capability-seam 边界执行器（`architecture.layers.json` / `pnpm run architecture:seams`）

Status: implemented

[English](2026-09-01-capability-seam-enforcement-scanner.md) | 中文

## 问题

[capability-seam 术语表条目](2026-06-13-capability-seams.zh.md)把 Service Definition / Service Provider / Consumer 三分表述为一种命名与打包约定，但没有任何东西机械化地检查它：一个 consumer 包可以深层导入某 provider 的 `src/*` 内部实现，一个 provider 包也可能反向依赖 app/UI 代码，而不会触发任何 CI 信号。执行力完全依赖跨 256 个 workspace 包、29 个已声明 capability family 的评审自觉，这不可扩展，也让边界随新包加入而悄然侵蚀。

## 决策

现在有两层沿仓库自身的 Contract/Consumer 约定分工执行这一边界：

- **`architecture.layers.json`** 为每个 capability family 声明 `id`、`definition` 包、`providers[]`、`consumers[]`、允许的跨 family 依赖边，以及一份带日期、带责任人的 `allowlist[]`（覆盖既有例外）。
- **`scripts/architecture/capability-seams.ts`** 是纯检测器：对上述 JSON 做 schema 校验，以及在已解析事实的基础上运行违规检测函数（consumer 深层导入 provider 的 `src/*`、provider 反向依赖 app/UI、family 无 consumer composition 或卸载测试导致的不可逆注册）。它不做任何文件系统 I/O。
- **`scripts/architecture/check-capability-seams.mjs`** 是真实扫描器：对每个包做真实的 workspace `package.json` 与 TypeScript 静态 import 遍历，产出已解析事实（截至本文撰写时为 4175 条跨包 import 边），并将其喂给 `.ts` 检测器的纯函数。`pnpm run architecture:seams` 将其作为真实 CLI 入口运行，打印违规的依赖边、源文件与修复建议，并在存在任何未被 allowlist 覆盖的违规时以非零码退出。

两个文件各自独立定义了一个 `isPlainObject(value)` 守卫（二者不共享运行时——一个是 workspace TypeScript 构建下的 `.ts` 模块，另一个是纯 `.mjs` 脚本），在读取从 `architecture.layers.json` 解析出的 `families[]` 或 `allowlist[]` 数组元素的任何字段之前先行校验。这堵住了一类真实的崩溃：早期一轮容错测试只校验了这些字段是否为数组，未校验每个元素本身是否为格式良好的对象，导致 `families: [null]`、缺失 `owner` 字段的 allowlist 条目、或缺失 `providers`/`consumers` 的 family 各自触发未捕获的 `TypeError`（读取 `null`/`undefined` 上的属性），而不是报出清晰的 schema 错误。`check-capability-seams.mjs` 的 `hasScannableShape()` 用同一校验把整个真实扫描挡在前面，因此格式不良的 `architecture.layers.json` 会失败关闭（报出 schema 错误、零违规），而不是试图对不安全的形状继续扫描。

`architecture.layers.json` 的 allowlist 里有两处首次真实扫描时暴露的既有缺口（`authorization` 与 `userQuestions` 两个 family，均为基于注册、无专属包的 provider），以带日期、带责任人的条目形式记录，而非改代码——这与验收标准（每条 allowlist 记录都要有删除日期与责任人）一致。

## 考虑过的替代方案

**用通用依赖图 linter（例如现成的 import-boundary ESLint 规则）取代定制扫描器来检测违规。** 已拒绝：通用工具只理解静态 import 图，不理解本仓库特有的 family/definition/provider/consumer 词汇及其允许边与 allowlist 语义（带日期、带责任人的例外在这里是一等概念，不是一条抑制注释）。定制扫描器让执行用的词汇与它所执行的术语表条目保持完全一致。

**把数组元素格式良好性校验并入一个共享模块，供 `.ts` 检测器与 `.mjs` 扫描器共同 import。** 本轮已拒绝：两个文件目前不共享构建或模块解析路径（`.mjs` 作为纯 Node 脚本运行，在 workspace TypeScript 项目之外），因此共享模块本身需要一个独立的打包决策。本轮判断：为这四行守卫单独复制一份，比现在就做那个打包决策更省成本；等 `.mjs` 扫描器未来有了真正的构建步骤，可以重新评估合并。

## 后果

收益：capability-seam 边界违规现在是 CI 可见的失败，带具体的边、文件与修复建议，而不是评审时的主观判断。格式不良或对抗性的 `architecture.layers.json` 内容——缺字段、数组元素为 null、元素非对象、`owner` 非字符串——现在报出清晰的 schema 错误并以非零码退出，而不是让进程崩溃；这一点已分别针对纯检测器直接调用和真实 CLI 子进程路径验证过。

成本：格式良好性守卫在两个文件里手工复制，在 `.mjs` 扫描器获得真正的构建路径之前，只能靠约定而非编译器保持同步。本轮范围之外还留有一个更窄、已知的缺口：某个 family 的 `id` 字段存在但非字符串（例如是个对象）时，目前会静默地在 `=== ''` 比较上失败，而不是报出一个更具体的类型错误——不会崩溃，但报错不如本轮为数组元素场景加的守卫精确。
