# Agent Note：stdio 上按请求创建的会话以 host user 身份行动

Status: implemented

[English](2026-09-19-stdio-per-request-sessions-act-as-the-host-user.md) | 中文

## 问题

P2-01 让会话带上 host-user principal，它覆盖的四个调用点都是从配置的 `agents:` 行、或从程序化 root 创建 agent 的那些：`boot/app-boot` 经 `HOST_USER_IDENTITY_KEY`、`bundle/headless`、Web session controller，以及 workspace 启动授权。而**按请求**创建 agent 的两个面——`packages/acp/acp` 与 `packages/sdk/server`——一个调用者都没有，于是这两者做的每一个动作都被归属到 `anonymous:<sessionId>`，即 `action-manifest/src/identity.ts` 里那个"未认证本地工作"的兜底。

当时记录在案的理由是"经 socket 到达的请求不是这台机器的 host user"。这句话出现在五处，而对这两者都不成立：两者都是纯 stdio，由本地用户 spawn，进程也归该用户所有。这句话真正成立的面是 webhook ingress，它保留例外。

该 epic 的签核为此被撤回过两次——一次是原始缺口，一次是对当时已知的四个调用点重签之后。第二次撤回即 [BLOCKED-291](../../../../spec/first100/exec/BLOCKED-QUEUE.md)。

## 改了什么

两个面现在都在组装 agent 的那一点读取启动器提供的工厂，与 `agent-loop` 对配置行已经采用的机制相同：

- `acp/src/index.ts` 新增 `agentOptionsFor(ctx, config)`，`session/new` 与 `session/resume` 都走它。resume 与 create 同样要紧：不走它的话，恢复出来的 agent 是无身份组装的，而一条断言"resume 不增加第二条 `identity/attached`"的用例会因为错误的原因成立。
- `sdk/server/src/server.ts` 在 `createSession` 里读取它，那是该面唯一组装 agent 的地方。这一面没有 resume 半边要覆盖:SDK 的请求全集是 `initialize`、`session/prompt`、`shutdown`,没有一个能点名已存在的会话,而 `session/prompt` 永远创建——持久后端随即拒绝一个日志已在磁盘上的 id(`session-persistence-jsonl/src/index.ts:317-318`)。这个缺口由 [BLOCKED-298](../../../../spec/first100/exec/BLOCKED-QUEUE.md) 收着,acceptance[0] 的两次启动证据在 ACP 那条用例里。

走 context key 而不是直接调用 `hostUserIdentity()`（后者是 `bundle/headless` 与 Web controller 的做法）：解析一个身份会碰 `$DSH_HOME`，而不提供工厂的组合——每个直接挂载这两个插件的单元套件——必须什么都不附着，而不是往开发者的 home 里写身份文件。手工挂载的 harness 保持匿名是诚实的结果，不是缺口。

两个包各自新增 `@deepseek-ai/dsh-agent-loop` 与 `@deepseek-ai/dsh-principal` 的 peer 加 dev 依赖，并补上对应的项目引用——分在两笔提交里而不是一笔:ACP 那半在 `a816deb892`,SDK server 这半在本笔。config catalog 只随 ACP 那半移动(本笔之后重新生成它逐字节相同),module graph 两半各动一次。前者是运行时边，用于那个 key 与它的工厂类型；后者只承载 `RunId` 品牌，type-only，形状与两个文件对 `SessionId` 已有的用法相同。

## 后果

**已录制语料会变。** `anonymous:` 出现在 acp 与 sdk 两棵树共 26 个已提交快照文件里，而 `identity/attached` 在其中一个都没有，却出现在 session 树的 104 个文件里。改动之后这些会话会带上 host-user principal 与各一条附着记录，因此 `pnpm run test:snapshot` 在语料刷新之前是红的——按政策那是单独一笔，并且作为 diff 被审阅，而不是就地重新生成。其中 ACP 那一半的红**已经发生**:它从 `a816deb892` 起就存在,不是从本笔开始。

**证据落在启动器层。** 写在 `makeBridgeHarness` 或 SDK server 的 `mountPlugin` 上的用例，只能证明测试自己选择挂载的那些插件之间接线正确：两者都不加载任何 app 的 `cordis.patch.yml`，都不挂 app-boot，所以 `HOST_USER_IDENTITY_KEY` 在它们的 Context 里按构造就不存在。因此解锁用例 spawn 出厂启动器并读取 durable session log。它们是无 key 的，因为一个回环替身模型用一次真实工具调用回答该回合——acceptance[0] 讲的是 manifest，而 manifest 需要一个动作，所以只发 `session/new` 是展示不出来的。

**负对照是一笔提交,不是一个标记——而且它在两条面上的落法不同。** ACP 那条负对照在断言 `anonymous:` 与零条 attach 的形态下被观测为绿两次(run 35467913630 与 35475180584 的第 23 步),`a816deb892` 把它翻了过来。SDK 那条从一开始就断言同样的值,却**从未绿过**:它连续四轮超时,等的是一个服务端早已拒绝的回合上的 `turn/end`,直到 `afac505e1b` 让驱动不再那样等,run 35479346884 才第一次观测到它通过。这一笔的翻转是对着那一轮量的;在那之前没有可对照的东西。expected-failure 标记被考虑过并否决了:它对任何失败原因都算通过,包括环境坏掉,所以分不出「缺陷在」与「这一轮没跑起来」。
