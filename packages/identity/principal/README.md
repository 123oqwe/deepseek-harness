# Principal Identity

Unified Principal, Tenant, Run, and Actor identity context.

## Principal Types

| Kind | Description |
| --- | --- |
| user | Real human user |
| service | Non-human system account |
| agent | Delegated sub-agent with chain |
| anonymous-dev | Restricted development principal (not admin) |

## Delegation Chain

Every action can be traced from root user/tenant through the full delegation chain to the current actor.

## Tenant Boundary

Cross-tenant delegation is rejected. Cross-tenant access is denied at both type and runtime policy layers.

## Replay Detection

Tokens are tracked to detect replay attacks.
