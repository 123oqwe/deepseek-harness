# Agent Note: 令牌增长保留每个派生祖先的 filter

Status: implemented

[English](2026-10-04-token-growth-keeps-each-delegated-ancestor-filter.md) | 中文

## Problem

`@deepseek-ai/dsh-capability-token-file` 里 BLOCKED-331 引入的增长分支，会在派生子会话的可见工具超出它的令牌时重新派生它。重新派生之前，它先给子会话的父会话签一张 root，覆盖父会话能看到的全部工具。父会话本身若是带 filter 的派生会话，这张 root 就顶替了它的受限令牌：只允许 `read` 的 launcher，在它起的 detached run 看到 `write` 之后，自己也持有了 `write`，run 同样如此（D8 的 control 用例，BLOCKED-363）。恢复的 run 所派生的子会话增长时，这个 run 也会这样被签一张 root。

## Decision

- `redelegateIfNeeded`（`packages/policy/capability-token-file/src/index.ts`）先算出一次重新派生能加入的名字：子会话可见、令牌里没有的工具，依次经过子会话自己的 filter 和每个派生祖先的 filter。向上走到第一个不是本挂载派生的会话为止。
- 走到的若是 root，照旧扩大它来覆盖这些名字；随后自上而下，每个派生祖先在自己的 filter 下从父会话重新派生，最后才是子会话。
- 走到的若是恢复（adopt）的会话，它不会被重签，名字以它持有的为界。
- 没有可加入的名字、令牌也没过期时，不重新派生，不花签名。

## Alternatives considered

- **只给 root 父会话增长，派生父会话之下不增长。** 只改一个条件，但组合放进子会话作用域的工具（如 `structured_output`），在任何派生父会话之下都会被拒，即使每一层 filter 都允许它。

## Consequences

- 派生会话在任何深度的权限都是它的 filter；只有子会话之上的每一层 filter 都允许，增长才能加入一个名字。
- 派生父会话之下，组合放入的工具只有在该父会话的 filter 允许时才能到达子会话。
