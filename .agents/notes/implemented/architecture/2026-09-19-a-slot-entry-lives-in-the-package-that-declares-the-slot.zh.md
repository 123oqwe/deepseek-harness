# Agent Note: 槽位的占用方住在声明该槽位的那个包里

Status: implemented

[English](2026-09-19-a-slot-entry-lives-in-the-package-that-declares-the-slot.md) | 中文

## Problem

`ui-session` 把主机停机指示器注册进了 `shell.overlay`。该槽位由 `ui-layout` 声明，而 `ui-layout` 本来就引用 `ui-session`——于是这次注册要的是一条不可能存在的边。该 key 从未进入 `ui-session` 的 program，`'shell.overlay'` 也不满足 `SlotMap` 约束，三条结构性类型错误由此而来。

同一个 program 里另外 167 条错误只有一个成因，而且它更有教益。`ui-session` import 了 `@deepseek-ai/dsh-client-locale/client` 却没有对应的 project reference。有 reference 时 TypeScript 读被引 project 的声明输出；没有时，`paths` 把该说明符解析到那个包的**源码**，于是整个传递源码闭包并入本 project 的文件表。在 `rootDir: src` 的 composite project 里，这些文件每一个都在 root 之外——82 条 TS6059 加 82 条 TS6307——更糟的是它们的 emit 不再落进 `outDir`：构建把 `LanguageRow.js` 写在 `packages/client/locale/src/client/LanguageRow.tsx` 旁边、把 `contract/slots.d.ts` 写在 `ui-settings` 的源码旁边，随后 Vite 把 import 解析到这些产物上，54 个 client 用例文件在收集期失败，而失败的样子与「少写一行 tsconfig」毫无相似之处。

两类失败在本机都不可见：类型错误要 `tsc -b`（本 lane 不跑），收集失败要跑测试套件。

## Decision

**条目住进 `ui-layout`——声明 `shell.overlay` 并渲染它的那个包。** 三条性质必须同时成立，而只有这个包让三条都是结构性的、而非恰好如此：

- 它声明该槽位（`src/client/index.ts`）并渲染该层（`AppFrame.tsx`），所以这个 key 根本不需要任何依赖边，也无从成环。
- 它本来就在通过指示器所需的同一个 `useSessions` 标准钩子读 `SessionListState`：`DocumentTitle` 在框架的每一次渲染里选取当前会话标题。在它旁边读 `state.hostControl` 同样不需要新边，指示器也没有给这个包添加任何它原本没有的运行期要求。
- 任何组合都不可能在没有它的情况下挂上 `AppFrame`。全仓只有一个组合文件提到 `@deepseek-ai/dsh-client-ui-layout`——`packages/bundle/web-app/cordis.patch.yml`——而且没有第二条挂框架的路径。功能包能承诺的只是「出厂组合今天恰好挂了我」。

同样满足 (a)(b) 的候选——`ui-sidebar`、`ui-chat`、`ui-workspace`、`ui-conversation`、`ui-sidebar-right`——都因此第三条不成立，而且没有一个的主题是主机控制。

**`locale` 是 `ui-layout` 已声明的依赖**，所以字典在一个普通 effect 里注册。在 `ui-session` 里它只能是嵌套的 `ctx.inject(['locale'], …)`，因为 `SlotTestRuntime.create` 会原样复用该包的 `inject` 数组、而那个 context 不提供 locale 服务——正是这层嵌套让一条注册用例一直空过到被查出来为止。

## 这条经验的一般形式

**要么从声明槽位的那个包注册进去，要么从已经依赖该包的包注册进去。** 依赖方向由声明固定，站在它错误一侧的注册方没有合法的边可用。症状不是「少一条 reference」，而是槽位 key 不满足 `keyof SlotMap`；为此加一条 reference 反而会成环。

**并且一个 project 的源码 import 的每一个包说明符都需要一条对应的 project reference。** 这不是整洁问题：没有它，被引包的源码会进入本 project 的文件表，而 composite project 会把它 emit 到自己的 `outDir` 之外、落进别的包的源码树里。少一条 reference 不是类型检查上的不便，它会写文件。

## Alternatives considered

**新建 `ui-host-control` 包。** 对该条目而言这是最诚实的主题，被否是出于成本与风险：新建 workspace 包需要手写 lockfile importer，写错会让 CI 在安装期就红——而这里的改法只需在既有块里加三行、删两行。`ui-layout` 给出的 (c) 也比新包更强：新包必须被挂载，而 `ui-layout` 不在场就不存在框架。

**反过来加 `ui-layout` → `ui-session` 的边。** 不可能：这条边已经存在，它正是问题本身。

**把 `shell.overlay` 的声明下沉到 `ui-slots`。** 开工前即被 delegate 否决：那是为迁就一个注册方而改动上游槽位的归属。

## Consequences

`ui-session` 少了两条依赖边（`client-locale`、`client-test-runtime`），`ui-layout` 多了三条仅测试用的；manifest 与 lockfile importer 同笔移动。`ui-session` 的 `css-modules.d.ts` 随该包最后一个 `.module.css` 一起删除。

断言该注册的两条用例也一并搬家，并在途中变强：它们现在跑在 `ui-layout` 自己的 apply 用例文件已经搭好的**真** `SlotRegistry` 与 `LocaleRuntime` 台架上，而不是一个 mock 的 `slots` 对象——在后者上，一个任何渲染器都不会接受的 id 与 order 什么也证明不了。`ui-session` 保留了被删那一对真正想说的那件事：`inject` 仍然只含共享测试运行时提供的那两个服务。

## Related

同一周的一次组合改动从另一个角度显出同样的形状：`packages/bundle/sdk-minimal/cordis.patch.yml` 加了三行，而两个逐行枚举其行清单的用例仍期待旧的条数。其一在 CI 红了；另一个持有逐字相同的一份清单（从构建出的二进制回读），同样过期，只因那一轮根本没跑到才没红。找出第二个读者的普查命令是 `git grep -n "sdk-minimal" -- '*/tests/*' 'scripts/*'`，教训与本篇相同：**当一份产物有不止一个读者时，改动在普查说清有哪些读者之前不算做完。**
