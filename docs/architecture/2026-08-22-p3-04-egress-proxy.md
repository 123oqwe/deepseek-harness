# Agent Note: P3-04 — Unified Network Egress Proxy & Destination Policy
## Problem
Network access not governed by unified policy; DNS rebinding and SSRF not prevented.
## Contract
- DestinationPolicy: allowed, blocked, allowPrivateIPs, allowLoopback, dnsServers
- evaluateEgress: URL + policy → decision with SSRF check
- DNS resolution before connection
## State Machine
request → dns-resolve → policy-check → (allow|deny)
## Failure Semantics
- Private IP (SSRF): blocked
- Loopback: blocked
- Not in allowlist: blocked
- In blocklist: blocked (wins over allowlist)
## Rejection
- SSRF to private/loopback: rejected
- Invalid URL: rejected
- Unknown host: rejected
