## Remaining Risks (P3-04)
1. Real DNS resolution — currently uses mock resolver; needs integration with actual DNS.
2. DNS-over-HTTPS bypass — needs integration with egress proxy enforcement.
3. IPv6 SSRF — currently checks IPv4 private ranges; IPv6 needs additional checks.
4. DNS rebinding (TOCTOU) — resolved at check time; needs integration with connection time verification.
