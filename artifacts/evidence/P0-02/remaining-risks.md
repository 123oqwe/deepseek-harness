 # Remaining Risks — P0-02

 1. The kernel is currently a singleton in process memory. A multi-process deployment would need a shared kernel state mechanism (e.g., a kernel daemon). This is addressed in later issues (P4-01, P8-02).

 2. Sandbox attestation is a stub that always passes in production mode. A real attestation requires platform-specific checks (e.g., seccomp on Linux, AMFI on macOS). This is addressed in P3-01 (ExecutionWorld).

 3. The kernel has not yet been integrated into the boot process. `initTrustKernel()` must be called before `Context` creation in `app-boot/src/index.ts` and `apps/cli/src/profile-boot.ts`. The integration is deferred to avoid breaking existing profiles; it will be wired in when P0-03 (Capability Seam checker) and P0-04 (dependency rules) are complete.

 4. Policy enforcement is currently deny-only at the kernel level. The full Policy Decision Service (P2-05) will extend this with plugin-level allow/deny rules.
