## Remaining Risks (P3-05)
1. Real kernel feature probing — currently simulated; needs platform-specific binary checks.
2. Actual seccomp/Seatbelt profile generation — needs integration with sandbox-local.
3. ptrace prevention on macOS — needs integration with Seatbelt profile.
4. CI on all three platforms — only tested on macOS currently.
