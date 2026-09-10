# Agent Note:插件升级事务接入产品

Status: implemented

[English](2026-09-10-plugin-upgrade-reaches-the-product.md) | 中文

## 问题

Epic P1-10 造出了一套六阶段升级事务:库全绿,产品零调用者。`runUpgrade` 只有自己的测试够得到;它消费的词汇(`PluginMigrationManifest`)没有任何插件作者会写;它作用的介质是自己发明的 `plugins/<name>/data/data.db`,树里没有第二处碰它。一个看起来完整的设计,可以有三种彼此独立的方式没有主语。

## Decision

`dsh plugin add` / `update` 现在真的跑这套事务。`runPlugin` 在**整段**跨进程 fencing 租约内执行——崩溃恢复、pnpm、数据迁移、层列表 reconcile——因为在包管理器与迁移之间释放租约,恰好重开这个 epic 要关掉的那个窗口:新代码已装、数据未转、另一个进程可以开始。

事务只通过 `StorageBackend` 的可选 `migration` facet 触达介质,永不命名路径。facet 操作 `stampedVersion` 回答升级真正要问的问题:**数据**在哪个版本。它既不是包版本(两者独立移动),也不是新构建想要的版本,而且只有介质知道。`storage-json` 的 `per-record` 布局报告"无版本戳":它按记录打戳,把异版本记录读作缺失——自愈,而非迁移。

清单词汇是**桥接**而非复制:`apps/cli/src/plugin-migration.ts` 从**已安装的新版本**读 P1-01 的 `dsh.migrations` 与 `dsh.dataStores`,由声明的 data store 推出 unit,并用 `import()` 加载每一步的模块——受与生产启动同一套 `evaluatePreMountAdmission` 把关,因为执行迁移模块就是在 CLI 进程里跑插件自己的代码。`MigrationDeclaration` 增加了 `module`、`reversible` 与 `backup`,后两者在步骤带模块时必填;声明了步骤却不给模块,整条链拒绝执行,而不是去猜某种约定。升级作用的 unit 取自迁移模块自己导出的 `descriptor`——插件传给 `kv.open` 的同一个值——而不是由域名拼出来的形状。

## Alternatives considered

**在 pnpm 之后、租约之外调用 `runUpgrade`。**最初的写法在环境体返回时就释放租约,包管理器跑在锁外。它更简单,并且重开了这个 epic 要关掉的那个窗口。

**给事务一条自己的路径。**原先的 `plugins/<name>/data/data.db` 不需要存储后端也不需要 facet,但它没有主语:harness 把插件数据放在存储 hub 的 unit 里,于是事务会去迁移一个没人读的文件。

**用本 epic 自己的词汇声明迁移。**让插件作者直接写 `PluginMigrationManifest` 就不需要桥。但那会是 P1-01 之外的第二份清单,而没有任何东西裁定哪一份权威。

**由包版本推出 schema 版本。**零成本,且错误:两者独立移动,升级会规划一条没有任何清单声明过的路径。

## Consequences

它买到的是一条产品路径:插件的数据跟随它的代码,在同一个租约下,跨任何实现了该 facet 的介质——并且事务的每个阶段都真的能拒绝。`validate` 通过 facet 把迁移后的副本读回来,检查它确实物化了、带着它被迁移到的那个版本戳(仍停在旧版本的副本正是新构建打不开的那种)、且插件自己可选的 `validate` 导出接受它的内容;记录下的 digest 是介质对**内容**算的 digest,于是对账是数据与数据比对,而不是版本号与自己的另一次拼写比对。健康检查用新构建的 descriptor 经存储 hub 真开该 unit 并读取——仍停在旧版本戳的 unit 会在这里 `version-mismatch`,这就是产品意义上的"新版不可用"。`storage-sqlite` 也实现了该 facet:一个数据库承载全部单元,所以快照是一个只装这个单元行的 sidecar 数据库;文件级复制会让回滚一个单元变成回滚全部单元。

