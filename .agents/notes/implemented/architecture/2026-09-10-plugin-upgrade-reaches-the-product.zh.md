# Agent Note:插件升级事务接入产品

Status: implemented

[English](2026-09-10-plugin-upgrade-reaches-the-product.md) | 中文

## 问题

Epic P1-10 造出了一套六阶段升级事务:库全绿,产品零调用者。`runUpgrade` 只有自己的测试够得到;它消费的词汇(`PluginMigrationManifest`)没有任何插件作者会写;它作用的介质是自己发明的 `plugins/<name>/data/data.db`,树里没有第二处碰它。一个看起来完整的设计,可以有三种彼此独立的方式没有主语。

## Decision

`dsh plugin add` / `update` 现在真的跑这套事务。`runPlugin` 在**整段**跨进程 fencing 租约内执行——崩溃恢复、pnpm、数据迁移、层列表 reconcile——因为在包管理器与迁移之间释放租约,恰好重开这个 epic 要关掉的那个窗口:新代码已装、数据未转、另一个进程可以开始。

事务只通过 `StorageBackend` 的可选 `migration` facet 触达介质,永不命名路径。新增的 facet 操作 `stampedVersion` 回答升级真正要问的问题:**数据**在哪个版本。它既不是包版本(两者独立移动),也不是新构建想要的版本,而且只有介质知道。`storage-json` 的 `per-record` 布局报告"无版本戳":它按记录打戳,把异版本记录读作缺失——自愈,而非迁移。

清单词汇是**桥接**而非复制:`apps/cli/src/plugin-migration.ts` 从**已安装的新版本**读 P1-01 的 `dsh.migrations` 与 `dsh.dataStores`,由声明的 data store 推出 unit,并用 `import()` 加载每一步的模块——受与生产启动同一套 `evaluatePreMountAdmission` 把关,因为执行迁移模块就是在 CLI 进程里跑插件自己的代码。`MigrationDeclaration` 只增加一个可选字段 `module`;声明了步骤却不给模块,整条链拒绝执行,而不是去猜某种约定。

## Alternatives considered

**在 pnpm 之后、租约之外调用 `runUpgrade`。**最初的写法在环境体返回时就释放租约,包管理器跑在锁外。它更简单,并且重开了这个 epic 要关掉的那个窗口。

**给事务一条自己的路径。**原先的 `plugins/<name>/data/data.db` 不需要存储后端也不需要 facet,但它没有主语:harness 把插件数据放在存储 hub 的 unit 里,于是事务会去迁移一个没人读的文件。

**用本 epic 自己的词汇声明迁移。**让插件作者直接写 `PluginMigrationManifest` 就不需要桥。但那会是 P1-01 之外的第二份清单,而没有任何东西裁定哪一份权威。

**由包版本推出 schema 版本。**零成本,且错误:两者独立移动,升级会规划一条没有任何清单声明过的路径。

## Consequences

它买到的是一条产品路径:插件的数据跟随它的代码,在同一个租约下,跨任何实现了该 facet 的介质。它的代价是四处明确写下的缺口——公开承担,而不是藏在全绿的测试后面:

- **`validate` 与 `healthCheck` 无条件通过。**两者都意味着"问插件",而包管理器命令不挂载任何插件。它们仍是真实阶段,将来有了"启动插件探针",替换的只是两个闭包。
- **`backup` 与 `reversible` 在桥处兜底**,因为 P1-01 的声明两者都不带。兜底放在桥而不是决策包,是为了让缺口暴露在两套词汇相接的地方:今天每个声明的迁移都读作"有快照、可回滚",不可逆的迁移根本无法表达。
- **声明多个 data store 的插件不给 unit。**任选其一等于迁移它一半的数据。
- **`storage-sqlite` 尚无 migration facet**,所以该后端上的部署被具名拒绝(`backend-cannot-migrate`),而不是被静默跳过。

### 为什么记录

可复用的教训与迁移无关。一个 stage 可以在它自己的全部测试里全绿,却仍然没有生产主语,且有三条彼此独立的路径:没有调用者、发明的词汇、发明的介质。三者对测试套件都不可见,而找出它们靠同一个问题——说出那个 `grep` 找得到的生产调用点。
