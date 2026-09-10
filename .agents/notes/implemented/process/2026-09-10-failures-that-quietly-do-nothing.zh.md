# Agent Note:安静地什么都不做的失败,读代码找不到

Status: implemented

[English](2026-09-10-failures-that-quietly-do-nothing.md) | 中文

## 问题

把 `delegatingSession` 接进持久 subagent descriptor 需要改五处:类型、`CONTINUABLE_DESCRIPTOR_KEYS` 白名单、快照写入、`parseSubagentDescriptor` 的逐字段重建,以及 `continuation.ts` 里的重激活读取。前四处是通读整条路径、判定"每一段都已接好"之后改的。冷恢复时该值**仍然是 `undefined`**。

第五处是 `parseSubagentDescriptor`:它逐字段重建载荷,不在其清单里的键静默丢弃。读代码找不到它,因为要找到它,先得怀疑还存在第五段。一个写在派生语句正上方的探针,一次就打出来了:

```
applyComposition delegating=detached-run-session parent=cold-delegating-parent
applyComposition delegating=undefined            parent=cold-delegating-parent
```

本程序里有三个缺陷同形,且三者对外表现都与正常一致:

- workflow 引擎上的 `static inject = [..., 'agents']`。硬依赖缺失会让 Cordis **整个不注册**该服务,于是任何没有 agent registry 的组合都丢掉了整个引擎。由此产生的 53 条失败报的是 `unknown tool "workflow"` 与 `reading 'start' of undefined`,没有一条指向 `inject`。
- `parent.dispose?.()`。`dispose` 在 `AgentHandle` 上而不在 `Agent` 上,可选链把这次调用变成空操作,于是一个 detached 用例在其发起方从未结束的情况下通过。是仓库级 typecheck 点的名,测试点不出来。
- 上文那个写入了却在读取时从不重建的持久字段。

另有两处测量错误,让这一类更难被看见。本仓库里 `console.error` 探针什么都证明不了——vitest 对通过的测试不转发 console 输出,于是"它没打印"被读成"它没执行",而探针其实执行了。以及 `expect(x.isRevoked?.(token) ?? true)`:机制不存在时这条断言照样通过,它对该机制什么都没测。

## 决定

三条做法,每一条都能在缺陷被引入的当处逮住它:

**一个必须跨越边界存活的值,靠在对岸观测来证明,而不是靠追踪写入。** 对持久字段而言,对岸是**真重启之后**的读取——不是同上下文的重激活,那是热路径,根本不打开 descriptor。

**探针的沉默,只有在探针先被证明会响之后,才算证据。** 先拿一个确定会到达该行的用例跑它;若那样也不打印,坏的是探针,不是代码。在本仓库这意味着用 `appendFileSync`,不用 `console`。

**断言必须在机制缺失时失败。** 断言里的 `?.()`、`?? true` 和可选属性读取,都会把"不存在"变成"通过"。要在调用处、对观测到的效果断言。

机械的那一半是 `SUBAGENT_DESCRIPTOR_FIELDS` 加 `service.spec.ts` 里的往返用例:合法字段清单与重建器是两份必须一致的清单,用例现在从前者驱动载荷,于是新字段无法靠"没被写进样本"而免于覆盖。

## 考虑过的替代方案

**只用一条回归用例钉住 `delegatingSession`。** 否决:那只关掉这一个字段,下一个字段仍要用同样的方式被发现。缺陷是两份清单的不一致,守卫就该守在这个不一致上。

**用反射从解析器推导出被接受的字段清单。** 否决:解析器的接受逻辑是直线代码,运行时没有清单可读;仅为测试引入一份,只是把同样的重复挪到更不显眼的地方。

**要求每次改动后都跑仓库级 typecheck。** 跨包签名改动后本就要求,并且它确实逮住了 `parent.dispose?.()`。但它逮不住一个未写入的字段:`undefined` 是可选字段的合法值,没有任何类型是错的。

## 后果

换来:一道有牙的持久字段门——删掉重建会让相等断言失败,只往白名单加字段会让样本断言失败并点名该字段。`SUBAGENT_DESCRIPTOR_FIELDS` 给测试提供了可驱动的 schema。

代价:多了一个公开导出,而它唯一的消费者是测试。之所以导出而非私有,是因为另一条路(手写载荷)恰恰就是让一个字段能够无覆盖地加进来的原因。schema 增字段时样本表必须同步增条目;这是门本身,不是麻烦。
