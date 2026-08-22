# Feature Gates

Shadow/Enforce feature gates for safe capability rollout.

## Gate States

| State | Description |
| --- | --- |
| off | Capability is disabled |
| shadow | New path runs but only records comparison events; user-visible result unchanged |
| enforce | New path is active and used for real |

## Usage

```ts
import { registerGate, resolveGate, setOverride, recordShadowEvent } from '@deepseek-ai/dsh-feature-gates'

registerGate({
  id: 'trust-kernel',
  description: 'Trust Kernel enforcement',
  owner: 'kernel-team',
  introducedVersion: '0.1.0',
  removalVersion: '1.0.0',
  defaultByProfile: { __default__: 'shadow', web: 'shadow' },
})

const gate = resolveGate('trust-kernel', 'web')
// gate.state = 'shadow'

setOverride('trust-kernel', '__home__', 'enforce')
// Now enforce is active
```

## Override Chain

Bundle default -> Profile default -> Home override -> CLI override (last wins)

## Downgrade Protection

Enforce -> off/shadow requires kernel admin permission.
