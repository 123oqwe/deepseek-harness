# Agent Note：宿主用户消解结果不明的外部副作用

Status: implemented

[English](2026-09-26-the-host-user-resolves-an-ambiguous-external-effect.md) | 中文

## 问题

BLOCKED-311，归 P4-12 acceptance[1]：结果不明的状态不盲目重试，而是进入对账。账本会拒绝 `ambiguous` 键后续的每一次尝试，但出厂产品上没有任何东西能清掉这条记录，所以一个抛错的工具会让它的键永远被挡住。lane A 的先红 A-529（`tests/first100/fixtures/P4-12.reconciliation.composition.spec.ts`）在出厂 headless profile 上观测到，没有任何命令能消解一条记录。

## 决定

- **一条操作者命令，归账本自己的插件。** `@deepseek-ai/dsh-action-ledger` 在组合了命令注册表的地方注册 `/resolve-effect <idempotencyKey> <confirmed|compensated>`；不带参数时，它列出所有范围的 `ambiguous` 记录。
- **只有宿主用户，能消解任何范围的记录。** 发起命令的 agent 必须以 `user` 主体行事，也就是 `@deepseek-ai/dsh-workspace-trust` 叫作 `isHostUserPrincipal` 的那个判断。子 agent、workflow 子运行、webhook 会话在各自的范围下预留，又都代表宿主用户干活，所以键在所有范围的 `ambiguous` 记录里查找，消解写在记录自己的范围下；同一个键挂在不止一个范围下时，拒绝。宿主用户经审批界面被询问，除了 `allowed-once`，任何回答都不改动任何东西。第一版只在调用者自己的范围里查，这类记录因此永远卡住（盲审 T1-1，B-515 v2）。
- **不带消解的迁移，不会离开 `ambiguous`，也不会离开已了结的状态。** `markSent`、不带消解的 `confirm`、`markAmbiguous` 只移动 `prepared` 或 `sent` 的记录，所以进程内的调用方不经宿主用户就了结不了 ambiguous 的记录，过时的写者也拉不回已经消解的记录（盲审 T2-1，B-515 v2）。
- **永不回到 `prepared`。** 获批的消解把记录移到 `confirmed` 或 `compensated`。要重做，就是开一个带新键的新动作。
- **消解记录就是审计记录。** 它写明谁消解的、消解成什么、什么时候。store 在移动记录的同一个事务里写下它，而且只移动仍是 `ambiguous` 的记录；`entry()` 会返回它。`confirmed` 的消解没有 provider 回执，所以这条记录的回执摘要是这份消解记录的摘要。
- **store。** 新增 `markCompensated`，与 `markAmbiguous` 并列；`confirm` 可以带一份消解记录；`listAmbiguous` 读出一个范围里正在等待的记录，`listAllAmbiguous` 读出所有范围里的。消解记录放在单独的表里，所以第 2 版的账本文件在打开时就会得到这张表，不需要迁移。

这些是 delegate 在 2026-09-24 定下的默认值（A-312），以及 2026-09-26 的契约（first100-delegate-1a，gate3）。

## 考虑过的其他做法

- **账本层面的 `resolve` 方法。** 契约让出厂路径是一条操作者命令，而不是新的缝方法，这样先红与实现照同一个设计走。
- **引入命令注册表与审批服务的类型。** `@deepseek-ai/dsh-commands` 与 `@deepseek-ai/dsh-user-approval` 经 agent、LLM 与 retry 包依赖到本包，引入就会形成依赖环。插件为这两个服务和发起命令的 agent 声明结构视图，与 `@deepseek-ai/dsh-memory` 对它的 proposal policy 的做法相同。
- **在账本表上加消解的列。** 已有的文件就需要迁移或新的 schema 版本；单独一张表不需要。
- **查询目标状态。** 没有 provider 支持（must[3] 的另一半），所以目前由宿主用户来对账。

## 后果

- `ambiguous` 的键只能经宿主用户获批的消解离开这个状态；没有命令注册表或审批界面的组合，无法消解这样的记录。
- 消解之后，对同一个键再 reserve，得到的是带着消解后状态的 `duplicate`，而不是 ambiguous 的拒绝。
- 早于这张消解表的构建照旧读账本，看不到消解记录。
- 验证：出厂 headless profile 上的 A-529，以及覆盖 store 与命令每个分支的 `packages/action/action-ledger/tests/resolve-effect.spec.ts`。
