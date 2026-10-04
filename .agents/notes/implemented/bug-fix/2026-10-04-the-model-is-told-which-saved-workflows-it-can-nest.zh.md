# Agent Note：告诉模型它能嵌套哪些已保存的 workflow

Status: implemented

[English](2026-10-04-the-model-is-told-which-saved-workflows-it-can-nest.md) | 中文

## 问题

workflow 脚本可以用 `workflow({ name, digest }, args)` 嵌套一个已保存的 workflow，但 workflow 工具的说明从未提到这个 hook，也没有任何东西告诉模型登记了哪些定义、它们的 digest 是什么。所以已保存的 workflow 只是在机制上能嵌套。在预设组合上，加载器还会在会话发布之后才完成，第一步取到的列表可能只是因为加载还没完成才是空的（B-729；P4-09，第 31 题 (a)）。

## 决定

- workflow 工具的说明写明 `workflow({ name, digest, onFailure? }, args?)` hook 及其行为：两个字段都要与目录里的条目相符；嵌套 run 使用父 run 的预算与深度；失败时 reject，除非设了 `onFailure: 'continue-parent'`。
- 对能解析到本工具的 agent，每一步之前由一个 pre-step 监听器把已登记的定义发布成一条持久的目录消息。消息用 `plugin` 来源、`catalog` 形式，每个定义一行 `name` 与 `digest`，因此记入会话日志。
- 监听器先等同一上下文中的已保存 workflow 加载器完成（`ctx.savedWorkflows.settled`）。加载失败时，消息写明原因。
- 只有目录变了、或上一条已离开可见范围时才再次发布。上一条目录是从会话投递的事件中记下的，因为新代码不得同步回读会话历史。
- worker-thread 引擎新增只读的 `registeredDefinitions()`，registry 新增 `currentDefinitions()`。

## 考虑过的替代方案

- **把列表拼进工具说明。** 列表一变，每次请求的说明都随之改变，缓存的前缀随之失效；而且工具 schema 不按会话记录。
- **加一节系统提示词。** 它是每个进程一份，不能调用本工具的 agent 也会看到；加载完成后才加上的一节，也不会发给之前开始的会话。

## 后果

- 预设组合上，agent 的第一步要等已保存 workflow 加载完成，才发出第一次模型请求。
- 恢复后的会话会再收到一次目录，即使目录没变。
- 未覆盖：定义不带 description，所以目录只列名字与 digest。没有 `registeredDefinitions()` 的引擎什么都不列。
