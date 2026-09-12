/**
 * One policy question, in the shape `toCedarRequest` reads.
 *
 * Cast rather than constructed field-by-field: what these cases compare is the
 * KEY SET the mapper produces, and a complete `ActionManifest` fixture would
 * add twenty fields none of them reads. The same shortcut, for the same
 * reason, as `policy-engine-cedar/tests/provider.spec.ts`'s own `request()`.
 */
import { brandString } from '@deepseek-ai/dsh-brand'
import type { PolicyRequest } from '@deepseek-ai/dsh-policy-engine'

/**
 * A destructive filesystem write by a user in a trusted workspace.
 * @returns the request, with every field the context mapping reads present.
 */
export function samplePolicyRequest(): PolicyRequest {
  return {
    identity: { kind: 'user', id: brandString('user-1'), tenantId: brandString('tenant-1') },
    token: undefined,
    manifest: {
      actionId: brandString('action-1'),
      capability: brandString('fs.write'),
      target: { kind: 'filesystem', path: 'workspace/a.ts' },
      sideEffectClass: 'destructive',
      classified: true,
    },
    world: { kind: 'absent' },
    facts: { workspaceTrust: 'trusted-execute', permissionPosture: 'default', riskClass: 'destructive' },
  } as unknown as PolicyRequest
}
