 # P0-01: Baseline Fingerprint

 ## Problem
 The repository is in developer-preview with a moving master. Without a machine-verifiable baseline fingerprint, execution agents risk applying wrong file mappings or mistaking upstream changes for their own.

 ## Contract
 - `pnpm baseline:capture` writes `.dsh/baseline.json` with a deterministic fingerprint of architecture- and protocol-critical surfaces.
 - `pnpm baseline:verify` exits 0 if the current state matches the captured fingerprint, exits 1 with a minimal diff otherwise.
 - The fingerprint excludes build artifacts, timestamps, and non-deterministic data.

 ## State Machine
 - No state machine; this is a pure capture/verify tool.

 ## Failure Semantics
 - Missing file: `baseline:capture` throws with the file path.
 - Drift: `baseline:verify` prints the diff type and exits 1.
 - No baseline.json: `baseline:verify` prints a hint to run capture and exits 1.

 ## Compatibility
 - Adds `baseline:capture` and `baseline:verify` to `package.json` scripts.
 - Adds `tests/**/*.spec.ts` to vitest includes.
 - No existing scripts or tests are modified.

 ## Rejection
 - The fingerprint does not freeze upstream development; it only freezes each optimization batch's input.
