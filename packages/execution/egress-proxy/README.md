# @deepseek-ai/dsh-egress-proxy
Unified network egress proxy with destination policy.
## Overview
- evaluateEgress: URL + policy → allow/deny decision
- SSRF prevention: blocks private IPs and loopback
- DNS resolution with hostname validation
- Allowlist/blocklist with wildcard patterns
## Key Invariants
- Private IPs blocked by default (SSRF prevention)
- Loopback blocked by default
- Explicit allowlist takes precedence
- Blocklist always wins over allowlist
