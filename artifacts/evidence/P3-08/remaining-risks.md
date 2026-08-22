## Remaining Risks (P3-08)
1. Real OCI runtime — currently simulated; needs integration with containerd/runc.
2. Real container escape corpus — needs actual security testing.
3. Crash cleanup with real containers — needs process signal handling.
4. Network namespace isolation — needs integration with egress proxy (P3-04).
