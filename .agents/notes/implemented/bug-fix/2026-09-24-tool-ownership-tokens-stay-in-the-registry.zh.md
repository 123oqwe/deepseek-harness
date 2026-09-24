# Agent Note：所有权 token 留在工具注册表内部，只有动态 runner 可以声明拥有者

Status: implemented

[English](2026-09-24-tool-ownership-tokens-stay-in-the-registry.md) | 中文

## 问题

[命名空间与所有权裁决](../feature/2026-09-04-tool-registry-namespace-and-ownership-adjudication.zh.md)为每一次准入的工具注册铸造一个所有权 token，并把 `revokeOwned(token)` 作为撤销路径，理由是只持有 token 的调用方没有可替换的参数。但 token 并不私密。`ToolRuntime.ownershipOf` 与 `ownershipHistory` 返回完整的 `CapabilityRegistration`，其中包括 token；每个静态加载的插件拿到的又都是真实的 `ctx.tools`。因此任何插件都能读到其他插件的 token，并用它撤销那个插件的工具（BLOCKED-308）。

另有三条路径能让静态加载的插件把一次注册记在其他插件名下，清单链随后就把它显示为那个插件的：

- `declareOwner(identity)` 把调用方的子树绑定到任意身份，不论调用方是谁。
- `resolveOwner` 把调用方的 fiber 链与 `loader.entries()` 逐一比对，而后者是生成器，同一个生成器被每个 fiber 各遍历一次。第一轮就把它遍历完了，所以只有最内层的 fiber 真正被比对过；插件若在自己创建的子 fiber 里注册，就会落到那个 fiber 的 `Fiber.name`，而这个名字由插件自己写。
- 不被任何 Loader 条目包住的 fiber（例如根 fiber 的子 fiber），即使树里有 Loader，也会退回到它自己的 `Fiber.name`。

## 决策

- **读接口返回 `CapabilityRecord`**，即不带 token 的注册记录（`@deepseek-ai/dsh-plugin-ownership` 的 `Omit<CapabilityRegistration, 'ownershipToken'>`）。`claimCapability` 与 `requestReplace` 照旧铸造 token，由注册表持有；没有任何方法把它交出去。
- **移除 `revokeOwned`。** 它没有生产调用方。一次工具注册只能经由它自己的 effect disposer 移除，Cordis 在注册方 fiber 卸载时运行这个 disposer。每个 disposer 恰好移除它自己的工具与记录，must[3]（「卸载只撤销与 token 匹配的 effects」）在真实路径上就是这样成立的。`revokeByOwnershipToken` 留在库里，由它已冻结的用例观测 token 约定，没有生产调用方。
- **`declareOwner` 只接受位于 `ownership.ownerDeclarers` 所列条目之下的调用方。** 包住调用方的最内层 Loader 条目必须在这个列表中。默认值是 `@deepseek-ai/dsh-cordis-host-runner`，也就是唯一的出厂调用方：runner 把每个动态包的 fiber 建在一个组 fiber 之下，而组 fiber 由它自己的服务上下文创建，所以动态包的最内层条目就是 runner 的条目。
- **Loader 从注册表自己的上下文读取。** 构造函数捕获注册表挂载时所在的上下文，每次查找都从它读 `loader`。方法里的 `this.ctx` 是调用方的上下文；调用方若在自己的作用域里隔离 `loader`，就看不到 Loader，检查也就会被跳过。
- **每次查找都先把 Loader 的条目读成数组**，`resolveOwner` 与 `declareOwner` 共用这一个查找。从嵌套 fiber 发起的注册归属于包住它的最内层条目。别的条目树里的条目也算：preset 组合把它的各行挂在自己的条目树里，并让这棵树不出现在宿主 Loader 的 `entries()` 中，所以查找还会读 Loader 设在条目所挂每个 fiber 上的 `fiber.entry`，而且只在该条目自己的 fiber 上，并且其所在树的 fiber 在调用方链上更外层时才接受它。
- **树里有 Loader 时，来自任何条目之外的 fiber 的注册一律拒绝**，因为这样的 fiber 只有它自己取的名字。根 fiber 是例外：没有插件能给它命名，它以 `root` 的身份注册；`root` 不是官方身份，因此碰不到保留的 `dsh.*` 命名空间。有两个测试 driver 在启动好的根上下文上注册，这个例外让它们照常工作。没有 Loader 的树把注册记在它的 fiber 名称之下，那里任何调用方都可以声明。

## 考虑过的替代方案

- **保留 `revokeOwned`，另外核对调用方身份**（lane A 的 preFlight A-302 中的选项二）。未采用：token 仍然可读，只是不再单独构成凭证，这与身份核对重复；而且这个选项同样需要限制 `declareOwner`。
- **只把 token 交给它的拥有者**（选项三）。未采用：同一份记录会因读取方不同而有两种形状；这个选项同样需要限制 `declareOwner`。
- **对每个能解析出 Loader 身份的 fiber 一律拒绝 `declareOwner`。** 未采用：每个动态包都解析到 runner 的条目，这条规则会拒掉唯一的生产调用方。若收窄到只拒 Loader 条目自己的 fiber，从子 fiber 声明就能绕过。
- **用固定的声明方代替配置字段。** 未采用：哪个条目承载动态定义由部署决定。把 runner 挂在其他名字下、或另有一个动态宿主的部署，在 `ownerDeclarers` 中写上那个条目。
- **把条目之外的注册都记在一个固定身份下，而不是拒绝。** 未采用：拒绝能在注册那一刻把问题指出来；而条目之外唯一名字不由插件决定的调用方是根 fiber，它保留自己的身份。

## 后果

- 这些检查读的是 fiber 所处的位置，而 Cordis 让同一进程里的每个插件都能通过公开接口拿到它们。借助 `ctx.get('loader').entries()`，插件可以拿到另一个条目的 fiber 上下文，并在它之下放一个 fiber：这个 fiber 以那个条目的身份注册，放在声明方条目之下时还能声明。插件可以通过 `options.name` 给自己的条目改名，或者用 `loader.update` 改写 `ownerDeclarers`，这项改动还会被持久化。注册表的私有字段（其中包括 token）在运行时也读得到。为宿主 Loader 之外的条目读取的 `fiber.entry` 同样是公开字段，所以在自己创建的 fiber 上设置它的代码，可以让那个 fiber 以任意名字注册。这些途径交用户决定（BLOCKED-308，B 类）；本次改动不证明静态加载的插件不能以其他插件的名义注册。
- 拿到 `ctx.root` 的代码可以以 `root` 的身份注册。
- 同一条目下嵌套的两个插件现在共用这个条目的身份，因此它们之间的名称冲突由逐层的重复注册错误拒绝，而不再是 `capability-collision`。两者都会拒绝第二次注册。
- `CapabilityRecord` 与 `CapabilityRegistration`、`OwnershipToken` 一起列入 `gen-cordis-catalog` 的 `TYPE_LINK_EXEMPTIONS`，`RevocationResult` 则随 `revokeOwned` 移出。
