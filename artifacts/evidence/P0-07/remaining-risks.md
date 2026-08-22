# Remaining Risks — P0-07

1. The evidence collection runs a single command. Multi-gate collection (build, typecheck, lint, test) needs a wrapper script or batch mode.

2. The evidence package stores digests of stdout/stderr but not the full logs. A production deployment should archive full logs with content-addressed storage.

3. The build artifact digests check only two known lib/index.js files. As more packages are built, the artifact list must be updated.

4. The evidence verifier is not yet integrated into the release script as the final step.
