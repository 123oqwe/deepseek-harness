# P0-02 Remaining Risks

- Sandbox attestation checks OS-level indicators (seatbelt, seccomp, namespaces) but does not yet verify ExecutionWorld provider attestation (P3-01 dependency).
- The trust kernel is initialized in the boot path but the insecure flag is controlled by DSH_INSECURE env var; production deployment must ensure this is not set.
- The kernel singleton pattern means tests must reset between cases; resetKernelForTesting() is exported for test-only use.
