# Agent Note: 与恢复竞争的 Team 发送报告共用投递的结果

Status: implemented

[English](2026-10-05-a-team-send-racing-recovery-reports-the-shared-delivery.md) | 中文

## Problem

`@deepseek-ai/dsh-experimental-agent-team` 承诺：发送方看到的结果，要么是消息已被目标 inbox 接受，要么是在投递暂时不可用时保留为 `queued`（包 README）。`sendMessage()` 在 Lead 的 journal 事务里追加 `team/message/queued`，等 flush 完成后再投递。这条追加在 flush 结束前就对读者可见；而 Lead resume 之后的恢复流程在这个事务之外运行，会投递它读到的每一条未投递记录。恢复流程先读到这条新记录时，就占住这条消息并把它投递出去；发送方自己的投递随后发现这个 id 已在途，返回 `false`，于是回执对一条目标已接受的消息报告 `queued`。S4 全量门（run 37266436298）在 `persistence.spec.ts` 里发现了它，同样的代码在 S3 全量门里是通过的。

## Decision

- `TeamMailbox.inFlightMessages`（`packages/experimental/agent-team/src/mailbox.ts`）把每个在途消息 id 映射到它的那次投递尝试，而不再只记录 id。
- `tryDispatch` 在返回之前先存下自己的投递尝试。发现 id 已在途的调用方拿到的是那次尝试，而不是 `false`，所以与恢复流程竞争的发送报告的是那唯一一次投递的结果。
- `dispatchThrough` 替某条消息投递排在它前面的记录时，按同一规则登记每次尝试。
- 不在途的记录照旧投递，所以投递不可用时消息仍保留为 `queued`。

## Alternatives considered

- **flush 之后重读 journal，恢复流程已投递该记录时报告 `accepted`。** 每次发送都多一次读取，而且恢复流程的投递还没完成时仍会回答 `queued`。
- **在 Lead 的恢复流程完成之前挡住发送。** 这会改变每个 Team 里恢复与发送之间的次序，而这个缺陷并不需要这样做。

## Consequences

- 发送与恢复流程处理同一条记录时共用一次投递尝试，两者都报告它的结果。
- 恢复流程遇到发送方正在投递的记录时，会等待那次投递，而不是跳过它。
