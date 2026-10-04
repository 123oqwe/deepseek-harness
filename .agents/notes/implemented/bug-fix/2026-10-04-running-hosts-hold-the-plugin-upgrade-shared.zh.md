# Agent Note：运行中的宿主以共享方式持有插件升级

Status: implemented

[English](2026-10-04-running-hosts-hold-the-plugin-upgrade-shared.md) | 中文

## 问题

`dsh plugin` 以独占方式取 `dsh-plugin-upgrade` 租约来冻结插件升级，但没有任何运行中的宿主查看这份租约。升级迁移数据期间，宿主仍加载着插件代码，而 JSON 存储后端每次写入都会把单元的整个内存状态写回。于是旧代码可能按旧格式覆盖已迁移的数据，而升级照样以 0 退出（B-711b 1-4；P1-10 must[1]）。

## 决定

- 租约契约新增共享持有。`acquireShared` 让任意多个持有者共同持有一个条目，直到各自的持有到期；`releaseShared` 交还其中一份。有活的共享持有时，独占的 `acquire` 以 `held-shared` 拒绝；有活的独占租约持有该条目时，`acquireShared` 以 `held-exclusive` 拒绝。共享持有不授权任何工作，所以紧急停止对这两个调用都不设闸。
- 两个 provider 都实现它。持久 provider 把持有记在 `shared_holds` 表里，`acquire` 与 `acquireShared` 各自在一个 `BEGIN IMMEDIATE` 内运行，所以规则跨进程成立。内存 provider 把它们记在内存里。
- lease-sqlite 插件的 `sharedHolds` 配置列出挂载在整个生命周期内共享持有的条目。它每隔 `sharedHoldMs` 的一半重新取一次，卸载时交还；某个条目被独占持有时，它拒绝挂载。base bundle 列出 `dsh-plugin-upgrade`，所以每个出厂宿主都持有它。
- CLI 的升级以独占方式取这个条目，只要还有宿主持有就被拒绝，提示「close running dsh sessions, then retry」。run-lease 的拒绝与 workflow 引擎的 resume 都写明这个新原因。

## 考虑过的替代方案

- **每个会话一个读者条目，契约增加列出功能。** 登记读者与检查读者是两步操作，除非放在同一事务里，否则会有竞态；多出来的条目状态还要在宿主死掉时清理。
- **每次写入之前比对单元的版本标记。** 这只能事后发现写回，而不能阻止它；升级照样会在运行中的宿主之下进行。
- **按会话而不是按宿主持有。** 插件挂载时就打开自己的存储，不管有没有会话开着，所以读者是宿主进程。

## 后果

- 同一 harness 主目录下只要有宿主在运行，`dsh plugin` 就无法安装；升级持有该条目期间，宿主也无法启动。
- 宿主若被挂起超过 `sharedHoldMs`，会失去持有，升级可能在它之下进行；宿主下一次续取会被拒绝并记入日志。
- 未覆盖：内存 provider 的持有不跨进程，所以挂内存 provider 而不挂 lease-sqlite 的组合没有跨进程的冻结。出厂 bundle 挂的是 lease-sqlite。
