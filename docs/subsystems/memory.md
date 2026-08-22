# Memory Service

Provider-neutral Memory Service Definition for the Harness.

## Service Definition

The Memory Service provides:
- Store: persist a MemoryRecord with source, confidence, TTL, scope, and purpose
- Retrieve: get a record by ID (expired records return undefined)
- Query: filter by tenant, principal, scope, and content filter
- Delete: remove a record by ID
- Expire: bulk-delete all expired records

## MemoryRecord Fields

| Field | Description |
| --- | --- |
| id | Unique MemoryId |
| principalId | Owning principal |
| tenantId | Owning tenant |
| content | The memory content |
| source | Where the memory came from |
| confidence | 0-1 confidence score |
| ttl | Time-to-live in seconds |
| scope | session, tenant, or global |
| purpose | Why this memory exists |
| expiresAt | When this memory expires |

## Provider-Neutral

The service definition is provider-neutral. Concrete providers (vector DB, graph DB, in-memory) implement the MemoryProvider interface.
