# Remaining Risks — P1-01

1. The manifest is not yet integrated into the plugin CLI installer. The installer currently forwards to pnpm.

2. Runtime registration comparison (Cordis actual registry vs manifest) requires boot integration that is not yet wired.

3. SBOM and signature verification are handled by P1-02, not this issue.

4. The trust level assessment is static (L1-inspected for valid manifests). Dynamic testing (L3-verified) and org allowlist (L4-production) are handled by P1-12.