`MigrationDeclaration` 现在要求:只要步骤带 `module`,就必须声明 `reversible` 与 `backup`,缺一则清单拒绝解析。桥不再兜底:被兜底成 `reversible: true` 时,must[2] 恰恰在它存在的那种情形下不可达;现在 `dsh plugin update --confirm <digest>` 有了一条能索要确认的路径。不可逆升级会在权衡任何确认**之前**把该 unit 导出到操作者自己保管的路径,然后带着要确认的 digest 拒绝;确认在 `runUpgrade` 内部校验——那是真正做出改变的操作,于是没有调用方能跳过它。

每一种拒绝都有名字。声明了多个 data store、带了步骤却不给模块、不导出 `descriptor`、或导出的 descriptor 版本与声明不一致的插件,都被具名拒绝并计为**失败**升级——这会把它的代码退回到它数据所在的版本,而不是留着新代码在下次启动时撞上旧数据。

它的代价,公开承担而不是藏在全绿的测试后面:

- **健康检查是"打开并读取",不是插件自己的判断。**包管理器命令不挂载任何插件,所以"它能不能用"只能用没有插件时最强的问题来回答:新构建的 descriptor 对上换入后的数据。数据能打开、但插件逻辑拒绝它的情形,这里抓不到。
- **声明多个 data store 的插件被拒绝,而不是迁移一半。**在若干 store 中迁移其一,等于搬动它任意一部分数据。
- **`per-record` 的 JSON 单元与 `:memory:` 的 SQLite 数据库没有迁移。**前者按记录打戳、把异版本记录读作缺失,因而自愈;后者没有目录来放 sidecar。两者都被具名拒绝。

### 第一版 facet 写入的介质并不存在

第一版 `migration` facet 读写的是 `{ version, records }`。而 JSON 后端真实的文档是 `{ unit: { name, version }, global, tables }`——`format.ts` 一直这么写着——于是 `stampedVersion` 在任何真实单元上都找不到版本戳,而一次迁移会重写一份没有任何人打开的文档。九条 facet 用例全绿,因为每一条都自己播种那个被发明出来的形状,再把它读回来。

这与被发明的 `plugins/<name>/data/db` 路径是同一种失败,只是低一层、更难看见:不是"没人写的路径",而是正确文件里"没人写的格式"。修复是结构性的而非改一个字面量——facet 现在转换 `UnitContent`(即 `KvUnit.loadAll` 返回的同一个值),并通过 `format.ts` 自己的 `serialize` 写出。用例改为经 `kv.open`/`putRecord` 播种,于是它们断言的介质就是后端真正产出的介质;其中一条用新 descriptor 重新打开换入后的单元:任何其他格式的迁移文档都会在那里失败。

### 同一个"第三因",低一层

本程序反复重新推导出的那条发现是:一次变异没能变红,只有三种原因——套件弱、变异等价,或者**测试根本没有在跑被变异的代码**。被发明的 `{ version, records }` 格式,是第三因换了副面孔:测试**确实**跑了那段代码,代码也确实做了它们要求的事;两边都没碰到的,是产品真正读取的那个格式。一个套件可以与一则虚构自洽,而其中每条用例都通过。

区分它的探针不是打印语句,而是一次往返:用真实的写入方播种,用真实的读取方断言。本 epic 的两处介质缺陷——被发明的路径与被发明的格式——都死于同一个问题,只是这次问的是数据而不是调用者:说出那个"其输出正是这条测试所读"的生产写入方。

### 为什么记录

可复用的教训与迁移无关。一个 stage 可以在它自己的全部测试里全绿,却仍然没有生产主语,且有三条彼此独立的路径:没有调用者、发明的词汇、发明的介质。三者对测试套件都不可见,而找出它们靠同一个问题——说出那个 `grep` 找得到的生产调用点。
