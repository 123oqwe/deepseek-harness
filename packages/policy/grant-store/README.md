# @deepseek-ai/dsh-grant-store
Reusable grants with scope rules, expiry, and revocation.
## Overview
- Issue grants with principal, resource, scope, constraints, expiry
- Match requests against active grants with scope hierarchy
- Revoke grants and cascade to descendants
- Enforce max amount and destination constraints
## Key Invariants
- Scope hierarchy: admin > execute > write > read
- Expired and revoked grants cannot match
- Parent revocation cascades to all descendants
