# @deepseek-ai/dsh-plugin-scanner
Static and dynamic plugin security scanner.
## Overview
- **staticScan**: Detects child_process, eval, native addons, dynamic require, fs writes, net servers, postinstall scripts, large deps
- **dynamicScan**: Compares observed behavior against manifest declarations (network, fs, process)
- **Rules**: 14 versioned rules with blocking/review/informational severity
## Key Invariants
- Timeout or crash cannot be interpreted as pass
- Benign code produces no blocking findings
- Undeclared network/fs/process is blocking
