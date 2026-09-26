# Agent Note：浏览器发出的中断在生效之前提交到持久总线，重启后的宿主会重放它

Status: implemented

[English](2026-09-26-an-interrupt-is-recorded-before-it-takes-effect.md) | 中文

## 问题

BLOCKED-343，P5-10 must[2] 与 acceptance[0] 跨越宿主重启的部分。`interruptByParent` 只把中断记在运行时为每个 child 维护的控制路由器里，那是内存。优雅关停或崩溃之后，新的路由器从 `running` 开始，发给被中断 child 的浏览器提示词于是被接纳，把它唤醒。lane A 的 A-463 在出厂 headless profile 上量了两种重启（run 36213135083）：child 收到提示词后跑完了一整轮。包的 README 也把这一点列为已知限制。

## 决定

- **中断在取消信号之前、同步地提交到持久消息总线。** activation registry 在核对 parent 地址之后立刻提交，作为一条 domain event，键的取法与 settlement 相同：source 为 `subagent-interrupted`，id 为 child 会话，epoch 为被中断那次驻留的 lease epoch，subject 为 parent 会话。提交是总线 `DatabaseSync` 上的一次 `BEGIN IMMEDIATE`，所以 `interruptByParent` 返回时记录已经落盘；提交抛错时，中断失败，什么都没有取消。
- **lease epoch 就是中断的身份。** `interruptByParent` 不带 request id。两次中断相同，是因为它们停的是同一次驻留，而那个 epoch 由 lease store 签发。同一次驻留里再中断一次，会发现记录已经 consumed，不再提交。
- **重启后建的路由器会重放记录。** `controlFor` 问总线这个 child 有没有哪次驻留被中断过；有，就做出实时中断做过的两个观测：取消已被接纳，child 已经停下。路由器于是处于 `terminal`，不接纳任何提示词或 steer，再重放一次也不变。`interruptByParent` 在 registry 记录之前先建自己的路由器，所以它自己的中断走收敛屏障（must[3]），不会被当成已经停下来重放。

## 考虑过的替代方案

- **写进 child 会话日志的一条事件。** 实时会话事件先缓冲，再异步写盘，所以中断时追加的记录，在宿主于下一轮之前被杀掉时会丢失，这正是 A-463 的崩溃情形。
- **从 child 的日志读出停止。** 优雅关停之后，用户的取消会在日志里结束那一轮；崩溃之后只剩会话修复写下的 `interrupted`，而会话修复对每个被崩溃截断的轮次都这样写，包括没有人停过的 child。
- **单独一个文件。** 总线本来就是 settlement outbox 所用、带 epoch 键的持久 intake 记录，运行时也本来就依赖它。

## 后果

- 优雅关停或崩溃之后，发给驻留时被中断的 child 的浏览器提示词或 steer 会以 `subagent/not-resumable` 被拒绝。
- 以下情形不留记录：child 没有驻留的 Activation（此时中断是被接受的空操作，不核对 parent 地址）；驻留没有 lease epoch（没有 Run Service，或它的 lease 被拒）；总线是内存总线。README 的已知限制写明了这几点。
- 记录在 `bus.sqlite` 里，不在 child 的会话日志里。A-463 那两条扫描会话日志的「可读到」用例，由 lane A 按这条记录重钉。
- 验证：A-463（`tests/first100/fixtures/P5-10.interrupt-across-restart.composition.spec.ts`）与 `packages/subagent/subagent/tests/interrupt-record.spec.ts`。
