# @deepseek-ai/dsh-permission-presets
Permission presets extended to complete policy profiles.
## Overview
- 4 predefined profiles: observe-only, workspace-safe, team-standard, production-controlled
- Each profile covers: execution world, fs/network/process/secrets, risk thresholds, approval rules, plugin trust, budget, retention
- kernelHardDenyDisabled must always be false
## Key Invariants
- No profile can disable kernel hard denies
- Production requires L4-production plugin trust
- Profile downgrade takes effect immediately; upgrade requires approval
