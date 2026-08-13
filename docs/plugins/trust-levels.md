# Plugin Trust Levels

| Level | Conditions | Default Permissions | Allowed Environment |
|-------|-----------|-------------------|-------------------|
| L0-unknown | Only URL/package name | None | Cannot install |
| L1-inspected | Manifest parsed, static scan done | Quarantine | Local check only |
| L2-signed | Source, signature, SBOM, lockfile verified | Minimal read-only | Isolated testing |
| L3-verified | Dynamic behavior, permissions, compat, recovery tested | Manifest scope | Dev/test |
| L4-production | Org allowlist, version pinned, audit, rollback passed | Policy intersection | Production |
| L5-kernel-trusted | Official minimal TCB, independent security review | Fixed kernel API | Trust Kernel |

**Never**: Being listed in awesome-dsh-plugin or dsh-market does NOT grant production trust.
