# Policy Language

A simple declarative policy language for expressing rules.

## Syntax

```
deny <capability> because "<reason>"
allow <capability> when <condition>
require-approval <capability> from <approver>
limit <capability> to <n> actions per <seconds> seconds
```

## Evaluation

Rules are evaluated by priority (deny > allow > require-approval > limit).
First matching rule wins. No match = default deny.

## Dry Run

`dryRun` produces the same result as `evaluate` without side effects, allowing safe preview of policy decisions.
