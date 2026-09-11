# P2-11 — Permission Preset as a full Policy Profile

This epic has not started: the ledger row is `NOT_RUN` with all four cells `NOT_RUN`, and `command-freeze.json` holds no live entry for it. The page exists because another epic added a field to a surface this one will own, and the addition should be readable from here rather than only from that epic's commits.

## A field P1-07 added to the approval request

`ApprovalRequest` and the `approval/asked` session event gained an **optional** `subject`, added by P1-07's host-user trust interaction (delegate ruling, §12.85 note 27, recorded as OQ27).

**Purely additive, and measured as such rather than asserted:**

| what did not change | evidence |
| --- | --- |
| `toolName` stays required | its type is unchanged in `ApprovalRequestEvent` and in the `approval/asked` payload |
| the runtime invariant is unchanged | `user-approval/src/invariant.ts:34` still fails an empty `toolName`; only its comment gained a sentence saying what it refuses is an audit entry naming NOTHING, not an entry naming something uncallable |
| `ApprovalOutcome` is unchanged | `'allowed-once' \| 'rejected' \| 'cancelled' \| 'unavailable'`; approval stays one-shot and P1-07 records its durable effect on its own session event |
| the answerers are unchanged | the Web panel already renders `reason` when present and falls back to the `toolName` sentence only without it; ACP declines any request with no `callId` and so never sees a trust question |
| the Remote projection is unchanged | `ClientApprovalRequest` is derived from the same declaration |
| the session log format is unchanged | an added optional field is not a structural change, so `SESSION_FORMAT_VERSION` does not move |

**Why an alternative was refused.** The first shape proposed made `toolName` optional when `subject` was present. Measurement showed that is not additive: `./invariant` is a published export of `user-approval`, and it asserts `toolName` non-empty on every `approval/asked`. Making the field optional would have weakened a published runtime invariant — a guarantee that every approval question in the log names what it was about. The field stayed required and its documentation was corrected instead: `toolName` is **the name of the subject**, usually a tool and not necessarily a callable one, so `workspace-trust` is a real capability identifier rather than a fabricated tool name.

**What this epic inherits.** When P2-11 takes ownership of the approval surface as a policy profile, `subject` is already in the vocabulary and carries the particulars of a decision that has no `callId` to point at. Nothing about it presumes P2-11's design; it can be renamed, widened, or folded into a richer request shape, and the only consumer to update is P1-07's trust interaction.

## Evidence for the additive claim

Every suite the change could disturb, run before and after on the same tree, with the passing case names compared rather than the counts:

```
before:  268 passed, 0 failed
after:   268 passed, 0 failed
cases that stopped passing: 0
```

Covering `packages/policy/risk-taxonomy`, `packages/interaction/permission-presets`, `packages/mcp/mcp-client/tests/annotations.spec.ts`, `tests/architecture/risk-domain-tags.spec.ts`, `packages/core/tools/tests/tools.spec.ts` and `packages/interaction/user-approval/tests` — which together are every live P2-04 frozen command plus the approval package's own suite and its invariant's. P2-04 is `ACCEPTED` with four GREEN cells, so its frozen cases are the ones a regression here would show up in first.
