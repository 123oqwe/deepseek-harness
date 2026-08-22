# Agent Note: P6-08 — Static Encryption, Tenant Keys, Tamper-Evident Audit & Data Residency
## Problem
No static encryption, tenant key isolation, tamper-evident audit chain, or data residency enforcement.
## Contract
- KeyRing: per-tenant AES-256-GCM encryption with key rotation
- AuditLedger: hash-chained entries with tamper detection
- DataResidency: region policy with cross-border transfer checks
## State Machine
key-generated → encrypt → store → (decrypt|rotate)
audit → append → hash-chain → verify → (valid|tampered)
## Failure Semantics
- Wrong tenant key: decryption fails
- Audit chain broken: tamper detected
- Cross-border transfer without approval: blocked
## Rejection
- Cross-tenant key access: rejected
- Broken audit chain: detected
- Blocked region: rejected
